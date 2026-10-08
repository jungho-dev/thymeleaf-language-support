// exports/ExportTypes.ts

import type { ThymeleafCommand } from "@exportCommands";
import type { JavaViewProvider, ThymeleafDiagnosticProvider, ThymeleafLanguageProvider } from "@exportProviders";
import type { JavaIndexService, MessageIndexService, TemplateIndexService } from "@exportServices";

// 다이얼렉트 ---------------------------------------------------------------------
export const DIALECT_PREFIXES = [`th`, `sec`, `layout`] as const;
export type DialectPrefixType = (typeof DIALECT_PREFIXES)[number];
export type AttributeKindType = `expression` | `each` | `inline` | `fragment-def` | `fragment-ref` | `assignation` | `remove` | `object` | `text` | `utext` | `case` | `fixed` | `spel` | `assert` | `plain`;
export interface DialectAttributeType {
  name: string;
  kind: AttributeKindType;
  doc: string;
  deprecated?: string;
}
export interface UtilityObjectType {
  name: string;
  doc: string;
}

// 표현식 AST ---------------------------------------------------------------------
export type ExpressionKindType = `variable` | `selection` | `message` | `link` | `fragment`;
export type ChainRootKindType = `identifier` | `utility` | `bean` | `literal` | `type` | `call` | `other`;
export interface ChainSegmentType {
  kind: `property` | `call` | `index` | `projection` | `selection`;
  name: string;
  safe: boolean;
  offset: number;
  length: number;
}
export interface ChainRootType {
  kind: ChainRootKindType;
  name: string;
  offset: number;
  length: number;
}
export interface ExpressionPartType {
  value: string;
  offset: number;
  length: number;
  dynamic: boolean;
}
export interface ExpressionArgType {
  name: string;
  offset: number;
  length: number;
}
export interface ExpressionChainType {
  root: ChainRootType;
  segments: ChainSegmentType[];
  guarded?: boolean;
}
export interface ExpressionNodeType {
  kind: ExpressionKindType;
  offset: number;
  length: number;
  inner: string;
  innerOffset: number;
  chains: ExpressionChainType[];
  key?: ExpressionPartType;
  path?: ExpressionPartType;
  pathVariables: string[];
  template?: ExpressionPartType;
  selector?: ExpressionPartType;
  args: ExpressionArgType[];
  namedArgs: boolean;
  argsOffset: number;
}
export interface AssignmentType {
  name: string;
  offset: number;
  expression?: ExpressionNodeType;
}
export interface ParsedValueType {
  errors: ExpressionIssueType[];
  expressions: ExpressionNodeType[];
  eachVars: string[];
  eachIterable?: ExpressionNodeType;
  assignments: AssignmentType[];
  fragmentName?: string;
  fragmentParams: string[];
}

// 템플릿 파싱 ---------------------------------------------------------------------
export interface TemplateAttributeType {
  prefix: DialectPrefixType;
  name: string;
  raw: string;
  value: string;
  hasValue: boolean;
  nameOffset: number;
  valueOffset: number;
  quote: string;
  tag: string;
  tagOffset: number;
  elementIndex: number;
  kind: AttributeKindType;
  parsed: ParsedValueType;
}
export interface TemplateInlineType {
  kind: `escaped` | `unescaped`;
  content: string;
  offset: number;
  length: number;
  closed: boolean;
  scriptMode: boolean;
  elementIndex: number;
  parsed: ParsedValueType;
}
export interface TemplateFragmentType {
  name: string;
  params: string[];
  prefix: DialectPrefixType;
  tag: string;
  offset: number;
  length: number;
  elementIndex: number;
}
export interface TemplateElementType {
  index: number;
  tag: string;
  id?: string;
  offset: number;
  parent: number;
  attributes: TemplateAttributeType[];
}
export interface TemplateModelType {
  attributes: TemplateAttributeType[];
  inlines: TemplateInlineType[];
  fragments: TemplateFragmentType[];
  elements: TemplateElementType[];
  tagNames: Set<string>;
  ids: Set<string>;
  refs: Set<string>;
  hasNamespace: boolean;
  isThymeleaf: boolean;
}
export interface FragmentReferenceType {
  template: string;
  selector: string;
  dynamic: boolean;
}

// 스코프 -------------------------------------------------------------------------
export type LocalKindType = `each` | `stat` | `with` | `fragment-param`;
export interface LocalVariableType {
  name: string;
  kind: LocalKindType;
  attribute: TemplateAttributeType;
  expression?: ExpressionNodeType;
}
export interface ScopeType {
  locals: Map<string, LocalVariableType>;
  objectAttribute?: TemplateAttributeType;
  insideFragment: boolean;
}

// 진단 ---------------------------------------------------------------------------
export type DiagnosticSeverityType = `error` | `warning` | `information` | `hint`;
export interface ExpressionIssueType {
  code: string;
  message: string;
  severity: DiagnosticSeverityType;
  offset: number;
  length: number;
}
export interface TemplateDiagnosticType extends ExpressionIssueType {
  line: number;
  column: number;
}
export interface TemplateAnalysisType {
  template: TemplateModelType;
  diagnostics: TemplateDiagnosticType[];
}
export interface AnalysisOptionsType {
  additionalAttributes?: string[];
}
export interface TextPositionType {
  line: number;
  column: number;
}

