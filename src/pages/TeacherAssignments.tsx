import { useEffect, useState, useMemo, useCallback } from 'react';
import { GraduationCap, Plus, Pencil, Trash2, AlertCircle, Clock, Filter, ChevronDown, ChevronRight } from 'lucide-react';
import { useI18n, weekDayLabel } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Modal, EmptyState, Spinner, ConfirmDialog } from '@/components/ui';
import { timeToMinutes, minutesToHHMM } from '@/lib/utils';
import { DEFAULT_WORKING_DAYS, type ClassRow, type Lesson, type Teacher, type TeacherLessonAssignment, type WeekDay } from '@/lib/types';

interface LessonWithClass extends Lesson {
  classes: { name: string };
}

interface AssignmentWithJoins extends TeacherLessonAssignment {
  teachers: { name: string };
  classes: { name: string };
}

export default function TeacherAssignments() {
  const { t, lang } = useI18n();
  const { profile } = useAuth();
  const instId = profile?.institution_id;
  const isAdmin = profile?.role === 'admin';

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentWithJoins[]>([]);
  const [lessonsByClass, setLessonsByClass] = useState<Record<string, Lesson[]>>({});
  const [loading, setLoading] = useState(true);

  const [teacherModal, setTeacherModal] = useState<{ open: boolean; edit?: Teacher }>({ open: false });
  const [teacherForm, setTeacherForm] = useState({ name: '', email: '' });

  const [assignModal, setAssignModal] = useState(false);
  const [assignForm, setAssignForm] = useState({ teacherId: '', classId: '', lessonId: '' });
  const [assignError, setAssignError] = useState<string | null>(null);

  const [confirmDel, setConfirmDel] = useState<AssignmentWithJoins | null>(null);
  const [expandedTeacher, setExpandedTeacher] = useState<string | null>(null);

  const [filters, setFilters] = useState({ teacherId: '', classId: '', subject: '', weekDay: '' });

  const loadAll = useCallback(async () => {
    if (!instId) { setLoading(false); return; }
    setLoading(true);
    const [tRes, cRes, aRes] = await Promise.all([
      supabase.from('teachers').select('*').eq('institution_id', instId).order('name'),
      supabase.from('classes').select('*').eq('institution_id', instId).order('name'),
      supabase.from('teacher_lesson_assignments').select('*, teachers(name), classes(name)').eq('institution_id', instId).order('created_at'),
    ]);
    setTeachers((tRes.data ?? []) as Teacher[]);
    setClasses((cRes.data ?? []) as ClassRow[]);
    setAssignments((aRes.data ?? []) as AssignmentWithJoins[]);

    const lessonMap: Record<string, Lesson[]> = {};
    for (const c of (cRes.data ?? []) as ClassRow[]) {
      const { data: les } = await supabase.from('lessons').select('*').eq('class_id', c.id).order('week_day').order('start_time');
      lessonMap[c.id] = (les ?? []) as Lesson[];
    }
    setLessonsByClass(lessonMap);
    setLoading(false);
  }, [instId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const allSubjects = useMemo(() => {
    const set = new Set<string>();
    assignments.forEach((a) => set.add(a.subject));
    Object.values(lessonsByClass).flat().forEach((l) => set.add(l.subject));
    return [...set].sort();
  }, [assignments, lessonsByClass]);

  const filtered = useMemo(() => {
    return assignments.filter((a) => {
      if (filters.teacherId && a.teacher_id !== filters.teacherId) return false;
      if (filters.classId && a.class_id !== filters.classId) return false;
      if (filters.subject && a.subject !== filters.subject) return false;
      if (filters.weekDay && a.week_day !== filters.weekDay) return false;
      return true;
    });
  }, [assignments, filters]);

  // Group filtered assignments by teacher
  const byTeacher = useMemo(() => {
    const map = new Map<string, AssignmentWithJoins[]>();
    for (const a of filtered) {
      const arr = map.get(a.teacher_id) ?? [];
      arr.push(a);
      map.set(a.teacher_id, arr);
    }
    return map;
  }, [filtered]);

  // Workload calculation: sum lesson durations per teacher, deduplicating by lesson_id
  const workloadByTeacher = useMemo(() => {
    const map = new Map<string, { totalMinutes: number; lessonCount: number; byDay: Record<string, number> }>();
    for (const a of filtered) {
      const key = a.lesson_id;
      // Deduplicate: if the same lesson_id appears multiple times, count once
      const seen = new Set<string>();
      if (seen.has(key)) continue;
      seen.add(key);

      const dur = timeToMinutes(a.end_time) - timeToMinutes(a.start_time);
      if (dur <= 0) continue;

      const entry = map.get(a.teacher_id) ?? { totalMinutes: 0, lessonCount: 0, byDay: {} as Record<string, number> };
      entry.totalMinutes += dur;
      entry.lessonCount += 1;
      entry.byDay[a.week_day] = (entry.byDay[a.week_day] ?? 0) + dur;
      map.set(a.teacher_id, entry);
    }
    return map;
  }, [filtered]);

  const formatWorkload = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h} ${t('hours_minutes')} ${m} ${t('minutes_weekly')}`;
  };

  const openAddTeacher = () => { setTeacherForm({ name: '', email: '' }); setTeacherModal({ open: true }); };
  const openEditTeacher = (tch: Teacher) => { setTeacherForm({ name: tch.name, email: tch.email ?? '' }); setTeacherModal({ open: true, edit: tch }); };

  const saveTeacher = async () => {
    if (!instId || !teacherForm.name.trim()) return;
    if (teacherModal.edit) {
      await supabase.from('teachers').update({ name: teacherForm.name.trim(), email: teacherForm.email.trim() || null }).eq('id', teacherModal.edit.id);
    } else {
      await supabase.from('teachers').insert({ institution_id: instId, name: teacherForm.name.trim(), email: teacherForm.email.trim() || null });
    }
    setTeacherModal({ open: false });
    loadAll();
  };

  const openAssign = () => {
    setAssignForm({ teacherId: '', classId: '', lessonId: '' });
    setAssignError(null);
    setAssignModal(true);
  };

  const selectedLessons = assignForm.classId ? (lessonsByClass[assignForm.classId] ?? []) : [];

  const checkConflict = (teacherId: string, weekDay: WeekDay, start: string, end: string, excludeId?: string): string | null => {
    const s = timeToMinutes(start), e = timeToMinutes(end);
    const conflict = assignments.find((a) => {
      if (a.teacher_id !== teacherId) return false;
      if (a.week_day !== weekDay) return false;
      if (excludeId && a.id === excludeId) return false;
      const ls = timeToMinutes(a.start_time), le = timeToMinutes(a.end_time);
      return s < le && e > ls;
    });
    return conflict ? `${conflict.teachers.name}: ${conflict.subject} ${conflict.start_time}-${conflict.end_time}` : null;
  };

  const saveAssignment = async () => {
    if (!instId || !assignForm.teacherId || !assignForm.lessonId) return;
    setAssignError(null);

    const lesson = (lessonsByClass[assignForm.classId] ?? []).find((l) => l.id === assignForm.lessonId);
    if (!lesson) { setAssignError(t('select_lesson')); return; }

    // Duplicate check
    const dup = assignments.find((a) => a.teacher_id === assignForm.teacherId && a.lesson_id === assignForm.lessonId);
    if (dup) { setAssignError(t('duplicate_assignment_warning')); return; }

    // Overlap check
    const conflict = checkConflict(assignForm.teacherId, lesson.week_day, lesson.start_time, lesson.end_time);
    if (conflict) { setAssignError(`${t('assignment_overlap_warning')}: ${conflict}`); return; }

    const { error } = await supabase.from('teacher_lesson_assignments').insert({
      institution_id: instId,
      teacher_id: assignForm.teacherId,
      lesson_id: assignForm.lessonId,
      class_id: assignForm.classId,
      subject: lesson.subject,
      week_day: lesson.week_day,
      start_time: lesson.start_time,
      end_time: lesson.end_time,
    });

    if (error) { setAssignError(error.message); return; }
    setAssignModal(false);
    loadAll();
  };

  const removeAssignment = async (a: AssignmentWithJoins) => {
    await supabase.from('teacher_lesson_assignments').delete().eq('id', a.id);
    setConfirmDel(null);
    loadAll();
  };

  if (loading) return <Spinner label={t('loading')} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <h3 className="font-semibold">{t('teacher_assignments')}</h3>
        {isAdmin && (
          <div className="flex gap-2">
            <button onClick={openAddTeacher} className="btn btn-ghost" style={{ border: '1px solid var(--border)' }}>
              <Plus size={16} />{t('add_teacher_record')}
            </button>
            <button onClick={openAssign} className="btn btn-primary" disabled={teachers.length === 0 || classes.length === 0}>
              <Plus size={16} />{t('assign_lesson')}
            </button>
          </div>
        )}
      </div>

      {/* Teacher records list (admin can edit) */}
      {teachers.length > 0 && (
        <div className="card space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted">
            <GraduationCap size={16} /> {t('teachers')} ({teachers.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {teachers.map((tch) => (
              <div key={tch.id} className="flex items-center gap-2 surface-2 rounded-lg px-3 py-1.5 text-sm">
                <span className="font-medium">{tch.name}</span>
                {tch.email && <span className="text-xs text-muted">{tch.email}</span>}
                {isAdmin && (
                  <button onClick={() => openEditTeacher(tch)} className="btn btn-ghost p-1">
                    <Pencil size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted">
          <Filter size={16} /> {t('search')}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <select className="input" value={filters.teacherId} onChange={(e) => setFilters({ ...filters, teacherId: e.target.value })}>
            <option value="">{t('filter_by_teacher')} — {t('all')}</option>
            {teachers.map((tch) => <option key={tch.id} value={tch.id}>{tch.name}</option>)}
          </select>
          <select className="input" value={filters.classId} onChange={(e) => setFilters({ ...filters, classId: e.target.value })}>
            <option value="">{t('filter_by_class')} — {t('all')}</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="input" value={filters.subject} onChange={(e) => setFilters({ ...filters, subject: e.target.value })}>
            <option value="">{t('filter_by_subject')} — {t('all')}</option>
            {allSubjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={filters.weekDay} onChange={(e) => setFilters({ ...filters, weekDay: e.target.value })}>
            <option value="">{t('filter_by_day')} — {t('all')}</option>
            {DEFAULT_WORKING_DAYS.map((d) => <option key={d} value={d}>{weekDayLabel(d, lang)}</option>)}
          </select>
        </div>
      </div>

      {/* Weekly workload summary table */}
      {byTeacher.size > 0 && (
        <div className="card overflow-x-auto">
          <h3 className="font-semibold mb-3">{t('weekly_workload')}</h3>
          <table className="w-full text-sm">
            <thead className="surface-2">
              <tr>
                <th className="p-2 text-start">{t('teacher_name')}</th>
                <th className="p-2 text-center">{t('weekly_lessons_count')}</th>
                <th className="p-2 text-center">{t('weekly_hours')}</th>
                {DEFAULT_WORKING_DAYS.map((d) => (
                  <th key={d} className="p-2 text-center text-xs">{weekDayLabel(d, lang)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...byTeacher.entries()].map(([teacherId, items]) => {
                const tch = teachers.find((t) => t.id === teacherId);
                const wl = workloadByTeacher.get(teacherId);
                return (
                  <tr key={teacherId} className="border-b border-app">
                    <td className="p-2 font-medium">{tch?.name ?? '—'}</td>
                    <td className="p-2 text-center">{wl?.lessonCount ?? 0}</td>
                    <td className="p-2 text-center font-semibold">{wl ? formatWorkload(wl.totalMinutes) : '—'}</td>
                    {DEFAULT_WORKING_DAYS.map((d) => (
                      <td key={d} className="p-2 text-center text-xs text-muted">
                        {wl?.byDay[d] ? minutesToHHMM(wl.byDay[d]) : '—'}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Assignments grouped by teacher with expandable detail */}
      {byTeacher.size === 0 ? (
        <div className="card"><EmptyState icon={<GraduationCap size={40} />} text={t('no_teacher_assignments')} /></div>
      ) : (
        <div className="space-y-3">
          {[...byTeacher.entries()].map(([teacherId, items]) => {
            const tch = teachers.find((t) => t.id === teacherId);
            const wl = workloadByTeacher.get(teacherId);
            const isExpanded = expandedTeacher === teacherId;
            return (
              <div key={teacherId} className="card">
                <button
                  onClick={() => setExpandedTeacher(isExpanded ? null : teacherId)}
                  className="flex items-center justify-between w-full text-start"
                >
                  <div className="flex items-center gap-2">
                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    <span className="font-semibold">{tch?.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted">
                    <span>{items.length} {t('weekly_lessons_count')}</span>
                    {wl && <span className="font-semibold" style={{ color: 'var(--primary-600)' }}>{formatWorkload(wl.totalMinutes)}</span>}
                  </div>
                </button>

                {isExpanded && (
                  <div className="mt-4 space-y-3">
                    {/* Workload explanation */}
                    <div className="surface-2 rounded-lg p-3 text-xs text-muted">
                      <div className="font-medium mb-1">{t('workload_explanation')}:</div>
                      {items.map((a, i) => {
                        const dur = timeToMinutes(a.end_time) - timeToMinutes(a.start_time);
                        return (
                          <div key={a.id}>
                            {i + 1}. {a.subject} — {a.classes.name} — {weekDayLabel(a.week_day, lang)} {a.start_time}-{a.end_time} = {dur}{t('minutes')}
                          </div>
                        );
                      })}
                      <div className="mt-1 font-medium" style={{ color: 'var(--primary-600)' }}>
                        {t('total')}: {wl ? formatWorkload(wl.totalMinutes) : '—'}
                      </div>
                    </div>

                    {/* Per-day breakdown */}
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {DEFAULT_WORKING_DAYS.map((day) => {
                        const dayItems = items.filter((a) => a.week_day === day).sort((a, b) => a.start_time.localeCompare(b.start_time));
                        if (dayItems.length === 0) return null;
                        const dayMins = dayItems.reduce((s, a) => s + (timeToMinutes(a.end_time) - timeToMinutes(a.start_time)), 0);
                        return (
                          <div key={day} className="surface-2 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium text-sm">{weekDayLabel(day, lang)}</span>
                              <span className="text-xs text-muted">{minutesToHHMM(dayMins)}</span>
                            </div>
                            <div className="space-y-1">
                              {dayItems.map((a) => (
                                <div key={a.id} className="flex items-center justify-between text-xs">
                                  <div>
                                    <span className="font-medium">{a.subject}</span>
                                    <span className="text-muted"> — {a.classes.name}</span>
                                    <div className="text-muted">{a.start_time} - {a.end_time}</div>
                                  </div>
                                  {isAdmin && (
                                    <button onClick={(e) => { e.stopPropagation(); setConfirmDel(a); }} className="btn btn-ghost p-1 text-[var(--error)]">
                                      <Trash2 size={12} />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {teachers.length === 0 && !loading && (
        <div className="card"><EmptyState icon={<GraduationCap size={40} />} text={t('no_teachers_found')} /></div>
      )}

      {/* Teacher modal */}
      <Modal open={teacherModal.open} onClose={() => setTeacherModal({ open: false })} title={teacherModal.edit ? t('edit_teacher_record') : t('add_teacher_record')}>
        <div className="space-y-4">
          <div>
            <label className="label">{t('teacher_full_name')}</label>
            <input className="input" value={teacherForm.name} onChange={(e) => setTeacherForm({ ...teacherForm, name: e.target.value })} autoFocus />
          </div>
          <div>
            <label className="label">{t('teacher_email')}</label>
            <input className="input" value={teacherForm.email} onChange={(e) => setTeacherForm({ ...teacherForm, email: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setTeacherModal({ open: false })} className="btn btn-ghost">{t('cancel')}</button>
            <button onClick={saveTeacher} className="btn btn-primary">{t('save')}</button>
          </div>
        </div>
      </Modal>

      {/* Assignment modal */}
      <Modal open={assignModal} onClose={() => setAssignModal(false)} title={t('assign_lesson')}>
        <div className="space-y-4">
          {assignError && (
            <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'color-mix(in srgb, var(--error) 12%, transparent)', color: 'var(--error)' }}>
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{assignError}</span>
            </div>
          )}
          <div>
            <label className="label">{t('select_teacher')}</label>
            <select className="input" value={assignForm.teacherId} onChange={(e) => setAssignForm({ ...assignForm, teacherId: e.target.value })}>
              <option value="">—</option>
              {teachers.map((tch) => <option key={tch.id} value={tch.id}>{tch.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t('select_class')}</label>
            <select className="input" value={assignForm.classId} onChange={(e) => setAssignForm({ ...assignForm, classId: e.target.value, lessonId: '' })}>
              <option value="">—</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t('select_lesson')}</label>
            {assignForm.classId && selectedLessons.length === 0 ? (
              <div className="text-xs rounded-lg px-3 py-2" style={{ background: 'color-mix(in srgb, var(--warning) 12%, transparent)', color: 'var(--warning)' }}>
                {t('no_lessons_for_class')}
              </div>
            ) : (
              <select className="input" value={assignForm.lessonId} onChange={(e) => setAssignForm({ ...assignForm, lessonId: e.target.value })} disabled={!assignForm.classId}>
                <option value="">—</option>
                {selectedLessons.map((l) => (
                  <option key={l.id} value={l.id}>{l.subject} — {weekDayLabel(l.week_day, lang)} {l.start_time}-{l.end_time}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAssignModal(false)} className="btn btn-ghost">{t('cancel')}</button>
            <button onClick={saveAssignment} className="btn btn-primary" disabled={!assignForm.teacherId || !assignForm.lessonId}>{t('save')}</button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => confirmDel && removeAssignment(confirmDel)}
        title={t('remove_assignment')}
        message={t('confirm_remove_assignment')}
        confirmLabel={t('delete')}
        danger
      />
    </div>
  );
}
