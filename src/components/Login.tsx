import { useState, useRef } from 'react';
import { GraduationCap, ShieldCheck, UserCog, ArrowLeft, Mail, Lock, Building2, User, Eye, EyeOff, KeyRound, CheckCircle2, Clock, XCircle, AlertTriangle, RotateCw } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';

type Mode = 'choose' | 'signin' | 'signup_admin' | 'signup_supervisor' | 'join_success';

const ERR_MAP: Record<string, { ar: string; en: string }> = {
  invalid_joining_code: { ar: 'رمز الدعوة غير صحيح أو غير نشط', en: 'Invalid or inactive invitation code' },
  expired_joining_code: { ar: 'انتهت صلاحية رمز الدعوة. اطلب من مدير المؤسسة توليد رمز جديد', en: 'The invitation code has expired. Ask the institution admin to generate a new one' },
  duplicate_pending_request: { ar: 'لديك طلب انضمام قيد المراجعة بالفعل', en: 'You already have a pending join request' },
  already_member: { ar: 'أنت عضو بالفعل في هذه المؤسسة. سجل الدخول', en: 'You are already a member of this institution. Please sign in' },
  email_exists_signin: { ar: 'هذا البريد مسجل بالفعل. سجل الدخول أو استخدم كلمة المرور الصحيحة', en: 'This email is already registered. Sign in or use the correct password' },
  timeout: { ar: 'انتهت مهلة الاتصال. تحقق من الإنترنت وأعد المحاولة', en: 'Connection timed out. Check your internet and try again' },
};

