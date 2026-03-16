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

  // Lead 필드 중 FRT/Response/Time 관련 필드 확인
  console.log('=== Lead 객체 필드 (FRT/Response/Time 관련) ===');
  const leadDescribe = await axios.get(instanceUrl + '/services/data/v59.0/sobjects/Lead/describe', {
    headers: { 'Authorization': 'Bearer ' + accessToken }
  });

  const keywords = ['frt', 'response', 'time', 'first', 'contact', 'call', 'activity'];
  const relevantFields = leadDescribe.data.fields.filter(f =>
    keywords.some(k =>
      f.name.toLowerCase().includes(k) ||
      (f.label && f.label.toLowerCase().includes(k))
    )
  );

  relevantFields.forEach(f => {
    console.log(`  ${f.name.padEnd(45)} ${f.type.padEnd(15)} ${f.label}`);
  });

  // Task 필드 확인
  console.log('\n=== Task 객체 필드 (Type/Subject 관련) ===');
  const taskDescribe = await axios.get(instanceUrl + '/services/data/v59.0/sobjects/Task/describe', {
    headers: { 'Authorization': 'Bearer ' + accessToken }
  });

  const taskKeywords = ['type', 'subject', 'call', 'status'];
  const taskFields = taskDescribe.data.fields.filter(f =>
    taskKeywords.some(k =>
      f.name.toLowerCase().includes(k)
    )
  );

  taskFields.forEach(f => {
    console.log(`  ${f.name.padEnd(30)} ${f.type.padEnd(15)} ${f.label}`);
  });

  // Task Type/Subject 값 분포 확인
  console.log('\n=== Task Type 값 분포 ===');
  const taskTypeQuery = "SELECT Type, COUNT(Id) cnt FROM Task GROUP BY Type ORDER BY COUNT(Id) DESC LIMIT 20";
  const taskTypeRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: taskTypeQuery }
  });
  taskTypeRes.data.records.forEach(r => {
    console.log(`  ${(r.Type || 'null').padEnd(25)} ${r.cnt}건`);
  });

  console.log('\n=== Task Subject 값 분포 (상위 20개) ===');
  const taskSubjectQuery = "SELECT Subject, COUNT(Id) cnt FROM Task GROUP BY Subject ORDER BY COUNT(Id) DESC LIMIT 20";
  const taskSubjectRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: taskSubjectQuery }
  });
  taskSubjectRes.data.records.forEach(r => {
    console.log(`  ${(r.Subject || 'null').padEnd(35)} ${r.cnt}건`);
  });

  // 이번달 채널 Lead의 Task 확인
  const thisMonth = new Date().toISOString().substring(0, 7);
  const thisMonthStart = thisMonth + '-01T00:00:00Z';

  console.log(`\n=== 이번달(${thisMonth}) 채널 Lead의 Task 샘플 ===`);
  const sampleQuery = `
    SELECT Id, Name, CreatedDate, Owner.Name,
      (SELECT Id, Subject, Type, CreatedDate, Status FROM Tasks ORDER BY CreatedDate ASC LIMIT 3)
    FROM Lead
    WHERE LeadSource IN ('파트너사 소개', '프랜차이즈소개')
    AND CreatedDate >= ${thisMonthStart}
    ORDER BY CreatedDate DESC
    LIMIT 10
  `;
  const sampleRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: sampleQuery }
  });

  sampleRes.data.records.forEach(l => {
    const tasks = l.Tasks?.records || [];
    console.log(`\n  Lead: ${l.Name || '-'} (${l.Owner?.Name || '-'})`);
    console.log(`  Lead 생성: ${l.CreatedDate}`);
    if (tasks.length === 0) {
      console.log(`  Task: 없음`);
    } else {
      tasks.forEach((t, i) => {
        const leadTime = new Date(l.CreatedDate);
        const taskTime = new Date(t.CreatedDate);
        const diffMin = Math.round((taskTime - leadTime) / 60000);
        console.log(`  Task ${i+1}: ${t.Subject || '-'} / Type: ${t.Type || '-'} / 생성: ${t.CreatedDate} (${diffMin}분 후)`);
      });
    }
  });
}

main().catch(err => {
  console.error('오류:', err.message);
  if (err.response) console.error(err.response.data);
});
