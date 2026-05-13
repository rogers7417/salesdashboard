/**
 * 가설 검증: "3월 빠른 마감 = 신규 방문 집중. 4월 둔화 = 리터치 위주"
 *
 * 검증할 4가지:
 *   ① 월별 Lead 인입 수 (인바운드/채널 부서 Owner)
 *   ② 월별 방문완료 수
 *   ③ Opp별 총 방문 횟수 분포 → 1회 방문(단번 결정) vs 2회+ 방문(여러 번)
 *   ④ 그룹별 방문→CW 7일 이내 마감률 (1회 vs 2회+)
 *
 * 범위: 2026-01-01 ~ 2026-04-28 KST, RecordType '1. 테이블오더 (신규)', 인바운드+채널세일즈팀
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const sf = require('../../server/api/services/salesforce');

function kstStartUtcIso(y, m, d = 1) { return new Date(Date.UTC(y, m - 1, d - 1, 15, 0, 0)).toISOString(); }
const RANGE_START = kstStartUtcIso(2026, 1, 1);
const RANGE_END   = kstStartUtcIso(2026, 5, 1);

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
  // ----------------------------------
  // [1] 인바운드/채널세일즈팀 User 목록
  // ----------------------------------
  console.log('[1/5] 인바운드/채널세일즈팀 User 조회...');
  const users = await sf.queryAll(`
    SELECT Id, Name, Department
    FROM User
    WHERE Department IN ('인바운드세일즈', '채널세일즈팀')
      AND IsActive = true
  `.replace(/\s+/g, ' ').trim());
  const userIdSet = new Set(users.map((u) => u.Id));
  console.log(`     ${users.length}명`);

  // ----------------------------------
  // [2] 월별 Lead 인입 수
  // ----------------------------------
  console.log('[2/5] 월별 Lead 인입 수 조회...');
  const userIdList = users.map((u) => `'${u.Id}'`).join(',');
  const leads = await sf.queryAll(`
    SELECT Id, OwnerId, CreatedDate
    FROM Lead
    WHERE OwnerId IN (${userIdList})
      AND CreatedDate >= ${RANGE_START}
      AND CreatedDate < ${RANGE_END}
  `.replace(/\s+/g, ' ').trim());
  const leadByMonth = { '2026-01': 0, '2026-02': 0, '2026-03': 0, '2026-04': 0 };
  leads.forEach((l) => {
    const m = kstMonthKey(l.CreatedDate);
    if (m in leadByMonth) leadByMonth[m]++;
  });
  console.log(`     Lead ${leads.length}건`);

  // ----------------------------------
  // [3] 신규 Opp + 방문 데이터 조회
  // ----------------------------------
  console.log('[3/5] 신규 Opp 전체 조회 (CW 여부 무관)...');
  const opps = await sf.queryAll(`
    SELECT Id, CreatedDate, CloseDate, LastStageChangeDate, StageName, IsWon, IsClosed,
           fm_CompanyStatus__c, OwnerId
    FROM Opportunity
    WHERE RecordType.Name = '1. 테이블오더 (신규)'
      AND Owner_Department__c IN ('인바운드세일즈', '채널세일즈팀')
      AND CreatedDate >= ${RANGE_START}
      AND CreatedDate < ${RANGE_END}
  `.replace(/\s+/g, ' ').trim());
  console.log(`     ${opps.length}건`);

  console.log('[4/5] 방문 전체 조회 (IsVisitComplete=true)...');
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
  console.log(`     방문 ${visits.length}건`);

  // ----------------------------------
  // [5] Opp별 방문 시퀀스 + 분류
  // ----------------------------------
  console.log('[5/5] Opp별 방문 시퀀스 분석...');
  const visitsByOpp = new Map();
  visits.forEach((v) => {
    const ts = v.ConselEnd__c || v.ConselStart__c;
    if (!ts) return;
    const arr = visitsByOpp.get(v.Opportunity__c) || [];
    arr.push({ id: v.Id, ts: new Date(ts), iso: ts });
    visitsByOpp.set(v.Opportunity__c, arr);
  });
  visitsByOpp.forEach((arr) => arr.sort((a, b) => a.ts - b.ts));

  // 월별 방문 카운트 (신규=N=1 시점 방문, 리터치=N≥2)
  const visitCountByMonth = {
    '2026-01': { 신규: 0, 리터치: 0 },
    '2026-02': { 신규: 0, 리터치: 0 },
    '2026-03': { 신규: 0, 리터치: 0 },
    '2026-04': { 신규: 0, 리터치: 0 },
  };
  visitsByOpp.forEach((arr) => {
    arr.forEach((v, idx) => {
      const m = kstMonthKey(v.iso);
      if (!visitCountByMonth[m]) return;
      if (idx === 0) visitCountByMonth[m].신규++;
      else visitCountByMonth[m].리터치++;
    });
  });

  // CW Opp 중 총 방문 횟수별 분류 + 방문→CW 시간
  // 분류: 1회 방문 / 2회 방문 / 3회+ 방문
  // 월(CW 기준)별 분포
  const cwAnalysis = {
    '2026-01': { '1회': [], '2회': [], '3회+': [] },
    '2026-02': { '1회': [], '2회': [], '3회+': [] },
    '2026-03': { '1회': [], '2회': [], '3회+': [] },
    '2026-04': { '1회': [], '2회': [], '3회+': [] },
  };
  let cwNoVisit = 0;
  opps.forEach((o) => {
    if (!o.IsWon) return;
    const cwTs = o.LastStageChangeDate || o.CloseDate;
    if (!cwTs) return;
    const cwMonth = kstMonthKey(cwTs);
    if (!cwAnalysis[cwMonth]) return;
    const arr = visitsByOpp.get(o.Id) || [];
    if (!arr.length) { cwNoVisit++; return; }
    const lastVisit = arr[arr.length - 1];
    const days = diffDays(lastVisit.iso, cwTs);
    if (days == null || days < 0) return;
    const bucket = arr.length === 1 ? '1회' : arr.length === 2 ? '2회' : '3회+';
    cwAnalysis[cwMonth][bucket].push({
      visitCount: arr.length,
      lastToCw: days,
      isPreOpen: o.fm_CompanyStatus__c === '오픈전',
    });
  });

  // ----------------------------------
  // 출력
  // ----------------------------------
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ① 월별 Lead 인입 수 (인바운드+채널)`);
  console.log('='.repeat(70));
  console.log(`${pad('월',10)} ${padR('Lead 건수',12)}  변화`);
  console.log('-'.repeat(40));
  let prev = null;
  ['2026-01','2026-02','2026-03','2026-04'].forEach((m) => {
    const cnt = leadByMonth[m];
    const change = prev != null ? `(${cnt - prev > 0 ? '+' : ''}${cnt - prev})` : '';
    console.log(`${pad(m,10)} ${padR(cnt + '건',12)}  ${change}`);
    prev = cnt;
  });

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ② 월별 방문완료 수 (신규 vs 리터치)`);
  console.log('='.repeat(70));
  console.log(`${pad('월',10)} ${padR('총 방문',10)} ${padR('신규',10)} ${padR('리터치',10)} ${padR('신규비중',10)}`);
  console.log('-'.repeat(60));
  ['2026-01','2026-02','2026-03','2026-04'].forEach((m) => {
    const n = visitCountByMonth[m];
    const total = n.신규 + n.리터치;
    const pct = total ? `${(n.신규/total*100).toFixed(1)}%` : '-';
    console.log(`${pad(m,10)} ${padR(total + '건',10)} ${padR(n.신규 + '건',10)} ${padR(n.리터치 + '건',10)} ${padR(pct,10)}`);
  });

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ③ CW Opp의 총 방문 횟수 분포 (월별)`);
  console.log('='.repeat(70));
  console.log(`${pad('월',10)} ${padR('전체CW',8)} ${padR('1회방문',12)} ${padR('2회방문',12)} ${padR('3회+',12)}`);
  console.log('-'.repeat(60));
  ['2026-01','2026-02','2026-03','2026-04'].forEach((m) => {
    const b = cwAnalysis[m];
    const t = b['1회'].length + b['2회'].length + b['3회+'].length;
    const fmt = (k) => `${b[k].length}건(${t ? (b[k].length/t*100).toFixed(0) : 0}%)`;
    console.log(`${pad(m,10)} ${padR(t + '건',8)} ${padR(fmt('1회'),12)} ${padR(fmt('2회'),12)} ${padR(fmt('3회+'),12)}`);
  });
  if (cwNoVisit) console.log(`(방문 기록 없는 CW: ${cwNoVisit}건 제외)`);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ④ 마지막 방문 → CW 7일 이내 마감률 (총 방문 횟수별)`);
  console.log('='.repeat(70));
  console.log(`${pad('월',10)} ${padR('1회 방문',18)} ${padR('2회 방문',18)} ${padR('3회+ 방문',18)}`);
  console.log('-'.repeat(70));
  ['2026-01','2026-02','2026-03','2026-04'].forEach((m) => {
    const b = cwAnalysis[m];
    const fmt = (arr) => {
      if (!arr.length) return '-';
      const u7 = arr.filter((x) => x.lastToCw < 7).length;
      return `${u7}/${arr.length} (${(u7/arr.length*100).toFixed(0)}%)`;
    };
    console.log(`${pad(m,10)} ${padR(fmt(b['1회']),18)} ${padR(fmt(b['2회']),18)} ${padR(fmt(b['3회+']),18)}`);
  });

  console.log(`\n※ 1회 방문 = 한 번 방문 후 바로 마감된 매장 (가설상 빠른 사이클)`);
  console.log(`   2회+ 방문 = 여러 번 방문 후 마감된 매장 (가설상 느린 사이클)`);
})().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
