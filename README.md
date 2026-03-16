# Salesforce Data Tools

Salesforce Closed-Lost Grid 데이터를 일별, 주별, 월별로 추출하는 독립 실행형 도구입니다.

## 🚀 빠른 시작

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

`.env` 파일을 생성하고 Salesforce 인증 정보를 입력합니다:

```bash
cp .env.example .env
```

`.env` 파일 내용:
```env
SF_CLIENT_ID=your_client_id
SF_CLIENT_SECRET=your_client_secret
SF_USERNAME=your_username
SF_PASSWORD=your_password
SF_LOGIN_URL=https://login.salesforce.com
API_BASE_URL=http://localhost:3003
OUTPUT_DIR=./data
```

### 3. 실행

```bash
# 일별 데이터 추출 (오늘)
npm run fetch:daily

# 일별 데이터 추출 (특정 날짜)
npm run fetch:daily 2026-01-15

# 주별 데이터 추출
npm run fetch:weekly 2026-01-15

# 월별 데이터 추출
npm run fetch:monthly 2026-01-15

# 모든 타입 추출 (일별 + 주별 + 월별)
npm run fetch:all 2026-01-15
```

## 📖 사용법

### NPM 스크립트

```bash
npm run fetch:daily [날짜]    # 일별 데이터
npm run fetch:weekly [날짜]   # 주별 데이터 (월요일~일요일)
npm run fetch:monthly [날짜]  # 월별 데이터
npm run fetch:all [날짜]      # 모든 타입
```

### Node.js 직접 실행

```bash
node index.js daily 2026-01-15
node index.js weekly 2026-01-15
node index.js monthly 2026-01-15
node index.js all 2026-01-15
```

## 📁 출력 구조

추출된 데이터는 `data/` 디렉토리에 저장됩니다:

```
data/
├── daily_2026-01-15.json
├── weekly_2026-01-13_to_2026-01-19.json
└── monthly_2026-01.json
```

## 🔧 설정

### 환경 변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `SF_CLIENT_ID` | Salesforce Connected App Client ID | 필수 |
| `SF_CLIENT_SECRET` | Salesforce Connected App Client Secret | 필수 |
| `SF_USERNAME` | Salesforce 사용자명 | 필수 |
| `SF_PASSWORD` | Salesforce 비밀번호 | 필수 |
| `SF_LOGIN_URL` | Salesforce 로그인 URL | `https://login.salesforce.com` |
| `API_BASE_URL` | API 서버 URL | `http://localhost:3003` |
| `OUTPUT_DIR` | 출력 디렉토리 | `./data` |

## 📊 데이터 구조

```json
{
  "dateUtc": "2026-01-02~2026-01-31",
  "startIso": "2026-01-02T00:00:00Z",
  "endIso": "2026-02-01T00:00:00Z",
  "startDate": "2026-01-02",
  "endDate": "2026-01-31",
  "summary": {
    "closedLostCount": 918,
    "accountCount": 901,
    "lossCategories": [
      {
        "label": "단순 변심",
        "count": 360
      }
    ]
  },
  "rows": [
    {
      "opportunity": {
        "id": "006TJ00000b09POYAY",
        "name": "...",
        "createdDate": "2026-01-02T02:10:11.000+0000",
        "department": "광고세일즈1팀"
      },
      "loss": {
        "reason": "광고주 내부 검토",
        "r1": "시기 미정"
      },
      "latestCase": null,
      "recentCases": [],
      "recentTasks": []
    }
  ]
}
```

## 🔐 인증 방식

이 도구는 Salesforce Username-Password OAuth Flow를 사용합니다:

1. `.env`의 인증 정보로 Salesforce OAuth 토큰 발급
2. 발급받은 토큰으로 API 서버 호출
3. 토큰은 세션 동안 캐시되어 재사용

## 🛠️ 기술 스택

- **Node.js**: 런타임
- **axios**: HTTP 클라이언트
- **dotenv**: 환경 변수 관리

## 📝 예제

### 2026년 1월 전체 데이터 추출

```bash
npm run fetch:monthly 2026-01-15
```

출력:
```
📊 타입: MONTHLY
📅 기준일: 2026-01-15
📁 출력 경로: ./data

📅 MONTHLY 데이터 추출: 2026-01-01 ~ 2026-01-31
✅ 저장 완료: monthly_2026-01.json
   📊 건수: 918건
   💾 크기: 5832.45 KB

✨ 모든 데이터 추출 완료!
📁 저장 위치: /Users/torder/workspace/salesforce-data-tools/data
```

### 특정 주의 데이터 추출

```bash
npm run fetch:weekly 2026-01-15
```

2026-01-15가 포함된 주(월요일~일요일)의 데이터를 추출합니다.

## ⚠️ 문제 해결

### "환경 변수가 설정되지 않았습니다" 오류

`.env` 파일이 올바르게 설정되었는지 확인하세요.

### "토큰 발급 실패" 오류

1. Salesforce 인증 정보가 정확한지 확인
2. Connected App 설정 확인
3. IP 제한 설정 확인

### "API 인증 실패" 오류

1. API 서버(`http://localhost:3003`)가 실행 중인지 확인
2. API 서버에 먼저 로그인이 필요할 수 있습니다

## 📄 라이선스

ISC

## 👥 작성자

Torder Team
