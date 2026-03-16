const data = require('./Opportunities_2025-11_to_2026-02.json');

console.log('=== 프로모션 타겟 분석 (연락처 + 활동일 추가) ===\n');

// Open 건만 필터
const openOpps = data.filter(o => o.isClosed === false);

// 1. 연락 가능한 Open 건
const contactable = openOpps.filter(o =>
  o.contact?.phone || o.contact?.mobile || o.account?.phone
);
console.log('📞 연락 가능한 Open 건: ' + contactable.length + '/' + openOpps.length + '건');

// 2. 마지막 활동일 기준 분석
console.log('\n⏰ 마지막 활동일 기준 (Open 건)');
const today = new Date('2026-02-25');
const noActivity = [];
const over30 = [];
const over60 = [];
const over90 = [];
const recent = [];

openOpps.forEach(o => {
  const actDate = o.lastActivityDate || o.account?.lastActivityDate;
  if (!actDate) {
    noActivity.push(o);
    return;
  }
  const days = Math.floor((today - new Date(actDate)) / (1000 * 60 * 60 * 24));
  if (days > 90) over90.push(o);
  else if (days > 60) over60.push(o);
  else if (days > 30) over30.push(o);
  else recent.push(o);
});

console.log('  30일 이내 활동: ' + recent.length + '건');
console.log('  31~60일 전: ' + over30.length + '건');
console.log('  61~90일 전: ' + over60.length + '건');
console.log('  90일+ (장기 미접촉): ' + over90.length + '건');
console.log('  활동일 없음: ' + noActivity.length + '건');

// 3. 핵심 타겟: 견적 Stage + 장기 미접촉 + 연락처 있음
const quoteStale = openOpps.filter(o => {
  if (o.stageName !== '견적') return false;
  const actDate = o.lastActivityDate || o.account?.lastActivityDate;
  if (!actDate) return true;
  const days = Math.floor((today - new Date(actDate)) / (1000 * 60 * 60 * 24));
  return days > 30;
});

const quoteStaleContactable = quoteStale.filter(o =>
  o.contact?.phone || o.contact?.mobile || o.account?.phone
);

console.log('\n🎯 핵심 타겟: 견적 + 30일+ 미접촉');
console.log('  전체: ' + quoteStale.length + '건');
console.log('  연락처 있음: ' + quoteStaleContactable.length + '건');

// 업종별
const targetByInd = {};
quoteStaleContactable.forEach(o => {
  const ind = o.account?.plIndustryFirst || '(미지정)';
  targetByInd[ind] = (targetByInd[ind] || 0) + 1;
});
console.log('\n[업종별]');
Object.entries(targetByInd)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8)
  .forEach(([ind, count]) => {
    console.log('  ' + ind.padEnd(12) + count + '건');
  });

// 지역별
const targetByRegion = {};
quoteStaleContactable.forEach(o => {
  const addr = o.account?.roadAddress || o.account?.shippingAddress || '';
  let region = '(주소없음)';
  if (addr.startsWith('서울')) region = '서울';
  else if (addr.startsWith('경기')) region = '경기';
  else if (addr.startsWith('부산')) region = '부산';
  else if (addr.startsWith('인천')) region = '인천';
  else if (addr) region = '기타지방';
  targetByRegion[region] = (targetByRegion[region] || 0) + 1;
});
console.log('\n[지역별]');
Object.entries(targetByRegion)
  .sort((a, b) => b[1] - a[1])
  .forEach(([region, count]) => {
    console.log('  ' + region.padEnd(10) + count + '건');
  });

// 4. 재접근 Lost + 연락처 있음
const lostOpps = data.filter(o => o.isClosed && o.isWon === false);
const reEngageable = lostOpps.filter(o =>
  o.lossReason === '방문 후 취소' ||
  o.lossReason === '선납금 입금대기 중 취소' ||
  o.lossReason === '제안 후 취소'
);
const reEngageableContactable = reEngageable.filter(o =>
  o.contact?.phone || o.contact?.mobile || o.account?.phone
);

console.log('\n🔄 재접근 가능 Lost + 연락처 있음');
console.log('  전체 재접근 가능: ' + reEngageable.length + '건');
console.log('  연락처 있음: ' + reEngageableContactable.length + '건');

// 5. 이메일 캠페인 가능
const withEmail = openOpps.filter(o => o.contact?.email);
console.log('\n📧 이메일 캠페인 가능 (Open): ' + withEmail.length + '건');

// 6. 샘플 출력 - 핵심 타겟 5건
console.log('\n─────────────────────────────────────────────────────────');
console.log('📋 핵심 타겟 샘플 (견적 + 30일+ 미접촉 + 연락처)');
console.log('─────────────────────────────────────────────────────────');
quoteStaleContactable.slice(0, 5).forEach(o => {
  const phone = o.contact?.phone || o.contact?.mobile || o.account?.phone || '-';
  const actDate = o.lastActivityDate || o.account?.lastActivityDate || '없음';
  const region = (o.account?.roadAddress || '').split(' ').slice(0, 2).join(' ') || '-';
  console.log('\n' + (o.account?.name || o.name));
  console.log('  업종: ' + (o.account?.plIndustryFirst || '-') + ' | 지역: ' + region);
  console.log('  전화: ' + phone);
  console.log('  마지막활동: ' + actDate + ' | 생성: ' + o.createdDate);
});
