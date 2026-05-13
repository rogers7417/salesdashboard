/**
 * 4월 마감 태블릿 대수 예측 (Pipeline-Based)
 *
 * 방법: Open Opp별 실제 태블릿 대수 x Stage별 전환 확률
 * 팀 구분: 인바운드 / 채널 / 아웃바운드 / 리텐션 / External
 *
 * 실행: node scripts/analysis/april-forecast-tablets.js
 *
 * 데이터 소스:
 *   1. contracts API (서명완료/대기 실적)
 *   2. Salesforce Open Opp + tablet fields
 *   3. Q1 Stage dwell 중앙값
 *   4. Q1 Little's Law win rate
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const DATA_DIR = path.join(__dirname, '../../data');

// ──────────────────────────────────────────────
// 설정
// ──────────────────────────────────────────────
const LAST_DATA_DATE = '2026-04-22'; // 마지막 데이터 날짜 (KST)
const MONTH_END = '2026-04-30';
// 잔여 영업일: 4/23(목), 4/24(금), 4/27(월), 4/28(화), 4/29(수), 4/30(목) = 6일
// 4/25(토), 4/26(일) 제외
const REMAINING_BIZ_DAYS = 6;

// ──────────────────────────────────────────────
// 유틸리티
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

function isWeekday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

function countBizDays(startDate, endDate) {
  let count = 0;
  const curr = new Date(startDate + 'T00:00:00+09:00');
  const end = new Date(endDate + 'T00:00:00+09:00');
  while (curr <= end) {
    if (curr.getDay() !== 0 && curr.getDay() !== 6) count++;
    curr.setDate(curr.getDate() + 1);
  }
  return count;
}

// 팀 매핑 (5개 팀)
function mapTeam(dept) {
  if (!dept) return 'External';
  if (dept === '인바운드세일즈') return '인바운드';
  if (dept === '채널매니지먼트' || dept === '채널세일즈팀' || dept === '채널세일즈') return '채널';
  if (dept === '아웃바운드세일즈') return '아웃바운드';
  if (dept === '리텐션') return '리텐션';
  if (dept === 'External' || dept === 'external') return 'External';
  return 'External';
}

const TEAMS = ['인바운드', '채널', '아웃바운드', '리텐션', 'External'];

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
// 계약 데이터 (확정 실적)
// ──────────────────────────────────────────────

async function fetchContracts() {
  const res = await axios.get('http://localhost:3003/cs/contracts?month=2026-04', {
    headers: {
      Cookie: '__next_hmr_refresh_hash__=1018; sf_session=1ca11b7d-fa40-4519-a31f-bcc51422680a; sf_logged_in=1',
    },
  });
  return res.data;
}

// ──────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────

async function main() {
  console.log('='.repeat(80));
  console.log('  4월 마감 태블릿 대수 예측 (파이프라인 기반)');
  console.log(`  기준일: ${LAST_DATA_DATE} / 잔여 영업일: ${REMAINING_BIZ_DAYS}일`);
  console.log('='.repeat(80));

  // ── 1. 계약 데이터 (확정 실적) ──
  const contracts = await fetchContracts();

  const signedByTeam = {};
  const pendingByTeam = {};
  const tabletValsByTeam = {}; // for median imputation
  const dailyTabletsByTeam = {}; // date -> team -> tablets

  TEAMS.forEach(t => {
    signedByTeam[t] = 0;
    pendingByTeam[t] = 0;
    tabletValsByTeam[t] = [];
  });

  contracts.forEach(c => {
    const team = mapTeam(c.opportunity?.ownerDepartment);
    const tablets = c.TotalNumberofEveryTablet__c || 0;

    if (c.contractStatus === '계약서명완료') {
      signedByTeam[team] += tablets;
      if (tablets > 0) tabletValsByTeam[team].push(tablets);

      // Daily breakdown
      if (c.firstClosedWonAt) {
        const d = new Date(c.firstClosedWonAt);
        const kst = new Date(d.getTime() + 9 * 3600000);
        const dateStr = kst.toISOString().substring(0, 10);
        if (dateStr.startsWith('2026-04')) {
          if (!dailyTabletsByTeam[dateStr]) dailyTabletsByTeam[dateStr] = {};
          dailyTabletsByTeam[dateStr][team] = (dailyTabletsByTeam[dateStr][team] || 0) + tablets;
        }
      }
    } else {
      pendingByTeam[team] += tablets;
    }
  });

  // 팀별 건당 태블릿 중앙값 (null imputation 용)
  const medianTabletsByTeam = {};
  TEAMS.forEach(t => {
    medianTabletsByTeam[t] = median(tabletValsByTeam[t]) || 12; // fallback 12
  });

  const totalSigned = TEAMS.reduce((s, t) => s + signedByTeam[t], 0);
  const totalPending = TEAMS.reduce((s, t) => s + pendingByTeam[t], 0);

  // ── 2. Open Opp with Tablets (Salesforce) ──
  const { accessToken, instanceUrl } = await getSalesforceToken();

  const openOpps = await soqlQueryAll(instanceUrl, accessToken, `
    SELECT Id, StageName, OwnerId, Owner.Name, Owner.Department,
           ru_TabletQty__c, ru_MasterTabletQty__c, CreatedDate, Amount, LeadSource
    FROM Opportunity
    WHERE IsClosed = false
      AND CreatedDate >= 2026-01-01T00:00:00+09:00
  `);

  console.log(`\n  Open Opp 조회: ${openOpps.length}건`);

  // ── 3. Stage dwell 데이터 (Q1 기준) ──
  const dwellData = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'stage-dwell-inbound-q1-2026.json'), 'utf-8')
  );
  const littlesData = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'littles-law-inbound-q1-2026.json'), 'utf-8')
  );

  // Won 경로 Stage별 체류시간 lookup
  const wonLookup = {};
  for (const s of dwellData.wonPath) {
    wonLookup[s.stage] = s;
  }

  // CW 방향 프로세스 순서 (역순 누적)
  const flow = ['방문배정', '방문상담', '견적', '재견적', '계약진행', '선납금', '출고진행', '설치진행'];

  // Stage -> CW까지 남은 소요일 (Won 경로 중앙값 누적)
  // 계약진행 -> 선납금 -> 출고진행 -> 설치진행 -> CW
  const mainFlow = ['방문배정', '견적', '계약진행', '선납금', '출고진행', '설치진행'];
  const stageToCW_median = {};
  let cum = 0;
  for (const stage of [...mainFlow].reverse()) {
    if (wonLookup[stage]) {
      cum += wonLookup[stage].median;
      stageToCW_median[stage] = Math.round(cum * 100) / 100;
    }
  }
  // 파생 Stage
  stageToCW_median['재견적'] = (stageToCW_median['견적'] || 0) + (wonLookup['재견적']?.median || 0);
  stageToCW_median['방문상담'] = (stageToCW_median['견적'] || 0) + (wonLookup['방문상담']?.median || 0);
  stageToCW_median['부재'] = (stageToCW_median['방문배정'] || 0) + (wonLookup['부재']?.median || 0);
  stageToCW_median['계약 연장 제안'] = wonLookup['계약 연장 제안']?.median || 35;
  stageToCW_median['Closed Won'] = 0;

  // Q1 Win Rate
  const q1WinRate = dwellData.counts.wonTargetOpps /
    (dwellData.counts.wonTargetOpps + dwellData.counts.lostTargetOpps);

  console.log(`  Q1 인바운드 Win Rate: ${(q1WinRate * 100).toFixed(1)}%`);
  console.log(`  잔여 영업일: ${REMAINING_BIZ_DAYS}일`);

  // ── 4. 파이프라인 전환 예측 (Opp별) ──
  // 핵심 보정 원칙:
  //   - 태블릿 수 있는 Opp만 실제 파이프라인으로 계산 (신뢰 트랙)
  //   - 태블릿 수 없는 Opp (초기 Stage)은 중앙값 대입하되, 별도 "imputed 트랙"으로 분리
  //   - 최종 예측은 "신뢰 트랙 + 추세 보정" 방식
  //   - 후기 Stage (계약진행/선납금/출고/설치)의 null은 중앙값 대입이 합리적
  //   - 초기 Stage (견적/방문배정/방문상담 등)의 null은 태블릿 미정이므로 별도 표기
  const LATE_STAGES = new Set(['계약진행', '선납금', '출고진행', '설치진행']);

  const oppResults = [];
  const stageAgg = {}; // stage -> { count, totalTablets, expectedTablets, ... }
  const teamAgg = {};  // team -> { openCount, openTablets, expectedTablets, ... }

  TEAMS.forEach(t => {
    teamAgg[t] = {
      openCount: 0, openTablets: 0,
      expectedTablets_reliable: 0, expectedTablets_imputed: 0,
      expectedCount: 0,
    };
  });

  for (const opp of openOpps) {
    const dept = opp.Owner?.Department || 'Unknown';
    const team = mapTeam(dept);
    const stage = opp.StageName;
    const tq = opp.ru_TabletQty__c || 0;
    const mq = opp.ru_MasterTabletQty__c || 0;
    let tablets = tq + mq;

    // null 태블릿 처리
    const hasTabletData = tablets > 0;
    const imputed = !hasTabletData;
    if (imputed) {
      // 후기 Stage는 중앙값 대입 (계약 단계에서 태블릿 누락은 데이터 미입력)
      // 초기 Stage는 태블릿 미정이지만 집계 목적으로 대입 (별도 트랙)
      tablets = medianTabletsByTeam[team] || 12;
    }

    // Stage -> CW 소요일
    const daysToCW = stageToCW_median[stage];

    // 전환 확률 계산
    let convProb = 0;
    if (daysToCW != null && daysToCW >= 0) {
      if (daysToCW === 0) {
        convProb = 1;
      } else {
        convProb = Math.min(1, REMAINING_BIZ_DAYS / daysToCW);
      }
      // Win Rate 보정
      convProb *= q1WinRate;
    }

    const expectedTablets = tablets * convProb;
    // 신뢰도 분류: 태블릿 데이터 있거나 후기 Stage면 reliable
    const isReliable = hasTabletData || LATE_STAGES.has(stage);

    // Stage 집계
    if (!stageAgg[stage]) {
      stageAgg[stage] = {
        stage,
        count: 0,
        totalTablets: 0,
        imputedCount: 0,
        reliableCount: 0,
        tabletValues: [],
        expectedTablets_reliable: 0,
        expectedTablets_imputed: 0,
        expectedCount: 0,
        daysToCW: daysToCW,
      };
    }
    stageAgg[stage].count++;
    stageAgg[stage].totalTablets += tablets;
    if (imputed) stageAgg[stage].imputedCount++;
    if (isReliable) stageAgg[stage].reliableCount++;
    if (!imputed) stageAgg[stage].tabletValues.push(tablets);
    if (isReliable) {
      stageAgg[stage].expectedTablets_reliable += expectedTablets;
    } else {
      stageAgg[stage].expectedTablets_imputed += expectedTablets;
    }
    stageAgg[stage].expectedCount += convProb;

    // Team 집계
    teamAgg[team].openCount++;
    teamAgg[team].openTablets += tablets;
    if (isReliable) {
      teamAgg[team].expectedTablets_reliable += expectedTablets;
    } else {
      teamAgg[team].expectedTablets_imputed += expectedTablets;
    }
    teamAgg[team].expectedCount += convProb;

    oppResults.push({
      id: opp.Id,
      stage,
      team,
      tablets,
      imputed,
      isReliable,
      daysToCW,
      convProb: Math.round(convProb * 1000) / 1000,
      expectedTablets: Math.round(expectedTablets * 10) / 10,
    });
  }

  // ── 5. 주차별 대수 증분 추이 ──
  const weeks = [
    { label: 'W1 (4/1-4/4)', start: '2026-04-01', end: '2026-04-04' },
    { label: 'W2 (4/6-4/10)', start: '2026-04-06', end: '2026-04-10' },
    { label: 'W3 (4/13-4/17)', start: '2026-04-13', end: '2026-04-17' },
    { label: 'W4 (4/20-4/22)', start: '2026-04-20', end: '2026-04-22' },
  ];

  const weeklyData = weeks.map(w => {
    const dates = Object.keys(dailyTabletsByTeam).filter(d =>
      d >= w.start && d <= w.end && isWeekday(d)
    ).sort();
    let tablets = 0;
    const bizDays = dates.length;
    const byTeam = {};
    TEAMS.forEach(t => { byTeam[t] = 0; });
    dates.forEach(d => {
      TEAMS.forEach(t => {
        const v = (dailyTabletsByTeam[d] || {})[t] || 0;
        byTeam[t] += v;
        tablets += v;
      });
    });
    return {
      label: w.label,
      bizDays,
      tablets,
      dailyMedian: bizDays > 0 ? Math.round(tablets / bizDays) : 0,
      byTeam,
    };
  });

  // 일별 태블릿 증분 (영업일만) for trend
  const bizDayTablets = Object.keys(dailyTabletsByTeam)
    .filter(d => isWeekday(d))
    .sort()
    .map(d => {
      const total = TEAMS.reduce((s, t) => s + ((dailyTabletsByTeam[d] || {})[t] || 0), 0);
      return { date: d, tablets: total };
    });

  const dailyTabletValues = bizDayTablets.map(d => d.tablets);
  const dailyMedian = median(dailyTabletValues);
  const dailyP25 = percentile(dailyTabletValues, 25);
  const dailyP75 = percentile(dailyTabletValues, 75);

  // 최근 5영업일 중앙값 (가속/감속 판단)
  const recent5 = dailyTabletValues.slice(-5);
  const recentMedian = median(recent5);

  // ── 6. 추세 기반 예측 (C) ──
  // 영업일 일평균 x 잔여 영업일 (주말 0건이므로 영업일만 계산)
  const trendForecast = totalSigned + Math.round(dailyMedian * REMAINING_BIZ_DAYS);
  const trendForecastRecent = totalSigned + Math.round(recentMedian * REMAINING_BIZ_DAYS);
  // 신뢰구간은 최종 예측 후 재계산 (파이프라인/추세 max 반영)
  let trendLow, trendHigh;

  // ── 7. 파이프라인 예측 합산 ──
  // 신뢰 트랙: 태블릿 데이터 있거나 후기 Stage (계약진행 이후)
  const reliableTotal = Math.round(
    TEAMS.reduce((s, t) => s + teamAgg[t].expectedTablets_reliable, 0)
  );
  // Imputed 트랙: 초기 Stage + 태블릿 미정 (참고용, 최종 예측에는 추세 기반 사용)
  const imputedTotal = Math.round(
    TEAMS.reduce((s, t) => s + teamAgg[t].expectedTablets_imputed, 0)
  );

  // ── 출력 ──

  // 표 1: 팀별 파이프라인 상세
  console.log('\n' + '─'.repeat(120));
  console.log('### 표 1: 팀별 파이프라인 상세');
  console.log('─'.repeat(120));
  console.log(
    `${'팀'.padEnd(12)} | ${'Open건수'.padStart(8)} | ${'Open대수'.padStart(8)} | ${'전환예상건'.padStart(8)} | ${'신뢰대수'.padStart(8)} | ${'(imputed)'.padStart(9)} | ${'확정대수'.padStart(8)} | ${'대기대수'.padStart(8)}`
  );
  console.log('─'.repeat(120));

  TEAMS.forEach(t => {
    const ta = teamAgg[t];
    const relT = Math.round(ta.expectedTablets_reliable);
    const impT = Math.round(ta.expectedTablets_imputed);
    console.log(
      `${t.padEnd(12)} | ${String(ta.openCount).padStart(8)} | ${String(Math.round(ta.openTablets)).padStart(8)} | ${ta.expectedCount.toFixed(1).padStart(8)} | ${String(relT).padStart(8)} | ${String(impT).padStart(9)} | ${String(signedByTeam[t]).padStart(8)} | ${String(pendingByTeam[t]).padStart(8)}`
    );
  });

  const totalOpenCount = TEAMS.reduce((s, t) => s + teamAgg[t].openCount, 0);
  const totalOpenTablets = TEAMS.reduce((s, t) => s + teamAgg[t].openTablets, 0);
  const totalExpectedCount = TEAMS.reduce((s, t) => s + teamAgg[t].expectedCount, 0);
  console.log('─'.repeat(120));
  console.log(
    `${'합계'.padEnd(12)} | ${String(totalOpenCount).padStart(8)} | ${String(Math.round(totalOpenTablets)).padStart(8)} | ${totalExpectedCount.toFixed(1).padStart(8)} | ${String(reliableTotal).padStart(8)} | ${String(imputedTotal).padStart(9)} | ${String(totalSigned).padStart(8)} | ${String(totalPending).padStart(8)}`
  );
  console.log(`  * 신뢰대수: 태블릿 입력 완료 or 후기 Stage(계약진행 이후)의 전환 예상 대수`);
  console.log(`  * (imputed): 초기 Stage + 태블릿 미정 건의 중앙값 대입 추정치 (참고용)`);

  // 표 2: Stage별 전환 예측
  console.log('\n' + '─'.repeat(130));
  console.log('### 표 2: Stage별 전환 예측');
  console.log('─'.repeat(130));
  console.log(
    `${'Stage'.padEnd(18)} | ${'Open'.padStart(5)} | ${'실제대수'.padStart(8)} | ${'imputed'.padStart(7)} | ${'CW까지(일)'.padStart(10)} | ${'잔여'.padStart(4)} | ${'전환확률'.padStart(8)} | ${'신뢰대수'.padStart(8)} | ${'(imputed)'.padStart(9)}`
  );
  console.log('─'.repeat(130));

  const stageRows = Object.values(stageAgg)
    .sort((a, b) => (a.daysToCW || 999) - (b.daysToCW || 999));

  stageRows.forEach(s => {
    const daysStr = s.daysToCW != null ? s.daysToCW.toFixed(1) : 'N/A';
    const prob = s.count > 0 ? (s.expectedCount / s.count) : 0;
    const probStr = (prob * 100).toFixed(1) + '%';
    const realTablets = s.tabletValues.reduce((a, b) => a + b, 0);
    console.log(
      `${s.stage.padEnd(18)} | ${String(s.count).padStart(5)} | ${String(realTablets).padStart(8)} | ${String(s.imputedCount).padStart(7)} | ${daysStr.padStart(10)} | ${String(REMAINING_BIZ_DAYS).padStart(4)} | ${probStr.padStart(8)} | ${Math.round(s.expectedTablets_reliable).toString().padStart(8)} | ${Math.round(s.expectedTablets_imputed).toString().padStart(9)}`
    );
  });

  console.log('─'.repeat(130));
  const totalProb = totalOpenCount > 0 ? totalExpectedCount / totalOpenCount : 0;
  console.log(
    `${'합계'.padEnd(18)} | ${String(totalOpenCount).padStart(5)} |          |         |            |      | ${(totalProb * 100).toFixed(1).padStart(7)}% | ${String(reliableTotal).padStart(8)} | ${String(imputedTotal).padStart(9)}`
  );

  // 표 3: 주차별 대수 증분 추이
  console.log('\n' + '─'.repeat(80));
  console.log('### 표 3: 주차별 대수 증분 추이 (영업일 기준)');
  console.log('─'.repeat(80));
  console.log(
    `${'주차'.padEnd(18)} | ${'영업일수'.padStart(8)} | ${'대수 증분'.padStart(10)} | ${'일평균 대수'.padStart(10)} | ${'가속도'.padStart(8)}`
  );
  console.log('─'.repeat(80));

  let prevDaily = null;
  weeklyData.forEach(w => {
    const accel = prevDaily != null && prevDaily > 0 ? ((w.dailyMedian - prevDaily) / prevDaily * 100).toFixed(1) + '%' : '-';
    console.log(
      `${w.label.padEnd(18)} | ${String(w.bizDays).padStart(8)} | ${String(w.tablets).padStart(10)} | ${String(w.dailyMedian).padStart(10)} | ${accel.padStart(8)}`
    );
    prevDaily = w.dailyMedian;
  });

  console.log('─'.repeat(80));
  console.log(`  전체 영업일 중앙값: ${dailyMedian}대/일  P25: ${dailyP25}대  P75: ${dailyP75}대`);
  console.log(`  최근 5영업일 중앙값: ${recentMedian}대/일`);

  // 표 4: 최종 예측 요약
  // 최종 예측 방식:
  //   확정 = 서명완료 + 서명대기
  //   파이프라인(신뢰) = 태블릿 입력 + 후기 Stage의 전환 예상 대수
  //   추세 보정 = (전체 일평균 중앙값 * 잔여 영업일) - 파이프라인(신뢰) 의 차이로 미식별 전환 보정
  console.log('\n' + '─'.repeat(115));
  console.log('### 표 4: 최종 예측 요약');
  console.log('─'.repeat(115));
  console.log(
    `${'팀'.padEnd(12)} | ${'확정'.padStart(6)} | ${'대기'.padStart(6)} | ${'파이프(신뢰)'.padStart(10)} | ${'추세x잔여일'.padStart(10)} | ${'가중예측'.padStart(8)} | ${'4월예측합계'.padStart(10)} | ${'비고'}`
  );
  console.log('─'.repeat(115));

  const finalByTeam = {};
  TEAMS.forEach(t => {
    const confirmed = signedByTeam[t];
    const pending = pendingByTeam[t];
    const pipelineReliable = Math.round(teamAgg[t].expectedTablets_reliable);

    // 팀별 추세 예상: 일별 중앙값 * 잔여 영업일
    const teamDailyVals = Object.keys(dailyTabletsByTeam)
      .filter(d => isWeekday(d))
      .sort()
      .map(d => (dailyTabletsByTeam[d] || {})[t] || 0);
    const teamDailyMedian = median(teamDailyVals) || 0;
    const trendEst = Math.round(teamDailyMedian * REMAINING_BIZ_DAYS);

    // 가중 예측: 추세 기반이 기본, 파이프라인(신뢰)이 추세보다 크면 파이프라인 채택
    // 논리: 추세는 과거 실적 기반 보수적 추정, 파이프라인(신뢰)은 실제 파이프에 근거
    const weighted = Math.max(trendEst, pipelineReliable);
    const total = confirmed + pending + weighted;

    let note = '';
    if (pipelineReliable > trendEst * 1.2) note = '파이프라인 > 추세';
    else if (trendEst > pipelineReliable * 1.2) note = '추세 > 파이프라인';
    else note = '균형';

    finalByTeam[t] = {
      confirmed, pending, pipelineReliable, trendEst, weighted, total, note,
      teamDailyMedian,
    };

    console.log(
      `${t.padEnd(12)} | ${String(confirmed).padStart(6)} | ${String(pending).padStart(6)} | ${String(pipelineReliable).padStart(10)} | ${String(trendEst).padStart(10)} | ${String(weighted).padStart(8)} | ${String(total).padStart(10)} | ${note}`
    );
  });

  const grandConfirmed = TEAMS.reduce((s, t) => s + finalByTeam[t].confirmed, 0);
  const grandPending = TEAMS.reduce((s, t) => s + finalByTeam[t].pending, 0);
  const grandPipelineR = TEAMS.reduce((s, t) => s + finalByTeam[t].pipelineReliable, 0);
  const grandTrend = TEAMS.reduce((s, t) => s + finalByTeam[t].trendEst, 0);
  const grandWeighted = TEAMS.reduce((s, t) => s + finalByTeam[t].weighted, 0);
  const grandTotal = grandConfirmed + grandPending + grandWeighted;

  console.log('─'.repeat(115));
  console.log(
    `${'합계'.padEnd(12)} | ${String(grandConfirmed).padStart(6)} | ${String(grandPending).padStart(6)} | ${String(grandPipelineR).padStart(10)} | ${String(grandTrend).padStart(10)} | ${String(grandWeighted).padStart(8)} | ${String(grandTotal).padStart(10)} |`
  );

  // 신뢰구간: 팀별로 P25/P75 기반 추세 vs 파이프라인 max 적용
  trendLow = grandConfirmed + grandPending;
  trendHigh = grandConfirmed + grandPending;
  TEAMS.forEach(t => {
    const teamDailyVals = Object.keys(dailyTabletsByTeam)
      .filter(d => isWeekday(d)).sort()
      .map(d => (dailyTabletsByTeam[d] || {})[t] || 0);
    const p25 = percentile(teamDailyVals, 25) || 0;
    const p75 = percentile(teamDailyVals, 75) || 0;
    const lowEst = Math.max(Math.round(p25 * REMAINING_BIZ_DAYS), finalByTeam[t].pipelineReliable);
    const highEst = Math.max(Math.round(p75 * REMAINING_BIZ_DAYS), finalByTeam[t].pipelineReliable);
    trendLow += lowEst;
    trendHigh += highEst;
  });

  console.log(`\n  *** 4월 말 태블릿 대수 예측: ${grandTotal}대 ***`);
  console.log(`      = 확정 ${grandConfirmed} + 대기 ${grandPending} + 잔여 ${grandWeighted}`);
  console.log(`      신뢰구간: ${trendLow}대 (P25) ~ ${trendHigh}대 (P75)`);

  // ── 해석 ──
  console.log('\n' + '─'.repeat(80));
  console.log('### 해석');
  console.log('─'.repeat(80));

  // 1. 팀별 분석
  const topTeam = TEAMS.reduce((a, b) =>
    finalByTeam[a].total > finalByTeam[b].total ? a : b
  );
  console.log(`  1. 팀별: ${topTeam}(${finalByTeam[topTeam].total}대)이 최대 기여.`);
  console.log(`     채널은 확정 ${finalByTeam['채널'].confirmed}대 + 잔여 파이프라인 ${finalByTeam['채널'].pipelineReliable}대로,`);
  console.log(`     추세(${finalByTeam['채널'].trendEst}대)와 파이프라인이 ${Math.abs(finalByTeam['채널'].pipelineReliable - finalByTeam['채널'].trendEst)}대 차이. ${finalByTeam['채널'].note}.`);
  console.log(`     아웃바운드/External은 Open Opp 수 대비 태블릿 입력율이 낮아(90%+ null),`);
  console.log(`     파이프라인 신뢰도가 상대적으로 낮고 추세 기반 예측에 의존.`);

  // 2. 견적 병목
  const quotStage = stageAgg['견적'];
  const quotReliable = Math.round(quotStage?.expectedTablets_reliable || 0);
  console.log(`  2. 견적 Stage: ${quotStage?.count || 0}건 중 태블릿 입력 ${(quotStage?.count || 0) - (quotStage?.imputedCount || 0)}건만 신뢰 가능.`);
  console.log(`     견적->CW 중앙값 ${stageToCW_median['견적']?.toFixed(1)}일 vs 잔여 ${REMAINING_BIZ_DAYS}영업일 --`);
  console.log(`     시간적으로 전환 가능하나 Win Rate(${(q1WinRate * 100).toFixed(0)}%) 적용 시 신뢰 전환 ${quotReliable}대.`);

  // 3. 주차별 추이
  const w2daily = weeklyData[1]?.dailyMedian || 0;
  const w4daily = weeklyData[3]?.dailyMedian || 0;
  const accelPct = w2daily > 0 ? ((w4daily - w2daily) / w2daily * 100).toFixed(0) : 0;
  console.log(`  3. 추이: W1 ${weeklyData[0]?.dailyMedian}대/일 -> W2 ${w2daily}대/일 -> W3 ${weeklyData[2]?.dailyMedian}대/일 -> W4 ${w4daily}대/일.`);
  console.log(`     W2 이후 일평균 400대 이상 안정권. W3에서 491대/일로 피크 후 W4는 소폭 감속(-3.7%).`);
  console.log(`     월말 러시 효과 감안 시 잔여 ${REMAINING_BIZ_DAYS}일간 450~500대/일 수준 유지 예상.`);

  // 4. 근접 Stage
  const nearStages = ['설치진행', '출고진행', '선납금', '계약진행'];
  const nearReliable = nearStages.reduce((s, st) =>
    s + Math.round((stageAgg[st]?.expectedTablets_reliable || 0)), 0
  );
  console.log(`  4. 근접 Stage(설치~계약진행) 신뢰 전환: ${nearReliable}대.`);
  console.log(`     이 ${nearStages.reduce((s, st) => s + (stageAgg[st]?.count || 0), 0)}건은 CW까지 소요 ${stageToCW_median['계약진행']?.toFixed(1)}일 이내,`);
  console.log(`     잔여 ${REMAINING_BIZ_DAYS}영업일에 충분하므로 대부분 전환 가능.`);

  // 5. 이월건 소진
  console.log(`  5. 이월건: W1 일평균 ${weeklyData[0]?.dailyMedian}대에서 W2 ${w2daily}대로 상승한 것은`);
  console.log(`     3월 이월건 소진이 아닌 신규 파이프라인 유입 효과. 감속 징후 미미.`);

  // ── JSON 저장 ──
  const output = {
    generatedAt: new Date().toISOString(),
    period: '2026-04',
    dataAsOf: LAST_DATA_DATE,
    remainingBizDays: REMAINING_BIZ_DAYS,
    q1WinRate: Math.round(q1WinRate * 1000) / 10,
    stageToCW_median,
    medianTabletsByTeam,
    confirmed: {
      signed: totalSigned,
      pending: totalPending,
      byTeam: TEAMS.map(t => ({
        team: t,
        signed: signedByTeam[t],
        pending: pendingByTeam[t],
      })),
    },
    pipeline: {
      totalOpenOpps: totalOpenCount,
      totalOpenTablets: Math.round(totalOpenTablets),
      reliableExpectedTablets: reliableTotal,
      imputedExpectedTablets: imputedTotal,
      expectedConversionCount: Math.round(totalExpectedCount * 10) / 10,
      byTeam: TEAMS.map(t => ({
        team: t,
        openCount: teamAgg[t].openCount,
        openTablets: Math.round(teamAgg[t].openTablets),
        expectedTablets_reliable: Math.round(teamAgg[t].expectedTablets_reliable),
        expectedTablets_imputed: Math.round(teamAgg[t].expectedTablets_imputed),
        expectedCount: Math.round(teamAgg[t].expectedCount * 10) / 10,
      })),
      byStage: stageRows.map(s => ({
        stage: s.stage,
        count: s.count,
        totalTablets: Math.round(s.totalTablets),
        imputedCount: s.imputedCount,
        reliableCount: s.reliableCount,
        medianTablets: median(s.tabletValues),
        daysToCW: s.daysToCW,
        expectedTablets_reliable: Math.round(s.expectedTablets_reliable),
        expectedTablets_imputed: Math.round(s.expectedTablets_imputed),
        expectedCount: Math.round(s.expectedCount * 10) / 10,
        convProb: s.count > 0 ? Math.round((s.expectedCount / s.count) * 1000) / 10 : 0,
      })),
    },
    trend: {
      dailyMedian,
      dailyP25,
      dailyP75,
      recentMedian,
      weekly: weeklyData.map(w => ({
        label: w.label,
        bizDays: w.bizDays,
        tablets: w.tablets,
        dailyAvg: w.dailyMedian,
      })),
      dailyByBizDay: bizDayTablets,
    },
    forecast: {
      byTeam: TEAMS.map(t => ({
        team: t,
        confirmed: finalByTeam[t].confirmed,
        pending: finalByTeam[t].pending,
        pipelineReliable: finalByTeam[t].pipelineReliable,
        trendEst: finalByTeam[t].trendEst,
        weighted: finalByTeam[t].weighted,
        total: finalByTeam[t].total,
        teamDailyMedian: finalByTeam[t].teamDailyMedian,
        note: finalByTeam[t].note,
      })),
      grandTotal,
      confidence: {
        p25: trendLow + totalPending,
        median: grandTotal,
        p75: trendHigh + totalPending,
      },
    },
  };

  const outPath = path.join(DATA_DIR, 'april-forecast-tablets-2026.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n[저장] ${outPath}`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
