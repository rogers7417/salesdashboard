/**
 * 2026 Q1 (1~4월) 분기 KPI 리뷰 — PPT용 Markdown 생성
 * 각 sub-team별로 핵심 KPI + 추이 + 보조 지표 + 인과 해석 + 다음 단계
 *
 * 출력: reports/2026-q1-kpi-review.md
 */

const path = require('path');
const fs = require('fs');
const https = require('https');

const BASE_URL = 'https://dffqkvzh0w37t.cloudfront.net';
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04'];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function sumClosed(users) {
  const t = (users || []).reduce((acc, u) => ({ cw: acc.cw + (u.cw ?? 0), cl: acc.cl + (u.cl ?? 0) }), { cw: 0, cl: 0 });
  return { cw: t.cw, cl: t.cl, rate: (t.cw + t.cl) ? Math.round(t.cw / (t.cw + t.cl) * 100) : 0 };
}

function extract(json) {
  if (!json) return null;
  const ib = json.inbound || {};
  const ch = json.channel || {};
  const tmFrt = ch.tm?.frt || {};
  const frtTot = (tmFrt.frtOk || 0) + (tmFrt.frtOver20 || 0);
  const fc = sumClosed(ib.fieldSales?.cwConversionRate?.byUser);
  const ibo = sumClosed(ib.backOffice?.cwConversionRate?.byUser);
  const cbo = sumClosed(ch.backOffice?.cwConversionRate?.byUser);
  const tmOpps = ch.tm?.rawData?.rawOpenOpps || [];
  const tmPreOpenPct = tmOpps.length ? Math.round(tmOpps.filter((o) => (o.companyStatus || '').includes('오픈전')).length / tmOpps.length * 100) : 0;
  const isOwners = ib.insideSales?.byOwner || [];
  const isFrtOk = isOwners.reduce((s, o) => s + (o.frtOk || 0), 0);
  const isFrtOver = isOwners.reduce((s, o) => s + (o.frtOver20 || 0), 0);
  return {
    insideSqlConv:    ib.insideSales?.sqlConversionRate ?? 0,
    insideLead:       ib.insideSales?.lead ?? 0,
    insideMql:        ib.insideSales?.mql ?? 0,
    insideSql:        ib.insideSales?.sql ?? 0,
    insideFrtPass:    (isFrtOk + isFrtOver) ? Math.round(isFrtOk / (isFrtOk + isFrtOver) * 100) : 0,
    fieldCwRate:      fc.rate,
    fieldCw:          fc.cw,
    fieldCl:          fc.cl,
    fieldStaleTotal:  ib.fieldSales?.staleVisit?.total ?? 0,
    fieldStaleOver14: ib.fieldSales?.staleVisit?.over14 ?? 0,
    inboundBoCwRate:  ibo.rate,
    inboundBoCw:      ibo.cw,
    inboundBoCl:      ibo.cl,
    inboundBoOver14:  ib.backOffice?.agingSummary?.over14 ?? 0,
    tmFrtPassRate:    frtTot ? Math.round((tmFrt.frtOk || 0) / frtTot * 100) : 0,
    tmAvgFrtMin:      Math.round(tmFrt.avgFrtMinutes ?? 0),
    tmSqlBacklogOver7: ch.tm?.sqlBacklog?.over7 ?? 0,
    tmSqlOpenTotal:   ch.tm?.sqlBacklog?.openTotal ?? 0,
    tmPreOpenPct,
    aeMou:            ch.ae?.mouCount?.total ?? 0,
    aeMouTarget:      ch.ae?.mouCount?.target ?? 4,
    aeNegoEntry:      ch.ae?.negoEntry?.thisMonth ?? 0,
    aeMeetingByOwner: (ch.ae?.meetingCount?.byOwner || []).filter((o) => o.team === 'AE').reduce((s, o) => s + (o.count || 0), 0),
    amActive:         ch.am?.activePartnerCount?.total ?? 0,
    amActiveTarget:   ch.am?.activePartnerCount?.target ?? 70,
    amDailyLeadAvg:   ch.am?.dailyLeadCount?.avgDaily ?? 0,
    amOnboardingRate: ch.am?.onboardingRate?.rate ?? 0,
    amMeetingCount:   (ch.am?.meetingCount?.byOwner || []).filter((o) => o.team === 'AM').reduce((s, o) => s + (o.count || 0), 0),
    channelBoCwRate:  cbo.rate,
    channelBoCw:      cbo.cw,
    channelBoCl:      cbo.cl,
    channelBoOver14:  ch.backOffice?.agingSummary?.over14 ?? 0,
  };
}

