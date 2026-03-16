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
  if (!arr.length) return { count: 0, avg: '-', median: '-' };
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  return { count: sorted.length, avg: Math.round(sum / sorted.length * 10) / 10, median };
}

async function main() {
  const { accessToken, instanceUrl } = await getSalesforceToken();
  console.log('✅ Salesforce 연결 성공\n');

  // 9개월 데이터
  const nineMonthsAgo = new Date();
  nineMonthsAgo.setMonth(nineMonthsAgo.getMonth() - 9);
  const startDate = nineMonthsAgo.toISOString().split('T')[0] + 'T00:00:00Z';

  // 인바운드만
  const oppQuery = `
    SELECT Id, Name, StageName, CreatedDate, CloseDate, LastStageChangeDate,
      OwnerId, Owner.Name, Owner_Department__c, fm_CompanyStatus__c,
      IsClosed, IsWon
    FROM Opportunity
    WHERE RecordType.Name = '1. 테이블오더 (신규)'
      AND Owner_Department__c = '인바운드세일즈'
      AND CreatedDate >= ${startDate}
    ORDER BY CreatedDate ASC
  `.replace(/\s+/g, ' ').trim();

  const opps = await soqlQueryAll(instanceUrl, accessToken, oppQuery);
  console.log(`📊 인바운드 영업기회: ${opps.length}건 (${startDate.substring(0, 10)} 이후)\n`);

  // Task 조회
  const oppIds = opps.map(o => o.Id);
  const chunkSize = 500;
  let allTasks = [];
  for (let i = 0; i < oppIds.length; i += chunkSize) {
    const chunk = oppIds.slice(i, i + chunkSize);
    const ids = chunk.map(id => `'${id}'`).join(',');
    const taskQuery = `SELECT Id, WhatId, CreatedDate FROM Task WHERE WhatId IN (${ids}) ORDER BY CreatedDate ASC`;
    const tasks = await soqlQueryAll(instanceUrl, accessToken, taskQuery);
    allTasks.push(...tasks);
  }
  console.log(`📝 Task: ${allTasks.length}건\n`);

  // Opp별 Task 수 매핑
  const taskCountByOpp = {};
  allTasks.forEach(t => {
    taskCountByOpp[t.WhatId] = (taskCountByOpp[t.WhatId] || 0) + 1;
  });

  // 영업기회 데이터 정리
  const oppData = opps.map(opp => {
    const status = opp.IsWon ? 'CW' : (opp.IsClosed ? 'CL' : 'Open');
    const storeType = (opp.fm_CompanyStatus__c || '') === '오픈전' ? '오픈전' : '운영중';
    const taskCount = taskCountByOpp[opp.Id] || 0;
    const closeDate = opp.LastStageChangeDate || opp.CloseDate;
    const duration = (status !== 'Open' && closeDate) ? calcDays(opp.CreatedDate, closeDate) : null;

    return {
      id: opp.Id, name: opp.Name, status, storeType,
      ownerId: opp.OwnerId, owner: opp.Owner?.Name,
      createdDate: opp.CreatedDate,
      closeDate: status !== 'Open' ? closeDate : null,
      taskCount, duration,
    };
  });

  // ====================================================================
  // 핵심: 영업기회 생성 시점의 "담당자 동시 파이프라인 수" 계산
  // ====================================================================
  console.log('⏳ 동시 파이프라인 부하 계산 중...\n');

  oppData.forEach(opp => {
    const createdAt = new Date(opp.createdDate);
    // 같은 담당자의 다른 영업기회 중, 이 시점에 Open이었던 건 수
    opp.concurrentPipeline = oppData.filter(other => {
      if (other.id === opp.id) return false;
      if (other.ownerId !== opp.ownerId) return false;
      const otherCreated = new Date(other.createdDate);
      if (otherCreated > createdAt) return false;
      if (other.status === 'Open') return true;
      if (other.closeDate) return new Date(other.closeDate) > createdAt;
      return false;
    }).length;
  });

  const closedOpps = oppData.filter(d => d.status !== 'Open');

  // ====================================================================
  // 분석 1: 동시 파이프라인 부하 구간별 → Task 관리 밀도 & CW율
  // "담당자가 X건을 동시에 관리할 때, Task를 제대로 만들었나? CW 됐나?"
  // ====================================================================
  console.log('═'.repeat(70));
  console.log('  분석 1: 생성 시점 파이프라인 부하 vs Task 관리 & CW율');
  console.log('  "담당자가 이미 X건을 관리 중일 때 들어온 건의 성과"');
  console.log('═'.repeat(70));

  const loadBuckets = [
    { label: '0~5건', min: 0, max: 5 },
    { label: '6~10건', min: 6, max: 10 },
    { label: '11~20건', min: 11, max: 20 },
    { label: '21~30건', min: 21, max: 30 },
    { label: '31~50건', min: 31, max: 50 },
    { label: '51건 이상', min: 51, max: 9999 },
  ];

  // 전체
  console.log(`\n  Closed 건 기준 (${closedOpps.length}건)`);
  console.log(`  ${'파이프라인부하'.padEnd(14)} ${'전체'.padStart(6)} ${'CW'.padStart(5)} ${'CL'.padStart(5)} ${'CW율'.padStart(8)} ${'Task有율'.padStart(9)} ${'Task평균'.padStart(9)}`);
  console.log('  ' + '─'.repeat(58));

  loadBuckets.forEach(b => {
    const items = closedOpps.filter(d => d.concurrentPipeline >= b.min && d.concurrentPipeline <= b.max);
    const cw = items.filter(d => d.status === 'CW').length;
    const cl = items.filter(d => d.status === 'CL').length;
    const total = cw + cl;
    if (total === 0) return;
    const cwRate = ((cw / total) * 100).toFixed(1) + '%';
    const hasTaskRate = ((items.filter(d => d.taskCount > 0).length / total) * 100).toFixed(1) + '%';
    const avgTasks = (items.reduce((a, d) => a + d.taskCount, 0) / total).toFixed(1);

    console.log(`  ${b.label.padEnd(14)} ${String(total).padStart(6)} ${String(cw).padStart(5)} ${String(cl).padStart(5)} ${cwRate.padStart(8)} ${hasTaskRate.padStart(9)} ${avgTasks.padStart(9)}`);
  });

  // 운영중/오픈전
  ['운영중', '오픈전'].forEach(st => {
    const stLabel = st === '운영중' ? '🏪 운영중' : '🔨 오픈전';
    const stClosed = closedOpps.filter(d => d.storeType === st);
    if (stClosed.length === 0) return;
    console.log(`\n  [${stLabel}] Closed: ${stClosed.length}건`);
    console.log(`  ${'파이프라인부하'.padEnd(14)} ${'전체'.padStart(6)} ${'CW'.padStart(5)} ${'CL'.padStart(5)} ${'CW율'.padStart(8)} ${'Task有율'.padStart(9)} ${'Task평균'.padStart(9)}`);
    console.log('  ' + '─'.repeat(58));

    loadBuckets.forEach(b => {
      const items = stClosed.filter(d => d.concurrentPipeline >= b.min && d.concurrentPipeline <= b.max);
      const cw = items.filter(d => d.status === 'CW').length;
      const cl = items.filter(d => d.status === 'CL').length;
      const total = cw + cl;
      if (total === 0) return;
      const cwRate = ((cw / total) * 100).toFixed(1) + '%';
      const hasTaskRate = ((items.filter(d => d.taskCount > 0).length / total) * 100).toFixed(1) + '%';
      const avgTasks = (items.reduce((a, d) => a + d.taskCount, 0) / total).toFixed(1);
      console.log(`  ${b.label.padEnd(14)} ${String(total).padStart(6)} ${String(cw).padStart(5)} ${String(cl).padStart(5)} ${cwRate.padStart(8)} ${hasTaskRate.padStart(9)} ${avgTasks.padStart(9)}`);
    });
  });

  // ====================================================================
  // 분석 2: 담당자별 현재 상태 - Open 건수 vs 최근 3개월 성과
  // ====================================================================
  console.log('\n' + '═'.repeat(70));
  console.log('  분석 2: 담당자별 현재 파이프라인 vs 최근 3개월 성과');
  console.log('═'.repeat(70));

  const owners = [...new Set(oppData.map(d => d.owner))].filter(Boolean);
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const ownerStats = owners.map(owner => {
    const ownerOpps = oppData.filter(d => d.owner === owner);
    const now = new Date();
    const currentOpen = ownerOpps.filter(d => d.status === 'Open').length;
    const staleOpen = ownerOpps.filter(d => d.status === 'Open' && calcDays(d.createdDate, now) > 30).length;
    const recentClosed = ownerOpps.filter(d => d.status !== 'Open' && new Date(d.createdDate) >= threeMonthsAgo);
    const recentCW = recentClosed.filter(d => d.status === 'CW').length;
    const recentCL = recentClosed.filter(d => d.status === 'CL').length;
    const total = recentCW + recentCL;
    const cwRate = total > 0 ? (recentCW / total * 100) : 0;
    const hasTaskRate = total > 0 ? (recentClosed.filter(d => d.taskCount > 0).length / total * 100) : 0;
    const avgTasks = total > 0 ? (recentClosed.reduce((a, d) => a + d.taskCount, 0) / total) : 0;

    return {
      owner, currentOpen, staleOpen, total,
      recentCW, recentCL,
      cwRate: cwRate.toFixed(1),
      hasTaskRate: hasTaskRate.toFixed(1),
      avgTasks: avgTasks.toFixed(1),
    };
  }).filter(s => s.total >= 3)
    .sort((a, b) => b.currentOpen - a.currentOpen);

  console.log(`\n  ${'담당자'.padEnd(10)} ${'현재Open'.padStart(8)} ${'30+체류'.padStart(8)} ${'최근CW'.padStart(7)} ${'최근CL'.padStart(7)} ${'CW율'.padStart(7)} ${'Task有율'.padStart(9)} ${'Task평균'.padStart(9)}`);
  console.log('  ' + '─'.repeat(67));

  ownerStats.forEach(s => {
    console.log(
      `  ${(s.owner || '').padEnd(10)} ${String(s.currentOpen).padStart(8)} ${String(s.staleOpen).padStart(8)} ${String(s.recentCW).padStart(7)} ${String(s.recentCL).padStart(7)} ${(s.cwRate + '%').padStart(7)} ${(s.hasTaskRate + '%').padStart(9)} ${s.avgTasks.padStart(9)}`
    );
  });

  // 그룹 비교
  if (ownerStats.length >= 2) {
    const sorted = [...ownerStats].sort((a, b) => b.currentOpen - a.currentOpen);
    const topHalf = sorted.slice(0, Math.ceil(sorted.length / 2));
    const bottomHalf = sorted.slice(Math.ceil(sorted.length / 2));

    if (topHalf.length > 0 && bottomHalf.length > 0) {
      const topCW = topHalf.reduce((a, b) => a + parseFloat(b.cwRate), 0) / topHalf.length;
      const bottomCW = bottomHalf.reduce((a, b) => a + parseFloat(b.cwRate), 0) / bottomHalf.length;
      const topTask = topHalf.reduce((a, b) => a + parseFloat(b.hasTaskRate), 0) / topHalf.length;
      const bottomTask = bottomHalf.reduce((a, b) => a + parseFloat(b.hasTaskRate), 0) / bottomHalf.length;
      const topAvgOpen = topHalf.reduce((a, b) => a + b.currentOpen, 0) / topHalf.length;
      const bottomAvgOpen = bottomHalf.reduce((a, b) => a + b.currentOpen, 0) / bottomHalf.length;

      console.log(`\n  📊 파이프라인 부하 상위 그룹 (${topHalf.length}명, 평균 Open ${topAvgOpen.toFixed(0)}건) vs 하위 그룹 (${bottomHalf.length}명, 평균 Open ${bottomAvgOpen.toFixed(0)}건)`);
      console.log(`     CW율: ${topCW.toFixed(1)}% vs ${bottomCW.toFixed(1)}%`);
      console.log(`     Task有율: ${topTask.toFixed(1)}% vs ${bottomTask.toFixed(1)}%`);
    }
  }

  // ====================================================================
  // 분석 3: 월별 추이
  // ====================================================================
  console.log('\n' + '═'.repeat(70));
  console.log('  분석 3: 월별 파이프라인 누적량 vs 신규건 Task 관리 & CW율');
  console.log('═'.repeat(70));

  const months = [...new Set(oppData.map(d => d.createdDate.substring(0, 7)))].sort();

  console.log(`\n  ${'월'.padEnd(10)} ${'신규건'.padStart(6)} ${'월말Open'.padStart(9)} ${'CW'.padStart(5)} ${'CL'.padStart(5)} ${'CW율'.padStart(8)} ${'Task有율'.padStart(9)} ${'Task평균'.padStart(9)}`);
  console.log('  ' + '─'.repeat(63));

  months.forEach(month => {
    const monthEnd = new Date(month + '-28T23:59:59Z');
    const monthOpps = oppData.filter(d => d.createdDate.startsWith(month));

    // 월말 시점 Open 추정
    const estimatedOpen = oppData.filter(d => {
      const created = new Date(d.createdDate);
      if (created > monthEnd) return false;
      if (d.status === 'Open') return true;
      if (d.closeDate) return new Date(d.closeDate) > monthEnd;
      return false;
    }).length;

    const monthClosed = monthOpps.filter(d => d.status !== 'Open');
    const cw = monthClosed.filter(d => d.status === 'CW').length;
    const cl = monthClosed.filter(d => d.status === 'CL').length;
    const total = cw + cl;
    const cwRate = total > 0 ? ((cw / total) * 100).toFixed(1) + '%' : '-';
    const hasTaskRate = monthOpps.length > 0
      ? ((monthOpps.filter(d => d.taskCount > 0).length / monthOpps.length) * 100).toFixed(1) + '%'
      : '-';
    const avgTasks = monthOpps.length > 0
      ? (monthOpps.reduce((a, d) => a + d.taskCount, 0) / monthOpps.length).toFixed(1)
      : '-';

    console.log(`  ${month.padEnd(10)} ${String(monthOpps.length).padStart(6)} ${String(estimatedOpen).padStart(9)} ${String(cw).padStart(5)} ${String(cl).padStart(5)} ${cwRate.padStart(8)} ${hasTaskRate.padStart(9)} ${avgTasks.padStart(9)}`);
  });

  // ====================================================================
  // 분석 4: 정리 시뮬레이션
  // ====================================================================
  console.log('\n' + '═'.repeat(70));
  console.log('  분석 4: 30일 이상 체류 건 정리 시뮬레이션');
  console.log('═'.repeat(70));

  const now = new Date();
  const openOpps = oppData.filter(d => d.status === 'Open');
  const staleOpps = openOpps.filter(d => calcDays(d.createdDate, now) > 30);

  console.log(`\n  현재 전체 Open: ${openOpps.length}건`);
  console.log(`  30일+ 체류: ${staleOpps.length}건 (${(staleOpps.length / openOpps.length * 100).toFixed(1)}%)`);
  console.log(`  정리 후: ${openOpps.length - staleOpps.length}건`);

  // 체류 건 중 Task 없는 비율
  const staleNoTask = staleOpps.filter(d => d.taskCount === 0).length;
  console.log(`  30일+ 체류 건 중 Task 없음: ${staleNoTask}건 (${(staleNoTask / staleOpps.length * 100).toFixed(1)}%)`);

  console.log(`\n  ${'담당자'.padEnd(10)} ${'현재Open'.padStart(8)} ${'30+체류'.padStart(8)} ${'정리후'.padStart(8)} ${'감소율'.padStart(8)}`);
  console.log('  ' + '─'.repeat(44));

  owners.forEach(owner => {
    const ownerOpen = openOpps.filter(d => d.owner === owner);
    const ownerStale = staleOpps.filter(d => d.owner === owner);
    if (ownerOpen.length === 0) return;
    const after = ownerOpen.length - ownerStale.length;
    const reduction = ((ownerStale.length / ownerOpen.length) * 100).toFixed(1);
    console.log(
      `  ${(owner || '').padEnd(10)} ${String(ownerOpen.length).padStart(8)} ${String(ownerStale.length).padStart(8)} ${String(after).padStart(8)} ${(reduction + '%').padStart(8)}`
    );
  });

  // 과거 CW 기준 놓칠 수 있는 건
  const cwAll = closedOpps.filter(d => d.status === 'CW' && d.duration !== null);
  const cwOver30 = cwAll.filter(d => d.duration > 30).length;
  console.log(`\n  ⚡ CW건 중 30일 넘겨서 CW된 비율: ${(cwOver30 / cwAll.length * 100).toFixed(1)}% (${cwOver30}/${cwAll.length}건)`);
  console.log(`     → 정리 시 놓칠 가능성 있는 CW: ~${Math.round(staleOpps.length * (cwOver30 / cwAll.length) * (cwAll.length / closedOpps.length))}건`);
  console.log(`     → 정리로 담당자당 여유: 평균 ${Math.round(staleOpps.length / (owners.length || 1))}건 감소`);

  console.log('\n✅ 분석 완료');
}

main().catch(err => {
  console.error('오류:', err.message);
  if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
});
