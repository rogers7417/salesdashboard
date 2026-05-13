# Salesforce Data Tools

세일즈 KPI 데이터 추출·집계·시각화 도구. **S3 정적 배포 + 비동기 추출** 아키텍처.

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                      Salesforce CRM                          │
└──────────────────┬──────────────────────────────────────────┘
                   │ SOQL (OAuth password grant)
                   ↓
┌─────────────────────────────────────────────────────────────┐
│  server/extractors/  (Node.js, PM2 cron 30분마다)            │
│  ├── kpi-extract.js               인사이드 + 채널 sub-team   │
│  ├── channel-extract.js           채널 KPI v2 (BD/AM/MOU)    │
│  ├── inbound-extract.js           인바운드 보조              │
│  ├── install-tracking-extract.js  설치 트래킹                │
│  └── s3-extract.js                통합 엔트리                │
└──────────────────┬──────────────────────────────────────────┘
                   │ JSON 업로드
                   ↓
┌─────────────────────────────────────────────────────────────┐
│  AWS S3 (정적 호스팅) + CloudFront (CDN)                     │
│  ├── /dashboard/kpi/monthly/{YYYY-MM}.json                   │
│  ├── /dashboard/channel/kpi-v2/{YYYY-MM}.json                │
│  ├── /dashboard/kpi/daily/{YYYY-MM-DD}.json                  │
│  ├── /dashboard/kpi/weekly/{start}_{end}.json                │
│  └── /dashboard/...  (정적 Next.js 빌드 결과 + JSON 데이터)  │
└────────────┬──────────────┬─────────────────────────────────┘
             │              │
        JSON │              │ 정적 페이지
        fetch │              │
             ↓              ↓
┌─────────────────────────────────────────────────────────────┐
│  web/  (Next.js static export → S3 배포)                     │
│  - 브라우저가 CloudFront에서 정적 페이지 + JSON 직접 fetch   │
│  - API 서버를 거치지 않음                                    │
└─────────────────────────────────────────────────────────────┘
                   ↑
                   │ (선택) 즉시 추출 트리거
                   │
┌─────────────────────────────────────────────────────────────┐
│  server/api/  (Express, PM2 sf-dashboard-api)                │
│  - POST /api/kpi/refresh         : 추출 즉시 실행            │
│  - POST /api/install-tracking/refresh : 설치 트래킹 갱신     │
│  - 그 외 보조 라우트 (관리·디버그 용도)                      │
└─────────────────────────────────────────────────────────────┘
```

**핵심 특징**
- **클라이언트는 S3+CloudFront에서 정적 JSON을 직접 fetch** — API 서버에 부하 없음
- **추출은 30분 cron 백그라운드 처리** — 사용자 요청과 분리
- **server/api는 보조** — 즉시 갱신, 관리 기능 등 일부 동적 요구만 처리

---

## 디렉토리 구조

```
salesforce-data-tools/
├── server/                  # 서버사이드 통합
│   ├── extractors/          # Salesforce → S3 추출 스크립트
│   ├── api/                 # Express API 서버 (보조)
│   │   ├── server.js
│   │   ├── routes/          # /api/kpi, /api/inbound, /api/channel, ...
│   │   └── services/        # salesforce.js, kpi-report.js 등
│   └── shared/              # 공통 라이브러리
│       ├── s3-upload.js
│       ├── kpi-aggregation.js
│       └── closedLostGrid.js
│
├── web/                     # Next.js (output: 'export', S3 정적 배포)
│   ├── src/, public/
│   ├── package.json
│   └── next.config.ts
│
├── scripts/                 # ad-hoc 분석·실험
│   ├── analysis/            # 매월 재실행 (render-monthly-kpi.js 등)
│   ├── archive/             # 1회성 분석 보존
│   ├── experiments/         # 실험 코드
│   ├── debug/, auto-task/
│   └── deploy-frontend.sh   # 프론트 S3 배포 스크립트
│
├── reports/                 # 산출물 (HTML/MD)
├── data/                    # 로컬 raw 데이터 (gitignore)
├── docs/                    # 문서
├── ecosystem.config.js      # PM2 설정 (sf-s3-extract + sf-dashboard-api)
├── package.json
├── .env, .env.example, .gitignore
└── README.md, QUICKSTART.md
```

---

## 데이터 흐름

### 1. 정상 흐름 (대부분의 사용자 요청)
```
사용자 브라우저
  → CloudFront (정적 페이지 + JSON)
  → S3 (CDN edge)
