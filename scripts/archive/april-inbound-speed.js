/**
 * 2026년 4월 인바운드 세일즈 속도 KPI 추출
 * ----------------------------------------------------
 * 본질: 응답 속도(FRT) + 처리 속도(Stage dwell). CW 태블릿은 후행 지표.
 *
 * 산출 지표
 *  A. FRT 분포 (중앙값 / P25 / P75 / P90, 일자별 추이)
 *  B. SLA 준수율 (30분 / 60분 / 120분, 일자별)
 *  C. Stage Dwell — 4월 마감(Won) Opp 기준, Q1 baseline 대비 변화율
 *  D. 24h 미응답 Lead (일자별 누적)
 *  E. Stage 정체 Open Opp (Stage별 정체 + Top5)
 *  F. CW 태블릿 보조 (캐시에서 가져옴, 새 쿼리 금지)
 *
 * 제약
 *  - 평균 사용 금지 → median + P25/P75/P90
 *  - SOQL SELECT only (DML 금지)
 *  - IN 절 200개 chunk
 *  - 한국어 콘솔 출력
 *
 * KPI 룰 명세: docs/team-kpi-spec.md 섹션 2 참조.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const sf = require('../../server/api/services/salesforce');

// ==========================================================================
// 공통 유틸
// ==========================================================================
function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * KST 일자 → SOQL용 UTC ISO 문자열
 *   start: 해당 KST 일자 00:00 KST = 전일 15:00 UTC
 *   end: 해당 KST 일자 23:59:59 KST = 당일 14:59:59 UTC
 */
function kstToUTCIso(year, month, day, endOfDay = false) {
  if (endOfDay) {
    return new Date(Date.UTC(year, month - 1, day, 14, 59, 59)).toISOString();
  }
  return new Date(Date.UTC(year, month - 1, day - 1, 15, 0, 0)).toISOString();
}

