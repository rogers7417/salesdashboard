/**
 * Lead 오브젝트의 커스텀 필드 조회
 * "운영중", "오픈전" 관련 필드 찾기
 */
require('dotenv').config({ path: __dirname + '/.env' });
const axios = require('axios');

async function main() {
  const authUrl = process.env.SF_LOGIN_URL + '/services/oauth2/token';
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', process.env.SF_CLIENT_ID);
  params.append('client_secret', process.env.SF_CLIENT_SECRET);
  params.append('username', process.env.SF_USERNAME);
  params.append('password', decodeURIComponent(process.env.SF_PASSWORD));

  const auth = await axios.post(authUrl, params);
  const accessToken = auth.data.access_token;
  const instanceUrl = auth.data.instance_url;

  // Lead describe
  const res = await axios.get(
    `${instanceUrl}/services/data/v59.0/sobjects/Lead/describe`,
    { headers: { 'Authorization': 'Bearer ' + accessToken } }
  );

  const fields = res.data.fields;

  // 커스텀 필드 (__c) 중 "운영", "오픈", "상태", "status", "store", "shop", "open" 관련
  const keywords = ['운영', '오픈', '상태', 'status', 'store', 'shop', 'open', 'stage', 'phase', 'type'];
  
  console.log('=== Lead 커스텀 필드 (키워드 매칭) ===\n');
  
  const matched = fields.filter(f => {
    const searchText = `${f.name} ${f.label}`.toLowerCase();
    return keywords.some(kw => searchText.includes(kw.toLowerCase()));
  });

  matched.forEach(f => {
    console.log(`  ${f.name} | "${f.label}" | ${f.type}`);
    if (f.picklistValues && f.picklistValues.length > 0) {
      const values = f.picklistValues.filter(v => v.active).map(v => v.value);
      console.log(`    값: ${values.join(', ')}`);
    }
  });

  // 전체 커스텀 필드도 출력
  console.log('\n=== 전체 커스텀 필드 (__c) ===\n');
  const customFields = fields.filter(f => f.name.endsWith('__c'));
  customFields.forEach(f => {
    const vals = (f.picklistValues || []).filter(v => v.active).map(v => v.value);
    const valStr = vals.length > 0 ? ` → [${vals.join(', ')}]` : '';
    console.log(`  ${f.name} | "${f.label}" | ${f.type}${valStr}`);
  });
}

main().catch(err => {
  console.error('오류:', err.message);
  if (err.response) console.error(err.response.data);
});