/**
 * Stage별 체류시간 분포 분석 - 인바운드 Q1 2026 (Won / Lost 경로 분리)
 *
 * 목적: Q1 인바운드 파이프라인에서 각 Stage의 체류시간 분포를 구해
 *       리드타임 병목을 식별한다.
 *
 * 인바운드 정의: Opportunity.LeadSource != '아웃바운드' (NULL 포함)
 *
 * 대상:
 *   - Won 경로: wonAt ∈ [2026-01-01, 2026-04-01 KST) 인 Opp (직전 스크립트 기준 2,164건)
 *   - Lost 경로: lostAt ∈ [2026-01-01, 2026-04-01 KST) 인 Opp (직전 스크립트 기준 2,861건)
 *   wonAt/lostAt 정의: OpportunityFieldHistory.Field='StageName' AND NewValue='Closed Won'/'Closed Lost'
 *                     의 가장 최근 CreatedDate
 *
 * 계산 로직:
 *   1. 대상 Opp들의 StageName 전환 이력 전체 수집 (Won/Lost뿐 아니라 전체 전환)
 *   2. Opp별 전환 이력을 시간순 정렬해 각 Stage 체류 기간(days) 계산
 *      - 진입 시점: 해당 Stage로 NewValue 바뀐 레코드의 CreatedDate
 *      - 퇴장 시점: 그 다음 Stage 전환 레코드의 CreatedDate (없으면 wonAt/lostAt)
 *      - 최초 Stage(첫 전환 이전 = Opp 생성 직후 Stage)는 Opp.CreatedDate를 진입 시점으로
 *   3. 각 Stage별 median / P25 / P75 / 최대 / 샘플수 집계 (평균 사용 금지)
 *   4. 동일 Opp에서 같은 Stage 재진입은 "각 진입별 개별 데이터포인트"로 처리 (합산 금지)
 *
 * 주의:
 *   - OpportunityFieldHistory는 IN 절 200개 chunk로 분할 쿼리
 *   - OpportunityFieldHistory.OldValue/NewValue는 filterable 아님 → 메모리 필터
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const sf = require('../../dashboard/backend/services/salesforce');

// -------------- 공통 유틸 --------------

function pad2(n) { return String(n).padStart(2, '0'); }

function kstToUTCIso(year, month, day, endOfDay = false) {
  if (endOfDay) {
    return new Date(Date.UTC(year, month - 1, day, 14, 59, 59)).toISOString();
  }
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

function median(sortedArr) {
  return percentile(sortedArr, 0.5);
}

function round(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

// -------------- 데이터 수집 --------------

const INBOUND_FILTER = `(LeadSource = NULL OR LeadSource != '아웃바운드')`;

/**
 * Q1(2026-01-01 ~ 2026-04-01 KST) 사이에 Won/Lost 전환이 있었던 인바운드 Opp 식별.
 *
 * 방법: 직전 스크립트와 같이 2025-01-01 이후 생성된 인바운드 Opp 전체를 후보로 잡고,
 *       그 Opp들의 StageName 전환 이력에서 Q1 범위 Won/Lost 를 메모리 필터링.
 */
async function fetchInboundCandidates(lowerCreatedISO, upperCreatedISO) {
  const soql = `
    SELECT Id, CreatedDate, StageName, LeadSource
    FROM Opportunity
    WHERE CreatedDate >= ${lowerCreatedISO}
      AND CreatedDate <  ${upperCreatedISO}
      AND ${INBOUND_FILTER}
  `.replace(/\s+/g, ' ').trim();
  return sf.queryAll(soql);
}

/**
 * 주어진 Opp ID 목록의 StageName 전환 이력 전체 수집 (Won/Lost 외에도 모두).
 * chunk size 200.
 */