function trendRow(arr, unit = '') {
  return arr.map((v) => v == null ? '-' : v + unit).join(' → ');
}

function diff(arr, unit = '') {
  const a = arr[0], b = arr[arr.length - 1];
  if (a == null || b == null) return '';
  const d = Math.round((b - a) * 10) / 10;
  return d > 0 ? `+${d}${unit}` : d < 0 ? `${d}${unit}` : '0';
}

function pickMonthly(series, key) {
  return series.map((s) => s ? s[key] : null);
}

(async () => {
  console.log('1~4월 데이터 fetch...');
  const trendData = await Promise.all(MONTHS.map(async (m) => {
    try { return await fetchJson(`${BASE_URL}/dashboard/kpi/monthly/${m}.json`); } catch { return null; }
  }));
  const series = trendData.map(extract);
  const labels = ['1월', '2월', '3월', '4월'];

  console.log('Markdown 렌더...');
  const md = renderMd(labels, series);
  const outPath = path.join(__dirname, '..', '..', 'reports', '2026-q1-kpi-review.md');
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`\n✓ 저장: ${outPath}`);
})().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });

function renderMd(labels, s) {
  const sec = (n) => '\n---\n\n## ' + n + '\n\n';

  // 핵심 KPI 종합
  const insideConv = pickMonthly(s, 'insideSqlConv');
  const fieldCw    = pickMonthly(s, 'fieldCwRate');
  const inBoCw     = pickMonthly(s, 'inboundBoCwRate');
  const tmBack     = pickMonthly(s, 'tmSqlBacklogOver7');
  const aeMou      = pickMonthly(s, 'aeMou');
  const amActive   = pickMonthly(s, 'amActive');
  const cbCw       = pickMonthly(s, 'channelBoCwRate');

  let md = `# 2026 Q1 세일즈 KPI 분기 리뷰 (1~4월)

> 생성일: ${new Date().toLocaleString('ko-KR')}
> 데이터 출처: 운영 중인 KPI 시스템 (S3+CloudFront 자동 추출)
> 대상: 인바운드 (인사이드/필드/백오피스) + 채널 (TM/AE/AM/백오피스)

`;

  // === 분기 요약 ===
  md += sec('분기 요약 — 핵심 KPI 트렌드');
  md += `| 지표 | 1월 | 2월 | 3월 | 4월 | 1월→4월 |
|---|---:|---:|---:|---:|---:|
| 인사이드 SQL 전환율 | ${insideConv.map(v => v + '%').join(' | ')} | ${diff(insideConv, '%')} |
| 필드 CW 전환율 (마감 중) | ${fieldCw.map(v => v + '%').join(' | ')} | ${diff(fieldCw, '%')} |
| 인바운드 BO CW 전환율 | ${inBoCw.map(v => v + '%').join(' | ')} | ${diff(inBoCw, '%')} |
| **채널 TM SQL 백로그 (7일+)** | ${tmBack.map(v => v + '건').join(' | ')} | **${diff(tmBack, '건')}** ⚠️ |
| 채널 AE 신규 MOU | ${aeMou.map(v => v + '건').join(' | ')} | ${diff(aeMou, '건')} |
| 채널 AM 활성 파트너 | ${amActive.map(v => v + '개').join(' | ')} | ${diff(amActive, '개')} |
| 채널 BO CW 전환율 | ${cbCw.map(v => v + '%').join(' | ')} | ${diff(cbCw, '%')} |

### 분기 핵심 메시지
- ✅ **꾸준히 개선**: 인바운드 BO CW 전환율, 채널 AE MOU, 채널 TM FRT 응대 속도
- ⚠️ **개선 필요**: 채널 TM SQL 백로그 (오픈전 매장 누적), 채널 AM 활성 파트너 회복
- 🔄 **안정**: 인사이드 SQL 전환율 (목표 90% 영역 유지)

`;

  // === 1. 인사이드 세일즈 ===
  md += sec('1. 인사이드 세일즈 — 속도 KPI');
  md += `### 핵심 KPI: SQL 전환율 (목표 90%)

| 1월 | 2월 | 3월 | 4월 | 1월→4월 |
|---:|---:|---:|---:|---:|
| ${insideConv.join(' | ')} | ${diff(insideConv, '%')} |

### 보조 지표 추이
- Lead 인입: ${trendRow(pickMonthly(s, 'insideLead'), '건')} (${diff(pickMonthly(s, 'insideLead'), '건')})
- 인사이드 FRT 준수율 (20분): ${trendRow(pickMonthly(s, 'insideFrtPass'), '%')} (${diff(pickMonthly(s, 'insideFrtPass'), '%')})
- 4월 단계: Lead ${s[3].insideLead} → MQL ${s[3].insideMql} → SQL ${s[3].insideSql} (미전환 MQL ${s[3].insideMql - s[3].insideSql}건)

### 인과 해석
FRT 준수율 ${diff(pickMonthly(s, 'insideFrtPass'), '%p')} 개선이 SQL 전환율 안정의 기반으로 작용. 분기 동안 90% 안팎의 일관된 운영을 유지.

### 다음 단계
- SQL 미전환 MQL 사유 분포 분석 (가격·타이밍·오인입)
- FRT 분포 길어지는 시점이 SQL 전환율 변동과 동행하는지 추적
- 90% 안정 영역 유지에 초점, 추가 push보다 일관성 보강

`;

  // === 2. 필드 세일즈 ===
  md += sec('2. 필드 세일즈 — 매장 방문·상담');
  md += `### 핵심 KPI: CW 전환율 (마감 매장 중)

| 1월 | 2월 | 3월 | 4월 | 1월→4월 |
|---:|---:|---:|---:|---:|
| ${fieldCw.map(v => v + '%').join(' | ')} | ${diff(fieldCw, '%')} |

### 보조 지표 추이
- stale 방문 총: ${trendRow(pickMonthly(s, 'fieldStaleTotal'), '건')}
- 14일 초과 정체: ${trendRow(pickMonthly(s, 'fieldStaleOver14'), '건')}

### 인과 해석
1~3월 +${Math.max(...fieldCw) - fieldCw[0]}%p 상승 후 4월 ${fieldCw[3]}%로 조정. 정체 매장 누적이 4월 둔화의 한 요인.

### 다음 단계
- 14일 이상 정체 매장 push 또는 reassign 검토
- CL(Closed Lost) 사유 Top 패턴을 매월 추적하여 패배 원인 변화 감지

`;

  // === 3. 인바운드 BO ===
  md += sec('3. 인바운드 백오피스 — 견적·계약·출고·설치');
  md += `### 핵심 KPI: CW 전환율 (이월 포함)

| 1월 | 2월 | 3월 | 4월 | 1월→4월 |
|---:|---:|---:|---:|---:|
| ${inBoCw.map(v => v + '%').join(' | ')} | **${diff(inBoCw, '%p')}** ✅ |

### 보조 지표 추이
- 14일 초과 정체 매장: ${trendRow(pickMonthly(s, 'inboundBoOver14'), '건')}
- 4월 마감 분포: CW ${s[3].inboundBoCw}건 / CL ${s[3].inboundBoCl}건

### 인과 해석
처리 효율이 매월 가속되어 4개월간 +${diff(inBoCw, '')}%p 개선. 다만 14일 초과 정체가 ${s[0].inboundBoOver14}건 → ${s[3].inboundBoOver14}건으로 누적이 함께 진행 — 처리 속도 개선의 후행 결과로 볼 수 있으나, 다음 달 부담으로 작용할 가능성.

### 다음 단계
- 14일 초과 ${s[3].inboundBoOver14}건의 stage별 분포 분석 → 견적 정체인지 계약 정체인지 식별
- 견적 1차 통과율 보강을 우선 검토

`;

  // === 4. 채널 TM ===
  md += sec('4. 채널 TM (텔레마케팅) — Lead 응대 + 견적 처리');
  md += `### 핵심 KPI: SQL 백로그 (7일 초과 미처리, 목표 10건)

| 1월 | 2월 | 3월 | 4월 | 1월→4월 |
|---:|---:|---:|---:|---:|
| ${tmBack.map(v => v + '건').join(' | ')} | **${diff(tmBack, '건')}** ⚠️ |

### 보조 지표 추이
- Open SQL 중 오픈전 매장 비중: ${trendRow(pickMonthly(s, 'tmPreOpenPct'), '%')} (${diff(pickMonthly(s, 'tmPreOpenPct'), '%p')})
- FRT 준수율 (20분): ${trendRow(pickMonthly(s, 'tmFrtPassRate'), '%')} (${diff(pickMonthly(s, 'tmFrtPassRate'), '%p')})
- 평균 FRT: ${trendRow(pickMonthly(s, 'tmAvgFrtMin'), '분')} (${diff(pickMonthly(s, 'tmAvgFrtMin'), '분')})

### 인과 해석
Open SQL 매장 중 오픈전 비중이 ${s[0].tmPreOpenPct}% → ${s[3].tmPreOpenPct}%로 누적 ${diff(pickMonthly(s, 'tmPreOpenPct'), '%p')} 증가. **오픈일 미확정 매장의 입금 의사결정 지연이 백로그 가속의 직접 원인**. FRT 응대 속도(${s[0].tmFrtPassRate}%→${s[3].tmFrtPassRate}%)는 안정적으로 개선되었으나, 견적 발송 후 입금 단계가 진짜 정체 구간.

### 다음 단계
- **오픈전 매장 전용 SLA 정의**: 오픈일 N주 전 입금 안내, 오픈일 미정 시 N주 후 push
- "오픈전 2개월+" 장기 정체 매장 1:1 사유 점검 → 폐기/유지 의사결정
- 운영중 매장의 7일+ 정체는 별도 push 프로세스로 분리 관리

`;

  // === 5. 채널 AE ===
  md += sec('5. 채널 AE (Account Executive) — MOU 발굴·협상');
  md += `### 핵심 KPI: 신규 MOU 체결 수 (목표 4건)

| 1월 | 2월 | 3월 | 4월 | 1월→4월 |
|---:|---:|---:|---:|---:|
| ${aeMou.map(v => v + '건').join(' | ')} | **${diff(aeMou, '건')}** ✅ |

### 보조 지표 추이
- AE 본인 미팅 수: ${trendRow(pickMonthly(s, 'aeMeetingByOwner'), '건')}
- 협상 진입 (이번달): ${trendRow(pickMonthly(s, 'aeNegoEntry'), '건')}

### 인과 해석
AE 1명이 4개월 만에 신규 MOU를 ${Math.round(aeMou[3]/aeMou[0]*10)/10}배로 끌어올림. 미팅 활동량과 협상 진입이 모두 동반 증가하여 발굴 모멘텀의 직접 원인. 4월 목표(4건) 대비 ${Math.round(aeMou[3]/4)}배 초과 달성.

### 다음 단계
- 발굴량 자체는 충분 — 협상 진입과 미서명 계약 비율로 후속 단계 모니터링
- 미서명 계약 중 overdue 케이스 사유 분석으로 전환율 향상 여력 식별
- 새로 체결된 MOU가 다음 달 활성 파트너로 연결되는지 추적

`;

  // === 6. 채널 AM ===
  md += sec('6. 채널 AM (Account Manager) — 파트너 관리·온보딩');
  md += `### 핵심 KPI: 활성 파트너 수 (목표 70개)

| 1월 | 2월 | 3월 | 4월 | 1월→4월 |
|---:|---:|---:|---:|---:|
| ${amActive.map(v => v + '개').join(' | ')} | ${diff(amActive, '개')} ⚠️ |

### 보조 지표 추이
- 일평균 Lead 확보: ${trendRow(pickMonthly(s, 'amDailyLeadAvg'), '건')}
- 온보딩률: ${trendRow(pickMonthly(s, 'amOnboardingRate'), '%')} (목표 80%)
- AM 본인 미팅 수: ${trendRow(pickMonthly(s, 'amMeetingCount'), '건')}

### 인과 해석
일평균 Lead 확보 ${diff(pickMonthly(s, 'amDailyLeadAvg'), '건')} 증가에도 온보딩률이 ${s[0].amOnboardingRate}% → ${s[3].amOnboardingRate}% 추세. AE의 MOU 발굴(${aeMou[3]}건)이 활성화 단계로 충분히 이어지지 못하는 구조 신호.

### 다음 단계
- 신규 MOU ${aeMou[3]}건이 다음 달 활성 파트너로 추가될지 추적
- 온보딩률을 끌어올리지 못하면 AE 발굴 효과가 활성 단계로 새지 않음
- 일평균 Lead 목표 대비 부족분의 사유 분석 필요
- 온보딩 단계별 정체 지점 분해 분석

`;

  // === 7. 채널 BO ===
  md += sec('7. 채널 백오피스 — 채널 견적·계약');
  md += `### 핵심 KPI: CW 전환율 (이월 포함)

| 1월 | 2월 | 3월 | 4월 | 1월→4월 |
|---:|---:|---:|---:|---:|
| ${cbCw.map(v => v + '%').join(' | ')} | ${diff(cbCw, '%p')} |

### 보조 지표 추이
- 14일 초과 정체 매장: ${trendRow(pickMonthly(s, 'channelBoOver14'), '건')}
- 4월 마감: CW ${s[3].channelBoCw}건 / CL ${s[3].channelBoCl}건

### 인과 해석
1월 정점 후 변동성을 보였으나 회복 추세에 진입. 인바운드 BO(${diff(inBoCw, '%p')} 개선)와 비교해 회복 속도가 더 느린 편 — 채널 BO 특유의 단계(MOU 후 가맹점 등록 행정)가 병목 가능성.

### 다음 단계
- 인바운드 BO 개선 패턴(매월 +5~7%p)을 채널 BO에 이식할 수 있는지 검토
- 14일 초과 정체 ${s[3].channelBoOver14}건의 stage별 분포로 채널 BO 고유 병목 식별

`;

  // === 액션 종합 ===
  md += sec('분기 액션 우선순위 (다음 달 ~ Q2)');
  md += `### 🚨 즉시 (다음 달 시작)
1. **채널 TM**: 오픈전 매장 전용 SLA 정의 + "오픈전 2개월+" 매장 1:1 점검
2. **인바운드 BO**: 14일 초과 정체 매장 stage별 분해, 견적 1차 통과율 보강
3. **채널 AM**: 신규 MOU의 활성 파트너 전환 추적, 온보딩률 회복 캠페인

### 📊 모니터링 강화
- SQL 미전환 MQL 사유 분포 (인사이드)
- CL 사유 변화 패턴 (필드)
- 채널 BO 단계별 dwell (인바운드 BO 패턴 비교)

### 🎯 분기 KPI 목표 재검토
- 채널 TM SQL 백로그: 분기 말 10건 이내 달성 가능성
- 채널 AM 활성 파트너: 회복 목표 (예: 1월 수준 352개 회복)
- 인사이드 SQL 전환율: 90% 안정 영역 유지

---

> 본 리뷰는 운영 중인 KPI 시스템 (1~4월 자동 추출 데이터) 기반.
> 매월 자동 갱신: \`node scripts/analysis/render-quarterly-md.js\`
`;

  return md;
}
