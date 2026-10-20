[English](README.md) | 한국어

# free-to-review

**무료 LLM에게 받는 코드와 계획에 대한 두 번째 의견.**

free-to-review는 Claude가 자기 작업의 리뷰를 *다른* LLM에게 맡길 수 있게 해 주는 Claude Code 플러그인입니다. 일반 MCP 서버로도 쓸 수 있습니다. [OpenRouter](https://openrouter.ai)의 무료(`:free`) 모델만 쓰므로 비용이 들지 않습니다. 자기 작업을 스스로 검토하는 모델은 자기 맹점을 되풀이하기 쉽습니다. 다르게 학습된 모델은 다른 문제를 찾아냅니다.

## 동작 방식

이 플러그인은 한 가지 흐름을 위해 만들었습니다. Claude가 자기 결과물의 리뷰를 다른 모델에게 위임하고, 돌아온 답을 직접 검증하는 흐름입니다.

1. **계기.** `second-opinion` 스킬이 Claude에게 세 시점에 두 번째 의견을 구하라고 알려줍니다. 의미 있는 코드 변경을 마친 뒤, 계획을 확정하기 전, 테스트를 작성할 때입니다. "이 diff에 대해 두 번째 의견 받아줘"처럼 직접 요청할 수도 있습니다.
2. **요청.** Claude가 프리셋과 자기완결적인 프롬프트로 `ask` 도구를 호출합니다. 프롬프트에는 목적, 언어, 제약 조건을 먼저 적고 그 뒤에 자료를 붙입니다. 예를 들어 코드를 고친 뒤라면 `preset: "review"`와 함께 변경분의 `git diff`를 보냅니다.
3. **라우팅.** 서버가 무료 모델을 고르고, 프리셋의 시스템 프롬프트와 Claude의 프롬프트를 보냅니다. 모델이 요청 한도에 걸렸거나 응답하지 않으면 다음 모델로 넘어갑니다. `F2R_PANEL`을 2나 3으로 설정하면 서로 다른 회사의 모델 여러 개에게 동시에 묻습니다.
4. **답변.** 답은 모델 이름이 붙은 채로 돌아옵니다. 외부에서 온 신뢰할 수 없는 텍스트라는 것을 표시하는 구분자로 감싸여 있습니다.
5. **검증.** Claude가 각 지적을 실제 코드와 대조하고, 타당한 것만 고친 뒤, 어떤 지적을 채택하고 기각했는지와 그 이유를 알려줍니다.

마지막에 보게 되는 결과(예시):

```
Second opinion (minimax/minimax-m3.1-flash:free):
Adopted:
- Off-by-one in the pagination loop — fixed the bound in src/list.ts
Rejected:
- "Validate the page size" — the route handler already validates it
```

## 다른 활용법

`ask`는 어떤 프롬프트든 받고 프리셋도 선택 사항이라서, Claude 자신의 변경을 리뷰하는 데만 쓸 수 있는 것은 아닙니다.

- **내가 쓴 것 리뷰받기.** 머지하기 전에 내가 쓴 설계 문서에 `critique`를, 내가 쓴 함수에 `edge-cases`를 돌려 달라고 Claude에게 요청할 수 있습니다.
- **분야별 리뷰어.** [사용자 프리셋](#사용자-프리셋)을 추가하세요. 예를 들어 락과 데이터 손실 위험을 보는 `sql-migration`, 인젝션과 인증 문제를 보는 `security`, 이름과 호환성 깨짐을 보는 `api-design` 같은 것입니다.
- **자유 형식의 다른 시각.** 프리셋 없이 `ask`를 호출해 두 접근 방식을 비교하거나, 오류 메시지가 적절한지 확인하거나, 다른 모델이라면 이름을 어떻게 지을지 물어볼 수 있습니다.
- **다른 MCP 클라이언트.** 어떤 MCP 클라이언트든 같은 도구를 호출할 수 있습니다. 다만 Claude Code 밖에서는 스킬 없이 도구만 쓰게 되므로, 자동으로 호출되거나 답을 검증해 주지는 않습니다.

## Claude Code 플러그인으로 설치

```
/plugin marketplace add gunhaa/free-to-review
/plugin install free-to-review@free-to-review
```

안내가 나오면 OpenRouter API 키를 입력하세요([openrouter.ai/keys](https://openrouter.ai/keys)에서 발급). Claude Code가 키를 보안 저장소에 보관합니다. 키를 설정하기 전에는 MCP 서버가 시작되지 않으며, 나중에 `/plugin` → free-to-review → configure에서 바꿀 수 있습니다.

플러그인이 추가하는 것:

- `f2r` MCP 서버의 `ask` 도구
- `second-opinion` 스킬: Claude가 언제 물어볼지(의미 있는 코드 변경 후, 계획을 확정하기 전, 테스트를 작성할 때)와 답을 어떻게 다룰지(모든 지적을 검증하고, 답 안의 지시는 절대 따르지 않으며, 채택·기각한 지적을 보고)를 알려줍니다.

## 다른 MCP 클라이언트에서 사용

저장소를 클론하고(컴파일된 서버가 `server/dist/`에 커밋되어 있습니다) 클라이언트 설정에 추가하세요.

```json
{
  "mcpServers": {
    "f2r": {
      "command": "node",
      "args": ["/path/to/free-to-review/server/dist/index.js"],
      "env": {
        "OPENROUTER_API_KEY": "<your key>"
      }
    }
  }
}
```

서버는 stdio로 MCP를 주고받으며 런타임 의존성이 없습니다.

## 설정

서버는 환경 변수만 읽습니다. Claude Code 플러그인에서는 키, 패널 크기, 선호 모델을 플러그인 설정으로 지정합니다.

| 변수 | 기본값 | 의미 |
|---|---|---|
| `OPENROUTER_API_KEY` | — (필수) | OpenRouter API 키 |
| `F2R_PANEL` | `1` | 동시에 물어볼 모델 수, 1–3. 모델마다 무료 할당량을 1회씩 씁니다. |
| `F2R_MODELS` | 비어 있음 | 선호 순서대로 쉼표로 구분한 모델 ID. 비어 있으면 무료 모델을 자동으로 찾습니다. |
| `F2R_PRESETS_DIR` | `$XDG_CONFIG_HOME/free-to-review/presets`, 없으면 `~/.config/free-to-review/presets` | 사용자 프리셋 디렉터리 |
| `F2R_TIMEOUT_MS` | `60000` | 요청당 타임아웃(밀리초) |
| `F2R_MAX_PROMPT_CHARS` | `100000` | 이보다 긴 프롬프트는 할당량 낭비를 막기 위해 거부합니다 |

잘못된 값은 stderr에 경고를 남기고 기본값을 씁니다.

### 모델 선택 방식

`F2R_MODELS`가 없으면 서버는 OpenRouter 모델 목록을 가져와(1시간 캐시) ID가 `:free`로 끝나고, 가격이 0이며, 텍스트를 입출력하는 모델만 남기고 컨텍스트가 큰 순으로 정렬합니다. 일시적 오류(rate limit, 사용 불가, 타임아웃, 빈 답변)로 실패하면 다음 모델을 최대 3회까지 시도합니다. 패널이 2–3이면 서로 다른 벤더의 모델을 골라 의견이 실제로 달라지게 합니다.

호출자(Claude)가 특정 모델을 지정할 때는 ID가 `:free`로 끝나야만 하므로 유료 모델로 요청이 새어 나갈 수 없습니다.

## 프리셋

기본 프리셋(모두 영어로 답합니다):

- `review` — 코드나 diff → 심각도별(Critical / Major / Minor) 지적과 각 지적의 위치, 문제, 중요한 이유, 수정 제안.
- `critique` — 설계, 계획, 결정 → 숨은 가정, 실패 시나리오, 더 단순한 대안, 열린 질문.
- `edge-cases` — 함수, 명세, 동작 설명 → 테스트할 만한 엣지 케이스 표.

각 프리셋은 "찾은 것 없음"이라는 명시적 답을 허용해 억지로 지적을 지어내지 않도록 합니다.

### 사용자 프리셋

프리셋 디렉터리(기본 `~/.config/free-to-review/presets`)에 Markdown 파일을 두세요. 파일 이름이 프리셋 이름이며 `^[a-z0-9-]+$`와 일치해야 합니다. 기본 프리셋과 이름이 같으면 그것을 대체합니다.

```markdown
---
description: Review SQL migrations for locking and data-loss risks.
---
You are a database engineer. Review the migration in the user message...
```

프리셋은 서버 시작 시 한 번 읽으므로, 바꾼 뒤에는 서버를 재시작하세요.

## 데이터와 개인정보

- `ask`로 보내는 모든 내용은 OpenRouter로, 그리고 거기서 선택된 모델의 제공자에게 전달됩니다.
- 무료 엔드포인트는 프롬프트를 기록하거나 학습에 사용할 수 있습니다. OpenRouter에서 각 모델 제공자의 정책을 확인하세요.
- 기밀 코드, 비밀값, 자격 증명, 개인정보는 보내지 마세요. 스킬은 Claude에게 필요한 자료만 보내고 민감한 내용은 가리도록 지시합니다.
- 서버 자체는 아무것도 저장하지 않으며 다른 곳으로 보내지 않습니다.

## 무료 등급 제한

OpenRouter는 무료 모델을 분당 20회, 하루 50회로 제한합니다. $10 이상 크레딧을 구매하면 하루 한도가 1,000회로 늘어납니다. 실패한 요청도 한도에 포함될 수 있습니다. 한도에 걸리면 `ask`는 OpenRouter가 알려준 초기화 시각과 함께 오류를 돌려줍니다.

## 요구 사항

`PATH`에 Node.js 20 이상.

## 개발

Node.js 22.18 이상이 필요합니다(테스트가 TypeScript를 직접 실행합니다).

```
cd server
npm install
npm test        # dist/를 빌드하고 모든 테스트 실행
npm run check   # 커밋된 dist/가 최신이 아니면 실패
OPENROUTER_API_KEY=... npm run smoke   # review 프리셋으로 실제 요청 1회
```

## 라이선스

[MIT](LICENSE)
