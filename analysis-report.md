# Thymeleaf-Language-Support 분석·수정 작업 보고서

## 1. 개요

1. 대상
   - 확장 런타임 전체: `src/extension.ts`, `src/services/*`, `src/providers/*`, `src/models/*`, `src/commands/*`
2. 기준선 (수정 전)
   - `bun test`: 79 pass, 0 fail
   - `bun run typecheck`: 오류 없음
3. 재현 근거 (수정 전, bun 측정)
   - 중첩 `th:object="*{address}"` 템플릿: `analyzeSemantics` 가 `RangeError: Maximum call stack size exceeded` 로 실패
   - `parseTemplate` 처리 시간: 102KB 59ms, 408KB 558ms, 1.6MB 7978ms (크기 4배당 시간 약 10~14배, 2차 증가)

## 2. 리소스·성능 문제

### 2-1. CPU

1. R1 템플릿 파서 인라인 스캔 2차 복잡도
   - 위치: `src/models/ThymeleafModel.ts` `scanInlines`
   - 원인: 태그 사이 구간마다 `text.indexOf("[[")`, `text.indexOf("[(")` 가 구간 끝이 아닌 문서 끝까지 검색함
   - 영향: 태그 수 × 문서 길이 비용. 큰 템플릿에서 키 입력마다 진단·완성이 수백 ms~수 초 지연
   - 조치: 다음 출현 위치를 캐시해 문서 전체를 한 번만 훑도록 변경
2. R2 같은 문서 이중 파싱
   - 위치: `ThymeleafDiagnosticProvider.apply` 와 `ThymeleafLanguageProvider.parseDocument`
   - 원인: 진단과 언어 기능이 같은 버전 문서를 각자 `parseTemplate` 함
   - 조치: 문서 버전 키 공유 캐시 `DocumentModelService` 도입, 진단은 `analyzeParsedTemplate` 로 재사용
3. R3 모델 컨텍스트 반복 생성
   - 위치: `SemanticModel.resolveChain` → `SemanticIndexService.modelContextFor`
   - 원인: 표현식 체인마다 컨트롤러·포함자·ControllerAdvice·flash 속성 Map 을 새로 병합
   - 조치: 인덱스 세대(generation) 키 캐시로 템플릿당 1회 생성
4. R4 타입 프로퍼티 목록 반복 계산
   - 위치: `SemanticModel.propertyEntries`
   - 조치: `WeakMap<JavaTypeType, ...>` 캐시 (타입 재파싱 시 자동 무효화)
5. R5 CodeLens 사용처 전수 스캔
   - 위치: `JavaViewProvider.codeLensProvider` → `TemplateIndexService.attributeUsages`
   - 원인: 클래스 속성마다 전체 템플릿의 모든 표현식을 순회. 또 Java 문서 진단(`apply`)마다 `lensEmitter.fire()` 로 CodeLens 전체 재계산 유발
   - 조치: 루트 식별자 사용처 인덱스(Map) 유지, `apply` 의 불필요한 lens 재발화 제거
6. R6 Java 파일 일괄 갱신 시 파생 인덱스 N회 재구성
   - 위치: `JavaIndexService.updateFile`
   - 원인: 변경 파일마다 `rebuildDerived()` 호출 (브랜치 전환 등 대량 변경 시 O(N²))
   - 조치: 일괄 파싱 후 1회 재구성
7. R7 표현식 노드 깊은 복사
   - 위치: `ExpressionParser.parseAttributeValue` `shiftNode`
   - 원인: 모든 속성값 파싱 결과를 오프셋 이동을 위해 통째로 복제
   - 조치: 새로 만든 노드이므로 제자리 이동으로 변경
8. R8 Java 소스 마스킹의 문자 배열 분해
   - 위치: `JavaModel.maskSource`, `blankBlocks`
   - 원인: 파일 전체를 `split("")` 로 문자 배열 2개로 만든 뒤 `join`
   - 조치: 구간 문자열 조립 방식으로 변경
9. R9 완성 요청마다 문서 앞부분 전체 복사
   - 위치: `ThymeleafLanguageProvider.completionProvider`
   - 원인: `getText(0..position)`, `getText().slice(...)` 로 매 키 입력 시 문서 전체 문자열 복사
   - 조치: 필요한 구간만 읽도록 변경
10. R10 활성화 직후 진단 중복 실행
    - 위치: `extension.ts` `activate`
    - 원인: 즉시 1회 + 스캔 완료 후 1회 + 인덱스 이벤트 refresh 1회
    - 조치: 스캔 완료 후 명시 호출 제거 (인덱스 이벤트 refresh 가 담당)

### 2-2. 메모리·I/O

