/**
 * 방문완료 → CW 분포: 월별 (2026-01 / 02 / 03) × 매장상태 (오픈전 / 운영중)
 *
 * CW 기준은 LastStageChangeDate (실제 Won 변환 시각, KST 기준 월 버킷팅).
 * 신규 Opp + 인바운드/채널세일즈팀.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const sf = require('../../server/api/services/salesforce');

// 2026-01-01 ~ 2026-04-01 KST → UTC ISO
function kstStartUtcIso(y, m, d = 1) { return new Date(Date.UTC(y, m - 1, d - 1, 15, 0, 0)).toISOString(); }

const RANGE_START = kstStartUtcIso(2026, 1, 1); // 2026-01-01 00:00 KST
const RANGE_END = kstStartUtcIso(2026, 4, 1);   // 2026-04-01 00:00 KST

function kstMonthKey(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime() + 9 * 60 * 60 * 1000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function diffDays(a, b) { if (!a || !b) return null; return (new Date(b) - new Date(a)) / 86400000; }
function round1(n) { return n == null ? null : Math.round(n * 10) / 10; }
function median(s) { if (!s.length) return null; const i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; }
function pctile(s, p) { if (!s.length) return null; if (s.length === 1) return s[0]; const idx = (s.length - 1) * p; const lo = Math.floor(idx), hi = Math.ceil(idx); return lo === hi ? s[lo] : s[lo] * (1 - (idx - lo)) + s[hi] * (idx - lo); }

(async () => {
  console.log('===== 방문완료 → CW 월별 분포 (2026 Q1) =====\n');

  // 1) Q1 CW 신규 Opp
  const oppSoql = `
    SELECT Id, CreatedDate, CloseDate, LastStageChangeDate, fm_CompanyStatus__c
    FROM Opportunity
    WHERE RecordType.Name = '1. 테이블오더 (신규)'
      AND IsWon = true
      AND Owner_Department__c IN ('인바운드세일즈', '채널세일즈팀')
      AND LastStageChangeDate >= ${RANGE_START}
      AND LastStageChangeDate < ${RANGE_END}
  `.replace(/\s+/g, ' ').trim();

  console.log('[1/2] Q1 CW Opp 조회...');
  const opps = await sf.queryAll(oppSoql);
  console.log(`      → ${opps.length}건`);

  // 2) Visit__c chunk
  console.log('[2/2] Visit__c 조회...');
  const oppIds = opps.map((o) => o.Id);
  const visits = [];
  for (let i = 0; i < oppIds.length; i += 200) {
    const inList = oppIds.slice(i, i + 200).map((id) => `'${id}'`).join(',');
    const res = await sf.queryAll(`
      SELECT Opportunity__c, ConselStart__c, ConselEnd__c
      FROM Visit__c
      WHERE Opportunity__c IN (${inList}) AND IsVisitComplete__c = true
    `.replace(/\s+/g, ' ').trim());
    visits.push(...res);
  }
  console.log(`      → 방문완료 ${visits.length}건\n`);

  const firstByOpp = new Map();
  visits.forEach((v) => {
    const ts = v.ConselEnd__c || v.ConselStart__c;
    if (!ts) return;
    const prev = firstByOpp.get(v.Opportunity__c);
    if (!prev || new Date(ts) < new Date(prev)) firstByOpp.set(v.Opportunity__c, ts);
  });

  // 3) 월×그룹 버킷
  // key: `${monthKey}|${storeStatus}` → []
  const buckets = new Map();
  let noVisit = 0;
  opps.forEach((o) => {
    const cwTs = o.LastStageChangeDate || o.CloseDate;
    const month = kstMonthKey(cwTs);
    const visitTs = firstByOpp.get(o.Id);
    if (!visitTs) { noVisit++; return; }
    const days = diffDays(visitTs, cwTs);
    if (days == null || days < 0) return;
    const status = o.fm_CompanyStatus__c === '오픈전' ? '오픈전' : '운영중';
    const key = `${month}|${status}`;
    const arr = buckets.get(key) || [];
    arr.push(days);
    buckets.set(key, arr);
  });

  console.log(`방문완료 없는 Opp: ${noVisit}건 (제외)\n`);

  // 4) 출력
  const months = ['2026-01', '2026-02', '2026-03'];
  const groups = ['오픈전', '운영중', '전체'];

  console.log(`${'월'.padEnd(8)} ${'그룹'.padEnd(8)} ${'n'.padStart(4)}  ${'중앙'.padStart(6)}  ${'P25'.padStart(6)}  ${'P75'.padStart(6)}  ${'P90'.padStart(6)}  ${'< 7일'.padStart(8)}  ${'< 14일'.padStart(8)}  ${'< 30일'.padStart(8)}`);
  console.log('-'.repeat(98));

  months.forEach((month) => {
    groups.forEach((grp) => {
      const arr = grp === '전체'
        ? [...(buckets.get(`${month}|오픈전`) || []), ...(buckets.get(`${month}|운영중`) || [])]
        : (buckets.get(`${month}|${grp}`) || []);
      if (!arr.length) {
        console.log(`${month.padEnd(8)} ${grp.padEnd(8)} ${'0'.padStart(4)}  (데이터 없음)`);
        return;
      }
      const s = [...arr].sort((a, b) => a - b);
      const u30 = s.filter((d) => d < 30).length;
      const u14 = s.filter((d) => d < 14).length;
      const u7 = s.filter((d) => d < 7).length;
      const pct = (n) => `${(n / s.length * 100).toFixed(0)}%`;
      console.log(
        `${month.padEnd(8)} ${grp.padEnd(8)} ${String(s.length).padStart(4)}  ` +
        `${String(round1(median(s))).padStart(5)}일  ` +
        `${String(round1(pctile(s, 0.25))).padStart(5)}일  ` +
        `${String(round1(pctile(s, 0.75))).padStart(5)}일  ` +
        `${String(round1(pctile(s, 0.9))).padStart(5)}일  ` +
        `${String(u7).padStart(3)}건(${pct(u7).padStart(3)})  ` +
        `${String(u14).padStart(3)}건(${pct(u14).padStart(3)})  ` +
        `${String(u30).padStart(3)}건(${pct(u30).padStart(3)})`
      );
    });
    console.log('-'.repeat(98));
  });
})().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
