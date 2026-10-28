import { useEffect, useState, useCallback } from 'react';
import { CalendarClock, Plus, Trash2, AlertCircle, Upload } from 'lucide-react';
import { useI18n, weekDayLabel } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { localGetAll, localBulkPut, localDelete } from '@/lib/offline-db';
import { deleteThrough } from '@/lib/sync';
import { Modal, EmptyState, Spinner } from '@/components/ui';
import { DEFAULT_WORKING_DAYS, type ClassRow, type Lesson, type WeekDay } from '@/lib/types';
import { timeToMinutes } from '@/lib/utils';
import TimetableImportModal from '@/components/TimetableImportModal';

const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
const MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];

function timeOptions(): string[] {
  const out: string[] = [];
  for (const h of HOURS) for (const m of MINUTES) out.push(`${h.split(':')[0]}:${m}`);
  return out;
}
const TIMES = timeOptions();

export default function Timetables() {
  const { t, lang } = useI18n();
  const { profile, assignedClassIds } = useAuth();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selClass, setSelClass] = useState('');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [form, setForm] = useState({ week_day: 'sunday' as WeekDay, subject: '', start_time: '08:00', end_time: '09:00', room: '' });
  const [overlapWarn, setOverlapWarn] = useState<string | null>(null);
  const [roomConflictWarn, setRoomConflictWarn] = useState<string | null>(null);
  const [allInstLessons, setAllInstLessons] = useState<Lesson[]>([]);

  const isAdmin = profile?.role === 'admin';
  const instId = profile?.institution_id;

  const loadClasses = useCallback(async () => {
    if (!instId) return;
    const local = (await localGetAll<ClassRow>('classes')).filter((c) => c.institution_id === instId && !c.archived && (isAdmin || assignedClassIds.has(c.id))).sort((a, b) => a.name.localeCompare(b.name));
    setClasses(local);
    if (local.length && !selClass) setSelClass(local[0].id);
    try {
      const { data } = await supabase.from('classes').select('*').eq('institution_id', instId).eq('archived', false).order('name');
      const cls = (data ?? []) as ClassRow[];
      if (cls.length) {
        const visible = cls.filter((c) => isAdmin || assignedClassIds.has(c.id));
        await localBulkPut('classes', cls); setClasses(visible); if (!selClass && visible.length) setSelClass(visible[0].id);
      }
    } catch { /* offline */ }
  }, [instId, selClass, isAdmin, assignedClassIds]);

  useEffect(() => { loadClasses(); }, [loadClasses]);

  const loadLessons = useCallback(async () => {
    if (!selClass) return;
    setLoading(true);
    const local = (await localGetAll<Lesson>('lessons')).filter((l) => l.class_id === selClass).sort((a, b) => a.week_day.localeCompare(b.week_day) || a.start_time.localeCompare(b.start_time));
    setLessons(local);
    setLoading(false);
    try {
      const { data } = await supabase.from('lessons').select('*,classes!inner(institution_id)').eq('classes.institution_id', instId).order('week_day').order('start_time');
      const fresh = (data ?? []) as Lesson[];
      if (fresh.length >= 0) { await localBulkPut('lessons', fresh); setAllInstLessons(fresh); setLessons(fresh.filter((l) => l.class_id === selClass)); }
    } catch { /* offline */ }
  }, [selClass, instId]);

  useEffect(() => { loadLessons(); }, [loadLessons]);

  const lessonsByDay = (day: WeekDay) => lessons.filter((l) => l.week_day === day);

  const addLesson = async () => {
    if (!selClass || !form.subject.trim()) return;
    if (timeToMinutes(form.end_time) <= timeToMinutes(form.start_time)) return;
    const dayLessons = lessonsByDay(form.week_day);
    const s = timeToMinutes(form.start_time), e = timeToMinutes(form.end_time);
    const conflict = dayLessons.find((l) => {
      const ls = timeToMinutes(l.start_time), le = timeToMinutes(l.end_time);
      return s < le && e > ls;
    });
    if (conflict) {
      setOverlapWarn(`${conflict.subject} ${conflict.start_time}-${conflict.end_time}`);
      return;
    }
    setOverlapWarn(null);

    // Check room conflict across all institution lessons
    let roomConflict: Lesson | null = null;
    if (form.room.trim()) {
      const roomVal = form.room.trim();
      roomConflict = allInstLessons.find((l) => {
        if (!l.room || l.room !== roomVal) return false;
        if (l.class_id === selClass && l.week_day === form.week_day) return false; // same class, handled by overlap check above
        if (l.week_day !== form.week_day) return false;
        const ls = timeToMinutes(l.start_time), le = timeToMinutes(l.end_time);
        return s < le && e > ls;
      }) ?? null;
    }
    if (roomConflict) {
      const conflictClassName = classes.find((c) => c.id === roomConflict!.class_id)?.name ?? '';
      setRoomConflictWarn(t('room_conflict_msg').replace('{room}', form.room.trim()).replace('{subject}', roomConflict.subject).replace('{className}', conflictClassName));
      return;
    }
    setRoomConflictWarn(null);
    const id = crypto.randomUUID();
    const duration = timeToMinutes(form.end_time) - timeToMinutes(form.start_time);
    const lesson: Lesson = {
      id,
      class_id: selClass,
      week_day: form.week_day,
      subject: form.subject.trim(),
      start_time: form.start_time,
      end_time: form.end_time,
      duration_minutes: duration,
      room: form.room.trim() || null,
      effective_from: new Date().toISOString().slice(0, 10),
      created_at: new Date().toISOString(),
    };
    await localBulkPut('lessons', [lesson]);
    try { await supabase.from('lessons').insert({ id, class_id: selClass, week_day: form.week_day, subject: form.subject.trim(), start_time: form.start_time, end_time: form.end_time, room: form.room.trim() || null }); } catch { /* offline */ }
    setModal(false);
    setForm({ week_day: 'sunday', subject: '', start_time: '08:00', end_time: '09:00', room: '' });
    setRoomConflictWarn(null);
    loadLessons();
  };

  const removeLesson = async (id: string) => {
    await deleteThrough('lessons', 'lessons', id);
    loadLessons();
  };

  const totalMinutesWeek = lessons.reduce((s, l) => s + l.duration_minutes, 0);
  const selClassName = classes.find((c) => c.id === selClass)?.name ?? '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <select className="input max-w-xs" value={selClass} onChange={(e) => setSelClass(e.target.value)}>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">{t('total')}: {Math.floor(totalMinutesWeek / 60)}h {totalMinutesWeek % 60}{t('minutes')}</span>
          <button onClick={() => setImportModal(true)} className="btn btn-ghost" disabled={!selClass}><Upload size={18} />{t('import_timetable')}</button>
          <button onClick={() => setModal(true)} className="btn btn-primary" disabled={!selClass}><Plus size={18} />{t('subject')}</button>
        </div>
      </div>

      {!selClass ? <div className="card"><EmptyState icon={<CalendarClock size={40} />} text={t('empty')} /></div> :
        loading ? <Spinner label={t('loading')} /> : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {DEFAULT_WORKING_DAYS.map((day) => (
              <div key={day} className="card">
                <h3 className="font-semibold mb-3">{weekDayLabel(day, lang)}</h3>
                {lessonsByDay(day).length === 0 ? (
                  <p className="text-sm text-muted py-4 text-center">{t('no_lessons_today')}</p>
                ) : (
                  <div className="space-y-2">
                    {lessonsByDay(day).sort((a, b) => a.start_time.localeCompare(b.start_time)).map((l) => (
                      <div key={l.id} className="flex items-center justify-between surface-2 rounded-lg px-3 py-2">
                        <div>
                          <div className="font-medium text-sm">{l.subject}</div>
                          <div className="text-xs text-muted">{l.start_time} - {l.end_time} ({l.duration_minutes}{t('minutes')}){l.room ? ` · ${t('room')}: ${l.room}` : ''}</div>
                        </div>
                        <button onClick={() => removeLesson(l.id)} className="btn btn-ghost p-1.5 text-[var(--error)]"><Trash2 size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

      <Modal open={modal} onClose={() => { setModal(false); setOverlapWarn(null); setRoomConflictWarn(null); }} title={t('subject')}>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label">{t('subject')}</label>
            <input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} autoFocus />
          </div>
          <div className="sm:col-span-2">
            <label className="label">{t('room')}</label>
            <input className="input" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder={t('room_optional')} />
          </div>
          <div>
            <label className="label">{t('date')}</label>
            <select className="input" value={form.week_day} onChange={(e) => setForm({ ...form, week_day: e.target.value as WeekDay })}>
              {DEFAULT_WORKING_DAYS.map((d) => <option key={d} value={d}>{weekDayLabel(d, lang)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t('start_time')}</label>
            <select className="input" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })}>
              {TIMES.map((tm) => <option key={tm} value={tm}>{tm}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t('end_time')}</label>
            <select className="input" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })}>
              {TIMES.map((tm) => <option key={tm} value={tm}>{tm}</option>)}
            </select>
          </div>
        </div>
        {overlapWarn && (
          <div className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'color-mix(in srgb, var(--warning) 12%, transparent)', color: 'var(--warning)' }}>
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{t('error')}: {overlapWarn}</span>
          </div>
        )}
        {roomConflictWarn && (
          <div className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'color-mix(in srgb, var(--warning) 12%, transparent)', color: 'var(--warning)' }}>
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{t('room_conflict')}: {roomConflictWarn}</span>
          </div>
        )}
        {timeToMinutes(form.end_time) <= timeToMinutes(form.start_time) && (
          <div className="mt-3 text-sm" style={{ color: 'var(--error)' }}>{t('end_time')} &gt; {t('start_time')}</div>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={() => { setModal(false); setOverlapWarn(null); setRoomConflictWarn(null); }} className="btn btn-ghost">{t('cancel')}</button>
          <button onClick={addLesson} className="btn btn-primary">{t('save')}</button>
        </div>
      </Modal>

      <TimetableImportModal
        open={importModal}
        onClose={() => setImportModal(false)}
        classId={selClass}
        className={selClassName}
        onDone={loadLessons}
      />
    </div>
  );
}