```
**API 서버 호출 없음.** PM2 cron이 30분마다 갱신한 JSON을 그대로 fetch.

### 2. 즉시 갱신이 필요한 경우
```
사용자 브라우저
  → server/api (POST /api/kpi/refresh)
  → server/extractors (spawn 추출 프로세스)
  → S3 업로드
  → 응답 후 클라이언트가 S3 재fetch
```

### 3. 매월 KPI 리포트 생성 (분석가용)
```
node scripts/analysis/render-monthly-kpi.js 2026-04
  → CloudFront에서 JSON 직접 fetch
  → reports/2026-04-kpi-monthly-report.html 생성
```

---

## 설치 및 실행

### 1. 의존성

```bash
# 루트 (추출 스크립트, API 서버)
npm install

# 프론트엔드
cd web && npm install
```

### 2. 환경 변수 (`.env`)

```env
# Salesforce
SF_CLIENT_ID=...
SF_CLIENT_SECRET=...
SF_USERNAME=...
SF_PASSWORD=...
SF_LOGIN_URL=https://login.salesforce.com

# AWS S3
AWS_REGION=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=...

# API 서버 (선택)
API_PORT=4003
```

### 3. 로컬 실행

**추출 (수동 1회):**
```bash
node server/extractors/kpi-extract.js          # 인사이드 + 채널 sub-team
node server/extractors/channel-extract.js      # 채널 KPI v2
node server/extractors/s3-extract.js           # 통합 (PM2 진입점)
```

**API 서버:**
```bash
node server/api/server.js
# 또는
pm2 start ecosystem.config.js --only sf-dashboard-api
```

**프론트엔드 개발 서버:**
```bash
cd web && npm run dev
```

**프론트엔드 빌드 + S3 배포:**
```bash
cd web && npm run build         # web/out/ 정적 빌드
bash scripts/deploy-frontend.sh # S3 업로드
```

---

## 운영 (PM2)

`ecosystem.config.js`에 두 앱 통합.

```bash
pm2 start ecosystem.config.js          # 전체 시작
pm2 restart sf-s3-extract              # 추출 즉시 실행 (30분 cron 외 수동)
pm2 restart sf-dashboard-api           # API 서버 재시작
pm2 logs sf-s3-extract                 # 추출 로그
pm2 logs sf-dashboard-api              # API 로그
pm2 save                               # 부팅 시 자동 시작 등록
```

| 앱 | 스크립트 | 주기 |
|---|---|---|
| `sf-s3-extract` | `server/extractors/s3-extract.js` | 30분 cron, 완료 후 종료 |
| `sf-dashboard-api` | `server/api/server.js` | 상주, 자동 재시작 |

---

## 분석 스크립트 (`scripts/analysis/`)

매월 재실행하는 KPI 리포트 생성기.

| 스크립트 | 산출물 | 입력 |
|---|---|---|
| `render-monthly-kpi.js` | 월간 HTML 리포트 (sub-team별 핵심 KPI·트렌드·인과 해석) | S3 JSON (CloudFront fetch) |
| `render-quarterly-md.js` | 분기 PPT용 Markdown | S3 JSON (1~4월 4개월) |
| `visit-to-cw-report.js` | 방문→CW leadtime 분석 HTML | Salesforce 직접 SOQL |
| `frt-report.js`, `inactive-partners*.js`, `pipeline-congestion-*.js` | 각종 분석 | 직접 SOQL |

**1회성 분석은 `scripts/archive/`에 보존.**

---

## 문제 해결

### "토큰 발급 실패"
- `.env` 인증 정보 확인
- Connected App IP 제한 확인
- 비밀번호 특수문자는 URL 인코딩 필요

### 추출은 됐는데 클라이언트가 옛 데이터
- CloudFront 캐시 — invalidation 또는 TTL 만료 대기

### `kpi-extract.js` 결과에 사람 이름이 영문 ID
- `IsActive=true` SOQL 필터 때문에 퇴사자/신규자 매핑 누락. byOwner 처리 시 누락된 userId 별도 SOQL 매핑 필요.

### Node v23 + login.salesforce.com ECONNRESET
- `scripts/archive/axios-fetch-shim.js` 참고 (fetch adapter 적용)

---

## 라이선스

ISC · Torder Team
