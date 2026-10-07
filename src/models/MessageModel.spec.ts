import { describe, expect, test } from "bun:test";
import { countPlaceholders, localeFromPath, parseProperties } from "./MessageModel";

// 1. properties 파싱 -------------------------------------------------------------------------
describe(`parseProperties`, () => {
  test(`parses keys, separators, continuations, comments, and escapes`, () => {
    const text = [
      `# comment`,
      `! another`,
      `home.welcome=Welcome, {0}!`,
      `home.title : Title`,
      `home.long=first \\`,
      `  second line`,
      `unicode=\\uD55C\\uAE00`,
      `spaced key=value`,
      `empty=`,
    ].join(`\n`);
    const entries = parseProperties(text, `C:/i18n/messages_ko.properties`);

    expect(entries.map((entry) => entry.key)).toEqual([`home.welcome`, `home.title`, `home.long`, `unicode`, `spaced`, `empty`]);
    expect(entries[0].value).toBe(`Welcome, {0}!`);
    expect(entries[0].placeholders).toBe(1);
    expect(entries[0].line).toBe(2);
    expect(entries[2].value).toBe(`first second line`);
    expect(entries[3].value).toBe(`한글`);
    expect(entries[4].value).toBe(`key=value`);
    expect(entries.every((entry) => entry.locale === `ko`)).toBe(true);
  });
});

// 2. 보조 함수 -------------------------------------------------------------------------------
describe(`helpers`, () => {
  test(`counts placeholders by highest index`, () => {
    expect(countPlaceholders(`{0} and {2,number}`)).toBe(3);
    expect(countPlaceholders(`plain`)).toBe(0);
  });

  test(`derives locale from file name`, () => {
    expect(localeFromPath(`C:/x/messages.properties`)).toBe(`default`);
    expect(localeFromPath(`C:/x/messages_en_US.properties`)).toBe(`en_US`);
    expect(localeFromPath(`/x/ValidationMessages_ko.properties`)).toBe(`ko`);
  });
});
