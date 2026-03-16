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

  // 1. Lead Status 필드 값 확인
  console.log('=== Lead Status 값 확인 ===');
  const leadStatusQuery = "SELECT Status, COUNT(Id) cnt FROM Lead GROUP BY Status ORDER BY COUNT(Id) DESC";
  const leadStatusRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: leadStatusQuery }
  });
  leadStatusRes.data.records.forEach(r => {
    console.log(`  ${(r.Status || 'null').padEnd(30)} ${r.cnt}건`);
  });

  // 2. Lead 전환 여부 확인
  console.log('\n=== Lead 전환 현황 ===');
  const leadConvertQuery = "SELECT IsConverted, COUNT(Id) cnt FROM Lead GROUP BY IsConverted";
  const leadConvertRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: leadConvertQuery }
  });
  leadConvertRes.data.records.forEach(r => {
    console.log(`  ${r.IsConverted ? '전환됨' : '미전환'}: ${r.cnt}건`);
  });

  // 3. Lead 필드 중 MQL/SQL 관련 필드 확인
  console.log('\n=== Lead 객체 필드 확인 (MQL/SQL 관련) ===');
  const leadDescribe = await axios.get(instanceUrl + '/services/data/v59.0/sobjects/Lead/describe', {
    headers: { 'Authorization': 'Bearer ' + accessToken }
  });
  const relevantFields = leadDescribe.data.fields.filter(f =>
    f.name.toLowerCase().includes('mql') ||
    f.name.toLowerCase().includes('sql') ||
    f.name.toLowerCase().includes('stage') ||
    f.name.toLowerCase().includes('status') ||
    f.name.toLowerCase().includes('convert') ||
    f.name.toLowerCase().includes('response') ||
    f.name.toLowerCase().includes('owner')
  );
  relevantFields.forEach(f => {
    console.log(`  ${f.name.padEnd(40)} ${f.type.padEnd(15)} ${f.label}`);
  });

  // 4. Task와 Lead 연결 확인 (첫 응답 시간 계산용)
  console.log('\n=== Lead와 Task 연결 확인 ===');
  const taskLeadQuery = `
    SELECT Id, Subject, CreatedDate, WhoId, Who.Type
    FROM Task
    WHERE WhoId != null
    LIMIT 10
  `;
  const taskLeadRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: taskLeadQuery }
  });
  console.log(`Task-Lead 연결 샘플: ${taskLeadRes.data.totalSize}건`);
  taskLeadRes.data.records.slice(0, 5).forEach(t => {
    console.log(`  ${t.Subject?.substring(0, 30) || '-'} / WhoId: ${t.WhoId} / Type: ${t.Who?.Type || '-'}`);
  });

  // 5. Opportunity Stage 값 확인
  console.log('\n=== Opportunity StageName 값 확인 ===');
  const oppStageQuery = "SELECT StageName, COUNT(Id) cnt FROM Opportunity GROUP BY StageName ORDER BY COUNT(Id) DESC";
  const oppStageRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: oppStageQuery }
  });
  oppStageRes.data.records.forEach(r => {
    console.log(`  ${(r.StageName || 'null').padEnd(30)} ${r.cnt}건`);
  });

  // 6. 이번 달 Lead → Opportunity 전환 건수
  console.log('\n=== 이번 달 Lead 전환 현황 ===');
  const thisMonth = new Date().toISOString().substring(0, 7);
  const thisMonthStartDate = thisMonth + '-01';  // date 타입용
  const thisMonthStart = thisMonth + '-01T00:00:00Z';  // datetime 타입용
  const convertedQuery = `
    SELECT Id, Name, Status, ConvertedDate, ConvertedOpportunityId, Owner.Name
    FROM Lead
    WHERE IsConverted = true
    AND ConvertedDate >= ${thisMonthStartDate}
    ORDER BY ConvertedDate DESC
    LIMIT 20
  `;
  const convertedRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: convertedQuery }
  });
  console.log(`이번 달(${thisMonth}) 전환된 Lead: ${convertedRes.data.totalSize}건`);
  convertedRes.data.records.slice(0, 10).forEach(l => {
    console.log(`  ${l.Name?.substring(0, 25).padEnd(27) || '-'} ${l.Owner?.Name?.padEnd(10) || '-'} ${l.ConvertedDate?.substring(0, 10) || '-'}`);
  });

  // 7. First Response Time 계산 가능 여부 - Lead 생성 후 첫 Task
  console.log('\n=== First Response Time 샘플 (최근 Lead) ===');
  const recentLeadQuery = `
    SELECT Id, Name, CreatedDate, Owner.Name,
      (SELECT Id, Subject, CreatedDate FROM Tasks ORDER BY CreatedDate ASC LIMIT 1)
    FROM Lead
    WHERE CreatedDate >= ${thisMonthStart}
    ORDER BY CreatedDate DESC
    LIMIT 10
  `;
  const recentLeadRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: recentLeadQuery }
  });
  console.log(`이번 달 생성된 Lead 중 Task 연결 확인:`);
  recentLeadRes.data.records.forEach(l => {
    const firstTask = l.Tasks?.records?.[0];
    let frt = '-';
    if (firstTask) {
      const leadCreated = new Date(l.CreatedDate);
      const taskCreated = new Date(firstTask.CreatedDate);
      const diffMin = Math.round((taskCreated - leadCreated) / 60000);
      frt = `${diffMin}분`;
    }
    console.log(`  ${l.Name?.substring(0, 25).padEnd(27) || '-'} Lead생성: ${l.CreatedDate?.substring(0, 16)} FRT: ${frt}`);
  });

  // 8. 7일 초과 SQL (영업기회 중 특정 Stage에서 오래 머문 건)
  console.log('\n=== 7일 초과 체류 Opportunity (방문~견적 단계) ===');
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const staleOppQuery = `
    SELECT Id, Name, StageName, CreatedDate, LastModifiedDate, Owner.Name
    FROM Opportunity
    WHERE IsClosed = false
    AND LastModifiedDate < ${sevenDaysAgo}
    ORDER BY LastModifiedDate ASC
    LIMIT 20
  `;
  const staleOppRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: staleOppQuery }
  });
  console.log(`7일 이상 미수정 Open Opportunity: ${staleOppRes.data.totalSize}건`);
  staleOppRes.data.records.slice(0, 10).forEach(o => {
    const daysSince = Math.round((Date.now() - new Date(o.LastModifiedDate)) / (24 * 60 * 60 * 1000));
    console.log(`  ${o.Name?.substring(0, 25).padEnd(27) || '-'} ${o.StageName?.padEnd(15) || '-'} ${daysSince}일 경과`);
  });

  console.log('\n=== 요약 ===');
  console.log('TM KPI 추출 가능 여부:');
  console.log('  1. 영업기회 전환 건수: ✓ (Lead.IsConverted, ConvertedDate)');
  console.log('  2. First Response Time: ✓ (Lead.CreatedDate vs Task.CreatedDate)');
  console.log('  3. MQL→SQL 미전환: ? (MQL/SQL 구분 필드 확인 필요)');
  console.log('  4. 7일 초과 SQL 잔량: ✓ (Opportunity Stage + LastModifiedDate)');
}

main().catch(err => {
  console.error('오류:', err.message);
  if (err.response) console.error(err.response.data);
});
