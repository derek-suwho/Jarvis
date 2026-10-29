/** Binary attachment storage stays outside localStorage's small synchronous quota. */
export interface StoredMedia {
  id: string;
  type: string;
  data: string;
}

const DATABASE_NAME = 'jarvis.media';
const STORE_NAME = 'attachments';
let databasePromise: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error ?? new Error('Attachment storage is unavailable.'));
    request.onblocked = () => reject(new Error('Close other Jarvis windows and try saving again.'));
    request.onsuccess = () => {
      const connection = request.result;
      connection.onversionchange = () => {
        connection.close();
        databasePromise = undefined;
      };
      resolve(connection);
    };
  });
  databasePromise = pending;
  void pending.catch(() => {
    if (databasePromise === pending) databasePromise = undefined;
  });
  return pending;
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Attachment storage was interrupted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not access attachment storage.'));
  });
}

export async function readMedia(ids: string[]): Promise<StoredMedia[]> {
  if (!ids.length) return [];
  const connection = await database();
  const transaction = connection.transaction(STORE_NAME, 'readonly');
  const done = completed(transaction);
  const rows: StoredMedia[] = [];
  const store = transaction.objectStore(STORE_NAME);
  for (const id of new Set(ids)) {
    const request = store.get(id);
    request.onsuccess = () => {
      const row = request.result as StoredMedia | undefined;
      if (row && row.id === id && typeof row.type === 'string' && typeof row.data === 'string') rows.push(row);
    };
  }
  await done;
  return rows;
}

/** Commit binary rows before saving metadata that refers to them. */
export async function writeMedia(rows: StoredMedia[]): Promise<void> {
  if (!rows.length) return;
  const connection = await database();
  const transaction = connection.transaction(STORE_NAME, 'readwrite');
  const done = completed(transaction);
  const store = transaction.objectStore(STORE_NAME);
  for (const row of rows) store.put(row);
  await done;
}

/** Call only after the new chat metadata is durable, so failed saves cannot erase live files. */
export async function pruneMedia(retainedIds: Set<string>): Promise<void> {
  const connection = await database();
  const transaction = connection.transaction(STORE_NAME, 'readwrite');
  const done = completed(transaction);
  const request = transaction.objectStore(STORE_NAME).openKeyCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    if (!retainedIds.has(String(cursor.primaryKey))) transaction.objectStore(STORE_NAME).delete(cursor.primaryKey);
    cursor.continue();
  };
  await done;
}
