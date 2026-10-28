export type UserRole = 'admin' | 'supervisor';
export type AttendanceStatus = 'absent' | 'present' | 'excused';
export type StudentBoarding = 'day' | 'half_board' | 'boarder' | 'external';
export type WeekDay = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
export type EpisodeStatus = 'open' | 'closed';

export interface Institution {
  id: string;
  name: string;
  joining_code: string | null;
  code_revoked_at: string | null;
  code_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  user_id: string;
  institution_id: string | null;
  role: UserRole;
  full_name: string;
  email: string | null;
  disabled: boolean;
  force_password_change: boolean;
  created_at: string;
  updated_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  institution_id: string;
  role: UserRole;
  approved: boolean;
  created_at: string;
}

export interface ClassRow {
  id: string;
  institution_id: string;
  name: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClassAssignment {
  id: string;
  profile_id: string;
  class_id: string;
  created_at: string;
}

export interface Student {
  id: string;
  institution_id: string;
  class_id: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  gender: 'male' | 'female' | null;
  repetition_status: string;
  boarding: StudentBoarding;
  enrolled: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Lesson {
  id: string;
  class_id: string;
  week_day: WeekDay;
  subject: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  room: string | null;
  effective_from: string;
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  institution_id: string;
  class_id: string;
  student_id: string;
  lesson_id: string | null;
  record_date: string;
  subject_snapshot: string;
  start_time_snapshot: string;
  end_time_snapshot: string;
  duration_minutes_snapshot: number;
  status: AttendanceStatus;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
}

export type TeacherAbsenceStatus = 'active' | 'cancelled';

export interface TeacherAbsence {
  id: string;
  institution_id: string;
  class_id: string | null;
  teacher_name: string;
  subject: string | null;
  record_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  notes: string | null;
  status: TeacherAbsenceStatus;
  cancelled_by: string | null;
  cancelled_at: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AbsenceEpisode {
  id: string;
  institution_id: string;
  student_id: string;
  class_id: string;
  start_date: string;
  end_date: string | null;
  status: EpisodeStatus;
  consecutive_absent_days: number;
  first_notice_date: string | null;
  second_notice_date: string | null;
  prolonged_notice_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEvent {
  id: string;
  institution_id: string | null;
  actor: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface InstitutionSettings {
  institution_id: string;
  working_days: WeekDay[];
  first_notice_days: number;
  second_notice_days: number;
  prolonged_notice_days: number;
  excused_counts_as_absent: boolean;
  excel_template_url: string | null;
  total_rooms: number;
  updated_at: string;
}

export const WEEK_DAYS: WeekDay[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const DEFAULT_WORKING_DAYS: WeekDay[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];

export type JoinRequestStatus = 'pending' | 'accepted' | 'rejected';

export interface JoinRequest {
  id: string;
  institution_id: string;
  applicant_email: string;
  applicant_name: string;
  status: JoinRequestStatus;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Teacher {
  id: string;
  institution_id: string;
  name: string;
  email: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface TeacherClassAssignment {
  id: string;
  institution_id: string;
  teacher_id: string;
  class_id: string;
  subject: string;
  created_at: string;
}

export interface TeacherLessonAssignment {
  id: string;
  institution_id: string;
  teacher_id: string;
  lesson_id: string;
  class_id: string;
  subject: string;
  week_day: WeekDay;
  start_time: string;
  end_time: string;
  created_at: string;
}

export interface DeveloperInfo {
  id: string;
  institution_id: string;
  dev_name: string;
  app_name: string;
  app_version: string;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  description: string | null;
  support_hours: string | null;
  whatsapp_group_url: string | null;
  created_at: string;
  updated_at: string;
}
