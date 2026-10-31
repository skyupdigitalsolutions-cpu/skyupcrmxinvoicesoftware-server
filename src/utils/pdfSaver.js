// pdfSaver.js
// One shared "save folder" for every PDF the app produces (invoices + order
// forms). Uses the File System Access API (Chrome / Edge desktop): the user
// picks a folder once, the directory handle is persisted in IndexedDB, and
// every subsequent PDF is written straight into that folder. On browsers
// without the API — or if permission is refused — it falls back to a normal
// browser download, so nothing ever breaks.

const DB_NAME = 'skyup-pdf-saver';
const STORE = 'handles';
const KEY = 'pdf-folder';

// ── tiny IndexedDB helpers (directory handles can't go in localStorage) ──────
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result ?? null);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}
async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

// ── public API ────────────────────────────────────────────────────────────────

/** True when the browser can pick a real folder (Chrome/Edge desktop). */
export const folderPickerSupported = () =>
  typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** Open the folder picker and persist the chosen folder. Returns its name. */
export async function chooseDownloadFolder() {
  if (!folderPickerSupported()) {
    throw new Error("This browser can't pick a folder — PDFs will go to the normal Downloads folder instead. (Use Chrome or Edge on desktop for this feature.)");
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await idbSet(KEY, handle);
  return handle.name;
}

/** Name of the saved folder, or null when none is set. */
export async function getDownloadFolderName() {
  try {
    const h = await idbGet(KEY);
    return h?.name || null;
  } catch { return null; }
}

/** Forget the saved folder (PDFs go back to normal downloads). */
export async function clearDownloadFolder() {
  try { await idbDelete(KEY); } catch { /* ignore */ }
}

async function verifyPermission(handle) {
  const opts = { mode: 'readwrite' };
  try {
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  } catch { return false; }
}

/**
 * Save a PDF blob. Writes into the chosen folder when one is set and
 * permitted, otherwise falls back to a regular browser download.
 * @returns {{via:'folder',folder:string}|{via:'download'}}
 */
export async function savePdfBlob(blob, filename) {
  try {
    if (folderPickerSupported()) {
      const handle = await idbGet(KEY);
      if (handle && (await verifyPermission(handle))) {
        const fileHandle = await handle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { via: 'folder', folder: handle.name };
      }
    }
  } catch { /* fall through to a normal download */ }

  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { via: 'download' };
}