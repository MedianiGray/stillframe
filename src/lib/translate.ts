import type { Settings } from './settings';
import type { Glossary } from './glossary';

export type { Glossary };

export interface TranslateResult {
  text: string;
  provider: string;
}

const LANG_LABEL: Record<string, string> = {
  zh: '简体中文',
  'zh-TW': '繁体中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  ru: 'Русский',
};

export function providerReady(settings: Settings): boolean {
  switch (settings.translateProvider) {
    case 'openai':
      return Boolean(settings.translateEndpoint && settings.translateKey);
    case 'deepl':
      return Boolean(settings.translateKey);
    case 'libre':
      return Boolean(settings.translateEndpoint);
    default:
      return false;
  }
}

export async function translateText(
  text: string,
  settings: Settings,
  glossary: Glossary = {},
): Promise<TranslateResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('没有可翻译的文字');
  if (!providerReady(settings)) {
    throw new Error('翻译服务尚未配置，请到设置页填写接口地址与密钥');
  }

  switch (settings.translateProvider) {
    case 'openai':
      return translateWithOpenAI(trimmed, settings, glossary);
    case 'deepl':
      return translateWithDeepL(trimmed, settings);
    case 'libre':
      return translateWithLibre(trimmed, settings);
    default:
      throw new Error('翻译服务尚未配置');
  }
}

/** 只把原文里真正出现的术语塞进提示，避免无关词干扰模型。 */
function glossaryPrompt(text: string, glossary: Glossary, limit = 40): string {
  const hits = Object.entries(glossary)
    .filter(([term]) => term && text.includes(term))
    .slice(0, limit);
  if (hits.length === 0) return '';
  return `\nFollow this glossary strictly: ${hits.map(([term, value]) => `${term} => ${value}`).join('; ')}.`;
}

async function translateWithOpenAI(text: string, settings: Settings, glossary: Glossary): Promise<TranslateResult> {
  const endpoint = settings.translateEndpoint.replace(/\/+$/, '');
  const url = endpoint.endsWith('/chat/completions') ? endpoint : `${endpoint}/chat/completions`;
  const target = LANG_LABEL[settings.translateTarget] ?? settings.translateTarget;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.translateKey}`,
    },
    body: JSON.stringify({
      model: settings.translateModel || 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: `You are a translation engine. Translate the user's text into ${target}. Keep line breaks, keep technical terms, output the translation only.${glossaryPrompt(text, glossary)}`,
        },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`翻译接口返回 ${response.status}，请检查地址与密钥`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const translated = data.choices?.[0]?.message?.content?.trim();
  if (!translated) throw new Error('翻译接口没有返回内容');
  return { text: translated, provider: 'OpenAI 兼容接口' };
}

async function translateWithDeepL(text: string, settings: Settings): Promise<TranslateResult> {
  const url = settings.translateEndpoint || 'https://api-free.deepl.com/v2/translate';
  const targetMap: Record<string, string> = { zh: 'ZH', en: 'EN-US', ja: 'JA', ko: 'KO', fr: 'FR', de: 'DE', es: 'ES', ru: 'RU' };
  const targetLang = targetMap[settings.translateTarget] ?? 'EN-US';
  const body = new URLSearchParams({ text, target_lang: targetLang });
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `DeepL-Auth-Key ${settings.translateKey}`,
    },
    body,
  });
  if (!response.ok) throw new Error(`DeepL 返回 ${response.status}`);
  const data = (await response.json()) as { translations?: Array<{ text: string }> };
  const translated = data.translations?.[0]?.text;
  if (!translated) throw new Error('DeepL 没有返回译文');
  return { text: translated, provider: 'DeepL' };
}

async function translateWithLibre(text: string, settings: Settings): Promise<TranslateResult> {
  const endpoint = settings.translateEndpoint.replace(/\/+$/, '');
  const url = endpoint.endsWith('/translate') ? endpoint : `${endpoint}/translate`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text,
      source: 'auto',
      target: settings.translateTarget,
      format: 'text',
    }),
  });
  if (!response.ok) throw new Error(`LibreTranslate 返回 ${response.status}`);
  const data = (await response.json()) as { translatedText?: string };
  if (!data.translatedText) throw new Error('LibreTranslate 没有返回译文');
  return { text: data.translatedText, provider: 'LibreTranslate' };
}
