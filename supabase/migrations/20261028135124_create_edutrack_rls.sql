/*
# EduTrack — RLS policies, helper functions, and RPCs

Adds Row Level Security to every table with institution-scoped access.
Admins see all rows in their institution; supervisors see only their assigned classes.
Also creates join-request RPCs used by the auth flow.
*/

-- Helper functions (must come before policies that use them)
CREATE OR REPLACE FUNCTION is_inst_member(uid uuid, inst_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = uid AND p.institution_id = inst_id);
$$;

CREATE OR REPLACE FUNCTION can_access_class(uid uuid, cls_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = uid
    AND p.institution_id = (SELECT c.institution_id FROM classes c WHERE c.id = cls_id)
    AND (p.role = 'admin' OR EXISTS (
      SELECT 1 FROM class_assignments ca WHERE ca.profile_id = uid AND ca.class_id = cls_id
    ))
  );
$$;

-- =========== INSTITUTIONS ===========
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON institutions TO authenticated;

DROP POLICY IF EXISTS "inst_select_member" ON institutions;
CREATE POLICY "inst_select_member" ON institutions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = institutions.id));
DROP POLICY IF EXISTS "inst_insert_signup" ON institutions;
CREATE POLICY "inst_insert_signup" ON institutions FOR INSERT TO authenticated
  WITH CHECK (true);
DROP POLICY IF EXISTS "inst_update_member" ON institutions;
CREATE POLICY "inst_update_member" ON institutions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = institutions.id AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = institutions.id AND p.role = 'admin'));

-- =========== PROFILES ===========
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON profiles TO authenticated;

DROP POLICY IF EXISTS "prof_select_self_or_inst" ON profiles;
CREATE POLICY "prof_select_self_or_inst" ON profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR (institution_id IS NOT NULL AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = profiles.institution_id)));
DROP POLICY IF EXISTS "prof_insert_self" ON profiles;
CREATE POLICY "prof_insert_self" ON profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "prof_update_self_or_admin" ON profiles;
CREATE POLICY "prof_update_self_or_admin" ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR (institution_id IS NOT NULL AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = profiles.institution_id AND p.role = 'admin')))
  WITH CHECK (true);

-- =========== MEMBERSHIPS ===========
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO authenticated;

DROP POLICY IF EXISTS "mem_select_inst" ON memberships;
CREATE POLICY "mem_select_inst" ON memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = memberships.institution_id AND p.role = 'admin'));
DROP POLICY IF EXISTS "mem_insert_self" ON memberships;
CREATE POLICY "mem_insert_self" ON memberships FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "mem_update_admin" ON memberships;
CREATE POLICY "mem_update_admin" ON memberships FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = memberships.institution_id AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = memberships.institution_id AND p.role = 'admin'));
DROP POLICY IF EXISTS "mem_delete_admin" ON memberships;
CREATE POLICY "mem_delete_admin" ON memberships FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = memberships.institution_id AND p.role = 'admin'));

-- =========== JOIN REQUESTS ===========
ALTER TABLE join_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON join_requests TO authenticated;

DROP POLICY IF EXISTS "jr_select_applicant_or_admin" ON join_requests;
CREATE POLICY "jr_select_applicant_or_admin" ON join_requests FOR SELECT TO authenticated
  USING (applicant_email = (SELECT email FROM auth.users WHERE id = auth.uid())
         OR EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = join_requests.institution_id AND p.role = 'admin'));
DROP POLICY IF EXISTS "jr_insert_self" ON join_requests;
CREATE POLICY "jr_insert_self" ON join_requests FOR INSERT TO authenticated
  WITH CHECK (applicant_email = (SELECT email FROM auth.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS "jr_update_admin" ON join_requests;
CREATE POLICY "jr_update_admin" ON join_requests FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = join_requests.institution_id AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = join_requests.institution_id AND p.role = 'admin'));

-- =========== CLASSES ===========
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON classes TO authenticated;

