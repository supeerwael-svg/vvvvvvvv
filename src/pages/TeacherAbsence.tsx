import { useEffect, useState, useCallback, useMemo } from 'react';
import { UserMinus, Plus, Pencil, Trash2, Search, Undo2, Ban, CalendarClock } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { localGetAll, localBulkPut } from '@/lib/offline-db';
import { writeThrough, deleteThrough } from '@/lib/sync';
import { Modal, EmptyState, Spinner, ConfirmDialog, Badge } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import type { ClassRow, TeacherAbsence } from '@/lib/types';

const TIMES: string[] = (() => {
  const out: string[] = [];
  for (let h = 7; h <= 18; h++) for (const m of ['00', '30']) out.push(`${String(h).padStart(2, '0')}:${m}`);
  return out;
})();

export default function TeacherAbsencePage() {
  const { t } = useI18n();
  const { profile, assignedClassIds } = useAuth();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [records, setRecords] = useState<TeacherAbsence[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [modal, setModal] = useState<{ open: boolean; edit?: TeacherAbsence }>({ open: false });
  const [form, setForm] = useState({
    teacher_name: '', subject: '', record_date: new Date().toISOString().slice(0, 10),
    class_id: '', start_time: '08:00', end_time: '09:00', reason: '', notes: '',
  });
  const [confirmDel, setConfirmDel] = useState<TeacherAbsence | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<TeacherAbsence | null>(null);

  const instId = profile?.institution_id;
  const isAdmin = profile?.role === 'admin';

  const load = useCallback(async () => {
    if (!instId) return;
    setLoading(true);

    // Load from local cache first (offline-first)
    const localClasses = (await localGetAll<ClassRow>('classes')).filter((c) => c.institution_id === instId && (isAdmin || assignedClassIds.has(c.id))).sort((a, b) => a.name.localeCompare(b.name));
    setClasses(localClasses);
    const localRecords = (await localGetAll<TeacherAbsence>('teacher_absences'))
      .filter((r) => r.institution_id === instId)
      .sort((a, b) => b.record_date.localeCompare(a.record_date));
    setRecords(localRecords);
    setLoading(false);

    // Refresh from Supabase in background
    try {
      const [clsRes, res] = await Promise.all([
        supabase.from('classes').select('*').eq('institution_id', instId).order('name'),
        supabase.from('teacher_absences').select('*').eq('institution_id', instId).order('record_date', { ascending: false }),
      ]);
      const cls = (clsRes.data ?? []) as ClassRow[];
      const data = (res.data ?? []) as TeacherAbsence[];
      if (cls.length) { const visible = cls.filter((c) => isAdmin || assignedClassIds.has(c.id)); setClasses(visible); await localBulkPut('classes', cls); }
      if (data.length >= 0) { setRecords(data); await localBulkPut('teacher_absences', data); }
    } catch { /* offline — local data is fine */ }
  }, [instId, isAdmin, assignedClassIds]);

  useEffect(() => { load(); }, [load]);

  const filtered = records.filter((r) => {
    const matchesSearch = r.teacher_name.toLowerCase().includes(search.toLowerCase()) ||
      (r.subject ?? '').toLowerCase().includes(search.toLowerCase());
    const matchesDate = !dateFilter || r.record_date === dateFilter;
    return matchesSearch && matchesDate;
  });

  const className = (id: string | null) => classes.find((c) => c.id === id)?.name ?? '—';

  const openAdd = () => {
    setForm({ teacher_name: '', subject: '', record_date: new Date().toISOString().slice(0, 10), class_id: classes[0]?.id ?? '', start_time: '08:00', end_time: '09:00', reason: '', notes: '' });
    setModal({ open: true });
  };
  const openEdit = (r: TeacherAbsence) => {
    setForm({
      teacher_name: r.teacher_name, subject: r.subject ?? '', record_date: r.record_date,
      class_id: r.class_id ?? '', start_time: r.start_time ?? '08:00', end_time: r.end_time ?? '09:00',
      reason: r.reason ?? '', notes: r.notes ?? '',
    });
    setModal({ open: true, edit: r });
  };

  const save = async () => {
    if (!instId || !form.teacher_name.trim()) return;
    const id = modal.edit?.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const payload: TeacherAbsence = {
      id,
      institution_id: instId,
      class_id: form.class_id || null,
      teacher_name: form.teacher_name.trim(),
      subject: form.subject || null,
      record_date: form.record_date,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      reason: form.reason || null,
      notes: form.notes || null,
      status: modal.edit?.status ?? 'active',
      cancelled_by: modal.edit?.cancelled_by ?? null,
      cancelled_at: modal.edit?.cancelled_at ?? null,
      recorded_by: profile?.user_id ?? null,
      created_at: modal.edit?.created_at ?? now,
      updated_at: now,
    };
    await writeThrough('teacher_absences', 'teacher_absences', payload, modal.edit ? 'update' : 'insert');
    setModal({ open: false });
    load();
  };

  const del = async (r: TeacherAbsence) => {
    await deleteThrough('teacher_absences', 'teacher_absences', r.id);
    load();
  };

  // Cancel/undo a teacher absence — sets status to 'cancelled' (soft delete with audit trail)
  const cancelAbsence = async (r: TeacherAbsence) => {
    if (!instId) return;
    const now = new Date().toISOString();
    const payload: TeacherAbsence = {
      ...r,
      status: 'cancelled',
      cancelled_by: profile?.user_id ?? null,
      cancelled_at: now,
      updated_at: now,
    };
    await writeThrough('teacher_absences', 'teacher_absences', payload, 'update');
    setConfirmCancel(null);
    load();
  };

  // Restore a cancelled absence back to active
  const restoreAbsence = async (r: TeacherAbsence) => {
    const now = new Date().toISOString();
    const payload: TeacherAbsence = {
      ...r,
      status: 'active',
      cancelled_by: null,
      cancelled_at: null,
      updated_at: now,
    };
    await writeThrough('teacher_absences', 'teacher_absences', payload, 'update');
    load();
  };

  const activeRecords = filtered.filter((r) => r.status === 'active');
  const cancelledRecords = filtered.filter((r) => r.status === 'cancelled');

  // Per-teacher summary: group active absences by teacher name
  const teacherSummary = useMemo(() => {
    const map = new Map<string, { name: string; count: number; classes: Set<string>; lessons: Set<string>; days: Set<string> }>();
    for (const r of activeRecords) {
      const existing = map.get(r.teacher_name) ?? { name: r.teacher_name, count: 0, classes: new Set<string>(), lessons: new Set<string>(), days: new Set<string>() };
      existing.count++;
      if (r.class_id) existing.classes.add(className(r.class_id));
      if (r.subject) existing.lessons.add(r.subject);
      existing.days.add(r.record_date);
      map.set(r.teacher_name, existing);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [activeRecords]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 max-w-xs">
            <Search size={16} className="absolute inset-y-0 start-0 my-auto ms-3 text-muted" />
            <input className="input ps-9" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <input type="date" className="input max-w-[160px]" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
        </div>
        <button onClick={openAdd} className="btn btn-primary"><Plus size={18} />{t('add_teacher_absence')}</button>
      </div>

      {loading ? <Spinner label={t('loading')} /> : filtered.length === 0 ? (
        <div className="card"><EmptyState icon={<UserMinus size={40} />} text={t('empty')} /></div>
      ) : (
        <>
          {/* Per-teacher summary report */}
          {teacherSummary.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <div className="px-3 py-2 surface-2 text-sm font-semibold flex items-center gap-2">
                <UserMinus size={14} style={{ color: 'var(--error)' }} />
                {t('per_teacher_summary')}
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
                {teacherSummary.map((ts) => (
                  <div key={ts.name} className="surface-2 rounded-lg p-3 space-y-1.5">
                    <div className="font-medium text-sm flex items-center justify-between">
                      <span>{ts.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: 'color-mix(in srgb, var(--error) 15%, transparent)', color: 'var(--error)' }}>
                        {ts.count}
                      </span>
                    </div>
                    <div className="text-xs text-muted flex items-center gap-1.5">
                      <CalendarClock size={12} />
                      {t('total_absence_days')}: <span className="font-medium text-foreground">{ts.days.size}</span>
                    </div>
                    {ts.classes.size > 0 && (
                      <div className="text-xs text-muted">
                        {t('affected_classes')}: <span className="font-medium text-foreground">{[...ts.classes].join('، ')}</span>
                      </div>
                    )}
                    {ts.lessons.size > 0 && (
                      <div className="text-xs text-muted">
                        {t('affected_lessons')}: <span className="font-medium text-foreground">{[...ts.lessons].join('، ')}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active absences */}
          {activeRecords.length > 0 && (
            <div className="card overflow-x-auto p-0">
              <div className="px-3 py-2 surface-2 text-sm font-semibold flex items-center gap-2">
                <Ban size={14} style={{ color: 'var(--error)' }} />
                {t('active_absences')} ({activeRecords.length})
              </div>
              <table className="w-full text-sm">
                <thead className="surface-2 text-muted">
                  <tr>
                    <th className="text-start px-3 py-2 font-medium">{t('teacher_name')}</th>
                    <th className="text-start px-3 py-2 font-medium">{t('subject')}</th>
                    <th className="text-start px-3 py-2 font-medium">{t('class')}</th>
                    <th className="text-start px-3 py-2 font-medium">{t('date')}</th>
                    <th className="text-start px-3 py-2 font-medium">{t('reason')}</th>
                    <th className="text-start px-3 py-2 font-medium">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRecords.map((r) => (
                    <tr key={r.id} className="border-t border-app">
                      <td className="px-3 py-2 font-medium">{r.teacher_name}</td>
                      <td className="px-3 py-2">{r.subject ?? '—'}</td>
                      <td className="px-3 py-2">{className(r.class_id)}</td>
                      <td className="px-3 py-2">{formatDate(r.record_date, 'ar')}</td>
                      <td className="px-3 py-2 text-muted">{r.reason ?? '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(r)} className="btn btn-ghost p-1.5" title={t('edit')}><Pencil size={15} /></button>
                          <button onClick={() => setConfirmCancel(r)} className="btn btn-ghost p-1.5" style={{ color: 'var(--warning)' }} title={t('cancel_absence_teacher')}><Undo2 size={15} /></button>
                          {isAdmin && <button onClick={() => setConfirmDel(r)} className="btn btn-ghost p-1.5 text-[var(--error)]" title={t('delete')}><Trash2 size={15} /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Cancelled absences (collapsible) */}
          {cancelledRecords.length > 0 && (
            <details className="card overflow-x-auto p-0">
              <summary className="px-3 py-2 surface-2 text-sm font-semibold cursor-pointer flex items-center gap-2">
                <Badge color="neutral">{cancelledRecords.length}</Badge>
                {t('cancelled_absences')}
              </summary>
              <table className="w-full text-sm">
                <thead className="surface-2 text-muted">
                  <tr>
                    <th className="text-start px-3 py-2 font-medium">{t('teacher_name')}</th>
                    <th className="text-start px-3 py-2 font-medium">{t('subject')}</th>
                    <th className="text-start px-3 py-2 font-medium">{t('class')}</th>
                    <th className="text-start px-3 py-2 font-medium">{t('date')}</th>
                    <th className="text-start px-3 py-2 font-medium">{t('status')}</th>
                    <th className="text-start px-3 py-2 font-medium">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {cancelledRecords.map((r) => (
                    <tr key={r.id} className="border-t border-app opacity-60">
                      <td className="px-3 py-2 font-medium">{r.teacher_name}</td>
                      <td className="px-3 py-2">{r.subject ?? '—'}</td>
                      <td className="px-3 py-2">{className(r.class_id)}</td>
                      <td className="px-3 py-2">{formatDate(r.record_date, 'ar')}</td>
                      <td className="px-3 py-2"><Badge color="neutral">{t('cancelled')}</Badge></td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <button onClick={() => restoreAbsence(r)} className="btn btn-ghost p-1.5" style={{ color: 'var(--success)' }} title={t('restore_absence')}><Undo2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.edit ? t('edit') : t('add_teacher_absence')}>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label">{t('teacher_name')}</label>
            <input className="input" value={form.teacher_name} onChange={(e) => setForm({ ...form, teacher_name: e.target.value })} />
          </div>
          <div><label className="label">{t('subject')}</label><input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
          <div><label className="label">{t('class')}</label>
            <select className="input" value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })}>
              <option value="">—</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><label className="label">{t('date')}</label><input type="date" className="input" value={form.record_date} onChange={(e) => setForm({ ...form, record_date: e.target.value })} /></div>
          <div><label className="label">{t('start_time')}</label>
            <select className="input" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })}>{TIMES.map((tm) => <option key={tm} value={tm}>{tm}</option>)}</select>
          </div>
          <div><label className="label">{t('end_time')}</label>
            <select className="input" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })}>{TIMES.map((tm) => <option key={tm} value={tm}>{tm}</option>)}</select>
          </div>
          <div className="sm:col-span-2"><label className="label">{t('reason')}</label><input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="label">{t('notes')}</label><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={() => setModal({ open: false })} className="btn btn-ghost">{t('cancel')}</button>
          <button onClick={save} className="btn btn-primary">{t('save')}</button>
        </div>
      </Modal>

      <ConfirmDialog open={!!confirmDel} onClose={() => setConfirmDel(null)} onConfirm={() => confirmDel && del(confirmDel)}
        title={t('delete')} message={confirmDel?.teacher_name ?? ''} confirmLabel={t('delete')} danger />

      <ConfirmDialog open={!!confirmCancel} onClose={() => setConfirmCancel(null)} onConfirm={() => confirmCancel && cancelAbsence(confirmCancel)}
        title={t('cancel_absence_teacher')} message={`${t('cancel_absence_confirm')}: ${confirmCancel?.teacher_name ?? ''}`} confirmLabel={t('confirm')} />
    </div>
  );
}
