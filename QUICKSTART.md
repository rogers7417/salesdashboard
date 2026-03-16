# 🚀 빠른 시작 가이드

## 설치 및 실행

### 1. 의존성 설치
```bash
npm install
```

### 2. 실행
```bash
# 일별 데이터 (2026-01-15)
npm run fetch:daily 2026-01-15

# 주별 데이터 (2026-01-12 ~ 2026-01-18)
npm run fetch:weekly 2026-01-15

# 월별 데이터 (2026-01-01 ~ 2026-01-31)
npm run fetch:monthly 2026-01-15

# 모든 타입 한번에
npm run fetch:all 2026-01-15
```

## 출력 예시

```
╔════════════════════════════════════════════════════╗
║   Salesforce Closed-Lost Grid 데이터 추출 도구    ║
╚════════════════════════════════════════════════════╝

📊 타입: MONTHLY
📅 기준일: 2026-01-15
📁 출력 경로: ./data

─────────────────────────────────────────────────────

📅 MONTHLY 데이터 추출: 2026-01-01 ~ 2026-01-31
🔑 Salesforce 토큰 요청 중...
✅ 토큰 발급 완료
📡 Salesforce API 직접 호출: 2026-01-01 ~ 2026-01-31
  📊 Opportunity 조회 중...
  ✅ Opportunity 918건 조회 완료
  📊 Case 조회 중...
  ✅ Case 901개 Account 조회 완료
  📊 Task 조회 중...
  ✅ Task 5764건 조회 완료
✅ 저장 완료: monthly_2026-01.json
   📊 건수: 918건
   💾 크기: 7246.57 KB

─────────────────────────────────────────────────────

✨ 모든 데이터 추출 완료!
📁 저장 위치: /Users/torder/workspace/salesforce-data-tools/data
```

## 프로젝트 구조

```
salesforce-data-tools/
├── .env                    # 환경 변수 (Salesforce 인증 정보)
├── .env.example           # 환경 변수 예시
├── .gitignore             # Git 제외 파일
├── README.md              # 상세 문서
├── QUICKSTART.md          # 빠른 시작 가이드 (이 문서)
├── package.json           # NPM 설정
├── index.js               # 메인 실행 파일
├── lib/
│   └── closedLostGrid.js  # Salesforce API 호출 로직
└── data/                  # 추출된 데이터 저장 위치
    ├── daily_2026-01-15.json
    ├── weekly_2026-01-12_to_2026-01-18.json
    └── monthly_2026-01.json
```

## 주요 특징

✅ **독립 실행형**: 다른 서버나 서비스 없이 독립적으로 실행
✅ **직접 API 호출**: Salesforce API를 직접 호출하여 데이터 추출
✅ **토큰 캐싱**: 한 번 발급받은 토큰을 세션 동안 재사용
✅ **상세한 진행 표시**: 각 단계별 진행 상황 실시간 출력
✅ **유연한 날짜 범위**: 일별, 주별, 월별 선택 가능

## 환경 변수

`.env` 파일에 다음 정보가 이미 설정되어 있습니다:

```env
SF_CLIENT_ID=...           # Salesforce Connected App Client ID
SF_CLIENT_SECRET=...       # Salesforce Connected App Client Secret
SF_USERNAME=...            # Salesforce 사용자명
SF_PASSWORD=...            # Salesforce 비밀번호
SF_LOGIN_URL=https://login.salesforce.com
OUTPUT_DIR=./data          # 출력 디렉토리
```

## 문제 해결

### 토큰 발급 실패
- Salesforce 인증 정보 확인
- Connected App 설정 확인
- IP 제한 설정 확인

### API 호출 실패
- 네트워크 연결 확인
- Salesforce 서버 상태 확인

## 추가 정보

상세한 사용법은 [README.md](./README.md)를 참고하세요.
