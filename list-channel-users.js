require('dotenv').config();
const axios = require('axios');

async function getSalesforceToken() {
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

async function soqlQuery(instanceUrl, accessToken, query) {
  const url = `${instanceUrl}/services/data/v59.0/query`;
  const res = await axios.get(url, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    params: { q: query }
  });
  return res.data;
}

async function main() {
  const { accessToken, instanceUrl } = await getSalesforceToken();
  console.log('✅ Salesforce 연결 성공\n');

  const query = `
    SELECT Id, Name, Email, Department, Title, IsActive
    FROM User
    WHERE Department = '채널세일즈팀'
    AND IsActive = true
    ORDER BY Name
  `;

  const result = await soqlQuery(instanceUrl, accessToken, query);
  const users = result.records;

  console.log(`👥 채널세일즈팀 인원: ${users.length}명\n`);
  console.log('─'.repeat(60));

  users.forEach((u, i) => {
    console.log(`${i + 1}. ${u.Name}`);
    console.log(`   ID: ${u.Id}`);
    console.log(`   Email: ${u.Email || '-'}`);
    console.log(`   직책: ${u.Title || '-'}`);
    console.log('');
  });

  // JSON 출력
  console.log('─'.repeat(60));
  console.log('\n📋 JSON 형식:');
  console.log(JSON.stringify(users.map(u => ({
    id: u.Id,
    name: u.Name,
    email: u.Email,
    title: u.Title
  })), null, 2));
}

main().catch(console.error);
