/**
 * 리틀의 법칙 (Little's Law) 분석 - 인바운드 Q1 2026
 *
 * L = λ × W
 *   L: 평균 Open Opportunity 수 (월초/월말 스냅샷 평균)
 *   λ: 월별 CW(Closed Won) 건수 (throughput)
 *   W: L/λ (평균 리드타임, 월 단위)
 *
 * 인바운드 정의: Opportunity.LeadSource != '아웃바운드' (NULL 포함)
 * 기간: 2026-01-01 ~ 2026-03-31
 *
 * ★ 중요: CloseDate 사용 금지 (영업 수동 변경 가능해 신뢰도 낮음)
 *   → OpportunityFieldHistory.Field='StageName' AND NewValue='Closed Won'의
 *     CreatedDate를 "wonAt"로 사용. 여러 번 Won 전환됐으면 가장 최근 값.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const sf = require('../../dashboard/backend/services/salesforce');

// -------------- 공통 유틸 --------------

function pad2(n) { return String(n).padStart(2, '0'); }

function kstDateStr(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}`; }

function monthLastDay(year, month) {
  return new Date(year, month, 0).getDate();
}

// KST 00:00:00 (또는 23:59:59)를 UTC ISO8601로 변환 (SOQL DateTime용)
function kstToUTCIso(year, month, day, endOfDay = false) {
  if (endOfDay) {
    // KST 23:59:59 → UTC 14:59:59 (당일)
    return new Date(Date.UTC(year, month - 1, day, 14, 59, 59)).toISOString();
  }
  // KST 00:00:00 → UTC 15:00:00 (전날)
  return new Date(Date.UTC(year, month - 1, day - 1, 15, 0, 0)).toISOString();
}

function percentile(sortedArr, p) {
  if (!sortedArr || sortedArr.length === 0) return null;
  if (sortedArr.length === 1) return sortedArr[0];
  const idx = (sortedArr.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] * (1 - (idx - lo)) + sortedArr[hi] * (idx - lo);
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}

function round(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

// -------------- 데이터 수집 --------------

// 인바운드 Opportunity 공통 필터
const INBOUND_FILTER = `(LeadSource = NULL OR LeadSource != '아웃바운드')`;

// 주의: OpportunityFieldHistory의 NewValue/OldValue는 SOQL에서 filterable하지 않다.
// Field는 filterable이므로 Field='StageName' 필터까지만 SOQL에서 하고,
// NewValue 값 매칭은 메모리에서 처리한다.

/**
 * 3) Opp IN (…) 으로 필터링 - 인바운드만 남기기 위한 메타 조회
 */
async function fetchOppsByIds(oppIds) {
  if (oppIds.length === 0) return [];
  const chunkSize = 200;
  const all = [];
  for (let i = 0; i < oppIds.length; i += chunkSize) {
    const chunk = oppIds.slice(i, i + chunkSize);
    const inList = chunk.map(id => `'${id}'`).join(',');
    const soql = `
      SELECT Id, CreatedDate, CloseDate, IsClosed, IsWon, StageName, Amount, LeadSource, OwnerId
      FROM Opportunity
      WHERE Id IN (${inList})
    `.replace(/\s+/g, ' ').trim();
    const res = await sf.queryAll(soql);
    all.push(...res);
  }
  return all;
}

