require('dotenv').config({ path: __dirname + '/.env' });
const axios = require('axios');

async function soqlQueryAll(instanceUrl, accessToken, query) {
  let records = [];
  let url = instanceUrl + '/services/data/v59.0/query?q=' + encodeURIComponent(query);

  while (url) {
    const res = await axios.get(url, {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    records = records.concat(res.data.records);
    url = res.data.nextRecordsUrl ? instanceUrl + res.data.nextRecordsUrl : null;
  }
  return records;
}

async function main() {
  const url = process.env.SF_LOGIN_URL + '/services/oauth2/token';
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', process.env.SF_CLIENT_ID);
  params.append('client_secret', process.env.SF_CLIENT_SECRET);
  params.append('username', process.env.SF_USERNAME);
  params.append('password', decodeURIComponent(process.env.SF_PASSWORD));

  const auth = await axios.post(url, params);
  const accessToken = auth.data.access_token;
  const instanceUrl = auth.data.instance_url;
  console.log('Salesforce 연결 성공\n');

  // 이번 달 기준
  const thisMonth = new Date().toISOString().substring(0, 7);
  const thisMonthStart = thisMonth + '-01T00:00:00Z';

  // 채널 Lead 이번 달 조회
  const channelLeadQuery = `
    SELECT Id, Owner.Name, LeadSource, CreatedDate
    FROM Lead
    WHERE LeadSource IN ('파트너사 소개', '프랜차이즈소개')
    AND CreatedDate >= ${thisMonthStart}
  `;
  console.log(`이번 달(${thisMonth}) 채널 Lead 조회 중...`);
  const leads = await soqlQueryAll(instanceUrl, accessToken, channelLeadQuery);
  console.log(`총 ${leads.length}건 조회 완료\n`);

  // 소유자별 집계
  const ownerMap = {};
  leads.forEach(l => {
    const ownerName = l.Owner?.Name || '(미지정)';
    if (!ownerMap[ownerName]) {
      ownerMap[ownerName] = { partner: 0, franchise: 0 };
    }
    if (l.LeadSource === '파트너사 소개') {
      ownerMap[ownerName].partner++;
    } else if (l.LeadSource === '프랜차이즈소개') {
      ownerMap[ownerName].franchise++;
    }
  });

  // 파트너사 소개
  console.log(`=== LeadSource: 파트너사 소개 (소유자별) - ${thisMonth} ===`);
  const partnerSorted = Object.entries(ownerMap)
    .map(([name, data]) => ({ name, cnt: data.partner }))
    .filter(r => r.cnt > 0)
    .sort((a, b) => b.cnt - a.cnt);

  let partnerTotal = 0;
  partnerSorted.forEach(r => {
    partnerTotal += r.cnt;
    console.log(`  ${r.name.padEnd(15)} ${String(r.cnt).padStart(6)}건`);
  });
  console.log(`  ${'합계'.padEnd(15)} ${String(partnerTotal).padStart(6)}건`);

  // 프랜차이즈소개
  console.log(`\n=== LeadSource: 프랜차이즈소개 (소유자별) - ${thisMonth} ===`);
  const franchiseSorted = Object.entries(ownerMap)
    .map(([name, data]) => ({ name, cnt: data.franchise }))
    .filter(r => r.cnt > 0)
    .sort((a, b) => b.cnt - a.cnt);

  let franchiseTotal = 0;
  franchiseSorted.forEach(r => {
    franchiseTotal += r.cnt;
    console.log(`  ${r.name.padEnd(15)} ${String(r.cnt).padStart(6)}건`);
  });
  console.log(`  ${'합계'.padEnd(15)} ${String(franchiseTotal).padStart(6)}건`);

  // 합산 테이블
  console.log(`\n=== 소유자별 채널 Lead 합산 - ${thisMonth} ===`);

  // 합계 기준 정렬
  const sorted = Object.entries(ownerMap)
    .map(([name, data]) => ({ name, ...data, total: data.partner + data.franchise }))
    .sort((a, b) => b.total - a.total);

  console.log('소유자'.padEnd(15) + '파트너사소개'.padStart(12) + '프랜차이즈소개'.padStart(14) + '합계'.padStart(8));
  console.log('-'.repeat(50));
  sorted.forEach(r => {
    console.log(
      r.name.padEnd(15) +
      String(r.partner).padStart(12) +
      String(r.franchise).padStart(14) +
      String(r.total).padStart(8)
    );
  });
  console.log('-'.repeat(50));
  console.log(
    '합계'.padEnd(15) +
    String(partnerTotal).padStart(12) +
    String(franchiseTotal).padStart(14) +
    String(partnerTotal + franchiseTotal).padStart(8)
  );
}

main().catch(err => {
  console.error('오류:', err.message);
  if (err.response) console.error(err.response.data);
});