1. M1 템플릿 인덱스가 전체 AST 보관
   - 위치: `TemplateIndexService` `entries`
   - 원인: 최대 3000개 템플릿의 속성·인라인·표현식 AST 전체를 상주시킴. 실제 사용은 프래그먼트 카탈로그와 루트 식별자 사용처뿐
   - 조치: 카탈로그·참조·사용처(오프셋, 줄/열)만 보관하는 경량 엔트리로 변경
2. M2 언어 기능 파싱 캐시 무한 증가
   - 위치: `ThymeleafLanguageProvider` `cache`
   - 원인: 문서를 닫아도 삭제하지 않음 (인덱스 갱신 때만 전체 삭제)
   - 조치: 공유 캐시로 이전, 문서 닫힘 시 제거, 최대 엔트리 수 제한
3. M3 사용처 위치 계산을 위해 파일을 문서로 열기
   - 위치: `JavaViewProvider.resolveUsageLocations`, `ThymeleafLanguageProvider.referenceProvider`, `TemplateIndexService.findFragmentPosition`
   - 원인: `openTextDocument` 로 사용처 파일을 모두 메모리에 올림. 열린 문서마다 `onDidOpenTextDocument` 가 진단을 연쇄 실행함
   - 조치: 인덱싱 시 줄/열을 미리 계산해 문서를 열지 않음. 프래그먼트 위치는 파일 읽기로 계산
4. M4 Thymeleaf 가 없는 Java 프로젝트에서도 전체 Java 인덱싱
   - 위치: `activationEvents` `onLanguage:java` → `javaIndex.scan()`
   - 원인: 템플릿이 0개여도 Java 파일 최대 6000개와 메시지 번들을 파싱해 상주시킴
   - 조치: 템플릿이 1개 이상일 때만 Java·메시지 인덱싱, 템플릿이 생기면 자동 스캔

## 3. 로직 문제

1. L1 중첩 `th:object` 무한 재귀 (재현 확인)
   - 위치: `SemanticModel.resolveChain`
   - 원인: `th:object="*{address}"` 의 선택 표현식을 자기 자신을 객체로 하는 스코프로 해석
   - 영향: 해당 템플릿 진단 전체 실패, 호버·완성 예외
   - 조치: `th:object` 값은 부모 요소의 객체 기준으로 해석, 재귀 깊이 상한 추가
2. L2 `*{...}` 선택 표현식 경고 중복
   - 위치: `SemanticModel.analyzeSemantics`
   - 원인: `thymeleaf-selection-without-object` 를 노드가 아닌 체인마다 발행 (`*{a + b}` → 2건)
   - 조치: 노드당 1건
3. L3 `th:with` 순차 참조·같은 요소 `th:each` 타입 추론 누락
   - 위치: `SemanticModel.resolveLocalType`
   - 원인: 지역 변수 표현식을 부모 스코프로만 해석. `th:with="a=${x}, b=${a.y}"` 의 `a`, 같은 요소 `th:each` 변수를 못 봄
   - 조치: `th:with` 는 같은 요소 스코프에서 자신 이후 할당만 제외하고 해석
4. L4 스캔 중 인덱스가 비어 보이는 문제와 동시 스캔 경합
   - 위치: `TemplateIndexService.scan`, `JavaIndexService.scan`, `MessageIndexService.scan`
   - 원인: 기존 데이터를 먼저 `clear()` 하고 점진적으로 채움. 재스캔 중 진단이 돌면 `unknown-template` 등 거짓 경고 발생. 설정 변경과 재구성 명령이 겹치면 두 스캔이 같은 Map 을 섞어 채움
   - 조치: 새 Map 에 구성 후 완료 시 교체, 늦게 끝난 이전 스캔 결과는 폐기
5. L5 `JavaIndexService.scanning` 고착
   - 원인: `findFiles` 예외 시 `scanning = false` 미실행 → 상태바 스피너 영구 표시
   - 조치: `try/finally`
6. L6 정적 리소스 감시 오분류
   - 위치: `TemplateIndexService.schedule`
   - 원인: `static/` 아래 `.html` 생성·삭제가 템플릿 경로로만 처리되어 정적 경로 인덱스가 갱신되지 않음 (`@{/x.html}` 거짓 경고 또는 누락)
   - 조치: 정적 경로면 확장자와 무관하게 정적 인덱스 갱신
7. L7 템플릿 이름 충돌 시 경로 매핑 잔존
   - 위치: `TemplateIndexService.registerTemplate`
   - 원인: 같은 템플릿명을 다른 파일이 대체해도 이전 `byPath` 가 남음. 이전 파일 삭제 시 새 엔트리가 삭제됨
   - 조치: 대체 시 이전 매핑 제거, 삭제는 해당 경로가 소유한 엔트리일 때만
8. L8 비 Thymeleaf 프로젝트의 거짓 `thymeleaf-missing-view`
   - 위치: `JavaViewProvider.apply`, CodeLens
   - 원인: JSP 등 다른 뷰 기술 프로젝트에서도 모든 `return "view"` 에 경고와 "not found" CodeLens 표시
   - 조치: 인덱싱된 템플릿이 없으면 Java 측 진단·CodeLens 생략
