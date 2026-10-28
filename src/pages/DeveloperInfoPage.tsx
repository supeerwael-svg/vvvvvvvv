import { useEffect, useState } from 'react';
import { Code2, Mail, Phone, Globe, MessageCircle, Save, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui';
import type { DeveloperInfo } from '@/lib/types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s+()-]{6,}$/;
const WHATSAPP_RE = /^https:\/\/chat\.whatsapp\.com\/.+/i;
const URL_RE = /^https?:\/\/.+/i;

export default function DeveloperInfoPage() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const instId = profile?.institution_id;

  const [info, setInfo] = useState<DeveloperInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    dev_name: '',
    app_name: '',
    app_version: '',
    contact_email: '',
    contact_phone: '',
    website: '',
    description: '',
    support_hours: '',
    whatsapp_group_url: '',
  });

  useEffect(() => {
    (async () => {
      if (!instId) { setLoading(false); return; }
      const { data } = await supabase
        .from('developer_info')
        .select('*')
        .eq('institution_id', instId)
        .maybeSingle();
      if (data) {
        const d = data as DeveloperInfo;
        setInfo(d);
        setForm({
          dev_name: d.dev_name,
          app_name: d.app_name,
          app_version: d.app_version,
          contact_email: d.contact_email ?? '',
          contact_phone: d.contact_phone ?? '',
          website: d.website ?? '',
          description: d.description ?? '',
          support_hours: d.support_hours ?? '',
          whatsapp_group_url: d.whatsapp_group_url ?? '',
        });
      }
      setLoading(false);
    })();
  }, [instId]);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (form.contact_email && !EMAIL_RE.test(form.contact_email)) errs.contact_email = t('invalid_email');
    if (form.contact_phone && !PHONE_RE.test(form.contact_phone)) errs.contact_phone = t('invalid_phone');
    if (form.website && !URL_RE.test(form.website)) errs.website = t('invalid_website');
    if (form.whatsapp_group_url && !WHATSAPP_RE.test(form.whatsapp_group_url)) errs.whatsapp_group_url = t('invalid_whatsapp_url');
    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const save = async () => {
    if (!instId) return;
    if (!validate()) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);

    const payload = {
      institution_id: instId,
      dev_name: form.dev_name.trim(),
      app_name: form.app_name.trim(),
      app_version: form.app_version.trim(),
      contact_email: form.contact_email.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      website: form.website.trim() || null,
      description: form.description.trim() || null,
      support_hours: form.support_hours.trim() || null,
      whatsapp_group_url: form.whatsapp_group_url.trim() || null,
    };

    try {
      if (info) {
        const { error } = await supabase.from('developer_info').update(payload).eq('id', info.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('developer_info').insert(payload).select('*').single();
        if (error) throw error;
        setInfo(data as DeveloperInfo);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const openWhatsApp = () => {
    const url = info?.whatsapp_group_url;
    if (url && WHATSAPP_RE.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openEmail = () => {
    if (info?.contact_email) window.open(`mailto:${info.contact_email}`, '_blank', 'noopener,noreferrer');
  };

  const openPhone = () => {
    if (info?.contact_phone) window.open(`tel:${info.contact_phone}`, '_blank', 'noopener,noreferrer');
  };

  const openWebsite = () => {
    if (info?.website) window.open(info.website, '_blank', 'noopener,noreferrer');
  };

  if (loading) return <Spinner label={t('loading')} />;

  const hasAnyInfo = info && (info.dev_name || info.app_name || info.contact_email || info.contact_phone || info.website || info.description || info.support_hours);
  const hasWhatsApp = info?.whatsapp_group_url && WHATSAPP_RE.test(info.whatsapp_group_url);

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Code2 size={20} style={{ color: 'var(--primary-600)' }} />
          <h3 className="font-semibold">{t('developer_info')}</h3>
        </div>
      </div>

      {/* Display mode for non-admins or view-only section */}
      {!isAdmin && !hasAnyInfo && (
        <div className="card"><p className="text-sm text-muted text-center py-4">{t('no_dev_info')}</p></div>
      )}

      {hasAnyInfo && (
        <div className="card space-y-4">
          {/* Info display */}
          <div className="grid sm:grid-cols-2 gap-3">
            {info.dev_name && <InfoField label={t('dev_org_name')} value={info.dev_name} />}
            {info.app_name && <InfoField label={t('dev_app_name')} value={info.app_name} />}
            {info.app_version && <InfoField label={t('dev_app_version')} value={info.app_version} />}
            {info.support_hours && (
              <InfoField label={t('dev_support_hours')} value={info.support_hours} icon={<Clock size={14} />} />
            )}
          </div>

          {info.description && (
            <div>
              <div className="label">{t('dev_description')}</div>
              <p className="text-sm text-muted">{info.description}</p>
            </div>
          )}

          {/* Contact methods */}
          <div className="space-y-2">
            <div className="label">{t('contact_methods')}</div>
            <div className="flex flex-wrap gap-2">
              {info.contact_email && (
                <button onClick={openEmail} className="btn btn-ghost text-sm" style={{ border: '1px solid var(--border)' }}>
                  <Mail size={16} /> {t('contact_email')}
                </button>
              )}
              {info.contact_phone && (
                <button onClick={openPhone} className="btn btn-ghost text-sm" style={{ border: '1px solid var(--border)' }}>
                  <Phone size={16} /> {t('contact_phone')}
                </button>
              )}
              {info.website && (
                <button onClick={openWebsite} className="btn btn-ghost text-sm" style={{ border: '1px solid var(--border)' }}>
                  <Globe size={16} /> {t('visit_website')}
                </button>
              )}
            </div>
          </div>

          {/* WhatsApp group */}
          {hasWhatsApp && (
            <div className="space-y-2">
              <div className="label">{t('whatsapp_group_link')}</div>
              <button onClick={openWhatsApp} className="btn text-sm text-white" style={{ background: '#25D366' }}>
                <MessageCircle size={16} /> {t('join_whatsapp')}
              </button>
              <p className="text-xs text-muted">{t('whatsapp_join_hint')}</p>
            </div>
          )}
        </div>
      )}

      {/* Admin edit form */}
      {isAdmin && (
        <div className="card space-y-4">
          <h3 className="font-semibold text-sm">{t('edit')}</h3>

          {saveError && (
            <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'color-mix(in srgb, var(--error) 12%, transparent)', color: 'var(--error)' }}>
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{saveError}</span>
            </div>
          )}
          {saved && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success)' }}>
              <CheckCircle2 size={16} />
              <span>{t('dev_info_saved')}</span>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">{t('dev_org_name')}</label>
              <input className="input" value={form.dev_name} onChange={(e) => setForm({ ...form, dev_name: e.target.value })} />
            </div>
            <div>
              <label className="label">{t('dev_app_name')}</label>
              <input className="input" value={form.app_name} onChange={(e) => setForm({ ...form, app_name: e.target.value })} />
            </div>
            <div>
              <label className="label">{t('dev_app_version')}</label>
              <input className="input" value={form.app_version} onChange={(e) => setForm({ ...form, app_version: e.target.value })} />
            </div>
            <div>
              <label className="label">{t('dev_support_hours')}</label>
              <input className="input" value={form.support_hours} onChange={(e) => setForm({ ...form, support_hours: e.target.value })} />
            </div>
            <div>
              <label className="label">{t('dev_contact_email')}</label>
              <input className="input" type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
              {validationErrors.contact_email && <p className="text-xs mt-1" style={{ color: 'var(--error)' }}>{validationErrors.contact_email}</p>}
            </div>
            <div>
              <label className="label">{t('dev_contact_phone')}</label>
              <input className="input" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
              {validationErrors.contact_phone && <p className="text-xs mt-1" style={{ color: 'var(--error)' }}>{validationErrors.contact_phone}</p>}
            </div>
            <div>
              <label className="label">{t('dev_website')}</label>
              <input className="input" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://..." />
              {validationErrors.website && <p className="text-xs mt-1" style={{ color: 'var(--error)' }}>{validationErrors.website}</p>}
            </div>
            <div>
              <label className="label">{t('whatsapp_group_link')}</label>
              <input className="input" value={form.whatsapp_group_url} onChange={(e) => setForm({ ...form, whatsapp_group_url: e.target.value })} placeholder="https://chat.whatsapp.com/..." dir="ltr" />
              {validationErrors.whatsapp_group_url && <p className="text-xs mt-1" style={{ color: 'var(--error)' }}>{validationErrors.whatsapp_group_url}</p>}
            </div>
          </div>

          <div>
            <label className="label">{t('dev_description')}</label>
            <textarea className="input min-h-[80px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>

          <div className="flex justify-end">
            <button onClick={save} disabled={saving} className="btn btn-primary">
              {saving ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Save size={16} />} {t('save')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoField({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-sm flex items-center gap-1.5">
        {icon}
        <span>{value}</span>
      </div>
    </div>
  );
}