/**
 * 4) 스냅샷 시점 Open 인바운드 Opp 건수
 *
 *   Open 정의 (StageName 전환 기반):
 *     - CreatedDate <= snapshot  (그 시점에 이미 존재)
 *     - AND: 그 시점까지 아직 Closed Won/Lost로 전환되지 않음
 *
 *   SOQL로는 History 기반 "아직 Won/Lost 안 된" 판정을 한 번에 못 하므로,
 *   아래 전략 사용:
 *     a. snapshot 이전에 CreatedDate인 인바운드 Opp 전체 조회
 *        (IsClosed=false 현재형 + 과거 어느 시점에 Closed됐던 것도 모두 포함)
 *     b. 해당 Opp들의 StageName History를 조회해, snapshot 시점 이전까지
 *        Won/Lost 전환이 있었는지 판정
 *
 *   그러나 이 방식은 쿼리량이 매우 커진다. 팀장 지시상 조건은:
 *     L(평균 Open): CreatedDate <= snapshot
 *                   AND (wonAt == null OR wonAt > snapshot)
 *                   AND (IsClosed=false 또는 wonAt이 snapshot 이후 발생)
 *   → 즉, Won 기준으로만 "아직 안 닫힘"을 판정. Lost는 별도 처리 안 함.
 *     (Lost된 건은 "그 시점에 Open이었을 수도 있지만 이미 탈락"이므로 포함/제외 논쟁)
 *
 *   해석:
 *     팀장 원문 "IsClosed=false이거나 wonAt이 snapshot 이후에 발생"을 따르면,
 *     wonAt이 없는(=Lost이거나 아직 Open) 건도 CreatedDate <= snapshot이면 Open으로 카운트.
 *     즉 Lost된 건도 Open으로 잡힌다 → 이건 실무상 어색.
 *
 *   절충안: wonAt 기반 L 계산을 팀장 정의대로 수행하되,
 *     lostAt까지 고려한 "순수 Open(아직 Won/Lost 전환 없음)" 보조 지표도 함께 산출.
 *
 *   구현:
 *     모든 과거 인바운드 Opp(CreatedDate <= max(snapshots))와
 *     그 Opp들의 Won/Lost 전환 이력을 한 번에 수집 후, 메모리에서 판정.
 */

/**
 * Q1 스냅샷들에 걸쳐 Open 상태 후보가 될 수 있는 모든 인바운드 Opp 수집.
 * 조건: CreatedDate < 2026-04-01 KST
 *       (Q1 중 어떤 스냅샷이든 존재 가능했던 모든 건)
 * 실무상 너무 많으니 상한 필요 - 충분히 과거로만 올라가되, 인바운드 필터 적용.
 * AgeInDays 한도 없이 가기엔 너무 무겁다 → CreatedDate >= 2025-01-01 로 자른다.
 * (Q1 2026 개월 기준 리드타임이 15개월을 넘을 가능성은 낮다고 판단. 필요시 확장)
 */
async function fetchCandidateOpps(lowerCreatedISO, upperCreatedISO) {
  const soql = `
    SELECT Id, CreatedDate, IsClosed, IsWon, StageName, LeadSource
    FROM Opportunity
    WHERE CreatedDate >= ${lowerCreatedISO}
      AND CreatedDate <  ${upperCreatedISO}
      AND ${INBOUND_FILTER}
  `.replace(/\s+/g, ' ').trim();
  return sf.queryAll(soql);
}

/**
 * 후보 Opp들의 StageName 전환 이력 중 Won/Lost만 수집 (배치)
 */
async function fetchStageHistoryForOpps(oppIds) {
  if (oppIds.length === 0) return [];
  const chunkSize = 200;
  const all = [];
  let chunkIdx = 0;
  const totalChunks = Math.ceil(oppIds.length / chunkSize);
  for (let i = 0; i < oppIds.length; i += chunkSize) {
    chunkIdx++;
    const chunk = oppIds.slice(i, i + chunkSize);
    const inList = chunk.map(id => `'${id}'`).join(',');
    // NewValue/OldValue는 filterable 아님 → WHERE에서 빼고 메모리에서 필터
    const soql = `
      SELECT OpportunityId, CreatedDate, NewValue, OldValue
      FROM OpportunityFieldHistory
      WHERE Field = 'StageName'
        AND OpportunityId IN (${inList})
      ORDER BY OpportunityId, CreatedDate
    `.replace(/\s+/g, ' ').trim();
    const res = await sf.queryAll(soql);
    // Won/Lost 전환만 남김
    for (const h of res) {
      if (h.NewValue === 'Closed Won' || h.NewValue === 'Closed Lost') {
        all.push(h);
      }
    }
    if (chunkIdx % 10 === 0 || chunkIdx === totalChunks) {
      console.log(`    [History] chunk ${chunkIdx}/${totalChunks} 완료, 누적 Won/Lost 전환: ${all.length}`);
    }
  }
  return all;
}

// -------------- 분석 --------------

