/**
 * 4월 채널 세일즈 Lead Gen KPI 추출
 *
 * 채널 팀 본질 KPI = Lead Gen (선행 지표)
 *   A. 신규 Lead 창출 수 (LeadSource: 파트너사 소개 / 프랜차이즈소개 / 기타)
 *   B. 신규 채널 Account 등록 수 (파트너사 / 프랜차이즈본사 / 브랜드)
 *   C. 신규 가맹점 연결 수 (FRBrand__c set 된 Account)
 *   D. 채널 신규 Opp 창출 수 (LeadSource 분리)
 *   E. Lead -> Opp 전환율 (1/2/3월 코호트, 60일 윈도우)
 *   F. (참고) 4월 채널 CW 태블릿 캐시 데이터
 *
 * 룰 명세: docs/team-kpi-spec.md 섹션 3
 *
 * 실행: node scripts/analysis/april-channel-leadgen.js
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
const PERIOD_START = '2026-04-01T00:00:00+09:00';
const PERIOD_END = '2026-05-01T00:00:00+09:00';

const CHANNEL_DEPTS = ['채널매니지먼트', '채널세일즈팀', '채널세일즈'];
const CHANNEL_LEAD_SOURCES = ['파트너사 소개', '프랜차이즈소개'];
const CHANNEL_ACCOUNT_TYPES = ['파트너사', '프랜차이즈본사', '브랜드'];

// 코호트: 60일 전환 윈도우
const COHORT_MONTHS = [
  { label: '2026-01', start: '2026-01-01T00:00:00+09:00', end: '2026-02-01T00:00:00+09:00' },
  { label: '2026-02', start: '2026-02-01T00:00:00+09:00', end: '2026-03-01T00:00:00+09:00' },
  { label: '2026-03', start: '2026-03-01T00:00:00+09:00', end: '2026-04-01T00:00:00+09:00' },
];
const CONVERSION_WINDOW_DAYS = 60;

// ──────────────────────────────────────────────
// 유틸리티
// ──────────────────────────────────────────────

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
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

// UTC ISO -> KST date string (YYYY-MM-DD)
function toKstDate(isoString) {
  const d = new Date(isoString);
  const kst = new Date(d.getTime() + 9 * 3600000);
  return kst.toISOString().substring(0, 10);
}

function pad(s, n) {
  s = String(s);
  let len = 0;
  for (const ch of s) len += ch.charCodeAt(0) > 127 ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - len));
}

function rpad(s, n) {
  s = String(s);
  let len = 0;
  for (const ch of s) len += ch.charCodeAt(0) > 127 ? 2 : 1;
  return ' '.repeat(Math.max(0, n - len)) + s;
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
  const allRecords = [];
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
// 메인
// ──────────────────────────────────────────────

async function main() {
  console.log('='.repeat(80));
  console.log(`  4월 채널 세일즈 Lead Gen KPI 추출 (period=${PERIOD})`);
  console.log(`  데이터 기준: KST ${PERIOD_START.substring(0, 10)} ~ ${PERIOD_END.substring(0, 10)} (half-open)`);
  console.log('='.repeat(80));

  const { accessToken, instanceUrl } = await getSalesforceToken();

  // ──────────────────────────────────────────────
  // A. 신규 Lead 창출 수 (4월)
  // ──────────────────────────────────────────────
  console.log('\n[A] 4월 신규 Lead 조회 중...');
  const leadsApr = await soqlQueryAll(
    instanceUrl,
    accessToken,
    `SELECT Id, CreatedDate, LeadSource, Status, IsConverted, ConvertedDate, ConvertedOpportunityId
       FROM Lead
      WHERE CreatedDate >= ${PERIOD_START}
        AND CreatedDate <  ${PERIOD_END}`
  );
  console.log(`     Lead 총 ${leadsApr.length}건`);

  // 카테고리: 파트너사 소개 / 프랜차이즈소개 / 기타
  const aprLeadsByCat = {
    '파트너사 소개': { count: 0, dailyMap: {}, leads: [] },
    '프랜차이즈소개': { count: 0, dailyMap: {}, leads: [] },
    '기타': { count: 0, dailyMap: {}, sourceMap: {}, leads: [] },
  };

  let nullSourceCount = 0;
  for (const l of leadsApr) {
    const src = l.LeadSource;
    const date = toKstDate(l.CreatedDate);
    let cat;
    if (src === '파트너사 소개') cat = '파트너사 소개';
    else if (src === '프랜차이즈소개') cat = '프랜차이즈소개';
    else cat = '기타';

    aprLeadsByCat[cat].count++;
    aprLeadsByCat[cat].dailyMap[date] = (aprLeadsByCat[cat].dailyMap[date] || 0) + 1;
    aprLeadsByCat[cat].leads.push(l);
    if (cat === '기타') {
      const key = src === null ? '(null)' : src;
      aprLeadsByCat['기타'].sourceMap[key] = (aprLeadsByCat['기타'].sourceMap[key] || 0) + 1;
      if (src === null) nullSourceCount++;
    }
  }

  // 일별 누적 시리즈
  function buildDaily(dailyMap) {
    const dates = Object.keys(dailyMap).sort();
    let cum = 0;
    return dates.map((d) => {
      cum += dailyMap[d];
      return { date: d, count: dailyMap[d], cumulative: cum };
    });
  }

  const newLeads = {
    '파트너사 소개': {
      count: aprLeadsByCat['파트너사 소개'].count,
      daily: buildDaily(aprLeadsByCat['파트너사 소개'].dailyMap),
    },
    '프랜차이즈소개': {
      count: aprLeadsByCat['프랜차이즈소개'].count,
      daily: buildDaily(aprLeadsByCat['프랜차이즈소개'].dailyMap),
    },
    '기타': {
      count: aprLeadsByCat['기타'].count,
      topSources: Object.fromEntries(
        Object.entries(aprLeadsByCat['기타'].sourceMap).sort((a, b) => b[1] - a[1])
      ),
      nullSourceCount,
    },
  };

  // ──────────────────────────────────────────────
  // B. 신규 채널 Account 등록 수 (4월)
  // ──────────────────────────────────────────────
  console.log('\n[B] 4월 신규 채널 Account 조회 중...');
  const acctTypeList = CHANNEL_ACCOUNT_TYPES.map((t) => `'${t}'`).join(',');
  const acctsApr = await soqlQueryAll(
    instanceUrl,
    accessToken,
    `SELECT Id, CreatedDate, fm_AccountType__c, Name, FRBrand__c
       FROM Account
      WHERE CreatedDate >= ${PERIOD_START}
        AND CreatedDate <  ${PERIOD_END}
        AND fm_AccountType__c IN (${acctTypeList})`
  );
  console.log(`     채널 Account ${acctsApr.length}건`);

  const newAccounts = { '파트너사': 0, '프랜차이즈본사': 0, '브랜드': 0 };
  for (const a of acctsApr) {
    const t = a.fm_AccountType__c;
    if (t in newAccounts) newAccounts[t]++;
  }

  // ──────────────────────────────────────────────
  // C. 신규 가맹점 연결 수 (4월)
  // ──────────────────────────────────────────────
  console.log('\n[C] 4월 신규 가맹점 (FRBrand__c set) 조회 중...');
  const franchiseStores = await soqlQueryAll(
    instanceUrl,
    accessToken,
    `SELECT Id, CreatedDate, FRBrand__c, FRBrand__r.Name, Name
       FROM Account
      WHERE CreatedDate >= ${PERIOD_START}
        AND CreatedDate <  ${PERIOD_END}
        AND FRBrand__c != null`
  );
  console.log(`     신규 가맹점 ${franchiseStores.length}건`);

  // 브랜드별 집계
  const brandMap = {};
  for (const s of franchiseStores) {
    const bname = s.FRBrand__r?.Name || `(unnamed:${s.FRBrand__c})`;
    brandMap[bname] = (brandMap[bname] || 0) + 1;
  }
  const topBrands = Object.entries(brandMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([brand, count]) => ({ brand, count }));

  const newFranchiseStores = {
    total: franchiseStores.length,
    distinctBrands: Object.keys(brandMap).length,
    topBrands,
  };

  // ──────────────────────────────────────────────
  // D. 채널 신규 Opp 창출 수 (4월)
  // ──────────────────────────────────────────────
  console.log('\n[D] 4월 채널 신규 Opp 조회 중...');
  const deptList = CHANNEL_DEPTS.map((d) => `'${d}'`).join(',');
  const oppsApr = await soqlQueryAll(
    instanceUrl,
    accessToken,
    `SELECT Id, CreatedDate, LeadSource, Owner_Department__c
       FROM Opportunity
      WHERE CreatedDate >= ${PERIOD_START}
        AND CreatedDate <  ${PERIOD_END}
        AND Owner_Department__c IN (${deptList})`
  );
  console.log(`     채널 신규 Opp ${oppsApr.length}건`);

  const oppByLeadSource = { '파트너사 소개': 0, '프랜차이즈소개': 0, '기타': 0 };
  const oppEtcSources = {};
  for (const o of oppsApr) {
    const s = o.LeadSource;
    if (s === '파트너사 소개') oppByLeadSource['파트너사 소개']++;
    else if (s === '프랜차이즈소개') oppByLeadSource['프랜차이즈소개']++;
    else {
      oppByLeadSource['기타']++;
      const key = s === null ? '(null)' : s;
      oppEtcSources[key] = (oppEtcSources[key] || 0) + 1;
    }
  }

  const newOpps = {
    total: oppsApr.length,
    by_lead_source: oppByLeadSource,
    etc_breakdown: Object.fromEntries(
      Object.entries(oppEtcSources).sort((a, b) => b[1] - a[1])
    ),
  };

  // ──────────────────────────────────────────────
  // E. Lead -> Opp 전환율 코호트 (1/2/3월, 60일 윈도우)
  // ──────────────────────────────────────────────
  console.log('\n[E] Lead -> Opp 코호트 (1/2/3월, 60일 윈도우) 조회 중...');
  const sourceList = CHANNEL_LEAD_SOURCES.map((s) => `'${s}'`).join(',');

  const conversionCohort = {};
  for (const cohort of COHORT_MONTHS) {
    const cohortLeads = await soqlQueryAll(
      instanceUrl,
      accessToken,
      `SELECT Id, CreatedDate, LeadSource, IsConverted, ConvertedDate, ConvertedOpportunityId
         FROM Lead
        WHERE CreatedDate >= ${cohort.start}
          AND CreatedDate <  ${cohort.end}
          AND LeadSource IN (${sourceList})`
    );

    const total = cohortLeads.length;
    let converted60 = 0;
    let convertedAny = 0;
    const bySrc = {};
    for (const src of CHANNEL_LEAD_SOURCES) {
      bySrc[src] = { leads: 0, convertedTo60d: 0, convertedAny: 0 };
    }

    for (const l of cohortLeads) {
      const src = l.LeadSource;
      if (bySrc[src]) bySrc[src].leads++;

      if (l.IsConverted && l.ConvertedDate) {
        convertedAny++;
        if (bySrc[src]) bySrc[src].convertedAny++;

        const created = new Date(l.CreatedDate).getTime();
        const conv = new Date(l.ConvertedDate + 'T00:00:00+09:00').getTime();
        const days = (conv - created) / (1000 * 3600 * 24);
        if (days >= 0 && days <= CONVERSION_WINDOW_DAYS) {
          converted60++;
          if (bySrc[src]) bySrc[src].convertedTo60d++;
        }
      }
    }

    conversionCohort[cohort.label] = {
      leads: total,
      convertedTo60d: converted60,
      convertedAnyTime: convertedAny,
      rate: total > 0 ? Math.round((converted60 / total) * 1000) / 10 : 0,
      bySource: Object.fromEntries(
        Object.entries(bySrc).map(([k, v]) => [
          k,
          {
            ...v,
            rate: v.leads > 0 ? Math.round((v.convertedTo60d / v.leads) * 1000) / 10 : 0,
          },
        ])
      ),
    };

    console.log(
      `     ${cohort.label}: Lead ${total}건, 60일 전환 ${converted60}건 (${conversionCohort[cohort.label].rate}%)`
    );
  }

  // ──────────────────────────────────────────────
  // F. 4월 채널 CW 태블릿 (캐시)
  // ──────────────────────────────────────────────
  console.log('\n[F] 캐시된 4월 채널 CW 태블릿 데이터 로드');
  const cwCache = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'april-channel-split-tablets-2026.json'), 'utf-8')
  );
  const cwReference = {
    source: 'data/april-channel-split-tablets-2026.json',
    totalCW: cwCache.totals.cwSignedTablets,
    partnerCW: cwCache.channel['파트너사'].cwSignedTablets,
    franchiseCW: cwCache.channel['프랜차이즈'].cwSignedTablets,
    etcCW: cwCache.channel['기타'].cwSignedTablets,
    note: '후행 지표 — Lead Gen 본질 KPI의 보조 참고용',
  };

  // ──────────────────────────────────────────────
  // 예외 룰 평가
  // ──────────────────────────────────────────────
  const exceptionRules = [];

  // CHN-01: 월간 신규 파트너사+프랜차이즈본사 등록 = 0건 -> 위험
  const chn01Sum = newAccounts['파트너사'] + newAccounts['프랜차이즈본사'];
  if (chn01Sum === 0) {
    exceptionRules.push({
      ruleId: 'CHN-01',
      level: '위험',
      condition: '월간 신규 파트너사+프랜차이즈본사 등록 = 0건',
      observed: { 파트너사: newAccounts['파트너사'], 프랜차이즈본사: newAccounts['프랜차이즈본사'] },
    });
  }

  // CHN-04: 특정 LeadSource 일주일 0건 (파트너사 소개 7일 연속 0)
  function checkSevenDayZero(daily, label) {
    const dailyMap = {};
    for (const d of daily) dailyMap[d.date] = d.count;

    const dates = [];
    let cur = new Date(PERIOD_START);
    const end = new Date(PERIOD_END);
    while (cur < end) {
      dates.push(toKstDate(cur.toISOString()));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    let maxStreak = 0;
    let curStreak = 0;
    let streakEnd = null;
    let curStreakEnd = null;
    for (const d of dates) {
      const v = dailyMap[d] || 0;
      if (v === 0) {
        curStreak++;
        curStreakEnd = d;
        if (curStreak > maxStreak) {
          maxStreak = curStreak;
          streakEnd = curStreakEnd;
        }
      } else {
        curStreak = 0;
      }
    }
    return { label, maxZeroStreak: maxStreak, endingOn: streakEnd };
  }

  const partnerStreak = checkSevenDayZero(newLeads['파트너사 소개'].daily, '파트너사 소개');
  const franchiseStreak = checkSevenDayZero(newLeads['프랜차이즈소개'].daily, '프랜차이즈소개');

  for (const s of [partnerStreak, franchiseStreak]) {
    if (s.maxZeroStreak >= 7) {
      exceptionRules.push({
        ruleId: 'CHN-04',
        level: '주의',
        condition: `${s.label} LeadSource 7일 연속 0건`,
        observed: s,
      });
    }
  }

  // ──────────────────────────────────────────────
  // QA 검증
  // ──────────────────────────────────────────────
  const qa = {
    leadTotalApr: leadsApr.length,
    leadByCategory: {
      '파트너사 소개': newLeads['파트너사 소개'].count,
      '프랜차이즈소개': newLeads['프랜차이즈소개'].count,
      '기타': newLeads['기타'].count,
    },
    accountTypeFilter: CHANNEL_ACCOUNT_TYPES,
    accountsFetched: acctsApr.length,
    franchiseStoreCount: franchiseStores.length,
    channelOppCount: oppsApr.length,
    cohortField: 'IsConverted + ConvertedDate (Lead 표준 필드)',
    leadOppLinkField: 'Lead.ConvertedOpportunityId (표준 필드 사용; LeadId__c 미사용)',
    sourceFilterCohort: CHANNEL_LEAD_SOURCES,
    zeroStreakChecks: { partnerStreak, franchiseStreak },
  };

  // ──────────────────────────────────────────────
  // 콘솔 출력
  // ──────────────────────────────────────────────
  console.log('\n' + '─'.repeat(80));
  console.log('### 표 1: 4월 신규 Lead 창출 수');
  console.log('─'.repeat(80));
  console.log(`${pad('카테고리', 20)} | ${rpad('건수', 8)}`);
  console.log('─'.repeat(80));
  console.log(`${pad('파트너사 소개 (Lead)', 20)} | ${rpad(newLeads['파트너사 소개'].count, 8)}`);
  console.log(`${pad('프랜차이즈소개 (Lead)', 20)} | ${rpad(newLeads['프랜차이즈소개'].count, 8)}`);
  console.log(`${pad('기타 (참고)', 20)} | ${rpad(newLeads['기타'].count, 8)}`);
  console.log('─'.repeat(80));
  console.log(`${pad('합계', 20)} | ${rpad(leadsApr.length, 8)}`);
  console.log('  * 기타 LeadSource Top:');
  for (const [k, v] of Object.entries(newLeads['기타'].topSources).slice(0, 5)) {
    console.log(`      - ${k}: ${v}건`);
  }

  console.log('\n' + '─'.repeat(80));
  console.log('### 표 2: 4월 신규 채널 Account 등록 수');
  console.log('─'.repeat(80));
  console.log(`${pad('Account 유형', 20)} | ${rpad('건수', 8)}`);
  console.log('─'.repeat(80));
  console.log(`${pad('파트너사', 20)} | ${rpad(newAccounts['파트너사'], 8)}`);
  console.log(`${pad('프랜차이즈본사', 20)} | ${rpad(newAccounts['프랜차이즈본사'], 8)}`);
  console.log(`${pad('브랜드', 20)} | ${rpad(newAccounts['브랜드'], 8)}`);
  console.log('─'.repeat(80));
  console.log(`${pad('합계', 20)} | ${rpad(acctsApr.length, 8)}`);

  console.log('\n' + '─'.repeat(80));
  console.log('### 표 3: 4월 신규 가맹점 연결 수');
  console.log('─'.repeat(80));
  console.log(`총 신규 가맹점: ${newFranchiseStores.total}건 (브랜드 ${newFranchiseStores.distinctBrands}개)`);
  console.log('Top 5 브랜드:');
  newFranchiseStores.topBrands.forEach((b, i) => {
    console.log(`  ${i + 1}. ${b.brand}: ${b.count}건`);
  });

  console.log('\n' + '─'.repeat(80));
  console.log('### 표 4: 4월 채널 신규 Opp 창출 수');
  console.log('─'.repeat(80));
  console.log(`${pad('LeadSource', 20)} | ${rpad('건수', 8)}`);
  console.log('─'.repeat(80));
  console.log(`${pad('파트너사 소개 (Opp)', 20)} | ${rpad(oppByLeadSource['파트너사 소개'], 8)}`);
  console.log(`${pad('프랜차이즈소개 (Opp)', 20)} | ${rpad(oppByLeadSource['프랜차이즈소개'], 8)}`);
  console.log(`${pad('기타', 20)} | ${rpad(oppByLeadSource['기타'], 8)}`);
  console.log('─'.repeat(80));
  console.log(`${pad('합계', 20)} | ${rpad(oppsApr.length, 8)}`);

  console.log('\n' + '─'.repeat(80));
  console.log('### 표 5: Lead -> Opp 60일 전환율 코호트 (파트너사 소개 + 프랜차이즈소개)');
  console.log('─'.repeat(80));
  console.log(`${pad('코호트', 12)} | ${rpad('Lead', 6)} | ${rpad('60일전환', 8)} | ${rpad('전환율', 8)} | ${rpad('전체전환', 8)}`);
  console.log('─'.repeat(80));
  for (const cohort of COHORT_MONTHS) {
    const c = conversionCohort[cohort.label];
    console.log(
      `${pad(cohort.label, 12)} | ${rpad(c.leads, 6)} | ${rpad(c.convertedTo60d, 8)} | ${rpad(c.rate + '%', 8)} | ${rpad(c.convertedAnyTime, 8)}`
    );
  }

  console.log('\n' + '─'.repeat(80));
  console.log('### 표 6: (참고) 4월 채널 CW 태블릿 — 후행 지표');
  console.log('─'.repeat(80));
  console.log(`총 CW 태블릿:      ${cwReference.totalCW}대`);
  console.log(`  파트너사:        ${cwReference.partnerCW}대`);
  console.log(`  프랜차이즈:      ${cwReference.franchiseCW}대`);
  console.log(`  기타:            ${cwReference.etcCW}대`);
  console.log(`  * ${cwReference.note}`);

  console.log('\n' + '─'.repeat(80));
  console.log('### 예외 탐지 룰');
  console.log('─'.repeat(80));
  if (exceptionRules.length === 0) {
    console.log('  발동된 룰 없음.');
  } else {
    exceptionRules.forEach((r) => {
      console.log(`  [${r.level}] ${r.ruleId}: ${r.condition}`);
      console.log(`           관측: ${JSON.stringify(r.observed)}`);
    });
  }

  // ──────────────────────────────────────────────
  // JSON 산출
  // ──────────────────────────────────────────────
  const output = {
    generatedAt: new Date().toISOString(),
    period: PERIOD,
    dataAsOf: new Date().toISOString().substring(0, 10),
    sourceFilter: {
      leadSourceCategorize: ['파트너사 소개', '프랜차이즈소개', '그 외=기타'],
      accountTypes: CHANNEL_ACCOUNT_TYPES,
      ownerDepartmentsForOpp: CHANNEL_DEPTS,
      cohortConversionWindowDays: CONVERSION_WINDOW_DAYS,
      cohortLeadSources: CHANNEL_LEAD_SOURCES,
    },
    newLeads,
    newAccounts,
    newFranchiseStores,
    newOpps,
    conversionCohort,
    cwReference,
    exceptionRules,
    qa,
  };

  const outPath = path.join(DATA_DIR, 'april-channel-leadgen-2026.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n[저장] ${outPath}`);
}

main().catch((e) => {
  console.error('Error:', e.message);
  if (e.response?.data) console.error(JSON.stringify(e.response.data, null, 2));
  process.exit(1);
});