async function fetchAllStageHistory(oppIds) {
  if (oppIds.length === 0) return [];
  const chunkSize = 200;
  const all = [];
  const totalChunks = Math.ceil(oppIds.length / chunkSize);
  let chunkIdx = 0;
  for (let i = 0; i < oppIds.length; i += chunkSize) {
    chunkIdx++;
    const chunk = oppIds.slice(i, i + chunkSize);
    const inList = chunk.map(id => `'${id}'`).join(',');
    const soql = `
      SELECT OpportunityId, CreatedDate, NewValue, OldValue
      FROM OpportunityFieldHistory
      WHERE Field = 'StageName'
        AND OpportunityId IN (${inList})
      ORDER BY OpportunityId, CreatedDate
    `.replace(/\s+/g, ' ').trim();
    const res = await sf.queryAll(soql);
    all.push(...res);
    if (chunkIdx % 10 === 0 || chunkIdx === totalChunks) {
      console.log(`    [History] chunk ${chunkIdx}/${totalChunks} 완료, 누적 이력: ${all.length}`);
    }
  }
  return all;
}

// -------------- 분석 --------------

/**
 * 한 Opp에 대해 전환 이력으로부터 Stage별 체류 구간(entry)들을 생성.
 *
 * 입력:
 *   - oppCreatedMs: Opportunity.CreatedDate (ms)
 *   - transitions: 이 Opp의 StageName 전환 이력 (CreatedDate ASC)
 *       각 항목 { createdMs, oldValue, newValue }
 *   - terminalMs: 최종 종료 시점 (wonAt 또는 lostAt) ms
 *
 * 로직:
 *   - 첫 전환이 있다면 최초 Stage = transitions[0].oldValue (null이면 스킵)
 *     진입시점 = oppCreatedMs, 퇴장시점 = transitions[0].createdMs
 *   - 이후 각 전환 i에 대해 Stage = transitions[i].newValue
 *     진입시점 = transitions[i].createdMs
 *     퇴장시점 = transitions[i+1]?.createdMs ?? terminalMs
 *   - 전환이 하나도 없으면: Stage = 현재 StageName(메타), 진입=oppCreatedMs, 퇴장=terminalMs
 *     (단 이 케이스는 생성 직후 바로 Won/Lost로 간 경우로, Won/Lost Stage만 기록됨)
 *
 * 반환: [{ stage, dwellDays, isReentry, entryIdxInOpp }, ...]
 *   같은 Opp 내 같은 Stage가 여러 번 나타날 수 있음 (재진입). 합산하지 않고 개별 기록.
 */
function buildStageDwells(oppCreatedMs, currentStageName, transitions, terminalMs) {
  const dwells = [];
  const MS_PER_DAY = 86400000;

  if (!transitions || transitions.length === 0) {
    // 전환 이력이 전혀 없음 → 생성 시점부터 terminalMs까지 현재 Stage.
    // 보통 현재 Stage가 Closed Won / Closed Lost 자체.
    if (currentStageName && terminalMs && terminalMs >= oppCreatedMs) {
      dwells.push({
        stage: currentStageName,
        dwellDays: (terminalMs - oppCreatedMs) / MS_PER_DAY,
      });
    }
    return dwells;
  }

  // 최초 Stage: 첫 전환의 OldValue (Opp 생성 시점의 Stage)
  const first = transitions[0];
  if (first.oldValue) {
    const exitMs = first.createdMs;
    if (exitMs >= oppCreatedMs) {
      dwells.push({
        stage: first.oldValue,
        dwellDays: (exitMs - oppCreatedMs) / MS_PER_DAY,
      });
    }
  }

  // 각 전환에 대해 NewValue Stage의 구간
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    if (!t.newValue) continue;
    const entryMs = t.createdMs;
    const exitMs = (i + 1 < transitions.length) ? transitions[i + 1].createdMs : terminalMs;
    if (exitMs === null || exitMs === undefined) continue;
    if (exitMs < entryMs) continue;
    dwells.push({
      stage: t.newValue,
      dwellDays: (exitMs - entryMs) / MS_PER_DAY,
    });
  }

  return dwells;
}

/**
 * Stage별 dwellDays 배열을 집계해 중앙값/P25/P75/최대/샘플수 테이블 산출.
 */