DROP POLICY IF EXISTS "cls_select_inst" ON classes;
CREATE POLICY "cls_select_inst" ON classes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = classes.institution_id));
DROP POLICY IF EXISTS "cls_insert_admin" ON classes;
CREATE POLICY "cls_insert_admin" ON classes FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = classes.institution_id AND p.role = 'admin'));
DROP POLICY IF EXISTS "cls_update_admin" ON classes;
CREATE POLICY "cls_update_admin" ON classes FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = classes.institution_id AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = classes.institution_id AND p.role = 'admin'));
DROP POLICY IF EXISTS "cls_delete_admin" ON classes;
CREATE POLICY "cls_delete_admin" ON classes FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = classes.institution_id AND p.role = 'admin'));

-- =========== CLASS ASSIGNMENTS ===========
ALTER TABLE class_assignments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON class_assignments TO authenticated;

DROP POLICY IF EXISTS "ca_select" ON class_assignments;
CREATE POLICY "ca_select" ON class_assignments FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = (SELECT c.institution_id FROM classes c WHERE c.id = class_assignments.class_id) AND p.role = 'admin'));
DROP POLICY IF EXISTS "ca_insert_admin" ON class_assignments;
CREATE POLICY "ca_insert_admin" ON class_assignments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = (SELECT c.institution_id FROM classes c WHERE c.id = class_assignments.class_id) AND p.role = 'admin'));
DROP POLICY IF EXISTS "ca_delete_admin" ON class_assignments;
CREATE POLICY "ca_delete_admin" ON class_assignments FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = (SELECT c.institution_id FROM classes c WHERE c.id = class_assignments.class_id) AND p.role = 'admin'));

-- =========== STUDENTS ===========
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON students TO authenticated;

DROP POLICY IF EXISTS "stu_select" ON students;
CREATE POLICY "stu_select" ON students FOR SELECT TO authenticated
  USING (can_access_class(auth.uid(), students.class_id));
DROP POLICY IF EXISTS "stu_insert" ON students;
CREATE POLICY "stu_insert" ON students FOR INSERT TO authenticated
  WITH CHECK (can_access_class(auth.uid(), students.class_id));
DROP POLICY IF EXISTS "stu_update" ON students;
CREATE POLICY "stu_update" ON students FOR UPDATE TO authenticated
  USING (can_access_class(auth.uid(), students.class_id))
  WITH CHECK (can_access_class(auth.uid(), students.class_id));
DROP POLICY IF EXISTS "stu_delete" ON students;
CREATE POLICY "stu_delete" ON students FOR DELETE TO authenticated
  USING (can_access_class(auth.uid(), students.class_id));

-- =========== LESSONS ===========
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON lessons TO authenticated;

DROP POLICY IF EXISTS "les_select" ON lessons;
CREATE POLICY "les_select" ON lessons FOR SELECT TO authenticated
  USING (can_access_class(auth.uid(), lessons.class_id));
DROP POLICY IF EXISTS "les_insert" ON lessons;
CREATE POLICY "les_insert" ON lessons FOR INSERT TO authenticated
  WITH CHECK (can_access_class(auth.uid(), lessons.class_id));
DROP POLICY IF EXISTS "les_update" ON lessons;
CREATE POLICY "les_update" ON lessons FOR UPDATE TO authenticated
  USING (can_access_class(auth.uid(), lessons.class_id))
  WITH CHECK (can_access_class(auth.uid(), lessons.class_id));
DROP POLICY IF EXISTS "les_delete" ON lessons;
CREATE POLICY "les_delete" ON lessons FOR DELETE TO authenticated
  USING (can_access_class(auth.uid(), lessons.class_id));

-- =========== ATTENDANCE RECORDS ===========
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_records TO authenticated;

DROP POLICY IF EXISTS "att_select" ON attendance_records;
CREATE POLICY "att_select" ON attendance_records FOR SELECT TO authenticated
  USING (can_access_class(auth.uid(), attendance_records.class_id));
