/**
 * 4월 채널 세일즈 CW(Closed Won) 태블릿 — 파트너사 / 프랜차이즈 분리 집계
 *
 * 데이터 소스: Salesforce SOQL 직접 쿼리 (옵션 A)
 *   - Contract__c (캐시/대시보드와 동일 소스: 2,419대 기준)
 *     · ContractStatus__c='계약서명완료' / '계약서명대기'
 *     · ContractDateStart__c IN [2026-04-01, 2026-05-01)
 *   - Opportunity__r JOIN: Owner_Department__c, LeadSource, AccountId, TotalNumberofEveryTablet__c
 *   - Account JOIN: fm_AccountType__c, FRBrand__c
 *
 * 실행: node scripts/analysis/april-channel-split.js
 *
 * 분류 룰 (우선순위):
 *   1. Opportunity.LeadSource === '파트너사 소개'             → 파트너사
 *   2. Opportunity.LeadSource === '프랜차이즈소개'            → 프랜차이즈
 *   3. Account.fm_AccountType__c === '파트너사'              → 파트너사
 *   4. Account.fm_AccountType__c IN ('프랜차이즈본사','브랜드') → 프랜차이즈
 *   5. Account.FRBrand__c != null  (가맹점)                 → 프랜차이즈
 *   6. 그 외                                               → 기타 (데이터 품질 점검용)
 *
 * 산출물:
 *   - data/april-channel-split-tablets-2026.json
 *   - 콘솔 표 (한국어)
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
// Salesforce 인증 + 쿼리
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

// ──────────────────────────────────────────────
// 분류 룰
// ──────────────────────────────────────────────
function classifyContract(contract, accountMap) {
  const opp = contract.Opportunity__r;
  if (!opp) return { category: '기타', reason: 'no_opp' };

  // 1순위: Opportunity.LeadSource
  const ls = opp.LeadSource;
  if (ls === '파트너사 소개') return { category: '파트너사', reason: 'leadsource:파트너사 소개' };
  if (ls === '프랜차이즈소개') return { category: '프랜차이즈', reason: 'leadsource:프랜차이즈소개' };

  // 2순위: Account 속성
  const acc = accountMap.get(opp.AccountId);
  if (acc) {
    const t = acc.fm_AccountType__c;
    if (t === '파트너사') return { category: '파트너사', reason: 'fm_AccountType:파트너사' };
    if (t === '프랜차이즈본사' || t === '브랜드') return { category: '프랜차이즈', reason: `fm_AccountType:${t}` };
    if (acc.FRBrand__c) return { category: '프랜차이즈', reason: 'FRBrand__c set (가맹점)' };
  }

  return { category: '기타', reason: `unmatched (LeadSource=${ls || 'null'}, fm_AccountType=${acc?.fm_AccountType__c || 'null'})` };
}

// ──────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────
async function main() {
  console.log('='.repeat(80));
  console.log('  4월 채널 CW 태블릿 — 파트너사 / 프랜차이즈 분리 집계');
  console.log(`  기간: ${PERIOD} (Contract__c.ContractDateStart__c 기준)`);
  console.log(`  부서: ${CHANNEL_DEPTS.join(', ')}`);
  console.log(`  소스: Contract__c (캐시 2,419대와 동일 소스)`);
  console.log('='.repeat(80));

  const { accessToken, instanceUrl } = await getSalesforceToken();

  // ── 1. 채널 부서 Contract__c 조회 (4월) ──
  // 캐시(april-forecast-tablets-2026.json) 채널 confirmed.signed=2419 와 정합성 보장
  const deptList = CHANNEL_DEPTS.map(d => `'${d}'`).join(',');
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
      AND Opportunity__r.Owner_Department__c IN (${deptList})
  `.replace(/\s+/g, ' ').trim();

  const contracts = await soqlQueryAll(instanceUrl, accessToken, contractQuery);
  console.log(`\n  [SOQL] 채널 Contract__c (4월): ${contracts.length}건`);

  const signedContracts = contracts.filter(c => c.ContractStatus__c === '계약서명완료');
  const pendingContracts = contracts.filter(c => c.ContractStatus__c === '계약서명대기');
  console.log(`         서명완료: ${signedContracts.length}건 / 서명대기: ${pendingContracts.length}건`);

  // ── 2. AccountId → Account 보강 (LeadSource 미지정 건 분류용) ──
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

  // ── 3. 카테고리별 집계 ──
  const CATS = ['파트너사', '프랜차이즈', '기타'];
  const cwAgg = {};        // CW 서명완료 집계
  const pendingAgg = {};   // 서명대기 집계
  const tabletValuesByCat = {};
  const dailyByCat = {};   // category -> { date -> tablets }
  const reasonCountByCat = {}; // category -> { reason -> count }
  const unmatchedSamples = []; // 기타 분류 샘플 Account ID
  const unmatchedDetails = [];

  CATS.forEach(c => {
    cwAgg[c] = { tablets: 0, count: 0 };
    pendingAgg[c] = { tablets: 0, count: 0 };
    tabletValuesByCat[c] = [];
    dailyByCat[c] = {};
    reasonCountByCat[c] = {};
  });

  function tabletQty(opp) {
    if (!opp) return 0;
    if (opp.TotalNumberofEveryTablet__c != null && opp.TotalNumberofEveryTablet__c !== 0) {
      return Number(opp.TotalNumberofEveryTablet__c) || 0;
    }
    const tq = Number(opp.ru_TabletQty__c) || 0;
    const mq = Number(opp.ru_MasterTabletQty__c) || 0;
    return tq + mq;
  }

  // 서명완료 집계
  signedContracts.forEach(c => {
    const opp = c.Opportunity__r;
    const { category, reason } = classifyContract(c, accountMap);
    const tablets = tabletQty(opp);
    const dateStr = c.ContractDateStart__c; // ContractDateStart__c 는 Date 타입 (YYYY-MM-DD)

    cwAgg[category].count += 1;
    cwAgg[category].tablets += tablets;
    if (tablets > 0) tabletValuesByCat[category].push(tablets);
    reasonCountByCat[category][reason] = (reasonCountByCat[category][reason] || 0) + 1;

    if (dateStr && dateStr.startsWith(PERIOD)) {
      dailyByCat[category][dateStr] = (dailyByCat[category][dateStr] || 0) + tablets;
    }

    if (category === '기타') {
      const acc = accountMap.get(opp?.AccountId);
      if (unmatchedSamples.length < 5 && opp?.AccountId) unmatchedSamples.push(opp.AccountId);
      unmatchedDetails.push({
        contractId: c.Id,
        oppId: opp?.Id,
        accountId: opp?.AccountId,
        accountName: acc?.Name || opp?.Account?.Name || null,
        leadSource: opp?.LeadSource || null,
        fm_AccountType__c: acc?.fm_AccountType__c || null,
        FRBrand__c: acc?.FRBrand__c || null,
        ownerDept: opp?.Owner_Department__c || null,
        tablets,
      });
    }
  });

  // 서명대기 집계 (참고)
  pendingContracts.forEach(c => {
    const opp = c.Opportunity__r;
    const { category } = classifyContract(c, accountMap);
    const tablets = tabletQty(opp);
    pendingAgg[category].count += 1;
    pendingAgg[category].tablets += tablets;
  });

  // ── 4. 일자별 추이 (누적) ──
  function buildDailyTrend(catDaily) {
    const dates = Object.keys(catDaily).sort();
    let cumulative = 0;
    return dates.map(d => {
      cumulative += catDaily[d];
      return { date: d, tablets: catDaily[d], cumulative };
    });
  }

  // ── 5. 결과 산출 ──
  const dataAsOf = (() => {
    const allDates = [];
    CATS.forEach(c => allDates.push(...Object.keys(dailyByCat[c])));
    if (allDates.length === 0) return new Date().toISOString().substring(0, 10);
    return allDates.sort().pop();
  })();

  const channel = {};
  CATS.forEach(c => {
    const vals = tabletValuesByCat[c];
    channel[c] = {
      cwSignedTablets: cwAgg[c].tablets,
      cwSignedCount: cwAgg[c].count,
      tabletMedian: median(vals),
      tabletP25: percentile(vals, 25),
      tabletP75: percentile(vals, 75),
      pendingTablets: pendingAgg[c].tablets,
      pendingCount: pendingAgg[c].count,
      dailyTrend: buildDailyTrend(dailyByCat[c]),
      classificationReasons: reasonCountByCat[c],
    };
  });

  const totalCwTablets = CATS.reduce((s, c) => s + cwAgg[c].tablets, 0);
  const totalCwCount = CATS.reduce((s, c) => s + cwAgg[c].count, 0);
  const totalPendingTablets = CATS.reduce((s, c) => s + pendingAgg[c].tablets, 0);
  const totalPendingCount = CATS.reduce((s, c) => s + pendingAgg[c].count, 0);

  const output = {
    generatedAt: new Date().toISOString(),
    period: PERIOD,
    dataAsOf,
    sourceFilter: {
      object: 'Contract__c',
      contractStatus: ['계약서명완료', '계약서명대기'],
      ownerDepartments: CHANNEL_DEPTS,
      dateField: 'ContractDateStart__c',
      dateRange: `${PERIOD_START_DATE} ~ ${PERIOD_END_DATE} (half-open)`,
    },
    classificationRule: {
      priority: [
        '1. Opportunity.LeadSource === "파트너사 소개" → 파트너사',
        '2. Opportunity.LeadSource === "프랜차이즈소개" → 프랜차이즈',
        '3. Account.fm_AccountType__c === "파트너사" → 파트너사',
        '4. Account.fm_AccountType__c IN ("프랜차이즈본사","브랜드") → 프랜차이즈',
        '5. Account.FRBrand__c != null (가맹점) → 프랜차이즈',
        '6. 그 외 → 기타',
      ],
    },
    channel,
    totals: {
      cwSignedTablets: totalCwTablets,
      cwSignedCount: totalCwCount,
      pendingTablets: totalPendingTablets,
      pendingCount: totalPendingCount,
    },
    qa: {
      totalChannelContracts: contracts.length,
      cwSignedContractCount: signedContracts.length,
      pendingContractCount: pendingContracts.length,
      accountFetched: accountMap.size,
      unmatchedCount: cwAgg['기타'].count,
      unmatched_fm_AccountType_samples: unmatchedSamples,
      unmatchedDetails: unmatchedDetails.slice(0, 20),
    },
  };

  // ── 6. 콘솔 출력 ──
  console.log('\n' + '─'.repeat(105));
  console.log('### 표 1: 카테고리별 4월 채널 CW 태블릿 분포');
  console.log('─'.repeat(105));
  console.log(
    `${'카테고리'.padEnd(12)} | ${'CW대수'.padStart(8)} | ${'CW건수'.padStart(6)} | ${'중앙값'.padStart(6)} | ${'P25'.padStart(6)} | ${'P75'.padStart(6)} | ${'서명대기'.padStart(8)} | ${'대기건수'.padStart(8)}`
  );
  console.log('─'.repeat(105));
  CATS.forEach(c => {
    const r = channel[c];
    const med = r.tabletMedian != null ? r.tabletMedian.toFixed(1) : '-';
    const p25 = r.tabletP25 != null ? r.tabletP25.toFixed(1) : '-';
    const p75 = r.tabletP75 != null ? r.tabletP75.toFixed(1) : '-';
    console.log(
      `${c.padEnd(12)} | ${String(r.cwSignedTablets).padStart(8)} | ${String(r.cwSignedCount).padStart(6)} | ${med.padStart(6)} | ${p25.padStart(6)} | ${p75.padStart(6)} | ${String(r.pendingTablets).padStart(8)} | ${String(r.pendingCount).padStart(8)}`
    );
  });
  console.log('─'.repeat(105));
  console.log(
    `${'합계'.padEnd(12)} | ${String(totalCwTablets).padStart(8)} | ${String(totalCwCount).padStart(6)} |        |        |        | ${String(totalPendingTablets).padStart(8)} | ${String(totalPendingCount).padStart(8)}`
  );

  console.log('\n  [구성비 — CW 태블릿]');
  CATS.forEach(c => {
    const ratio = totalCwTablets > 0
      ? (channel[c].cwSignedTablets / totalCwTablets * 100).toFixed(1)
      : '0.0';
    console.log(`    ${c.padEnd(10)} : ${String(channel[c].cwSignedTablets).padStart(6)}대 (${ratio.padStart(5)}%)`);
  });

  // 분류 근거 분포
  console.log('\n  [분류 근거 분포 — 서명완료]');
  CATS.forEach(c => {
    const reasons = reasonCountByCat[c];
    const keys = Object.keys(reasons);
    if (keys.length === 0) {
      console.log(`    ${c.padEnd(10)} : (없음)`);
      return;
    }
    keys.forEach(r => {
      console.log(`    ${c.padEnd(10)} | ${r.padEnd(40)} : ${reasons[r]}건`);
    });
  });

  // 표 2: 일자별
  console.log('\n' + '─'.repeat(80));
  console.log('### 표 2: 일자별 CW 태블릿 (파트너사 vs 프랜차이즈 vs 기타)');
  console.log('─'.repeat(80));
  const allDateSet = new Set();
  CATS.forEach(c => Object.keys(dailyByCat[c]).forEach(d => allDateSet.add(d)));
  const allDates = [...allDateSet].sort();
  console.log(
    `${'날짜'.padEnd(12)} | ${'파트너사'.padStart(8)} | ${'프랜차이즈'.padStart(10)} | ${'기타'.padStart(6)} | ${'일합계'.padStart(8)}`
  );
  console.log('─'.repeat(80));
  let cumP = 0, cumF = 0, cumE = 0;
  allDates.forEach(d => {
    const p = dailyByCat['파트너사'][d] || 0;
    const f = dailyByCat['프랜차이즈'][d] || 0;
    const e = dailyByCat['기타'][d] || 0;
    cumP += p; cumF += f; cumE += e;
    console.log(
      `${d.padEnd(12)} | ${String(p).padStart(8)} | ${String(f).padStart(10)} | ${String(e).padStart(6)} | ${String(p + f + e).padStart(8)}`
    );
  });
  console.log('─'.repeat(80));
  console.log(
    `${'누적'.padEnd(12)} | ${String(cumP).padStart(8)} | ${String(cumF).padStart(10)} | ${String(cumE).padStart(6)} | ${String(cumP + cumF + cumE).padStart(8)}`
  );

  // 표 3: QA
  console.log('\n' + '─'.repeat(80));
  console.log('### 표 3: QA — 기타(미분류) 진단');
  console.log('─'.repeat(80));
  console.log(`  기타 카테고리 CW 건수: ${cwAgg['기타'].count}건 (${cwAgg['기타'].tablets}대)`);
  if (cwAgg['기타'].count > 0) {
    console.log(`  미분류 Account 샘플 (최대 5):`);
    unmatchedSamples.forEach(id => console.log(`    - ${id}`));
    if (cwAgg['기타'].count >= 5) {
      console.log(`  ※ 기타 5건 이상 — 분류 룰 보완 검토 필요`);
      console.log(`  미분류 상세 (최대 10건):`);
      unmatchedDetails.slice(0, 10).forEach(u => {
        console.log(`    Acc ${u.accountId} / ${u.accountName || '?'} / LeadSource=${u.leadSource} / fm_AccountType=${u.fm_AccountType__c} / FRBrand=${u.FRBrand__c} / ${u.tablets}대`);
      });
    }
  }

  // 캐시 비교
  console.log('\n' + '─'.repeat(80));
  console.log('### 캐시 정합성 검증');
  console.log('─'.repeat(80));
  console.log(`  기존 채널 캐시 합계 (4/22 기준): 2,419대`);
  console.log(`  현재 채널 CW 합계        : ${totalCwTablets}대  (차이: ${totalCwTablets - 2419 >= 0 ? '+' : ''}${totalCwTablets - 2419}대)`);
  console.log(`  ※ 양수면 4/22 이후 신규 CW. 음수면 분류/필터 룰 차이 점검 필요.`);

  // ── 7. JSON 저장 ──
  const outPath = path.join(DATA_DIR, 'april-channel-split-tablets-2026.json');
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
