import { parseSave, type SaveFile, type SaveSummary } from "@cr/sim";

/**
 * Save slots stored in the browser's IndexedDB (works in the browser and in the desktop app's
 * webview). Metadata and the full save data live in separate stores so the load screen can list
 * saves without reading megabytes of world data.
 */

export interface SaveMeta {
  id: string;
  name: string;
  savedAt: string;
  summary: SaveSummary;
  autosave: boolean;
}

const DB_NAME = "countries-and-resources";
const META = "saveMeta";
const DATA = "saveData";
export const AUTOSAVE_ID = "autosave";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(META, { keyPath: "id" });
      req.result.createObjectStore(DATA);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("Could not open save storage."));
    };
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Save storage error."));
    tx.onabort = () => reject(tx.error ?? new Error("Save storage error."));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Save storage error."));
  });
}

export async function listSaves(): Promise<SaveMeta[]> {
  const db = await openDb();
  const metas = await request(
    db.transaction(META).objectStore(META).getAll() as IDBRequest<SaveMeta[]>,
  );
  return metas.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function writeSave(
  id: string,
  name: string,
  file: SaveFile,
  text: string,
): Promise<SaveMeta> {
  const db = await openDb();
  const meta: SaveMeta = {
    id,
    name,
    savedAt: file.savedAt,
    summary: file.summary,
    autosave: id === AUTOSAVE_ID,
  };
  const tx = db.transaction([META, DATA], "readwrite");
  tx.objectStore(META).put(meta);
  tx.objectStore(DATA).put(text, id);
  await done(tx);
  return meta;
}

export async function readSave(id: string): Promise<{ file: SaveFile; text: string }> {
  const db = await openDb();
  const text = await request(
    db.transaction(DATA).objectStore(DATA).get(id) as IDBRequest<string | undefined>,
  );
  if (!text) throw new Error("That save could not be found.");
  return { file: parseSave(text), text };
}

export async function deleteSave(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META, DATA], "readwrite");
  tx.objectStore(META).delete(id);
  tx.objectStore(DATA).delete(id);
  await done(tx);
}

export function newSaveId(): string {
  return `save-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
