import { useEffect, useState } from 'react';
import { Users, Plus, Pencil, Search, Trash2, ArrowRightLeft } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Modal, EmptyState, Spinner, ConfirmDialog } from '@/components/ui';
import type { ClassRow, Student, StudentBoarding } from '@/lib/types';

interface FormState {
  first_name: string; last_name: string; birth_date: string;
  gender: 'male' | 'female' | ''; boarding: StudentBoarding;
  repetition_status: string; class_id: string;
}

const empty: FormState = {
  first_name: '', last_name: '', birth_date: '', gender: '',
  boarding: 'external', repetition_status: 'new', class_id: '',
};

export default function Students() {
  const { t } = useI18n();
  const { profile, assignedClassIds } = useAuth();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [modal, setModal] = useState<{ open: boolean; edit?: Student }>({ open: false });
  const [form, setForm] = useState<FormState>(empty);
  const [transferModal, setTransferModal] = useState<Student | null>(null);
  const [transferClass, setTransferClass] = useState('');
  const [confirmDel, setConfirmDel] = useState<Student | null>(null);

  const isAdmin = profile?.role === 'admin';
  const instId = profile?.institution_id;

  async function loadClasses() {
    if (!instId) return;
    const q = supabase.from('classes').select('*').eq('institution_id', instId).eq('archived', false).order('name');
    const { data } = await q;
    const cls = (data ?? []) as ClassRow[];
    setClasses(cls.filter((c) => isAdmin || assignedClassIds.has(c.id)));
  }

  async function loadStudents() {
    if (!instId) return;
    setLoading(true);
    let q = supabase.from('students').select('*').eq('institution_id', instId).order('last_name');
    if (classFilter !== 'all') q = q.eq('class_id', classFilter);
    const { data } = await q;
    setStudents((data ?? []) as Student[]);
    setLoading(false);
  }

  useEffect(() => { loadClasses(); }, [instId]);
  useEffect(() => { loadStudents(); }, [instId, classFilter]);

  const filtered = students.filter((s) =>
    `${s.first_name} ${s.last_name}`.toLowerCase().includes(search.toLowerCase())
  );

  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? '—';

  const openAdd = () => { setForm({ ...empty, class_id: classes[0]?.id ?? '' }); setModal({ open: true }); };
  const openEdit = (s: Student) => {
    setForm({
      first_name: s.first_name, last_name: s.last_name, birth_date: s.birth_date ?? '',
      gender: (s.gender as 'male' | 'female' | '') ?? '', boarding: s.boarding,
      repetition_status: s.repetition_status, class_id: s.class_id,
    });
    setModal({ open: true, edit: s });
  };

  const save = async () => {
    if (!instId || !form.first_name.trim() || !form.last_name.trim() || !form.class_id) return;
    const payload = {
      institution_id: instId,
      class_id: form.class_id,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      birth_date: form.birth_date || null,
      gender: form.gender || null,
      boarding: form.boarding,
      repetition_status: form.repetition_status,
    };
    if (modal.edit) {
      await supabase.from('students').update(payload).eq('id', modal.edit.id);
    } else {
      await supabase.from('students').insert(payload);
    }
    setModal({ open: false });
    loadStudents();
  };

  const doTransfer = async () => {
    if (!transferModal || !transferClass) return;
    await supabase.from('students').update({ class_id: transferClass }).eq('id', transferModal.id);
    setTransferModal(null);
    setTransferClass('');
    loadStudents();
  };

  const del = async (s: Student) => {
    await supabase.from('students').delete().eq('id', s.id);
    loadStudents();
  };

  const boardingLabel = (b: StudentBoarding) => t(b === 'half_board' ? 'half_board' : b);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2 flex-1 min-w-[200px]">
          <div className="relative flex-1 max-w-xs">
            <Search size={16} className="absolute inset-y-0 start-0 my-auto ms-3 text-muted" />
            <input className="input ps-9" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input max-w-[180px]" value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="all">{t('classes')}</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <button onClick={openAdd} className="btn btn-primary" disabled={classes.length === 0}><Plus size={18} />{t('add_student')}</button>
      </div>

      {loading ? <Spinner label={t('loading')} /> : filtered.length === 0 ? (
        <div className="card"><EmptyState icon={<Users size={40} />} text={t('empty')} /></div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="surface-2 text-muted">
              <tr>
                <th className="text-start px-3 py-2 font-medium">{t('last_name')}</th>
                <th className="text-start px-3 py-2 font-medium">{t('first_name')}</th>
                <th className="text-start px-3 py-2 font-medium">{t('class')}</th>
                <th className="text-start px-3 py-2 font-medium">{t('gender')}</th>
                <th className="text-start px-3 py-2 font-medium">{t('boarding')}</th>
                <th className="text-start px-3 py-2 font-medium">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-t border-app">
                  <td className="px-3 py-2">{s.last_name}</td>
                  <td className="px-3 py-2">{s.first_name}</td>
                  <td className="px-3 py-2">{className(s.class_id)}</td>
                  <td className="px-3 py-2">{s.gender ? t(s.gender) : '—'}</td>
                  <td className="px-3 py-2">{boardingLabel(s.boarding)}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(s)} className="btn btn-ghost p-1.5"><Pencil size={15} /></button>
                      <button onClick={() => { setTransferModal(s); setTransferClass(s.class_id); }} className="btn btn-ghost p-1.5" title={t('transfer')}><ArrowRightLeft size={15} /></button>
                      {isAdmin && <button onClick={() => setConfirmDel(s)} className="btn btn-ghost p-1.5 text-[var(--error)]"><Trash2 size={15} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.edit ? t('edit_student') : t('add_student')}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('first_name')}><input className="input" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></Field>
          <Field label={t('last_name')}><input className="input" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></Field>
          <Field label={t('birth_date')}><input type="date" className="input" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} /></Field>
          <Field label={t('class')}><select className="input" value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })}>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></Field>
          <Field label={t('gender')}><select className="input" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value as FormState['gender'] })}>
            <option value="">—</option><option value="male">{t('male')}</option><option value="female">{t('female')}</option>
          </select></Field>
          <Field label={t('boarding')}><select className="input" value={form.boarding} onChange={(e) => setForm({ ...form, boarding: e.target.value as StudentBoarding })}>
            <option value="day">{t('day')}</option><option value="half_board">{t('half_board')}</option>
            <option value="boarder">{t('boarder')}</option><option value="external">{t('external')}</option>
          </select></Field>
          <Field label={t('repetition_status')}><input className="input" value={form.repetition_status} onChange={(e) => setForm({ ...form, repetition_status: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={() => setModal({ open: false })} className="btn btn-ghost">{t('cancel')}</button>
          <button onClick={save} className="btn btn-primary">{t('save')}</button>
        </div>
      </Modal>

      <Modal open={!!transferModal} onClose={() => setTransferModal(null)} title={t('transfer')}>
        <div className="space-y-4">
          <p className="text-sm">{transferModal?.first_name} {transferModal?.last_name}</p>
          <Field label={t('class')}>
            <select className="input" value={transferClass} onChange={(e) => setTransferClass(e.target.value)}>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <button onClick={() => setTransferModal(null)} className="btn btn-ghost">{t('cancel')}</button>
            <button onClick={doTransfer} className="btn btn-primary">{t('save')}</button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!confirmDel} onClose={() => setConfirmDel(null)} onConfirm={() => confirmDel && del(confirmDel)}
        title={t('delete')} message={`${confirmDel?.first_name} ${confirmDel?.last_name}`} confirmLabel={t('delete')} danger />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}
