// providers/ThymeleafLanguageProvider.ts

import { findDialectAttribute, findUtilityObject, listDialectAttributes, listUtilityObjects } from "@exportData";
import { vscode } from "@exportLibs";
import { findAttributeAt, parseFragmentReference, parseTemplate } from "@exportModels";
import { logger } from "@exportScripts";
import type { DialectPrefixType, TemplateIndexServiceType } from "@exportTypes";

const MAIN = `Thymeleaf-Language-Support`;
const ATTR_PREFIX_PATTERN = /(?:^|\s)((?:data-)?(th|sec|layout)[:-])([\w.-]*)$/;
const UTILITY_PREFIX_PATTERN = /#(\w*)$/;
const ATTR_WORD_PATTERN = /(?:data-)?(?:th|sec|layout)[:-][\w.-]+/;
const UTILITY_WORD_PATTERN = /#\w+/;
const FRAGMENT_REF_NAMES: ReadonlySet<string> = new Set([`insert`, `replace`, `include`, `substituteby`, `decorate`, `decorator`]);
const DIALECT_PREFIX_PATTERN = /^(?:data-)?(th|sec|layout)[:-]/;

// ------------------------------------------------------------------------------
// 1. 완성·호버·심볼·정의 프로바이더
// ------------------------------------------------------------------------------
export const ThymeleafLanguageProvider = (indexService: TemplateIndexServiceType) => {
  // 1-1. 기능 활성화 여부
  const isEnabled = (): boolean => vscode.workspace.getConfiguration(MAIN).get<boolean>(`languageFeaturesEnabled`, true);

  // 1-2. 커서가 태그 내부인지 판정
  const isInsideTag = (textBefore: string): boolean => {
    const lastOpen = textBefore.lastIndexOf(`<`);
    const lastClose = textBefore.lastIndexOf(`>`);
    return lastOpen > lastClose;
  };

  // 1-3. 커서가 표현식 내부인지 판정 (열린 ${ *{ 가 닫히지 않음)
  const isInsideExpression = (textBefore: string): boolean => {
    let depth = 0;
    for (let i = 0; i < textBefore.length; i++) {
      const pair = textBefore.slice(i, i + 2);
      if (pair === `\${` || pair === `*{` || pair === `#{` || pair === `@{` || pair === `~{`) {
        depth++;
        i++;
      }
      else if (textBefore[i] === `}` && depth > 0) {
        depth--;
      }
    }
    return depth > 0;
  };

  // 1-4. 속성 문서 마크다운
  const buildAttributeMarkdown = (prefix: DialectPrefixType, name: string): vscode.MarkdownString | undefined => {
    const definition = findDialectAttribute(prefix, name);
    if (!definition) {
      return undefined;
    }
    const markdown = new vscode.MarkdownString();
    markdown.appendCodeblock(`${prefix}:${definition.name}`, `html`);
    markdown.appendMarkdown(definition.doc);
    definition.deprecated && markdown.appendMarkdown(`\n\n**Deprecated.** ${definition.deprecated}`);
    return markdown;
  };

  // 2-1. 완성 프로바이더
  const completionProvider: vscode.CompletionItemProvider = {
    provideCompletionItems: (document, position) => {
      if (!isEnabled()) {
        return undefined;
      }
      const lineBefore = document.lineAt(position.line).text.slice(0, position.character);
      const textBefore = document.getText(new vscode.Range(new vscode.Position(0, 0), position));

      // 속성명 완성
      const attrMatch = ATTR_PREFIX_PATTERN.exec(lineBefore);
      if (attrMatch && isInsideTag(textBefore)) {
        const prefixToken = attrMatch[1];
        const dialect = attrMatch[2] as DialectPrefixType;
        const partial = attrMatch[3];
        const start = position.translate(0, -(prefixToken.length + partial.length));
        const range = new vscode.Range(start, position);
        const lineAfter = document.lineAt(position.line).text.slice(position.character);
        const needsValue = !/^\s*=/.test(lineAfter);
        return listDialectAttributes(dialect).map((definition, index) => {
          const label = `${prefixToken}${definition.name}`;
          const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Property);
          item.detail = `Thymeleaf ${dialect} dialect`;
          item.documentation = new vscode.MarkdownString(definition.doc);
          item.range = range;
          item.sortText = `${String(index).padStart(3, `0`)}-${definition.name}`;
          item.insertText = needsValue ? new vscode.SnippetString(`${label}="$1"`) : label;
          if (definition.deprecated) {
            item.tags = [vscode.CompletionItemTag.Deprecated];
          }
          return item;
        });
      }

      // 유틸리티 객체 완성
      const utilityMatch = UTILITY_PREFIX_PATTERN.exec(lineBefore);
      if (utilityMatch && isInsideExpression(textBefore)) {
        const start = position.translate(0, -(utilityMatch[0].length));
        const range = new vscode.Range(start, position);
        return listUtilityObjects().map((utility) => {
          const item = new vscode.CompletionItem(`#${utility.name}`, vscode.CompletionItemKind.Module);
          item.detail = `Thymeleaf utility object`;
          item.documentation = new vscode.MarkdownString(utility.doc);
          item.range = range;
          return item;
        });
      }
      return undefined;
    },
  };

  // 2-2. 호버 프로바이더
  const hoverProvider: vscode.HoverProvider = {
    provideHover: (document, position) => {
      if (!isEnabled()) {
        return undefined;
      }
      const attrRange = document.getWordRangeAtPosition(position, ATTR_WORD_PATTERN);
      if (attrRange) {
        const word = document.getText(attrRange);
        const prefixMatch = DIALECT_PREFIX_PATTERN.exec(word);
        if (prefixMatch) {
          const markdown = buildAttributeMarkdown(prefixMatch[1] as DialectPrefixType, word.slice(prefixMatch[0].length));
          return markdown ? new vscode.Hover(markdown, attrRange) : undefined;
        }
      }
      const utilityRange = document.getWordRangeAtPosition(position, UTILITY_WORD_PATTERN);
      if (utilityRange) {
        const utility = findUtilityObject(document.getText(utilityRange).slice(1));
        if (utility) {
          const markdown = new vscode.MarkdownString();
          markdown.appendCodeblock(`#${utility.name}`, `java`);
          markdown.appendMarkdown(utility.doc);
          return new vscode.Hover(markdown, utilityRange);
        }
      }
      return undefined;
    },
  };

  // 2-3. 문서 심볼 프로바이더 (프래그먼트 정의)
  const symbolProvider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols: (document) => {
      if (!isEnabled()) {
        return undefined;
      }
      const template = parseTemplate(document.getText());
      return template.fragments.map((fragment) => {
        const start = document.positionAt(fragment.offset);
        const end = document.positionAt(fragment.offset + fragment.length);
        const range = new vscode.Range(start, end);
        const detail = `${fragment.prefix}:fragment on <${fragment.tag}>${fragment.params.length > 0 ? ` (${fragment.params.join(`, `)})` : ``}`;
        return new vscode.DocumentSymbol(fragment.name, detail, vscode.SymbolKind.Function, range, range);
      });
    },
  };

  // 2-4. 프래그먼트 참조 위치 해석
  const resolveReferenceAt = async (document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location | undefined> => {
    const template = parseTemplate(document.getText());
    const attribute = findAttributeAt(template, document.offsetAt(position));
    if (!attribute || !FRAGMENT_REF_NAMES.has(attribute.name) || !attribute.hasValue) {
      return undefined;
    }
    const reference = parseFragmentReference(attribute.value);
    if (!reference || (reference.dynamic && reference.template === ``)) {
      return undefined;
    }
    const target = reference.template === `` ? document.uri : await indexService.resolveTemplate(reference.template, document.uri);
    if (!target) {
      logger(`debug`, `resolveReferenceAt - template not found: ${reference.template}`);
      return undefined;
    }
    const fragmentPosition = await indexService.findFragmentPosition(target, reference.selector);
    return new vscode.Location(target, new vscode.Position(fragmentPosition.line, fragmentPosition.column));
  };

  // 2-5. 정의 프로바이더
  const definitionProvider: vscode.DefinitionProvider = {
    provideDefinition: (document, position) => (isEnabled() ? resolveReferenceAt(document, position) : undefined),
  };

  return { completionProvider, hoverProvider, symbolProvider, definitionProvider, resolveReferenceAt };
};
