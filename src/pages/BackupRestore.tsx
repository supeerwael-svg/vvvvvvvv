import { useState } from 'react';
import { Download, Upload, FileJson, AlertCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { ConfirmDialog } from '@/components/ui';

interface BackupData {
  version: number;
  institution_id: string;
  exported_at: string;
  classes: unknown[];
  students: unknown[];
  lessons: unknown[];
  attendance_records: unknown[];
  teacher_absences: unknown[];
  absence_episodes: unknown[];
  institution_settings: unknown[];
}

export default function BackupRestore() {
  const { t } = useI18n();
  const { profile, institution } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [restoreData, setRestoreData] = useState<BackupData | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);

  const instId = profile?.institution_id;

  async function exportBackup() {
    if (!instId) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const [classes, students, lessons, attendance, teacherAbs, episodes, settings] = await Promise.all([
        supabase.from('classes').select('*').eq('institution_id', instId),
        supabase.from('students').select('*').eq('institution_id', instId),
        supabase.from('lessons').select('*').in('class_id', (await supabase.from('classes').select('id').eq('institution_id', instId)).data?.map((c) => c.id) ?? []),
        supabase.from('attendance_records').select('*').eq('institution_id', instId),
        supabase.from('teacher_absences').select('*').eq('institution_id', instId),
        supabase.from('absence_episodes').select('*').eq('institution_id', instId),
        supabase.from('institution_settings').select('*').eq('institution_id', instId),
      ]);

      const data: BackupData = {
        version: 1,
        institution_id: instId,
        exported_at: new Date().toISOString(),
        classes: classes.data ?? [],
        students: students.data ?? [],
        lessons: lessons.data ?? [],
        attendance_records: attendance.data ?? [],
        teacher_absences: teacherAbs.data ?? [],
        absence_episodes: episodes.data ?? [],
        institution_settings: settings.data ?? [],
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `edutrack_backup_${instId.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(t('success'));
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as BackupData;
        if (data.version !== 1) { setErr('Unsupported backup version'); return; }
        if (data.institution_id !== instId) { setErr('Backup belongs to a different institution'); return; }
        setRestoreData(data);
        setErr(null);
        setConfirmRestore(true);
      } catch {
        setErr('Invalid backup file');
      }
    };
    reader.readAsText(file);
  }

  async function doRestore() {
    if (!restoreData || !instId) return;
    setBusy(true); setErr(null);
    try {
      // Preview counts shown in confirm dialog; here we upsert
      for (const table of ['classes', 'students', 'lessons', 'attendance_records', 'teacher_absences', 'absence_episodes', 'institution_settings'] as const) {
        const rows = restoreData[table] as Record<string, unknown>[];
        if (rows.length) await supabase.from(table).upsert(rows).eq('institution_id', instId);
      }
      setMsg(t('success'));
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
    setRestoreData(null);
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="card">
        <div className="flex items-center gap-3 mb-3">
          <FileJson size={22} className="text-[var(--primary-700)]" />
          <h3 className="font-semibold">{t('export_json')}</h3>
        </div>
        <p className="text-sm text-muted mb-4">
          {institution?.name} — {t('backup')}
        </p>
        <button onClick={exportBackup} disabled={busy} className="btn btn-primary">
          <Download size={18} />{t('export_json')}
        </button>
      </div>

      <div className="card">
        <div className="flex items-center gap-3 mb-3">
          <Upload size={22} className="text-[var(--accent)]" />
          <h3 className="font-semibold">{t('import_json')}</h3>
        </div>
        <label className="block">
          <input type="file" accept="application/json" onChange={handleFile} className="hidden" />
          <span className="btn btn-ghost border border-app inline-flex cursor-pointer">
            <Upload size={18} />{t('import_json')}
          </span>
        </label>
        {err && (
          <div className="mt-3 flex items-start gap-2 text-sm text-[var(--error)]">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />{err}
          </div>
        )}
        {msg && <div className="mt-3 text-sm text-[var(--success)]">{msg}</div>}
      </div>

      <ConfirmDialog
        open={confirmRestore}
        onClose={() => { setConfirmRestore(false); setRestoreData(null); }}
        onConfirm={doRestore}
        title={t('restore')}
        message={restoreData ? `${t('classes')}: ${restoreData.classes.length} | ${t('students')}: ${restoreData.students.length} | ${t('attendance')}: ${restoreData.attendance_records.length}` : ''}
        confirmLabel={t('confirm')}
        danger
      />
    </div>
  );
}
