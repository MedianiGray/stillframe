export type Glossary = Record<string, string>;

export const GLOSSARY_KEY = 'stillframe.glossary.v1';

export function loadGlossary(): Glossary {
  try {
    const raw = localStorage.getItem(GLOSSARY_KEY);
    const parsed = raw ? (JSON.parse(raw) as Glossary) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 支持 CSV / TSV（`原词,译词` 或 `原词=译词`）与 JSON `{"原词": "译词"}`。 */
export function parseGlossary(text: string): Glossary {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const out: Glossary = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && key.trim()) out[key.trim()] = value.trim();
      }
      return out;
    } catch {
      return {};
    }
  }
  const out: Glossary = {};
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const parts = line.split(/[,\t=]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) out[parts[0]] = parts.slice(1).join(', ');
  }
  return out;
}
