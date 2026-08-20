# 배포 가이드 — Cloudflare Pages · `parkatzero.pages.dev`

이 문서 하나만 따라가면 `https://parkatzero.pages.dev` 가 뜹니다.
소요 시간 약 10분, 비용 0원(Pages 무료 플랜).

---

## 0. 준비물

| 항목 | 필수 | 비고 |
|---|:---:|---|
| Cloudflare 계정 | ✅ | 무료 |
| GitHub 저장소 | ✅ | Git 연동 배포용 |
| 공공데이터포털 인증키 | ⬜ | 없으면 시드 데이터로 동작 |
| Ezoic 계정 | ⬜ | 광고를 붙일 때만 |

---

## 1. 저장소 준비

```bash
git init
git add .
git commit -m "feat: ParkAtZero 초기 구축"
git branch -M main
git remote add origin https://github.com/<사용자명>/parkatzero.git
git push -u origin main
```

> `.gitignore` 에 `.env.local`, `.dev.vars`, `dist/`, `test-results/` 가 이미 등록되어 있습니다.
> **푸시 전에 `git status` 로 `.env.local` 이 목록에 없는지 반드시 확인하세요.**

---

## 2. Cloudflare Pages 프로젝트 생성

1. [Cloudflare 대시보드](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. GitHub 계정을 연결하고 `parkatzero` 저장소를 선택
3. 빌드 설정을 아래처럼 입력합니다.

| 항목 | 값 |
|---|---|
| **Project name** | `parkatzero` ← **이 이름이 곧 도메인이 됩니다** |
| Production branch | `main` |
| Framework preset | `Vite` (또는 None) |
| **Build command** | `npm run build:only` |
| **Build output directory** | `dist` |
| Root directory | *(비움)* |

> **프로젝트 이름이 곧 주소입니다.**
> `parkatzero` 로 만들면 `https://parkatzero.pages.dev` 가 됩니다.
> 이미 선점된 이름이면 생성 단계에서 바로 알려 주며, 나중에 이름만 바꿀 수는 없습니다
> (프로젝트를 다시 만들어야 합니다). 처음에 정확히 입력하세요.

4. **Save and Deploy** → 2~3분 뒤 첫 배포 완료.

---

## 3. 환경변수 설정

**Settings → Variables and Secrets** 에서 등록합니다.
**Production** 과 **Preview** 두 환경 모두에 넣어야 미리보기 배포도 정상 동작합니다.

### 3-1. 빌드 시점 변수 (브라우저에 노출됨)

`VITE_` 로 시작하는 값은 **빌드 결과물에 그대로 박혀 누구나 볼 수 있습니다.**
공개해도 무방한 값만 넣으세요.

| 변수 | 값 | 설명 |
|---|---|---|
| `VITE_PARKING_SEED_URL` | `/data/parkings.sample.json` | 시드 데이터 경로 |
| `VITE_PARKING_API_PROXY` | `/api/parkings` | 아래 프록시 함수 경로 |
| `VITE_ADS_ENABLED` | `false` → 승인 후 `true` | Ezoic 광고 스위치 |
| `VITE_EZOIC_PLACEHOLDER_LIST` | `101` | 목록 중간 슬롯 id |
| `VITE_EZOIC_PLACEHOLDER_BOTTOM` | `102` | 하단 슬롯 id |

### 3-2. 런타임 시크릿 (서버에서만 사용 — **Encrypt 체크**)

| 변수 | 값 | 설명 |
|---|---|---|
| `PARKING_API_KEY` | 공공데이터포털 **일반 인증키(Decoding)** | 절대 `VITE_` 를 붙이지 말 것 |
| `PARKING_API_BASE` | `https://api.odcloud.kr/api/<데이터셋ID>/v1/uddi:<UDDI>` | 데이터셋 엔드포인트 |

이 두 값은 `functions/api/parkings.ts` (Cloudflare Pages Function) 안에서만 읽힙니다.
브라우저는 `/api/parkings` 만 호출하고 인증키는 절대 내려가지 않습니다.

```
브라우저 ──▶ /api/parkings ──▶ (엣지에서 키 주입) ──▶ api.odcloud.kr
             ↑ 인증키 없음        ↑ 6시간 엣지 캐시
```

> 두 변수를 비워 두면 프록시가 `501` 을 돌려주고, 앱은 **시드 데이터로 그대로 동작**합니다.
> 즉 인증키 없이도 서비스는 정상입니다.

**변수를 바꾼 뒤에는 반드시 재배포**하세요 (Deployments → 최신 배포 → **Retry deployment**).
빌드 시점 변수는 재빌드해야 반영됩니다.

---

## 4. 공공데이터포털 인증키 발급 (선택)

1. [전국주차장정보표준데이터 페이지](https://www.data.go.kr/data/15012896/standard.do) 접속 → 로그인
2. **오픈 API** 탭 → **활용신청** (자동 승인, 즉시 발급)
3. 마이페이지 → 오픈API → 개발계정 → **일반 인증키(Decoding)** 복사 → `PARKING_API_KEY`
4. 같은 화면의 **오픈API 상세 URL** (`https://api.odcloud.kr/api/15012896/v1/uddi:<UUID>`) → `PARKING_API_BASE`

> 250개 기관이 올리는 데이터라 건수가 많습니다. 포털의 그리드 다운로드는 5만 건으로
> 제한되므로 전체가 필요하면 파일 다운로드나 API 를 쓰라고 안내되어 있습니다.
> 이 앱은 API(프록시) 경로를 기본으로 씁니다.

로컬에서 테스트하려면:

```bash
cp .dev.vars.example .dev.vars   # 인증키 입력
npx wrangler pages dev dist      # 함수까지 포함해 로컬 실행
```

---

## 5. 로컬 환경변수

```bash
cp .env.example .env.local
```

`.env.local` 은 `.gitignore` 에 걸려 있어 커밋되지 않습니다.
전부 비워 두어도 앱은 시드 데이터로 정상 동작합니다.

**절대 하지 말아야 할 것**

```bash
# ✗ 인증키가 번들에 박혀 전 세계에 공개됩니다
VITE_PARKING_API_KEY=발급받은_진짜_키
```

```bash
# ✓ 서버(엣지)에서만 읽히는 이름으로 두세요
PARKING_API_KEY=발급받은_진짜_키
```

---

## 6. 커스텀 도메인 (선택)

**Settings → Custom domains → Set up a domain**

1. 도메인 입력 (예: `parkatzero.kr`)
2. Cloudflare 에서 관리 중인 도메인이면 DNS 레코드가 자동 생성됩니다
3. 외부 등록기관이면 안내되는 `CNAME` 을 `parkatzero.pages.dev` 로 추가
4. SSL 인증서는 자동 발급 (보통 1~2분)

커스텀 도메인을 붙여도 `parkatzero.pages.dev` 는 계속 살아 있습니다.

---

## 7. 보안 헤더

`public/_headers` 가 배포 시 자동 적용됩니다.

```
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(self), camera=(), microphone=(), interest-cohort=()
```

`geolocation=(self)` 는 '내 위치' 버튼에 필요합니다. 이 항목을 지우면 GPS 가 동작하지 않습니다.

CSP 를 추가하려면 지도 타일과 광고 도메인을 함께 허용해야 합니다.

```
Content-Security-Policy: default-src 'self'; img-src 'self' data: https://*.basemaps.cartocdn.com; connect-src 'self' https://*.basemaps.cartocdn.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src https://cdn.jsdelivr.net; script-src 'self'
```

> Ezoic 을 켤 계획이면 CSP 를 먼저 넣지 마세요. 광고 스크립트가 여러 서드파티 도메인을 부르기 때문에
> 광고 승인 후 Ezoic 문서의 허용 목록을 확인해 한 번에 작성하는 편이 낫습니다.

---

## 8. GitHub Actions

| 워크플로우 | 트리거 | 하는 일 |
|---|---|---|
| `.github/workflows/test.yml` | push / PR (`main`) | 타입체크 · 린트 · 빌드 · E2E(데스크톱+모바일) |
| `.github/workflows/deploy.yml` | push (`main`) | wrangler 로 직접 배포 **(선택)** |
| `.github/workflows/refresh-data.yml` | **매월 1일** + 수동 | 주차장 데이터 자동 갱신 |

### 데이터 자동 갱신 (핵심)

원본 갱신주기가 '반기'라 실시간 API 호출은 낭비입니다.
**월 1회 받아 스냅샷으로 굽고 커밋하는** 방식이며, 그 커밋이 배포를 태웁니다.

```
매월 1일 ──▶ data:fetch (전체 페이지네이션)
              ↓
           data:verify (앱 코드로 실제 정규화·판별 검증)
              ↓  통과해야만
           변경 있으면 커밋 ──▶ deploy.yml ──▶ 사용자
```

검증 단계가 중요합니다. 공공데이터 컬럼명은 예고 없이 바뀌는데, 그대로 밀어 넣으면
**배포는 성공하고 화면만 텅 비는** 가장 알아채기 어려운 장애가 됩니다.
`scripts/verify-snapshot.mjs` 는 앱이 쓰는 코드(`normalize.ts`, `freeCalc.ts`)를 그대로 번들해
정규화 통과율·요금 판별 분포·좌표 범위를 확인하고, 이상하면 워크플로우를 실패시킵니다.

수동 실행: **Actions → 주차장 데이터 자동 갱신 → Run workflow**

### 필요한 Secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | 값 | 쓰는 곳 |
|---|---|---|
| `PARKING_API_KEY` | 공공데이터포털 **일반 인증키(Decoding)** | refresh-data |
| `PARKING_API_BASE` | `https://api.odcloud.kr/api/15012896/v1/uddi:<UUID>` | refresh-data |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → API Tokens → Edit Cloudflare Workers | deploy |
| `CLOUDFLARE_ACCOUNT_ID` | Workers & Pages 개요 우측 | deploy |

> **인증키는 GitHub Secrets 에만 넣으면 됩니다.**
> 스냅샷 방식이라 Cloudflare 에는 인증키가 필요 없습니다 —
> 앱은 정적 파일만 읽고, 런타임에 공공 API 를 호출하지 않습니다.
> 개발계정 일일 트래픽 10,000회 중 월 30~40회만 사용합니다.

Cloudflare **Git 연동을 쓰면 `deploy.yml` 은 필요 없습니다.** 둘 다 켜면 이중 배포가 됩니다.
CI 통과 후에만 배포하고 싶을 때 `deploy.yml` 을 쓰고, 그 경우 Pages 쪽 Git 연동은 끄세요.

`deploy.yml` 을 쓸 때 필요한 GitHub Secrets:

| Secret | 발급 위치 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → **Edit Cloudflare Workers** 템플릿 |
| `CLOUDFLARE_ACCOUNT_ID` | Workers & Pages 개요 우측 사이드바 |

브랜치 보호 규칙에는 **`CI 통과`** 잡 하나만 필수로 지정하면 됩니다.

---

## 9. Ezoic 광고 연동

앱은 광고가 **꺼져 있어도 자리를 먼저 잡습니다**(`AdSlot`).
높이를 미리 예약하고 스켈레톤을 깔아 두므로, 광고가 늦게 로드돼도 목록이 밀리지 않습니다(CLS 0).
E2E 테스트가 이 동작을 실제로 검증합니다.

1. [Ezoic](https://www.ezoic.com) 에 `parkatzero.pages.dev` 등록
2. **Ezoic Ads.txt** 와 사이트 인증 완료
3. **EzoicAds → Placeholders** 에서 슬롯 두 개 생성 → id 확인
4. Cloudflare 환경변수에 id 입력, `VITE_ADS_ENABLED=true` 로 변경 후 재배포
5. `index.html` `<head>` 에 Ezoic 스크립트 추가

```html
<script async src="https://www.ezojs.com/ezoic/sa.min.js"></script>
<script>
  window.ezstandalone = window.ezstandalone || {}
  ezstandalone.cmd = ezstandalone.cmd || []
</script>
```

> `AdSlot` 은 `ezstandalone.cmd` 큐에 `showAds(id)` 를 넣고, **슬롯이 화면에 들어올 때만** 요청합니다.
> 초기 로딩 예산(1초)을 광고가 잡아먹지 않게 하기 위함입니다.
> `VITE_E2E=true` 빌드에서는 스크립트를 아예 붙이지 않습니다.

---

## 10. 배포 확인 체크리스트

```
□ https://parkatzero.pages.dev 접속 시 1초 안에 목록이 뜬다
□ 다크/라이트 토글이 지도 타일까지 함께 바꾼다
□ 방문 시간을 저녁 8시로 바꾸면 초록 카드 수가 늘어난다
□ 카드를 누르면 지도가 부드럽게 이동하고 상세가 열린다
□ 길안내 4개 버튼이 각 앱/웹으로 연결된다
□ 모바일에서 바텀시트가 스와이프로 접히고 펼쳐진다
□ '내 위치' 버튼이 권한 요청 후 지도를 이동시킨다
□ DevTools → Network 에 인증키가 실린 요청이 없다
□ DevTools → Network 에 /data/cells/index.json 과 칸 몇 개만 받는다 (전체 스냅샷을 받지 않는다)
□ 다른 지역으로 검색하면 그 지역 칸을 추가로 받는다
```

---

## 문제 해결

| 증상 | 원인과 해결 |
|---|---|
| 빌드 실패: `tsc` 오류 | Build command 를 `npm run build:only` 로 두세요. `npm run build` 는 타입체크를 포함하며 CI 에서 이미 수행합니다 |
| 지도가 회색이고 "간이 지도 모드" 표시 | WebGL 미지원 환경이거나 타일 도메인이 차단됨. CSP 의 `img-src`/`connect-src` 에 `*.basemaps.cartocdn.com` 을 허용하세요 |
| 목록이 시드 32건에서 안 늘어남 | `PARKING_API_KEY` / `PARKING_API_BASE` 미설정이거나 재배포 안 함. `/api/parkings` 를 직접 열어 `501` 인지 확인 |
| `/api/parkings` 가 404 | `functions/` 디렉터리가 저장소 루트에 있는지, Root directory 설정이 비어 있는지 확인 |
| 환경변수를 바꿨는데 반영 안 됨 | 빌드 시점 변수는 재빌드 필요 → Retry deployment |
| 공휴일 판정이 틀림 | `src/lib/holidays.ts` 테이블은 2025~2027 까지입니다. 연도를 추가하거나 `setHolidaySource()` 로 API 를 연결하세요 |
| E2E 가 로컬에서만 실패 | 4173 포트를 쓰는 프로세스가 남아 있을 수 있습니다. `reuseExistingServer` 가 낡은 빌드를 재사용합니다 |
