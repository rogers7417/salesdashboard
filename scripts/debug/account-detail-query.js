/**
 * Account 상세 조회 스크립트
 * 대상: 001TJ00000VcgsYYAR
 */
require('dotenv').config({ path: '/Users/torder/workspace/salesforce-data-tools/.env' });
const axios = require('axios');

async function getToken() {
  const url = `${process.env.SF_LOGIN_URL}/services/oauth2/token`;
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', process.env.SF_CLIENT_ID);
  params.append('client_secret', process.env.SF_CLIENT_SECRET);
  params.append('username', process.env.SF_USERNAME);
  params.append('password', decodeURIComponent(process.env.SF_PASSWORD));
  const res = await axios.post(url, params);
  return { accessToken: res.data.access_token, instanceUrl: res.data.instance_url };
}

async function query(conn, soql) {
  const res = await axios.get(`${conn.instanceUrl}/services/data/v59.0/query`, {
    headers: { 'Authorization': `Bearer ${conn.accessToken}` },
    params: { q: soql }
  });
  return res.data;
}

async function describe(conn, sobject) {
  const res = await axios.get(`${conn.instanceUrl}/services/data/v59.0/sobjects/${sobject}/describe`, {
    headers: { 'Authorization': `Bearer ${conn.accessToken}` }
  });
  return res.data;
}

async function run() {
  const conn = await getToken();
  console.log('SF 연결 성공:', conn.instanceUrl);

  // 0) 먼저 Account describe로 계약/MOU/Partner 관련 필드 확인
  const desc = await describe(conn, 'Account');
  const relevantFields = desc.fields.filter(f => {
    const n = f.name.toLowerCase();
    return n.includes('contract') || n.includes('mou') || n.includes('partner') ||
           n.includes('계약') || n.includes('grade') || n.includes('status');
  });
  console.log('\n=== 계약/MOU/Partner 관련 필드 목록 ===');
  relevantFields.forEach(f => console.log(`  ${f.name} (${f.type}) — ${f.label}`));

  // 필드 이름 목록 추출 (쿼리용)
  const customFieldNames = relevantFields
    .filter(f => f.name.endsWith('__c'))
    .map(f => f.name);
  console.log('\n쿼리할 커스텀 필드:', customFieldNames.join(', '));

  // 1) Account 기본 정보 + 동적으로 발견한 커스텀 필드
  const baseFields = 'Id, Name, RecordType.Name, OwnerId, Owner.Name, CreatedDate, Phone, Website, Industry, BillingCity';
  const allFields = baseFields + (customFieldNames.length ? ', ' + customFieldNames.join(', ') : '');
  const account = await query(conn, `
    SELECT ${allFields}
    FROM Account
    WHERE Id = '001TJ00000VcgsYYAR'
  `);
  console.log('\n=== Account 정보 ===');
  console.log(JSON.stringify(account.records[0], null, 2));

  // 2) 소개 Lead 목록 — PartnerName__c 존재 여부 먼저 확인
  try {
    const leads = await query(conn, `
      SELECT Id, Name, Company, Status, CreatedDate, LeadSource,
             PartnerName__c, IsConverted, LossReason__c
      FROM Lead
      WHERE PartnerName__c = '001TJ00000VcgsYYAR'
      ORDER BY CreatedDate ASC
    `);
    console.log('\n=== 소개 Lead 목록 ===');
    console.log('총 건수:', leads.totalSize);
    (leads.records || []).forEach(l => {
      console.log(`  ${l.CreatedDate?.split('T')[0]} | ${l.Name} | ${l.Company} | ${l.Status} | ${l.LeadSource}`);
    });
  } catch (e) {
    console.log('\n=== 소개 Lead 조회 실패 ===');
    console.log('에러:', e.response?.data?.[0]?.message || e.message);
    // Lead describe로 Partner 관련 필드 확인
    const leadDesc = await describe(conn, 'Lead');
    const partnerLeadFields = leadDesc.fields.filter(f => f.name.toLowerCase().includes('partner'));
    console.log('Lead의 Partner 관련 필드:', partnerLeadFields.map(f => `${f.name}(${f.type})`).join(', '));
  }
}

run().catch(e => {
  console.error('Error:', e.response?.data || e.message);
  process.exit(1);
});
