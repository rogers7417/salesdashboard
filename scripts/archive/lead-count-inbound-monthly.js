/**
 * 인바운드세일즈 부서 월별 Lead 인입 수 (검증용)
 * 필터 조합 4가지로 비교
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

(async () => {
  // 인바운드세일즈 User (Active + Inactive 둘 다)
  console.log('[1/2] 인바운드세일즈 User 조회 (Active + Inactive)...');
  const users = await sf.queryAll(`
    SELECT Id, Name, IsActive
    FROM User
    WHERE Department = '인바운드세일즈'
  `.replace(/\s+/g, ' ').trim());
  const activeIds = users.filter((u) => u.IsActive).map((u) => u.Id);
  const allIds = users.map((u) => u.Id);
  console.log(`     전체 ${users.length}명 (Active ${activeIds.length}, Inactive ${users.length - activeIds.length})`);

  const inListAll = allIds.map((id) => `'${id}'`).join(',');

  // 한 번에 다 조회 후 메모리 필터링
  console.log('[2/2] Lead 조회 (인바운드 Owner 전체)...');
  const leads = await sf.queryAll(`
    SELECT Id, OwnerId, CreatedDate, LeadSource, LossReason__c,
           ServiceType__c, PartnerName__c, StoreType__c, Company
    FROM Lead
    WHERE OwnerId IN (${inListAll})
      AND CreatedDate >= ${RANGE_START}
      AND CreatedDate < ${RANGE_END}
  `.replace(/\s+/g, ' ').trim());
  console.log(`     ${leads.length}건`);

  // 월별 카운터 — 4가지 필터
  const months = ['2026-01', '2026-02', '2026-03', '2026-04'];
  const buckets = {
    'A. Active만 + 무필터': {},
    'B. Active+Inactive + 무필터': {},
    'C. Active+Inactive + 노이즈제외(오생성/아웃바운드/test)': {},
    'D. C + 테이블오더 ServiceType만': {},
  };
  months.forEach((m) => {
    Object.values(buckets).forEach((b) => { b[m] = 0; });
  });

  const activeSet = new Set(activeIds);

  leads.forEach((l) => {
    const m = kstMonthKey(l.CreatedDate);
    if (!months.includes(m)) return;

    // A: Active만, 무필터
    if (activeSet.has(l.OwnerId)) buckets['A. Active만 + 무필터'][m]++;

    // B: Active+Inactive, 무필터
    buckets['B. Active+Inactive + 무필터'][m]++;

    // C: 노이즈 제외 (오생성, 아웃바운드, test)
    const isNoise =
      l.LossReason__c === '오생성' ||
      l.LeadSource === '아웃바운드' ||
      (l.Company && l.Company.toLowerCase().includes('test'));
    if (!isNoise) buckets['C. Active+Inactive + 노이즈제외(오생성/아웃바운드/test)'][m]++;

    // D: C + 테이블오더 ServiceType
    const isTableOrder = l.ServiceType__c === '테이블오더' || l.ServiceType__c === '티오더 웨이팅';
    if (!isNoise && isTableOrder) buckets['D. C + 테이블오더 ServiceType만'][m]++;
  });

  // 출력
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  인바운드세일즈 월별 Lead 인입 — 필터 조합 비교`);
  console.log('='.repeat(80));
  console.log(`${'필터'.padEnd(50)} ${months.map((m) => m.slice(5).padStart(7)).join(' ')}  ${'합계'.padStart(7)}`);
  console.log('-'.repeat(95));
  Object.entries(buckets).forEach(([name, bucket]) => {
    const cells = months.map((m) => String(bucket[m]).padStart(7));
    const sum = months.reduce((s, m) => s + bucket[m], 0);
    console.log(`${name.padEnd(50)} ${cells.join(' ')}  ${String(sum).padStart(7)}`);
  });

  // 보너스: LeadSource 분포 (3월)
  const march = leads.filter((l) => kstMonthKey(l.CreatedDate) === '2026-03');
  const byLeadSource = {};
  march.forEach((l) => { byLeadSource[l.LeadSource || '(없음)'] = (byLeadSource[l.LeadSource || '(없음)'] || 0) + 1; });
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  3월 인바운드 Lead — LeadSource 분포 (${march.length}건)`);
  console.log('='.repeat(80));
  Object.entries(byLeadSource).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${k.padEnd(20)} ${String(v).padStart(5)}건  (${(v / march.length * 100).toFixed(1)}%)`);
  });
})().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