DROP POLICY IF EXISTS "att_insert" ON attendance_records;
CREATE POLICY "att_insert" ON attendance_records FOR INSERT TO authenticated
  WITH CHECK (can_access_class(auth.uid(), attendance_records.class_id));
DROP POLICY IF EXISTS "att_update" ON attendance_records;
CREATE POLICY "att_update" ON attendance_records FOR UPDATE TO authenticated
  USING (can_access_class(auth.uid(), attendance_records.class_id))
  WITH CHECK (can_access_class(auth.uid(), attendance_records.class_id));
DROP POLICY IF EXISTS "att_delete" ON attendance_records;
CREATE POLICY "att_delete" ON attendance_records FOR DELETE TO authenticated
  USING (can_access_class(auth.uid(), attendance_records.class_id));

-- =========== TEACHER ABSENCES ===========
ALTER TABLE teacher_absences ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON teacher_absences TO authenticated;

DROP POLICY IF EXISTS "ta_select" ON teacher_absences;
CREATE POLICY "ta_select" ON teacher_absences FOR SELECT TO authenticated
  USING (is_inst_member(auth.uid(), teacher_absences.institution_id));
DROP POLICY IF EXISTS "ta_insert" ON teacher_absences;
CREATE POLICY "ta_insert" ON teacher_absences FOR INSERT TO authenticated
  WITH CHECK (is_inst_member(auth.uid(), teacher_absences.institution_id));
DROP POLICY IF EXISTS "ta_update" ON teacher_absences;
CREATE POLICY "ta_update" ON teacher_absences FOR UPDATE TO authenticated
  USING (is_inst_member(auth.uid(), teacher_absences.institution_id))
  WITH CHECK (is_inst_member(auth.uid(), teacher_absences.institution_id));
DROP POLICY IF EXISTS "ta_delete" ON teacher_absences;
CREATE POLICY "ta_delete" ON teacher_absences FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = teacher_absences.institution_id AND p.role = 'admin'));

-- =========== ABSENCE EPISODES ===========
ALTER TABLE absence_episodes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON absence_episodes TO authenticated;

DROP POLICY IF EXISTS "ae_select" ON absence_episodes;
CREATE POLICY "ae_select" ON absence_episodes FOR SELECT TO authenticated
  USING (can_access_class(auth.uid(), absence_episodes.class_id));
DROP POLICY IF EXISTS "ae_insert" ON absence_episodes;
CREATE POLICY "ae_insert" ON absence_episodes FOR INSERT TO authenticated
  WITH CHECK (can_access_class(auth.uid(), absence_episodes.class_id));
DROP POLICY IF EXISTS "ae_update" ON absence_episodes;
CREATE POLICY "ae_update" ON absence_episodes FOR UPDATE TO authenticated
  USING (can_access_class(auth.uid(), absence_episodes.class_id))
  WITH CHECK (can_access_class(auth.uid(), absence_episodes.class_id));
DROP POLICY IF EXISTS "ae_delete" ON absence_episodes;
CREATE POLICY "ae_delete" ON absence_episodes FOR DELETE TO authenticated
  USING (can_access_class(auth.uid(), absence_episodes.class_id));

-- =========== TEACHERS ===========
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON teachers TO authenticated;

DROP POLICY IF EXISTS "tcr_select" ON teachers;
CREATE POLICY "tcr_select" ON teachers FOR SELECT TO authenticated
  USING (is_inst_member(auth.uid(), teachers.institution_id));
DROP POLICY IF EXISTS "tcr_insert" ON teachers;
CREATE POLICY "tcr_insert" ON teachers FOR INSERT TO authenticated
  WITH CHECK (is_inst_member(auth.uid(), teachers.institution_id));
DROP POLICY IF EXISTS "tcr_update" ON teachers;
CREATE POLICY "tcr_update" ON teachers FOR UPDATE TO authenticated
  USING (is_inst_member(auth.uid(), teachers.institution_id))
  WITH CHECK (is_inst_member(auth.uid(), teachers.institution_id));
