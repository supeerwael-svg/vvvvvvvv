import { useState, useRef, useCallback } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, X, Download, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Modal, Spinner } from '@/components/ui';
import { parseExcelFile, buildPreview, generateTemplate, exportCurrentData, type ImportPreview, type ImportRow } from '@/lib/excel';
import { downloadBlob } from '@/lib/utils';
import type { ClassRow, Student } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export default function ExcelImportModal({ open, onClose, onDone }: Props) {
  const { t } = useI18n();
  const { profile } = useAuth();
  const instId = profile?.institution_id;
  const isAdmin = profile?.role === 'admin';

  const [step, setStep] = useState<'select' | 'preview' | 'importing' | 'done'>('select');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [existingStudentKeys, setExistingStudentKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number; failed: number } | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const loadExistingData = useCallback(async () => {
    if (!instId) return;
    const [cRes, sRes] = await Promise.all([
      supabase.from('classes').select('*').eq('institution_id', instId).eq('archived', false),
      supabase.from('students').select('*, classes!inner(name)').eq('institution_id', instId).eq('archived', false),
    ]);
    const cls = (cRes.data ?? []) as ClassRow[];
    setClasses(cls);
    const studs = (sRes.data ?? []) as (Student & { classes: { name: string } })[];
    const keys = new Set<string>();
    for (const s of studs) {
      keys.add(`${s.classes.name}__${s.last_name}__${s.first_name}`);
    }
    setExistingStudentKeys(keys);
  }, [instId]);

  const handleFile = useCallback(async (f: File) => {
    setError(null);
    if (!f.name.match(/\.(xlsx|csv)$/i)) {
      setError(t('import_invalid_file'));
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setError(t('import_file_too_large'));
      return;
    }
    setFile(f);
    try {
      const buf = await f.arrayBuffer();
      const { headers, rows } = parseExcelFile(buf);
      if (headers.length === 0) {
        setError(t('import_no_data'));
        return;
      }
      await loadExistingData();
      const existingClassNames = new Set(classes.map((c) => c.name));
      const p = buildPreview(headers, rows, existingClassNames, existingStudentKeys);
      setPreview(p);
      setStep('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [classes, existingStudentKeys, loadExistingData, t]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const doImport = async () => {
    if (!preview || !instId) return;
    setStep('importing');
    setError(null);

    let created = 0, skipped = 0, failed = 0;

    try {
      // 1. Create new classes
      const newClassNames = [...preview.newClasses];
      const classNameToId = new Map<string, string>();
      for (const c of classes) classNameToId.set(c.name, c.id);

      for (const name of newClassNames) {
        const { data, error } = await supabase
          .from('classes')
          .insert({ institution_id: instId, name })
          .select('id, name')
          .single();
        if (error) { failed++; continue; }
        classNameToId.set(name, (data as { id: string }).id);
      }

      // 2. Insert students
      const rowsToImport = skipDuplicates
        ? preview.validRows.filter((r) => {
            const key = `${r.className}__${r.lastName}__${r.firstName}`;
            return !existingStudentKeys.has(key);
          })
        : preview.validRows;

      for (const row of rowsToImport) {
        const classId = classNameToId.get(row.className);
        if (!classId) { failed++; continue; }

        const studentKey = `${row.className}__${row.lastName}__${row.firstName}`;
        if (skipDuplicates && existingStudentKeys.has(studentKey)) {
          skipped++;
          continue;
        }

        const { error } = await supabase.from('students').insert({
          institution_id: instId,
          class_id: classId,
          first_name: row.firstName,
          last_name: row.lastName,
          birth_date: row.birthDate,
          gender: row.gender,
          repetition_status: row.repetition,
          boarding: row.boarding,
        });

        if (error) {
          failed++;
        } else {
          created++;
        }
      }

      // 3. Create teacher assignments if present
      const teacherRows = rowsToImport.filter((r) => r.teacherName && r.subject);
      for (const row of teacherRows) {
        const classId = classNameToId.get(row.className);
        if (!classId) continue;

        // Find or create teacher
        const { data: existingTeacher } = await supabase
          .from('teachers')
          .select('id')
          .eq('institution_id', instId)
          .eq('name', row.teacherName!)
          .maybeSingle();

        let teacherId = (existingTeacher as { id: string } | null)?.id;
        if (!teacherId) {
          const { data: newTeacher } = await supabase
            .from('teachers')
            .insert({ institution_id: instId, name: row.teacherName! })
            .select('id')
            .single();
          teacherId = (newTeacher as { id: string })?.id;
        }

        if (teacherId) {
          await supabase.from('teacher_class_assignments').upsert({
            institution_id: instId,
            teacher_id: teacherId,
            class_id: classId,
            subject: row.subject!,
          }, { onConflict: 'teacher_id,class_id,subject' });
        }
      }

      setImportResult({ created, skipped, failed });
      setStep('done');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('preview');
    }
  };

  const downloadTemplate = () => {
    try {
      const blob = generateTemplate();
      const ok = downloadBlob(blob, 'EduTrack_template.xlsx');
      if (!ok) setError(t('download_failed'));
    } catch {
      setError(t('download_failed'));
    }
  };

  const downloadCurrentData = async () => {
    if (!instId) return;
    const [cRes, sRes] = await Promise.all([
      supabase.from('classes').select('name').eq('institution_id', instId).eq('archived', false),
      supabase.from('students').select('first_name, last_name, birth_date, gender, repetition_status, boarding, classes!inner(name)').eq('institution_id', instId).eq('archived', false),
    ]);
    const cls = (cRes.data ?? []) as { name: string }[];
    const studs = (sRes.data ?? []) as unknown as { first_name: string; last_name: string; birth_date: string | null; gender: string | null; repetition_status: string; boarding: string; classes: { name: string } }[];
    const data = studs.map((s) => ({
      class_name: s.classes.name,
      first_name: s.first_name,
      last_name: s.last_name,
      birth_date: s.birth_date,
      gender: s.gender,
      repetition_status: s.repetition_status,
      boarding: s.boarding,
    }));
    const blob = exportCurrentData(cls, data);
    downloadBlob(blob, 'EduTrack_export.xlsx');
  };

  const reset = () => {
    setStep('select'); setFile(null); setPreview(null);
    setError(null); setImportResult(null);
  };

  const close = () => { reset(); onClose(); };

  if (!isAdmin) return null;

  return (
    <Modal open={open} onClose={close} title={t('import_class_list')} wide>
      {error && (
        <div className="mb-4 rounded-lg px-4 py-3 text-sm flex items-start gap-2" style={{ background: 'color-mix(in srgb, var(--error) 12%, transparent)', color: 'var(--error)' }}>
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Template + export buttons */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={downloadTemplate} className="btn btn-ghost">
          <Download size={16} />{t('download_template')}
        </button>
        <button onClick={downloadCurrentData} className="btn btn-ghost">
          <Download size={16} />{t('export_current_data')}
        </button>
      </div>

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
          <p className="text-xs text-muted mt-1">.xlsx, .csv — max 5MB</p>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-2">
            <div className="surface-2 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold" style={{ color: 'var(--success)' }}>{preview.validRows.length}</div>
              <div className="text-xs text-muted">{t('new_records')}</div>
            </div>
            <div className="surface-2 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold" style={{ color: 'var(--warning)' }}>{preview.duplicateStudents.length}</div>
              <div className="text-xs text-muted">{t('duplicate_records')}</div>
            </div>
            <div className="surface-2 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold" style={{ color: 'var(--error)' }}>{preview.invalidRows.length}</div>
              <div className="text-xs text-muted">{t('invalid_records')}</div>
            </div>
          </div>

          {/* Duplicate handling */}
          {preview.duplicateStudents.length > 0 && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />
              <span>{t('skip_duplicates')}</span>
            </label>
          )}

          {/* Invalid rows */}
          {preview.invalidRows.length > 0 && (
            <div className="max-h-[200px] overflow-y-auto rounded-lg border border-app">
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

          {/* Valid rows preview table */}
          <div className="max-h-[300px] overflow-auto rounded-lg border border-app">
            <table className="w-full text-xs">
              <thead className="surface-2 sticky top-0">
                <tr>
                  <th className="p-2 text-start">{t('col_class_name')}</th>
                  <th className="p-2 text-start">{t('col_first_name')}</th>
                  <th className="p-2 text-start">{t('col_last_name')}</th>
                  <th className="p-2 text-start">{t('col_birth_date')}</th>
                  <th className="p-2 text-start">{t('col_gender')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.validRows.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-b border-app">
                    <td className="p-2">{r.className}</td>
                    <td className="p-2">{r.firstName}</td>
                    <td className="p-2">{r.lastName}</td>
                    <td className="p-2">{r.birthDate ?? '—'}</td>
                    <td className="p-2">{r.gender ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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

      {step === 'done' && importResult && (
        <div className="py-6 text-center space-y-4">
          <CheckCircle2 size={48} className="mx-auto" style={{ color: 'var(--success)' }} />
          <div className="space-y-1">
            <p className="font-semibold">{t('import_success')}</p>
            <div className="flex justify-center gap-4 text-sm">
              <span style={{ color: 'var(--success)' }}>{t('new_records')}: {importResult.created}</span>
              {importResult.skipped > 0 && <span style={{ color: 'var(--warning)' }}>{t('duplicate_records')}: {importResult.skipped}</span>}
              {importResult.failed > 0 && <span style={{ color: 'var(--error)' }}>{t('row_errors')}: {importResult.failed}</span>}
            </div>
          </div>
          <button onClick={close} className="btn btn-primary">{t('confirm')}</button>
        </div>
      )}
    </Modal>
  );
}
