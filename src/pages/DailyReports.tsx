import { useEffect, useState, useMemo } from 'react';
import { ChevronRight, ChevronLeft, FileText, Printer } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { EmptyState, Spinner } from '@/components/ui';
import { isoDate, monthLabel, formatDate, timeToMinutes } from '@/lib/utils';
import type { ClassRow, AttendanceRecord, Student } from '@/lib/types';

interface ConsolidatedRow {
  studentId: string;
  classId: string;
  studentName: string;
  className: string;
  lessons: { subject: string; startTime: string; endTime: string; duration: number }[];
  totalMinutes: number;
}

export default function DailyReports() {
  const { t, lang } = useI18n();
  const { profile, assignedClassIds } = useAuth();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selClass, setSelClass] = useState('all');
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [students, setStudents] = useState<Record<string, Student>>({});
  const [classesMap, setClassesMap] = useState<Record<string, ClassRow>>({});
  const [loading, setLoading] = useState(true);
  const [selDate, setSelDate] = useState<string | null>(null);

  const isAdmin = profile?.role === 'admin';
  const instId = profile?.institution_id;

  useEffect(() => {
    (async () => {
      if (!instId) return;
      const { data: cls } = await supabase.from('classes').select('*').eq('institution_id', instId);
      const cl = ((cls ?? []) as ClassRow[]).filter((c) => isAdmin || assignedClassIds.has(c.id));
      setClasses(cl);
      const map: Record<string, ClassRow> = {};
      cl.forEach((c) => map[c.id] = c);
      setClassesMap(map);
    })();
  }, [instId, isAdmin, assignedClassIds]);

  async function loadMonth() {
    if (!instId) return;
    setLoading(true);
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const to = new Date(year, month + 1, 0);
    const toIso = isoDate(to);
    let q = supabase.from('attendance_records').select('*').eq('institution_id', instId).eq('status', 'absent').gte('record_date', from).lte('record_date', toIso);
    if (selClass !== 'all') q = q.eq('class_id', selClass);
    const { data } = await q;
    setRecords((data ?? []) as AttendanceRecord[]);

    const stuIds = Array.from(new Set((data ?? []).map((r) => r.student_id)));
    if (stuIds.length) {
      const { data: stus } = await supabase.from('students').select('*').in('id', stuIds);
      const smap: Record<string, Student> = {};
      (stus ?? []).forEach((s) => smap[s.id] = s as Student);
      setStudents(smap);
    } else setStudents({});
    setLoading(false);
  }

  useEffect(() => { loadMonth(); }, [instId, year, month, selClass]);

  const datesWithRecords = new Set(records.map((r) => r.record_date));
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  const consolidatedRows = useMemo<ConsolidatedRow[]>(() => {
    if (!selDate) return [];
    const dateRecords = records.filter((r) => r.record_date === selDate);

    const grouped = new Map<string, ConsolidatedRow>();
    const seenLessonKeys = new Set<string>();

    for (const r of dateRecords) {
      const groupKey = `${r.student_id}__${r.class_id}`;
      let row = grouped.get(groupKey);
      if (!row) {
        const s = students[r.student_id];
        row = {
          studentId: r.student_id,
          classId: r.class_id,
          studentName: s ? `${s.last_name} ${s.first_name}` : '—',
          className: classesMap[r.class_id]?.name ?? '—',
          lessons: [],
          totalMinutes: 0,
        };
        grouped.set(groupKey, row);
      }

      // Deduplicate by lesson_id or by subject+time combination
      const lessonKey = r.lesson_id ?? `${r.subject_snapshot}__${r.start_time_snapshot}__${r.end_time_snapshot}`;
      const dedupKey = `${groupKey}__${lessonKey}`;
      if (seenLessonKeys.has(dedupKey)) continue;
      seenLessonKeys.add(dedupKey);

      row.lessons.push({
        subject: r.subject_snapshot,
        startTime: r.start_time_snapshot,
        endTime: r.end_time_snapshot,
        duration: r.duration_minutes_snapshot,
      });
      row.totalMinutes += r.duration_minutes_snapshot;
    }

    // Sort lessons by start time within each row
    for (const row of grouped.values()) {
      row.lessons.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }

    return [...grouped.values()].sort((a, b) => a.studentName.localeCompare(b.studentName));
  }, [selDate, records, students, classesMap]);

  const formatHours = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m} ${t('minutes')}`;
    if (m === 0) return `${h} ${h === 1 ? t('hour') : t('hours')}`;
    return `${h} ${h === 1 ? t('hour') : t('hours')} ${m} ${t('minutes')}`;
  };

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); };

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">{t('class')}</label>
          <select className="input min-w-[160px]" value={selClass} onChange={(e) => setSelClass(e.target.value)}>
            <option value="all">{t('classes')}</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 ms-auto">
          <button onClick={prevMonth} className="btn btn-ghost p-2">{lang === 'ar' ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}</button>
          <span className="font-semibold min-w-[140px] text-center">{monthLabel(year, month, lang)}</span>
          <button onClick={nextMonth} className="btn btn-ghost p-2">{lang === 'ar' ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}</button>
        </div>
      </div>

      {loading ? <Spinner label={t('loading')} /> : (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="card">
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted mb-2">
              {(lang === 'ar' ? ['أحد','إثن','ثلا','أرب','خمي','جمع','سبت'] : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']).map((d) => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const d = i + 1;
                const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const has = datesWithRecords.has(iso);
                const isSel = selDate === iso;
                return (
                  <button
                    key={iso}
                    onClick={() => setSelDate(iso)}
                    className="aspect-square rounded-lg text-sm transition relative"
                    style={isSel
                      ? { background: 'var(--primary-600)', color: 'white' }
                      : has
                        ? { background: 'color-mix(in srgb, var(--error) 14%, transparent)', color: 'var(--error)', fontWeight: 600 }
                        : { background: 'var(--surface-2)' }}
                  >
                    {d}
                    {has && !isSel && <span className="absolute bottom-1 start-1 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--error)' }} />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="card">
            {!selDate ? <EmptyState icon={<FileText size={36} />} text={t('select_date')} /> :
              consolidatedRows.length === 0 ? <EmptyState text={t('no_absent_students')} /> : (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">{formatDate(selDate, lang)}</h3>
                    <button onClick={() => window.print()} className="btn btn-ghost p-2" title={t('print_report')}>
                      <Printer size={16} />
                    </button>
                  </div>
                  <div className="space-y-3 max-h-[450px] overflow-y-auto">
                    {consolidatedRows.map((row) => (
                      <div key={`${row.studentId}__${row.classId}`} className="surface-2 rounded-lg p-3 text-sm">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <span className="font-medium">{row.studentName}</span>
                            <span className="text-muted text-xs ms-2">{row.className}</span>
                          </div>
                          <span className="text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--error)' }}>
                            {t('absence_hours_total')}: {formatHours(row.totalMinutes)}
                          </span>
                        </div>
                        <div className="text-xs text-muted">
                          <span className="font-medium">{t('missed_subjects')}: </span>
                          {row.lessons.map((l, i) => (
                            <span key={i}>
                              {i > 0 && '، '}
                              {l.subject} ({l.startTime}-{l.endTime})
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