DROP POLICY IF EXISTS "tcr_delete" ON teachers;
CREATE POLICY "tcr_delete" ON teachers FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = teachers.institution_id AND p.role = 'admin'));

-- =========== TEACHER CLASS ASSIGNMENTS ===========
ALTER TABLE teacher_class_assignments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON teacher_class_assignments TO authenticated;

DROP POLICY IF EXISTS "tca_select" ON teacher_class_assignments;
CREATE POLICY "tca_select" ON teacher_class_assignments FOR SELECT TO authenticated
  USING (is_inst_member(auth.uid(), teacher_class_assignments.institution_id));
DROP POLICY IF EXISTS "tca_insert" ON teacher_class_assignments;
CREATE POLICY "tca_insert" ON teacher_class_assignments FOR INSERT TO authenticated
  WITH CHECK (is_inst_member(auth.uid(), teacher_class_assignments.institution_id));
DROP POLICY IF EXISTS "tca_update" ON teacher_class_assignments;
CREATE POLICY "tca_update" ON teacher_class_assignments FOR UPDATE TO authenticated
  USING (is_inst_member(auth.uid(), teacher_class_assignments.institution_id))
  WITH CHECK (is_inst_member(auth.uid(), teacher_class_assignments.institution_id));
DROP POLICY IF EXISTS "tca_delete" ON teacher_class_assignments;
CREATE POLICY "tca_delete" ON teacher_class_assignments FOR DELETE TO authenticated
  USING (is_inst_member(auth.uid(), teacher_class_assignments.institution_id));

-- =========== TEACHER LESSON ASSIGNMENTS ===========
ALTER TABLE teacher_lesson_assignments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON teacher_lesson_assignments TO authenticated;

DROP POLICY IF EXISTS "tla_select" ON teacher_lesson_assignments;
CREATE POLICY "tla_select" ON teacher_lesson_assignments FOR SELECT TO authenticated
  USING (is_inst_member(auth.uid(), teacher_lesson_assignments.institution_id));
DROP POLICY IF EXISTS "tla_insert" ON teacher_lesson_assignments;
CREATE POLICY "tla_insert" ON teacher_lesson_assignments FOR INSERT TO authenticated
  WITH CHECK (is_inst_member(auth.uid(), teacher_lesson_assignments.institution_id));
DROP POLICY IF EXISTS "tla_update" ON teacher_lesson_assignments;
CREATE POLICY "tla_update" ON teacher_lesson_assignments FOR UPDATE TO authenticated
  USING (is_inst_member(auth.uid(), teacher_lesson_assignments.institution_id))
  WITH CHECK (is_inst_member(auth.uid(), teacher_lesson_assignments.institution_id));
DROP POLICY IF EXISTS "tla_delete" ON teacher_lesson_assignments;
CREATE POLICY "tla_delete" ON teacher_lesson_assignments FOR DELETE TO authenticated
  USING (is_inst_member(auth.uid(), teacher_lesson_assignments.institution_id));

-- =========== INSTITUTION SETTINGS ===========
ALTER TABLE institution_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON institution_settings TO authenticated;

DROP POLICY IF EXISTS "iset_select" ON institution_settings;
CREATE POLICY "iset_select" ON institution_settings FOR SELECT TO authenticated
  USING (is_inst_member(auth.uid(), institution_settings.institution_id));
DROP POLICY IF EXISTS "iset_insert_admin" ON institution_settings;
CREATE POLICY "iset_insert_admin" ON institution_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = institution_settings.institution_id AND p.role = 'admin'));
DROP POLICY IF EXISTS "iset_update_admin" ON institution_settings;
CREATE POLICY "iset_update_admin" ON institution_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = institution_settings.institution_id AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = institution_settings.institution_id AND p.role = 'admin'));

-- =========== AUDIT EVENTS ===========
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON audit_events TO authenticated;

