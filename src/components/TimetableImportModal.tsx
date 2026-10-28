import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, X, Download, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { localGetAll, localBulkPut, localDelete } from '@/lib/offline-db';
import { Modal, Spinner } from '@/components/ui';
import { parseExcelFile, buildTimetablePreview, generateTimetableTemplate, type TimetablePreview } from '@/lib/excel';
import { downloadBlob, timeToMinutes } from '@/lib/utils';
import type { ClassRow, Lesson, WeekDay } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  classId: string;
  className: string;
  onDone: () => void;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export default function TimetableImportModal({ open, onClose, classId, className, onDone }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState<'select' | 'preview' | 'importing' | 'done'>('select');
  const [preview, setPreview] = useState<TimetablePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importCount, setImportCount] = useState(0);
  const [overwrite, setOverwrite] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [existingInstLessons, setExistingInstLessons] = useState<Lesson[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = useCallback(async (f: File) => {
    setError(null);
    if (!f.name.match(/\.(xlsx|xls|csv)$/i)) {
      setError(t('import_invalid_file'));
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setError(t('import_file_too_large'));
      return;
    }
    try {
      const buf = await f.arrayBuffer();
      const { headers, rows } = parseExcelFile(buf);
      if (headers.length === 0) {
        setError(t('import_no_data'));
        return;
      }
      const p = buildTimetablePreview(headers, rows);
      setPreview(p);
      setStep('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [t]);

  useEffect(() => {
    (async () => {
      if (!classId) return;
      const local = await localGetAll<Lesson>('lessons');
      setExistingInstLessons(local);
      try {
        const { data } = await supabase.from('lessons').select('*,classes!inner(institution_id)').eq('classes.institution_id', (await supabase.from('classes').select('institution_id').eq('id', classId).maybeSingle()).data?.institution_id ?? '');
        if (data) { setExistingInstLessons(data as Lesson[]); await localBulkPut('lessons', data as Lesson[]); }
      } catch { /* offline */ }
    })();
  }, [classId]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const roomConflicts = useMemo(() => {
    if (!preview) return [];
    const conflicts: { room: string; slot: string; subjects: string[] }[] = [];

    // Internal conflicts within the imported file
    const internalMap = new Map<string, Set<string>>();
    for (const r of preview.validRows) {
      if (!r.room) continue;
      const s = timeToMinutes(r.startTime), e = timeToMinutes(r.endTime);
      for (const other of preview.validRows) {
        if (other === r || !other.room || other.room !== r.room) continue;
        if (other.weekDay !== r.weekDay) continue;
        const os = timeToMinutes(other.startTime), oe = timeToMinutes(other.endTime);
        if (s < oe && e > os) {
          const key = `${r.room}__${r.weekDay}__${r.startTime}-${r.endTime}`;
          if (!internalMap.has(key)) internalMap.set(key, new Set());
          internalMap.get(key)!.add(r.subject);
          internalMap.get(key)!.add(other.subject);
        }
      }
    }
    for (const [key, subjects] of internalMap) {
      if (subjects.size > 1) {
        const parts = key.split('__');
        conflicts.push({ room: parts[0], slot: parts[2] ?? '', subjects: [...subjects] });
      }
    }

    // Conflicts against existing institution lessons
    for (const r of preview.validRows) {
      if (!r.room) continue;
      const s = timeToMinutes(r.startTime), e = timeToMinutes(r.endTime);
      for (const ex of existingInstLessons) {
        if (!ex.room || ex.room !== r.room) continue;
        if (ex.class_id === classId && overwrite) continue;
        if (ex.week_day !== r.weekDay) continue;
        const es = timeToMinutes(ex.start_time), ee = timeToMinutes(ex.end_time);
        if (s < ee && e > es) {
          const already = conflicts.some((c) => c.room === r.room && c.slot === `${r.startTime}-${r.endTime}` && c.subjects.includes(ex.subject));
          if (!already) {
            conflicts.push({ room: r.room, slot: `${r.startTime}-${r.endTime}`, subjects: [r.subject, `${ex.subject} (existing)`] });
          }
        }
      }
    }

    return conflicts;
  }, [preview, existingInstLessons, classId, overwrite]);

  const doImport = async () => {
    if (!preview || !classId) return;
    setStep('importing');
    setError(null);
    let count = 0;

    try {
      // If overwrite, delete existing lessons for this class
      if (overwrite) {
        const existing = (await localGetAll<Lesson>('lessons')).filter((l) => l.class_id === classId);
        for (const lesson of existing) {
          await localDelete('lessons', lesson.id);
          try { await supabase.from('lessons').delete().eq('id', lesson.id); } catch { /* offline */ }
        }
      }

      // Check for duplicates (if not overwriting)
      const existingLessons = (await localGetAll<Lesson>('lessons')).filter((l) => l.class_id === classId);
      const existingKeys = new Set(existingLessons.map((l) => `${l.week_day}_${l.start_time}_${l.subject}`));

      for (const row of preview.validRows) {
        const key = `${row.weekDay}_${row.startTime}_${row.subject}`;
        if (!overwrite && existingKeys.has(key)) continue;

        const id = crypto.randomUUID();
        const duration = timeToMinutes(row.endTime) - timeToMinutes(row.startTime);
        const lesson: Lesson = {
          id,
          class_id: classId,
          week_day: row.weekDay as WeekDay,
          subject: row.subject,
          start_time: row.startTime,
          end_time: row.endTime,
          duration_minutes: duration,
          room: row.room ?? null,
          effective_from: new Date().toISOString().slice(0, 10),
          created_at: new Date().toISOString(),
        };

        // Save to local
        await localBulkPut('lessons', [lesson]);

        // Push to Supabase if online
        try {
          await supabase.from('lessons').insert({
            id,
            class_id: classId,
            week_day: row.weekDay,
            subject: row.subject,
            start_time: row.startTime,
            end_time: row.endTime,
            room: row.room ?? null,
          });
        } catch { /* offline — saved locally, will sync later */ }

        count++;
      }

      setImportCount(count);
      setStep('done');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('preview');
    }
  };

  const downloadTemplate = () => {
    try {
      const blob = generateTimetableTemplate();
      const ok = downloadBlob(blob, 'EduTrack_timetable_template.xlsx');
      if (!ok) setError(t('download_failed'));
    } catch {
      setError(t('download_failed'));
    }
  };

  const reset = () => {
    setStep('select'); setPreview(null);
    setError(null); setImportCount(0);
  };

  const close = () => { reset(); onClose(); };

  return (
    <Modal open={open} onClose={close} title={t('import_timetable_title')} wide>
      {error && (
        <div className="mb-4 rounded-lg px-4 py-3 text-sm flex items-start gap-2" style={{ background: 'color-mix(in srgb, var(--error) 12%, transparent)', color: 'var(--error)' }}>
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={downloadTemplate} className="btn btn-ghost">
          <Download size={16} />{t('download_template')}
        </button>
      </div>

      <p className="text-sm text-muted mb-3">
        {t('import_timetable_hint')} — <span className="font-medium">{className}</span>
      </p>

      {step === 'select' && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition"
          style={{ borderColor: dragOver ? 'var(--primary-600)' : 'var(--border)', background: dragOver ? 'color-mix(in srgb, var(--primary-600) 5%, transparent)' : 'transparent' }}
        >
          <FileSpreadsheet size={40} className="mx-auto mb-3 text-muted" />
          <p className="text-sm font-medium">{t('drag_drop_file')}</p>
          <p className="text-xs text-muted mt-1">.xlsx, .xls, .csv — max 5MB</p>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="surface-2 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold" style={{ color: 'var(--success)' }}>{preview.validRows.length}</div>
              <div className="text-xs text-muted">{t('new_records')}</div>
            </div>
            <div className="surface-2 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold" style={{ color: 'var(--error)' }}>{preview.invalidRows.length}</div>
              <div className="text-xs text-muted">{t('invalid_records')}</div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            <div>
              <span className="font-medium">{t('overwrite_lessons')}</span>
              <p className="text-xs text-muted">{t('overwrite_hint')}</p>
            </div>
          </label>

          {preview.invalidRows.length > 0 && (
            <div className="max-h-[150px] overflow-y-auto rounded-lg border border-app">
              <div className="text-xs font-semibold p-2 surface-2 sticky top-0" style={{ color: 'var(--error)' }}>
                {t('row_errors')} ({preview.invalidRows.length})
              </div>
              {preview.invalidRows.slice(0, 20).map((r) => (
                <div key={r.rowIndex} className="p-2 border-b border-app text-xs">
                  <span className="text-muted">#{r.rowIndex}: </span>
                  <span style={{ color: 'var(--error)' }}>{r.errors.join(', ')}</span>
                </div>
              ))}
            </div>
          )}

          {roomConflicts.length > 0 && (
            <div className="max-h-[150px] overflow-y-auto rounded-lg border border-app">
              <div className="text-xs font-semibold p-2 surface-2 sticky top-0" style={{ color: 'var(--warning)' }}>
                {t('room_conflicts_found').replace('{count}', String(roomConflicts.length))}
              </div>
              {roomConflicts.slice(0, 20).map((c, i) => (
                <div key={i} className="p-2 border-b border-app text-xs">
                  <span className="text-muted">{t('room')}: {c.room} · {c.slot} — </span>
                  <span style={{ color: 'var(--warning)' }}>{c.subjects.join(' / ')}</span>
                </div>
              ))}
            </div>
          )}

          {preview.validRows.length > 0 && (
            <div className="max-h-[250px] overflow-auto rounded-lg border border-app">
              <table className="w-full text-xs">
                <thead className="surface-2 sticky top-0">
                  <tr>
                    <th className="p-2 text-start">{t('subject')}</th>
                    <th className="p-2 text-start">{t('date')}</th>
                    <th className="p-2 text-start">{t('start_time')}</th>
                    <th className="p-2 text-start">{t('end_time')}</th>
                    <th className="p-2 text-start">{t('room')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.validRows.map((r, i) => (
                    <tr key={i} className="border-b border-app">
                      <td className="p-2 font-medium">{r.subject}</td>
                      <td className="p-2">{r.weekDay}</td>
                      <td className="p-2">{r.startTime}</td>
                      <td className="p-2">{r.endTime}</td>
                      <td className="p-2">{r.room ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={reset} className="btn btn-ghost">{t('cancel')}</button>
            <button onClick={doImport} disabled={preview.validRows.length === 0} className="btn btn-primary">
              <Upload size={16} />{t('confirm_import')}
            </button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="py-8 text-center space-y-3">
          <Loader2 size={32} className="mx-auto animate-spin" style={{ color: 'var(--primary-600)' }} />
          <p className="text-sm text-muted">{t('import_processing')}</p>
        </div>
      )}

      {step === 'done' && (
        <div className="py-6 text-center space-y-4">
          <CheckCircle2 size={48} className="mx-auto" style={{ color: 'var(--success)' }} />
          <div className="space-y-1">
            <p className="font-semibold">{t('timetable_imported')}</p>
            <p className="text-sm" style={{ color: 'var(--success)' }}>
              {importCount > 0
                ? t('timetable_import_count').replace('{count}', String(importCount))
                : t('no_lessons_imported')}
            </p>
          </div>
          <button onClick={close} className="btn btn-primary">{t('confirm')}</button>
        </div>
      )}
    </Modal>
  );
}
