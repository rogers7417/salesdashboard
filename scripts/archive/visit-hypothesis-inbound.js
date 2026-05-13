/**
 * 가설 검증 v2 (인바운드세일즈 한정, 정확한 데이터)
 *
 * 변경점 (v1 대비):
 *   ✓ 부서 = '인바운드세일즈'만 (채널세일즈팀 제외)
 *   ✓ Lead Owner: Active + Inactive 모두 포함
 *   ✓ Lead 노이즈 제외: 오생성 / 아웃바운드 / test
 *   ✓ 4월 마감 범위: 4월 1일 ~ 4월 27일 (28일 오늘 미완성 제외)
 *
 * 검증 항목:
 *   ① 월별 Lead 인입 수
 *   ② 월별 방문완료 수
 *   ③ 월별 CW 매장의 방문 횟수 분포
 *   ④ 월별 마지막 방문 → CW 7일 이내 마감률
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const sf = require('../../server/api/services/salesforce');

function kstStartUtcIso(y, m, d = 1) { return new Date(Date.UTC(y, m - 1, d - 1, 15, 0, 0)).toISOString(); }
const RANGE_START      = kstStartUtcIso(2026, 1, 1);  // 2026-01-01 00:00 KST
const RANGE_END        = kstStartUtcIso(2026, 5, 1);  // 2026-05-01 00:00 KST (Opp/Visit 데이터 풀 조회용)
const APRIL_CW_CUTOFF  = kstStartUtcIso(2026, 4, 28); // 4-28 00:00 KST = 4-27 23:59:59까지

function kstMonthKey(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime() + 9 * 60 * 60 * 1000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function diffDays(a, b) { if (!a || !b) return null; return (new Date(b) - new Date(a)) / 86400000; }
function pad(s, n) { return String(s).padEnd(n); }
function padR(s, n) { return String(s).padStart(n); }

(async () => {
  // [1] 인바운드세일즈 User 전체 (Active+Inactive)
  console.log('[1/5] 인바운드세일즈 User 조회 (Active+Inactive)...');
  const users = await sf.queryAll(`
    SELECT Id, Name, IsActive
    FROM User
    WHERE Department = '인바운드세일즈'
  `.replace(/\s+/g, ' ').trim());
  console.log(`     ${users.length}명 (Active ${users.filter((u) => u.IsActive).length})`);
  const userIdList = users.map((u) => `'${u.Id}'`).join(',');

  // [2] 월별 Lead 인입 (노이즈 제외)
  console.log('[2/5] Lead 인입 조회...');
  const leadsRaw = await sf.queryAll(`
    SELECT Id, OwnerId, CreatedDate, LeadSource, LossReason__c, ServiceType__c, Company
    FROM Lead
    WHERE OwnerId IN (${userIdList})
      AND CreatedDate >= ${RANGE_START}
      AND CreatedDate < ${RANGE_END}
  `.replace(/\s+/g, ' ').trim());
  const leads = leadsRaw.filter((l) =>
    l.LossReason__c !== '오생성' &&
    l.LeadSource !== '아웃바운드' &&
    !(l.Company && l.Company.toLowerCase().includes('test'))
  );
  console.log(`     원본 ${leadsRaw.length} → 노이즈 제외 ${leads.length}건`);

  const leadByMonth = { '2026-01': 0, '2026-02': 0, '2026-03': 0, '2026-04': 0 };
  leads.forEach((l) => {
    const m = kstMonthKey(l.CreatedDate);
    if (m in leadByMonth) leadByMonth[m]++;
  });

  // [3] 인바운드 신규 Opp 전체
  console.log('[3/5] 신규 Opp (인바운드만) 조회...');
  const opps = await sf.queryAll(`
    SELECT Id, CreatedDate, CloseDate, LastStageChangeDate, IsWon,
           fm_CompanyStatus__c, OwnerId
    FROM Opportunity
    WHERE RecordType.Name = '1. 테이블오더 (신규)'
      AND Owner_Department__c = '인바운드세일즈'
      AND CreatedDate >= ${RANGE_START}
      AND CreatedDate < ${RANGE_END}
  `.replace(/\s+/g, ' ').trim());
  console.log(`     ${opps.length}건`);

  // [4] Visit__c
  console.log('[4/5] 방문 조회...');
  const oppIds = opps.map((o) => o.Id);
  const visits = [];
  for (let i = 0; i < oppIds.length; i += 200) {
    const inList = oppIds.slice(i, i + 200).map((id) => `'${id}'`).join(',');
    const res = await sf.queryAll(`
      SELECT Id, Opportunity__c, ConselStart__c, ConselEnd__c
      FROM Visit__c
      WHERE Opportunity__c IN (${inList}) AND IsVisitComplete__c = true
    `.replace(/\s+/g, ' ').trim());
    visits.push(...res);
  }
  console.log(`     ${visits.length}건`);

  // [5] 분석
  console.log('[5/5] 분석...');
  const visitsByOpp = new Map();
  visits.forEach((v) => {
    const ts = v.ConselEnd__c || v.ConselStart__c;
    if (!ts) return;
    const arr = visitsByOpp.get(v.Opportunity__c) || [];
    arr.push({ ts: new Date(ts), iso: ts });
    visitsByOpp.set(v.Opportunity__c, arr);
  });
  visitsByOpp.forEach((arr) => arr.sort((a, b) => a.ts - b.ts));

  // 월별 방문 카운트 (방문 발생 월 기준)
  const visitByMonth = { '2026-01': 0, '2026-02': 0, '2026-03': 0, '2026-04': 0 };
  visits.forEach((v) => {
    const ts = v.ConselEnd__c || v.ConselStart__c;
    const m = kstMonthKey(ts);
    if (m in visitByMonth) visitByMonth[m]++;
  });

  // CW Opp 월별 방문 분포 + 7일 마감률
  // 4월은 4월 27일까지만 (28일 미완성 데이터 제외)
  const aprilCutoffMs = new Date(APRIL_CW_CUTOFF).getTime();
  const cwAnalysis = {
    '2026-01': { total: [], '1회': [], '2회+': [] },
    '2026-02': { total: [], '1회': [], '2회+': [] },
    '2026-03': { total: [], '1회': [], '2회+': [] },
    '2026-04': { total: [], '1회': [], '2회+': [] },
  };
  let cwNoVisit = 0;
  let aprilCutoffSkipped = 0;

  opps.forEach((o) => {
    if (!o.IsWon) return;
    const cwTs = o.LastStageChangeDate || o.CloseDate;
    if (!cwTs) return;
    const cwMs = new Date(cwTs).getTime();
    const cwMonth = kstMonthKey(cwTs);
    if (!cwAnalysis[cwMonth]) return;
    if (cwMonth === '2026-04' && cwMs >= aprilCutoffMs) {
      aprilCutoffSkipped++;
      return;
    }
    const arr = visitsByOpp.get(o.Id) || [];
    if (!arr.length) { cwNoVisit++; return; }
    const lastVisit = arr[arr.length - 1];
    const days = diffDays(lastVisit.iso, cwTs);
    if (days == null || days < 0) return;
    const bucket = arr.length === 1 ? '1회' : '2회+';
    cwAnalysis[cwMonth].total.push({ days, isPreOpen: o.fm_CompanyStatus__c === '오픈전' });
    cwAnalysis[cwMonth][bucket].push(days);
  });

  // ============================================================
  // 출력
  // ============================================================
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  인바운드세일즈 — 가설 검증 (4월은 4-1 ~ 4-27 마감 기준)`);
  console.log('='.repeat(80));

  console.log(`\n[① Lead 인입 수]`);
  console.log(`${pad('월',8)} ${padR('Lead',10)}  변화`);
  let prev = null;
  ['2026-01', '2026-02', '2026-03', '2026-04'].forEach((m) => {
    const cnt = leadByMonth[m];
    const diff = prev != null ? `(${cnt - prev > 0 ? '+' : ''}${cnt - prev}, ${(((cnt - prev) / prev) * 100).toFixed(0)}%)` : '';
    console.log(`${pad(m, 8)} ${padR(cnt + '건', 10)}  ${diff}`);
    prev = cnt;
  });

  console.log(`\n[② 방문완료 수]`);
  console.log(`${pad('월',8)} ${padR('방문',10)}  변화`);
  prev = null;
  ['2026-01', '2026-02', '2026-03', '2026-04'].forEach((m) => {
    const cnt = visitByMonth[m];
    const diff = prev != null ? `(${cnt - prev > 0 ? '+' : ''}${cnt - prev}, ${(((cnt - prev) / prev) * 100).toFixed(0)}%)` : '';
    console.log(`${pad(m, 8)} ${padR(cnt + '건', 10)}  ${diff}`);
    prev = cnt;
  });

  console.log(`\n[③ CW Opp 방문 횟수 분포 (4월: 4-1~4-27 마감)]`);
  console.log(`${pad('월',8)} ${padR('CW',8)} ${padR('1회방문',13)} ${padR('2회+',13)}`);
  ['2026-01', '2026-02', '2026-03', '2026-04'].forEach((m) => {
    const b = cwAnalysis[m];
    const t = b.total.length;
    const fmt = (k) => `${b[k].length}건(${t ? Math.round(b[k].length/t*100) : 0}%)`;
    console.log(`${pad(m, 8)} ${padR(t + '건', 8)} ${padR(fmt('1회'), 13)} ${padR(fmt('2회+'), 13)}`);
  });
  console.log(`(방문기록 없는 CW: ${cwNoVisit}건 제외 / 4월 28일 마감 제외: ${aprilCutoffSkipped}건)`);

  console.log(`\n[④ 마지막 방문 → CW 7일 이내 마감률]`);
  console.log(`${pad('월',8)} ${padR('전체',16)} ${padR('1회 방문',16)} ${padR('2회+ 방문',16)}`);
  ['2026-01', '2026-02', '2026-03', '2026-04'].forEach((m) => {
    const b = cwAnalysis[m];
    const fmt = (arr) => {
      if (!arr.length) return '-';
      const u7 = arr.filter((x) => (typeof x === 'number' ? x : x.days) < 7).length;
      return `${u7}/${arr.length} (${Math.round(u7/arr.length*100)}%)`;
    };
    console.log(`${pad(m, 8)} ${padR(fmt(b.total), 16)} ${padR(fmt(b['1회']), 16)} ${padR(fmt(b['2회+']), 16)}`);
  });

  // 추가: Lead vs 방문 vs CW 한 줄 비교
  console.log(`\n[종합 한 표]`);
  console.log(`${pad('월',8)} ${padR('Lead',8)} ${padR('방문',8)} ${padR('CW',8)} ${padR('CW/Lead',10)}`);
  ['2026-01', '2026-02', '2026-03', '2026-04'].forEach((m) => {
    const lead = leadByMonth[m];
    const visit = visitByMonth[m];
    const cw = cwAnalysis[m].total.length;
    const ratio = lead ? `${(cw / lead * 100).toFixed(0)}%` : '-';
    console.log(`${pad(m, 8)} ${padR(lead, 8)} ${padR(visit, 8)} ${padR(cw, 8)} ${padR(ratio, 10)}`);
  });
})().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
