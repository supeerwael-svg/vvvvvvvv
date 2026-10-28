/*
# EduTrack — Full initial schema (part 1: tables only)

Creates all tables with institution isolation. RLS policies added in part 2.
*/
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  joining_code text UNIQUE,
  code_revoked_at timestamptz,
  code_expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  institution_id uuid REFERENCES institutions(id) ON DELETE SET NULL,
  role text NOT NULL DEFAULT 'supervisor' CHECK (role IN ('admin','supervisor')),
  full_name text NOT NULL DEFAULT '',
  email text,
  disabled boolean NOT NULL DEFAULT false,
  force_password_change boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'supervisor' CHECK (role IN ('admin','supervisor')),
  approved boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  applicant_email text NOT NULL,
  applicant_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name text NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(institution_id, name)
);

CREATE TABLE IF NOT EXISTS class_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(profile_id, class_id)
);

CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  birth_date date,
  gender text CHECK (gender IN ('male','female') OR gender IS NULL),
  repetition_status text NOT NULL DEFAULT 'new',
  boarding text NOT NULL DEFAULT 'day' CHECK (boarding IN ('day','half_board','boarder','external')),
  enrolled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_students_inst ON students(institution_id);

CREATE TABLE IF NOT EXISTS lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  week_day text NOT NULL CHECK (week_day IN ('sunday','monday','tuesday','wednesday','thursday','friday','saturday')),
  subject text NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 60,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lessons_class_day ON lessons(class_id, week_day);

CREATE TABLE IF NOT EXISTS attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES lessons(id) ON DELETE CASCADE,
  record_date date NOT NULL,
  subject_snapshot text NOT NULL DEFAULT '',
  start_time_snapshot text NOT NULL DEFAULT '',
  end_time_snapshot text NOT NULL DEFAULT '',
  duration_minutes_snapshot integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'absent' CHECK (status IN ('absent','present','excused')),
  recorded_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_att_unique_stu_lesson_date ON attendance_records(student_id, lesson_id, record_date) WHERE lesson_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_att_class_date ON attendance_records(class_id, record_date);

CREATE TABLE IF NOT EXISTS teacher_absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id uuid REFERENCES classes(id) ON DELETE SET NULL,
  teacher_name text NOT NULL,
  subject text,
  record_date date NOT NULL,
  start_time text,
  end_time text,
  reason text,
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  cancelled_by uuid REFERENCES auth.users(id),
  cancelled_at timestamptz,
  recorded_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ta_inst_date ON teacher_absences(institution_id, record_date);

CREATE TABLE IF NOT EXISTS absence_episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  consecutive_absent_days integer NOT NULL DEFAULT 1,
  first_notice_date date,
  second_notice_date date,
  prolonged_notice_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ae_student ON absence_episodes(student_id);

CREATE TABLE IF NOT EXISTS teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teacher_class_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(teacher_id, class_id, subject)
);

CREATE TABLE IF NOT EXISTS teacher_lesson_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject text NOT NULL,
  week_day text NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(teacher_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS institution_settings (
  institution_id uuid PRIMARY KEY REFERENCES institutions(id) ON DELETE CASCADE,
  working_days text[] NOT NULL DEFAULT ARRAY['sunday','monday','tuesday','wednesday','thursday'],
  first_notice_days integer NOT NULL DEFAULT 3,
  second_notice_days integer NOT NULL DEFAULT 7,
  prolonged_notice_days integer NOT NULL DEFAULT 15,
  excused_counts_as_absent boolean NOT NULL DEFAULT false,
  excel_template_url text,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES institutions(id) ON DELETE CASCADE,
  actor text,
  action text NOT NULL,
  detail jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_inst ON audit_events(institution_id);

CREATE TABLE IF NOT EXISTS developer_info (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  dev_name text NOT NULL DEFAULT '',
  app_name text NOT NULL DEFAULT 'EduTrack',
  app_version text NOT NULL DEFAULT '1.0.0',
  contact_email text,
  contact_phone text,
  website text,
  description text,
  support_hours text,
  whatsapp_group_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pending_sync_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES institutions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('insert','update','delete')),
  record_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','synced','failed')),
  created_at timestamptz DEFAULT now(),
  synced_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_pso_user_status ON pending_sync_operations(user_id, status);

-- Duration auto-calc trigger
CREATE OR REPLACE FUNCTION calc_lesson_duration()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.end_time IS NOT NULL AND NEW.start_time IS NOT NULL THEN
    NEW.duration_minutes := (split_part(NEW.end_time, ':', 1)::int * 60 + split_part(NEW.end_time, ':', 2)::int)
                           - (split_part(NEW.start_time, ':', 1)::int * 60 + split_part(NEW.start_time, ':', 2)::int);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lesson_duration ON lessons;
CREATE TRIGGER trg_lesson_duration BEFORE INSERT OR UPDATE ON lessons
  FOR EACH ROW EXECUTE FUNCTION calc_lesson_duration();