// Java 모델 ------------------------------------------------------------------------
export interface JavaAnnotationType {
  name: string;
  args: string;
}
export interface JavaFieldType {
  name: string;
  type: string;
  annotations: JavaAnnotationType[];
  isPublic: boolean;
  isStatic: boolean;
  line: number;
  offset: number;
}
export interface JavaParamType {
  name: string;
  type: string;
  annotations: JavaAnnotationType[];
}
export interface JavaMethodType {
  name: string;
  returnType: string;
  params: JavaParamType[];
  annotations: JavaAnnotationType[];
  isPublic: boolean;
  isStatic: boolean;
  line: number;
  offset: number;
  bodyStart: number;
  bodyEnd: number;
}
export interface JavaViewNameType {
  name: string;
  offset: number;
  length: number;
  line: number;
  column: number;
  implicit: boolean;
}
export type ModelAttributeSourceType = `addAttribute` | `param` | `modelAttributeMethod` | `flash` | `session` | `request` | `view`;
export interface ModelAttributeType {
  name: string;
  typeName?: string;
  valueExpr?: string;
  fsPath: string;
  line: number;
  column: number;
  length: number;
  offset: number;
  source: ModelAttributeSourceType;
  methodName: string;
}
export interface JavaInferenceContextType {
  params: Map<string, string>;
  locals: Map<string, string>;
  fields: Map<string, string>;
  ownerType?: JavaTypeType;
  lookupType: (simpleName: string) => JavaTypeType | undefined;
}
export interface JavaHandlerType {
  methodName: string;
  line: number;
  offset: number;
  paths: string[];
  httpMethods: string[];
  viewNames: JavaViewNameType[];
  attributes: ModelAttributeType[];
  dynamic: boolean;
}
export interface JavaTypeType {
  name: string;
  qualifiedName: string;
  kind: `class` | `interface` | `enum` | `record`;
  annotations: JavaAnnotationType[];
  extendsName?: string;
  implementsNames: string[];
  fields: JavaFieldType[];
  methods: JavaMethodType[];
  recordComponents: JavaFieldType[];
  enumConstants: string[];
  lombokGetters: boolean;
  line: number;
  offset: number;
  bodyStart: number;
  bodyEnd: number;
  isController: boolean;
  isRestController: boolean;
  isControllerAdvice: boolean;
  isInterceptor: boolean;
  classPaths: string[];
  sessionAttributes: string[];
  handlers: JavaHandlerType[];
  modelAttributeMethods: ModelAttributeType[];
  classAttributes: ModelAttributeType[];
  flashAttributes: ModelAttributeType[];
  dynamicModel: boolean;
}
export interface JavaFileType {
  fsPath: string;
  packageName: string;
  imports: string[];
  types: JavaTypeType[];
}
export interface JavaViewLiteralType {
  view: JavaViewNameType;
  methodName: string;
  typeName: string;
}

// 메시지 ---------------------------------------------------------------------------
export interface MessageEntryType {
  key: string;
  value: string;
  fsPath: string;
  locale: string;
  line: number;
  column: number;
  placeholders: number;
}

// 시맨틱 인덱스 (프로바이더가 주입) ---------------------------------------------------------
export interface ModelContextType {
  mapped: boolean;
  dynamic: boolean;
  attributes: Map<string, ModelAttributeType[]>;
}
export interface TypeRefType {
  name: string;
  args: TypeRefType[];
  array: boolean;
}
export interface TypePropertyType {
  name: string;
  type: string;
  fsPath: string;
  line: number;
  offset: number;
  kind: `field` | `getter` | `component` | `method`;
}
export interface ResolvedTypeType {
  ref?: TypeRefType;
  open: boolean;
  javaType?: JavaTypeType;
  fsPath?: string;
}
export interface FragmentCatalogType {
  fragments: TemplateFragmentType[];
  tagNames: Set<string>;
  ids: Set<string>;
  refs: Set<string>;
}
export interface SemanticIndexType {
  modelContextFor: (templateName: string | undefined) => ModelContextType;
  resolveJavaType: (simpleName: string) => { type: JavaTypeType; fsPath: string } | undefined;
  hasMessages: () => boolean;
  findMessages: (key: string) => MessageEntryType[];
  hasLinks: () => boolean;
  linkExists: (path: string) => boolean;
  fragmentCatalog: (templateName: string | undefined) => FragmentCatalogType | undefined;
}
export interface SemanticOptionsType {
  templateName?: string;
  modelValidation: boolean;
  linkValidation: boolean;
  messageValidation: boolean;
}
export interface SemanticResolutionType {
  node: ExpressionNodeType;
  chain: ExpressionChainType;
  rootKind: `local` | `model` | `context` | `utility` | `object` | `unknown` | `other`;
  local?: LocalVariableType;
  modelAttributes?: ModelAttributeType[];
  rootType: ResolvedTypeType;
  segmentTypes: ResolvedTypeType[];
  segmentProperties: (TypePropertyType | undefined)[];
}
export interface SemanticAnalysisType {
  diagnostics: ExpressionIssueType[];
  resolutions: Map<ExpressionChainType, SemanticResolutionType>;
}

// 서비스·프로바이더 타입 -------------------------------------------------------------
export type TemplateIndexServiceType = ReturnType<typeof TemplateIndexService>;
export type JavaIndexServiceType = ReturnType<typeof JavaIndexService>;
export type MessageIndexServiceType = ReturnType<typeof MessageIndexService>;
export type ThymeleafDiagnosticProviderType = ReturnType<typeof ThymeleafDiagnosticProvider>;
export type ThymeleafLanguageProviderType = ReturnType<typeof ThymeleafLanguageProvider>;
export type JavaViewProviderType = ReturnType<typeof JavaViewProvider>;
export type ThymeleafCommandType = ReturnType<typeof ThymeleafCommand>;
