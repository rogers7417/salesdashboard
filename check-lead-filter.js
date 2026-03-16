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

  // Lead Status 값 확인
  console.log('=== Lead Status 값 ===');
  const statusQuery = "SELECT Status, COUNT(Id) cnt FROM Lead GROUP BY Status ORDER BY COUNT(Id) DESC";
  const statusRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: statusQuery }
  });
  statusRes.data.records.forEach(r => {
    console.log(`  ${(r.Status || 'null').padEnd(25)} ${r.cnt}건`);
  });

  // Lead 필드 중 오인입/중복 관련 필드 확인
  console.log('\n=== Lead 객체 필드 (오인입/중복/MQL/SQL 관련) ===');
  const leadDescribe = await axios.get(instanceUrl + '/services/data/v59.0/sobjects/Lead/describe', {
    headers: { 'Authorization': 'Bearer ' + accessToken }
  });

  const keywords = ['중복', '오인입', 'duplicate', 'invalid', 'mql', 'sql', 'qualify', 'disqualify', 'reject', 'reason', 'loss'];
  const relevantFields = leadDescribe.data.fields.filter(f =>
    keywords.some(k =>
      f.name.toLowerCase().includes(k) ||
      (f.label && f.label.toLowerCase().includes(k))
    )
  );

  relevantFields.forEach(f => {
    console.log(`  ${f.name.padEnd(40)} ${f.type.padEnd(15)} ${f.label}`);
  });

  // Lead_Approval_Status__c 값 확인 (있다면)
  console.log('\n=== Lead_Approval_Status__c 값 ===');
  try {
    const approvalQuery = "SELECT Lead_Approval_Status__c, COUNT(Id) cnt FROM Lead GROUP BY Lead_Approval_Status__c ORDER BY COUNT(Id) DESC";
    const approvalRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
      headers: { 'Authorization': 'Bearer ' + accessToken },
      params: { q: approvalQuery }
    });
    approvalRes.data.records.forEach(r => {
      console.log(`  ${(r.Lead_Approval_Status__c || 'null').padEnd(25)} ${r.cnt}건`);
    });
  } catch (e) {
    console.log('  필드 없음');
  }

  // CompanyStatus__c (매장상태) 확인
  console.log('\n=== CompanyStatus__c (매장상태) 값 ===');
  try {
    const companyStatusQuery = "SELECT CompanyStatus__c, COUNT(Id) cnt FROM Lead GROUP BY CompanyStatus__c ORDER BY COUNT(Id) DESC";
    const companyStatusRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
      headers: { 'Authorization': 'Bearer ' + accessToken },
      params: { q: companyStatusQuery }
    });
    companyStatusRes.data.records.forEach(r => {
      console.log(`  ${(r.CompanyStatus__c || 'null').padEnd(25)} ${r.cnt}건`);
    });
  } catch (e) {
    console.log('  필드 없음');
  }

  // 채널 Lead 중 Status별 분포
  console.log('\n=== 채널 Lead (LeadSource) Status별 분포 ===');
  const channelStatusQuery = `
    SELECT Status, COUNT(Id) cnt
    FROM Lead
    WHERE LeadSource IN ('파트너사 소개', '프랜차이즈소개')
    GROUP BY Status
    ORDER BY COUNT(Id) DESC
  `;
  const channelStatusRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: channelStatusQuery }
  });
  channelStatusRes.data.records.forEach(r => {
    console.log(`  ${(r.Status || 'null').padEnd(25)} ${r.cnt}건`);
  });

  // MQL/SQL 정의 추정 - Qualified vs 담당자 배정 등
  console.log('\n=== MQL/SQL 추정 기준 ===');
  console.log('  MQL 후보: Qualified, 담당자 배정');
  console.log('  SQL 후보: IsConverted = true');
  console.log('  제외 후보: 종료, Not Qualified, 리터치예정 (중복/오인입 등)');
}

main().catch(err => {
  console.error('오류:', err.message);
  if (err.response) console.error(err.response.data);
});
