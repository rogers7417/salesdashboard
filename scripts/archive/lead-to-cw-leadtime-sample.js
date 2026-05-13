/**
 * Lead → Closed Won 전체 leadtime 샘플 분석
 * 최근 CW된 "1. 테이블오더 (신규)" Opp 10건 → ConvertedOpportunityId로 Lead 역추적
 *   Lead 인입(CreatedDate) → Opp 생성(CreatedDate) → CW(LastStageChangeDate)
 *
 * SOQL SELECT only. 표시 시간은 KST.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const sf = require('../../server/api/services/salesforce');

const SAMPLE_SIZE = 10;

function toKstString(iso) {
  if (!iso) return '(없음)';
  const t = new Date(iso).getTime() + 9 * 60 * 60 * 1000;
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function diffHours(aIso, bIso) {
  if (!aIso || !bIso) return null;
  const ms = new Date(bIso).getTime() - new Date(aIso).getTime();
  return Math.round((ms / (1000 * 60 * 60)) * 10) / 10;
}

function diffDays(aIso, bIso) {
  if (!aIso || !bIso) return null;
  const ms = new Date(bIso).getTime() - new Date(aIso).getTime();
  return Math.round((ms / (1000 * 60 * 60 * 24)) * 10) / 10;
}

function median(sortedNums) {
  if (!sortedNums.length) return null;
  const i = Math.floor(sortedNums.length / 2);
  return sortedNums.length % 2 ? sortedNums[i] : (sortedNums[i - 1] + sortedNums[i]) / 2;
}

function round1(n) { return n == null ? null : Math.round(n * 10) / 10; }

/**
 * Opp의 StageName 전환 이력 → 단계별 체류 구간 배열.
 * 같은 Stage 재진입은 별도 entry로 기록.
 */
function buildStageDwells(oppCreatedMs, currentStageName, transitions, terminalMs) {
  const dwells = [];
  const MS_PER_DAY = 86400000;
  if (!transitions || transitions.length === 0) {
    if (currentStageName && terminalMs && terminalMs >= oppCreatedMs) {
      dwells.push({ stage: currentStageName, dwellDays: (terminalMs - oppCreatedMs) / MS_PER_DAY });
    }
    return dwells;
  }
  const first = transitions[0];
  if (first.oldValue) {
    const exitMs = first.createdMs;
    if (exitMs >= oppCreatedMs) {
      dwells.push({ stage: first.oldValue, dwellDays: (exitMs - oppCreatedMs) / MS_PER_DAY });
    }
  }
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    if (!t.newValue) continue;
    const entryMs = t.createdMs;
    const exitMs = i + 1 < transitions.length ? transitions[i + 1].createdMs : terminalMs;
    if (exitMs == null || exitMs < entryMs) continue;
    dwells.push({ stage: t.newValue, dwellDays: (exitMs - entryMs) / MS_PER_DAY });
  }
  return dwells;
}