DROP POLICY IF EXISTS "audit_select" ON audit_events;
CREATE POLICY "audit_select" ON audit_events FOR SELECT TO authenticated
  USING (institution_id IS NULL OR is_inst_member(auth.uid(), audit_events.institution_id));
DROP POLICY IF EXISTS "audit_insert" ON audit_events;
CREATE POLICY "audit_insert" ON audit_events FOR INSERT TO authenticated
  WITH CHECK (true);

-- =========== DEVELOPER INFO ===========
ALTER TABLE developer_info ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON developer_info TO authenticated;

DROP POLICY IF EXISTS "dev_select" ON developer_info;
CREATE POLICY "dev_select" ON developer_info FOR SELECT TO authenticated
  USING (is_inst_member(auth.uid(), developer_info.institution_id));
DROP POLICY IF EXISTS "dev_insert" ON developer_info;
CREATE POLICY "dev_insert" ON developer_info FOR INSERT TO authenticated
  WITH CHECK (is_inst_member(auth.uid(), developer_info.institution_id));
DROP POLICY IF EXISTS "dev_update" ON developer_info;
CREATE POLICY "dev_update" ON developer_info FOR UPDATE TO authenticated
  USING (is_inst_member(auth.uid(), developer_info.institution_id))
  WITH CHECK (is_inst_member(auth.uid(), developer_info.institution_id));
DROP POLICY IF EXISTS "dev_delete" ON developer_info;
CREATE POLICY "dev_delete" ON developer_info FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.institution_id = developer_info.institution_id AND p.role = 'admin'));

-- =========== PENDING SYNC OPERATIONS ===========
ALTER TABLE pending_sync_operations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON pending_sync_operations TO authenticated;

DROP POLICY IF EXISTS "pso_select_self" ON pending_sync_operations;
CREATE POLICY "pso_select_self" ON pending_sync_operations FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "pso_insert_self" ON pending_sync_operations;
CREATE POLICY "pso_insert_self" ON pending_sync_operations FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "pso_update_self" ON pending_sync_operations;
CREATE POLICY "pso_update_self" ON pending_sync_operations FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "pso_delete_self" ON pending_sync_operations;
CREATE POLICY "pso_delete_self" ON pending_sync_operations FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =========== JOIN REQUEST RPCs ===========
CREATE OR REPLACE FUNCTION submit_join_request(p_institution_code text, p_email text, p_full_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inst institutions%ROWTYPE;
  v_existing join_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_inst FROM institutions WHERE joining_code = p_institution_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_code');
  END IF;
  IF v_inst.code_revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'code_revoked');
  END IF;
  IF v_inst.code_expires_at IS NOT NULL AND v_inst.code_expires_at < now() THEN
    RETURN jsonb_build_object('error', 'code_expired');
  END IF;
  SELECT * INTO v_existing FROM join_requests
    WHERE institution_id = v_inst.id AND applicant_email = p_email AND status = 'pending';
  IF FOUND THEN
    RETURN jsonb_build_object('error', 'duplicate_pending');
  END IF;
  SELECT * INTO v_existing FROM join_requests
    WHERE institution_id = v_inst.id AND applicant_email = p_email AND status = 'accepted';
  IF FOUND THEN
    RETURN jsonb_build_object('error', 'already_member');
  END IF;
  INSERT INTO join_requests (institution_id, applicant_email, applicant_name, status)
    VALUES (v_inst.id, p_email, p_full_name, 'pending');
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION get_own_join_request_status()
RETURNS TABLE(status text, institution_name text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  RETURN QUERY
    SELECT jr.status::text, i.name, jr.created_at
    FROM join_requests jr
    JOIN institutions i ON i.id = jr.institution_id
    WHERE jr.applicant_email = v_email
    ORDER BY jr.created_at DESC
    LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION submit_join_request(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION submit_join_request(text, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION get_own_join_request_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_own_join_request_status() TO authenticated;

-- Auto-create profile row when a new auth user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, '')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
