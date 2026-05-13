/**
 * 방문완료 → CW 분포 검증 (표본 편향 체크)
 *
 * 최근 3개월 CW된 신규 Opp 전체에 대해 방문완료→CW 일수 분포를 본다.
 * 30일 미만이 정말 드문지, 아니면 샘플 10건이 운이 나빴는지 답한다.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const sf = require('../../server/api/services/salesforce');

function diffDays(a, b) { if (!a || !b) return null; return (new Date(b) - new Date(a)) / 86400000; }
function round1(n) { return n == null ? null : Math.round(n * 10) / 10; }
function median(s) { if (!s.length) return null; const i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; }
function pctile(s, p) { if (!s.length) return null; if (s.length === 1) return s[0]; const idx = (s.length - 1) * p; const lo = Math.floor(idx), hi = Math.ceil(idx); return lo === hi ? s[lo] : s[lo] * (1 - (idx - lo)) + s[hi] * (idx - lo); }

(async () => {
  console.log('===== 방문완료 → CW 분포 (모수 검증) =====\n');

  // 1) 최근 3개월 CW된 신규 Opp 전체
  const oppSoql = `
    SELECT Id, Name, CreatedDate, CloseDate, LastStageChangeDate, fm_CompanyStatus__c
    FROM Opportunity
    WHERE RecordType.Name = '1. 테이블오더 (신규)'
      AND IsWon = true
      AND Owner_Department__c IN ('인바운드세일즈', '채널세일즈팀')
      AND CreatedDate = LAST_N_MONTHS:6
      AND LastStageChangeDate = LAST_N_MONTHS:3
  `.replace(/\s+/g, ' ').trim();

  console.log('[1/2] CW Opp 조회 중...');
  const opps = await sf.queryAll(oppSoql);
  console.log(`      → ${opps.length}건`);

  if (!opps.length) { console.log('대상 없음.'); return; }

  // 2) Visit chunk 200개씩
  console.log('[2/2] Visit__c 조회 중...');
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
  console.log(`      → 방문완료 ${visits.length}건`);

  // Opp별 첫 방문완료
  const firstByOpp = new Map();
  visits.forEach((v) => {
    const ts = v.ConselEnd__c || v.ConselStart__c;
    if (!ts) return;
    const prev = firstByOpp.get(v.Opportunity__c);
    if (!prev || new Date(ts) < new Date(prev)) firstByOpp.set(v.Opportunity__c, ts);
  });

  // 3) 그룹별 방문→CW 분포
  const buckets = {
    '오픈전': [],
    '운영중': [],
    '전체': [],
  };

  let noVisit = 0;
  opps.forEach((o) => {
    const visitTs = firstByOpp.get(o.Id);
    const cwTs = o.LastStageChangeDate || o.CloseDate;
    if (!visitTs) { noVisit++; return; }
    const days = diffDays(visitTs, cwTs);
    if (days == null || days < 0) return; // 비정상 케이스 제외
    const grp = o.fm_CompanyStatus__c === '오픈전' ? '오픈전' : '운영중';
    buckets[grp].push(days);
    buckets['전체'].push(days);
  });

  console.log(`\n방문완료 없는 Opp: ${noVisit}건 (제외)\n`);

  // 출력
  const fmt = (label, arr) => {
    if (!arr.length) { console.log(`${label.padEnd(8)} n=0`); return; }
    const s = [...arr].sort((a, b) => a - b);
    const u30 = s.filter((d) => d < 30).length;
    const u14 = s.filter((d) => d < 14).length;
    const u7 = s.filter((d) => d < 7).length;
    console.log(
      `${label.padEnd(8)} n=${String(s.length).padStart(4)}  ` +
      `중앙 ${String(round1(median(s))).padStart(5)}일  ` +
      `P25 ${String(round1(pctile(s, 0.25))).padStart(5)}일  ` +
      `P75 ${String(round1(pctile(s, 0.75))).padStart(5)}일  ` +
      `P90 ${String(round1(pctile(s, 0.9))).padStart(5)}일  ` +
      `최대 ${String(round1(s[s.length - 1])).padStart(5)}일`
    );
    const pct = (n) => `${(n / s.length * 100).toFixed(1)}%`;
    console.log(`         < 7일:  ${String(u7).padStart(4)}건 (${pct(u7)})`);
    console.log(`         < 14일: ${String(u14).padStart(4)}건 (${pct(u14)})`);
    console.log(`         < 30일: ${String(u30).padStart(4)}건 (${pct(u30)})`);
  };

  console.log('===== 방문완료 → CW 일수 분포 =====');
  fmt('전체', buckets['전체']);
  console.log('');
  fmt('오픈전', buckets['오픈전']);
  console.log('');
  fmt('운영중', buckets['운영중']);
})().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