export default function Login() {
  const { t, lang, setLang } = useI18n();
  const { signIn, signUpAdmin, registerSupervisor } = useAuth();
  const [mode, setMode] = useState<Mode>('choose');
  const [signinRole, setSigninRole] = useState<'admin' | 'supervisor'>('supervisor');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [institutionName, setInstitutionName] = useState('');
  const [joiningCode, setJoiningCode] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const mapError = (err: string): string => {
    for (const [key, val] of Object.entries(ERR_MAP)) {
      if (err.includes(key)) return lang === 'ar' ? val.ar : val.en;
    }
    return err;
  };

  const resetForm = () => {
    setEmail(''); setPassword(''); setConfirmPassword('');
    setFullName(''); setInstitutionName(''); setJoiningCode('');
    setAcceptTerms(false); setError(null);
  };

  const doSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    setBusy(true); busyRef.current = true; setError(null);
    const { error } = await signIn(email, password);
    setBusy(false); busyRef.current = false;
    if (error) setError(mapError(error));
  };

  const doSignUpAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    setBusy(true); busyRef.current = true; setError(null);
    const { error } = await signUpAdmin(email, password, fullName, institutionName);
    setBusy(false); busyRef.current = false;
    if (error) setError(mapError(error));
  };

  const doRegisterSupervisor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    setError(null);
    if (password.length < 6) { setError(t('password_too_short')); return; }
    if (password !== confirmPassword) { setError(t('passwords_no_match')); return; }
    if (!acceptTerms) { setError(t('must_accept_terms')); return; }
    if (!joiningCode.trim()) { setError(t('enter_joining_code')); return; }
    setBusy(true); busyRef.current = true;
    const { error } = await registerSupervisor(email, password, fullName, joiningCode.trim());
    setBusy(false); busyRef.current = false;
    if (error) {
      setError(mapError(error));
    } else {
      resetForm();
      setMode('join_success');
    }
  };

  const backBtn = (to: Mode = 'choose') => (
    <button type="button" onClick={() => { setMode(to); resetForm(); }} className="btn-ghost btn p-1.5">
      <ArrowLeft size={18} className={lang === 'ar' ? 'rotate-180' : ''} />
    </button>
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(135deg, #083344 0%, #0e7490 55%, #155e75 100%)' }}>
      <div className="flex justify-end p-4">
        <button onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} className="btn btn-ghost text-white/90 hover:bg-white/10">
          {lang === 'ar' ? 'English' : 'العربية'}
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8 text-white">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/15 backdrop-blur mb-4">
              <GraduationCap size={32} />
            </div>
            <div className="text-xs tracking-widest opacity-80 mb-1">{t('ministry')}</div>
            <h1 className="text-3xl font-bold">{t('app_name')}</h1>
            <div className="text-sm opacity-70 mt-1">EduTrack</div>
          </div>

          <div className="surface rounded-2xl shadow-2xl p-6">
            {error && (
              <div className="mb-4 rounded-lg px-4 py-3 text-sm flex items-start gap-2" style={{ background: 'color-mix(in srgb, var(--error) 12%, transparent)', color: 'var(--error)' }}>
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {mode === 'choose' && (
              <div className="space-y-3">
                <button
                  onClick={() => { setMode('signin'); setSigninRole('admin'); resetForm(); }}
                  className="w-full text-start rounded-xl p-4 border border-app hover:border-[var(--primary-600)] transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--primary-600) 12%, transparent)', color: 'var(--primary-700)' }}>
                      <ShieldCheck size={22} />
                    </div>
                    <div>
                      <div className="font-semibold">{t('login_general')}</div>
                      <div className="text-xs text-muted">{t('login_general_desc')}</div>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => { setMode('signin'); setSigninRole('supervisor'); resetForm(); }}
                  className="w-full text-start rounded-xl p-4 border border-app hover:border-[var(--primary-600)] transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }}>
                      <UserCog size={22} />
                    </div>
                    <div>
                      <div className="font-semibold">{t('login_supervisor')}</div>
                      <div className="text-xs text-muted">{t('login_supervisor_desc')}</div>
                    </div>
                  </div>
                </button>
                <div className="pt-3 border-t border-app space-y-2">
                  <button onClick={() => { setMode('signup_supervisor'); resetForm(); }} className="w-full btn btn-primary">
                    <UserCog size={18} />{t('create_supervisor_account')}
                  </button>
                  <button onClick={() => { setMode('signup_admin'); resetForm(); }} className="w-full text-sm text-[var(--primary-700)] hover:underline">
                    {t('create_admin_account')}
                  </button>
                </div>
              </div>
            )}

            {mode === 'signin' && (
              <form onSubmit={doSignIn} className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  {backBtn()}
                  <span className="font-semibold">{signinRole === 'admin' ? t('login_general') : t('login_supervisor')}</span>
                </div>
                <Field icon={<Mail size={16} />}>
                  <input className="input" type="email" required placeholder={t('email')} value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                <Field icon={<Lock size={16} />}>
                  <div className="relative">
                    <input className="input pe-10" type={showPwd ? 'text' : 'password'} required placeholder={t('password')} value={password} onChange={(e) => setPassword(e.target.value)} />
                    <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute inset-y-0 end-0 pe-3 text-muted">
                      {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </Field>
                <button disabled={busy} className="btn btn-primary w-full">{busy ? t('loading') : t('sign_in')}</button>
                <div className="text-center">
                  <button type="button" onClick={() => { setMode('signup_supervisor'); resetForm(); }} className="text-sm text-[var(--primary-700)] hover:underline">
                    {t('create_supervisor_account')}
                  </button>
                </div>
              </form>
            )}

            {mode === 'signup_admin' && (
              <form onSubmit={doSignUpAdmin} className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  {backBtn()}
                  <span className="font-semibold">{t('create_admin_account')}</span>
                </div>
                <Field icon={<Building2 size={16} />}>
                  <input className="input" required placeholder={t('institution_name')} value={institutionName} onChange={(e) => setInstitutionName(e.target.value)} />
                </Field>
                <Field icon={<User size={16} />}>
                  <input className="input" required placeholder={t('full_name')} value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </Field>
                <Field icon={<Mail size={16} />}>
                  <input className="input" type="email" required placeholder={t('email')} value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                <Field icon={<Lock size={16} />}>
                  <div className="relative">
                    <input className="input pe-10" type={showPwd ? 'text' : 'password'} required minLength={6} placeholder={t('password')} value={password} onChange={(e) => setPassword(e.target.value)} />
                    <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute inset-y-0 end-0 pe-3 text-muted">
                      {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </Field>
                <button disabled={busy} className="btn btn-primary w-full">{busy ? t('loading') : t('create')}</button>
                <div className="text-center">
                  <button type="button" onClick={() => { setMode('signin'); resetForm(); }} className="text-sm text-[var(--primary-700)] hover:underline">
                    {t('have_account')}
                  </button>
                </div>
              </form>
            )}

            {mode === 'signup_supervisor' && (
              <form onSubmit={doRegisterSupervisor} className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  {backBtn()}
                  <span className="font-semibold">{t('create_supervisor_account')}</span>
                </div>
                <Field icon={<User size={16} />}>
                  <input className="input" required placeholder={t('full_name')} value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </Field>
                <Field icon={<Mail size={16} />}>
                  <input className="input" type="email" required placeholder={t('email')} value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                <Field icon={<Lock size={16} />}>
                  <div className="relative">
                    <input className="input pe-10" type={showPwd ? 'text' : 'password'} required minLength={6} placeholder={t('password')} value={password} onChange={(e) => setPassword(e.target.value)} />
                    <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute inset-y-0 end-0 pe-3 text-muted">
                      {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </Field>
                <Field icon={<Lock size={16} />}>
                  <div className="relative">
                    <input className="input pe-10" type={showConfirmPwd ? 'text' : 'password'} required placeholder={t('confirm_password')} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                    <button type="button" onClick={() => setShowConfirmPwd(!showConfirmPwd)} className="absolute inset-y-0 end-0 pe-3 text-muted">
                      {showConfirmPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </Field>
                <Field icon={<KeyRound size={16} />}>
                  <input className="input" required placeholder={t('enter_joining_code')} value={joiningCode} onChange={(e) => setJoiningCode(e.target.value)} />
                </Field>
                <p className="text-xs text-muted">{t('joining_code_help')}</p>
                <label className="flex items-start gap-2 cursor-pointer text-sm">
                  <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-1" />
                  <span>{t('accept_terms')}</span>
                </label>
                <button disabled={busy} className="btn btn-primary w-full">{busy ? t('loading') : t('create')}</button>
                <div className="text-center">
                  <button type="button" onClick={() => { setMode('signin'); resetForm(); }} className="text-sm text-[var(--primary-700)] hover:underline">
                    {t('have_account')}
                  </button>
                </div>
              </form>
            )}

            {mode === 'join_success' && (
              <div className="text-center py-6 space-y-4">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-2" style={{ background: 'color-mix(in srgb, var(--success) 14%, transparent)', color: 'var(--success)' }}>
                  <CheckCircle2 size={32} />
                </div>
                <p className="text-sm font-medium">{t('join_success')}</p>
                <p className="text-xs text-muted">{t('request_status_pending')}</p>
                <button onClick={() => { setMode('signin'); resetForm(); }} className="btn btn-primary w-full">
                  {t('sign_in')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="absolute inset-y-0 start-0 flex items-center ps-3 text-muted pointer-events-none z-10">{icon}</div>
      <div className="ps-9">{children}</div>
    </div>
  );
}
