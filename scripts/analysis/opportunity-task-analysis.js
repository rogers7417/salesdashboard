require('dotenv').config();
const axios = require('axios');

// ============================================
// Salesforce 연결
// ============================================
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

async function soqlQueryAll(instanceUrl, accessToken, query) {
  let allRecords = [];
  let nextUrl = `${instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(query)}`;
  while (nextUrl) {
    const res = await axios.get(nextUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    allRecords.push(...(res.data.records || []));
    nextUrl = res.data.nextRecordsUrl ? `${instanceUrl}${res.data.nextRecordsUrl}` : null;
  }
  return allRecords;
}

function calcDays(d1, d2) {
  return Math.round((new Date(d2) - new Date(d1)) / 86400000);
}

function getStats(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  return {
    count: sorted.length,
    avg: Math.round(sum / sorted.length * 10) / 10,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

// ============================================
// 메인
// ============================================
async function main() {
  const { accessToken, instanceUrl } = await getSalesforceToken();
  console.log('✅ Salesforce 연결 성공\n');

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const startDate = sixMonthsAgo.toISOString().split('T')[0] + 'T00:00:00Z';

  // 1. 영업기회 조회
  const oppQuery = `
    SELECT Id, Name, StageName, CreatedDate, CloseDate, LastStageChangeDate,
      Owner.Name, Owner_Department__c, fm_CompanyStatus__c,
      IsClosed, IsWon, LastActivityDate
    FROM Opportunity
    WHERE RecordType.Name = '1. 테이블오더 (신규)'
      AND Owner_Department__c IN ('인바운드세일즈', '채널세일즈팀')
      AND CreatedDate >= ${startDate}
    ORDER BY CreatedDate DESC
  `.replace(/\s+/g, ' ').trim();

  const opps = await soqlQueryAll(instanceUrl, accessToken, oppQuery);
  console.log(`📊 영업기회: ${opps.length}건`);

  // 2. Task 조회 (영업기회 연결)
  const oppIds = opps.map(o => o.Id);
  // 500개씩 나눠서 조회
  const chunkSize = 500;
  let allTasks = [];
  for (let i = 0; i < oppIds.length; i += chunkSize) {
    const chunk = oppIds.slice(i, i + chunkSize);
    const ids = chunk.map(id => `'${id}'`).join(',');
    const taskQuery = `SELECT Id, WhatId, CreatedDate, Subject FROM Task WHERE WhatId IN (${ids}) ORDER BY CreatedDate DESC`;
    const tasks = await soqlQueryAll(instanceUrl, accessToken, taskQuery);
    allTasks.push(...tasks);
  }
  console.log(`📝 Task: ${allTasks.length}건\n`);

  // 3. Opp별 마지막 Task 날짜 매핑
  const lastTaskByOpp = {};
  const taskCountByOpp = {};
  allTasks.forEach(t => {
    const oppId = t.WhatId;
    taskCountByOpp[oppId] = (taskCountByOpp[oppId] || 0) + 1;
    if (!lastTaskByOpp[oppId] || t.CreatedDate > lastTaskByOpp[oppId]) {
      lastTaskByOpp[oppId] = t.CreatedDate;
    }
  });

  // 4. 데이터 조합
  const now = new Date();
  const data = opps.map(opp => {
    const status = opp.IsWon ? 'CW' : (opp.IsClosed ? 'CL' : 'Open');
    const dept = opp.Owner_Department__c;
    const storeType = (opp.fm_CompanyStatus__c || '') === '오픈전' ? '오픈전' : '운영중';
    const lastTask = lastTaskByOpp[opp.Id];
    const taskCount = taskCountByOpp[opp.Id] || 0;
    const hasTask = !!lastTask;

    // 마지막 Task 이후 경과일
    let daysSinceLastTask = null;
    if (lastTask) {
      if (status === 'Open') {
        daysSinceLastTask = calcDays(lastTask, now);
      } else {
        // Closed인 경우: 마지막 Task → Close 시점
        const closeDate = opp.LastStageChangeDate || opp.CloseDate;
        daysSinceLastTask = calcDays(lastTask, closeDate);
      }
    }

    // 생성 후 경과일 (Open 기준)
    const ageInDays = status === 'Open' ? calcDays(opp.CreatedDate, now) : null;

    return {
      id: opp.Id,
      name: opp.Name,
      status, dept, storeType,
      owner: opp.Owner?.Name,
      createdDate: opp.CreatedDate?.substring(0, 10),
      taskCount, hasTask, lastTask,
      daysSinceLastTask,
      ageInDays,
    };
  });

  // ============================================
  // 분석 1: 마지막 Task 이후 경과일 vs CW/CL 결과
  // ============================================
  console.log('═'.repeat(70));
  console.log('  마지막 Task 경과일 vs CW/CL 분석');
  console.log('  "마지막 Task 이후 X일 경과 시 CL 확률"');
  console.log('═'.repeat(70));

  const closedWithTask = data.filter(d => d.status !== 'Open' && d.hasTask && d.daysSinceLastTask !== null);
  const buckets = [
    { label: '0~3일', min: 0, max: 3 },
    { label: '4~7일', min: 4, max: 7 },
    { label: '8~14일', min: 8, max: 14 },
    { label: '15~21일', min: 15, max: 21 },
    { label: '22~30일', min: 22, max: 30 },
    { label: '31~60일', min: 31, max: 60 },
    { label: '61일 이상', min: 61, max: 9999 },
  ];

  console.log(`\n  Task 있는 Closed 건: ${closedWithTask.length}건`);
  console.log(`\n  ${'마지막Task→Close'.padEnd(18)} ${'전체'.padStart(6)} ${'CW'.padStart(6)} ${'CL'.padStart(6)} ${'CW율'.padStart(8)} ${'CL율'.padStart(8)}`);
  console.log('  ' + '─'.repeat(54));

  buckets.forEach(b => {
    const items = closedWithTask.filter(d => d.daysSinceLastTask >= b.min && d.daysSinceLastTask <= b.max);
    const cw = items.filter(d => d.status === 'CW').length;
    const cl = items.filter(d => d.status === 'CL').length;
    const total = cw + cl;
    const cwRate = total > 0 ? ((cw / total) * 100).toFixed(1) + '%' : '-';
    const clRate = total > 0 ? ((cl / total) * 100).toFixed(1) + '%' : '-';
    console.log(`  ${b.label.padEnd(18)} ${String(total).padStart(6)} ${String(cw).padStart(6)} ${String(cl).padStart(6)} ${cwRate.padStart(8)} ${clRate.padStart(8)}`);
  });

  // 팀별로도
  ['인바운드세일즈', '채널세일즈팀'].forEach(dept => {
    const teamLabel = dept === '인바운드세일즈' ? '📞 인바운드' : '🤝 채널';
    const teamData = closedWithTask.filter(d => d.dept === dept);
    console.log(`\n  [${teamLabel}] Task 있는 Closed: ${teamData.length}건`);
    console.log(`  ${'마지막Task→Close'.padEnd(18)} ${'전체'.padStart(6)} ${'CW'.padStart(6)} ${'CL'.padStart(6)} ${'CW율'.padStart(8)} ${'CL율'.padStart(8)}`);
    console.log('  ' + '─'.repeat(54));
    buckets.forEach(b => {
      const items = teamData.filter(d => d.daysSinceLastTask >= b.min && d.daysSinceLastTask <= b.max);
      const cw = items.filter(d => d.status === 'CW').length;
      const cl = items.filter(d => d.status === 'CL').length;
      const total = cw + cl;
      const cwRate = total > 0 ? ((cw / total) * 100).toFixed(1) + '%' : '-';
      const clRate = total > 0 ? ((cl / total) * 100).toFixed(1) + '%' : '-';
      console.log(`  ${b.label.padEnd(18)} ${String(total).padStart(6)} ${String(cw).padStart(6)} ${String(cl).padStart(6)} ${cwRate.padStart(8)} ${clRate.padStart(8)}`);
    });
  });

  // ============================================
  // 분석 2: Task 없는 건의 CW/CL 비교
  // ============================================
  console.log('\n═'.repeat(70));
  console.log('  Task 유무별 CW/CL 비율');
  console.log('═'.repeat(70));

  const closed = data.filter(d => d.status !== 'Open');
  const withTask = closed.filter(d => d.hasTask);
  const noTask = closed.filter(d => !d.hasTask);

  console.log(`\n  ${'구분'.padEnd(18)} ${'전체'.padStart(6)} ${'CW'.padStart(6)} ${'CL'.padStart(6)} ${'CW율'.padStart(8)} ${'CL율'.padStart(8)}`);
  console.log('  ' + '─'.repeat(54));

  [{ label: 'Task 있음', items: withTask }, { label: 'Task 없음', items: noTask }].forEach(({ label, items }) => {
    const cw = items.filter(d => d.status === 'CW').length;
    const cl = items.filter(d => d.status === 'CL').length;
    const total = cw + cl;
    const cwRate = total > 0 ? ((cw / total) * 100).toFixed(1) + '%' : '-';
    const clRate = total > 0 ? ((cl / total) * 100).toFixed(1) + '%' : '-';
    console.log(`  ${label.padEnd(18)} ${String(total).padStart(6)} ${String(cw).padStart(6)} ${String(cl).padStart(6)} ${cwRate.padStart(8)} ${clRate.padStart(8)}`);
  });

  // 팀별
  ['인바운드세일즈', '채널세일즈팀'].forEach(dept => {
    const teamLabel = dept === '인바운드세일즈' ? '📞 인바운드' : '🤝 채널';
    const teamClosed = closed.filter(d => d.dept === dept);
    const tw = teamClosed.filter(d => d.hasTask);
    const nt = teamClosed.filter(d => !d.hasTask);
    console.log(`\n  [${teamLabel}]`);
    console.log(`  ${'구분'.padEnd(18)} ${'전체'.padStart(6)} ${'CW'.padStart(6)} ${'CL'.padStart(6)} ${'CW율'.padStart(8)} ${'CL율'.padStart(8)}`);
    console.log('  ' + '─'.repeat(54));
    [{ label: 'Task 있음', items: tw }, { label: 'Task 없음', items: nt }].forEach(({ label, items }) => {
      const cw = items.filter(d => d.status === 'CW').length;
      const cl = items.filter(d => d.status === 'CL').length;
      const total = cw + cl;
      const cwRate = total > 0 ? ((cw / total) * 100).toFixed(1) + '%' : '-';
      const clRate = total > 0 ? ((cl / total) * 100).toFixed(1) + '%' : '-';
      console.log(`  ${label.padEnd(18)} ${String(total).padStart(6)} ${String(cw).padStart(6)} ${String(cl).padStart(6)} ${cwRate.padStart(8)} ${clRate.padStart(8)}`);
    });
  });

  // ============================================
  // 분석 3: 현재 Open 건 경고 (파이프라인 좀비 식별)
  // ============================================
  console.log('\n═'.repeat(70));
  console.log('  현재 Open 건 파이프라인 경과일 분석');
  console.log('  (현재 파이프라인에 남아있는 건들의 위험도)');
  console.log('═'.repeat(70));

  const openItems = data.filter(d => d.status === 'Open');
  const openBuckets = [
    { label: '7일 이내', min: 0, max: 7 },
    { label: '8~14일', min: 8, max: 14 },
    { label: '15~30일', min: 15, max: 30 },
    { label: '31~60일', min: 31, max: 60 },
    { label: '61~90일', min: 61, max: 90 },
    { label: '91일 이상', min: 91, max: 9999 },
  ];

  // Open 건의 경과일별 분포
  console.log(`\n  전체 Open: ${openItems.length}건`);

  // 과거 데이터 기반: 생성 후 X일 경과 시 CW 확률
  const allClosed = data.filter(d => d.status !== 'Open');
  console.log(`\n  [참고: 경과일별 CW 확률 (과거 Closed 데이터 기준)]`);
  console.log(`  ${'생성후 경과일'.padEnd(18)} ${'전체'.padStart(6)} ${'CW'.padStart(6)} ${'CL'.padStart(6)} ${'CW확률'.padStart(8)}`);
  console.log('  ' + '─'.repeat(40));

  // Closed 건의 기간 계산
  const closedWithDays = allClosed.map(d => {
    const closeDate = d.lastTask ? undefined : undefined; // not needed
    // 이미 opportunity-duration에서 했듯이 LastStageChangeDate 기반
    return d;
  });

  // Closed 건의 CW까지 걸린 일수 분포로 "X일 이상 지나면 CW 확률" 계산
  const cwItems = data.filter(d => d.status === 'CW');
  const clItems = data.filter(d => d.status === 'CL');

  // CW/CL 기간 재계산 (CreatedDate → LastStageChangeDate)
  const cwDurations = [];
  const clDurations = [];
  opps.forEach(opp => {
    const status = opp.IsWon ? 'CW' : (opp.IsClosed ? 'CL' : 'Open');
    if (status === 'Open') return;
    const closeDate = opp.LastStageChangeDate || opp.CloseDate;
    const days = calcDays(opp.CreatedDate, closeDate);
    if (status === 'CW') cwDurations.push(days);
    else clDurations.push(days);
  });

  // 누적 확률: "X일 이상 경과한 건 중 CW 비율"
  const thresholds = [7, 14, 21, 30, 45, 60, 90];
  console.log(`\n  [X일 이상 경과했을 때 CW될 확률]`);
  console.log(`  ${'경과일 기준'.padEnd(18)} ${'CW'.padStart(6)} ${'CL'.padStart(6)} ${'CW확률'.padStart(8)} ${'의미'.padStart(20)}`);
  console.log('  ' + '─'.repeat(60));

  thresholds.forEach(t => {
    const cwOver = cwDurations.filter(d => d >= t).length;
    const clOver = clDurations.filter(d => d >= t).length;
    const total = cwOver + clOver;
    const cwRate = total > 0 ? ((cwOver / total) * 100).toFixed(1) + '%' : '-';
    let meaning = '';
    if (total > 0) {
      const pct = (cwOver / total) * 100;
      if (pct < 20) meaning = '⚠️ CW 가능성 매우 낮음';
      else if (pct < 35) meaning = '🟡 CW 가능성 낮음';
      else if (pct < 50) meaning = '🟠 주의 필요';
      else meaning = '';
    }
    console.log(`  ${(t + '일 이상').padEnd(18)} ${String(cwOver).padStart(6)} ${String(clOver).padStart(6)} ${cwRate.padStart(8)} ${meaning.padStart(20)}`);
  });

  // 현재 Open 건 경과일 분포 + Task 유무
  console.log(`\n  [현재 Open 건 경과일 분포]`);
  console.log(`  ${'경과일'.padEnd(18)} ${'전체'.padStart(6)} ${'Task有'.padStart(8)} ${'Task無'.padStart(8)} ${'Task無 비율'.padStart(12)}`);
  console.log('  ' + '─'.repeat(54));

  openBuckets.forEach(b => {
    const items = openItems.filter(d => d.ageInDays >= b.min && d.ageInDays <= b.max);
    const wt = items.filter(d => d.hasTask).length;
    const nt = items.filter(d => !d.hasTask).length;
    const ntRate = items.length > 0 ? ((nt / items.length) * 100).toFixed(1) + '%' : '-';
    console.log(`  ${b.label.padEnd(18)} ${String(items.length).padStart(6)} ${String(wt).padStart(8)} ${String(nt).padStart(8)} ${ntRate.padStart(12)}`);
  });

  // 팀별 Open 건
  ['인바운드세일즈', '채널세일즈팀'].forEach(dept => {
    const teamLabel = dept === '인바운드세일즈' ? '📞 인바운드' : '🤝 채널';
    const teamOpen = openItems.filter(d => d.dept === dept);
    console.log(`\n  [${teamLabel}] Open: ${teamOpen.length}건`);
    console.log(`  ${'경과일'.padEnd(18)} ${'전체'.padStart(6)} ${'Task有'.padStart(8)} ${'Task無'.padStart(8)} ${'Task無 비율'.padStart(12)}`);
    console.log('  ' + '─'.repeat(54));
    openBuckets.forEach(b => {
      const items = teamOpen.filter(d => d.ageInDays >= b.min && d.ageInDays <= b.max);
      const wt = items.filter(d => d.hasTask).length;
      const nt = items.filter(d => !d.hasTask).length;
      const ntRate = items.length > 0 ? ((nt / items.length) * 100).toFixed(1) + '%' : '-';
      console.log(`  ${b.label.padEnd(18)} ${String(items.length).padStart(6)} ${String(wt).padStart(8)} ${String(nt).padStart(8)} ${ntRate.padStart(12)}`);
    });
  });

  console.log('\n✅ 분석 완료');
}

main().catch(err => {
  console.error('오류:', err.message);
  if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
});
