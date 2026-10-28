import { useEffect, useState } from 'react';
import { BarChart3, Users } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { EmptyState, Spinner } from '@/components/ui';
import type { ClassRow, Student } from '@/lib/types';

export default function StudentStats() {
  const { t } = useI18n();
  const { profile, assignedClassIds } = useAuth();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [stats, setStats] = useState<Record<string, { total: number; male: number; female: number; halfBoard: number; external: number; day: number; boarder: number }>>({});
  const [loading, setLoading] = useState(true);

  const isAdmin = profile?.role === 'admin';
  const instId = profile?.institution_id;

  useEffect(() => {
    (async () => {
      if (!instId) return;
      const { data: cls } = await supabase.from('classes').select('*').eq('institution_id', instId).eq('archived', false).order('name');
      const cl = ((cls ?? []) as ClassRow[]).filter((c) => isAdmin || assignedClassIds.has(c.id));
      setClasses(cl);
      const s: Record<string, typeof stats[string]> = {};
      for (const c of cl) {
        const { data } = await supabase.from('students').select('*').eq('class_id', c.id).eq('archived', false);
        const stus = (data ?? []) as Student[];
        s[c.id] = {
          total: stus.length,
          male: stus.filter((x) => x.gender === 'male').length,
          female: stus.filter((x) => x.gender === 'female').length,
          halfBoard: stus.filter((x) => x.boarding === 'half_board').length,
          external: stus.filter((x) => x.boarding === 'external').length,
          day: stus.filter((x) => x.boarding === 'day').length,
          boarder: stus.filter((x) => x.boarding === 'boarder').length,
        };
      }
      setStats(s);
      setLoading(false);
    })();
  }, [instId, isAdmin, assignedClassIds]);

  const totals = Object.values(stats).reduce((acc, s) => ({
    total: acc.total + s.total, male: acc.male + s.male, female: acc.female + s.female,
    halfBoard: acc.halfBoard + s.halfBoard, external: acc.external + s.external,
    day: acc.day + s.day, boarder: acc.boarder + s.boarder,
  }), { total: 0, male: 0, female: 0, halfBoard: 0, external: 0, day: 0, boarder: 0 });

  return (
    <div className="space-y-4">
      {loading ? <Spinner label={t('loading')} /> : classes.length === 0 ? (
        <div className="card"><EmptyState icon={<Users size={40} />} text={t('empty')} /></div>
      ) : (
        <>
          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <BarChart3 size={22} className="text-[var(--primary-700)]" />
              <h3 className="font-semibold">{t('student_stats')}</h3>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label={t('count')} value={totals.total} />
              <Stat label={t('male_count')} value={totals.male} />
              <Stat label={t('female_count')} value={totals.female} />
              <Stat label={t('half_board')} value={totals.halfBoard} />
              <Stat label={t('external')} value={totals.external} />
              <Stat label={t('day')} value={totals.day} />
              <Stat label={t('boarder')} value={totals.boarder} />
            </div>
          </div>

          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="surface-2 text-muted">
                <tr>
                  <th className="text-start px-3 py-2 font-medium">{t('class')}</th>
                  <th className="text-start px-3 py-2 font-medium">{t('count')}</th>
                  <th className="text-start px-3 py-2 font-medium">{t('male_count')}</th>
                  <th className="text-start px-3 py-2 font-medium">{t('female_count')}</th>
                  <th className="text-start px-3 py-2 font-medium">{t('half_board')}</th>
                  <th className="text-start px-3 py-2 font-medium">{t('external')}</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((c) => {
                  const s = stats[c.id] ?? { total: 0, male: 0, female: 0, halfBoard: 0, external: 0, day: 0, boarder: 0 };
                  return (
                    <tr key={c.id} className="border-t border-app">
                      <td className="px-3 py-2 font-medium">{c.name}</td>
                      <td className="px-3 py-2">{s.total}</td>
                      <td className="px-3 py-2">{s.male}</td>
                      <td className="px-3 py-2">{s.female}</td>
                      <td className="px-3 py-2">{s.halfBoard}</td>
                      <td className="px-3 py-2">{s.external}</td>
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface-2 rounded-lg p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}
