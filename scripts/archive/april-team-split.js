/**
 * 4월 팀별 CW(Closed Won) 태블릿 — 5개 팀 동일 정합성 분리 집계
 *
 * 데이터 소스: Salesforce Contract__c 직접 SOQL (채널 스크립트와 동일 정합성 룰)
 *   - ContractStatus__c IN ('계약서명완료','계약서명대기')
 *   - ContractDateStart__c IN [2026-04-01, 2026-05-01)
 *   - Opportunity__r JOIN: Owner_Department__c, LeadSource, AccountId, TotalNumberofEveryTablet__c, ru_TabletQty__c, ru_MasterTabletQty__c
 *   - Account JOIN: fm_AccountType__c, FRBrand__c
 *
 * 팀 매핑 (Opportunity.Owner_Department__c 기준):
 *   - '인바운드세일즈'                 → 인바운드
 *   - '채널매니지먼트'/'채널세일즈팀'/'채널세일즈' → 채널
 *   - '아웃바운드세일즈'               → 아웃바운드
 *   - '리텐션'                        → 리텐션
 *   - 그 외 / null                    → External
 *
 * 추가 분리 분석:
 *   - 아웃바운드: LeadSource 분포, fm_AccountType__c 분포 (90%+ 단일이면 단일 합계만)
 *   - 인바운드:   LeadSource 분포 (홈페이지/전화/광고 등) (90%+ 단일이면 단일 합계만)
 *
 * 실행: node scripts/analysis/april-team-split.js
 *
 * 산출물:
 *   - data/april-team-split-tablets-2026.json
 *   - 콘솔 표 (한국어, 5개 팀 비교 + 4/22 캐시 대비 증분)
 *
 * 제약:
 *   - SELECT 외 DML 금지
 *   - 평균 사용 금지 — 중앙값 + P25/P75
 *   - 0으로 나누기 방어
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const DATA_DIR = path.join(__dirname, '../../data');

// ──────────────────────────────────────────────
// 설정
// ──────────────────────────────────────────────
const PERIOD = '2026-04';
const PERIOD_START_DATE = '2026-04-01';
const PERIOD_END_DATE   = '2026-05-01'; // half-open
const TEAMS = ['인바운드', '채널', '아웃바운드', '리텐션', 'External'];

// 4/22 기준 캐시 (april-forecast-tablets-2026.json) — 비교 baseline
const CACHE_BY_TEAM_2026_04_22 = {
  '인바운드': 2118,
  '채널':     2419,
  '아웃바운드': 444,
  '리텐션':   2544,
  'External': 1525,
};

// 채널 부서는 다중 매핑 (포함되지 않는 부서를 모두 추적하기 위함)
const CHANNEL_DEPTS = ['채널매니지먼트', '채널세일즈팀', '채널세일즈'];

// ──────────────────────────────────────────────
// 통계 유틸 (평균 금지)
// ──────────────────────────────────────────────
function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function percentile(arr, p) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ──────────────────────────────────────────────
// 팀 매핑 (april-forecast-tablets.js:73-81 와 동일)
// ──────────────────────────────────────────────
function mapTeam(dept) {
  if (!dept) return 'External';
  if (dept === '인바운드세일즈') return '인바운드';
  if (CHANNEL_DEPTS.includes(dept)) return '채널';
  if (dept === '아웃바운드세일즈') return '아웃바운드';
  if (dept === '리텐션') return '리텐션';
  if (dept === 'External' || dept === 'external') return 'External';
  return 'External';
}

// ──────────────────────────────────────────────
// Salesforce 인증 + 쿼리 (채널 스크립트와 동일 패턴)
// ──────────────────────────────────────────────
async function getSalesforceToken() {
  const url = `${process.env.SF_LOGIN_URL}/services/oauth2/token`;
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', process.env.SF_CLIENT_ID);
  params.append('client_secret', process.env.SF_CLIENT_SECRET);
  params.append('username', process.env.SF_USERNAME);
  params.append('password', decodeURIComponent(process.env.SF_PASSWORD));
  const res = await axios.post(url, params);
  return { accessToken: res.data.access_token, instanceUrl: res.data.instance_url };
}

async function soqlQueryAll(instanceUrl, accessToken, query) {
  let allRecords = [];
  let result = await axios.get(`${instanceUrl}/services/data/v59.0/query`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { q: query },
  });
  allRecords.push(...(result.data.records || []));
  while (result.data.nextRecordsUrl) {
    result = await axios.get(`${instanceUrl}${result.data.nextRecordsUrl}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    allRecords.push(...(result.data.records || []));
  }
  return allRecords;
}

function tabletQty(opp) {
  if (!opp) return 0;
  if (opp.TotalNumberofEveryTablet__c != null && opp.TotalNumberofEveryTablet__c !== 0) {
    return Number(opp.TotalNumberofEveryTablet__c) || 0;
  }
  const tq = Number(opp.ru_TabletQty__c) || 0;
  const mq = Number(opp.ru_MasterTabletQty__c) || 0;
  return tq + mq;
}

// ──────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────
async function main() {
  console.log('='.repeat(80));
  console.log('  4월 팀별 CW 태블릿 — 5개 팀 분리 (Contract__c 기반)');
  console.log(`  기간: ${PERIOD} (Contract__c.ContractDateStart__c 기준)`);
  console.log(`  소스: Contract__c (채널 스크립트와 동일 정합성 룰)`);
  console.log('='.repeat(80));

  const { accessToken, instanceUrl } = await getSalesforceToken();

  // ── 1. 4월 전체 Contract__c 조회 (모든 팀) ──
  // NOTE: Owner_Department__c 필터 없이 전체 조회 후 mapTeam() 으로 분류
  // (External 부서/null 까지 포착하기 위함)
  const contractQuery = `
    SELECT Id, ContractStatus__c, ContractDateStart__c,
           Opportunity__c,
           Opportunity__r.Id, Opportunity__r.Name, Opportunity__r.AccountId,
           Opportunity__r.LeadSource, Opportunity__r.Owner_Department__c,
           Opportunity__r.OwnerId, Opportunity__r.Owner.Name,
           Opportunity__r.IsClosed, Opportunity__r.IsWon, Opportunity__r.StageName,
           Opportunity__r.CloseDate, Opportunity__r.CreatedDate,
           Opportunity__r.TotalNumberofEveryTablet__c,
           Opportunity__r.ru_TabletQty__c, Opportunity__r.ru_MasterTabletQty__c,
           Opportunity__r.Account.Name
    FROM Contract__c
    WHERE Opportunity__c != NULL
      AND ContractDateStart__c >= ${PERIOD_START_DATE}
      AND ContractDateStart__c <  ${PERIOD_END_DATE}
      AND ContractStatus__c IN ('계약서명완료','계약서명대기')
  `.replace(/\s+/g, ' ').trim();

  const contracts = await soqlQueryAll(instanceUrl, accessToken, contractQuery);
  console.log(`\n  [SOQL] 4월 Contract__c 전체: ${contracts.length}건`);

  const signedContracts = contracts.filter(c => c.ContractStatus__c === '계약서명완료');
  const pendingContracts = contracts.filter(c => c.ContractStatus__c === '계약서명대기');
  console.log(`         서명완료: ${signedContracts.length}건 / 서명대기: ${pendingContracts.length}건`);

  // ── 2. AccountId → Account 보강 (fm_AccountType__c 분포용) ──
  const acctIds = [...new Set(contracts.map(c => c.Opportunity__r?.AccountId).filter(Boolean))];
  console.log(`  [SOQL] Account 조회 대상: ${acctIds.length}건`);

  const accountMap = new Map();
  const CHUNK = 200;
  for (let i = 0; i < acctIds.length; i += CHUNK) {
    const chunk = acctIds.slice(i, i + CHUNK);
    const ids = chunk.map(id => `'${id}'`).join(',');
    const accQuery = `
      SELECT Id, Name, fm_AccountType__c, FRBrand__c, FRBrand__r.Name,
             FRHQ__c, IsPartner
      FROM Account
      WHERE Id IN (${ids})
    `.replace(/\s+/g, ' ').trim();
    const accs = await soqlQueryAll(instanceUrl, accessToken, accQuery);
    accs.forEach(a => accountMap.set(a.Id, a));
  }
  console.log(`  [SOQL] Account 응답: ${accountMap.size}건`);

  // ── 3. 팀별 집계 ──
  const cwAgg = {};
  const pendingAgg = {};
  const tabletValuesByTeam = {};
  const dailyByTeam = {};         // team -> { date -> tablets }
  const leadSourceByTeam = {};    // team -> { leadsource -> { count, tablets } }
  const fmAccountTypeByTeam = {}; // team -> { fm_AccountType -> { count, tablets } }
  const deptDistribByTeam = {};   // team -> { dept -> count } — External 진단용

  TEAMS.forEach(t => {
    cwAgg[t] = { tablets: 0, count: 0 };
    pendingAgg[t] = { tablets: 0, count: 0 };
    tabletValuesByTeam[t] = [];
    dailyByTeam[t] = {};
    leadSourceByTeam[t] = {};
    fmAccountTypeByTeam[t] = {};
    deptDistribByTeam[t] = {};
  });

  // CW 서명완료 집계
  signedContracts.forEach(c => {
    const opp = c.Opportunity__r;
    const dept = opp?.Owner_Department__c || null;
    const team = mapTeam(dept);
    const tablets = tabletQty(opp);
    const dateStr = c.ContractDateStart__c;
    const ls = opp?.LeadSource || '(null)';
    const acc = accountMap.get(opp?.AccountId);
    const fmType = acc?.fm_AccountType__c || '(null)';

    cwAgg[team].count += 1;
    cwAgg[team].tablets += tablets;
    if (tablets > 0) tabletValuesByTeam[team].push(tablets);

    if (dateStr && dateStr.startsWith(PERIOD)) {
      dailyByTeam[team][dateStr] = (dailyByTeam[team][dateStr] || 0) + tablets;
    }

    // LeadSource 분포 (서명완료 한정)
    if (!leadSourceByTeam[team][ls]) leadSourceByTeam[team][ls] = { count: 0, tablets: 0 };
    leadSourceByTeam[team][ls].count += 1;
    leadSourceByTeam[team][ls].tablets += tablets;

    // fm_AccountType 분포 (서명완료 한정)
    if (!fmAccountTypeByTeam[team][fmType]) fmAccountTypeByTeam[team][fmType] = { count: 0, tablets: 0 };
    fmAccountTypeByTeam[team][fmType].count += 1;
    fmAccountTypeByTeam[team][fmType].tablets += tablets;

    // Owner_Department__c 분포 (External 진단용)
    const deptKey = dept || '(null)';
    deptDistribByTeam[team][deptKey] = (deptDistribByTeam[team][deptKey] || 0) + 1;
  });

  // 서명대기 집계 (참고)
  pendingContracts.forEach(c => {
    const opp = c.Opportunity__r;
    const team = mapTeam(opp?.Owner_Department__c);
    const tablets = tabletQty(opp);
    pendingAgg[team].count += 1;
    pendingAgg[team].tablets += tablets;
  });

  // ── 4. 일자별 누적 추이 빌더 ──
  function buildDailyTrend(catDaily) {
    const dates = Object.keys(catDaily).sort();
    let cumulative = 0;
    return dates.map(d => {
      cumulative += catDaily[d];
      return { date: d, tablets: catDaily[d], cumulative };
    });
  }

  // ── 5. 분리 분석 (LeadSource / fm_AccountType 의미성 판단) ──
  // 90%+ 단일 카테고리면 의미 없음 → 단일 합계만 / 그 외엔 분리 결과 포함
  function analyzeSplit(distMap, totalCount) {
    if (totalCount === 0) return { meaningful: false, dominantRatio: 0, distribution: [] };
    const entries = Object.entries(distMap)
      .map(([key, val]) => ({
        key,
        count: val.count,
        tablets: val.tablets,
        countRatio: totalCount > 0 ? val.count / totalCount : 0,
      }))
      .sort((a, b) => b.tablets - a.tablets);
    const dominant = entries[0]?.countRatio || 0;
    return {
      meaningful: dominant < 0.9, // 한 카테고리가 90% 미만이면 의미 있음
      dominantRatio: Math.round(dominant * 1000) / 1000,
      distribution: entries.map(e => ({
        key: e.key,
        count: e.count,
        tablets: e.tablets,
        countRatio: Math.round(e.countRatio * 1000) / 1000,
      })),
    };
  }

  // ── 6. 결과 산출 ──
  const dataAsOf = (() => {
    const allDates = [];
    TEAMS.forEach(t => allDates.push(...Object.keys(dailyByTeam[t])));
    if (allDates.length === 0) return new Date().toISOString().substring(0, 10);
    return allDates.sort().pop();
  })();

  const teamResult = {};
  TEAMS.forEach(t => {
    const vals = tabletValuesByTeam[t];
    const cwCount = cwAgg[t].count;
    teamResult[t] = {
      cwSignedTablets: cwAgg[t].tablets,
      cwSignedCount: cwCount,
      tabletMedian: median(vals),
      tabletP25: percentile(vals, 25),
      tabletP75: percentile(vals, 75),
      pendingTablets: pendingAgg[t].tablets,
      pendingCount: pendingAgg[t].count,
      cache_2026_04_22: CACHE_BY_TEAM_2026_04_22[t] || 0,
      delta_vs_cache: cwAgg[t].tablets - (CACHE_BY_TEAM_2026_04_22[t] || 0),
      dailyTrend: buildDailyTrend(dailyByTeam[t]),
      leadSourceSplit: analyzeSplit(leadSourceByTeam[t], cwCount),
      fmAccountTypeSplit: analyzeSplit(fmAccountTypeByTeam[t], cwCount),
      deptDistribution: deptDistribByTeam[t],
    };
  });

  const totalCwTablets = TEAMS.reduce((s, t) => s + cwAgg[t].tablets, 0);
  const totalCwCount = TEAMS.reduce((s, t) => s + cwAgg[t].count, 0);
  const totalPendingTablets = TEAMS.reduce((s, t) => s + pendingAgg[t].tablets, 0);
  const totalPendingCount = TEAMS.reduce((s, t) => s + pendingAgg[t].count, 0);
  const totalCache = TEAMS.reduce((s, t) => s + (CACHE_BY_TEAM_2026_04_22[t] || 0), 0);

  const output = {
    generatedAt: new Date().toISOString(),
    period: PERIOD,
    dataAsOf,
    sourceFilter: {
      object: 'Contract__c',
      contractStatus: ['계약서명완료', '계약서명대기'],
      dateField: 'ContractDateStart__c',
      dateRange: `${PERIOD_START_DATE} ~ ${PERIOD_END_DATE} (half-open)`,
      teamMappingField: 'Opportunity.Owner_Department__c',
    },
    teamMapping: {
      '인바운드': ['인바운드세일즈'],
      '채널': CHANNEL_DEPTS,
      '아웃바운드': ['아웃바운드세일즈'],
      '리텐션': ['리텐션'],
      'External': ['그 외 / null'],
    },
    cacheBaseline: {
      asOf: '2026-04-22',
      source: 'data/april-forecast-tablets-2026.json (confirmed.byTeam.signed)',
      values: CACHE_BY_TEAM_2026_04_22,
      total: totalCache,
    },
    teams: teamResult,
    totals: {
      cwSignedTablets: totalCwTablets,
      cwSignedCount: totalCwCount,
      pendingTablets: totalPendingTablets,
      pendingCount: totalPendingCount,
      cache_2026_04_22_total: totalCache,
      delta_vs_cache_total: totalCwTablets - totalCache,
    },
    qa: {
      totalContracts: contracts.length,
      cwSignedContractCount: signedContracts.length,
      pendingContractCount: pendingContracts.length,
      accountFetched: accountMap.size,
    },
  };

  // ────────────────────────────────────────────
  // 콘솔 출력
  // ────────────────────────────────────────────

  // 표 1: 5개 팀 비교 표 (요청 형식)
  console.log('\n' + '─'.repeat(110));
  console.log('### 표 1: 5개 팀 4월 CW 태블릿 비교 (4/30 기준 vs 4/22 캐시)');
  console.log('─'.repeat(110));
  console.log(
    `${'팀'.padEnd(12)} | ${'CW확정(4/30)'.padStart(12)} | ${'4/22캐시'.padStart(10)} | ${'증분'.padStart(8)} | ${'CW건수'.padStart(7)} | ${'중앙값'.padStart(7)} | ${'P25'.padStart(6)} | ${'P75'.padStart(6)} | ${'서명대기'.padStart(8)}`
  );
  console.log('─'.repeat(110));

  TEAMS.forEach(t => {
    const r = teamResult[t];
    const med = r.tabletMedian != null ? r.tabletMedian.toFixed(1) : '-';
    const p25 = r.tabletP25 != null ? r.tabletP25.toFixed(1) : '-';
    const p75 = r.tabletP75 != null ? r.tabletP75.toFixed(1) : '-';
    const deltaStr = (r.delta_vs_cache >= 0 ? '+' : '') + r.delta_vs_cache;
    console.log(
      `${t.padEnd(12)} | ${String(r.cwSignedTablets).padStart(12)} | ${String(r.cache_2026_04_22).padStart(10)} | ${deltaStr.padStart(8)} | ${String(r.cwSignedCount).padStart(7)} | ${med.padStart(7)} | ${p25.padStart(6)} | ${p75.padStart(6)} | ${String(r.pendingTablets).padStart(8)}`
    );
  });

  console.log('─'.repeat(110));
  const totalDelta = totalCwTablets - totalCache;
  const totalDeltaStr = (totalDelta >= 0 ? '+' : '') + totalDelta;
  console.log(
    `${'합계'.padEnd(12)} | ${String(totalCwTablets).padStart(12)} | ${String(totalCache).padStart(10)} | ${totalDeltaStr.padStart(8)} | ${String(totalCwCount).padStart(7)} |         |        |        | ${String(totalPendingTablets).padStart(8)}`
  );

  // 구성비
  console.log('\n  [구성비 — CW 태블릿 4/30 기준]');
  TEAMS.forEach(t => {
    const ratio = totalCwTablets > 0
      ? (teamResult[t].cwSignedTablets / totalCwTablets * 100).toFixed(1)
      : '0.0';
    console.log(`    ${t.padEnd(10)} : ${String(teamResult[t].cwSignedTablets).padStart(6)}대 (${ratio.padStart(5)}%)`);
  });

  // 표 2: 인바운드 LeadSource 분포
  console.log('\n' + '─'.repeat(80));
  console.log('### 표 2: 인바운드 LeadSource 분포 (서명완료 기준)');
  console.log('─'.repeat(80));
  const inLs = teamResult['인바운드'].leadSourceSplit;
  console.log(`  의미성: ${inLs.meaningful ? '의미 있음 (분리 권장)' : '의미 없음 (단일 합계로 충분, 최대 비중 ' + (inLs.dominantRatio * 100).toFixed(1) + '%)'}`);
  console.log(`${'LeadSource'.padEnd(20)} | ${'건수'.padStart(6)} | ${'태블릿'.padStart(8)} | ${'건수비중'.padStart(8)}`);
  console.log('─'.repeat(80));
  inLs.distribution.forEach(d => {
    console.log(`${d.key.padEnd(20)} | ${String(d.count).padStart(6)} | ${String(d.tablets).padStart(8)} | ${(d.countRatio * 100).toFixed(1).padStart(7)}%`);
  });

  // 표 3: 아웃바운드 LeadSource + fm_AccountType 분포
  console.log('\n' + '─'.repeat(80));
  console.log('### 표 3: 아웃바운드 LeadSource 분포 (서명완료 기준)');
  console.log('─'.repeat(80));
  const obLs = teamResult['아웃바운드'].leadSourceSplit;
  console.log(`  의미성: ${obLs.meaningful ? '의미 있음 (분리 권장)' : '의미 없음 (단일 합계로 충분, 최대 비중 ' + (obLs.dominantRatio * 100).toFixed(1) + '%)'}`);
  console.log(`${'LeadSource'.padEnd(20)} | ${'건수'.padStart(6)} | ${'태블릿'.padStart(8)} | ${'건수비중'.padStart(8)}`);
  console.log('─'.repeat(80));
  obLs.distribution.forEach(d => {
    console.log(`${d.key.padEnd(20)} | ${String(d.count).padStart(6)} | ${String(d.tablets).padStart(8)} | ${(d.countRatio * 100).toFixed(1).padStart(7)}%`);
  });

  console.log('\n' + '─'.repeat(80));
  console.log('### 표 4: 아웃바운드 fm_AccountType__c 분포 (서명완료 기준)');
  console.log('─'.repeat(80));
  const obAcc = teamResult['아웃바운드'].fmAccountTypeSplit;
  console.log(`  의미성: ${obAcc.meaningful ? '의미 있음 (분리 권장)' : '의미 없음 (단일 합계로 충분, 최대 비중 ' + (obAcc.dominantRatio * 100).toFixed(1) + '%)'}`);
  console.log(`${'fm_AccountType'.padEnd(20)} | ${'건수'.padStart(6)} | ${'태블릿'.padStart(8)} | ${'건수비중'.padStart(8)}`);
  console.log('─'.repeat(80));
  obAcc.distribution.forEach(d => {
    console.log(`${d.key.padEnd(20)} | ${String(d.count).padStart(6)} | ${String(d.tablets).padStart(8)} | ${(d.countRatio * 100).toFixed(1).padStart(7)}%`);
  });

  // 표 5: External Owner_Department__c 분포 (진단)
  console.log('\n' + '─'.repeat(80));
  console.log('### 표 5: External 카테고리 부서 분포 (진단용)');
  console.log('─'.repeat(80));
  const extDept = deptDistribByTeam['External'];
  const extDeptEntries = Object.entries(extDept).sort((a, b) => b[1] - a[1]);
  if (extDeptEntries.length === 0) {
    console.log('  (External 부서 없음)');
  } else {
    console.log(`${'부서'.padEnd(30)} | ${'건수'.padStart(6)}`);
    console.log('─'.repeat(80));
    extDeptEntries.forEach(([dept, cnt]) => {
      console.log(`${dept.padEnd(30)} | ${String(cnt).padStart(6)}`);
    });
  }

  // 표 6: 캐시 정합성 검증
  console.log('\n' + '─'.repeat(80));
  console.log('### 표 6: 캐시 정합성 검증 (4/30 vs 4/22)');
  console.log('─'.repeat(80));
  console.log(`  채널 캐시 별도 검증: april-channel-split-tablets-2026.json totals = 3,048대 (참조)`);
  console.log(`  현재 채널 CW 합계  : ${teamResult['채널'].cwSignedTablets}대`);
  console.log(`  4/22 전체 캐시 합계: ${totalCache}대`);
  console.log(`  4/30 전체 CW 합계  : ${totalCwTablets}대  (증분: ${totalDeltaStr}대)`);

  // ── JSON 저장 ──
  const outPath = path.join(DATA_DIR, 'april-team-split-tablets-2026.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n[저장] ${outPath}`);
  console.log(`[기준일] ${dataAsOf}`);
}

main().catch(e => {
  console.error('Error:', e.message);
  if (e.response?.data) {
    console.error('Response:', JSON.stringify(e.response.data).substring(0, 500));
  }
  process.exit(1);
});