9. L9 `javaEnabled` 끄기 후 Java 진단 잔존
   - 위치: `JavaViewProvider.apply`
   - 조치: 비활성 시 진단 삭제
10. L10 같은 문서 진단의 순서 역전
    - 위치: `ThymeleafDiagnosticProvider.apply`
    - 원인: 같은 버전에 대해 두 번 실행되면(편집 debounce 와 인덱스 refresh) 먼저 시작한 실행이 늦게 끝나 오래된 인덱스 기준 결과로 덮어씀
    - 조치: 문서별 요청 순번으로 최신 실행만 반영
11. L11 로거 리소스 미해제
    - 위치: `assets/scripts/logger.ts`
    - 원인: 출력 채널과 설정 리스너를 해제하지 않음
    - 조치: `disposeLogger` 추가, `deactivate` 에서 호출

## 4. 검증 계획

1. 단위 테스트
   - 기존 79건 유지
   - 추가: 중첩 `th:object`, 선택 경고 1건, `th:with` 순차 참조 타입, 대형 템플릿 파싱 선형성, 오프셋 제자리 이동, 마스킹 결과 동일성
2. 정적 검사
   - `bun run typecheck`, `bun run bundle`
3. 통합 테스트
   - `bun run test:e2e` (VS Code 확장 호스트, fixture Spring 워크스페이스)

## 5. 수정 결과

### 5-1. 검증 결과

1. 정적 검사
   - `bun run typecheck`: 오류 없음
   - `bunx biome lint src`: exit 0
   - `bun run bundle`: `out/extension.js` 108.6kb 생성
2. 단위 테스트
   - `bun test`: 88 pass, 0 fail (기존 79 + 신규 9)
3. 통합 테스트
   - `bun run test:e2e` (VSCodium 확장 호스트): 11 passed, 0 failed (기존 10 + 신규 참조 시나리오 1)
4. 동작 동일성
   - fixture Java·템플릿 전체의 `parseJavaFile`, `resolveAttributeTypes`, `analyzeTemplate` 결과 JSON 이 수정 전과 바이트 단위로 동일
5. 성능 재측정 (`parseTemplate`)
   - 102KB 59ms → 27ms
   - 408KB 558ms → 83ms
   - 1.6MB 7978ms → 247ms
   - 3.2MB 481ms (선형 증가 확인)
6. 중첩 `th:object`
   - `RangeError` 재현 입력이 예외 없이 `*{cty}` 만 `thymeleaf-unknown-property` 로 보고

### 5-2. 신규 테스트

1. `SemanticModel.spec.ts`
   - 중첩 `th:object` 해석, 바깥 객체 없는 `th:object="*{...}"` 1건, `*{a + b}` 경고 1건, `th:with` 앞선 할당 참조, 같은 요소 `th:each` 참조
2. `ExpressionParser.spec.ts`
   - 제자리 오프셋 이동 후 `eachIterable`·할당 표현식 참조 동일성, 전처리 중첩 오프셋
3. `ThymeleafModel.spec.ts`
   - 32,000행 템플릿 인라인 위치 정확성과 3초 미만 파싱, 앞 구간 미닫힘 인라인 이후 스캔 지속
4. `extension.e2e.ts`
   - 템플릿 간 모델 속성 참조가 선계산 위치로 정확한 범위를 반환하는지 검증

### 5-3. 테스트 변경

1. Java 측 e2e 단언 수정
   - 기존 단언은 첫 `thymeleaf-missing-view` 진단이 `missing/view` 라고 가정했으나 fixture 에 `items/detail.html` 이 없어 `items/detail` 도 정상적으로 보고됨
   - 순서와 무관하게 없는 뷰 두 개(`items/detail`, `missing/view`)를 정확히 보고하는지로 강화
   - 수정 전 코드에서도 같은 실패였는지는 HEAD 비교 실행이 차단되어 미확인 (정적으로는 해당 경로 로직 동일)

### 5-4. 남은 사항

1. 정적 리소스 감시 패턴
   - `staticWatcher` 는 기본 4개 경로 패턴 고정. `staticGlobs` 를 바꾼 경우 신규·삭제 정적 파일은 수동 `Rebuild Index` 또는 설정 변경 재스캔으로 반영
2. 스캔 중 감시 이벤트
   - 전체 스캔 진행 중 들어온 파일 변경은 스캔 결과 교체 시 누락될 수 있음 (다음 변경 또는 재스캔에서 복구)
3. 메모리 실측
   - 확장 호스트 힙 사용량은 측정하지 않음. 메모리 개선은 보관 구조 변경(AST 미보관, 문서 미오픈) 기준의 추정
