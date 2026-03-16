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
  const url = `${instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(query)}`;
  let nextUrl = url;

  while (nextUrl) {
    const res = await axios.get(nextUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    allRecords.push(...(res.data.records || []));
    nextUrl = res.data.nextRecordsUrl ? `${instanceUrl}${res.data.nextRecordsUrl}` : null;
  }
  return allRecords;
}

// ============================================
// 기간 분석
// ============================================
function calcDays(createdDate, closeDate) {
  const created = new Date(createdDate);
  const closed = new Date(closeDate);
  return Math.round((closed - created) / (1000 * 60 * 60 * 24));
}

function getStats(durations) {
  if (durations.length === 0) return null;
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sorted.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

  return {
    count: sorted.length,
    avg: Math.round(avg * 10) / 10,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p25: sorted[Math.floor(sorted.length * 0.25)],
    p75: sorted[Math.floor(sorted.length * 0.75)],
  };
}

function getDistribution(durations) {
  const buckets = {
    '0~7일 (1주 이내)': 0,
    '8~14일 (2주 이내)': 0,
    '15~30일 (1개월 이내)': 0,
    '31~60일 (2개월 이내)': 0,
    '61~90일 (3개월 이내)': 0,
    '91일 이상': 0,
  };
  durations.forEach(d => {
    if (d <= 7) buckets['0~7일 (1주 이내)']++;
    else if (d <= 14) buckets['8~14일 (2주 이내)']++;
    else if (d <= 30) buckets['15~30일 (1개월 이내)']++;
    else if (d <= 60) buckets['31~60일 (2개월 이내)']++;
    else if (d <= 90) buckets['61~90일 (3개월 이내)']++;
    else buckets['91일 이상']++;
  });
  return buckets;
}