async function main() {
  console.log('====================================================');
  console.log('  Lead → CW 전체 leadtime 분석 (신규 Opp 샘플)');
  console.log('====================================================\n');

  // 1) 최근 CW 신규 Opp
  //    - Lead-driven 팀(인바운드/채널)만
  //    - 레거시 마이그레이션 레코드 제외 (CreatedDate >= 6개월)
  //    - LastStageChangeDate가 CreatedDate보다 늦은 것만 (정상 진행)
  const oppSoql = `
    SELECT Id, Name, StageName, IsWon, IsClosed,
           CreatedDate, CloseDate, LastStageChangeDate,
           Owner.Name, Owner_Department__c,
           Account.Name, LeadSource, Amount,
           RecordType.Name
    FROM Opportunity
    WHERE RecordType.Name = '1. 테이블오더 (신규)'
      AND IsWon = true
      AND Owner_Department__c IN ('인바운드세일즈', '채널세일즈팀')
      AND CreatedDate = LAST_N_MONTHS:6
    ORDER BY LastStageChangeDate DESC
    LIMIT ${SAMPLE_SIZE}
  `.replace(/\s+/g, ' ').trim();

  console.log(`[1/3] 최근 CW 신규 Opp ${SAMPLE_SIZE}건 조회 중...`);
  const opps = await sf.queryAll(oppSoql);
  console.log(`      → ${opps.length}건 수신\n`);

  if (!opps.length) {
    console.log('CW Opp가 없습니다. 종료.');
    return;
  }

  // 2) Lead 역추적
  const oppIdList = opps.map((o) => `'${o.Id}'`).join(',');
  const leadSoql = `
    SELECT Id, Name, Company, Status,
           CreatedDate, ConvertedDate, ConvertedOpportunityId,
           LeadSource, Owner.Name
    FROM Lead
    WHERE ConvertedOpportunityId IN (${oppIdList})
  `.replace(/\s+/g, ' ').trim();

  console.log(`[2/3] 연결된 Lead 조회 중...`);
  const leads = await sf.queryAll(leadSoql);
  console.log(`      → Lead ${leads.length}건 수신\n`);

  const leadByOppId = new Map();
  leads.forEach((l) => {
    if (l.ConvertedOpportunityId) {
      // 한 Opp에 여러 Lead가 있을 수 있음 → 가장 먼저 만든 Lead 채택
      const prev = leadByOppId.get(l.ConvertedOpportunityId);
      if (!prev || new Date(l.CreatedDate) < new Date(prev.CreatedDate)) {
        leadByOppId.set(l.ConvertedOpportunityId, l);
      }
    }
  });

  // 3) Stage 전환 이력 (OpportunityFieldHistory)
  const historySoql = `
    SELECT OpportunityId, CreatedDate, NewValue, OldValue
    FROM OpportunityFieldHistory
    WHERE Field = 'StageName'
      AND OpportunityId IN (${oppIdList})
    ORDER BY OpportunityId, CreatedDate
  `.replace(/\s+/g, ' ').trim();

  console.log(`[3/3] Stage 전환 이력 조회 중...`);
  const histRows = await sf.queryAll(historySoql);
  console.log(`      → 전환 이벤트 ${histRows.length}건 수신\n`);

  const transitionsByOpp = new Map();
  histRows.forEach((h) => {
    const arr = transitionsByOpp.get(h.OpportunityId) || [];
    arr.push({
      createdMs: new Date(h.CreatedDate).getTime(),
      createdIso: h.CreatedDate,
      oldValue: h.OldValue,
      newValue: h.NewValue,
    });
    transitionsByOpp.set(h.OpportunityId, arr);
  });

  // 4) 출력
  console.log('===== 샘플 상세 =====\n');

  const allDays = [];
  const phase1Days = []; // Lead → Opp 생성
  const phase2Days = []; // Opp 생성 → CW
  const stageAggregate = new Map(); // stage → [dwellDays...]

  opps.forEach((opp, idx) => {
    const lead = leadByOppId.get(opp.Id);
    const cwIso = opp.LastStageChangeDate || opp.CloseDate;
    const cwMs = new Date(cwIso).getTime();
    const oppCreatedMs = new Date(opp.CreatedDate).getTime();

    console.log(`[${idx + 1}] ${opp.Name}`);
    console.log(`    계정: ${opp.Account?.Name || '(없음)'}`);
    console.log(`    팀/담당: ${opp.Owner_Department__c || '(없음)'} / ${opp.Owner?.Name || '(없음)'}`);
    console.log(`    LeadSource(Opp): ${opp.LeadSource || '(없음)'}`);
    console.log(`    Amount: ${opp.Amount != null ? opp.Amount.toLocaleString() : '(없음)'}`);

    if (!lead) {
      console.log(`    ⚠️ 연결된 Lead 없음 — Opp 직접 생성 케이스`);
      console.log(`       Opp 생성 → CW: ${diffDays(opp.CreatedDate, cwIso)}일`);
      console.log(`       Opp 생성: ${toKstString(opp.CreatedDate)} (KST)`);
      console.log(`       CW: ${toKstString(cwIso)} (KST)`);
    } else {
      const leadToOpp = diffHours(lead.CreatedDate, opp.CreatedDate);
      const oppToCw = diffDays(opp.CreatedDate, cwIso);
      const total = diffDays(lead.CreatedDate, cwIso);

      if (total != null) allDays.push(total);
      if (leadToOpp != null) phase1Days.push(leadToOpp / 24);
      if (oppToCw != null) phase2Days.push(oppToCw);

      console.log(`    Lead: ${lead.Name} (${lead.Company || '회사명 없음'}) — Status=${lead.Status}`);
      console.log(`    LeadSource(Lead): ${lead.LeadSource || '(없음)'}`);
      console.log(`    ┌─ Lead 인입       : ${toKstString(lead.CreatedDate)} (KST)`);
      console.log(`    ├─ Lead Convert   : ${lead.ConvertedDate || '(N/A)'}`);
      console.log(`    ├─ Opp 생성       : ${toKstString(opp.CreatedDate)} (KST)`);
      console.log(`    └─ CW             : ${toKstString(cwIso)} (KST)`);
      console.log(`       ① Lead→Opp 생성 : ${leadToOpp != null ? leadToOpp + 'h (' + Math.round(leadToOpp / 24 * 10) / 10 + '일)' : '(N/A)'}`);
      console.log(`       ② Opp→CW       : ${oppToCw}일`);
      console.log(`       ▶ Lead→CW 전체  : ${total}일`);
    }

    // Stage 체류 구간
    const trans = transitionsByOpp.get(opp.Id) || [];
    const dwells = buildStageDwells(oppCreatedMs, opp.StageName, trans, cwMs);
    if (dwells.length === 0) {
      console.log(`    [Stage 체류] 전환 이력 없음 (생성 직후 즉시 CW)`);
    } else {
      console.log(`    [Stage 체류] 전환 ${trans.length}회`);
      dwells.forEach((d, i) => {
        const days = round1(d.dwellDays);
        const label = i === dwells.length - 1 ? '└─' : '├─';
        console.log(`       ${label} ${d.stage.padEnd(20)} ${String(days).padStart(6)}일`);
        const arr = stageAggregate.get(d.stage) || [];
        arr.push(d.dwellDays);
        stageAggregate.set(d.stage, arr);
      });
    }
    console.log('');
  });

  // 4) 분포 요약
  console.log('===== 분포 요약 (Lead 매핑된 케이스만) =====');
  if (!allDays.length) {
    console.log('Lead 매핑된 케이스 없음.');
    return;
  }
  const sorted = [...allDays].sort((a, b) => a - b);
  const sortedP1 = [...phase1Days].sort((a, b) => a - b);
  const sortedP2 = [...phase2Days].sort((a, b) => a - b);

  console.log(`  n = ${sorted.length}`);
  console.log(`  Lead → CW 전체:`);
  console.log(`    중앙값: ${median(sorted)}일 | 최소: ${sorted[0]}일 | 최대: ${sorted[sorted.length - 1]}일`);
  console.log(`  ① Lead → Opp 생성: 중앙값 ${round1(median(sortedP1))}일`);
  console.log(`  ② Opp 생성 → CW : 중앙값 ${round1(median(sortedP2))}일`);

  // Stage별 dwell 집계
  console.log('\n===== Stage별 체류 분포 (10건 합산, 재진입 포함) =====');
  const stageRows = [];
  stageAggregate.forEach((arr, stage) => {
    const sorted = [...arr].sort((a, b) => a - b);
    stageRows.push({
      stage,
      n: sorted.length,
      median: round1(median(sorted)),
      sum: round1(sorted.reduce((s, v) => s + v, 0)),
      min: round1(sorted[0]),
      max: round1(sorted[sorted.length - 1]),
    });
  });
  stageRows.sort((a, b) => b.median - a.median);
  console.log(`  ${'Stage'.padEnd(22)} ${'n'.padStart(3)}  ${'중앙'.padStart(7)}  ${'합계'.padStart(8)}  ${'min'.padStart(6)}  ${'max'.padStart(6)}`);
  console.log('  ' + '-'.repeat(64));
  stageRows.forEach((r) => {
    console.log(`  ${r.stage.padEnd(22)} ${String(r.n).padStart(3)}  ${String(r.median).padStart(6)}일  ${String(r.sum).padStart(7)}일  ${String(r.min).padStart(5)}일  ${String(r.max).padStart(5)}일`);
  });
}

main().catch((e) => {
  console.error('실패:', e?.message || e);
  if (e?.response?.data) console.error(JSON.stringify(e.response.data, null, 2));
  process.exit(1);
});
