import type { CodexHistoryEntry } from "./types";

export const codexHistoryStorageKey = "youtube-ai-brief.codex-history.v1";
const databaseName = "youtube-ai-brief-history";
const storeName = "history";
const entriesKey = "entries";

function openHistoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readDatabaseHistory(): Promise<unknown> {
  const database = await openHistoryDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).get(entriesKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function persistCodexHistory(entries: CodexHistoryEntry[]): Promise<void> {
  const database = await openHistoryDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(entries, entriesKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function loadPersistedCodexHistory(legacyEntries: CodexHistoryEntry[], limit: number): Promise<unknown> {
  const stored = await readDatabaseHistory();
  const databaseEntries = Array.isArray(stored) ? stored : [];
  if (legacyEntries.length === 0) return databaseEntries;

  const knownIds = new Set(databaseEntries.map((entry: CodexHistoryEntry) => entry.id));
  const merged = [...databaseEntries, ...legacyEntries.filter((entry) => !knownIds.has(entry.id))]
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, limit);
  await persistCodexHistory(merged);
  localStorage.removeItem(codexHistoryStorageKey);
  return merged;
}

export async function clearPersistedCodexHistory(): Promise<void> {
  await persistCodexHistory([]);
  localStorage.removeItem(codexHistoryStorageKey);
}
