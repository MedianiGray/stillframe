export type TranslateProvider = 'none' | 'openai' | 'deepl' | 'libre';

export interface Settings {
  ocrLang: string;
  tessdataPath: string;
  translateProvider: TranslateProvider;
  translateEndpoint: string;
  translateKey: string;
  translateModel: string;
  translateTarget: string;
  imageFormat: 'png' | 'jpeg';
  jpegQuality: number;
  autoSaveEnabled: boolean;
  showHintOnStart: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  ocrLang: 'chi_sim+eng',
  // 留空 = 用随站点分发的 ./tessdata：同源、最快，内网和离线部署都能直接用
  tessdataPath: '',
  translateProvider: 'none',
  translateEndpoint: '',
  translateKey: '',
  translateModel: 'gpt-4o-mini',
  translateTarget: 'zh',
  imageFormat: 'png',
  jpegQuality: 0.92,
  autoSaveEnabled: false,
  showHintOnStart: true,
};

const KEY = 'stillframe.settings.v1';
const EVENT = 'stillframe:settings-changed';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(next: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onSettingsChange(handler: () => void): () => void {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