async function main() {
  const startedAt = Date.now();
  console.log('Little\'s Law - Inbound Q1 2026 (StageName 전환 기반)');
  console.log('인바운드 정의: Opportunity.LeadSource != 아웃바운드 (NULL 포함)');
  console.log('wonAt/lostAt = OpportunityFieldHistory.CreatedDate (Field=StageName)');

  // Q1 경계
  const Q1_START_ISO = kstToUTCIso(2026, 1, 1, false);   // 2026-01-01 00:00 KST → UTC
  const Q1_END_ISO   = kstToUTCIso(2026, 4, 1, false);   // 2026-04-01 00:00 KST → UTC (exclusive)

  // --- A. 후보 Opp 수집 (Created가 Q1 종료 전, 과거 최대 15개월) ---
  // 하한: 2025-01-01 KST (충분히 과거)
  const CAND_LOWER_ISO = kstToUTCIso(2025, 1, 1, false);
  console.log(`\n[1/4] 후보 인바운드 Opp 수집 (Created ${CAND_LOWER_ISO} ~ ${Q1_END_ISO})...`);
  const candidates = await fetchCandidateOpps(CAND_LOWER_ISO, Q1_END_ISO);
  console.log(`  → ${candidates.length} 건`);

  const candidateIds = candidates.map(c => c.Id);
  const oppMeta = new Map(candidates.map(c => [c.Id, c]));

  // --- B. 후보 Opp들의 Won/Lost 전환 이력 수집 ---
  console.log(`[2/4] StageName Won/Lost 전환 이력 수집...`);
  const history = await fetchStageHistoryForOpps(candidateIds);
  console.log(`  → ${history.length} 건`);

  // Opp별 wonAt (가장 최근 Won 전환), lostAt (가장 최근 Lost 전환) 매핑
  const wonAtByOpp = new Map();
  const lostAtByOpp = new Map();
  for (const h of history) {
    const t = new Date(h.CreatedDate).getTime();
    if (h.NewValue === 'Closed Won') {
      const prev = wonAtByOpp.get(h.OpportunityId);
      if (!prev || t > prev) wonAtByOpp.set(h.OpportunityId, t);
    } else if (h.NewValue === 'Closed Lost') {
      const prev = lostAtByOpp.get(h.OpportunityId);
      if (!prev || t > prev) lostAtByOpp.set(h.OpportunityId, t);
    }
  }
  console.log(`  wonAt 있는 Opp: ${wonAtByOpp.size}, lostAt 있는 Opp: ${lostAtByOpp.size}`);

  // --- C. 월별 분석 ---
  const months = [
    { y: 2026, m: 1 },
    { y: 2026, m: 2 },
    { y: 2026, m: 3 },
  ];

  const results = [];

  for (const { y, m } of months) {
    const lastDay = monthLastDay(y, m);
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;

    // 스냅샷 시점 (KST → UTC 타임스탬프)
    const snapStartMs = new Date(kstToUTCIso(y, m, 1, false)).getTime();         // 월초 00:00 KST
    const snapEndMs   = new Date(kstToUTCIso(nextY, nextM, 1, false)).getTime(); // 다음달 00:00 KST (=말일 자정 직후)
    const monthStartMs = snapStartMs;
    const monthEndMs = snapEndMs;

    console.log(`\n[${y}-${pad2(m)}] ===============================`);

    // --- λ: 이 달에 wonAt 발생한 건 ---
    let lambda = 0;
    const leadTimes = []; // wonAt - CreatedDate (일)
    const wonInMonthOppIds = [];

    for (const [oppId, wonAt] of wonAtByOpp.entries()) {
      if (wonAt >= monthStartMs && wonAt < monthEndMs) {
        lambda++;
        wonInMonthOppIds.push(oppId);
        const opp = oppMeta.get(oppId);
        if (opp && opp.CreatedDate) {
          const createdMs = new Date(opp.CreatedDate).getTime();
          const diffDays = (wonAt - createdMs) / (1000 * 60 * 60 * 24);
          if (diffDays >= 0) leadTimes.push(diffDays);
        }
      }
    }

    // --- Lost 건수 (참고) ---
    let lostCount = 0;
    for (const [, lostAt] of lostAtByOpp.entries()) {
      if (lostAt >= monthStartMs && lostAt < monthEndMs) lostCount++;
    }

    // --- 신규 유입 (해당 월에 CreatedDate) ---
    let inflow = 0;
    for (const c of candidates) {
      const cMs = new Date(c.CreatedDate).getTime();
      if (cMs >= monthStartMs && cMs < monthEndMs) inflow++;
    }

    // --- L: 월초/월말 Open 스냅샷 ---
    //   Open 정의 (팀장 스펙):
    //     CreatedDate <= snapshot
    //     AND (wonAt == null OR wonAt > snapshot)
    //     AND (IsClosed=false 이거나 wonAt이 snapshot 이후 발생)
    //
    //   해석 정리:
    //     "아직 Won 안 된 상태" = wonAt이 없거나 wonAt > snapshot
    //     (Lost는 포함하지 않는다는 지시가 없으므로, Lost된 건도 포함)
    //
    //   보조 지표 openStrict: Lost도 제외 (Won/Lost 모두 미발생 또는 snapshot 이후)
    const calcOpen = (snapMs, includeLost) => {
      let count = 0;
      for (const c of candidates) {
        const cMs = new Date(c.CreatedDate).getTime();
        if (cMs > snapMs) continue; // 아직 생성 안 된 것
        const wonAt = wonAtByOpp.get(c.Id);
        if (wonAt !== undefined && wonAt <= snapMs) continue; // 이미 Won
        if (!includeLost) {
          const lostAt = lostAtByOpp.get(c.Id);
          if (lostAt !== undefined && lostAt <= snapMs) continue; // 이미 Lost
        }
        count++;
      }
      return count;
    };

    // 월초 스냅샷: 1일 00:00 KST 시점 (= snapStartMs). snap 이전이 Open.
    // 월말 스냅샷: 말일 23:59:59 KST ≈ 다음달 00:00 KST. 그 이전이 Open.
    // 단, 월초 스냅샷에서 "1일에 생성된 것"을 포함할지 미묘 → 팀장 스펙:
    //   L: "CreatedDate <= snapshot". 월초=1일 00:00이라면 1일 00:00 전에 생성돼야 포함.
    //   "그 날 마감도 그 시점엔 아직 Open" 같은 엣지는 History 기반이므로 거의 영향 없음.

    const openAtStart_strict = calcOpen(snapStartMs, false);
    const openAtStart_loose  = calcOpen(snapStartMs, true);
    const openAtEnd_strict   = calcOpen(snapEndMs,   false);
    const openAtEnd_loose    = calcOpen(snapEndMs,   true);

    // 팀장 스펙(=loose, Lost 포함) 기준을 주지표로, strict(Lost 제외)를 보조로.
    const L_main = (openAtStart_loose + openAtEnd_loose) / 2;
    const L_strict = (openAtStart_strict + openAtEnd_strict) / 2;

    // --- W 추정 ---
    const W_month = lambda > 0 ? L_main / lambda : null;
    const W_days_actualMonthLen = W_month !== null ? W_month * lastDay : null;
    const W_days_30 = W_month !== null ? W_month * 30 : null;

    const W_month_strict = lambda > 0 ? L_strict / lambda : null;
    const W_days_strict = W_month_strict !== null ? W_month_strict * lastDay : null;

    // --- 실측 리드타임 (StageName 전환 기반) ---
    const sorted = [...leadTimes].sort((a, b) => a - b);
    const ltMedian = median(leadTimes);
    const ltP25 = percentile(sorted, 0.25);
    const ltP75 = percentile(sorted, 0.75);
    const ltP90 = percentile(sorted, 0.90);
    const ltMin = sorted[0] ?? null;
    const ltMax = sorted[sorted.length - 1] ?? null;

    console.log(`  유입: ${inflow}, λ(Won 전환): ${lambda}, Lost 전환: ${lostCount}`);
    console.log(`  월초 Open(loose/strict): ${openAtStart_loose}/${openAtStart_strict}, 월말 Open: ${openAtEnd_loose}/${openAtEnd_strict}`);
    console.log(`  L(주/Lost포함): ${round(L_main, 1)}, L(strict): ${round(L_strict, 1)}`);
    console.log(`  W 추정: ${round(W_days_actualMonthLen, 1)}일 (${lastDay}일 월), ${round(W_days_30, 1)}일 (30일)`);
    console.log(`  실측(StageName 전환): median=${round(ltMedian, 1)}, P25=${round(ltP25, 1)}, P75=${round(ltP75, 1)}, P90=${round(ltP90, 1)}, n=${leadTimes.length}`);

    results.push({
      month: `${y}-${pad2(m)}`,
      daysInMonth: lastDay,
      inflow,
      lambda,
      lostCount,
      openAtStart_loose,
      openAtEnd_loose,
      openAtStart_strict,
      openAtEnd_strict,
      L: round(L_main, 2),
      L_strict: round(L_strict, 2),
      W_month: round(W_month, 4),
      W_days_actualMonthLen: round(W_days_actualMonthLen, 2),
      W_days_30: round(W_days_30, 2),
      W_days_strict: round(W_days_strict, 2),
      actual_lead_time_stage_based: {
        sampleSize: leadTimes.length,
        median: round(ltMedian, 2),
        p25: round(ltP25, 2),
        p75: round(ltP75, 2),
        p90: round(ltP90, 2),
        min: round(ltMin, 2),
        max: round(ltMax, 2),
        note: 'wonAt - CreatedDate (일), StageName 전환 기반 (CloseDate 미사용)',
      },
      gap_W_vs_median_days: (W_days_actualMonthLen !== null && ltMedian !== null)
        ? round(W_days_actualMonthLen - ltMedian, 2)
        : null,
    });
  }

  // --- 분기 집계 ---
  const totalLambda = results.reduce((s, r) => s + r.lambda, 0);
  const totalInflow = results.reduce((s, r) => s + r.inflow, 0);
  const totalLost = results.reduce((s, r) => s + r.lostCount, 0);
  const avgL = results.reduce((s, r) => s + r.L, 0) / results.length;
  const avgLStrict = results.reduce((s, r) => s + r.L_strict, 0) / results.length;
  const wDaysArr = results.map(r => r.W_days_actualMonthLen).filter(v => v !== null);
  const avgWdays = wDaysArr.length ? wDaysArr.reduce((s, v) => s + v, 0) / wDaysArr.length : null;
  const medArr = results.map(r => r.actual_lead_time_stage_based.median).filter(v => v !== null);
  const avgMedian = medArr.length ? medArr.reduce((s, v) => s + v, 0) / medArr.length : null;

  const summary = {
    totalInflow,
    totalLambda,
    totalLost,
    avgL: round(avgL, 2),
    avgL_strict: round(avgLStrict, 2),
    avgW_days: round(avgWdays, 2),
    avgMedianActualLT: round(avgMedian, 2),
    gap_W_vs_median_days: (avgWdays !== null && avgMedian !== null) ? round(avgWdays - avgMedian, 2) : null,
  };

  // --- 표 출력 ---
  console.log('\n==================== 결과 표 ====================');
  console.log('※ 실측 중앙값(일) = StageName이 Closed Won으로 바뀐 시점(wonAt) - CreatedDate (CloseDate 미사용)');
  console.log('※ L(평균 Open) = 팀장 스펙대로 "wonAt 기준 아직 Won 안 된" 건. Lost 건도 포함됨 (loose).');
  const header = ['월', '유입', 'CW(λ)', 'Lost', '월초Open', '월말Open', 'L(평균Open)', 'W추정(일)', '실측중앙값(일)', 'P25/P75'];
  console.log(header.join(' | '));
  console.log('-'.repeat(130));
  for (const r of results) {
    console.log([
      r.month,
      r.inflow,
      r.lambda,
      r.lostCount,
      r.openAtStart_loose,
      r.openAtEnd_loose,
      r.L,
      r.W_days_actualMonthLen ?? 'N/A',
      r.actual_lead_time_stage_based.median ?? 'N/A',
      `${r.actual_lead_time_stage_based.p25 ?? 'N/A'} / ${r.actual_lead_time_stage_based.p75 ?? 'N/A'}`,
    ].join(' | '));
  }
  console.log('-'.repeat(130));
  console.log([
    'Q1 합계/평균',
    totalInflow,
    totalLambda,
    totalLost,
    '-',
    '-',
    summary.avgL,
    summary.avgW_days ?? 'N/A',
    summary.avgMedianActualLT ?? 'N/A',
    '-',
  ].join(' | '));

  // --- 해석 ---
  console.log('\n==================== 해석 ====================');
  if (summary.gap_W_vs_median_days === null) {
    console.log('샘플 부족으로 해석 불가.');
  } else {
    const gap = summary.gap_W_vs_median_days;
    const gapPct = summary.avgMedianActualLT > 0 ? (gap / summary.avgMedianActualLT * 100) : null;
    if (gap > 0) {
      console.log(`리틀의 법칙 추정 W(${summary.avgW_days}일)가 실측 중앙값(${summary.avgMedianActualLT}일)보다 ${gap}일 (${round(gapPct, 1)}%) 길다.`);
      console.log(`→ 파이프라인에 장기 정체된 Open Opp(long tail)이 평균 L을 끌어올리고 있어,`);
      console.log(`  실제 Won까지 빨리 도달하는 건들 대비 재고(L)가 과다함을 시사한다.`);
      console.log(`  구조적으로 "오래된 Open을 정리(Lost 처리)하지 않고 방치"하는 패턴 점검 필요.`);
    } else if (gap < 0) {
      console.log(`리틀의 법칙 추정 W(${summary.avgW_days}일)가 실측 중앙값(${summary.avgMedianActualLT}일)보다 ${Math.abs(gap)}일 (${round(Math.abs(gapPct), 1)}%) 짧다.`);
      console.log(`→ throughput(λ) 대비 재고(L)가 상대적으로 적음. 월 경계에 Won 전환이 몰렸거나 유입이 급증했을 가능성.`);
    } else {
      console.log('리틀의 법칙 추정 W와 실측 중앙값이 거의 일치한다 → 파이프라인이 정상 상태.');
    }
  }

  // --- JSON 저장 ---
  const outDir = path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'littles-law-inbound-q1-2026.json');

  const payload = {
    generatedAt: new Date().toISOString(),
    method: {
      inboundDefinition: "Opportunity.LeadSource != '아웃바운드' (NULL 포함)",
      wonAt: "OpportunityFieldHistory.CreatedDate (Field='StageName', NewValue='Closed Won'). Opp별 가장 최근 전환 사용.",
      lostAt: "OpportunityFieldHistory.CreatedDate (Field='StageName', NewValue='Closed Lost'). Opp별 가장 최근 전환 사용.",
      L_definition: '(월초 Open + 월말 Open) / 2',
      openDefinition_loose_main: 'CreatedDate <= snapshot AND (wonAt is null OR wonAt > snapshot). Lost 건은 포함됨 (팀장 스펙)',
      openDefinition_strict_aux: 'loose 조건 + lostAt is null OR lostAt > snapshot. Lost도 제외한 순수 Open 보조지표.',
      lambda_definition: '해당 월 [월초 00:00 KST, 다음달 00:00 KST)에 wonAt이 속하는 Opp 수',
      W_estimate: 'L / λ (월 단위) → 해당 월 실제 일수 환산 (W_days_actualMonthLen). 30일 환산(W_days_30)도 기록.',
      actualLeadTime: '(wonAt - CreatedDate) 일수. median + P25/P75/P90. CloseDate 미사용.',
      note: '평균 사용 금지 원칙에 따라 리드타임 분포는 median/percentile만 사용.',
      candidateOppWindow: '2025-01-01 ~ 2026-04-01 KST 내 생성된 인바운드 Opp만 후보로 포함 (과거 15개월 컷)',
    },
    period: { start: '2026-01-01', end: '2026-03-31' },
    monthly: results,
    summary,
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n저장 완료: ${outPath}`);
  console.log(`총 소요: ${((Date.now() - startedAt) / 1000).toFixed(1)}초`);
}

main().catch(err => {
  console.error('오류:', err.response?.data || err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
