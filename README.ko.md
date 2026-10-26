[English](README.md) | 한국어

# free-to-review

**Claude Code 안에서 무료 LLM에게 받는 코드 리뷰와 답변.**

free-to-review는 작업을 *다른* LLM에게 넘기는 Claude Code 플러그인입니다. [NVIDIA build](https://build.nvidia.com)의 무료 모델이나 [OpenRouter](https://openrouter.ai)의 무료(`:free`) 모델을 쓰므로 비용이 들지 않습니다. 자기 작업을 스스로 검토하는 모델은 자기 맹점을 되풀이하기 쉽습니다. 다르게 학습된 모델은 다른 문제를 찾아냅니다.

| 명령 | 하는 일 |
|---|---|
| `/free-to-review:review [대상]` | 다른 모델에게 코드 리뷰를 받고, Claude가 각 지적을 검증합니다. |
| `/free-to-review:request <프롬프트>` | 어떤 요청이든 다른 모델에게 보내고 답을 보여줍니다. |
| `/free-to-review:provider` | 먼저 쓸 제공자(NVIDIA 또는 OpenRouter)를 고릅니다. |
| `/free-to-review:models` | 제공자별로 추천 무료 모델을 몇 개 쓸지 고릅니다. |

## `/free-to-review:review`

코드 리뷰를 다른 모델에게 맡기고 그 결과를 검증합니다.

```
/free-to-review:review                   # 커밋하지 않은 변경분, 없으면 마지막 커밋
/free-to-review:review src/auth.ts       # 특정 파일이나 디렉터리
/free-to-review:review main              # main 이후 이 브랜치의 모든 변경
/free-to-review:review 재시도 로직        # 볼 곳을 말로 설명
```

1. Claude가 코드를 모읍니다. diff, 지정한 파일, 또는 설명한 부분의 코드입니다.
2. Claude가 목적, 언어, 제약 조건을 짧게 적어 무료 모델에게 보냅니다.
3. 모델의 지적이 돌아오면 Claude가 하나씩 실제 코드와 대조합니다.
4. 지적은 타당함과 기각으로 나뉘어 이유와 함께 보고됩니다. 코드를 고치기 전에는 Claude가 먼저 묻습니다.

```
Review by deepseek-ai/deepseek-v4.1-flash (NVIDIA):
Valid:
- Off-by-one in the pagination loop — src/list.ts:42 reads one item past the end
Rejected:
- "Validate the page size" — the route handler already validates it
```

## `/free-to-review:request`

어떤 요청이든 다른 모델에게 보냅니다. 이 플러그인은 리뷰 명령 때문에 만들었지만, 두 번째 모델은 리뷰 말고도 쓸모가 많습니다.

```
/free-to-review:request 방금 작성한 마이그레이션 계획을 비판해줘. 무엇이 잘못될 수 있을까?
/free-to-review:request src/date.ts의 parseDate에서 내가 놓친 엣지 케이스는?
/free-to-review:request 읽기가 많은 이 API에 write-through 캐시와 TTL 캐시를 비교해줘
/free-to-review:request src/sync.ts 함수들의 더 명확한 이름을 제안해줘
```

요청은 그대로 전달됩니다. 다른 모델은 보낸 것만 볼 수 있으므로, 요청이 파일이나 대화 속 이전 작업을 가리키면 Claude가 그 자료를 붙여서 보냅니다. 답은 받은 그대로 보여주고, 그 뒤에 잘못돼 보이는 부분에 대한 Claude의 짧은 메모가 붙습니다.

## 시작하기

1. **키를 넣습니다.** 설치할 때 NVIDIA 키, OpenRouter 키, 또는 둘 다 입력합니다([설치](#설치) 참고). 키가 하나면 더 할 일은 없습니다.
2. **`/free-to-review:provider`**(선택). 키가 둘이면 먼저 쓸 제공자를 고릅니다. 먼저 쓰는 제공자가 실패하면 다른 제공자가 답합니다. 고르기 전에는 NVIDIA를 먼저 쓰고, 한 번만 안내 문구를 보여줍니다.
3. **`/free-to-review:models`**(선택). 제공자마다 추천 모델 중 몇 개를 쓸지 고릅니다: 상위 3, 5, 10개. 고르기 전에는 상위 5개를 씁니다.

## `/free-to-review:provider`

두 제공자를 상태와 함께 보여주는 대화상자를 엽니다. 예를 들어 `NVIDIA (recommended, key set, current)`, `OpenRouter (no key)`처럼 보입니다. NVIDIA는 무료 체험에 일일 한도가 없어서 추천합니다. 키가 없는 제공자는 고를 수 없습니다.

## `/free-to-review:models`

제공자마다 추천 무료 모델 중 몇 개를 쓸지 묻습니다: **상위 3개**, **상위 5개**(기본값), **상위 10개**. 선택지마다 포함되는 모델을 순서대로 미리 보여줍니다. 키가 없는 제공자도 함께 묻고, 그 선택은 키를 설정하면 적용됩니다. 목록은 요청할 때마다 다시 계산하므로, 제공자가 모델을 추가하거나 빼도 따라갑니다.

추천 목록은 플러그인에 내장되어 릴리스마다 갱신되며, 제공자가 더 이상 제공하지 않는 모델은 건너뜁니다.

선택은 플러그인 데이터 디렉터리(`~/.claude/plugins/data/<플러그인 id>/`, 정확한 경로는 명령이 보여줍니다)의 `settings.json`에 저장됩니다. 이 파일을 직접 편집할 수도 있습니다.

```json
{ "version": 1, "preferred": "nvidia", "models": { "nvidia": 3, "openrouter": 10 } }
```

터미널이 제공자 대화상자를 표시하지 못하면 명령이 대신 파일 경로와 형식을 알려줍니다.

## 동작 방식

- 요청마다 먼저 쓰는 제공자의 선택 집합(또는 추천 집합)에서 모델 하나를 무작위로 고릅니다.
- 답한 모델은 다음 30분 동안 먼저 다시 씁니다. Claude Code 세션이 바뀌어도 유지됩니다. 다른 제공자의 모델이 답했다면 10분 동안 다시 씁니다. 실패한 모델은 그 자리에서 바로 빠집니다.
- 제공자마다 최대 3개 모델을 시도합니다. 모두 실패하면 키가 있는 경우 다른 제공자를 시도하고, 답에 먼저 쓰는 제공자가 답하지 못한 이유를 함께 적습니다.
- 요청 하나는 5분이 지나면 포기합니다.
- NVIDIA 답은 streaming으로 받습니다. 30초 안에 아무것도 보내지 않는 모델은 보통 NVIDIA 대기열에 걸린 것이므로 다음 모델로 넘어갑니다.
- 403이나 404로 답한 모델은 한 시간 동안, 한도에 걸린 제공자는 한도가 풀릴 때까지 건너뜁니다. 이 상태는 `settings.json` 옆의 `state.json`에 보관되며, 지워도 괜찮습니다.

## 설치

```
/plugin marketplace add gunhaa/free-to-review
/plugin install free-to-review@free-to-review
```

안내가 나오면 NVIDIA API 키([build.nvidia.com](https://build.nvidia.com)), OpenRouter API 키([openrouter.ai/keys](https://openrouter.ai/keys)), 또는 둘 다 입력하세요. Claude Code가 키를 보안 저장소에 보관합니다. 두 키가 모두 있으면 `/free-to-review:provider`로 먼저 쓸 쪽을 고르세요. 키는 나중에 `/plugin` → free-to-review → configure에서 바꿀 수 있습니다.

### 업데이트

업데이트는 자동으로 설치되지 않습니다. 새 버전을 받으려면 마켓플레이스를 새로 고치고, 플러그인을 업데이트한 뒤, Claude Code를 다시 시작하세요.

```
claude plugin marketplace update free-to-review
claude plugin update free-to-review@free-to-review
```

API 키와 설정은 그대로 유지됩니다. 다른 마켓플레이스에서 설치했다면 마켓플레이스 이름 `free-to-review` 자리에 그 마켓플레이스 이름을 쓰세요. 첫 번째 명령의 이름과 두 번째 명령의 `@` 뒤 이름입니다.

## 설정

Claude Code의 플러그인 설정에서 지정합니다.

| 설정 | 기본값 | 의미 |
|---|---|---|
| NVIDIA API key | 비어 있음 | NVIDIA build API 키. |
| OpenRouter API key | 비어 있음 | OpenRouter API 키. |

키는 하나 이상 설정하세요. OpenRouter에서는 ID가 `:free`로 끝나는 모델만 쓰므로 요청이 유료 모델로 새어 나갈 수 없습니다. 자동 교정이 있는 앱을 거쳐 복사하면서 손상된 키는 되돌립니다. `—`나 `–`는 다시 `--`로 바꾸고("스마트 대시"가 `--`를 이렇게 바꿉니다), 보이지 않는 문자는 지웁니다. 그 밖의 ASCII가 아닌 문자가 있는 키는 무시하고, 명령이 그 사실을 알려줍니다.

## 다른 MCP 클라이언트에서 사용

명령은 Claude Code 기능이지만, 그 뒤의 서버는 `ask`, `provider`, `models` 세 도구를 가진 일반 MCP 서버입니다(`provider`는 elicitation을 지원하는 클라이언트가 필요하고, `models`는 인자 없이 부르면 추천 목록을 보여주고 크기를 넘기면 저장합니다). 저장소를 클론하고(컴파일된 서버가 `server/dist/`에 커밋되어 있습니다) 클라이언트 설정에 추가하세요.

```json
{
  "mcpServers": {
    "f2r": {
      "command": "node",
      "args": ["/path/to/free-to-review/server/dist/index.js"],
      "env": {
        "NVIDIA_API_KEY": "<your key>"
      }
    }
  }
}
```

서버는 환경 변수만 읽습니다. `NVIDIA_API_KEY`와 `OPENROUTER_API_KEY`(하나 이상), 그리고 다음 고급 설정입니다.

| 변수 | 기본값 | 의미 |
|---|---|---|
| `F2R_TIMEOUT_MS` | `120000` | 시도 한 번의 시간 제한. |
| `F2R_FIRST_BYTE_MS` | `30000` | NVIDIA 전용. 이 시간 동안 아무것도 보내지 않는 모델은 포기합니다(`1000` 이상). |
| `F2R_MAX_PROMPT_CHARS` | `100000` | 더 긴 프롬프트는 할당량을 낭비하지 않도록 거부합니다. |
| `F2R_DATA_DIR` | `~/.free-to-review` | `settings.json`과 `state.json`의 위치. |

잘못된 값은 stderr에 경고를 남기고 기본값을 씁니다.

## 데이터와 개인정보

- 명령이 보내는 모든 내용은 NVIDIA 또는 OpenRouter로 가고, OpenRouter의 경우 거기서 선택된 모델의 제공사로 갑니다.
- 무료 엔드포인트는 프롬프트를 기록하거나 학습에 쓸 수 있습니다. NVIDIA 약관과 OpenRouter의 모델별 제공사 정책을 확인하세요.
- 기밀 코드, 비밀값, 자격 증명, 개인정보는 보내지 마세요. 두 명령 모두 Claude에게 필요한 자료만 보내고 민감한 내용은 가리도록 지시합니다.
- 서버는 선택(`settings.json`)과 최근에 답하거나 실패한 모델(`state.json`)만 저장하고, 다른 곳으로는 아무것도 보내지 않습니다.

## 무료 등급 한도

NVIDIA 무료 체험은 분당 약 40회이며 일일 한도는 없습니다. OpenRouter는 무료 모델을 분당 20회, 하루 50회로 제한합니다. 크레딧을 $10 이상 구매하면 하루 한도가 1,000회로 늘어납니다. 실패한 요청도 한도에 포함될 수 있습니다. 한 제공자가 한도에 걸리면 키가 있는 경우 다른 제공자로 넘어가고, 제공자가 알려줄 경우 초기화 시각과 함께 알려줍니다.

두 무료 등급 모두 개발과 평가용이며, 프로덕션 용도가 아닙니다.

## 요구 사항

`PATH`에 Node.js 20 이상.

## 개발

Node.js 22.18 이상이 필요합니다(테스트가 TypeScript를 직접 실행합니다).

```
cd server
npm install
npm test        # dist/를 빌드하고 모든 테스트 실행
npm run check   # 커밋된 dist/가 최신이 아니면 실패
NVIDIA_API_KEY=... npm run smoke   # 실제 리뷰 요청 한 번(OPENROUTER_API_KEY도 가능)
```

## 라이선스

[MIT](LICENSE)
