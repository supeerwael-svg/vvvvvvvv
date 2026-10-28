/**
 * Offline-first local storage layer using IndexedDB.
 * Acts as the primary data source for the app; Supabase is the sync target.
 * All reads come from here; all writes go here first, then sync to Supabase.
 */

const DB_NAME = 'edutrack_offline';
const DB_VERSION = 1;

export const STORES = [
  'classes', 'students', 'lessons', 'attendance_records',
  'teacher_absences', 'absence_episodes', 'teachers',
  'teacher_class_assignments', 'teacher_lesson_assignments',
  'institution_settings', 'class_assignments', 'profiles',
  'institutions', 'developer_info', 'pending_sync',
] as const;

export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      }
      if (!db.objectStoreNames.contains('pending_sync')) {
        db.createObjectStore('pending_sync', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function localGetAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function localGetByKey<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function localBulkPut<T extends { id: string }>(store: StoreName, items: T[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const item of items) os.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function localPut<T extends { id: string }>(store: StoreName, item: T): Promise<void> {
  return localBulkPut(store, [item]);
}

export async function localDelete(store: StoreName, id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function localClear(store: StoreName): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function localClearAll(): Promise<void> {
  for (const store of STORES) {
    await localClear(store);
  }
}

export async function localCount(store: StoreName): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// =========== Sync queue ===========

export interface SyncOp {
  id: string;
  table_name: string;
  operation: 'insert' | 'update' | 'delete';
  record_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export async function enqueueSync(op: Omit<SyncOp, 'id' | 'created_at'>): Promise<void> {
  const full: SyncOp = {
    ...op,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
  };
  await localPut('pending_sync', full);
}

export async function getPendingSync(): Promise<SyncOp[]> {
  return localGetAll<SyncOp>('pending_sync');
}

export async function removeSyncOp(id: string): Promise<void> {
  await localDelete('pending_sync', id);
}

export async function pendingSyncCount(): Promise<number> {
  return localCount('pending_sync');
}