function aggregateByStage(dwellsByStage) {
  const result = [];
  for (const [stage, arr] of dwellsByStage.entries()) {
    const sorted = [...arr].sort((a, b) => a - b);
    result.push({
      stage,
      sampleSize: sorted.length,
      median: round(median(sorted), 2),
      p25: round(percentile(sorted, 0.25), 2),
      p75: round(percentile(sorted, 0.75), 2),
      max: round(sorted[sorted.length - 1] ?? null, 2),
    });
  }
  // 중앙값 내림차순 (병목 먼저)
  result.sort((a, b) => (b.median ?? -1) - (a.median ?? -1));
  return result;
}

function printTable(title, rows) {
  console.log(`\n${title}`);
  const header = ['Stage', '중앙값(일)', 'P25', 'P75', '최대', '샘플수'];
  const widths = [28, 12, 10, 10, 10, 8];
  const pad = (s, w) => {
    const str = String(s ?? '-');
    // 한글 대응: 한글 1글자 = 폭 2로 카운트
    let width = 0;
    for (const ch of str) width += /[\u3131-\uD79D]/.test(ch) ? 2 : 1;
    const diff = Math.max(0, w - width);
    return str + ' '.repeat(diff);
  };
  console.log(header.map((h, i) => pad(h, widths[i])).join(' | '));
  console.log('-'.repeat(widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 3));
  for (const r of rows) {
    console.log([
      pad(r.stage, widths[0]),
      pad(r.median, widths[1]),
      pad(r.p25, widths[2]),
      pad(r.p75, widths[3]),
      pad(r.max, widths[4]),
      pad(r.sampleSize, widths[5]),
    ].join(' | '));
  }
}

// -------------- main --------------

