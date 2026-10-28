import { useEffect, useState } from 'react';
import { User, Globe, Moon, Sun, Save } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui';

export default function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const { profile, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('edutrack_dark') === '1');

  useEffect(() => { setFullName(profile?.full_name ?? ''); }, [profile]);

  const toggleDark = (v: boolean) => {
    setDark(v);
    localStorage.setItem('edutrack_dark', v ? '1' : '0');
    document.documentElement.classList.toggle('dark', v);
  };

  const save = async () => {
    if (!profile?.user_id) return;
    setBusy(true); setSaved(false);
    await supabase.from('profiles').update({ full_name: fullName }).eq('user_id', profile.user_id);
    await refreshProfile();
    setBusy(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!profile) return <Spinner label={t('loading')} />;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="card space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--primary-600) 12%, transparent)', color: 'var(--primary-700)' }}>
            <User size={22} />
          </div>
          <h3 className="font-semibold">{t('profile')}</h3>
        </div>
        <div>
          <label className="label">{t('full_name')}</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <label className="label">{t('email')}</label>
          <input className="input opacity-70" value={profile.email ?? ''} disabled />
        </div>
        <div>
          <label className="label">{t('role')}</label>
          <div className="text-sm">{profile.role === 'admin' ? t('admin') : t('supervisor')}</div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={busy} className="btn btn-primary"><Save size={18} />{t('save')}</button>
          {saved && <span className="text-sm text-[var(--success)]">{t('success')}</span>}
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center gap-3">
          <Globe size={22} className="text-[var(--primary-700)]" />
          <h3 className="font-semibold">{t('language')}</h3>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setLang('ar')} className="btn" style={lang === 'ar' ? { background: 'var(--primary-600)', color: 'white' } : { background: 'var(--surface-2)' }}>
            {t('arabic')}
          </button>
          <button onClick={() => setLang('en')} className="btn" style={lang === 'en' ? { background: 'var(--primary-600)', color: 'white' } : { background: 'var(--surface-2)' }}>
            {t('english')}
          </button>
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center gap-3">
          {dark ? <Moon size={22} /> : <Sun size={22} />}
          <h3 className="font-semibold">{t('theme')}</h3>
        </div>
        <div className="flex gap-2">
          <button onClick={() => toggleDark(false)} className="btn" style={!dark ? { background: 'var(--primary-600)', color: 'white' } : { background: 'var(--surface-2)' }}>
            <Sun size={16} />{lang === 'ar' ? 'فاتح' : 'Light'}
          </button>
          <button onClick={() => toggleDark(true)} className="btn" style={dark ? { background: 'var(--primary-600)', color: 'white' } : { background: 'var(--surface-2)' }}>
            <Moon size={16} />{lang === 'ar' ? 'داكن' : 'Dark'}
          </button>
        </div>
      </div>
    </div>
  );
}
