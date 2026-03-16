require('dotenv').config({ path: __dirname + '/.env' });
const axios = require('axios');

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

  // 전체 Lead LossReason__c 값 분포
  console.log('=== 전체 Lead LossReason__c 값 ===');
  const lossQuery = "SELECT LossReason__c, COUNT(Id) cnt FROM Lead GROUP BY LossReason__c ORDER BY COUNT(Id) DESC";
  const lossRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: lossQuery }
  });
  lossRes.data.records.forEach(r => {
    console.log(`  ${(r.LossReason__c || 'null').padEnd(30)} ${r.cnt}건`);
  });

  // 채널 Lead 중 LossReason__c 분포
  console.log('\n=== 채널 Lead LossReason__c 값 ===');
  const channelLossQuery = `
    SELECT LossReason__c, COUNT(Id) cnt
    FROM Lead
    WHERE LeadSource IN ('파트너사 소개', '프랜차이즈소개')
    GROUP BY LossReason__c
    ORDER BY COUNT(Id) DESC
  `;
  const channelLossRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: channelLossQuery }
  });
  channelLossRes.data.records.forEach(r => {
    console.log(`  ${(r.LossReason__c || 'null').padEnd(30)} ${r.cnt}건`);
  });

  // LossReason_Contract__c 세부항목도 확인
  console.log('\n=== 채널 Lead LossReason_Contract__c 값 ===');
  const channelLoss2Query = `
    SELECT LossReason_Contract__c, COUNT(Id) cnt
    FROM Lead
    WHERE LeadSource IN ('파트너사 소개', '프랜차이즈소개')
    GROUP BY LossReason_Contract__c
    ORDER BY COUNT(Id) DESC
  `;
  const channelLoss2Res = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: channelLoss2Query }
  });
  channelLoss2Res.data.records.forEach(r => {
    console.log(`  ${(r.LossReason_Contract__c || 'null').padEnd(30)} ${r.cnt}건`);
  });

  // 이번달 채널 Lead 현황
  const thisMonth = new Date().toISOString().substring(0, 7);
  const thisMonthStart = thisMonth + '-01T00:00:00Z';
  console.log(`\n=== 이번달(${thisMonth}) 채널 Lead 상세 현황 ===`);

  const thisMonthQuery = `
    SELECT Status, LossReason__c, IsConverted, COUNT(Id) cnt
    FROM Lead
    WHERE LeadSource IN ('파트너사 소개', '프랜차이즈소개')
    AND CreatedDate >= ${thisMonthStart}
    GROUP BY Status, LossReason__c, IsConverted
    ORDER BY COUNT(Id) DESC
  `;
  const thisMonthRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: thisMonthQuery }
  });
  console.log('Status'.padEnd(20) + 'LossReason'.padEnd(25) + 'Converted'.padEnd(12) + '건수');
  console.log('-'.repeat(65));
  thisMonthRes.data.records.forEach(r => {
    console.log(
      (r.Status || '-').padEnd(20) +
      (r.LossReason__c || '-').padEnd(25) +
      (r.IsConverted ? 'Y' : 'N').padEnd(12) +
      r.cnt + '건'
    );
  });
}

main().catch(err => {
  console.error('오류:', err.message);
  if (err.response) console.error(err.response.data);
});
