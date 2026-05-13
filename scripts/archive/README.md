# scripts/archive/

1회성 분석 스크립트 보관소. 매월 재실행되는 스크립트는 `scripts/analysis/`에 유지.

## 분류

### 4월 분석 (april-*)
- `april-channel-leadgen.js`, `april-channel-split.js`
- `april-forecast.js`, `april-forecast-tablets.js`
- `april-inbound-speed.js`, `april-team-split.js`

### Lead → CW leadtime 분석 (1회성)
- `lead-count-inbound-monthly.js` — IsActive 필터 검증
- `lead-to-cw-by-storestatus.js` — 오픈전 vs 운영중 비교
- `lead-to-cw-leadtime-sample.js` — Lead→CW leadtime 샘플 분석

### 가설 검증 (1회성)
- `visit-hypothesis-check.js` — 신규 vs 리터치 가설
- `visit-hypothesis-inbound.js` — 인바운드만 가설 재검증
- `visit-to-cw-by-month.js` — 월별 분포 검증
- `visit-to-cw-distribution.js` — 모수 검증

### 월간 보고서 초기 버전
- `monthly-report-by-team.js` — `scripts/analysis/render-monthly-kpi.js`로 대체됨

## 매월 재실행 스크립트 (scripts/analysis/에 위치)

- `render-monthly-kpi.js` — 월간 KPI HTML 보고서 (S3 JSON 기반)
- `render-quarterly-md.js` — 분기 KPI 마크다운 (PPT용)
- `visit-to-cw-report.js` — 인바운드 방문→CW leadtime 리포트