// ============================================
// 메인 실행
// ============================================
async function main() {
  const { accessToken, instanceUrl } = await getSalesforceToken();
  console.log('✅ Salesforce 연결 성공\n');

  // 인바운드세일즈 + 채널세일즈팀의 신규 영업기회 전체 조회 (CW + CL + Open)
  // 최근 6개월 기준
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const startDate = sixMonthsAgo.toISOString().split('T')[0] + 'T00:00:00Z';

  const query = `
    SELECT
      Id, Name, StageName, Amount, CloseDate,
      CreatedDate, LastStageChangeDate,
      Owner.Name, Owner_Department__c,
      RecordType.Name,
      Account.Name, LeadSource,
      fm_CompanyStatus__c,
      IsClosed, IsWon
    FROM Opportunity
    WHERE RecordType.Name = '1. 테이블오더 (신규)'
      AND Owner_Department__c IN ('인바운드세일즈', '채널세일즈팀')
      AND CreatedDate >= ${startDate}
    ORDER BY CreatedDate DESC
  `.replace(/\s+/g, ' ').trim();

  const allRecords = await soqlQueryAll(instanceUrl, accessToken, query);
  console.log(`📊 조회된 전체 신규 영업기회: ${allRecords.length}건\n`);

  // 전체 분류
  const all = [];
  allRecords.forEach(opp => {
    const dept = opp.Owner_Department__c;
    const actualCloseDate = opp.LastStageChangeDate || opp.CloseDate;
    const days = opp.IsClosed ? calcDays(opp.CreatedDate, actualCloseDate) : null;
    const companyStatus = opp.fm_CompanyStatus__c || '';
    const storeType = companyStatus === '오픈전' ? '오픈전' : '운영중';
    const status = opp.IsWon ? 'CW' : (opp.IsClosed ? 'CL' : 'Open');
    all.push({
      name: opp.Name,
      owner: opp.Owner?.Name,
      dept,
      createdDate: opp.CreatedDate?.substring(0, 10),
      closeDate: opp.CloseDate,
      days,
      amount: opp.Amount,
      leadSource: opp.LeadSource,
      account: opp.Account?.Name,
      storeType,
      status,
    });
  });

  // CW만 필터 (기존 기간 분석용)
  const inbound = all.filter(o => o.dept === '인바운드세일즈' && o.status === 'CW');
  const channel = all.filter(o => o.dept === '채널세일즈팀' && o.status === 'CW');

  // ============================================
  // 결과 출력
  // ============================================
  console.log('═'.repeat(70));
  console.log('  신규 계약 영업기회 기간 분석 (Closed Won, 테이블오더 신규)');
  console.log('  조회기간: 최근 6개월');
  console.log('  기간 산정: CreatedDate → LastStageChangeDate (실제 CW일)');
  console.log('═'.repeat(70));

  // --- 인바운드세일즈 ---
  const inboundDurations = inbound.map(o => o.days);
  const inboundStats = getStats(inboundDurations);
  console.log('\n┌──────────────────────────────────────────┐');
  console.log('│  📞 인바운드세일즈                        │');
  console.log('└──────────────────────────────────────────┘');
  if (inboundStats) {
    console.log(`  총 건수: ${inboundStats.count}건`);
    console.log(`  평균 기간: ${inboundStats.avg}일`);
    console.log(`  중앙값: ${inboundStats.median}일`);
    console.log(`  최소: ${inboundStats.min}일 / 최대: ${inboundStats.max}일`);
    console.log(`  25%ile: ${inboundStats.p25}일 / 75%ile: ${inboundStats.p75}일`);

    console.log('\n  [기간 분포]');
    const inboundDist = getDistribution(inboundDurations);
    Object.entries(inboundDist).forEach(([range, count]) => {
      const pct = ((count / inboundStats.count) * 100).toFixed(1);
      const bar = '█'.repeat(Math.round(count / inboundStats.count * 30));
      console.log(`  ${range.padEnd(22)} ${String(count).padStart(4)}건 (${pct.padStart(5)}%) ${bar}`);
    });
  } else {
    console.log('  데이터 없음');
  }

  // --- 채널세일즈팀 ---
  const channelDurations = channel.map(o => o.days);
  const channelStats = getStats(channelDurations);
  console.log('\n┌──────────────────────────────────────────┐');
  console.log('│  🤝 채널세일즈팀                          │');
  console.log('└──────────────────────────────────────────┘');
  if (channelStats) {
    console.log(`  총 건수: ${channelStats.count}건`);
    console.log(`  평균 기간: ${channelStats.avg}일`);
    console.log(`  중앙값: ${channelStats.median}일`);
    console.log(`  최소: ${channelStats.min}일 / 최대: ${channelStats.max}일`);
    console.log(`  25%ile: ${channelStats.p25}일 / 75%ile: ${channelStats.p75}일`);

    console.log('\n  [기간 분포]');
    const channelDist = getDistribution(channelDurations);
    Object.entries(channelDist).forEach(([range, count]) => {
      const pct = ((count / channelStats.count) * 100).toFixed(1);
      const bar = '█'.repeat(Math.round(count / channelStats.count * 30));
      console.log(`  ${range.padEnd(22)} ${String(count).padStart(4)}건 (${pct.padStart(5)}%) ${bar}`);
    });
  } else {
    console.log('  데이터 없음');
  }

  // --- 운영중 / 오픈전 구분 분석 ---
  function printStoreTypeAnalysis(label, items) {
    const operating = items.filter(o => o.storeType === '운영중');
    const preOpen = items.filter(o => o.storeType === '오픈전');
    const opStats = getStats(operating.map(o => o.days));
    const preStats = getStats(preOpen.map(o => o.days));

    console.log(`\n  [${label}]`);
    console.log(`  ${'구분'.padEnd(20)} ${'운영중 매장'.padStart(14)} ${'오픈전 매장'.padStart(14)}`);
    console.log('  ' + '─'.repeat(50));
    if (opStats && preStats) {
      console.log(`  ${'건수'.padEnd(20)} ${String(opStats.count + '건').padStart(14)} ${String(preStats.count + '건').padStart(14)}`);
      console.log(`  ${'평균 기간'.padEnd(18)} ${String(opStats.avg + '일').padStart(14)} ${String(preStats.avg + '일').padStart(14)}`);
      console.log(`  ${'중앙값'.padEnd(20)} ${String(opStats.median + '일').padStart(14)} ${String(preStats.median + '일').padStart(14)}`);
      console.log(`  ${'최소'.padEnd(20)} ${String(opStats.min + '일').padStart(14)} ${String(preStats.min + '일').padStart(14)}`);
      console.log(`  ${'최대'.padEnd(20)} ${String(opStats.max + '일').padStart(14)} ${String(preStats.max + '일').padStart(14)}`);
    } else {
      if (opStats) {
        console.log(`  운영중: ${opStats.count}건, 평균 ${opStats.avg}일, 중앙값 ${opStats.median}일`);
      }
      if (preStats) {
        console.log(`  오픈전: ${preStats.count}건, 평균 ${preStats.avg}일, 중앙값 ${preStats.median}일`);
      }
      if (!opStats && !preStats) console.log('  데이터 없음');
    }

    // 기간 분포 비교
    if (opStats && preStats) {
      console.log(`\n  [${label} - 기간 분포 비교]`);
      const opDist = getDistribution(operating.map(o => o.days));
      const preDist = getDistribution(preOpen.map(o => o.days));
      console.log(`  ${'기간'.padEnd(22)} ${'운영중'.padStart(12)} ${'비율'.padStart(8)} ${'오픈전'.padStart(10)} ${'비율'.padStart(8)}`);
      console.log('  ' + '─'.repeat(62));
      Object.keys(opDist).forEach(range => {
        const opCnt = opDist[range];
        const preCnt = preDist[range];
        const opPct = ((opCnt / opStats.count) * 100).toFixed(1);
        const prePct = ((preCnt / preStats.count) * 100).toFixed(1);
        console.log(`  ${range.padEnd(22)} ${String(opCnt + '건').padStart(12)} ${(opPct + '%').padStart(8)} ${String(preCnt + '건').padStart(10)} ${(prePct + '%').padStart(8)}`);
      });
    }
  }

  console.log('\n═'.repeat(70));
  console.log('  운영중 매장 vs 오픈전 매장 구분 분석');
  console.log('═'.repeat(70));
  printStoreTypeAnalysis('📞 인바운드세일즈', inbound);
  printStoreTypeAnalysis('🤝 채널세일즈팀', channel);
  printStoreTypeAnalysis('📊 전체 (인바운드+채널)', [...inbound, ...channel]);

  // --- 비교 요약 ---
  console.log('\n═'.repeat(70));
  console.log('  팀 비교 요약 (전체)');
  console.log('═'.repeat(70));
  console.log(`  ${'항목'.padEnd(20)} ${'인바운드세일즈'.padStart(14)} ${'채널세일즈팀'.padStart(14)}`);
  console.log('  ' + '─'.repeat(50));
  if (inboundStats && channelStats) {
    console.log(`  ${'건수'.padEnd(20)} ${String(inboundStats.count + '건').padStart(14)} ${String(channelStats.count + '건').padStart(14)}`);
    console.log(`  ${'평균 기간'.padEnd(18)} ${String(inboundStats.avg + '일').padStart(14)} ${String(channelStats.avg + '일').padStart(14)}`);
    console.log(`  ${'중앙값'.padEnd(20)} ${String(inboundStats.median + '일').padStart(14)} ${String(channelStats.median + '일').padStart(14)}`);
    console.log(`  ${'최소'.padEnd(20)} ${String(inboundStats.min + '일').padStart(14)} ${String(channelStats.min + '일').padStart(14)}`);
    console.log(`  ${'최대'.padEnd(20)} ${String(inboundStats.max + '일').padStart(14)} ${String(channelStats.max + '일').padStart(14)}`);
  }

  // --- 월별 평균 기간 ---
  console.log('\n═'.repeat(70));
  console.log('  월별 평균 영업 기간 (일)');
  console.log('═'.repeat(70));

  const allItems = [...inbound.map(o => ({ ...o, team: '인바운드' })), ...channel.map(o => ({ ...o, team: '채널' }))];
  const byMonth = {};
  allItems.forEach(o => {
    const month = o.closeDate?.substring(0, 7);
    if (!month) return;
    if (!byMonth[month]) byMonth[month] = { inbound: [], channel: [] };
    if (o.team === '인바운드') byMonth[month].inbound.push(o.days);
    else byMonth[month].channel.push(o.days);
  });

  console.log(`  ${'월'.padEnd(12)} ${'인바운드(건수)'.padStart(16)} ${'인바운드(평균)'.padStart(14)} ${'채널(건수)'.padStart(12)} ${'채널(평균)'.padStart(12)}`);
  console.log('  ' + '─'.repeat(68));
  Object.keys(byMonth).sort().forEach(month => {
    const m = byMonth[month];
    const inAvg = m.inbound.length > 0 ? (m.inbound.reduce((a, b) => a + b, 0) / m.inbound.length).toFixed(1) : '-';
    const chAvg = m.channel.length > 0 ? (m.channel.reduce((a, b) => a + b, 0) / m.channel.length).toFixed(1) : '-';
    console.log(
      `  ${month.padEnd(12)} ${String(m.inbound.length + '건').padStart(16)} ${String(inAvg + '일').padStart(14)} ${String(m.channel.length + '건').padStart(12)} ${String(chAvg + '일').padStart(12)}`
    );
  });

  // --- 담당자별 평균 기간 ---
  console.log('\n═'.repeat(70));
  console.log('  담당자별 평균 영업 기간 (Closed Won 5건 이상)');
  console.log('═'.repeat(70));

  const byOwner = {};
  allItems.forEach(o => {
    const key = `${o.owner} (${o.team})`;
    if (!byOwner[key]) byOwner[key] = [];
    byOwner[key].push(o.days);
  });

  console.log(`  ${'담당자'.padEnd(25)} ${'건수'.padStart(6)} ${'평균'.padStart(8)} ${'중앙값'.padStart(8)} ${'최소'.padStart(6)} ${'최대'.padStart(6)}`);
  console.log('  ' + '─'.repeat(62));
  Object.entries(byOwner)
    .filter(([, arr]) => arr.length >= 5)
    .sort((a, b) => {
      const avgA = a[1].reduce((s, v) => s + v, 0) / a[1].length;
      const avgB = b[1].reduce((s, v) => s + v, 0) / b[1].length;
      return avgA - avgB;
    })
    .forEach(([owner, durations]) => {
      const stats = getStats(durations);
      console.log(
        `  ${owner.padEnd(25)} ${String(stats.count).padStart(6)} ${String(stats.avg + '일').padStart(8)} ${String(stats.median + '일').padStart(8)} ${String(stats.min + '일').padStart(6)} ${String(stats.max + '일').padStart(6)}`
      );
    });

  // ============================================
  // CL율 분석
  // ============================================
  console.log('\n═'.repeat(70));
  console.log('  Closed Lost 분석 (CW/CL/Open 비율 + CL 기간 분포)');
  console.log('═'.repeat(70));

  function printCLAnalysis(label, items) {
    const cw = items.filter(o => o.status === 'CW');
    const cl = items.filter(o => o.status === 'CL');
    const open = items.filter(o => o.status === 'Open');
    const closed = cw.length + cl.length;
    const clRate = closed > 0 ? ((cl.length / closed) * 100).toFixed(1) : '-';
    const cwRate = closed > 0 ? ((cw.length / closed) * 100).toFixed(1) : '-';

    console.log(`\n  [${label}]`);
    console.log(`  전체: ${items.length}건 | CW: ${cw.length}건 | CL: ${cl.length}건 | Open: ${open.length}건`);
    console.log(`  CW율: ${cwRate}% | CL율: ${clRate}% (Closed 기준, Open 제외)`);

    // CL 기간 분포
    const clDurations = cl.map(o => o.days).filter(d => d !== null);
    const clStats = getStats(clDurations);
    if (clStats) {
      console.log(`  CL 평균 기간: ${clStats.avg}일 | 중앙값: ${clStats.median}일`);
      console.log(`\n  [${label} - CL 기간 분포]`);
      const clDist = getDistribution(clDurations);
      Object.entries(clDist).forEach(([range, count]) => {
        const pct = ((count / clStats.count) * 100).toFixed(1);
        const bar = '█'.repeat(Math.round(count / clStats.count * 30));
        console.log(`  ${range.padEnd(22)} ${String(count).padStart(4)}건 (${pct.padStart(5)}%) ${bar}`);
      });
    }
  }

  // 팀별 CL 분석
  const inboundAll = all.filter(o => o.dept === '인바운드세일즈');
  const channelAll = all.filter(o => o.dept === '채널세일즈팀');
  printCLAnalysis('📞 인바운드세일즈 (전체)', inboundAll);
  printCLAnalysis('🤝 채널세일즈팀 (전체)', channelAll);

  // 팀 x 매장상태별 CL 분석
  console.log('\n═'.repeat(70));
  console.log('  팀 x 매장상태별 CW/CL 비율');
  console.log('═'.repeat(70));

  const segments = [
    { label: '인바운드 + 운영중', items: inboundAll.filter(o => o.storeType === '운영중') },
    { label: '인바운드 + 오픈전', items: inboundAll.filter(o => o.storeType === '오픈전') },
    { label: '채널 + 운영중', items: channelAll.filter(o => o.storeType === '운영중') },
    { label: '채널 + 오픈전', items: channelAll.filter(o => o.storeType === '오픈전') },
  ];

  console.log(`  ${'구분'.padEnd(22)} ${'전체'.padStart(6)} ${'CW'.padStart(6)} ${'CL'.padStart(6)} ${'Open'.padStart(6)} ${'CW율'.padStart(8)} ${'CL율'.padStart(8)} ${'CL평균'.padStart(8)} ${'CL중앙'.padStart(8)}`);
  console.log('  ' + '─'.repeat(82));
  segments.forEach(({ label, items }) => {
    const cw = items.filter(o => o.status === 'CW').length;
    const cl = items.filter(o => o.status === 'CL').length;
    const open = items.filter(o => o.status === 'Open').length;
    const closed = cw + cl;
    const cwRate = closed > 0 ? ((cw / closed) * 100).toFixed(1) + '%' : '-';
    const clRate = closed > 0 ? ((cl / closed) * 100).toFixed(1) + '%' : '-';
    const clDurations = items.filter(o => o.status === 'CL' && o.days !== null).map(o => o.days);
    const clStats = getStats(clDurations);
    const clAvg = clStats ? clStats.avg + '일' : '-';
    const clMed = clStats ? clStats.median + '일' : '-';
    console.log(`  ${label.padEnd(22)} ${String(items.length).padStart(6)} ${String(cw).padStart(6)} ${String(cl).padStart(6)} ${String(open).padStart(6)} ${cwRate.padStart(8)} ${clRate.padStart(8)} ${clAvg.padStart(8)} ${clMed.padStart(8)}`);
  });

  // CL 기간 분포 비교 (운영중 vs 오픈전)
  console.log('\n═'.repeat(70));
  console.log('  CL 기간 분포 비교 (운영중 vs 오픈전, 팀 통합)');
  console.log('═'.repeat(70));

  const clOperating = all.filter(o => o.status === 'CL' && o.storeType === '운영중' && o.days !== null);
  const clPreOpen = all.filter(o => o.status === 'CL' && o.storeType === '오픈전' && o.days !== null);
  const clOpStats = getStats(clOperating.map(o => o.days));
  const clPreStats = getStats(clPreOpen.map(o => o.days));

  if (clOpStats && clPreStats) {
    console.log(`  ${'구분'.padEnd(20)} ${'운영중'.padStart(14)} ${'오픈전'.padStart(14)}`);
    console.log('  ' + '─'.repeat(50));
    console.log(`  ${'건수'.padEnd(20)} ${String(clOpStats.count + '건').padStart(14)} ${String(clPreStats.count + '건').padStart(14)}`);
    console.log(`  ${'평균 기간'.padEnd(18)} ${String(clOpStats.avg + '일').padStart(14)} ${String(clPreStats.avg + '일').padStart(14)}`);
    console.log(`  ${'중앙값'.padEnd(20)} ${String(clOpStats.median + '일').padStart(14)} ${String(clPreStats.median + '일').padStart(14)}`);

    const opDist = getDistribution(clOperating.map(o => o.days));
    const preDist = getDistribution(clPreOpen.map(o => o.days));
    console.log(`\n  ${'기간'.padEnd(22)} ${'운영중'.padStart(12)} ${'비율'.padStart(8)} ${'오픈전'.padStart(10)} ${'비율'.padStart(8)}`);
    console.log('  ' + '─'.repeat(62));
    Object.keys(opDist).forEach(range => {
      const opCnt = opDist[range];
      const preCnt = preDist[range];
      const opPct = ((opCnt / clOpStats.count) * 100).toFixed(1);
      const prePct = ((preCnt / clPreStats.count) * 100).toFixed(1);
      console.log(`  ${range.padEnd(22)} ${String(opCnt + '건').padStart(12)} ${(opPct + '%').padStart(8)} ${String(preCnt + '건').padStart(10)} ${(prePct + '%').padStart(8)}`);
    });
  }

  console.log('\n✅ 분석 완료');
}

main().catch(err => {
  console.error('오류:', err.message);
  if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
});
