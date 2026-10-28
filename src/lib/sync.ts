/**
 * Sync engine: pulls institution data into local IndexedDB on login,
 * and pushes pending offline writes to Supabase when online.
 */
import { supabase } from './supabase';
import {
  localGetAll, localBulkPut, localClearAll, localDelete,
  getPendingSync, removeSyncOp, enqueueSync, pendingSyncCount,
  type StoreName,
} from './offline-db';
import type {
  ClassRow, Student, Lesson, AttendanceRecord, TeacherAbsence,
  AbsenceEpisode, Teacher, InstitutionSettings, ClassAssignment,
  Profile, Institution, DeveloperInfo,
} from './types';

type SyncStatus = 'idle' | 'syncing' | 'online' | 'offline' | 'error';
type SyncListener = (status: SyncStatus, pending: number) => void;

let currentStatus: SyncStatus = navigator.onLine ? 'online' : 'offline';
let listeners: SyncListener[] = [];

export function onSyncStatusChange(fn: SyncListener): () => void {
  listeners.push(fn);
  fn(currentStatus, 0);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

function setStatus(s: SyncStatus, pending: number) {
  currentStatus = s;
  for (const l of listeners) l(s, pending);
}

window.addEventListener('online', () => {
  setStatus('online', 0);
  syncPending();
});
window.addEventListener('offline', () => setStatus('offline', 0));

// =========== Full data preload on login ===========

export async function preloadInstitutionData(institutionId: string): Promise<void> {
  setStatus('syncing', 0);

  const queries: { store: StoreName; fn: () => Promise<{ data: unknown[] | null }> }[] = [
    { store: 'institutions', fn: async () => { const r = await supabase.from('institutions').select('*').eq('id', institutionId); return { data: r.data as unknown[] | null }; } },
    { store: 'classes', fn: async () => { const r = await supabase.from('classes').select('*').eq('institution_id', institutionId); return { data: r.data as unknown[] | null }; } },
    { store: 'students', fn: async () => { const r = await supabase.from('students').select('*').eq('institution_id', institutionId); return { data: r.data as unknown[] | null }; } },
    { store: 'lessons', fn: async () => { const r = await supabase.from('lessons').select('*, classes!inner(institution_id)').eq('classes.institution_id', institutionId); return { data: r.data as unknown[] | null }; } },
    { store: 'attendance_records', fn: async () => { const r = await supabase.from('attendance_records').select('*').eq('institution_id', institutionId); return { data: r.data as unknown[] | null }; } },
    { store: 'teacher_absences', fn: async () => { const r = await supabase.from('teacher_absences').select('*').eq('institution_id', institutionId); return { data: r.data as unknown[] | null }; } },
    { store: 'absence_episodes', fn: async () => { const r = await supabase.from('absence_episodes').select('*').eq('institution_id', institutionId); return { data: r.data as unknown[] | null }; } },
    { store: 'teachers', fn: async () => { const r = await supabase.from('teachers').select('*').eq('institution_id', institutionId); return { data: r.data as unknown[] | null }; } },
    { store: 'teacher_class_assignments', fn: async () => { const r = await supabase.from('teacher_class_assignments').select('*').eq('institution_id', institutionId); return { data: r.data as unknown[] | null }; } },
    { store: 'teacher_lesson_assignments', fn: async () => { const r = await supabase.from('teacher_lesson_assignments').select('*').eq('institution_id', institutionId); return { data: r.data as unknown[] | null }; } },
    { store: 'institution_settings', fn: async () => { const r = await supabase.from('institution_settings').select('*').eq('institution_id', institutionId); return { data: r.data as unknown[] | null }; } },
    { store: 'class_assignments', fn: async () => { const r = await supabase.from('class_assignments').select('*, profiles!inner(institution_id)').eq('profiles.institution_id', institutionId); return { data: r.data as unknown[] | null }; } },
    { store: 'profiles', fn: async () => { const r = await supabase.from('profiles').select('*').eq('institution_id', institutionId); return { data: r.data as unknown[] | null }; } },
    { store: 'developer_info', fn: async () => { const r = await supabase.from('developer_info').select('*').eq('institution_id', institutionId); return { data: r.data as unknown[] | null }; } },
  ];

  await localClearAll();

  const results = await Promise.allSettled(queries.map((q) => q.fn()));
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const { store } = queries[i];
    if (result.status === 'fulfilled' && result.value.data) {
      let rows = result.value.data as Record<string, unknown>[];
      // Flatten joined lessons (classes!inner)
      if (store === 'lessons') {
        rows = rows.map((r) => {
          const { classes: _c, ...rest } = r;
          return rest;
        });
      }
      if (store === 'class_assignments') {
        rows = rows.map((r) => {
          const { profiles: _p, ...rest } = r;
          return rest;
        });
      }
      await localBulkPut(store, rows as { id: string }[]);
    }
  }

  const pending = await pendingSyncCount();
  setStatus(navigator.onLine ? 'online' : 'offline', pending);
}

// =========== Push pending writes to Supabase ===========

export async function syncPending(): Promise<void> {
  if (!navigator.onLine) return;
  const ops = await getPendingSync();
  if (ops.length === 0) return;

  setStatus('syncing', ops.length);

  for (const op of ops) {
    try {
      const table = supabase.from(op.table_name);
      if (op.operation === 'delete') {
        await table.delete().eq('id', op.record_id);
      } else if (op.operation === 'insert') {
        await table.insert(op.payload);
      } else {
        await table.update(op.payload).eq('id', op.record_id);
      }
      await removeSyncOp(op.id);
    } catch {
      // leave in queue for retry
    }
  }

  const remaining = await pendingSyncCount();
  setStatus(remaining > 0 ? 'error' : 'online', remaining);
}

// =========== Write-through: local + queue ===========

export async function writeThrough<T extends { id: string }>(
  store: StoreName,
  table: string,
  record: T,
  operation: 'insert' | 'update',
): Promise<void> {
  const rec = record as unknown as Record<string, unknown>;
  // Write to local immediately
  await localBulkPut(store, [rec as { id: string }]);
  // If online, push directly; otherwise queue
  if (navigator.onLine) {
    try {
      if (operation === 'insert') {
        await supabase.from(table).insert(rec);
      } else {
        await supabase.from(table).update(rec).eq('id', record.id);
      }
    } catch {
      await enqueueSync({ table_name: table, operation, record_id: record.id, payload: rec });
    }
  } else {
    await enqueueSync({ table_name: table, operation, record_id: record.id, payload: rec });
  }
}

export async function deleteThrough(store: StoreName, table: string, id: string): Promise<void> {
  await localDelete(store, id);
  if (navigator.onLine) {
    try {
      await supabase.from(table).delete().eq('id', id);
    } catch {
      await enqueueSync({ table_name: table, operation: 'delete', record_id: id, payload: {} });
    }
  } else {
    await enqueueSync({ table_name: table, operation: 'delete', record_id: id, payload: {} });
  }
}

export function getSyncStatus(): SyncStatus {
  return currentStatus;
}

// Re-export for convenience
export { localGetAll, localDelete, enqueueSync, pendingSyncCount };
