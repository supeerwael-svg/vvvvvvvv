import { useState, type ReactNode } from 'react';
import {
  Home, BookOpen, Users, CalendarClock, ClipboardCheck, UserMinus,
  FileText, BarChart3, AlertTriangle, UserCog, Settings2, Database,
  Download, Settings, LogOut, Menu, X, GraduationCap, Globe, Moon, Sun, UserCheck, Code2,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import SyncIndicator from './SyncIndicator';

export type PageKey =
  | 'home' | 'classes' | 'students' | 'timetables' | 'teacher_assignments' | 'attendance'
  | 'teacher_absence' | 'daily_reports' | 'monthly_reports' | 'student_stats'
  | 'absence_followup' | 'supervisors' | 'institution_settings'
  | 'database_settings' | 'backup' | 'settings' | 'developer_info';

interface NavItem { key: PageKey; label: string; icon: ReactNode; adminOnly?: boolean; }

export default function Layout({ page, setPage, children }: {
  page: PageKey; setPage: (p: PageKey) => void; children: ReactNode;
}) {
  const { t, lang, setLang } = useI18n();
  const { profile, institution, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('edutrack_dark') === '1');

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem('edutrack_dark', next ? '1' : '0');
    document.documentElement.classList.toggle('dark', next);
  };

  const items: NavItem[] = [
    { key: 'home', label: t('home'), icon: <Home size={18} /> },
    { key: 'classes', label: t('classes'), icon: <BookOpen size={18} /> },
    { key: 'students', label: t('students'), icon: <Users size={18} /> },
    { key: 'timetables', label: t('timetables'), icon: <CalendarClock size={18} /> },
    { key: 'teacher_assignments', label: t('teacher_assignments'), icon: <UserCheck size={18} /> },
    { key: 'attendance', label: t('daily_attendance'), icon: <ClipboardCheck size={18} /> },
    { key: 'teacher_absence', label: t('teacher_absence'), icon: <UserMinus size={18} /> },
    { key: 'daily_reports', label: t('daily_reports'), icon: <FileText size={18} /> },
    { key: 'monthly_reports', label: t('monthly_reports'), icon: <BarChart3 size={18} /> },
    { key: 'student_stats', label: t('student_stats'), icon: <BarChart3 size={18} /> },
    { key: 'absence_followup', label: t('absence_followup'), icon: <AlertTriangle size={18} /> },
    { key: 'supervisors', label: t('manage_supervisors'), icon: <UserCog size={18} />, adminOnly: true },
    { key: 'institution_settings', label: t('institution_settings'), icon: <Settings2 size={18} />, adminOnly: true },
    { key: 'database_settings', label: t('database_settings'), icon: <Database size={18} />, adminOnly: true },
    { key: 'backup', label: t('backup_restore'), icon: <Download size={18} /> },
    { key: 'developer_info', label: t('developer_info'), icon: <Code2 size={18} /> },
    { key: 'settings', label: t('settings_lang'), icon: <Settings size={18} /> },
  ];

  const visibleItems = items.filter((i) => !i.adminOnly || profile?.role === 'admin');

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg)' }}>
      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 start-0 z-40 w-72 surface border-e border-app flex flex-col transition-transform ${sidebarOpen ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full lg:translate-x-0'}`}
      >
        <div className="px-4 py-5 border-b border-app">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white" style={{ background: 'linear-gradient(135deg, #0e7490, #155e75)' }}>
              <GraduationCap size={24} />
            </div>
            <div className="min-w-0">
              <div className="font-bold truncate">{t('app_name')}</div>
              <div className="text-xs text-muted truncate">{institution?.name ?? t('edutrack')}</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {visibleItems.map((item) => (
            <button
              key={item.key}
              onClick={() => { setPage(item.key); setSidebarOpen(false); }}
              className={`nav-link ${page === item.key ? 'active' : ''}`}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-app space-y-1">
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted">
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
              {profile?.role === 'admin' ? <ShieldCheckSmall /> : <UserCog size={15} />}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--text)] truncate">{profile?.full_name || profile?.email}</div>
              <div className="truncate">{profile?.role === 'admin' ? t('admin') : t('supervisor')}</div>
            </div>
          </div>
          <button onClick={() => signOut()} className="nav-link text-[var(--error)]">
            <LogOut size={18} />
            <span>{t('sign_out')}</span>
          </button>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="surface border-b border-app px-4 py-3 flex items-center gap-3 sticky top-0 z-20">
          <button onClick={() => setSidebarOpen(true)} className="btn btn-ghost p-2 lg:hidden">
            <Menu size={20} />
          </button>
          <h2 className="text-lg font-semibold flex-1 truncate">{visibleItems.find((i) => i.key === page)?.label}</h2>
          <SyncIndicator />
          <button onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} className="btn btn-ghost p-2" title={t('language')}>
            <Globe size={18} />
          </button>
          <button onClick={toggleDark} className="btn btn-ghost p-2" title={t('theme')}>
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>

        <main className="flex-1 p-4 lg:p-6 overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}

function ShieldCheckSmall() {
  return <ShieldCheckMini />;
}
function ShieldCheckMini() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
