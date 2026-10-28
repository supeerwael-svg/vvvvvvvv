import { useState } from 'react';
import { Clock, CheckCircle2, XCircle, LogOut } from 'lucide-react';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { AuthProvider, useAuth } from '@/lib/auth';
import Login from '@/components/Login';
import Layout, { type PageKey } from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import Classes from '@/pages/Classes';
import Students from '@/pages/Students';
import Timetables from '@/pages/Timetables';
import TeacherAssignments from '@/pages/TeacherAssignments';
import Attendance from '@/pages/Attendance';
import TeacherAbsencePage from '@/pages/TeacherAbsence';
import DailyReports from '@/pages/DailyReports';
import MonthlyReports from '@/pages/MonthlyReports';
import StudentStats from '@/pages/StudentStats';
import AbsenceFollowup from '@/pages/AbsenceFollowup';
import Supervisors from '@/pages/Supervisors';
import InstitutionSettingsPage from '@/pages/InstitutionSettingsPage';
import DatabaseSettings from '@/pages/DatabaseSettings';
import BackupRestore from '@/pages/BackupRestore';
import DeveloperInfoPage from '@/pages/DeveloperInfoPage';
import SettingsPage from '@/pages/SettingsPage';
import { Spinner } from '@/components/ui';

function PendingScreen() {
  const { t } = useI18n();
  const { profile, joinRequestInfo, signOut } = useAuth();

  const status = joinRequestInfo?.status ?? 'pending';
  const icon = status === 'accepted' ? <CheckCircle2 size={48} /> :
    status === 'rejected' ? <XCircle size={48} /> :
    <Clock size={48} />;

  const color = status === 'accepted' ? 'var(--success)' :
    status === 'rejected' ? 'var(--error)' :
    'var(--warning)';

  const message = status === 'accepted' ? t('request_status_accepted') :
    status === 'rejected' ? t('request_status_rejected') :
    t('request_status_pending');

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
      <div className="card max-w-md w-full text-center space-y-4">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mx-auto" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
          {icon}
        </div>
        <h2 className="text-xl font-bold">{profile?.full_name || profile?.email}</h2>
        <p className="text-sm text-muted">{message}</p>
        {joinRequestInfo && status === 'pending' && (
          <div className="surface-2 rounded-lg p-3 text-xs text-muted">
            <div>{t('institution_name')}: {joinRequestInfo.institutionName}</div>
            <div>{t('request_date')}: {new Date(joinRequestInfo.createdAt).toLocaleDateString('ar-DZ')}</div>
          </div>
        )}
        <button onClick={() => signOut()} className="btn btn-ghost mt-4">
          <LogOut size={18} />{t('sign_out')}
        </button>
      </div>
    </div>
  );
}

function Shell() {
  const { t } = useI18n();
  const { session, profile, institution, joinRequestInfo, loading } = useAuth();
  const [page, setPage] = useState<PageKey>('home');

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Spinner label={t('loading')} /></div>;
  }

  if (!session) return <Login />;

  if (session && (!profile?.institution_id || !institution)) {
    if (joinRequestInfo) {
      return <PendingScreen />;
    }
    return <div className="min-h-screen flex items-center justify-center"><Spinner label={t('loading')} /></div>;
  }

  const pages: Record<PageKey, React.ReactNode> = {
    home: <Dashboard setPage={setPage} />,
    classes: <Classes />,
    students: <Students />,
    timetables: <Timetables />,
    teacher_assignments: <TeacherAssignments />,
    attendance: <Attendance />,
    teacher_absence: <TeacherAbsencePage />,
    daily_reports: <DailyReports />,
    monthly_reports: <MonthlyReports />,
    student_stats: <StudentStats />,
    absence_followup: <AbsenceFollowup />,
    supervisors: <Supervisors />,
    institution_settings: <InstitutionSettingsPage />,
    database_settings: <DatabaseSettings />,
    backup: <BackupRestore />,
    developer_info: <DeveloperInfoPage />,
    settings: <SettingsPage />,
  };

  return (
    <Layout page={page} setPage={setPage}>
      {pages[page]}
    </Layout>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </I18nProvider>
  );
}
