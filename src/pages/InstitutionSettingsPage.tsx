import { useEffect, useState } from 'react';
import { Save, ExternalLink, AlertCircle, CheckCircle2, Download } from 'lucide-react';
import { useI18n, weekDayLabel } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui';
import { DEFAULT_WORKING_DAYS, type InstitutionSettings as ISettings, type WeekDay } from '@/lib/types';

export default function InstitutionSettingsPage() {
  const { t, lang } = useI18n();
  const { institution, refreshProfile } = useAuth();
  const [name, setName] = useState('');
  const [settings, setSettings] = useState<ISettings | null>(null);
  const [totalRooms, setTotalRooms] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tplUrl, setTplUrl] = useState('');
  const [tplSaved, setTplSaved] = useState(false);
  const [tplError, setTplError] = useState<string | null>(null);
  const [tplTesting, setTplTesting] = useState(false);

  useEffect(() => {
    setName(institution?.name ?? '');
  }, [institution]);

  async function loadSettings() {
    if (!institution?.id) return;
    const { data } = await supabase.from('institution_settings').select('*').eq('institution_id', institution.id).maybeSingle();
    setSettings(data as ISettings | null);
    setTplUrl((data as ISettings | null)?.excel_template_url ?? '');
    setTotalRooms((data as ISettings | null)?.total_rooms ?? 0);
  }
  useEffect(() => { loadSettings(); }, [institution?.id]);

  const toggleDay = (d: WeekDay) => {
    if (!settings) return;
    const has = settings.working_days.includes(d);
    setSettings({
      ...settings,
      working_days: has ? settings.working_days.filter((x) => x !== d) : [...settings.working_days, d],
    });
  };

  const save = async () => {
    if (!institution?.id) return;
    setBusy(true); setSaved(false);
    await supabase.from('institutions').update({ name }).eq('id', institution.id);
    if (settings) {
      await supabase.from('institution_settings').update({
        working_days: settings.working_days,
        first_notice_days: settings.first_notice_days,
        second_notice_days: settings.second_notice_days,
        prolonged_notice_days: settings.prolonged_notice_days,
        excused_counts_as_absent: settings.excused_counts_as_absent,
        total_rooms: totalRooms,
      }).eq('institution_id', institution.id);
    }
    await refreshProfile();
    await loadSettings();
    setBusy(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const saveTemplateUrl = async () => {
    if (!institution?.id) return;
    setTplError(null);
    setTplSaved(false);

    const trimmed = tplUrl.trim();
    if (trimmed) {
      try {
        const u = new URL(trimmed);
        if (u.protocol !== 'https:') {
          setTplError(t('url_invalid'));
          return;
        }
      } catch {
        setTplError(t('url_invalid'));
        return;
      }
    }

    const value = trimmed || null;
    const { error } = await supabase
      .from('institution_settings')
      .update({ excel_template_url: value })
      .eq('institution_id', institution.id);

    if (error) {
      setTplError(t('url_save_failed'));
      return;
    }
    setTplSaved(true);
    setSettings((prev) => prev ? { ...prev, excel_template_url: value } : prev);
    setTimeout(() => setTplSaved(false), 4000);
  };

  const testTemplateUrl = () => {
    const url = settings?.excel_template_url;
    if (!url || !url.trim()) {
      setTplError(t('url_not_configured'));
      return;
    }
    setTplError(null);
    setTplTesting(true);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => setTplTesting(false), 1500);
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="card space-y-4">
        <h3 className="font-semibold">{t('institution_settings')}</h3>
        <div>
          <label className="label">{t('institution_name')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>

      {settings && (
        <div className="card space-y-4">
          <h3 className="font-semibold">{t('working_days')}</h3>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_WORKING_DAYS.concat(['friday', 'saturday'] as WeekDay[]).map((d) => (
              <button
                key={d}
                onClick={() => toggleDay(d)}
                className="px-3 py-2 rounded-lg text-sm transition"
                style={settings.working_days.includes(d)
                  ? { background: 'var(--primary-600)', color: 'white' }
                  : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}
              >
                {weekDayLabel(d, lang)}
              </button>
            ))}
          </div>
        </div>
      )}

      {settings && (
        <div className="card space-y-4">
          <h3 className="font-semibold">{t('notice_thresholds')}</h3>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="label">{t('first_notice')}</label>
              <input type="number" className="input" value={settings.first_notice_days} onChange={(e) => setSettings({ ...settings, first_notice_days: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label">{t('second_notice')}</label>
              <input type="number" className="input" value={settings.second_notice_days} onChange={(e) => setSettings({ ...settings, second_notice_days: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label">{t('prolonged_notice')}</label>
              <input type="number" className="input" value={settings.prolonged_notice_days} onChange={(e) => setSettings({ ...settings, prolonged_notice_days: Number(e.target.value) })} />
            </div>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={settings.excused_counts_as_absent} onChange={(e) => setSettings({ ...settings, excused_counts_as_absent: e.target.checked })} />
            <span className="text-sm">{t('excused_policy')}</span>
          </label>
        </div>
      )}

      {settings && (
        <div className="card space-y-4">
          <h3 className="font-semibold">{t('room_settings')}</h3>
          <div>
            <label className="label">{t('total_rooms')}</label>
            <input type="number" min="0" className="input max-w-[120px]" value={totalRooms} onChange={(e) => setTotalRooms(Math.max(0, Number(e.target.value)))} />
            <p className="text-xs text-muted mt-1">{t('total_rooms_hint')}</p>
          </div>
        </div>
      )}

      {/* Excel template URL */}
      <div className="card space-y-4">
        <h3 className="font-semibold">{t('excel_template_settings')}</h3>
        <p className="text-sm text-muted">{t('excel_template_url_hint')}</p>
        <div>
          <label className="label">{t('excel_template_url_label')}</label>
          <input
            className="input"
            dir="ltr"
            value={tplUrl}
            onChange={(e) => { setTplUrl(e.target.value); setTplSaved(false); setTplError(null); }}
            placeholder={t('excel_template_url_ph')}
          />
        </div>
        {tplError && (
          <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'color-mix(in srgb, var(--error) 12%, transparent)', color: 'var(--error)' }}>
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{tplError}</span>
          </div>
        )}
        {tplSaved && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success)' }}>
            <CheckCircle2 size={16} />
            <span>{t('url_saved')}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button onClick={saveTemplateUrl} className="btn btn-primary">
            <Save size={16} /> {t('save_url')}
          </button>
          <button onClick={testTemplateUrl} className="btn btn-ghost" style={{ border: '1px solid var(--border)' }}>
            <ExternalLink size={16} /> {t('test_url')}
          </button>
        </div>
        <p className="text-xs text-muted">{t('url_test_hint')}</p>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="btn btn-primary">{busy ? t('loading') : t('save')}</button>
        {saved && <span className="text-sm text-[var(--success)]">{t('success')}</span>}
      </div>
    </div>
  );
}
