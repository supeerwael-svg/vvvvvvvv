import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { CheckCircle2, AlertTriangle, Loader2, RotateCw, XCircle, Undo2 } from 'lucide-react';
import { useI18n, weekDayLabel } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { localGetAll, localBulkPut, localDelete } from '@/lib/offline-db';
import { writeThrough, deleteThrough } from '@/lib/sync';
import { Spinner, EmptyState } from '@/components/ui';
import { isoDate, weekDayOf } from '@/lib/utils';
import type { ClassRow, Lesson, Student, AttendanceRecord, AttendanceStatus } from '@/lib/types';

type SelMap = Record<string, AttendanceStatus>;
type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export default function Attendance() {
  const { t, lang } = useI18n();
  const { profile, assignedClassIds } = useAuth();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selClass, setSelClass] = useState('');
  const [date, setDate] = useState(isoDate(new Date()));
  const [students, setStudents] = useState<Student[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [existing, setExisting] = useState<AttendanceRecord[]>([]);
  const [sel, setSel] = useState<SelMap>({});
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const instId = profile?.institution_id;
  const isAdmin = profile?.role === 'admin';

  // Load classes from local cache (offline-first)
  useEffect(() => {
    if (!instId) return;
    (async () => {
      const local = await localGetAll<ClassRow>('classes');
      const filtered = local.filter((c) => c.institution_id === instId && !c.archived && (isAdmin || assignedClassIds.has(c.id))).sort((a, b) => a.name.localeCompare(b.name));
      setClasses(filtered);
      // Also try refresh from Supabase in background
      try {
        const { data } = await supabase.from('classes').select('*').eq('institution_id', instId).eq('archived', false).order('name');
        const cls = (data ?? []) as ClassRow[];
        if (cls.length > 0) {
          await localBulkPut('classes', cls);
          const visible = cls.filter((c) => isAdmin || assignedClassIds.has(c.id));
          setClasses(visible);
          if (!selClass && visible.length) setSelClass(visible[0].id);
        }
      } catch { /* offline — local is fine */ }
      if (filtered.length && !selClass) setSelClass(filtered[0].id);
    })();
  }, [instId]);

  const loadDay = useCallback(async (cls: string, dt: string) => {
    if (!cls || !dt) return;
    setLoading(true);
    setSaveState('idle');
    const wd = weekDayOf(new Date(dt)) as Lesson['week_day'];

    // Load from local cache first (instant, offline)
    const localStudents = (await localGetAll<Student>('students')).filter((s) => s.class_id === cls && !s.archived).sort((a, b) => a.last_name.localeCompare(b.last_name));
    const localLessons = (await localGetAll<Lesson>('lessons')).filter((l) => l.class_id === cls && l.week_day === wd).sort((a, b) => a.start_time.localeCompare(b.start_time));
    const localAtts = (await localGetAll<AttendanceRecord>('attendance_records')).filter((a) => a.class_id === cls && a.record_date === dt);

    setStudents(localStudents);
    setLessons(localLessons);
    setExisting(localAtts);

    const dayLessonIds = new Set(localLessons.map((l) => l.id));
    const m: SelMap = {};
    for (const a of localAtts) {
      if (a.lesson_id && dayLessonIds.has(a.lesson_id)) {
        m[`${a.student_id}__${a.lesson_id}`] = a.status;
      }
    }
    setSel(m);
    setLoading(false);

    // Try refresh from Supabase in background if online
    try {
      const [stuRes, lesRes, attRes] = await Promise.all([
        supabase.from('students').select('*').eq('class_id', cls).eq('archived', false).order('last_name'),
        supabase.from('lessons').select('*').eq('class_id', cls).eq('week_day', wd).order('start_time'),
        supabase.from('attendance_records').select('*').eq('class_id', cls).eq('record_date', dt),
      ]);
      const freshStudents = (stuRes.data ?? []) as Student[];
      const freshLessons = (lesRes.data ?? []) as Lesson[];
      const freshAtts = (attRes.data ?? []) as AttendanceRecord[];
      if (freshStudents.length) { await localBulkPut('students', freshStudents); setStudents(freshStudents); }
      if (freshLessons.length) { await localBulkPut('lessons', freshLessons); setLessons(freshLessons); }
      if (freshAtts.length >= 0) { await localBulkPut('attendance_records', freshAtts); setExisting(freshAtts); }

      const m2: SelMap = {};
      const lessonIds = new Set(freshLessons.map((l) => l.id));
      for (const a of freshAtts) {
        if (a.lesson_id && lessonIds.has(a.lesson_id)) {
          m2[`${a.student_id}__${a.lesson_id}`] = a.status;
        }
      }
      setSel(m2);
    } catch { /* offline — local data already loaded */ }
  }, []);

  useEffect(() => {
    loadDay(selClass, date);
  }, [selClass, date, loadDay]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saveState === 'saving') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveState]);

  // Save a single student-lesson attendance record immediately (independent save per lesson)
  const saveRecord = useCallback(async (studentId: string, lesson: Lesson, status: AttendanceStatus | null) => {
    if (!instId || !selClass) return;
    setSaveState('saving');
    const key = `${studentId}__${lesson.id}`;
    const existingRec = existing.find((a) => a.student_id === studentId && a.lesson_id === lesson.id);

    try {
      if (status === null) {
        // Cancel absence / mark present → delete the record
        if (existingRec) {
          await deleteThrough('attendance_records', 'attendance_records', existingRec.id);
          setExisting((prev) => prev.filter((a) => a.id !== existingRec.id));
        }
      } else {
        const record: Omit<AttendanceRecord, 'created_at' | 'updated_at'> & { created_at?: string; updated_at?: string } = {
          id: existingRec?.id ?? crypto.randomUUID(),
          institution_id: instId,
          class_id: selClass,
          student_id: studentId,
          lesson_id: lesson.id,
          record_date: date,
          subject_snapshot: lesson.subject,
          start_time_snapshot: lesson.start_time,
          end_time_snapshot: lesson.end_time,
          duration_minutes_snapshot: lesson.duration_minutes,
          status,
          recorded_by: profile?.user_id ?? null,
          created_at: existingRec?.created_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        await writeThrough('attendance_records', 'attendance_records', record as AttendanceRecord, existingRec ? 'update' : 'insert');
        setExisting((prev) => {
          const idx = prev.findIndex((a) => a.id === record.id);
          if (idx >= 0) { const next = [...prev]; next[idx] = record as AttendanceRecord; return next; }
          return [...prev, record as AttendanceRecord];
        });
      }
      setSaveState('saved');
    } catch {
      setSaveState('failed');
    }
  }, [instId, selClass, date, existing, profile?.user_id]);

  // Toggle absent/present for a student-lesson — tapping a red lesson cancels only that lesson
  const toggle = (studentId: string, lesson: Lesson) => {
    const key = `${studentId}__${lesson.id}`;
    const current = sel[key];
    const newStatus: AttendanceStatus | null = current === 'absent' ? null : 'absent';
    setSel((prev) => {
      const next = { ...prev };
      if (newStatus === null) delete next[key];
      else next[key] = newStatus;
      return next;
    });
    saveRecord(studentId, lesson, newStatus);
  };

  // Explicit "Cancel Absence" button — removes only the selected lesson's absence
  const cancelAbsence = (studentId: string, lesson: Lesson) => {
    const key = `${studentId}__${lesson.id}`;
    setSel((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    saveRecord(studentId, lesson, null);
  };

  // Set a specific status (present/excused)
  const setStatus = (studentId: string, lesson: Lesson, status: AttendanceStatus) => {
    const key = `${studentId}__${lesson.id}`;
    const newStatus: AttendanceStatus | null = status === 'present' ? null : status;
    setSel((prev) => {
      const next = { ...prev };
      if (newStatus === null) delete next[key];
      else next[key] = newStatus;
      return next;
    });
    saveRecord(studentId, lesson, newStatus);
  };

  const studentTotalMinutes = (s: Student) => {
    let mins = 0;
    for (const l of lessons) {
      const st = sel[`${s.id}__${l.id}`];
      if (st === 'absent') mins += l.duration_minutes;
    }
    return mins;
  };

  const sortedLessons = useMemo(() => [...lessons].sort((a, b) => a.start_time.localeCompare(b.start_time)), [lessons]);
  const weekday = weekDayOf(new Date(date));

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-3 items-end sticky top-16 z-10" style={{ background: 'var(--surface)' }}>
        <div>
          <label className="label">{t('select_class')}</label>
          <select className="input min-w-[160px]" value={selClass} onChange={(e) => setSelClass(e.target.value)}>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('select_date')}</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="text-sm text-muted ms-auto">{weekDayLabel(weekday, lang)}</div>
      </div>

      {!selClass ? <div className="card"><EmptyState text={t('select_class')} /></div> :
        loading ? <Spinner label={t('loading')} /> :
        students.length === 0 ? <div className="card"><EmptyState text={t('empty')} /></div> :
        lessons.length === 0 ? <div className="card"><EmptyState text={t('no_lessons_today')} /></div> : (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-sm">
                {saveState === 'saving' && (
                  <span className="flex items-center gap-1.5 text-[var(--warning)]">
                    <Loader2 size={16} className="animate-spin" />
                    {t('saving_attendance')}
                  </span>
                )}
                {saveState === 'saved' && (
                  <span className="flex items-center gap-1 text-[var(--success)]">
                    <CheckCircle2 size={16} />{t('saved')}
                  </span>
                )}
                {saveState === 'failed' && (
                  <span className="flex items-center gap-2 text-[var(--error)]">
                    <AlertTriangle size={16} />
                    {t('save_failed')}
                  </span>
                )}
              </div>
            </div>

            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm border-collapse">
                <thead className="surface-2">
                  <tr>
                    <th className="sticky-col text-start px-3 py-2 font-medium border-b border-app z-20" style={{ minWidth: 160 }}>{t('students')}</th>
                    {sortedLessons.map((l) => (
                      <th key={l.id} className="px-2 py-2 font-medium border-b border-app text-center" style={{ minWidth: 120 }}>
                        <div>{l.subject}</div>
                        <div className="text-xs text-muted font-normal">{l.start_time}-{l.end_time}</div>
                        <div className="text-xs text-muted font-normal">{l.duration_minutes}{t('minutes')}</div>
                        {l.room && <div className="text-xs font-normal" style={{ color: 'var(--primary-600)' }}>{t('room')}: {l.room}</div>}
                      </th>
                    ))}
                    <th className="px-3 py-2 font-medium border-b border-app text-center">{t('total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const total = studentTotalMinutes(s);
                    return (
                      <tr key={s.id} className="border-b border-app">
                        <td className="sticky-col px-3 py-2 font-medium border-e border-app z-10" style={{ background: 'var(--surface)' }}>
                          {s.last_name} {s.first_name}
                        </td>
                        {sortedLessons.map((l) => {
                          const key = `${s.id}__${l.id}`;
                          const status = sel[key];
                          const isAbsent = status === 'absent';
                          const isExcused = status === 'excused';
                          return (
                            <td key={l.id} className="px-2 py-2 text-center border-e border-app">
                              <div className="flex flex-col items-center gap-1">
                                <button
                                  onClick={() => toggle(s.id, l)}
                                  className="w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold transition-all"
                                  style={isAbsent
                                    ? { background: 'var(--error)', color: 'white', boxShadow: '0 0 0 2px color-mix(in srgb, var(--error) 30%, transparent)' }
                                    : isExcused
                                      ? { background: 'color-mix(in srgb, var(--warning) 18%, transparent)', color: 'var(--warning)' }
                                      : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}
                                  title={isAbsent ? t('absent') : isExcused ? t('excused') : t('present')}
                                >
                                  {isAbsent ? 'X' : isExcused ? 'E' : '✓'}
                                </button>
                                <div className="flex gap-1">
                                  <button onClick={() => setStatus(s.id, l, 'present')} className="text-[10px] px-1.5 rounded" style={{ background: 'var(--surface-2)' }} title={t('present')}>{t('present').slice(0, 1)}</button>
                                  <button onClick={() => setStatus(s.id, l, 'excused')} className="text-[10px] px-1.5 rounded" style={{ background: 'color-mix(in srgb, var(--warning) 14%, transparent)', color: 'var(--warning)' }} title={t('excused')}>{t('excused').slice(0, 1)}</button>
                                </div>
                                {isAbsent && (
                                  <button
                                    onClick={() => cancelAbsence(s.id, l)}
                                    className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5 font-medium"
                                    style={{ background: 'color-mix(in srgb, var(--error) 12%, transparent)', color: 'var(--error)' }}
                                    title={t('cancel_absence')}
                                  >
                                    <Undo2 size={10} />
                                    {t('cancel_absence')}
                                  </button>
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-center font-bold" style={{ color: total > 0 ? 'var(--error)' : 'var(--text-muted)' }}>
                          {Math.floor(total / 60)}h {total % 60}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
    </div>
  );
}
