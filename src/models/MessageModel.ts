// models/MessageModel.ts

import type { MessageEntryType } from "@exportTypes";

const PLACEHOLDER_PATTERN = /\{(\d+)\s*(?:,[^}]*)?\}/g;
const LOCALE_PATTERN = /_([a-z]{2}(?:_[A-Z]{2})?(?:_[\w-]+)?)\.properties$/;

// 1. 파일명에서 로케일 추출 ---------------------------------------------------------------
export const localeFromPath = (fsPath: string): string => {
  const base = fsPath.replaceAll(`\\`, `/`).split(`/`).at(-1) ?? fsPath;
  return LOCALE_PATTERN.exec(base)?.[1] ?? `default`;
};

// 2. MessageFormat 플레이스홀더 개수 -----------------------------------------------------------
export const countPlaceholders = (value: string): number => {
  let max = -1;
  PLACEHOLDER_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
    max = Math.max(max, Number(match[1]));
  }
  return max + 1;
};

// 3. 이스케이프 해제 -------------------------------------------------------------------------
const unescapeValue = (raw: string): string => raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))).replace(/\\([^u])/g, (_, ch: string) => (ch === `n` ? `\n` : ch === `t` ? `\t` : ch === `r` ? `\r` : ch));

// 4. .properties 파싱 (연속 행·주석·구분자 처리) --------------------------------------------------
export const parseProperties = (text: string, fsPath: string): MessageEntryType[] => {
  const entries: MessageEntryType[] = [];
  const locale = localeFromPath(fsPath);
  const lines = text.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const startLine = index;
    let logical = lines[index];
    while (/(?<!\\)(?:\\\\)*\\$/.test(logical) && index + 1 < lines.length) {
      index++;
      logical = `${logical.slice(0, -1)}${lines[index].replace(/^\s+/, ``)}`;
    }
    index++;
    const trimmed = logical.replace(/^\s+/, ``);
    if (trimmed === `` || trimmed.startsWith(`#`) || trimmed.startsWith(`!`)) {
      continue;
    }
    let keyEnd = 0;
    while (keyEnd < trimmed.length) {
      const ch = trimmed[keyEnd];
      if (ch === `\\`) {
        keyEnd += 2;
        continue;
      }
      if (ch === `=` || ch === `:` || /\s/.test(ch)) {
        break;
      }
      keyEnd++;
    }
    const key = unescapeValue(trimmed.slice(0, keyEnd));
    let valueStart = keyEnd;
    while (valueStart < trimmed.length && /\s/.test(trimmed[valueStart])) {
      valueStart++;
    }
    if (trimmed[valueStart] === `=` || trimmed[valueStart] === `:`) {
      valueStart++;
      while (valueStart < trimmed.length && /\s/.test(trimmed[valueStart])) {
        valueStart++;
      }
    }
    const value = unescapeValue(trimmed.slice(valueStart));
    if (key === ``) {
      continue;
    }
    entries.push({ "key": key, "value": value, "fsPath": fsPath, "locale": locale, "line": startLine, "column": lines[startLine].length - lines[startLine].replace(/^\s+/, ``).length, "placeholders": countPlaceholders(value) });
  }
  return entries;
};