function utcToKstDateStr(isoStr) {
  if (!isoStr) return null;
  const t = new Date(isoStr).getTime() + 9 * 60 * 60 * 1000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
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

function median(sortedArr) { return percentile(sortedArr, 0.5); }

function round(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ==========================================================================
// 데이터 수집
// ==========================================================================
const KST_2026_04_START_ISO = kstToUTCIso(2026, 4, 1, false);  // 4/1 00:00 KST
const KST_2026_05_START_ISO = kstToUTCIso(2026, 5, 1, false);  // 5/1 00:00 KST
const APRIL_START_MS = new Date(KST_2026_04_START_ISO).getTime();
const APRIL_END_MS   = new Date(KST_2026_05_START_ISO).getTime();

async function fetchInboundUsers() {
  const soql = `
    SELECT Id, Name, Department, IsActive
    FROM User
    WHERE Department = '인바운드세일즈'
      AND IsActive = true
  `.replace(/\s+/g, ' ').trim();
  return sf.queryAll(soql);
}

/**
 * 4월 생성 Lead - 인바운드 사용자 보유분.
 * test 회사명 / 오생성 등 기본 노이즈는 다운스트림에서 메모리 필터.
 */
async function fetchAprilInboundLeads(inboundUserIds) {
  const all = [];
  const userChunks = chunk(inboundUserIds, 200);
  for (const c of userChunks) {
    const inList = c.map(id => `'${id}'`).join(',');
    const soql = `
      SELECT Id, Name, OwnerId, Status, CreatedDate, Company,
             LossReason__c, ConvertedOpportunityId, ServiceType__c
      FROM Lead
      WHERE CreatedDate >= ${KST_2026_04_START_ISO}
        AND CreatedDate <  ${KST_2026_05_START_ISO}
        AND OwnerId IN (${inList})
    `.replace(/\s+/g, ' ').trim();
    const recs = await sf.queryAll(soql);
    all.push(...recs);
  }
  return all;
}

/**
 * 4월 Lead들의 첫 Task (인바운드 사용자가 Owner인 것).
 * Lead__c custom field 사용. (FRT 리포트 기존 스크립트와 일관)
 */
async function fetchFirstTasksByLead(leadIds, inboundUserIdSet) {
  if (leadIds.length === 0) return new Map();
  const allTasks = [];
  for (const c of chunk(leadIds, 200)) {
    const inList = c.map(id => `'${id}'`).join(',');
    const soql = `
      SELECT Id, Lead__c, OwnerId, CreatedDate
      FROM Task
      WHERE Lead__c IN (${inList})
      ORDER BY Lead__c, CreatedDate ASC
    `.replace(/\s+/g, ' ').trim();
    const recs = await sf.queryAll(soql);
    allTasks.push(...recs);
  }
  const firstByLead = new Map();
  for (const t of allTasks) {
    if (!t.Lead__c) continue;
    if (!inboundUserIdSet.has(t.OwnerId)) continue;
    const prev = firstByLead.get(t.Lead__c);
    const ts = new Date(t.CreatedDate).getTime();
    if (!prev || ts < prev.ts) {
      firstByLead.set(t.Lead__c, { ts, taskId: t.Id, ownerId: t.OwnerId });
    }
  }
  return firstByLead;
}

/**
 * 4월 Lead들의 LeadHistory (Status 변경 이력).
 * 첫 응답 fallback 용도: New → 그 외로 첫 변경된 시각.
 * LeadHistory.OldValue/NewValue는 filterable 아님 → 메모리 필터.
 */
async function fetchLeadStatusFirstChange(leadIds) {
  if (leadIds.length === 0) return new Map();
  const histories = [];
  for (const c of chunk(leadIds, 200)) {
    const inList = c.map(id => `'${id}'`).join(',');
    const soql = `
      SELECT LeadId, CreatedDate, Field, OldValue, NewValue
      FROM LeadHistory
      WHERE Field = 'Status'
        AND LeadId IN (${inList})
      ORDER BY LeadId, CreatedDate
    `.replace(/\s+/g, ' ').trim();
    try {
      const recs = await sf.queryAll(soql);
      histories.push(...recs);
    } catch (err) {
      // LeadHistory 권한 없거나 비활성 시
      console.warn(`    [LeadHistory] chunk 조회 실패: ${err.response?.data?.[0]?.message || err.message}`);
    }
  }
  // 각 Lead 당 첫 Status 변경 (OldValue가 '배정대기' 또는 'New' 계열인 첫 변경)
  const firstChange = new Map();
  for (const h of histories) {
    const ts = new Date(h.CreatedDate).getTime();
    const prev = firstChange.get(h.LeadId);
    if (!prev || ts < prev.ts) {
      firstChange.set(h.LeadId, { ts, oldValue: h.OldValue, newValue: h.NewValue });
    }
  }
  return firstChange;
}

/**
 * 4월 마감(Won) Opp - 인바운드.
 * Owner_Department__c custom field 사용.
 */
async function fetchAprilWonInboundOpps() {
  const soql = `
    SELECT Id, Name, CreatedDate, CloseDate, StageName, IsWon, IsClosed,
           Owner_Department__c, Owner.Name
    FROM Opportunity
    WHERE Owner_Department__c = '인바운드세일즈'
      AND IsWon = true
      AND CloseDate >= 2026-04-01
      AND CloseDate <  2026-05-01
  `.replace(/\s+/g, ' ').trim();
  return sf.queryAll(soql);
}

/**
 * 현재 Open 인바운드 Opp.
 */
async function fetchOpenInboundOpps() {
  const soql = `
    SELECT Id, Name, CreatedDate, StageName, IsClosed,
           Owner_Department__c, Owner.Name
    FROM Opportunity
    WHERE Owner_Department__c = '인바운드세일즈'
      AND IsClosed = false
  `.replace(/\s+/g, ' ').trim();
  return sf.queryAll(soql);
}

/**
 * Opp Id 목록의 StageName 전환 이력 전체 (chunk 200).
 * stage-dwell-inbound-q1 스크립트와 동일 패턴.
 */
async function fetchStageHistory(oppIds) {
  if (oppIds.length === 0) return [];
  const all = [];
  const chunks = chunk(oppIds, 200);
  let idx = 0;
  for (const c of chunks) {
    idx++;
    const inList = c.map(id => `'${id}'`).join(',');
    const soql = `
      SELECT OpportunityId, CreatedDate, NewValue, OldValue
      FROM OpportunityFieldHistory
      WHERE Field = 'StageName'
        AND OpportunityId IN (${inList})
      ORDER BY OpportunityId, CreatedDate
    `.replace(/\s+/g, ' ').trim();
    const res = await sf.queryAll(soql);
    all.push(...res);
    if (idx % 10 === 0 || idx === chunks.length) {
      console.log(`    [StageHistory] chunk ${idx}/${chunks.length}, 누적 ${all.length}`);
    }
  }
  return all;
}

// ==========================================================================
// FRT 계산
// ==========================================================================
const MQL_EXCLUDE_LOSS_REASONS = [
  '오생성', '오인입', '중복유입', '추가설치',
  '마케팅 전달', '전략실 전달', '파트너스 전달',
  '프랜차이즈본사문의', '기고객상담', '부서이관',
];

function isCleanInboundLead(lead) {
  // 1. test 회사 제외
  if (lead.Company && lead.Company.toLowerCase().includes('test')) return false;
  // 2. 오생성 제외
  if (lead.LossReason__c === '오생성') return false;
  return true;
}

/**
 * 영업시간(평일 09:00-18:00 KST) 보정 경과시간(분).
 * 단순 모델: 시작과 끝 사이의 영업시간 분만 카운트.
 *   - 평일 09:00~18:00 → 영업시간 9시간/일
 *   - 주말, 18:00~다음날 09:00은 카운트 제외
 * 공휴일은 비반영 (다음 단계 개선 여지).
 */
function businessMinutes(startMs, endMs) {
  if (endMs <= startMs) return 0;
  const MS_HOUR = 3600 * 1000;
  const BIZ_START_HOUR = 9;
  const BIZ_END_HOUR = 18;
  const BIZ_PER_DAY_MIN = (BIZ_END_HOUR - BIZ_START_HOUR) * 60;

  // KST 시간 다루기 위해 +9h 오프셋
  const KST_OFFSET = 9 * 60 * 60 * 1000;

  let total = 0;
  let cursor = startMs;
  let safety = 0;

  while (cursor < endMs && safety++ < 400) { // 400일 cap
    const cursorKst = new Date(cursor + KST_OFFSET);
    const y = cursorKst.getUTCFullYear();
    const m = cursorKst.getUTCMonth();
    const d = cursorKst.getUTCDate();
    const dow = cursorKst.getUTCDay(); // 0=일, 6=토 (KST 기준)

    // 해당 KST 일자의 영업시간 시작/끝 (UTC ms)
    const dayBizStartKst = Date.UTC(y, m, d, BIZ_START_HOUR, 0, 0);
    const dayBizEndKst   = Date.UTC(y, m, d, BIZ_END_HOUR, 0, 0);
    const dayBizStartUtc = dayBizStartKst - KST_OFFSET;
    const dayBizEndUtc   = dayBizEndKst   - KST_OFFSET;

    if (dow === 0 || dow === 6) {
      // 주말 → 다음날 00:00 KST 로 점프
      const nextDayKstMidnight = Date.UTC(y, m, d + 1, 0, 0, 0) - KST_OFFSET;
      cursor = nextDayKstMidnight;
      continue;
    }

    const slotStart = Math.max(cursor, dayBizStartUtc);
    const slotEnd = Math.min(endMs, dayBizEndUtc);

    if (slotStart < slotEnd) {
      total += (slotEnd - slotStart) / 1000 / 60;
    }

    // 다음 영업일 시작으로 점프
    const nextDayKstMidnight = Date.UTC(y, m, d + 1, 0, 0, 0) - KST_OFFSET;
    cursor = Math.max(cursor + 1, nextDayKstMidnight);
  }
  return Math.max(0, Math.min(total, BIZ_PER_DAY_MIN * 400));
}

// ==========================================================================
// 분포 통계
// ==========================================================================
function distributionStats(arr) {
  if (!arr || arr.length === 0) {
    return { count: 0, median: null, p25: null, p75: null, p90: null };
  }
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    count: sorted.length,
    median: round(median(sorted), 2),
    p25: round(percentile(sorted, 0.25), 2),
    p75: round(percentile(sorted, 0.75), 2),
    p90: round(percentile(sorted, 0.9), 2),
  };
}

// ==========================================================================
// Stage Dwell (Won 경로) — Q1 baseline 비교
// ==========================================================================
function buildStageDwellsForOpp(oppCreatedMs, currentStageName, transitions, terminalMs) {
  const dwells = [];
  const MS_PER_DAY = 86400000;

  if (!transitions || transitions.length === 0) {
    if (currentStageName && terminalMs && terminalMs >= oppCreatedMs) {
      dwells.push({
        stage: currentStageName,
        dwellDays: (terminalMs - oppCreatedMs) / MS_PER_DAY,
      });
    }
    return dwells;
  }

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

const TARGET_DWELL_TRANSITIONS = [
  { from: '방문배정', to: '견적' },
  { from: '견적', to: '계약진행' },
  { from: '계약진행', to: '선납금' },
  { from: '선납금', to: '출고진행' },
  { from: '출고진행', to: '설치진행' },
  { from: '설치진행', to: 'Closed Won' },
];

/**
 * 한 Opp의 전환 이력에서 from→to 직접 전환 dwell(일) 산출.
 * 같은 from에서 to로 가지 않고 다른 stage로 갔다가 결국 to에 도착했다면 from 진입 시점부터 to 진입 시점까지로 측정.
 */
function transitionDwellsForOpp(oppCreatedMs, transitions, terminalMs) {
  // Stage별 진입 이벤트 시간 계산 (재진입 포함, 첫 진입 이후 추가 진입은 별도 카운트하지 않음 - 단순화)
  const enterTimes = new Map();
  // 최초 stage 진입은 oppCreated로 가정
  if (transitions.length > 0 && transitions[0].oldValue && !enterTimes.has(transitions[0].oldValue)) {
    enterTimes.set(transitions[0].oldValue, oppCreatedMs);
  }
  for (const t of transitions) {
    if (!t.newValue) continue;
    if (!enterTimes.has(t.newValue)) enterTimes.set(t.newValue, t.createdMs);
  }

  const result = {};
  for (const tr of TARGET_DWELL_TRANSITIONS) {
    const fromMs = enterTimes.get(tr.from);
    const toMs = enterTimes.get(tr.to);
    if (fromMs && toMs && toMs >= fromMs) {
      result[`${tr.from}->${tr.to}`] = (toMs - fromMs) / 86400000;
    }
  }
  return result;
}

// Q1 baseline 로드
function loadQ1Baseline() {
  const p = path.join(__dirname, '..', '..', 'data', 'stage-dwell-inbound-q1-2026.json');
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  // wonPath → stage별 median/p75 매핑
  const m = {};
  for (const row of raw.wonPath) m[row.stage] = row;
  // transition별 baseline은 from stage 기준으로 매핑 (여기서는 from의 dwell 사용)
  return {
    raw,
    byStage: m,
  };
}

// CW 캐시 로드
function loadAprilCWCache() {
  const p = path.join(__dirname, '..', '..', 'data', 'april-team-split-tablets-2026.json');
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return raw.teams['인바운드'];
}

// ==========================================================================
// 메인
// ==========================================================================
async function main() {
  const startedAt = Date.now();

  console.log('=============================================');
  console.log('2026-04 인바운드 세일즈 속도 KPI');
  console.log('  본질: 응답 속도(FRT) + 처리 속도(Stage dwell)');
  console.log('  CW 태블릿은 후행 보조 지표');
  console.log('=============================================\n');

  // ---- 1) 인바운드 사용자 ----
  console.log('[1/7] 인바운드세일즈 사용자 조회...');
  const users = await fetchInboundUsers();
  const userIds = users.map(u => u.Id);
  const userIdSet = new Set(userIds);
  console.log(`  → ${users.length}명 (${users.map(u => u.Name).join(', ')})`);

  if (users.length === 0) {
    console.error('인바운드세일즈 활성 사용자가 없습니다. 종료.');
    return;
  }

  // ---- 2) 4월 Lead ----
  console.log('\n[2/7] 4월 인바운드 Lead 조회...');
  const rawLeads = await fetchAprilInboundLeads(userIds);
  const leads = rawLeads.filter(isCleanInboundLead);
  console.log(`  → 원본 ${rawLeads.length}건, 필터(test/오생성 제외) 후 ${leads.length}건`);

  const leadIds = leads.map(l => l.Id);

  // ---- 3) Task & LeadHistory ----
  console.log('\n[3/7] Task / LeadHistory 조회 (FRT용)...');
  const [firstTaskByLead, firstStatusChangeByLead] = await Promise.all([
    fetchFirstTasksByLead(leadIds, userIdSet),
    fetchLeadStatusFirstChange(leadIds),
  ]);
  console.log(`  → 첫 Task 매핑 ${firstTaskByLead.size} / Lead Status 첫 변경 매핑 ${firstStatusChangeByLead.size}`);

  // ---- 4) FRT 계산 ----
  console.log('\n[4/7] FRT 계산...');
  const frtRows = []; // { leadId, createdMs, dateStr, frtMin, frtBizMin, method, hasResponse }
  let methodTaskCount = 0;
  let methodHistoryCount = 0;
  let noResponseCount = 0;

  for (const lead of leads) {
    const createdMs = new Date(lead.CreatedDate).getTime();
    const dateStr = utcToKstDateStr(lead.CreatedDate);

    const taskInfo = firstTaskByLead.get(lead.Id);
    const histInfo = firstStatusChangeByLead.get(lead.Id);

    let respMs = null;
    let method = null;
    if (taskInfo && histInfo) {
      if (taskInfo.ts <= histInfo.ts) {
        respMs = taskInfo.ts; method = 'Task';
      } else {
        respMs = histInfo.ts; method = 'LeadHistory';
      }
    } else if (taskInfo) {
      respMs = taskInfo.ts; method = 'Task';
    } else if (histInfo) {
      respMs = histInfo.ts; method = 'LeadHistory';
    }

    if (respMs === null || respMs < createdMs) {
      noResponseCount++;
      frtRows.push({
        leadId: lead.Id, createdMs, dateStr, frtMin: null, frtBizMin: null, method: null, hasResponse: false,
        ownerId: lead.OwnerId,
      });
      continue;
    }

    if (method === 'Task') methodTaskCount++; else methodHistoryCount++;

    const frtMin = (respMs - createdMs) / 1000 / 60;
    const frtBizMin = businessMinutes(createdMs, respMs);

    frtRows.push({
      leadId: lead.Id, createdMs, dateStr,
      frtMin: round(frtMin, 2),
      frtBizMin: round(frtBizMin, 2),
      method,
      hasResponse: true,
      ownerId: lead.OwnerId,
    });
  }

  const dominantMethod = methodTaskCount >= methodHistoryCount ? 'Task 기반 우선' : 'LeadHistory 기반 우선';
  console.log(`  → 응답 있음 Task ${methodTaskCount} / LeadHistory ${methodHistoryCount} / 응답 없음 ${noResponseCount}`);
  console.log(`  → 우세 방법: ${dominantMethod}`);

  // FRT 분포 (응답 있는 건만)
  const frtMinutes = frtRows.filter(r => r.hasResponse).map(r => r.frtMin);
  const frtBizMinutes = frtRows.filter(r => r.hasResponse && r.frtBizMin !== null).map(r => r.frtBizMin);
  const frtStats = distributionStats(frtMinutes);
  const frtBizStats = distributionStats(frtBizMinutes);

  // 일자별 FRT
  const byDate = new Map();
  for (const r of frtRows) {
    if (!byDate.has(r.dateStr)) byDate.set(r.dateStr, []);
    byDate.get(r.dateStr).push(r);
  }
  const dailyFrt = [...byDate.keys()].sort().map(date => {
    const rows = byDate.get(date);
    const responded = rows.filter(r => r.hasResponse).map(r => r.frtMin);
    const stats = distributionStats(responded);
    return {
      date,
      count: rows.length,
      respondedCount: responded.length,
      median: stats.median,
      p75: stats.p75,
      p90: stats.p90,
    };
  });

  // ---- 5) SLA 준수율 ----
  const slaThresholds = [30, 60, 120];
  const sla = {};
  const totalLead = frtRows.length;
  for (const thr of slaThresholds) {
    const passed = frtRows.filter(r => r.hasResponse && r.frtMin <= thr).length;
    sla[`${thr}min`] = {
      threshold: thr,
      passed,
      total: totalLead,
      rate: totalLead > 0 ? round((passed / totalLead) * 100, 2) : 0,
    };
  }
  // 일자별 SLA (30분 기준 메인)
  const dailySla = [...byDate.keys()].sort().map(date => {
    const rows = byDate.get(date);
    const total = rows.length;
    const passed30 = rows.filter(r => r.hasResponse && r.frtMin <= 30).length;
    const passed60 = rows.filter(r => r.hasResponse && r.frtMin <= 60).length;
    return {
      date,
      total,
      passed30,
      passed60,
      rate30: total > 0 ? round((passed30 / total) * 100, 2) : 0,
      rate60: total > 0 ? round((passed60 / total) * 100, 2) : 0,
    };
  });

  // ---- 6) Stage Dwell — 4월 Won 인바운드 Opp ----
  console.log('\n[5/7] 4월 마감(Won) 인바운드 Opp 조회...');
  const wonOpps = await fetchAprilWonInboundOpps();
  console.log(`  → ${wonOpps.length}건`);

  let stageDwellResult = {};
  let q1Baseline = loadQ1Baseline();

  if (wonOpps.length > 0) {
    console.log('\n[6/7] Won Opp의 StageName 전환 이력 조회...');
    const wonOppIds = wonOpps.map(o => o.Id);
    const wonHistory = await fetchStageHistory(wonOppIds);
    console.log(`  → 이력 ${wonHistory.length}건`);

    // Opp별 transitions
    const transByOpp = new Map();
    const wonAtByOpp = new Map();
    for (const h of wonHistory) {
      if (!transByOpp.has(h.OpportunityId)) transByOpp.set(h.OpportunityId, []);
      const ts = new Date(h.CreatedDate).getTime();
      transByOpp.get(h.OpportunityId).push({ createdMs: ts, oldValue: h.OldValue, newValue: h.NewValue });
      if (h.NewValue === 'Closed Won') {
        const prev = wonAtByOpp.get(h.OpportunityId);
        if (!prev || ts > prev) wonAtByOpp.set(h.OpportunityId, ts);
      }
    }
    for (const arr of transByOpp.values()) arr.sort((a, b) => a.createdMs - b.createdMs);

    // Transition별 dwell 수집
    const transitionDwells = {};
    for (const tr of TARGET_DWELL_TRANSITIONS) {
      transitionDwells[`${tr.from}->${tr.to}`] = [];
    }
    for (const opp of wonOpps) {
      const oppCreatedMs = new Date(opp.CreatedDate).getTime();
      const transitions = transByOpp.get(opp.Id) || [];
      const wonAt = wonAtByOpp.get(opp.Id);
      const cut = wonAt ? transitions.filter(t => t.createdMs <= wonAt) : transitions;
      const trDwells = transitionDwellsForOpp(oppCreatedMs, cut, wonAt);
      for (const [key, days] of Object.entries(trDwells)) {
        if (transitionDwells[key]) transitionDwells[key].push(days);
      }
    }

    // 집계 + Q1 비교 (Q1 baseline은 stage(from)의 dwell median 사용)
    for (const tr of TARGET_DWELL_TRANSITIONS) {
      const key = `${tr.from}->${tr.to}`;
      const arr = transitionDwells[key];
      const stats = distributionStats(arr);
      const baseline = q1Baseline.byStage[tr.from];
      const baseMedian = baseline ? baseline.median : null;
      const baseP75 = baseline ? baseline.p75 : null;
      let changeMedianPct = null;
      let changeP75Pct = null;
      if (stats.median !== null && baseMedian) {
        changeMedianPct = round(((stats.median - baseMedian) / baseMedian) * 100, 1);
      }
      if (stats.p75 !== null && baseP75) {
        changeP75Pct = round(((stats.p75 - baseP75) / baseP75) * 100, 1);
      }
      stageDwellResult[key] = {
        sampleSize: stats.count,
        median: stats.median,
        p75: stats.p75,
        p90: stats.p90,
        q1BaselineMedian: baseMedian,
        q1BaselineP75: baseP75,
        q1BaselineNote: `Q1 baseline은 ${tr.from} stage 진입~다음 stage 진입까지의 dwell median/p75 (`
          + `data/stage-dwell-inbound-q1-2026.json wonPath 기준)`,
        changeMedianVsQ1Pct: changeMedianPct,
        changeP75VsQ1Pct: changeP75Pct,
      };
    }
  }

  // ---- 7) 24h 미응답 Lead, Stage 정체 Open Opp ----
  console.log('\n[7/7] 24h 미응답 Lead + Stage 정체 Open Opp 분석...');
  const NOW_MS = Date.now();
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  const unrespondedRows = frtRows.filter(r => !r.hasResponse && (NOW_MS - r.createdMs) >= TWENTY_FOUR_HOURS);
  const dailyUnresponded = {};
  for (const r of unrespondedRows) {
    dailyUnresponded[r.dateStr] = (dailyUnresponded[r.dateStr] || 0) + 1;
  }
  const dailyUnrespondedArr = Object.keys(dailyUnresponded).sort().map(d => ({
    date: d,
    count: dailyUnresponded[d],
  }));

  // Stage 정체 Open Opp
  const openOpps = await fetchOpenInboundOpps();
  console.log(`  → 현재 Open 인바운드 Opp ${openOpps.length}건`);

  const openOppIds = openOpps.map(o => o.Id);
  const openHistory = await fetchStageHistory(openOppIds);

  // Opp별 현재 Stage 진입 시각 계산
  const transByOppOpen = new Map();
  for (const h of openHistory) {
    if (!transByOppOpen.has(h.OpportunityId)) transByOppOpen.set(h.OpportunityId, []);
    transByOppOpen.get(h.OpportunityId).push({
      createdMs: new Date(h.CreatedDate).getTime(),
      oldValue: h.OldValue,
      newValue: h.NewValue,
    });
  }
  for (const arr of transByOppOpen.values()) arr.sort((a, b) => a.createdMs - b.createdMs);

  // Q1 P90 by stage (baseline)
  const q1P90ByStage = {};
  for (const row of q1Baseline.raw.wonPath) {
    // P90은 raw에 없음 → P75를 fallback으로 사용 (정체 정의 기준)
    // 명세는 P90이지만 baseline에 P90 없는 경우 P75 * 1.5로 대체.
    q1P90ByStage[row.stage] = row.p75 ? row.p75 * 1.5 : null; // approximation
  }

  const stuckByStage = {};
  const stuckList = [];
  for (const opp of openOpps) {
    const oppCreatedMs = new Date(opp.CreatedDate).getTime();
    const transitions = transByOppOpen.get(opp.Id) || [];
    let currentStageEnterMs = oppCreatedMs;
    if (transitions.length > 0) {
      // 마지막 newValue 전환 시각 = 현재 Stage 진입 시각
      currentStageEnterMs = transitions[transitions.length - 1].createdMs;
    }
    const dwellDays = (NOW_MS - currentStageEnterMs) / 86400000;
    const stage = opp.StageName;
    const threshold = q1P90ByStage[stage];
    if (threshold !== null && threshold !== undefined && dwellDays > threshold) {
      stuckByStage[stage] = (stuckByStage[stage] || 0) + 1;
      stuckList.push({
        id: opp.Id,
        name: opp.Name,
        stage,
        daysStuck: round(dwellDays, 1),
        ownerName: opp.Owner ? opp.Owner.Name : null,
        thresholdDays: round(threshold, 2),
      });
    }
  }
  stuckList.sort((a, b) => b.daysStuck - a.daysStuck);
  const top5Stuck = stuckList.slice(0, 5);

  // ---- 예외 룰 ----
  const exceptionRules = [];
  if (frtStats.median !== null && frtStats.median > 60) {
    exceptionRules.push(`INB-01 발동 (위험): FRT 중앙값 ${frtStats.median}분 > 60분 (SLA 30분 × 2)`);
  }
  if (sla['30min'].rate < 65) {
    exceptionRules.push(`INB-02 발동 (위험): SLA 30분 준수율 ${sla['30min'].rate}% < 65%`);
  }
  if (unrespondedRows.length >= 10) {
    exceptionRules.push(`INB-03 발동 (주의): 24h 미응답 Lead ${unrespondedRows.length}건 ≥ 10건`);
  }
  // INB-04: 견적→계약진행 dwell P75 vs Q1 baseline × 1.5
  const quoteToContract = stageDwellResult['견적->계약진행'];
  if (quoteToContract && quoteToContract.p75 !== null && quoteToContract.q1BaselineP75) {
    const limit = quoteToContract.q1BaselineP75 * 1.5;
    if (quoteToContract.p75 > limit) {
      exceptionRules.push(
        `INB-04 발동 (주의): 견적→계약진행 dwell P75 ${quoteToContract.p75}일 > Q1 baseline P75 ${quoteToContract.q1BaselineP75}일 × 1.5 (${round(limit, 2)}일)`
      );
    }
  }

  // ---- CW 캐시 보조 ----
  const inboundCache = loadAprilCWCache();
  const cwReference = {
    totalCWTablets: inboundCache.cwSignedTablets,
    cwSignedCount: inboundCache.cwSignedCount,
    fromCacheJson: 'data/april-team-split-tablets-2026.json',
    note: 'CW 태블릿은 인바운드 본질 KPI 아님 - 후행 보조 지표로만 표시',
  };

  // ---- 결과 조립 ----
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dataAsOf = `${today.getUTCFullYear()}-${pad2(today.getUTCMonth() + 1)}-${pad2(today.getUTCDate())}`;

  const payload = {
    period: '2026-04',
    dataAsOf,
    generatedAt: new Date().toISOString(),
    method: {
      sourceFilter: {
        leads: "Lead WHERE CreatedDate ∈ 2026-04 KST AND OwnerId IN (User.Department='인바운드세일즈' AND IsActive=true)",
        leadCleanFilter: "Company에 'test' 포함 OR LossReason__c='오생성' 제외",
        wonOpps: "Opportunity WHERE Owner_Department__c='인바운드세일즈' AND IsWon=true AND CloseDate ∈ 2026-04",
        openOpps: "Opportunity WHERE Owner_Department__c='인바운드세일즈' AND IsClosed=false",
      },
      frt: {
        definition: '첫 응답 = (Task WHERE Lead__c=Lead, OwnerId∈인바운드사용자) 또는 (LeadHistory.Field=Status 첫 변경) 중 더 이른 시각',
        unit: '분 (KST)',
        businessHourModel: '평일 09:00-18:00 KST (공휴일 미반영)',
        primaryMethod: dominantMethod,
        methodMix: { task: methodTaskCount, history: methodHistoryCount, noResponse: noResponseCount },
        statistics: '중앙값 / P25 / P75 / P90 (평균 미사용)',
      },
      stageDwell: {
        definition: 'from stage 진입 시각 ~ to stage 진입 시각 (일)',
        sampling: 'from/to 둘 다 진입한 Opp만 카운트, 같은 Opp 내 stage 첫 진입만 사용 (재진입 무시)',
        baseline: 'Q1 2026 wonPath stage별 median/p75 (data/stage-dwell-inbound-q1-2026.json)',
      },
      stuckOpps: {
        definition: '현재 Stage 체류시간 > Q1 baseline Stage P75 × 1.5 (P90 baseline 부재로 P75×1.5로 근사)',
        currentStageEnter: 'OpportunityFieldHistory.Field=StageName의 마지막 전환 시각, 없으면 Opp.CreatedDate',
      },
    },
    counts: {
      inboundUsers: users.length,
      aprilLeads: rawLeads.length,
      aprilLeadsClean: leads.length,
      aprilWonOpps: wonOpps.length,
      currentOpenOpps: openOpps.length,
    },
    frt: {
      method: dominantMethod,
      methodMix: { task: methodTaskCount, history: methodHistoryCount, noResponse: noResponseCount },
      median: frtStats.median,
      p25: frtStats.p25,
      p75: frtStats.p75,
      p90: frtStats.p90,
      sampleSize: frtStats.count,
      unit: '분',
      businessHourAdjusted: {
        median: frtBizStats.median,
        p25: frtBizStats.p25,
        p75: frtBizStats.p75,
        p90: frtBizStats.p90,
        sampleSize: frtBizStats.count,
        unit: '분 (영업시간 평일 09-18 KST 기준)',
      },
      daily: dailyFrt,
    },
    sla: {
      ...sla,
      daily: dailySla,
    },
    stageDwell: stageDwellResult,
    unresponded24h: {
      total: unrespondedRows.length,
      daily: dailyUnrespondedArr,
    },
    stuckOpps: {
      byStage: stuckByStage,
      top5: top5Stuck,
      total: stuckList.length,
    },
    cwReference,
    exceptionRules,
  };

  // ---- 저장 ----
  const outDir = path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'april-inbound-speed-2026.json');
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

  // ---- 콘솔 출력 ----
  console.log('\n=============================================');
  console.log('결과 요약 (2026-04 인바운드 속도 KPI)');
  console.log('=============================================');

  console.log('\n[A] FRT 분포 (4월 전체, 단위: 분)');
  console.log(`  계산 방법: ${dominantMethod} (Task ${methodTaskCount} / History ${methodHistoryCount} / 응답없음 ${noResponseCount})`);
  console.log(`  표본수: ${frtStats.count}`);
  console.log(`  중앙값: ${frtStats.median} 분`);
  console.log(`  P25:    ${frtStats.p25} 분`);
  console.log(`  P75:    ${frtStats.p75} 분`);
  console.log(`  P90:    ${frtStats.p90} 분`);
  console.log(`  영업시간 보정 중앙값: ${frtBizStats.median} 분 / P75 ${frtBizStats.p75} / P90 ${frtBizStats.p90}`);

  console.log('\n[B] SLA 준수율 (전체 인바운드 Lead 기준)');
  for (const k of ['30min', '60min', '120min']) {
    const s = sla[k];
    console.log(`  ${k.padEnd(6)} : ${s.rate}% (${s.passed}/${s.total})`);
  }

  console.log('\n[C] Stage Dwell (4월 Won 인바운드 Opp, 단위: 일)');
  console.log('  구간 | 표본 | 중앙값 | P75 | P90 | Q1 baseline (median/P75) | 변화율(median/P75)');
  console.log('  ' + '-'.repeat(110));
  for (const tr of TARGET_DWELL_TRANSITIONS) {
    const key = `${tr.from}->${tr.to}`;
    const r = stageDwellResult[key];
    if (!r) {
      console.log(`  ${key} | (Won opp 없음)`);
      continue;
    }
    console.log(
      `  ${key.padEnd(22)} | n=${String(r.sampleSize).padStart(4)} | ${String(r.median).padStart(6)} | ${String(r.p75).padStart(6)} | ${String(r.p90).padStart(6)} | ${String(r.q1BaselineMedian).padStart(6)} / ${String(r.q1BaselineP75).padStart(6)} | ${r.changeMedianVsQ1Pct === null ? '-' : (r.changeMedianVsQ1Pct >= 0 ? '+' : '') + r.changeMedianVsQ1Pct + '%'} / ${r.changeP75VsQ1Pct === null ? '-' : (r.changeP75VsQ1Pct >= 0 ? '+' : '') + r.changeP75VsQ1Pct + '%'}`
    );
  }

  console.log('\n[D] 24h 미응답 Lead');
  console.log(`  총 ${unrespondedRows.length}건 (현재 시각 기준 24h 경과 + 첫 응답 없음)`);
  if (dailyUnrespondedArr.length > 0) {
    console.log('  일자별:');
    for (const d of dailyUnrespondedArr) console.log(`    ${d.date}: ${d.count}건`);
  }

  console.log('\n[E] Stage 정체 Open Opp');
  console.log(`  총 정체 건수: ${stuckList.length} (Q1 baseline P75 × 1.5 초과)`);
  for (const [stage, count] of Object.entries(stuckByStage)) {
    console.log(`    ${stage}: ${count}건`);
  }
  console.log('  Top 5 정체 Opp:');
  for (const o of top5Stuck) {
    console.log(`    [${o.id}] ${o.stage} - ${o.daysStuck}일 체류 (담당 ${o.ownerName || '-'}, 임계값 ${o.thresholdDays}일)`);
  }

  console.log('\n[F] (참고) CW 태블릿 — 후행 지표');
  console.log(`  4월 인바운드 CW 태블릿: ${cwReference.totalCWTablets}대 (${cwReference.cwSignedCount}건)`);
  console.log(`  출처: ${cwReference.fromCacheJson}`);

  console.log('\n[예외 룰 발동]');
  if (exceptionRules.length === 0) {
    console.log('  발동된 예외 룰 없음');
  } else {
    for (const e of exceptionRules) console.log(`  - ${e}`);
  }

  console.log(`\n저장: ${outPath}`);
  console.log(`총 소요: ${((Date.now() - startedAt) / 1000).toFixed(1)}초`);
}

main().catch(err => {
  console.error('\n오류:', err.response?.data || err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
