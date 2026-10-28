import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { EmptyState, Spinner, Badge } from '@/components/ui';
import { formatDate, weekDayOf } from '@/lib/utils';
import { DEFAULT_WORKING_DAYS, type ClassRow, type Student, type AttendanceRecord, type AbsenceEpisode } from '@/lib/types';

export default function AbsenceFollowup() {
  const { t, lang } = useI18n();
  const { profile, assignedClassIds } = useAuth();
  const [episodes, setEpisodes] = useState<(AbsenceEpisode & { student?: Student; className?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);

  const isAdmin = profile?.role === 'admin';
  const instId = profile?.institution_id;

  async function load() {
    if (!instId) return;
    setLoading(true);
    const { data } = await supabase.from('absence_episodes').select('*').eq('institution_id', instId).order('start_date', { ascending: false });
    const eps = ((data ?? []) as AbsenceEpisode[]).filter((e) => isAdmin || assignedClassIds.has(e.class_id));
    const stuIds = Array.from(new Set(eps.map((e) => e.student_id)));
    const clsIds = Array.from(new Set(eps.map((e) => e.class_id)));
    const [stuRes, clsRes] = await Promise.all([
      stuIds.length ? supabase.from('students').select('*').in('id', stuIds) : Promise.resolve({ data: [] }),
      clsIds.length ? supabase.from('classes').select('*').in('id', clsIds) : Promise.resolve({ data: [] }),
    ]);
    const stuMap: Record<string, Student> = {};
    (stuRes.data ?? []).forEach((s) => stuMap[s.id] = s as Student);
    const clsMap: Record<string, ClassRow> = {};
    (clsRes.data ?? []).forEach((c) => clsMap[c.id] = c as ClassRow);
    setEpisodes(eps.map((e) => ({ ...e, student: stuMap[e.student_id], className: clsMap[e.class_id]?.name })));
    setLoading(false);
  }

  useEffect(() => { load(); }, [instId]);

  // Recalculate episodes from attendance records
  async function recalculate() {
    if (!instId) return;
    setComputing(true);
    // fetch all classes for institution
    const { data: cls } = await supabase.from('classes').select('id').eq('institution_id', instId);
    const classIds = (cls ?? []).map((c) => c.id).filter((id) => isAdmin || assignedClassIds.has(id));
    if (classIds.length === 0) { setComputing(false); return; }

    // fetch settings
    const { data: set } = await supabase.from('institution_settings').select('*').eq('institution_id', instId).maybeSingle();
    const firstN = set?.first_notice_days ?? 4;
    const secondN = set?.second_notice_days ?? 10;
    const prolongedN = set?.prolonged_notice_days ?? 18;

    // fetch all absence records (status absent) for these classes
    const { data: atts } = await supabase.from('attendance_records').select('student_id,class_id,record_date').in('class_id', classIds).eq('status', 'absent');
    const records = (atts ?? []) as { student_id: string; class_id: string; record_date: string }[];

    // group by student -> set of dates
    const byStudent: Record<string, { dates: Set<string>; class_id: string }> = {};
    for (const r of records) {
      if (!byStudent[r.student_id]) byStudent[r.student_id] = { dates: new Set(), class_id: r.class_id };
      byStudent[r.student_id].dates.add(r.record_date);
    }

    // For each student with absences, build consecutive working-day episodes
    const newEpisodes: { student_id: string; class_id: string; start_date: string; end_date: string | null; consecutive_absent_days: number; first_notice_date: string | null; second_notice_date: string | null; prolonged_notice_date: string | null }[] = [];
    for (const [studentId, info] of Object.entries(byStudent)) {
      const dates = Array.from(info.dates).sort();
      // walk through dates; consecutive working-day absence means each next working day after an absent day is also absent
      // Build sequences: a break in consecutive working days closes an episode
      let seqStart: string | null = null;
      let seqDates: string[] = [];
      const allDays = dates;
      for (let i = 0; i < allDays.length; i++) {
        if (seqStart === null) { seqStart = allDays[i]; seqDates = [allDays[i]]; continue; }
        const prev = new Date(allDays[i - 1]);
        let cur = new Date(prev);
        // find next working day
        do { cur.setDate(cur.getDate() + 1); } while (!DEFAULT_WORKING_DAYS.includes(weekDayOf(cur) as any));
        if (cur.toISOString().slice(0, 10) === allDays[i]) {
          seqDates.push(allDays[i]);
        } else {
          // close episode
          newEpisodes.push(buildEpisode(studentId, info.class_id, seqDates, firstN, secondN, prolongedN));
          seqStart = allDays[i]; seqDates = [allDays[i]];
        }
      }
      if (seqStart !== null) newEpisodes.push(buildEpisode(studentId, info.class_id, seqDates, firstN, secondN, prolongedN));
    }

    // replace episodes: delete existing, insert new
    await supabase.from('absence_episodes').delete().in('class_id', classIds);
    if (newEpisodes.length) {
      await supabase.from('absence_episodes').insert(newEpisodes.map((e) => ({ ...e, institution_id: instId, status: e.end_date ? 'closed' : 'open' })));
    }
    setComputing(false);
    load();
  }

  function buildEpisode(studentId: string, classId: string, dates: string[], firstN: number, secondN: number, prolongedN: number) {
    const start = dates[0];
    const end = dates.length > 1 ? dates[dates.length - 1] : null;
    const count = dates.length;
    const first = count >= firstN ? dates[firstN - 1] : null;
    const second = count >= secondN ? dates[secondN - 1] : null;
    const prolonged = count >= prolongedN ? dates[prolongedN - 1] : null;
    return { student_id: studentId, class_id: classId, start_date: start, end_date: end, consecutive_absent_days: count, first_notice_date: first, second_notice_date: second, prolonged_notice_date: prolonged };
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted">{t('absence_followup')}</p>
        <button onClick={recalculate} disabled={computing} className="btn btn-primary">
          {computing ? t('loading') : t('save')}
        </button>
      </div>

      {loading ? <Spinner label={t('loading')} /> : episodes.length === 0 ? (
        <div className="card"><EmptyState icon={<AlertTriangle size={40} />} text={t('no_episodes')} /></div>
      ) : (
        <div className="space-y-2">
          {episodes.map((e) => (
            <div key={e.id} className="card">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-semibold">{e.student ? `${e.student.last_name} ${e.student.first_name}` : '—'}</div>
                  <div className="text-xs text-muted">{e.className}</div>
                </div>
                <Badge color={e.status === 'open' ? 'warning' : 'neutral'}>{e.status === 'open' ? t('open') : t('closed')}</Badge>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3 text-sm">
                <Field label={t('episode_start')} value={formatDate(e.start_date, lang)} />
                <Field label={t('consecutive_days')} value={String(e.consecutive_absent_days)} />
                <Field label={t('first_notice')} value={e.first_notice_date ? formatDate(e.first_notice_date, lang) : '—'} />
                <Field label={t('second_notice')} value={e.second_notice_date ? formatDate(e.second_notice_date, lang) : '—'} />
                <Field label={t('prolonged_notice')} value={e.prolonged_notice_date ? formatDate(e.prolonged_notice_date, lang) : '—'} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div className="surface-2 rounded-lg px-3 py-2"><div className="text-xs text-muted">{label}</div><div className="font-medium">{value}</div></div>;
}
