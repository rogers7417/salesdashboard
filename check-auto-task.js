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

  // 이번달 채널 Lead의 Task 상세 확인
  console.log(`=== 이번달(${thisMonth}) 채널 Lead Task 상세 ===`);
  const sampleQuery = `
    SELECT Id, Name, CreatedDate, Owner.Name,
      (SELECT Id, Subject, Type, CreatedDate, CreatedById, CreatedBy.Name, Status
       FROM Tasks ORDER BY CreatedDate ASC LIMIT 5)
    FROM Lead
    WHERE LeadSource IN ('파트너사 소개', '프랜차이즈소개')
    AND CreatedDate >= ${thisMonthStart}
    ORDER BY CreatedDate DESC
    LIMIT 15
  `;
  const sampleRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: sampleQuery }
  });

  // Task Subject/CreatedBy 패턴 분석
  const taskPatterns = {};
  let autoTaskCount = 0;
  let manualTaskCount = 0;

  sampleRes.data.records.forEach(l => {
    const tasks = l.Tasks?.records || [];
    const leadTime = new Date(l.CreatedDate);

    console.log(`\n─────────────────────────────────────────────`);
    console.log(`Lead: ${l.Name || '-'} | 담당자: ${l.Owner?.Name || '-'}`);
    console.log(`Lead 생성: ${l.CreatedDate}`);

    if (tasks.length === 0) {
      console.log(`  → Task 없음`);
    } else {
      tasks.forEach((t, i) => {
        const taskTime = new Date(t.CreatedDate);
        const diffMin = Math.round((taskTime - leadTime) / 60000);
        const isAuto = diffMin <= 1; // 1분 이내면 자동 추정

        const key = `${t.Subject || 'null'} | ${t.CreatedBy?.Name || 'null'}`;
        taskPatterns[key] = (taskPatterns[key] || 0) + 1;

        if (isAuto) autoTaskCount++;
        else manualTaskCount++;

        console.log(`  Task ${i+1}: "${t.Subject || '-'}"`);
        console.log(`         생성자: ${t.CreatedBy?.Name || '-'} | FRT: ${diffMin}분 ${isAuto ? '← 자동?' : ''}`);
      });
    }
  });

  console.log(`\n\n=== Task 패턴 분석 (Subject | 생성자) ===`);
  Object.entries(taskPatterns)
    .sort((a, b) => b[1] - a[1])
    .forEach(([pattern, count]) => {
      console.log(`  ${pattern}: ${count}건`);
    });

  console.log(`\n=== 자동/수동 추정 ===`);
  console.log(`  1분 이내 생성 (자동 추정): ${autoTaskCount}건`);
  console.log(`  1분 초과 생성 (수동 추정): ${manualTaskCount}건`);

  // Task CreatedBy 분포 (전체)
  console.log(`\n=== Task 생성자 분포 (Lead 연결된 Task) ===`);
  const creatorQuery = `
    SELECT CreatedBy.Name, COUNT(Id) cnt
    FROM Task
    WHERE WhoId != null
    GROUP BY CreatedBy.Name
    ORDER BY COUNT(Id) DESC
    LIMIT 20
  `;
  const creatorRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: creatorQuery }
  });
  creatorRes.data.records.forEach(r => {
    console.log(`  ${(r.CreatedBy?.Name || 'null').padEnd(25)} ${r.cnt}건`);
  });
}

main().catch(err => {
  console.error('오류:', err.message);
  if (err.response) console.error(err.response.data);
});
