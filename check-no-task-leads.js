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

  const thisMonth = new Date().toISOString().substring(0, 7);
  const thisMonthStart = thisMonth + '-01T00:00:00Z';

  // 제외 사유
  const excludedLossReasons = ['오인입', '중복유입', '오생성'];

  // 이번달 채널 Lead 조회
  const query = `
    SELECT Id, Name, Company, Status, Owner.Name, CreatedDate, LossReason__c,
      (SELECT Id, Subject, CreatedBy.Name FROM Tasks ORDER BY CreatedDate ASC LIMIT 5)
    FROM Lead
    WHERE LeadSource IN ('파트너사 소개', '프랜차이즈소개')
    AND CreatedDate >= ${thisMonthStart}
    ORDER BY CreatedDate DESC
  `;

  const res = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: query }
  });

  // 자동 Task 판별
  const isAutoTask = (task) => {
    const creatorName = task.CreatedBy?.Name || '';
    const subject = task.Subject || '';
    return creatorName.includes('그로스팀 공용계정') || subject.includes('웰컴톡');
  };

  // MQL 중 수동 Task 없는 Lead 필터링
  const noManualTaskLeads = res.data.records.filter(l => {
    // MQL인지 확인 (제외 사유 없음)
    if (excludedLossReasons.includes(l.LossReason__c)) return false;

    // 수동 Task가 있는지 확인
    const tasks = l.Tasks?.records || [];
    const hasManualTask = tasks.some(t => !isAutoTask(t));
    return !hasManualTask;
  });

  console.log(`수동 Task 없는 MQL Lead: ${noManualTaskLeads.length}건\n`);
  console.log('=== 샘플 5건 ===\n');

  noManualTaskLeads.slice(0, 5).forEach((l, i) => {
    const tasks = l.Tasks?.records || [];
    console.log(`${i+1}. ID: ${l.Id}`);
    console.log(`   Name: ${l.Name || l.Company || '-'}`);
    console.log(`   Status: ${l.Status}`);
    console.log(`   Owner: ${l.Owner?.Name || '-'}`);
    console.log(`   Created: ${l.CreatedDate?.substring(0, 10)}`);
    console.log(`   Task 수: ${tasks.length}건 (모두 자동)`);
    if (tasks.length > 0) {
      tasks.forEach(t => {
        console.log(`     - "${t.Subject}" by ${t.CreatedBy?.Name || '-'}`);
      });
    }
    console.log('');
  });
}

main().catch(err => {
  console.error('오류:', err.message);
  if (err.response) console.error(err.response.data);
});
