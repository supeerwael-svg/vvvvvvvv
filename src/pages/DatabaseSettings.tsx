import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Cloud, HardDrive, Wifi, WifiOff, CheckCircle2 } from 'lucide-react';

export default function DatabaseSettings() {
  const { t } = useI18n();
  const { session } = useAuth();

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--primary-600) 12%, transparent)', color: 'var(--primary-700)' }}>
            <Cloud size={22} />
          </div>
          <div>
            <div className="font-semibold">{t('cloud_mode')}</div>
            <div className="text-xs text-muted">{t('cloud_status')}: {t('connected')}</div>
          </div>
        </div>
        <p className="text-sm text-muted">
          {t('login_supervisor_desc')}
        </p>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <CheckCircle2 size={16} className="text-[var(--success)]" />
          <span>{t('connected')} — Supabase</span>
        </div>
        <div className="mt-1 text-xs text-muted">{t('last_sync')}: {session ? new Date().toLocaleString() : '—'}</div>
      </div>

      <div className="card">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-11 h-11 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
            <HardDrive size={22} />
          </div>
          <div>
            <div className="font-semibold">{t('local_mode')}</div>
          </div>
        </div>
        <p className="text-sm text-muted">
          {t('local_mode')} — localStorage / IndexedDB.
        </p>
      </div>

      <div className="card">
        <h3 className="font-semibold mb-2">{t('cloud_status')}</h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <Wifi size={16} className="text-[var(--success)]" /> {t('connected')}
          </div>
        </div>
        <p className="text-xs text-muted mt-3">
          Supabase PostgreSQL + RLS. {t('connected')}.
        </p>
      </div>
    </div>
  );
}
