import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { EmptyState, Spinner } from '@/components/ui';
import { monthLabel, isoDate } from '@/lib/utils';
import { DEFAULT_WORKING_DAYS, type ClassRow, type Student, type AttendanceRecord, type WeekDay } from '@/lib/types';

export default function MonthlyReports() {
  const { t, lang } = useI18n();
  const { profile, assignedClassIds } = useAuth();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selClass, setSelClass] = useState('');
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<{
    className: string;
    studentCount: number;
    scheduledHours: number;
    absenceMinutes: number;
    absenceHours: number;
    percentage: number;
    numerator: number;
    denominator: number;
    male: number; female: number;
    halfBoard: number; external: number; day: number; boarder: number;
  } | null>(null);

  const isAdmin = profile?.role === 'admin';
  const instId = profile?.institution_id;

  useEffect(() => {
    (async () => {
      if (!instId) return;
      const { data } = await supabase.from('classes').select('*').eq('institution_id', instId).eq('archived', false).order('name');
      const cl = ((data ?? []) as ClassRow[]).filter((c) => isAdmin || assignedClassIds.has(c.id));
      setClasses(cl);
      if (cl.length && !selClass) setSelClass(cl[0].id);
    })();
  }, [instId, isAdmin, assignedClassIds]);

  async function compute() {
    if (!selClass || !instId) return;
    setLoading(true);
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const toIso = isoDate(new Date(year, month + 1, 0));

    // working days in month
    const days: Date[] = [];
    for (let d = 1; d <= new Date(year, month + 1, 0).getDate(); d++) {
      const dt = new Date(year, month, d);
      const wd = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][dt.getDay()] as WeekDay;
      if (DEFAULT_WORKING_DAYS.includes(wd)) days.push(dt);
    }

    // lessons per week for this class grouped by weekday
    const { data: lessons } = await supabase.from('lessons').select('*').eq('class_id', selClass);
    const les = (lessons ?? []) as { week_day: WeekDay; duration_minutes: number }[];
    const minutesPerWeekday: Record<string, number> = {};
    for (const l of les) minutesPerWeekday[l.week_day] = (minutesPerWeekday[l.week_day] ?? 0) + l.duration_minutes;
    const weeklyMinutes = Object.values(minutesPerWeekday).reduce((a, b) => a + b, 0);
    // scheduled minutes per student for the month = sum over working days of that weekday's minutes
    let schedMinutesPerStudent = 0;
    for (const dt of days) {
      const wd = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][dt.getDay()] as WeekDay;
      schedMinutesPerStudent += minutesPerWeekday[wd] ?? 0;
    }

    // students enrolled in this class (non-archived)
    const { data: stus } = await supabase.from('students').select('*').eq('class_id', selClass).eq('archived', false);
    const students = (stus ?? []) as Student[];
    const studentCount = students.length;

    // absence records in month
    const { data: atts } = await supabase.from('attendance_records').select('*').eq('class_id', selClass).gte('record_date', from).lte('record_date', toIso).eq('status', 'absent');
    const absenceRecords = (atts ?? []) as AttendanceRecord[];
    const absenceMinutes = absenceRecords.reduce((s, r) => s + r.duration_minutes_snapshot, 0);

    const numerator = absenceMinutes;
    const denominator = studentCount * schedMinutesPerStudent;
    const percentage = denominator > 0 ? (numerator / denominator) * 100 : 0;

    const male = students.filter((s) => s.gender === 'male').length;
    const female = students.filter((s) => s.gender === 'female').length;
    const boarding = (b: string) => students.filter((s) => s.boarding === b).length;

    const cls = classes.find((c) => c.id === selClass);
    setReport({
      className: cls?.name ?? '',
      studentCount,
      scheduledHours: schedMinutesPerStudent / 60,
      absenceMinutes,
      absenceHours: absenceMinutes / 60,
      percentage,
      numerator: numerator / 60,
      denominator: denominator / 60,
      male, female,
      halfBoard: boarding('half_board'), external: boarding('external'), day: boarding('day'), boarder: boarding('boarder'),
    });
    setLoading(false);
  }

  useEffect(() => { compute(); }, [selClass, year, month]);

  const months = Array.from({ length: 12 }, (_, i) => i);

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">{t('class')}</label>
          <select className="input min-w-[160px]" value={selClass} onChange={(e) => setSelClass(e.target.value)}>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('month')}</label>
          <select className="input min-w-[140px]" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(year, m, lang)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">السنة</label>
          <input type="number" className="input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        </div>
      </div>

      {!selClass ? <div className="card"><EmptyState text={t('empty')} /></div> :
        loading ? <Spinner label={t('loading')} /> : report ? (
          <div className="space-y-4">
            <div className="card">
              <h3 className="font-semibold mb-1">{report.className} — {monthLabel(year, month, lang)}</h3>
              <p className="text-xs text-muted mb-4">{t('monthly_class_report')}</p>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <Stat label={t('student_count')} value={report.studentCount} />
                <Stat label={t('scheduled_hours')} value={report.scheduledHours.toFixed(2)} />
                <Stat label={t('absence_hours')} value={report.absenceHours.toFixed(2)} />
                <Stat label={t('absence_percentage')} value={`${report.percentage.toFixed(2)}%`} highlight />
              </div>

              <div className="surface-2 rounded-lg p-4 text-sm font-mono" dir="ltr">
                <div>{t('absence_percentage')} = ({t('numerator')} × 100) / ({t('denominator')})</div>
                <div className="mt-1">{t('numerator')} = {report.numerator.toFixed(2)} h (total absence)</div>
                <div>{t('denominator')} = {report.scheduledHours.toFixed(2)} h × {report.studentCount} = {report.denominator.toFixed(2)} h</div>
                <div className="mt-1 font-bold">= {report.percentage.toFixed(2)}%</div>
                {report.denominator === 0 && <div className="text-[var(--warning)] mt-1">denominator = 0 (no students or no scheduled hours)</div>}
              </div>
            </div>

            <div className="card">
              <h3 className="font-semibold mb-3">{t('students')} — {t('count')}</h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label={t('male_count')} value={report.male} />
                <Stat label={t('female_count')} value={report.female} />
                <Stat label={t('half_board')} value={report.halfBoard} />
                <Stat label={t('external')} value={report.external} />
                <Stat label={t('day')} value={report.day} />
                <Stat label={t('boarder')} value={report.boarder} />
              </div>
            </div>
          </div>
        ) : null}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="surface-2 rounded-lg p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-xl font-bold" style={highlight ? { color: 'var(--primary-700)' } : undefined}>{value}</div>
    </div>
  );
}
