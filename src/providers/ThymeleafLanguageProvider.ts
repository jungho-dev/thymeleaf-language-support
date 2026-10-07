// providers/ThymeleafLanguageProvider.ts

import { findDialectAttribute, findUtilityObject, listDialectAttributes, listUtilityObjects } from "@exportData";
import { vscode } from "@exportLibs";
import { buildScopes, findAttributeAt, findChainAt, findExpressionAt, findInlineAt, formatTypeRef, listMethods, listProperties, parseAttributeValue, parseTemplate, resolveChain } from "@exportModels";
import { logger } from "@exportScripts";
import type { DialectPrefixType, ExpressionChainType, ExpressionNodeType, JavaIndexServiceType, MessageIndexServiceType, ParsedValueType, ResolvedTypeType, ScopeType, SemanticIndexType, SemanticOptionsType, SemanticResolutionType, TemplateAttributeType, TemplateIndexServiceType, TemplateInlineType, TemplateModelType } from "@exportTypes";

const MAIN = `Thymeleaf-Language-Support`;
const ATTR_PREFIX_PATTERN = /(?:^|\s)((?:data-)?(th|sec|layout)[:-])([\w.-]*)$/;
const ATTR_WORD_PATTERN = /(?:data-)?(?:th|sec|layout)[:-][\w.-]+/;
const UTILITY_WORD_PATTERN = /#\w+/;
const DIALECT_PREFIX_PATTERN = /^(?:data-)?(th|sec|layout)[:-]/;
const CHAIN_TAIL_PATTERN = /([A-Za-z_$#@][\w$]*(?:\??\.[A-Za-z_$][\w$]*(?:\([^()]*\))?|\[[^\]]*\])*)\??\.([A-Za-z_$]*)$/;
const ROOT_TAIL_PATTERN = /(?:^|[^\w$.#@'])([A-Za-z_$]*)$/;
const FRAGMENT_REF_NAMES: ReadonlySet<string> = new Set([`insert`, `replace`, `include`, `substituteby`, `decorate`, `decorator`]);
const CONTEXT_OBJECTS = [`param`, `session`, `application`];
const EMBEDDED_OPENERS = [`\${`, `*{`, `#{`, `@{`, `~{`];

interface LocateResultType {
  template: TemplateModelType;
  scopes: Map<number, ScopeType>;
  templateName?: string;
  attribute?: TemplateAttributeType;
  inline?: TemplateInlineType;
  parsed?: ParsedValueType;
  scope: ScopeType;
  node?: ExpressionNodeType;
  chain?: ExpressionChainType;
  segmentIndex: number;
  offset: number;
}
interface OpenerContextType {
  kind: `variable` | `selection` | `message` | `link` | `fragment`;
  tail: string;
}
interface CachedTemplateType {
  version: number;
  template: TemplateModelType;
  scopes: Map<number, ScopeType>;
}

// ------------------------------------------------------------------------------
// 1. 완성·호버·정의·참조·시그니처·링크·심볼 프로바이더
// ------------------------------------------------------------------------------
export const ThymeleafLanguageProvider = (templateIndex: TemplateIndexServiceType, javaIndex: JavaIndexServiceType, messageIndex: MessageIndexServiceType, semanticIndex: SemanticIndexType) => {
  // 0. 변수 설정 ----------------------------------------------------------------------------
  const cache = new Map<string, CachedTemplateType>();
  const emptyScope: ScopeType = { "locals": new Map(), "insideFragment": false };

  // 1-1. 설정
  const isEnabled = (): boolean => vscode.workspace.getConfiguration(MAIN).get<boolean>(`languageFeaturesEnabled`, true);
  const semanticOptions = (templateName: string | undefined): SemanticOptionsType => ({ "templateName": templateName, "modelValidation": true, "linkValidation": true, "messageValidation": true });

  // 1-2. 문서 파싱 캐시
  const parseDocument = (document: vscode.TextDocument): CachedTemplateType => {
    const key = document.uri.toString();
    const cached = cache.get(key);
    if (cached && cached.version === document.version) {
      return cached;
    }
    const template = parseTemplate(document.getText());
    const entry = { "version": document.version, "template": template, "scopes": buildScopes(template) };
    cache.set(key, entry);
    return entry;
  };

  // 1-3. 커서 위치 컨텍스트
  const locate = (document: vscode.TextDocument, position: vscode.Position): LocateResultType => {
    const { template, scopes } = parseDocument(document);
    const offset = document.offsetAt(position);
    const attribute = findAttributeAt(template, offset);
    const inline = attribute ? undefined : findInlineAt(template, offset);
    const parsed = attribute?.parsed ?? inline?.parsed;
    const elementIndex = attribute?.elementIndex ?? inline?.elementIndex ?? -1;
    const node = parsed ? findExpressionAt(parsed, offset) : undefined;
    const hit = node ? findChainAt(node, offset) : undefined;
    return { template, scopes, "templateName": templateIndex.templateNameOf(document.uri), attribute, inline, parsed, "scope": scopes.get(elementIndex) ?? emptyScope, node, "chain": hit?.chain, "segmentIndex": hit?.segmentIndex ?? -1, offset };
  };
  const resolveAt = (located: LocateResultType): SemanticResolutionType | undefined => (located.node && located.chain ? resolveChain(located.node, located.chain, located.scope, semanticIndex, semanticOptions(located.templateName), located.template, located.scopes) : undefined);

  // 1-4. 값 내부 마지막 열린 표현식 종류
  const openerContext = (valueBefore: string): OpenerContextType | undefined => {
    const stack: { kind: OpenerContextType[`kind`]; index: number }[] = [];
    for (let i = 0; i < valueBefore.length; i++) {
      const pair = valueBefore.slice(i, i + 2);
      const openerIndex = EMBEDDED_OPENERS.indexOf(pair);
      if (openerIndex >= 0) {
        stack.push({ "kind": [`variable`, `selection`, `message`, `link`, `fragment`][openerIndex] as OpenerContextType[`kind`], "index": i });
        i++;
      }
      else if (valueBefore[i] === `}` && stack.length > 0) {
        stack.pop();
      }
    }
    const top = stack.at(-1);
    return top ? { "kind": top.kind, "tail": valueBefore.slice(top.index + 2) } : undefined;
  };

  // 1-5. 커서가 태그 내부인지 판정
  const isInsideTag = (textBefore: string): boolean => textBefore.lastIndexOf(`<`) > textBefore.lastIndexOf(`>`);

  // 1-6. 속성 문서 마크다운
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
  const fileLabel = (fsPath: string, line: number): string => `${fsPath.replaceAll(`\\`, `/`).split(`/`).at(-1) ?? fsPath}:${line + 1}`;
  const toLocation = (fsPath: string, line: number, column = 0, length = 1): vscode.Location => new vscode.Location(vscode.Uri.file(fsPath), new vscode.Range(line, column, line, column + Math.max(1, length)));

  // 2-1. 완성 항목 빌더
  const propertyItems = (resolved: ResolvedTypeType, range: vscode.Range): vscode.CompletionItem[] => {
    const items: vscode.CompletionItem[] = [];
    for (const property of listProperties(resolved, semanticIndex)) {
      const item = new vscode.CompletionItem(property.name, property.kind === `method` ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Property);
      item.detail = `${property.type}${property.fsPath ? `  (${fileLabel(property.fsPath, property.line)})` : ``}`;
      item.range = range;
      item.sortText = `0-${property.name}`;
      items.push(item);
    }
    for (const method of listMethods(resolved, semanticIndex)) {
      if (/^(get|is)[A-Z]/.test(method.name)) {
        continue;
      }
      const item = new vscode.CompletionItem(`${method.name}()`, vscode.CompletionItemKind.Method);
      item.detail = `${method.type}  (${fileLabel(method.fsPath, method.line)})`;
      item.insertText = new vscode.SnippetString(`${method.name}($1)`);
      item.range = range;
      item.sortText = `1-${method.name}`;
      items.push(item);
    }
    return items;
  };
  const rootItems = (located: LocateResultType, kind: `variable` | `selection`, range: vscode.Range): vscode.CompletionItem[] => {
    const items: vscode.CompletionItem[] = [];
    if (kind === `selection` && located.scope.objectAttribute) {
      const objectNode = located.scope.objectAttribute.parsed.expressions[0];
      const resolution = objectNode ? resolveChain(objectNode, objectNode.chains[0], located.scope, semanticIndex, semanticOptions(located.templateName), located.template, located.scopes) : undefined;
      const objectType = resolution?.segmentTypes.at(-1) ?? resolution?.rootType;
      return objectType ? propertyItems(objectType, range) : [];
    }
    for (const local of located.scope.locals.values()) {
      const item = new vscode.CompletionItem(local.name, vscode.CompletionItemKind.Variable);
      item.detail = `local (${local.kind}) from ${local.attribute.raw} on <${local.attribute.tag}>`;
      item.range = range;
      item.sortText = `0-${local.name}`;
      items.push(item);
    }
    const context = semanticIndex.modelContextFor(located.templateName);
    for (const [name, attributes] of context.attributes) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Field);
      const typed = attributes.find((attribute) => attribute.typeName);
      item.detail = `${typed?.typeName ?? `model attribute`}  (${attributes.map((attribute) => `${attribute.methodName || attribute.source}`).filter((label, index, all) => all.indexOf(label) === index).slice(0, 3).join(`, `)})`;
      item.documentation = new vscode.MarkdownString(attributes.map((attribute) => `- ${attribute.source} in ${fileLabel(attribute.fsPath, attribute.line)}`).join(`\n`));
      item.range = range;
      item.sortText = `1-${name}`;
      items.push(item);
    }
    for (const name of CONTEXT_OBJECTS) {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
      item.detail = `Thymeleaf context object`;
      item.range = range;
      item.sortText = `2-${name}`;
      items.push(item);
    }
    for (const utility of listUtilityObjects()) {
      const item = new vscode.CompletionItem(`#${utility.name}`, vscode.CompletionItemKind.Module);
      item.detail = `Thymeleaf utility object`;
      item.documentation = new vscode.MarkdownString(utility.doc);
      item.range = range;
      item.sortText = `3-${utility.name}`;
      items.push(item);
    }
    return items;
  };
  const chainItems = (located: LocateResultType, kind: `variable` | `selection`, chainText: string, range: vscode.Range): vscode.CompletionItem[] => {
    const temporary = parseAttributeValue(kind === `selection` ? `*{${chainText}}` : `\${${chainText}}`, `expression`);
    const node = temporary.expressions[0];
    const chain = node?.chains[0];
    if (!node || !chain) {
      return [];
    }
    const resolution = resolveChain(node, chain, located.scope, semanticIndex, semanticOptions(located.templateName), located.template, located.scopes);
    const resolved = resolution?.segmentTypes.at(-1) ?? resolution?.rootType;
    return resolved && !resolved.open ? propertyItems(resolved, range) : [];
  };
  const simpleItems = (names: string[], kind: vscode.CompletionItemKind, detail: string, range: vscode.Range): vscode.CompletionItem[] => names.map((name) => {
    const item = new vscode.CompletionItem(name, kind);
    item.detail = detail;
    item.range = range;
    return item;
  });
  const fragmentItems = (templateName: string | undefined, located: LocateResultType, range: vscode.Range): vscode.CompletionItem[] => {
    const catalog = !templateName || templateName === `this` ? { "fragments": located.template.fragments } : semanticIndex.fragmentCatalog(templateName);
    return (catalog?.fragments ?? []).map((fragment) => {
      const item = new vscode.CompletionItem(fragment.name, vscode.CompletionItemKind.Function);
      item.detail = `${fragment.prefix}:fragment on <${fragment.tag}>${fragment.params.length > 0 ? ` (${fragment.params.join(`, `)})` : ``}`;
      item.insertText = fragment.params.length > 0 ? new vscode.SnippetString(`${fragment.name}(${fragment.params.map((param, index) => `\${${index + 1}:${param}}`).join(`, `)})`) : fragment.name;
      item.range = range;
      return item;
    });
  };

  // 2-2. 완성 프로바이더
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
        const range = new vscode.Range(position.translate(0, -(prefixToken.length + partial.length)), position);
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

      // 속성값·인라인 내부 완성
      const located = locate(document, position);
      const container = located.attribute ?? located.inline;
      if (!container) {
        return undefined;
      }
      const valueStart = located.attribute ? located.attribute.valueOffset : (located.inline?.offset ?? 0) + 2;
      if (located.offset < valueStart) {
        return undefined;
      }
      const valueBefore = document.getText().slice(valueStart, located.offset);
      const opener = openerContext(valueBefore);
      const wordRange = (word: string): vscode.Range => new vscode.Range(position.translate(0, -word.length), position);

      if (opener?.kind === `variable` || opener?.kind === `selection`) {
        const chainMatch = CHAIN_TAIL_PATTERN.exec(opener.tail);
        if (chainMatch) {
          return chainItems(located, opener.kind, chainMatch[1], wordRange(chainMatch[2]));
        }
        const rootMatch = ROOT_TAIL_PATTERN.exec(opener.tail);
        return rootMatch ? rootItems(located, opener.kind, wordRange(rootMatch[1])) : undefined;
      }
      if (opener?.kind === `message` && !opener.tail.includes(`(`)) {
        const word = /[\w.-]*$/.exec(opener.tail)?.[0] ?? ``;
        return messageIndex.listEntries().filter((entry, index, all) => all.findIndex((candidate) => candidate.key === entry.key) === index).map((entry) => {
          const item = new vscode.CompletionItem(entry.key, vscode.CompletionItemKind.Text);
          item.detail = entry.value;
          item.documentation = new vscode.MarkdownString(messageIndex.findMessages(entry.key).map((candidate) => `- **${candidate.locale}**: ${candidate.value}`).join(`\n`));
          item.range = wordRange(word);
          return item;
        });
      }
      if (opener?.kind === `link` && !opener.tail.includes(`(`)) {
        const word = /[^\s(]*$/.exec(opener.tail)?.[0] ?? ``;
        return [...simpleItems(javaIndex.listUrls(), vscode.CompletionItemKind.Reference, `controller mapping`, wordRange(word)), ...simpleItems(templateIndex.listStaticPaths(), vscode.CompletionItemKind.File, `static resource`, wordRange(word))];
      }
      if (opener?.kind === `fragment` || (!opener && located.attribute && FRAGMENT_REF_NAMES.has(located.attribute.name))) {
        const tail = opener?.tail ?? valueBefore;
        const separator = tail.lastIndexOf(`::`);
        if (separator >= 0) {
          const templateName = tail.slice(0, separator).trim().replace(/^~\{/, ``);
          const word = /[\w$-]*$/.exec(tail)?.[0] ?? ``;
          return fragmentItems(templateName, located, wordRange(word));
        }
        const word = /[\w/.-]*$/.exec(tail)?.[0] ?? ``;
        return simpleItems(templateIndex.listTemplateNames(), vscode.CompletionItemKind.File, `Thymeleaf template`, wordRange(word));
      }
      return undefined;
    },
  };

  // 3-1. 호버 프로바이더
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
      const located = locate(document, position);
      const markdown = new vscode.MarkdownString();
      markdown.isTrusted = true;

      // 변수 체인
      const resolution = resolveAt(located);
      if (located.node && located.chain && resolution) {
        const index = located.segmentIndex;
        if (index < 0) {
          const root = located.chain.root;
          if (root.kind === `utility`) {
            const utility = findUtilityObject(root.name.slice(1));
            if (!utility) {
              return undefined;
            }
            markdown.appendCodeblock(root.name, `java`);
            markdown.appendMarkdown(utility.doc);
            return new vscode.Hover(markdown, new vscode.Range(document.positionAt(root.offset), document.positionAt(root.offset + root.length)));
          }
          markdown.appendCodeblock(`${formatTypeRef(resolution.rootType.ref)} ${root.name}`, `java`);
          if (resolution.rootKind === `local` && resolution.local) {
            markdown.appendMarkdown(`Local variable from \`${resolution.local.attribute.raw}\` on \`<${resolution.local.attribute.tag}>\` (${resolution.local.kind}).`);
          }
          else if (resolution.rootKind === `model` && resolution.modelAttributes) {
            markdown.appendMarkdown(`Model attribute added by:\n${resolution.modelAttributes.map((attribute) => `- \`${attribute.methodName || attribute.source}\` (${attribute.source}) in ${fileLabel(attribute.fsPath, attribute.line)}`).join(`\n`)}`);
          }
          else if (resolution.rootKind === `object`) {
            markdown.appendMarkdown(`Property of the enclosing \`th:object\`.`);
          }
          else if (resolution.rootKind === `context`) {
            markdown.appendMarkdown(`Thymeleaf context object.`);
          }
          else if (resolution.rootKind === `unknown`) {
            markdown.appendMarkdown(`No controller mapped to this template adds this attribute.`);
          }
          else {
            return undefined;
          }
          return new vscode.Hover(markdown, new vscode.Range(document.positionAt(root.offset), document.positionAt(root.offset + root.length)));
        }
        const segment = located.chain.segments[index];
        const property = resolution.segmentProperties[index];
        const segmentType = resolution.segmentTypes[index];
        if (segment && (property || segmentType)) {
          markdown.appendCodeblock(`${property?.type ?? formatTypeRef(segmentType?.ref)} ${segment.name}${segment.kind === `call` ? `()` : ``}`, `java`);
          property?.fsPath && markdown.appendMarkdown(`${property.kind} declared in ${fileLabel(property.fsPath, property.line)}`);
          return new vscode.Hover(markdown, new vscode.Range(document.positionAt(segment.offset), document.positionAt(segment.offset + segment.length)));
        }
      }

      // 메시지·링크·프래그먼트
      const node = located.node;
      if (node?.kind === `message` && node.key && !node.key.dynamic) {
        const entries = messageIndex.findMessages(node.key.value);
        if (entries.length === 0) {
          return undefined;
        }
        markdown.appendCodeblock(node.key.value, `properties`);
        markdown.appendMarkdown(entries.map((entry) => `- **${entry.locale}**: ${entry.value} (${fileLabel(entry.fsPath, entry.line)})`).join(`\n`));
        return new vscode.Hover(markdown, new vscode.Range(document.positionAt(node.key.offset), document.positionAt(node.key.offset + node.key.length)));
      }
      if (node?.kind === `link` && node.path && !node.path.dynamic) {
        const refs = javaIndex.findHandlersForPath(node.path.value);
        const staticUri = templateIndex.staticUri(node.path.value);
        if (refs.length === 0 && !staticUri) {
          return undefined;
        }
        markdown.appendCodeblock(node.path.value, `text`);
        refs.length > 0 && markdown.appendMarkdown(refs.map((ref) => `- ${ref.handler.httpMethods.join(`/`) || `ANY`} \`${ref.type.name}.${ref.handler.methodName}()\` (${fileLabel(ref.fsPath, ref.handler.line)})`).join(`\n`));
        staticUri && markdown.appendMarkdown(`${refs.length > 0 ? `\n` : ``}- static resource ${staticUri.fsPath}`);
        return new vscode.Hover(markdown, new vscode.Range(document.positionAt(node.path.offset), document.positionAt(node.path.offset + node.path.length)));
      }
      if (node?.kind === `fragment` && node.selector && !node.selector.dynamic) {
        const catalog = !node.template || node.template.value === `` || node.template.value === `this` ? { "fragments": located.template.fragments } : semanticIndex.fragmentCatalog(node.template.value);
        const definition = catalog?.fragments.find((fragment) => fragment.name === node.selector?.value.trim());
        if (!definition) {
          return undefined;
        }
        markdown.appendCodeblock(`${definition.prefix}:fragment="${definition.name}${definition.params.length > 0 ? `(${definition.params.join(`, `)})` : ``}"`, `html`);
        markdown.appendMarkdown(`Defined on \`<${definition.tag}>\` in \`${node.template?.value || located.templateName || `this template`}\`.`);
        return new vscode.Hover(markdown, new vscode.Range(document.positionAt(node.selector.offset), document.positionAt(node.selector.offset + node.selector.length)));
      }
      const utilityRange = document.getWordRangeAtPosition(position, UTILITY_WORD_PATTERN);
      if (utilityRange) {
        const utility = findUtilityObject(document.getText(utilityRange).slice(1));
        if (utility) {
          markdown.appendCodeblock(`#${utility.name}`, `java`);
          markdown.appendMarkdown(utility.doc);
          return new vscode.Hover(markdown, utilityRange);
        }
      }
      return undefined;
    },
  };

  // 4-1. 프래그먼트 참조 위치 해석 (명령에서도 사용)
  const resolveFragmentLocation = async (document: vscode.TextDocument, node: ExpressionNodeType): Promise<vscode.Location | undefined> => {
    if (!node.template || node.template.dynamic) {
      return undefined;
    }
    const templateName = node.template.value;
    const target = templateName === `` || templateName === `this` ? document.uri : await templateIndex.resolveTemplate(templateName, document.uri);
    if (!target) {
      logger(`debug`, `resolveFragmentLocation - template not found: ${templateName}`);
      return undefined;
    }
    const fragmentPosition = await templateIndex.findFragmentPosition(target, node.selector?.value ?? ``);
    return new vscode.Location(target, new vscode.Position(fragmentPosition.line, fragmentPosition.column));
  };
  const resolveReferenceAt = async (document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location | undefined> => {
    const located = locate(document, position);
    const node = located.node?.kind === `fragment` ? located.node : located.attribute?.parsed.expressions.find((candidate) => candidate.kind === `fragment`);
    return node && located.attribute && FRAGMENT_REF_NAMES.has(located.attribute.name) ? resolveFragmentLocation(document, node) : undefined;
  };

  // 4-2. 정의 프로바이더
  const definitionProvider: vscode.DefinitionProvider = {
    provideDefinition: async (document, position) => {
      if (!isEnabled()) {
        return undefined;
      }
      const located = locate(document, position);
      const resolution = resolveAt(located);
      if (located.chain && resolution) {
        if (located.segmentIndex < 0) {
          if (resolution.rootKind === `model` && resolution.modelAttributes) {
            return resolution.modelAttributes.filter((attribute) => attribute.fsPath !== ``).map((attribute) => toLocation(attribute.fsPath, attribute.line, attribute.column, attribute.length));
          }
          if (resolution.rootKind === `local` && resolution.local) {
            const attribute = resolution.local.attribute;
            return new vscode.Location(document.uri, new vscode.Range(document.positionAt(attribute.nameOffset), document.positionAt(attribute.valueOffset + attribute.value.length + 1)));
          }
          if (resolution.rootKind === `object` && resolution.segmentProperties[0]?.fsPath) {
            const property = resolution.segmentProperties[0];
            return toLocation(property.fsPath, property.line, 0, 1);
          }
        }
        else {
          const property = resolution.segmentProperties[located.segmentIndex];
          if (property?.fsPath) {
            return toLocation(property.fsPath, property.line, 0, 1);
          }
        }
      }
      const node = located.node;
      if (node?.kind === `message` && node.key && !node.key.dynamic) {
        return messageIndex.findMessages(node.key.value).map((entry) => toLocation(entry.fsPath, entry.line, entry.column, entry.key.length));
      }
      if (node?.kind === `link` && node.path && !node.path.dynamic) {
        const refs = javaIndex.findHandlersForPath(node.path.value).map((ref) => toLocation(ref.fsPath, ref.handler.line, 0, 1));
        const staticUri = templateIndex.staticUri(node.path.value);
        staticUri && refs.push(new vscode.Location(staticUri, new vscode.Position(0, 0)));
        return refs;
      }
      if (node?.kind === `fragment`) {
        return resolveFragmentLocation(document, node);
      }
      return undefined;
    },
  };

  // 4-3. 참조 프로바이더 (모델 속성 사용처 + Java 정의)
  const referenceProvider: vscode.ReferenceProvider = {
    provideReferences: async (document, position) => {
      if (!isEnabled()) {
        return undefined;
      }
      const located = locate(document, position);
      if (!located.chain || located.segmentIndex >= 0 || located.chain.root.kind !== `identifier`) {
        return undefined;
      }
      const name = located.chain.root.name;
      const resolution = resolveAt(located);
      const locations: vscode.Location[] = [];
      for (const attribute of resolution?.modelAttributes ?? []) {
        attribute.fsPath !== `` && locations.push(toLocation(attribute.fsPath, attribute.line, attribute.column, attribute.length));
      }
      const seen = new Set<string>();
      for (const usage of templateIndex.attributeUsages(name)) {
        const target = await vscode.workspace.openTextDocument(usage.uri);
        const key = `${usage.uri.toString()}:${usage.offset}`;
        if (!seen.has(key)) {
          seen.add(key);
          locations.push(new vscode.Location(usage.uri, new vscode.Range(target.positionAt(usage.offset), target.positionAt(usage.offset + usage.length))));
        }
      }
      const localNodes = [...located.template.attributes.flatMap((attribute) => attribute.parsed.expressions), ...located.template.inlines.flatMap((inline) => inline.parsed.expressions)];
      for (const node of localNodes) {
        for (const chain of node.chains) {
          const key = `${document.uri.toString()}:${chain.root.offset}`;
          if (chain.root.kind === `identifier` && chain.root.name === name && !seen.has(key)) {
            seen.add(key);
            locations.push(new vscode.Location(document.uri, new vscode.Range(document.positionAt(chain.root.offset), document.positionAt(chain.root.offset + chain.root.length))));
          }
        }
      }
      return locations;
    },
  };

  // 5-1. 시그니처 도움말 (프래그먼트·메시지 인자)
  const signatureHelpProvider: vscode.SignatureHelpProvider = {
    provideSignatureHelp: (document, position) => {
      if (!isEnabled()) {
        return undefined;
      }
      const located = locate(document, position);
      const node = located.parsed?.expressions.filter((candidate) => (candidate.kind === `fragment` || candidate.kind === `message`) && candidate.argsOffset >= 0 && located.offset >= candidate.argsOffset && located.offset <= candidate.offset + candidate.length).sort((left, right) => right.argsOffset - left.argsOffset)[0];
      if (!node) {
        return undefined;
      }
      const argsText = document.getText().slice(node.argsOffset, located.offset);
      let depth = 0;
      let activeParameter = 0;
      for (const ch of argsText) {
        if (ch === `(` || ch === `{` || ch === `[`) {
          depth++;
        }
        else if (ch === `)` || ch === `}` || ch === `]`) {
          depth--;
        }
        else if (ch === `,` && depth === 0) {
          activeParameter++;
        }
      }
      const help = new vscode.SignatureHelp();
      if (node.kind === `fragment` && node.selector) {
        const catalog = !node.template || node.template.value === `` || node.template.value === `this` ? { "fragments": located.template.fragments } : semanticIndex.fragmentCatalog(node.template.value);
        const definition = catalog?.fragments.find((fragment) => fragment.name === node.selector?.value.trim());
        if (!definition) {
          return undefined;
        }
        const signature = new vscode.SignatureInformation(`${definition.name}(${definition.params.join(`, `)})`, new vscode.MarkdownString(`Fragment on \`<${definition.tag}>\``));
        signature.parameters = definition.params.map((param) => new vscode.ParameterInformation(param));
        help.signatures = [signature];
      }
      else if (node.kind === `message` && node.key) {
        const entries = messageIndex.findMessages(node.key.value);
        if (entries.length === 0) {
          return undefined;
        }
        const placeholders = Math.max(...entries.map((entry) => entry.placeholders));
        const params = Array.from({ "length": placeholders }, (_, index) => `{${index}}`);
        const signature = new vscode.SignatureInformation(`${node.key.value}(${params.join(`, `)})`, new vscode.MarkdownString(entries.map((entry) => `- **${entry.locale}**: ${entry.value}`).join(`\n`)));
        signature.parameters = params.map((param) => new vscode.ParameterInformation(param));
        help.signatures = [signature];
      }
      else {
        return undefined;
      }
      help.activeSignature = 0;
      help.activeParameter = activeParameter;
      return help;
    },
  };

  // 5-2. 문서 링크 (템플릿·정적 리소스)
  const documentLinkProvider: vscode.DocumentLinkProvider = {
    provideDocumentLinks: (document) => {
      if (!isEnabled()) {
        return [];
      }
      const { template } = parseDocument(document);
      const links: vscode.DocumentLink[] = [];
      const nodes = [...template.attributes.flatMap((attribute) => attribute.parsed.expressions), ...template.inlines.flatMap((inline) => inline.parsed.expressions)];
      for (const node of nodes) {
        if (node.kind === `fragment` && node.template && !node.template.dynamic && node.template.value !== `` && node.template.value !== `this`) {
          const target = templateIndex.templateUri(node.template.value);
          target && links.push(new vscode.DocumentLink(new vscode.Range(document.positionAt(node.template.offset), document.positionAt(node.template.offset + node.template.length)), target));
        }
        if (node.kind === `link` && node.path && !node.path.dynamic) {
          const target = templateIndex.staticUri(node.path.value);
          target && links.push(new vscode.DocumentLink(new vscode.Range(document.positionAt(node.path.offset), document.positionAt(node.path.offset + node.path.length)), target));
        }
      }
      return links;
    },
  };

  // 5-3. 문서 심볼 (프래그먼트 정의)
  const symbolProvider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols: (document) => {
      if (!isEnabled()) {
        return undefined;
      }
      const { template } = parseDocument(document);
      return template.fragments.map((fragment) => {
        const range = new vscode.Range(document.positionAt(fragment.offset), document.positionAt(fragment.offset + fragment.length));
        const detail = `${fragment.prefix}:fragment on <${fragment.tag}>${fragment.params.length > 0 ? ` (${fragment.params.join(`, `)})` : ``}`;
        return new vscode.DocumentSymbol(fragment.name, detail, vscode.SymbolKind.Function, range, range);
      });
    },
  };

  const clearCache = (): void => cache.clear();

  return { completionProvider, hoverProvider, definitionProvider, referenceProvider, signatureHelpProvider, documentLinkProvider, symbolProvider, resolveReferenceAt, clearCache };
};
