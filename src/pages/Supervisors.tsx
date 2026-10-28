import { useEffect, useState } from 'react';
import { UserCog, Plus, Trash2, RefreshCw, KeyRound, Check, X, Link as LinkIcon, Clock, CheckCircle2, XCircle, Inbox, AlertTriangle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Modal, EmptyState, Spinner, Badge } from '@/components/ui';
import type { ClassRow, Profile, ClassAssignment, JoinRequest } from '@/lib/types';

export default function Supervisors() {
  const { t } = useI18n();
  const { profile, institution, session, refreshProfile } = useAuth();
  const [supervisors, setSupervisors] = useState<Profile[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [assignments, setAssignments] = useState<ClassAssignment[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteModal, setInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', fullName: '', password: '' });
  const [assignModal, setAssignModal] = useState<Profile | null>(null);
  const [selectedClasses, setSelectedClasses] = useState<Set<string>>(new Set());
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codeModal, setCodeModal] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [tab, setTab] = useState<'supervisors' | 'requests'>('supervisors');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState<JoinRequest | null>(null);
  const [confirmReject, setConfirmReject] = useState<JoinRequest | null>(null);

  const instId = profile?.institution_id;
  const pendingCount = joinRequests.filter((r) => r.status === 'pending').length;

  async function load() {
    if (!instId) return;
    setLoading(true);
    const [pRes, cRes, aRes, jrRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('institution_id', instId),
      supabase.from('classes').select('*').eq('institution_id', instId).eq('archived', false).order('name'),
      supabase.from('class_assignments').select('*'),
      supabase.from('join_requests').select('*').eq('institution_id', instId).order('created_at', { ascending: false }),
    ]);
    setSupervisors((pRes.data ?? []) as Profile[]);
    setClasses((cRes.data ?? []) as ClassRow[]);
    setAssignments((aRes.data ?? []) as ClassAssignment[]);
    setJoinRequests((jrRes.data ?? []) as JoinRequest[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [instId]);

  const assignedClassIds = (uid: string) => new Set(assignments.filter((a) => a.profile_id === uid).map((a) => a.class_id));

  const invite = async () => {
    setBusy(true); setInviteError(null);
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 15000);
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-supervisor`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          email: inviteForm.email,
          password: inviteForm.password,
          fullName: inviteForm.fullName,
          institutionId: instId,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      const data = await res.json();
      if (!res.ok) { setInviteError(data.error || 'error'); setBusy(false); return; }
      setInviteModal(false);
      setInviteForm({ email: '', fullName: '', password: '' });
      setBusy(false);
      load();
    } catch (e) {
      setInviteError(e instanceof Error ? (e.name === 'AbortError' ? t('save_failed') : e.message) : String(e));
      setBusy(false);
    }
  };

  const openAssign = (p: Profile) => {
    setAssignModal(p);
    setSelectedClasses(assignedClassIds(p.user_id));
  };

  const toggleClass = (cid: string) => {
    setSelectedClasses((prev) => {
      const n = new Set(prev);
      if (n.has(cid)) n.delete(cid); else n.add(cid);
      return n;
    });
  };

  const saveAssign = async () => {
    if (!assignModal) return;
    const current = assignedClassIds(assignModal.user_id);
    const toAdd = [...selectedClasses].filter((c) => !current.has(c));
    const toRemove = [...current].filter((c) => !selectedClasses.has(c));
    if (toAdd.length) await supabase.from('class_assignments').insert(toAdd.map((cid) => ({ profile_id: assignModal.user_id, class_id: cid })));
    for (const cid of toRemove) await supabase.from('class_assignments').delete().eq('profile_id', assignModal.user_id).eq('class_id', cid);
    setAssignModal(null);
    load();
  };

  const toggleDisable = async (p: Profile) => {
    await supabase.from('profiles').update({ disabled: !p.disabled }).eq('user_id', p.user_id);
    load();
  };

  const regenerateCode = async () => {
    if (!instId) return;
    const { data, error } = await supabase.rpc('regenerate_joining_code', { inst: instId });
    if (!error) { setNewCode(data); refreshProfile(); }
  };

  const removeSupervisor = async (p: Profile) => {
    await supabase.from('memberships').delete().eq('user_id', p.user_id).eq('institution_id', instId);
    await supabase.from('profiles').update({ institution_id: null }).eq('user_id', p.user_id);
    load();
  };

  const doApprove = async (r: JoinRequest) => {
    setActionBusy(true); setActionError(null);
    const { error } = await supabase.rpc('approve_join_request', { p_request_id: r.id });
    setActionBusy(false);
    if (error) {
      setActionError(error.message);
    } else {
      setConfirmApprove(null);
      load();
    }
  };

  const doReject = async (r: JoinRequest) => {
    setActionBusy(true); setActionError(null);
    const { error } = await supabase.rpc('reject_join_request', { p_request_id: r.id });
    setActionBusy(false);
    if (error) {
      setActionError(error.message);
    } else {
      setConfirmReject(null);
      load();
    }
  };

  const statusBadge = (status: string) => {
    if (status === 'pending') return <Badge color="warning"><Clock size={12} className="inline" /> {t('join_request_pending')}</Badge>;
    if (status === 'accepted') return <Badge color="success"><CheckCircle2 size={12} className="inline" /> {t('join_request_accepted')}</Badge>;
    return <Badge color="error"><XCircle size={12} className="inline" /> {t('join_request_rejected')}</Badge>;
  };

  return (
    <div className="space-y-4">
      {actionError && (
        <div className="rounded-lg px-4 py-3 text-sm flex items-start gap-2" style={{ background: 'color-mix(in srgb, var(--error) 12%, transparent)', color: 'var(--error)' }}>
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      <div className="flex gap-2 items-center">
        <button onClick={() => setTab('supervisors')} className={`btn ${tab === 'supervisors' ? 'btn-primary' : 'btn-ghost'}`}>
          <UserCog size={16} />{t('supervisors')}
        </button>
        <button onClick={() => setTab('requests')} className={`btn ${tab === 'requests' ? 'btn-primary' : 'btn-ghost'} relative`}>
          <Inbox size={16} />{t('join_requests')}
          {pendingCount > 0 && (
            <span className="absolute -top-1 -end-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: 'var(--error)' }}>
              {pendingCount}
            </span>
          )}
        </button>
        <div className="ms-auto flex gap-2">
          <button onClick={() => setCodeModal(true)} className="btn btn-ghost"><KeyRound size={18} />{t('joining_code')}</button>
          {tab === 'supervisors' && <button onClick={() => setInviteModal(true)} className="btn btn-primary"><Plus size={18} />{t('invite_supervisor')}</button>}
        </div>
      </div>

      {loading ? <Spinner label={t('loading')} /> : tab === 'supervisors' ? (
        supervisors.length === 0 ? (
          <div className="card"><EmptyState icon={<UserCog size={40} />} text={t('empty')} /></div>
        ) : (
          <div className="space-y-2">
            {supervisors.map((s) => (
              <div key={s.user_id} className="card flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center surface-2">
                    <UserCog size={18} />
                  </div>
                  <div>
                    <div className="font-semibold">{s.full_name || s.email}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge color={s.role === 'admin' ? 'success' : 'neutral'}>{s.role === 'admin' ? t('admin') : t('supervisor')}</Badge>
                      {s.disabled && <Badge color="error">{t('disable_account')}</Badge>}
                    </div>
                    <div className="text-xs text-muted mt-1">{assignedClassIds(s.user_id).size} {t('assigned_classes')}</div>
                  </div>
                </div>
                {s.role !== 'admin' && (
                  <div className="flex gap-1">
                    <button onClick={() => openAssign(s)} className="btn btn-ghost p-2" title={t('assign_classes')}><LinkIcon size={16} /></button>
                    <button onClick={() => toggleDisable(s)} className="btn btn-ghost p-2" title={s.disabled ? t('enable_account') : t('disable_account')}>
                      {s.disabled ? <Check size={16} /> : <X size={16} />}
                    </button>
                    <button onClick={() => removeSupervisor(s)} className="btn btn-ghost p-2 text-[var(--error)]"><Trash2 size={16} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        joinRequests.length === 0 ? (
          <div className="card"><EmptyState icon={<Inbox size={40} />} text={t('no_join_requests')} /></div>
        ) : (
          <div className="space-y-2">
            {joinRequests.map((r) => (
              <div key={r.id} className="card flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center surface-2">
                    {r.status === 'pending' ? <Clock size={18} /> : r.status === 'accepted' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                  </div>
                  <div>
                    <div className="font-semibold">{r.applicant_name || r.applicant_email}</div>
                    <div className="text-xs text-muted">{r.applicant_email}</div>
                    <div className="flex items-center gap-2 mt-1">
                      {statusBadge(r.status)}
                      <span className="text-xs text-muted">{new Date(r.created_at).toLocaleDateString('ar-DZ')}</span>
                    </div>
                  </div>
                </div>
                {r.status === 'pending' && (
                  <div className="flex gap-2">
                    <button onClick={() => setConfirmApprove(r)} className="btn btn-primary" disabled={actionBusy}>
                      <Check size={16} />{t('accept')}
                    </button>
                    <button onClick={() => setConfirmReject(r)} className="btn btn-danger" disabled={actionBusy}>
                      <X size={16} />{t('reject')}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      <Modal open={inviteModal} onClose={() => setInviteModal(false)} title={t('invite_supervisor')}>
        <div className="space-y-3">
          {inviteError && <div className="text-sm text-[var(--error)]">{inviteError}</div>}
          <div><label className="label">{t('full_name')}</label><input className="input" value={inviteForm.fullName} onChange={(e) => setInviteForm({ ...inviteForm, fullName: e.target.value })} /></div>
          <div><label className="label">{t('email')}</label><input type="email" className="input" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} /></div>
          <div><label className="label">{t('password')}</label><input type="password" className="input" value={inviteForm.password} onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })} /></div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setInviteModal(false)} className="btn btn-ghost">{t('cancel')}</button>
            <button onClick={invite} disabled={busy} className="btn btn-primary">{busy ? t('loading') : t('create')}</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!assignModal} onClose={() => setAssignModal(null)} title={`${t('assign_classes')} — ${assignModal?.full_name || assignModal?.email}`} wide>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {classes.map((c) => (
            <label key={c.id} className="flex items-center gap-3 surface-2 rounded-lg px-3 py-2 cursor-pointer">
              <input type="checkbox" checked={selectedClasses.has(c.id)} onChange={() => toggleClass(c.id)} />
              <span>{c.name}</span>
            </label>
          ))}
          {classes.length === 0 && <EmptyState text={t('empty')} />}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => setAssignModal(null)} className="btn btn-ghost">{t('cancel')}</button>
          <button onClick={saveAssign} className="btn btn-primary">{t('save')}</button>
        </div>
      </Modal>

      {/* Approve confirmation — no temp password */}
      <Modal open={!!confirmApprove} onClose={() => setConfirmApprove(null)} title={`${t('accept')} — ${confirmApprove?.applicant_name || confirmApprove?.applicant_email}`}>
        <div className="space-y-4">
          <div className="surface-2 rounded-lg p-3 space-y-1 text-sm">
            <div><span className="text-muted">{t('full_name')}: </span>{confirmApprove?.applicant_name}</div>
            <div><span className="text-muted">{t('email')}: </span>{confirmApprove?.applicant_email}</div>
            <div><span className="text-muted">{t('request_date')}: </span>{confirmApprove ? new Date(confirmApprove.created_at).toLocaleDateString('ar-DZ') : ''}</div>
          </div>
          <p className="text-sm text-muted">{t('approve_confirm_hint')}</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmApprove(null)} className="btn btn-ghost" disabled={actionBusy}>{t('cancel')}</button>
            <button onClick={() => confirmApprove && doApprove(confirmApprove)} disabled={actionBusy} className="btn btn-primary">
              {actionBusy ? t('loading') : t('accept')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Reject confirmation */}
      <Modal open={!!confirmReject} onClose={() => setConfirmReject(null)} title={`${t('reject')} — ${confirmReject?.applicant_name || confirmReject?.applicant_email}`}>
        <div className="space-y-4">
          <div className="surface-2 rounded-lg p-3 space-y-1 text-sm">
            <div><span className="text-muted">{t('full_name')}: </span>{confirmReject?.applicant_name}</div>
            <div><span className="text-muted">{t('email')}: </span>{confirmReject?.applicant_email}</div>
          </div>
          <p className="text-sm text-muted">{t('reject_confirm_hint')}</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmReject(null)} className="btn btn-ghost" disabled={actionBusy}>{t('cancel')}</button>
            <button onClick={() => confirmReject && doReject(confirmReject)} disabled={actionBusy} className="btn btn-danger">
              {actionBusy ? t('loading') : t('reject')}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={codeModal} onClose={() => { setCodeModal(false); setNewCode(null); }} title={t('joining_code')}>
        <div className="space-y-4">
          <div className="surface-2 rounded-lg p-4 text-center">
            <div className="text-xs text-muted mb-1">{t('joining_code')}</div>
            <div className="text-2xl font-bold tracking-widest">{newCode ?? institution?.joining_code ?? '—'}</div>
            {(newCode ? null : institution?.code_expires_at) && (
              <div className="text-xs mt-2" style={{ color: new Date(institution?.code_expires_at ?? '').getTime() < Date.now() ? 'var(--error)' : 'var(--text-muted)' }}>
                {t('code_expires_at')}: {new Date(institution?.code_expires_at ?? '').toLocaleString('ar-DZ')}
              </div>
            )}
          </div>
          <button onClick={regenerateCode} className="btn btn-primary w-full"><RefreshCw size={16} />{t('regenerate_code')}</button>
          <p className="text-xs text-muted">{t('code_validity_24h')}</p>
        </div>
      </Modal>
    </div>
  );
}