async function main() {
  const startedAt = Date.now();
  console.log('Stage 체류시간 분포 - Inbound Q1 2026');
  console.log('인바운드 정의: LeadSource != 아웃바운드 (NULL 포함)');
  console.log('Won/Lost 경로 분리, 같은 Stage 재진입은 개별 데이터포인트로 처리');

  const Q1_START_MS = new Date(kstToUTCIso(2026, 1, 1, false)).getTime();
  const Q1_END_MS   = new Date(kstToUTCIso(2026, 4, 1, false)).getTime();
  const CAND_LOWER_ISO = kstToUTCIso(2025, 1, 1, false);
  const CAND_UPPER_ISO = kstToUTCIso(2026, 4, 1, false);

  // --- 1) 후보 인바운드 Opp 수집 ---
  console.log(`\n[1/4] 후보 인바운드 Opp 수집 (Created ${CAND_LOWER_ISO} ~ ${CAND_UPPER_ISO})...`);
  const candidates = await fetchInboundCandidates(CAND_LOWER_ISO, CAND_UPPER_ISO);
  console.log(`  → ${candidates.length} 건`);

  const oppMeta = new Map(candidates.map(c => [c.Id, c]));
  const candidateIds = candidates.map(c => c.Id);

  // --- 2) StageName 전환 이력 전체 수집 ---
  console.log(`[2/4] StageName 전환 이력 전체 수집...`);
  const allHistory = await fetchAllStageHistory(candidateIds);
  console.log(`  → ${allHistory.length} 건`);

  // Opp별 전환 이력 그룹핑 (시간순), Won/Lost 최근 시점 계산
  const transitionsByOpp = new Map();
  const wonAtByOpp = new Map();
  const lostAtByOpp = new Map();

  for (const h of allHistory) {
    const createdMs = new Date(h.CreatedDate).getTime();
    const entry = {
      createdMs,
      oldValue: h.OldValue,
      newValue: h.NewValue,
    };
    if (!transitionsByOpp.has(h.OpportunityId)) {
      transitionsByOpp.set(h.OpportunityId, []);
    }
    transitionsByOpp.get(h.OpportunityId).push(entry);

    if (h.NewValue === 'Closed Won') {
      const prev = wonAtByOpp.get(h.OpportunityId);
      if (!prev || createdMs > prev) wonAtByOpp.set(h.OpportunityId, createdMs);
    } else if (h.NewValue === 'Closed Lost') {
      const prev = lostAtByOpp.get(h.OpportunityId);
      if (!prev || createdMs > prev) lostAtByOpp.set(h.OpportunityId, createdMs);
    }
  }
  // 각 Opp 전환 이력 시간순 정렬
  for (const arr of transitionsByOpp.values()) {
    arr.sort((a, b) => a.createdMs - b.createdMs);
  }

  // --- 3) Q1 Won / Lost 대상 Opp 선정 ---
  const wonTargetIds = [];
  for (const [oppId, wonAt] of wonAtByOpp.entries()) {
    if (wonAt >= Q1_START_MS && wonAt < Q1_END_MS) wonTargetIds.push(oppId);
  }
  const lostTargetIds = [];
  for (const [oppId, lostAt] of lostAtByOpp.entries()) {
    if (lostAt >= Q1_START_MS && lostAt < Q1_END_MS) {
      // wonAt과 lostAt 둘 다 Q1에 있다면 최근 이벤트가 경로를 결정.
      const wonAt = wonAtByOpp.get(oppId);
      if (wonAt && wonAt >= Q1_START_MS && wonAt < Q1_END_MS && wonAt > lostAt) {
        // 이미 Won으로 분류됨
        continue;
      }
      lostTargetIds.push(oppId);
    }
  }
  // Won과 Lost 둘 다 있고 Won이 더 최근이면 Lost에서 제외 (위에서 처리)
  // 반대로 Lost가 더 최근이면 wonTargetIds에서 제외
  const wonTargetFinal = wonTargetIds.filter(id => {
    const w = wonAtByOpp.get(id);
    const l = lostAtByOpp.get(id);
    if (l && l >= Q1_START_MS && l < Q1_END_MS && l > w) return false;
    return true;
  });

  console.log(`\n[3/4] Q1 대상:`);
  console.log(`  Won 경로: ${wonTargetFinal.length} 건 (직전 리틀의법칙 집계 2,164 참고)`);
  console.log(`  Lost 경로: ${lostTargetIds.length} 건 (직전 리틀의법칙 집계 2,861 참고)`);

  // --- 4) Stage 체류 계산 ---
  console.log(`[4/4] Stage 체류시간 계산...`);

  const wonDwellsByStage = new Map();   // stage → [dwellDays, ...]
  const lostDwellsByStage = new Map();

  const pushDwell = (map, stage, days) => {
    if (!Number.isFinite(days) || days < 0) return;
    if (!map.has(stage)) map.set(stage, []);
    map.get(stage).push(days);
  };

  // Won 경로
  for (const oppId of wonTargetFinal) {
    const meta = oppMeta.get(oppId);
    if (!meta) continue;
    const oppCreatedMs = new Date(meta.CreatedDate).getTime();
    const terminalMs = wonAtByOpp.get(oppId);
    const transitions = transitionsByOpp.get(oppId) || [];
    // terminalMs(=wonAt) 이후의 전환은 분석 대상 아님 → 컷
    const cut = transitions.filter(t => t.createdMs <= terminalMs);
    const dwells = buildStageDwells(oppCreatedMs, meta.StageName, cut, terminalMs);
    for (const d of dwells) pushDwell(wonDwellsByStage, d.stage, d.dwellDays);
  }

  // Lost 경로
  for (const oppId of lostTargetIds) {
    const meta = oppMeta.get(oppId);
    if (!meta) continue;
    const oppCreatedMs = new Date(meta.CreatedDate).getTime();
    const terminalMs = lostAtByOpp.get(oppId);
    const transitions = transitionsByOpp.get(oppId) || [];
    const cut = transitions.filter(t => t.createdMs <= terminalMs);
    const dwells = buildStageDwells(oppCreatedMs, meta.StageName, cut, terminalMs);
    for (const d of dwells) pushDwell(lostDwellsByStage, d.stage, d.dwellDays);
  }

  const wonAgg = aggregateByStage(wonDwellsByStage);
  const lostAgg = aggregateByStage(lostDwellsByStage);

  // --- 출력 ---
  printTable(
    `[Won 경로] Q1에 Won된 인바운드 Opp ${wonTargetFinal.length}건의 Stage 체류시간`,
    wonAgg
  );
  printTable(
    `[Lost 경로] Q1에 Lost된 인바운드 Opp ${lostTargetIds.length}건의 Stage 체류시간`,
    lostAgg
  );

  // --- 해석 ---
  console.log('\n==================== 해석 ====================');
  // 병목: Closed Won/Closed Lost 자체는 제외하고 중앙값 최상위
  const excludeTerminal = s => !/^Closed (Won|Lost)$/i.test(s.stage);
  const wonBottleneck = wonAgg.filter(excludeTerminal)[0];
  const lostBottleneck = lostAgg.filter(excludeTerminal)[0];

  if (wonBottleneck) {
    console.log(
      `Won 경로 병목 후보: "${wonBottleneck.stage}" 중앙값 ${wonBottleneck.median}일 ` +
      `(P25 ${wonBottleneck.p25} / P75 ${wonBottleneck.p75}, n=${wonBottleneck.sampleSize})`
    );
  }
  if (lostBottleneck) {
    console.log(
      `Lost 경로 병목 후보: "${lostBottleneck.stage}" 중앙값 ${lostBottleneck.median}일 ` +
      `(P25 ${lostBottleneck.p25} / P75 ${lostBottleneck.p75}, n=${lostBottleneck.sampleSize})`
    );
  }

  // Won vs Lost 격차 Stage
  const lostByStage = new Map(lostAgg.map(r => [r.stage, r]));
  const diffs = [];
  for (const w of wonAgg) {
    if (!excludeTerminal(w)) continue;
    const l = lostByStage.get(w.stage);
    if (!l || l.median === null || w.median === null) continue;
    diffs.push({
      stage: w.stage,
      wonMedian: w.median,
      lostMedian: l.median,
      gap: l.median - w.median,
      wonN: w.sampleSize,
      lostN: l.sampleSize,
    });
  }
  diffs.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  const topDiff = diffs[0];
  if (topDiff) {
    console.log(
      `Won↔Lost 격차 최대: "${topDiff.stage}" — Won 중앙값 ${topDiff.wonMedian}일 vs Lost 중앙값 ${topDiff.lostMedian}일 ` +
      `(차이 ${round(topDiff.gap, 1)}일). 깔끔하게 진행되는 건과 질질 끌리는 건의 분기점.`
    );
  }

  // --- JSON 저장 ---
  const outDir = path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'stage-dwell-inbound-q1-2026.json');

  const payload = {
    generatedAt: new Date().toISOString(),
    method: {
      inboundDefinition: "Opportunity.LeadSource != '아웃바운드' (NULL 포함)",
      targetWon: "wonAt ∈ [2026-01-01, 2026-04-01 KST). wonAt = OpportunityFieldHistory.CreatedDate (Field=StageName, NewValue='Closed Won')의 가장 최근 값",
      targetLost: "lostAt ∈ [2026-01-01, 2026-04-01 KST). lostAt = OpportunityFieldHistory.CreatedDate (Field=StageName, NewValue='Closed Lost')의 가장 최근 값. Q1 내 Won이 Lost보다 나중이면 Won 경로에만 집계.",
      dwellLogic: [
        "Opp별 StageName 전환 이력을 시간순 정렬",
        "최초 Stage: 첫 전환의 OldValue, 진입시점=Opp.CreatedDate, 퇴장시점=첫 전환 CreatedDate",
        "i번째 전환의 NewValue Stage: 진입시점=해당 CreatedDate, 퇴장시점=다음 전환 CreatedDate (없으면 wonAt/lostAt)",
        "같은 Opp 내 같은 Stage 재진입 시 합산 금지 - 각 진입별 개별 데이터포인트",
      ].join(' / '),
      metrics: 'median / p25 / p75 / max / sampleSize. 평균 사용 금지.',
      candidateOppWindow: '2025-01-01 ~ 2026-04-01 KST 내 생성된 인바운드 Opp만 후보로 포함',
    },
    period: { start: '2026-01-01', end: '2026-03-31' },
    counts: {
      wonTargetOpps: wonTargetFinal.length,
      lostTargetOpps: lostTargetIds.length,
      candidateInboundOpps: candidates.length,
      totalStageHistoryRows: allHistory.length,
    },
    wonPath: wonAgg,
    lostPath: lostAgg,
    wonVsLostGap: diffs,
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
