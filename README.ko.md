[English](README.md) | 한국어

# free-to-review

**Claude Code 안에서 무료 LLM에게 받는 코드 리뷰와 답변.**

free-to-review는 명령 두 개를 가진 Claude Code 플러그인입니다. 두 명령 모두 [OpenRouter](https://openrouter.ai)의 무료(`:free`) 모델 중 *다른* LLM에게 작업을 넘기므로 비용이 들지 않습니다. 자기 작업을 스스로 검토하는 모델은 자기 맹점을 되풀이하기 쉽습니다. 다르게 학습된 모델은 다른 문제를 찾아냅니다.

| 명령 | 하는 일 |
|---|---|
| `/free-to-review:review [대상]` | 다른 모델에게 코드 리뷰를 받고, Claude가 각 지적을 검증합니다. |
| `/free-to-review:request <프롬프트>` | 어떤 요청이든 다른 모델에게 보내고 답을 보여줍니다. |

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
Review by minimax/minimax-m3.1-flash:free:
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

## 설치

```
/plugin marketplace add gunhaa/free-to-review
/plugin install free-to-review@free-to-review
```

안내가 나오면 OpenRouter API 키를 입력하세요([openrouter.ai/keys](https://openrouter.ai/keys)에서 발급). Claude Code가 키를 보안 저장소에 보관합니다. 키를 설정하기 전에는 플러그인이 시작되지 않으며, 나중에 `/plugin` → free-to-review → configure에서 바꿀 수 있습니다.

## 설정

Claude Code의 플러그인 설정에서 지정합니다.

| 설정 | 기본값 | 의미 |
|---|---|---|
| OpenRouter API key | — (필수) | OpenRouter API 키 |
| Panel size | `1` | 명령마다 답할 모델 수(1–3). 가능하면 서로 다른 회사의 모델을 고릅니다. 모델 하나가 무료 할당량에서 요청 하나를 씁니다. |
| Preferred models | 비어 있음 | 선호 순서대로 쉼표로 구분한 모델 ID. 비우면 무료 모델을 자동으로 고릅니다. |

무료 모델은 자동으로 골라 한 시간 동안 캐시합니다. 모델이 요청 한도에 걸렸거나 응답하지 않으면 다음 모델을 시도합니다. ID가 `:free`로 끝나는 모델만 쓰므로 요청이 유료 모델로 새어 나갈 수 없습니다.

## 다른 MCP 클라이언트에서 사용

명령은 Claude Code 기능이지만, 그 뒤의 서버는 `ask` 도구 하나를 가진 일반 MCP 서버입니다. 저장소를 클론하고(컴파일된 서버가 `server/dist/`에 커밋되어 있습니다) 클라이언트 설정에 추가하세요.

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

서버는 환경 변수만 읽습니다. `OPENROUTER_API_KEY`, `F2R_PANEL`, `F2R_MODELS`, `F2R_TIMEOUT_MS`(기본 `60000`), `F2R_MAX_PROMPT_CHARS`(기본 `100000`, 더 긴 프롬프트는 할당량을 낭비하지 않도록 거부)입니다. 잘못된 값은 stderr에 경고를 남기고 기본값을 씁니다.

## 데이터와 개인정보

- 명령이 보내는 모든 내용은 OpenRouter로 가고, 거기서 선택된 모델의 제공사로 갑니다.
- 무료 엔드포인트는 프롬프트를 기록하거나 학습에 쓸 수 있습니다. OpenRouter에서 모델별 제공사 정책을 확인하세요.
- 기밀 코드, 비밀값, 자격 증명, 개인정보는 보내지 마세요. 두 명령 모두 Claude에게 필요한 자료만 보내고 민감한 내용은 가리도록 지시합니다.
- 서버 자체는 아무것도 저장하지 않고 다른 곳으로 보내지도 않습니다.

## 무료 등급 한도

OpenRouter는 무료 모델을 분당 20회, 하루 50회로 제한합니다. 크레딧을 $10 이상 구매하면 하루 한도가 1,000회로 늘어납니다. 실패한 요청도 한도에 포함될 수 있습니다. 한도에 걸리면 OpenRouter가 알려줄 경우 초기화 시각과 함께 알려줍니다.

## 요구 사항

`PATH`에 Node.js 20 이상.

## 개발

Node.js 22.18 이상이 필요합니다(테스트가 TypeScript를 직접 실행합니다).

```
cd server
npm install
npm test        # dist/를 빌드하고 모든 테스트 실행
npm run check   # 커밋된 dist/가 최신이 아니면 실패
OPENROUTER_API_KEY=... npm run smoke   # 실제 리뷰 요청 한 번
```

## 라이선스

[MIT](LICENSE)
