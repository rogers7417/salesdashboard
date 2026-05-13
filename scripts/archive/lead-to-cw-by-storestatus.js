/**
 * Lead → CW leadtime 비교: 오픈전 vs 운영중
 *
 * 각 그룹별 최근 CW 신규 Opp 10건 샘플
 *   - 그룹 A: fm_CompanyStatus__c = '오픈전'
 *   - 그룹 B: fm_CompanyStatus__c != '오픈전' (운영중)
 *
 * 출력
 *   1) 그룹별 10건 리스트 (Lead→CW, 단계별 dwell)
 *   2) 그룹별 분포 요약
 *   3) Stage별 합산 비교
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const sf = require('../../server/api/services/salesforce');

const SAMPLE_SIZE = 10;

const GROUPS = [
  { key: 'preopen',   label: '오픈전',  where: `fm_CompanyStatus__c = '오픈전'` },
  { key: 'operating', label: '운영중',  where: `(fm_CompanyStatus__c != '오픈전' OR fm_CompanyStatus__c = NULL)` },
];

// ---------- 유틸 ----------
function toKstString(iso) {
  if (!iso) return '(없음)';
  const t = new Date(iso).getTime() + 9 * 60 * 60 * 1000;
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function diffHours(a, b) { if (!a || !b) return null; return Math.round((new Date(b) - new Date(a)) / 36e5 * 10) / 10; }
function diffDays(a, b)  { if (!a || !b) return null; return Math.round((new Date(b) - new Date(a)) / 864e5 * 10) / 10; }
function round1(n) { return n == null ? null : Math.round(n * 10) / 10; }
function median(sorted) {
  if (!sorted.length) return null;
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}
function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (1 - (idx - lo)) + sorted[hi] * (idx - lo);
}

function buildStageDwells(oppCreatedMs, currentStageName, transitions, terminalMs) {
  const out = [];
  const D = 86400000;
  if (!transitions || transitions.length === 0) {
    if (currentStageName && terminalMs && terminalMs >= oppCreatedMs) {
      out.push({ stage: currentStageName, dwellDays: (terminalMs - oppCreatedMs) / D });
    }
    return out;
  }
  const first = transitions[0];
  if (first.oldValue && first.createdMs >= oppCreatedMs) {
    out.push({ stage: first.oldValue, dwellDays: (first.createdMs - oppCreatedMs) / D });
  }
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    if (!t.newValue) continue;
    const exitMs = i + 1 < transitions.length ? transitions[i + 1].createdMs : terminalMs;
    if (exitMs == null || exitMs < t.createdMs) continue;
    out.push({ stage: t.newValue, dwellDays: (exitMs - t.createdMs) / D });
  }
  return out;
}

// ---------- 그룹 분석 ----------
async function analyzeGroup(group) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  [${group.label}] 최근 CW 신규 Opp ${SAMPLE_SIZE}건`);
  console.log('='.repeat(70));

  const oppSoql = `
    SELECT Id, Name, StageName, IsWon, CreatedDate, CloseDate, LastStageChangeDate,
           Owner.Name, Owner_Department__c, Account.Name, LeadSource, Amount,
           fm_CompanyStatus__c
    FROM Opportunity
    WHERE RecordType.Name = '1. 테이블오더 (신규)'
      AND IsWon = true
      AND Owner_Department__c IN ('인바운드세일즈', '채널세일즈팀')
      AND CreatedDate = LAST_N_MONTHS:6
      AND ${group.where}
    ORDER BY LastStageChangeDate DESC
    LIMIT ${SAMPLE_SIZE}
  `.replace(/\s+/g, ' ').trim();

  const opps = await sf.queryAll(oppSoql);
  console.log(`Opp ${opps.length}건 수신`);
  if (!opps.length) return { group, rows: [], stageMap: new Map(), totalDays: [] };

  const oppIdList = opps.map((o) => `'${o.Id}'`).join(',');

  const [leads, hist, visits] = await Promise.all([
    sf.queryAll(`
      SELECT Id, Name, Company, Status, CreatedDate, ConvertedDate, ConvertedOpportunityId, LeadSource
      FROM Lead
      WHERE ConvertedOpportunityId IN (${oppIdList})
    `.replace(/\s+/g, ' ').trim()),
    sf.queryAll(`
      SELECT OpportunityId, CreatedDate, NewValue, OldValue
      FROM OpportunityFieldHistory
      WHERE Field = 'StageName' AND OpportunityId IN (${oppIdList})
      ORDER BY OpportunityId, CreatedDate
    `.replace(/\s+/g, ' ').trim()),
    sf.queryAll(`
      SELECT Id, Opportunity__c, IsVisitComplete__c, Visit_Status__c,
             ConselStart__c, ConselEnd__c, VisitAssignmentDate__c
      FROM Visit__c
      WHERE Opportunity__c IN (${oppIdList})
        AND IsVisitComplete__c = true
    `.replace(/\s+/g, ' ').trim()),
  ]);

  // Opp별 첫 방문완료 (ConselEnd__c 가장 이른 것)
  const firstVisitByOpp = new Map();
  visits.forEach((v) => {
    const ts = v.ConselEnd__c || v.ConselStart__c;
    if (!ts) return;
    const prev = firstVisitByOpp.get(v.Opportunity__c);
    if (!prev || new Date(ts) < new Date(prev.ts)) {
      firstVisitByOpp.set(v.Opportunity__c, { ts, raw: v });
    }
  });

  const leadByOppId = new Map();
  leads.forEach((l) => {
    if (!l.ConvertedOpportunityId) return;
    const prev = leadByOppId.get(l.ConvertedOpportunityId);
    if (!prev || new Date(l.CreatedDate) < new Date(prev.CreatedDate)) {
      leadByOppId.set(l.ConvertedOpportunityId, l);
    }
  });

  const transByOpp = new Map();
  hist.forEach((h) => {
    const arr = transByOpp.get(h.OpportunityId) || [];
    arr.push({ createdMs: new Date(h.CreatedDate).getTime(), oldValue: h.OldValue, newValue: h.NewValue });
    transByOpp.set(h.OpportunityId, arr);
  });

  const stageMap = new Map();
  const totalDays = [];
  const rows = [];

  opps.forEach((opp, idx) => {
    const lead = leadByOppId.get(opp.Id);
    const cwIso = opp.LastStageChangeDate || opp.CloseDate;
    const oppCreatedMs = new Date(opp.CreatedDate).getTime();
    const cwMs = new Date(cwIso).getTime();
    const trans = transByOpp.get(opp.Id) || [];
    const dwells = buildStageDwells(oppCreatedMs, opp.StageName, trans, cwMs);

    dwells.forEach((d) => {
      const arr = stageMap.get(d.stage) || [];
      arr.push(d.dwellDays);
      stageMap.set(d.stage, arr);
    });

    const total = lead ? diffDays(lead.CreatedDate, cwIso) : diffDays(opp.CreatedDate, cwIso);
    if (total != null) totalDays.push(total);

    const firstVisit = firstVisitByOpp.get(opp.Id);
    const visitTs = firstVisit?.ts;

    rows.push({
      idx: idx + 1,
      name: opp.Name,
      account: opp.Account?.Name || '',
      owner: opp.Owner?.Name || '',
      hasLead: !!lead,
      leadCreatedKst: lead ? toKstString(lead.CreatedDate) : '(Lead 없음)',
      visitKst: visitTs ? toKstString(visitTs) : '(방문완료 없음)',
      oppToVisit: diffDays(opp.CreatedDate, visitTs),
      visitToCw: diffDays(visitTs, cwIso),
      cwKst: toKstString(cwIso),
      total,
      oppToCw: diffDays(opp.CreatedDate, cwIso),
      companyStatus: opp.fm_CompanyStatus__c || '(없음)',
    });
  });

  // 출력 — 리스트
  console.log(`\n[리스트]`);
  console.log(`${'#'.padStart(2)}  ${'담당'.padEnd(7)} ${'Lead 인입'.padEnd(17)} ${'방문완료'.padEnd(17)} ${'CW일'.padEnd(17)}  ${'Opp→방문'.padStart(8)}  ${'방문→CW'.padStart(8)}  ${'Lead→CW'.padStart(8)}  매장`);
  console.log('-'.repeat(150));
  rows.forEach((r) => {
    const totalStr = r.total != null ? `${r.total}일` : '(N/A)';
    const visitDelta = r.oppToVisit != null ? `${r.oppToVisit}일` : '—';
    const visitToCwStr = r.visitToCw != null ? `${r.visitToCw}일` : '—';
    const leadCol = r.hasLead ? r.leadCreatedKst : '(Lead 없음)';
    console.log(
      `${String(r.idx).padStart(2)}  ${r.owner.padEnd(7)} ${leadCol.padEnd(17)} ${r.visitKst.padEnd(17)} ${r.cwKst.padEnd(17)}  ${visitDelta.padStart(8)}  ${visitToCwStr.padStart(8)}  ${totalStr.padStart(8)}  ${r.name}`
    );
  });

  return { group, rows, stageMap, totalDays };
}

function summarize(label, totalDays) {
  if (!totalDays.length) return null;
  const sorted = [...totalDays].sort((a, b) => a - b);
  return {
    label,
    n: sorted.length,
    median: round1(median(sorted)),
    p25: round1(percentile(sorted, 0.25)),
    p75: round1(percentile(sorted, 0.75)),
    p90: round1(percentile(sorted, 0.90)),
    min: round1(sorted[0]),
    max: round1(sorted[sorted.length - 1]),
  };
}

(async () => {
  const results = [];
  for (const g of GROUPS) results.push(await analyzeGroup(g));

  // 분포 비교
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  분포 비교: Lead → CW 전체 (일)`);
  console.log('='.repeat(70));
  console.log(`${'그룹'.padEnd(6)}  ${'n'.padStart(3)}  ${'중앙'.padStart(6)}  ${'P25'.padStart(6)}  ${'P75'.padStart(6)}  ${'P90'.padStart(6)}  ${'최소'.padStart(6)}  ${'최대'.padStart(6)}`);
  console.log('-'.repeat(70));
  results.forEach((r) => {
    const s = summarize(r.group.label, r.totalDays);
    if (!s) return;
    console.log(`${r.group.label.padEnd(6)}  ${String(s.n).padStart(3)}  ${String(s.median).padStart(5)}일  ${String(s.p25).padStart(5)}일  ${String(s.p75).padStart(5)}일  ${String(s.p90).padStart(5)}일  ${String(s.min).padStart(5)}일  ${String(s.max).padStart(5)}일`);
  });

  // Stage별 합산 비교
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  Stage별 체류 비교 (그룹 내 합산, n=재진입 포함)`);
  console.log('='.repeat(70));
  const allStages = new Set();
  results.forEach((r) => r.stageMap.forEach((_, s) => allStages.add(s)));
  console.log(`${'Stage'.padEnd(15)}  ${'오픈전 n/중앙/합'.padEnd(22)}  ${'운영중 n/중앙/합'.padEnd(22)}`);
  console.log('-'.repeat(70));
  [...allStages].forEach((stage) => {
    const cells = results.map((r) => {
      const arr = r.stageMap.get(stage);
      if (!arr || !arr.length) return '       —             ';
      const sorted = [...arr].sort((a, b) => a - b);
      const m = round1(median(sorted));
      const sum = round1(sorted.reduce((s, v) => s + v, 0));
      return `n=${String(sorted.length).padStart(2)}  ${String(m).padStart(5)}일  Σ${String(sum).padStart(5)}일 `;
    });
    console.log(`${stage.padEnd(15)}  ${cells[0]}  ${cells[1]}`);
  });
})().catch((e) => { console.error('실패:', e?.message || e); if (e?.response?.data) console.error(JSON.stringify(e.response.data, null, 2)); process.exit(1); });
