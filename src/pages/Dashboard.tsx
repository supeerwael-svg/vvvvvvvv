import { useEffect, useState } from 'react';
import { BookOpen, Users, ClipboardCheck, AlertTriangle, Bell, CheckCircle2, XCircle, KeyRound, Clock, DoorOpen } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { isoDate, weekDayOf } from '@/lib/utils';
import { StatCard, EmptyState, Spinner, Badge } from '@/components/ui';
import type { PageKey } from '@/components/Layout';
import type { AuditEvent, Lesson } from '@/lib/types';

export default function Dashboard({ setPage }: { setPage: (p: PageKey) => void }) {
  const { t, lang } = useI18n();
  const { profile, institution } = useAuth();
  const [stats, setStats] = useState({ classes: 0, students: 0, todayAbsences: 0, openEpisodes: 0 });
  const [loading, setLoading] = useState(true);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [totalRooms, setTotalRooms] = useState(0);
  const [vacantSlots, setVacantSlots] = useState<{ slot: string; occupied: number; vacant: number }[]>([]);
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    (async () => {
      if (!profile?.institution_id) { setLoading(false); return; }
      const today = isoDate(new Date());

      const { data: classes } = await supabase.from('classes').select('id').eq('institution_id', profile.institution_id).eq('archived', false);
      const classIds = (classes ?? []).map((c) => c.id);
      if (classIds.length === 0) { setStats({ classes: 0, students: 0, todayAbsences: 0, openEpisodes: 0 }); setLoading(false); return; }

      const { count: studentCount } = await supabase.from('students').select('*', { count: 'exact', head: true }).in('class_id', classIds).eq('archived', false);
      const { count: todayAbs } = await supabase.from('attendance_records').select('*', { count: 'exact', head: true }).in('class_id', classIds).eq('record_date', today).eq('status', 'absent');
      const { count: episodes } = await supabase.from('absence_episodes').select('*', { count: 'exact', head: true }).in('class_id', classIds).eq('status', 'open');

      setStats({
        classes: classIds.length,
        students: studentCount ?? 0,
        todayAbsences: todayAbs ?? 0,
        openEpisodes: episodes ?? 0,
      });
      setLoading(false);

      // Load total rooms and compute vacant rooms for today
      if (profile.institution_id) {
        const { data: iSet } = await supabase.from('institution_settings').select('total_rooms').eq('institution_id', profile.institution_id).maybeSingle();
        const rooms = (iSet as { total_rooms?: number } | null)?.total_rooms ?? 0;
        setTotalRooms(rooms);
        if (rooms > 0 && classIds.length > 0) {
          const wd = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date().getDay()];
          const { data: todaysLessons } = await supabase.from('lessons').select('start_time,end_time,room').in('class_id', classIds).eq('week_day', wd);
          const lessons = (todaysLessons ?? []) as Pick<Lesson, 'start_time' | 'end_time' | 'room'>[];
          const slotMap = new Map<string, Set<string>>();
          for (const l of lessons) {
            if (!l.room) continue;
            const key = `${l.start_time}-${l.end_time}`;
            if (!slotMap.has(key)) slotMap.set(key, new Set());
            slotMap.get(key)!.add(l.room);
          }
          const slots = [...slotMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([slot, roomsSet]) => ({
            slot,
            occupied: roomsSet.size,
            vacant: Math.max(0, rooms - roomsSet.size),
          }));
          setVacantSlots(slots);
        }
      }
    })();
  }, [profile]);

  useEffect(() => {
    if (!profile?.institution_id || !isAdmin) { setAuditLoading(false); return; }
    (async () => {
      const { data } = await supabase
        .from('audit_events')
        .select('*')
        .eq('institution_id', profile.institution_id)
        .in('action', ['approve_join_request', 'reject_join_request', 'regenerate_joining_code'])
        .order('created_at', { ascending: false })
        .limit(20);
      setAuditEvents((data ?? []) as AuditEvent[]);
      setAuditLoading(false);
    })();
  }, [profile, isAdmin]);

  const formatAuditTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(lang === 'ar' ? 'ar-DZ' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
  };

  const auditIcon = (action: string) => {
    if (action === 'approve_join_request') return <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />;
    if (action === 'reject_join_request') return <XCircle size={18} style={{ color: 'var(--error)' }} />;
    return <KeyRound size={18} style={{ color: 'var(--primary-600)' }} />;
  };

  const auditLabel = (action: string) => {
    if (action === 'approve_join_request') return t('notif_approved');
    if (action === 'reject_join_request') return t('notif_rejected');
    if (action === 'regenerate_joining_code') return t('notif_code_regenerated');
    return action;
  };

  const today = new Date();
  const wd = weekDayOf(today);

  return (
    <div className="space-y-6">
      <div className="card flex items-center gap-4">
        <Flag />
        <div>
          <div className="text-xs text-muted">{t('ministry')}</div>
          <div className="text-xl font-bold">{t('app_name')}</div>
          <div className="text-sm text-muted">{institution?.name}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <button onClick={() => setPage('classes')} className="text-start">
          <StatCard label={t('classes')} value={loading ? '…' : stats.classes} icon={<BookOpen size={22} />} accent="#0e7490" />
        </button>
        <button onClick={() => setPage('students')} className="text-start">
          <StatCard label={t('students')} value={loading ? '…' : stats.students} icon={<Users size={22} />} accent="#15803d" />
        </button>
        <button onClick={() => setPage('attendance')} className="text-start">
          <StatCard label={t('today') + ' — ' + t('absent_lessons')} value={loading ? '…' : stats.todayAbsences} icon={<ClipboardCheck size={22} />} accent="#b45309" />
        </button>
        <button onClick={() => setPage('absence_followup')} className="text-start">
          <StatCard label={t('episodes')} value={loading ? '…' : stats.openEpisodes} icon={<AlertTriangle size={22} />} accent="#b91c1c" />
        </button>
      </div>

      {totalRooms > 0 && vacantSlots.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <DoorOpen size={20} style={{ color: 'var(--primary-600)' }} />
            <h3 className="font-semibold">{t('vacant_rooms')}</h3>
            <span className="text-xs text-muted ms-2">{t('today')}: {today.toLocaleDateString('ar-DZ')}</span>
          </div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {vacantSlots.map((s) => (
              <div key={s.slot} className="flex items-center justify-between surface-2 rounded-lg px-3 py-2 text-sm">
                <span className="font-medium">{s.slot}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted">{t('occupied')}: {s.occupied}</span>
                  <span className="text-xs font-bold" style={{ color: s.vacant > 0 ? 'var(--success)' : 'var(--error)' }}>
                    {t('vacant')}: {s.vacant}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="font-semibold mb-3">{t('daily_attendance')}</h3>
          <p className="text-sm text-muted mb-4">{t('today')}: {today.toLocaleDateString('ar-DZ')}</p>
          <button onClick={() => setPage('attendance')} className="btn btn-primary">{t('daily_attendance')}</button>
        </div>
        <div className="card">
          <h3 className="font-semibold mb-3">{t('monthly_reports')}</h3>
          {stats.classes === 0 && !loading ? (
            <EmptyState text={t('empty')} />
          ) : (
            <button onClick={() => setPage('monthly_reports')} className="btn btn-primary">{t('monthly_reports')}</button>
          )}
        </div>
      </div>

      {isAdmin && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Bell size={20} style={{ color: 'var(--primary-600)' }} />
            <h3 className="font-semibold">{t('notification_history')}</h3>
          </div>
          {auditLoading ? (
            <Spinner label={t('loading')} />
          ) : auditEvents.length === 0 ? (
            <EmptyState icon={<Bell size={32} />} text={t('no_notifications')} />
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {auditEvents.map((ev) => {
                const detail = ev.detail ?? {};
                const email = typeof detail.email === 'string' ? detail.email : null;
                return (
                  <div key={ev.id} className="flex items-start gap-3 surface-2 rounded-lg p-3">
                    <div className="shrink-0 mt-0.5">{auditIcon(ev.action)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{auditLabel(ev.action)}</div>
                      {email && <div className="text-xs text-muted truncate">{email}</div>}
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted">
                        <Clock size={12} />
                        <span>{formatAuditTime(ev.created_at)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Flag() {
  return (
    <div className="w-14 h-10 rounded overflow-hidden shadow shrink-0 flex items-center justify-center" style={{ background: 'linear-gradient(to right, #006233 50%, #ffffff 50%)' }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="#d21034">
        <path d="M12 2a9 9 0 100 20 7 7 0 110-14 5 5 0 110 10 3 3 0 110-6 1 1 0 110 2 1 1 0 100 2 3 3 0 100-4 5 5 0 100 8 7 7 0 110-12 9 9 0 0112 8z" />
      </svg>
    </div>
  );
}
