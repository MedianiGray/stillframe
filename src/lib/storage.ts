import type { ShotMeta, ShotRecord } from './types';

const DB_NAME = 'stillframe';
const DB_VERSION = 1;
const STORE = 'shots';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('打开本地图库失败'));
  });
  return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function putShot(record: ShotRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = tx(db, 'readwrite').put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('保存到图库失败'));
  });
}

export async function listShots(): Promise<ShotMeta[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = tx(db, 'readonly').getAll();
    request.onsuccess = () => {
      const rows = (request.result as ShotRecord[]).map(
        ({ blob: _blob, ...meta }) => meta,
      );
      resolve(rows.sort((a, b) => b.createdAt - a.createdAt));
    };
    request.onerror = () => reject(request.error ?? new Error('读取图库失败'));
  });
}

export async function getShot(id: string): Promise<ShotRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = tx(db, 'readonly').get(id);
    request.onsuccess = () => resolve((request.result as ShotRecord | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('读取图库条目失败'));
  });
}

export async function deleteShot(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = tx(db, 'readwrite').delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('删除图库条目失败'));
  });
}

export async function clearShots(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = tx(db, 'readwrite').clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('清空图库失败'));
  });
}

export async function storageUsage(): Promise<{ count: number; bytes: number }> {
  const rows = await listShots();
  return {
    count: rows.length,
    bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
  };
}
