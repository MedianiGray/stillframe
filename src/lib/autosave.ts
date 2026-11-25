type DirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
};

let handle: DirectoryHandle | null = null;
const KEY = 'stillframe.autosave.v1';

export function autosaveSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

interface PickerWindow {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandle>;
}

export async function chooseDirectory(): Promise<string> {
  const picker = (window as unknown as PickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('当前浏览器不支持目录授权，请改用下载');
  const picked = await picker({ mode: 'readwrite' });
  handle = picked;
  localStorage.setItem(KEY, picked.name);
  return picked.name;
}

export function currentDirectoryName(): string | null {
  if (handle) return handle.name;
  return localStorage.getItem(KEY);
}

export function clearDirectory(): void {
  handle = null;
  localStorage.removeItem(KEY);
}

export async function writeToDirectory(blob: Blob, filename: string): Promise<boolean> {
  if (!handle) return false;
  try {
    const permission = handle.queryPermission
      ? await handle.queryPermission({ mode: 'readwrite' })
      : 'granted';
    if (permission !== 'granted') {
      const requested = handle.requestPermission
        ? await handle.requestPermission({ mode: 'readwrite' })
        : permission;
      if (requested !== 'granted') return false;
    }
    const fileHandle = await handle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}
