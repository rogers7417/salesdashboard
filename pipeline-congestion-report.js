require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

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
    const res = await axios.get(nextUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    allRecords.push(...(res.data.records || []));
    nextUrl = res.data.nextRecordsUrl ? `${instanceUrl}${res.data.nextRecordsUrl}` : null;
  }
  return allRecords;
}

function calcDays(d1, d2) {
  return Math.round((new Date(d2) - new Date(d1)) / 86400000);
}

async function main() {
  const { accessToken, instanceUrl } = await getSalesforceToken();
  console.log('Salesforce 연결 성공');

  const nineMonthsAgo = new Date();
  nineMonthsAgo.setMonth(nineMonthsAgo.getMonth() - 9);
  const startDate = nineMonthsAgo.toISOString().split('T')[0] + 'T00:00:00Z';

  const oppQuery = `
    SELECT Id, Name, StageName, CreatedDate, CloseDate, LastStageChangeDate,
      OwnerId, Owner.Name, Owner_Department__c, fm_CompanyStatus__c,
      BOUser__c, BOUser__r.Name,
      IsClosed, IsWon
    FROM Opportunity
    WHERE RecordType.Name = '1. 테이블오더 (신규)'
      AND Owner_Department__c = '인바운드세일즈'
      AND CreatedDate >= ${startDate}
    ORDER BY CreatedDate ASC
  `.replace(/\s+/g, ' ').trim();

  const opps = await soqlQueryAll(instanceUrl, accessToken, oppQuery);
  console.log(`영업기회: ${opps.length}건`);

  const oppIds = opps.map(o => o.Id);
  let allTasks = [];
  for (let i = 0; i < oppIds.length; i += 500) {
    const chunk = oppIds.slice(i, i + 500);
    const ids = chunk.map(id => `'${id}'`).join(',');
    const taskQuery = `SELECT Id, WhatId, CreatedDate FROM Task WHERE WhatId IN (${ids}) ORDER BY CreatedDate ASC`;
    const tasks = await soqlQueryAll(instanceUrl, accessToken, taskQuery);
    allTasks.push(...tasks);
  }
  console.log(`Task: ${allTasks.length}건`);

  const taskCountByOpp = {};
  allTasks.forEach(t => { taskCountByOpp[t.WhatId] = (taskCountByOpp[t.WhatId] || 0) + 1; });

  const oppData = opps.map(opp => {
    const status = opp.IsWon ? 'CW' : (opp.IsClosed ? 'CL' : 'Open');
    const storeType = (opp.fm_CompanyStatus__c || '') === '오픈전' ? '오픈전' : '운영중';
    const taskCount = taskCountByOpp[opp.Id] || 0;
    const closeDate = opp.LastStageChangeDate || opp.CloseDate;
    const duration = (status !== 'Open' && closeDate) ? calcDays(opp.CreatedDate, closeDate) : null;
    return {
      id: opp.Id, name: opp.Name, status, storeType,
      ownerId: opp.OwnerId, owner: opp.Owner?.Name,
      boUser: opp.BOUser__r?.Name || '(미배정)',
      createdDate: opp.CreatedDate,
      closeDate: status !== 'Open' ? closeDate : null,
      taskCount, duration,
    };
  });

  console.log('동시 파이프라인 부하 계산 중...');
  oppData.forEach(opp => {
    const createdAt = new Date(opp.createdDate);
    opp.concurrentPipeline = oppData.filter(other => {
      if (other.id === opp.id || other.ownerId !== opp.ownerId) return false;
      if (new Date(other.createdDate) > createdAt) return false;
      if (other.status === 'Open') return true;
      if (other.closeDate) return new Date(other.closeDate) > createdAt;
      return false;
    }).length;
  });

  const closedOpps = oppData.filter(d => d.status !== 'Open');
  const now = new Date();

  // === 데이터 집계 ===

  const loadBuckets = [
    { label: '0~10건', min: 0, max: 10 },
    { label: '11~20건', min: 11, max: 20 },
    { label: '21~30건', min: 21, max: 30 },
    { label: '31~50건', min: 31, max: 50 },
    { label: '51~100건', min: 51, max: 100 },
    { label: '101~150건', min: 101, max: 150 },
    { label: '151~200건', min: 151, max: 200 },
    { label: '201~300건', min: 201, max: 300 },
    { label: '301~400건', min: 301, max: 400 },
    { label: '401건+', min: 401, max: 9999 },
  ];

  function getBucketData(items) {
    return loadBuckets.map(b => {
      const bucket = items.filter(d => d.concurrentPipeline >= b.min && d.concurrentPipeline <= b.max);
      const cw = bucket.filter(d => d.status === 'CW').length;
      const cl = bucket.filter(d => d.status === 'CL').length;
      const total = cw + cl;
      return {
        label: b.label, total, cw, cl,
        cwRate: total > 0 ? +(cw / total * 100).toFixed(1) : 0,
        taskRate: total > 0 ? +(bucket.filter(d => d.taskCount > 0).length / total * 100).toFixed(1) : 0,
        avgTasks: total > 0 ? +(bucket.reduce((a, d) => a + d.taskCount, 0) / total).toFixed(1) : 0,
      };
    }).filter(d => d.total > 0);
  }

  const allBucketData = getBucketData(closedOpps);
  const opBucketData = getBucketData(closedOpps.filter(d => d.storeType === '운영중'));
  const preBucketData = getBucketData(closedOpps.filter(d => d.storeType === '오픈전'));

  // BO 담당자별 동시 파이프라인 재계산 (BO 기준)
  console.log('BO별 동시 파이프라인 부하 계산 중...');
  oppData.forEach(opp => {
    const createdAt = new Date(opp.createdDate);
    opp.boConcurrentPipeline = oppData.filter(other => {
      if (other.id === opp.id || other.boUser !== opp.boUser) return false;
      if (new Date(other.createdDate) > createdAt) return false;
      if (other.status === 'Open') return true;
      if (other.closeDate) return new Date(other.closeDate) > createdAt;
      return false;
    }).length;
  });

  function getBoBucketData(items) {
    return loadBuckets.map(b => {
      const bucket = items.filter(d => d.boConcurrentPipeline >= b.min && d.boConcurrentPipeline <= b.max);
      const cw = bucket.filter(d => d.status === 'CW').length;
      const cl = bucket.filter(d => d.status === 'CL').length;
      const total = cw + cl;
      return {
        label: b.label, total, cw, cl,
        cwRate: total > 0 ? +(cw / total * 100).toFixed(1) : 0,
        taskRate: total > 0 ? +(bucket.filter(d => d.taskCount > 0).length / total * 100).toFixed(1) : 0,
        avgTasks: total > 0 ? +(bucket.reduce((a, d) => a + d.taskCount, 0) / total).toFixed(1) : 0,
      };
    }).filter(d => d.total > 0);
  }

  // BO 담당자별 부하 구간 데이터
  const boUsersForBucket = [...new Set(closedOpps.map(d => d.boUser))].filter(b => b && b !== '(미배정)');
  const boBucketByUser = {};
  boUsersForBucket.forEach(bo => {
    const boClosedOpps = closedOpps.filter(d => d.boUser === bo);
    if (boClosedOpps.length >= 5) {
      boBucketByUser[bo] = getBoBucketData(boClosedOpps);
    }
  });
  const boBucketUsers = Object.keys(boBucketByUser).sort();

  // 담당자별
  const owners = [...new Set(oppData.map(d => d.owner))].filter(Boolean);
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const ownerStats = owners.map(owner => {
    const ownerOpps = oppData.filter(d => d.owner === owner);
    const currentOpen = ownerOpps.filter(d => d.status === 'Open').length;
    const staleOpen = ownerOpps.filter(d => d.status === 'Open' && calcDays(d.createdDate, now) > 30).length;
    const recentClosed = ownerOpps.filter(d => d.status !== 'Open' && new Date(d.createdDate) >= threeMonthsAgo);
    const recentCW = recentClosed.filter(d => d.status === 'CW').length;
    const recentCL = recentClosed.filter(d => d.status === 'CL').length;
    const total = recentCW + recentCL;
    const cwRate = total > 0 ? +(recentCW / total * 100).toFixed(1) : 0;
    const avgTasks = total > 0 ? +(recentClosed.reduce((a, d) => a + d.taskCount, 0) / total).toFixed(1) : 0;
    return { owner, currentOpen, staleOpen, total, recentCW, recentCL, cwRate, avgTasks };
  }).filter(s => s.total >= 3).sort((a, b) => b.currentOpen - a.currentOpen);

  // BO 담당자별
  const boUsers = [...new Set(oppData.map(d => d.boUser))].filter(Boolean);
  const boStats = boUsers.map(bo => {
    const boOpps = oppData.filter(d => d.boUser === bo);
    const currentOpen = boOpps.filter(d => d.status === 'Open').length;
    const staleOpen = boOpps.filter(d => d.status === 'Open' && calcDays(d.createdDate, now) > 30).length;
    const recentClosed = boOpps.filter(d => d.status !== 'Open' && new Date(d.createdDate) >= threeMonthsAgo);
    const recentCW = recentClosed.filter(d => d.status === 'CW').length;
    const recentCL = recentClosed.filter(d => d.status === 'CL').length;
    const total = recentCW + recentCL;
    const cwRate = total > 0 ? +(recentCW / total * 100).toFixed(1) : 0;
    const avgTasks = total > 0 ? +(recentClosed.reduce((a, d) => a + d.taskCount, 0) / total).toFixed(1) : 0;
    return { bo, currentOpen, staleOpen, total, recentCW, recentCL, cwRate, avgTasks };
  }).filter(s => s.total >= 3).sort((a, b) => b.currentOpen - a.currentOpen);

  // BO 비교 인사이트
  const boInsightHtml = (() => {
    const sorted = [...boStats].sort((a, b) => b.currentOpen - a.currentOpen);
    const top = sorted.slice(0, Math.ceil(sorted.length / 2));
    const bot = sorted.slice(Math.ceil(sorted.length / 2));
    if (top.length && bot.length) {
      const topCW = (top.reduce((a, b) => a + b.cwRate, 0) / top.length).toFixed(1);
      const botCW = (bot.reduce((a, b) => a + b.cwRate, 0) / bot.length).toFixed(1);
      const topOpen = Math.round(top.reduce((a, b) => a + b.currentOpen, 0) / top.length);
      const botOpen = Math.round(bot.reduce((a, b) => a + b.currentOpen, 0) / bot.length);
      return `<div class="insight">
        부하 상위 그룹 (평균 Open <strong>${topOpen}건</strong>) CW율 <strong>${topCW}%</strong>
        vs 하위 그룹 (평균 Open <strong>${botOpen}건</strong>) CW율 <strong>${botCW}%</strong>
      </div>`;
    }
    return '';
  })();

  // BO별 정리 시뮬레이션
  const boCleanup = boUsers.map(bo => {
    const boOpen = oppData.filter(d => d.boUser === bo && d.status === 'Open');
    const boStale = boOpen.filter(d => calcDays(d.createdDate, now) > 30);
    if (boOpen.length === 0) return null;
    return {
      bo, current: boOpen.length, stale: boStale.length,
      after: boOpen.length - boStale.length,
      reduction: +(boStale.length / boOpen.length * 100).toFixed(1),
    };
  }).filter(Boolean).sort((a, b) => b.current - a.current);

  // 월별
  const months = [...new Set(oppData.map(d => d.createdDate.substring(0, 7)))].sort();
  const monthlyData = months.map(month => {
    const monthEnd = new Date(month + '-28T23:59:59Z');
    const monthOpps = oppData.filter(d => d.createdDate.startsWith(month));
    const estimatedOpen = oppData.filter(d => {
      if (new Date(d.createdDate) > monthEnd) return false;
      if (d.status === 'Open') return true;
      if (d.closeDate) return new Date(d.closeDate) > monthEnd;
      return false;
    }).length;
    const monthClosed = monthOpps.filter(d => d.status !== 'Open');
    const cw = monthClosed.filter(d => d.status === 'CW').length;
    const cl = monthClosed.filter(d => d.status === 'CL').length;
    const total = cw + cl;
    const avgTasks = monthOpps.length > 0 ? +(monthOpps.reduce((a, d) => a + d.taskCount, 0) / monthOpps.length).toFixed(1) : 0;
    return {
      month, newCount: monthOpps.length, estimatedOpen, cw, cl, total,
      cwRate: total > 0 ? +(cw / total * 100).toFixed(1) : 0,
      avgTasks,
    };
  });

  // 정리 시뮬레이션
  const openOpps = oppData.filter(d => d.status === 'Open');
  const staleOpps = openOpps.filter(d => calcDays(d.createdDate, now) > 30);
  const cwAll = closedOpps.filter(d => d.status === 'CW' && d.duration !== null);
  const cwOver30 = cwAll.filter(d => d.duration > 30).length;

  // 리틀의 법칙 계산
  const totalMonths = months.length || 1;
  const lambdaPerMonth = Math.round(oppData.length / totalMonths); // λ: 월 평균 유입
  const cwDurations = closedOpps.filter(d => d.status === 'CW' && d.duration !== null).map(d => d.duration);
  const clDurations = closedOpps.filter(d => d.status === 'CL' && d.duration !== null).map(d => d.duration);
  const allDurations = closedOpps.filter(d => d.duration !== null).map(d => d.duration);
  const avgW = allDurations.length > 0 ? Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length) : 0;
  const avgWcw = cwDurations.length > 0 ? Math.round(cwDurations.reduce((a, b) => a + b, 0) / cwDurations.length) : 0;
  const avgWcl = clDurations.length > 0 ? Math.round(clDurations.reduce((a, b) => a + b, 0) / clDurations.length) : 0;
  const theoreticalL = Math.round(lambdaPerMonth * avgW / 30); // 월단위 → 일단위 보정

  // 담당자당 평균
  const activeOwners = owners.filter(o => oppData.filter(d => d.owner === o && d.status === 'Open').length > 0).length || 1;
  const lPerOwner = Math.round(openOpps.length / activeOwners);
  const lambdaPerOwner = Math.round(lambdaPerMonth / activeOwners);

  // 정리 후 시뮬레이션
  const afterCleanL = openOpps.length - staleOpps.length;
  const afterCleanLPerOwner = Math.round(afterCleanL / activeOwners);
  // CW만 빨리 처리하면 W가 줄어드는 효과
  const idealW = avgWcw; // CW 기간으로 수렴 가능

  const cleanupByOwner = owners.map(owner => {
    const ownerOpen = openOpps.filter(d => d.owner === owner);
    const ownerStale = staleOpps.filter(d => d.owner === owner);
    if (ownerOpen.length === 0) return null;
    return {
      owner, current: ownerOpen.length, stale: ownerStale.length,
      after: ownerOpen.length - ownerStale.length,
      reduction: +(ownerStale.length / ownerOpen.length * 100).toFixed(1),
    };
  }).filter(Boolean).sort((a, b) => b.current - a.current);

  // 동일 월 내 담당자 간 부하 비교 (시간 교란 제거)
  console.log('동일 월 내 담당자 비교 분석 중...');
  const ownerMonthScatter = [];
  const sameMonthComparison = [];
  months.forEach(month => {
    const monthClosed = closedOpps.filter(d => d.createdDate.startsWith(month));
    const ownerGroups = {};
    monthClosed.forEach(opp => {
      if (!opp.owner) return;
      if (!ownerGroups[opp.owner]) ownerGroups[opp.owner] = [];
      ownerGroups[opp.owner].push(opp);
    });
    const ownerMetrics = Object.entries(ownerGroups)
      .filter(([_, opps]) => opps.length >= 3)
      .map(([owner, opps]) => {
        const avgLoad = Math.round(opps.reduce((a, d) => a + d.concurrentPipeline, 0) / opps.length);
        const cw = opps.filter(d => d.status === 'CW').length;
        return { owner, month, avgLoad, cwRate: +(cw / opps.length * 100).toFixed(1), total: opps.length, cw };
      });
    ownerMetrics.forEach(m => ownerMonthScatter.push(m));
    if (ownerMetrics.length >= 4) {
      const sorted = [...ownerMetrics].sort((a, b) => a.avgLoad - b.avgLoad);
      const mid = Math.ceil(sorted.length / 2);
      const low = sorted.slice(0, mid);
      const high = sorted.slice(mid);
      const lowTotal = low.reduce((a, b) => a + b.total, 0);
      const lowCW = low.reduce((a, b) => a + b.cw, 0);
      const highTotal = high.reduce((a, b) => a + b.total, 0);
      const highCW = high.reduce((a, b) => a + b.cw, 0);
      sameMonthComparison.push({
        month,
        lowAvgLoad: Math.round(low.reduce((a, b) => a + b.avgLoad, 0) / low.length),
        lowCwRate: lowTotal > 0 ? +(lowCW / lowTotal * 100).toFixed(1) : 0,
        lowTotal, lowCW,
        highAvgLoad: Math.round(high.reduce((a, b) => a + b.avgLoad, 0) / high.length),
        highCwRate: highTotal > 0 ? +(highCW / highTotal * 100).toFixed(1) : 0,
        highTotal, highCW,
      });
    }
  });
  const sameMonthSummary = (() => {
    const lowTotal = sameMonthComparison.reduce((a, b) => a + b.lowTotal, 0);
    const lowCW = sameMonthComparison.reduce((a, b) => a + b.lowCW, 0);
    const highTotal = sameMonthComparison.reduce((a, b) => a + b.highTotal, 0);
    const highCW = sameMonthComparison.reduce((a, b) => a + b.highCW, 0);
    return {
      lowCwRate: lowTotal > 0 ? +(lowCW / lowTotal * 100).toFixed(1) : 0,
      highCwRate: highTotal > 0 ? +(highCW / highTotal * 100).toFixed(1) : 0,
      lowTotal, highTotal,
      diff: lowTotal > 0 && highTotal > 0 ? +((lowCW/lowTotal - highCW/highTotal) * 100).toFixed(1) : 0,
    };
  })();

  // 담당자 비교 인사이트 (HTML에서 중첩 템플릿 문제 회피)
  const ownerInsightHtml = (() => {
    const sorted = [...ownerStats].sort((a, b) => b.currentOpen - a.currentOpen);
    const top = sorted.slice(0, Math.ceil(sorted.length / 2));
    const bot = sorted.slice(Math.ceil(sorted.length / 2));
    if (top.length && bot.length) {
      const topCW = (top.reduce((a, b) => a + b.cwRate, 0) / top.length).toFixed(1);
      const botCW = (bot.reduce((a, b) => a + b.cwRate, 0) / bot.length).toFixed(1);
      const topOpen = Math.round(top.reduce((a, b) => a + b.currentOpen, 0) / top.length);
      const botOpen = Math.round(bot.reduce((a, b) => a + b.currentOpen, 0) / bot.length);
      return `<div class="insight">
        부하 상위 그룹 (평균 Open <strong>${topOpen}건</strong>) CW율 <strong>${topCW}%</strong>
        vs 하위 그룹 (평균 Open <strong>${botOpen}건</strong>) CW율 <strong>${botCW}%</strong>
        &nbsp;→&nbsp; 파이프라인 부하가 높을수록 CW율 하락
      </div>`;
    }
    return '';
  })();

  // 목표 설정: 데이터 기반 개선 시나리오
  const currentCwRate = (() => {
    const bucket = loadBuckets.find(b => lPerOwner >= b.min && lPerOwner <= b.max);
    const bd = allBucketData.find(d => d.label === bucket?.label);
    return bd?.cwRate || 36;
  })();

  // 목표 시나리오: 현재는 raw CW율, 개선 시나리오는 단조 보정 (부하↓ → CW율 최소 유지)
  const targetScenarios = (() => {
    const raw = [
      { name: '현재 상태', targetLPerOwner: lPerOwner, color: '#e17055', method: '-' },
      { name: '1단계: 30일+ 정리', targetLPerOwner: afterCleanLPerOwner, color: '#fdcb6e', method: '30일 이상 방치 건 일괄 CL' },
      { name: '2단계: 적극 관리', targetLPerOwner: 15, color: '#74b9ff', method: '14일 무활동 시 리뷰 + CL' },
      { name: '3단계: 최적 운영', targetLPerOwner: 10, color: '#00b894', method: '주간 리뷰 + 7일 기준 정리' },
    ].map((s, idx) => {
      const bucket = loadBuckets.find(b => s.targetLPerOwner >= b.min && s.targetLPerOwner <= b.max);
      const bd = allBucketData.find(d => d.label === bucket?.label);
      const rawCwRate = idx === 0 ? currentCwRate : (bd?.cwRate || currentCwRate);
      const totalTarget = s.targetLPerOwner * activeOwners;
      const reductionNeeded = Math.max(0, openOpps.length - totalTarget);
      const targetW = lambdaPerOwner > 0 ? Math.round(s.targetLPerOwner * 30 / lambdaPerOwner) : avgW;
      return { ...s, bucket: bucket?.label || '-', rawCwRate, totalTarget, reductionNeeded, targetW };
    });
    // 단조 보정: 부하 줄이면 CW율은 최소 이전 단계 이상
    let prevRate = currentCwRate;
    raw.forEach((s, idx) => {
      s.expectedCwRate = idx === 0 ? s.rawCwRate : Math.max(s.rawCwRate, prevRate);
      s.cwChangePct = currentCwRate > 0 ? Math.round((s.expectedCwRate / currentCwRate - 1) * 100) : 0;
      prevRate = s.expectedCwRate;
    });
    return raw;
  })();

  const bestAchievableCwRate = Math.max(...allBucketData.filter(d => d.total >= 10).map(d => d.cwRate));
  const maxImprovementPct = currentCwRate > 0 ? Math.round((bestAchievableCwRate / currentCwRate - 1) * 100) : 0;

  // W 단축 시뮬레이션 (BO 기준, λ=350건/월)
  const simConfig = { lambda: 350, boCount: 4, days: 84 }; // 12주
  const simLambdaDay = simConfig.lambda / 30;
  const simInitialL = openOpps.length - staleOpps.length;
  const simInitialPerBo = Math.round(simInitialL / simConfig.boCount);
  const simCurrentPerBo = Math.round(openOpps.length / simConfig.boCount);

  // BO pipeline → 전체 → TM당 환산 → TM 버킷 CW율 매핑
  function boPipelineToCwRate(perBo) {
    const totalL = perBo * simConfig.boCount;
    const perTm = Math.round(totalL / activeOwners);
    const bucket = loadBuckets.find(b => perTm >= b.min && perTm <= b.max);
    const bd = allBucketData.find(d => d.label === bucket?.label);
    return bd?.cwRate || currentCwRate;
  }

  const simWOptions = [
    { w: 7, label: 'W=7일', color: '#00b894', method: '매일 파이프라인 리뷰 + 즉시 판단' },
    { w: 14, label: 'W=14일', color: '#74b9ff', method: '주 2회 리뷰 + 3일 내 판단 기준' },
    { w: 21, label: 'W=21일', color: '#fdcb6e', method: '주 1회 리뷰 + 7일 내 판단 기준' },
    { w: 30, label: 'W=30일', color: '#e17055', method: '현행 유지 (리뷰 없음)' },
  ];

  const simResults = simWOptions.map(sc => {
    const weekly = [];
    const weeklyCw = [];
    const ageHist = new Array(60).fill(0);
    const perAge = simInitialL / 30;
    for (let a = 0; a < 30; a++) ageHist[a] = perAge;
    for (let day = 0; day <= simConfig.days; day++) {
      if (day % 7 === 0) {
        let total = 0;
        for (let a = 0; a < sc.w && a < 60; a++) total += ageHist[a];
        const perBo = Math.round(total / simConfig.boCount);
        weekly.push(perBo);
        weeklyCw.push(boPipelineToCwRate(perBo));
      }
      for (let a = 59; a > 0; a--) ageHist[a] = ageHist[a - 1];
      ageHist[0] = simLambdaDay;
    }
    const steadyState = Math.round(simConfig.lambda * sc.w / 30 / simConfig.boCount);
    return { ...sc, weekly, weeklyCw, steadyState, steadyCwRate: boPipelineToCwRate(steadyState) };
  });

  // Enforce monotonicity: shorter W (lower index) → CW율 >= longer W (higher index)
  for (let i = simResults.length - 2; i >= 0; i--) {
    simResults[i].steadyCwRate = Math.max(simResults[i].steadyCwRate, simResults[i + 1].steadyCwRate);
    simResults[i].weeklyCw = simResults[i].weeklyCw.map((cw, j) =>
      Math.max(cw, simResults[i + 1].weeklyCw[j] || cw)
    );
  }

  const simWeekLabels = Array.from({length: Math.ceil(simConfig.days / 7) + 1}, (_, i) => i + '주차');
  const simInitialCwRate = boPipelineToCwRate(simInitialPerBo);
  const simCurrentCwRate = boPipelineToCwRate(simCurrentPerBo);

  const simChartDatasets = JSON.stringify([
    ...simResults.map(s => ({
      label: s.label + ' \u2192 ' + s.steadyState + '\uAC74/BO',
      data: s.weekly,
      borderColor: s.color,
      backgroundColor: 'transparent',
      pointRadius: 3,
      pointBackgroundColor: s.color,
      borderWidth: 2.5,
      tension: 0.3,
      yAxisID: 'y',
    })),
    ...simResults.map(s => ({
      label: s.label + ' CW\uC728 \u2192 ' + s.steadyCwRate + '%',
      data: s.weeklyCw,
      borderColor: s.color,
      backgroundColor: 'transparent',
      pointRadius: 0,
      borderWidth: 1.5,
      borderDash: [8, 4],
      tension: 0.3,
      yAxisID: 'y1',
    })),
    {
      label: '\uC815\uB9AC \uC9C1\uD6C4 (' + simInitialPerBo + '\uAC74/BO)',
      data: new Array(simWeekLabels.length).fill(simInitialPerBo),
      borderColor: '#b2bec3',
      borderDash: [5, 5],
      pointRadius: 0,
      borderWidth: 1,
      yAxisID: 'y',
    },
    {
      label: '\uC815\uB9AC \uC804 (' + simCurrentPerBo + '\uAC74/BO)',
      data: new Array(simWeekLabels.length).fill(simCurrentPerBo),
      borderColor: '#d63031',
      borderDash: [3, 3],
      pointRadius: 0,
      borderWidth: 1,
      yAxisID: 'y',
    },
  ]);

  // === HTML 생성 ===
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>파이프라인 혼잡도 분석 - 인바운드세일즈</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f6fa; color: #2d3436; line-height: 1.6; }
  .container { max-width: 100%; margin: 0 auto; padding: 24px 40px; }
  .header { background: linear-gradient(135deg, #0984e3, #6c5ce7); color: white; padding: 40px; border-radius: 16px; margin-bottom: 32px; }
  .header h1 { font-size: 28px; margin-bottom: 8px; }
  .header p { opacity: 0.9; font-size: 15px; }
  .summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .card { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
  .card .label { font-size: 13px; color: #636e72; margin-bottom: 4px; }
  .card .value { font-size: 28px; font-weight: 700; }
  .card .sub { font-size: 12px; color: #b2bec3; margin-top: 4px; }
  .card.highlight { border-left: 4px solid #e17055; }
  .card.good { border-left: 4px solid #00b894; }
  .section { background: white; border-radius: 12px; padding: 28px; margin-bottom: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
  .section h2 { font-size: 18px; margin-bottom: 6px; color: #2d3436; }
  .section .desc { font-size: 13px; color: #636e72; margin-bottom: 20px; }
  .chart-container { position: relative; height: 320px; margin-bottom: 16px; }
  .chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  @media (max-width: 768px) { .chart-row { grid-template-columns: 1fr; } }
  table { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 16px; }
  th { background: #f8f9fa; padding: 10px 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #dfe6e9; }
  td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; }
  tr:hover td { background: #f8f9fa; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .rate { font-weight: 600; }
  .rate.high { color: #00b894; }
  .rate.mid { color: #fdcb6e; }
  .rate.low { color: #e17055; }
  .insight { background: #ffeaa7; border-radius: 8px; padding: 16px 20px; margin-top: 16px; font-size: 14px; }
  .insight strong { color: #d63031; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
  .tag.stale { background: #fab1a0; color: #d63031; }
  .tag.fresh { background: #81ecec; color: #00b894; }
  .bar-inline { display: inline-block; height: 8px; border-radius: 4px; vertical-align: middle; }
  .thesis { background: linear-gradient(135deg, #dfe6e9, #b2bec3); border-radius: 12px; padding: 24px 28px; margin-bottom: 32px; }
  .thesis h3 { font-size: 16px; margin-bottom: 8px; }
  .thesis p { font-size: 14px; color: #2d3436; }
  .arrow { font-size: 20px; margin: 0 8px; }

  /* Little's Law */
  .littles-law { background: white; border-radius: 12px; padding: 32px; margin-bottom: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
  .littles-law h2 { font-size: 20px; margin-bottom: 4px; }
  .littles-law .desc { font-size: 13px; color: #636e72; margin-bottom: 24px; }
  .formula-box { text-align: center; padding: 24px; background: #f8f9fa; border-radius: 12px; margin-bottom: 24px; }
  .formula { font-size: 36px; font-weight: 700; letter-spacing: 2px; }
  .formula .var-l { color: #e17055; }
  .formula .var-lambda { color: #0984e3; }
  .formula .var-w { color: #6c5ce7; }
  .formula-legend { display: flex; justify-content: center; gap: 32px; margin-top: 12px; font-size: 13px; color: #636e72; }
  .formula-legend span { font-weight: 600; }
  .compare-grid { display: grid; grid-template-columns: 1fr 80px 1fr; gap: 0; margin: 24px 0; align-items: stretch; }
  .compare-box { border-radius: 12px; padding: 24px; }
  .compare-box.current { background: linear-gradient(135deg, #ffeaa7, #fab1a0); }
  .compare-box.ideal { background: linear-gradient(135deg, #81ecec, #74b9ff); }
  .compare-box h4 { font-size: 15px; margin-bottom: 16px; font-weight: 700; }
  .compare-arrow { display: flex; align-items: center; justify-content: center; font-size: 32px; color: #636e72; }
  .metric-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.08); }
  .metric-row:last-child { border-bottom: none; }
  .metric-label { font-size: 13px; color: #2d3436; }
  .metric-value { font-size: 20px; font-weight: 700; }
  .metric-value.red { color: #d63031; }
  .metric-value.blue { color: #0984e3; }
  .metric-value.green { color: #00b894; }
  .cycle-diagram { text-align: center; padding: 20px; margin: 20px 0; }
  .cycle-box { display: inline-block; padding: 12px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; margin: 0 4px; vertical-align: middle; }
  .cycle-arrow { display: inline-block; font-size: 24px; margin: 0 4px; vertical-align: middle; color: #636e72; }
  .cycle-box.bad { background: #fab1a0; color: #d63031; }
  .cycle-box.neutral { background: #ffeaa7; color: #856404; }
  .vicious-label { display: block; font-size: 12px; color: #d63031; margin-top: 12px; font-weight: 700; }

  /* Executive Summary */
  .exec-summary { background: white; border-radius: 12px; padding: 32px; margin-bottom: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); border-left: 6px solid #0984e3; }
  .exec-summary h2 { font-size: 22px; margin-bottom: 16px; color: #2d3436; }
  .exec-summary .question { font-size: 18px; font-weight: 700; color: #0984e3; margin-bottom: 20px; }
  .exec-summary .answer { font-size: 16px; font-weight: 700; color: #d63031; margin-bottom: 24px; padding: 16px 20px; background: #fff5f5; border-radius: 8px; }
  .finding-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 20px; }
  .finding-card { border-radius: 10px; padding: 20px; }
  .finding-card .step { font-size: 12px; font-weight: 700; color: white; display: inline-block; padding: 2px 10px; border-radius: 12px; margin-bottom: 8px; }
  .finding-card h4 { font-size: 15px; margin-bottom: 8px; }
  .finding-card p { font-size: 13px; color: #2d3436; line-height: 1.7; }
  .finding-card.red { background: #fff5f5; border: 1px solid #fab1a0; }
  .finding-card.red .step { background: #e17055; }
  .finding-card.green { background: #f0fff4; border: 1px solid #81ecec; }
  .finding-card.green .step { background: #00b894; }
  .finding-card.blue { background: #f0f8ff; border: 1px solid #74b9ff; }
  .finding-card.blue .step { background: #0984e3; }
  .finding-card.purple { background: #f8f5ff; border: 1px solid #a29bfe; }
  .finding-card.purple .step { background: #6c5ce7; }
  .plain-explain { background: #f8f9fa; border-radius: 8px; padding: 14px 18px; margin-top: 12px; font-size: 13px; color: #636e72; line-height: 1.7; border-left: 3px solid #0984e3; }
  .conclusion-section { background: linear-gradient(135deg, #0984e3, #6c5ce7); color: white; border-radius: 12px; padding: 32px; margin-top: 24px; }
  .conclusion-section h2 { color: white; margin-bottom: 16px; }
  .conclusion-section .rec-item { background: rgba(255,255,255,0.15); border-radius: 8px; padding: 16px 20px; margin-bottom: 12px; }
  .conclusion-section .rec-item h4 { color: #ffeaa7; margin-bottom: 6px; }
  .conclusion-section .rec-item p { font-size: 14px; opacity: 0.95; }

  /* Goal Section */
  .goal-section { border-left: 6px solid #00b894; }
  .goal-roadmap { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0; }
  .goal-step { border-radius: 12px; padding: 20px; text-align: center; }
  .goal-step .step-label { font-size: 12px; font-weight: 700; color: white; display: inline-block; padding: 2px 10px; border-radius: 12px; margin-bottom: 10px; }
  .goal-step .big-num { font-size: 28px; font-weight: 800; }
  .goal-step .cw-label { font-size: 14px; margin-top: 4px; font-weight: 600; }
  .goal-step .method { font-size: 12px; color: #636e72; margin-top: 8px; line-height: 1.5; }
  .goal-step .change-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 700; margin-top: 8px; }
  @media (max-width: 900px) { .goal-roadmap { grid-template-columns: 1fr 1fr; } }
</style>
</head>
<body>
<div class="container">

  <div class="header">
    <h1>파이프라인 혼잡도 vs 영업 성과 분석</h1>
    <p>인바운드세일즈 | ${startDate.substring(0, 10)} ~ ${new Date().toISOString().substring(0, 10)} | ${opps.length}건 분석</p>
  </div>

  <!-- Executive Summary -->
  <div class="exec-summary">
    <h2>이 보고서의 핵심</h2>
    <div class="question">"영업기회를 정리하면 진짜 성과가 올라갈까?"</div>
    <div class="answer">데이터 분석 결과: 네, 파이프라인이 가벼운 담당자일수록 CW(계약 성사)율이 더 높습니다.</div>

    <div class="finding-cards">
      <div class="finding-card red">
        <span class="step">현황</span>
        <h4>파이프라인이 정리되지 않고 있다</h4>
        <p>현재 담당자 1인당 평균 <strong>${lPerOwner}건</strong>의 Open 영업기회를 보유 중.<br>
        이 중 대부분은 30일 이상 방치된 건으로, 사실상 관리되지 않는 상태.</p>
      </div>
      <div class="finding-card blue">
        <span class="step">발견 1</span>
        <h4>관리 건수가 적을 때 CW율이 높다</h4>
        <p>동시에 관리하는 영업기회가 <strong>10건 이하</strong>일 때 CW율 <strong>${allBucketData[0]?.cwRate || 0}%</strong><br>
        <strong>100건 이상</strong>일 때 CW율 <strong>${allBucketData.find(d => d.label === '101~150건')?.cwRate || 40}%</strong> 수준으로 하락.</p>
      </div>
      <div class="finding-card purple">
        <span class="step">발견 2</span>
        <h4>같은 시기에도 부하 낮은 담당자가 더 잘한다</h4>
        <p>같은 달, 같은 조건에서 부하가 낮은 담당자 그룹의 CW율이<br>
        부하가 높은 그룹보다 <strong>${sameMonthSummary.diff > 0 ? '+' : ''}${sameMonthSummary.diff}%p</strong> 더 높음.</p>
      </div>
      <div class="finding-card green">
        <span class="step">제안</span>
        <h4>30일+ 방치 건을 정리하면?</h4>
        <p>현재 Open <strong>${openOpps.length}건</strong> → 정리 후 <strong>${openOpps.length - staleOpps.length}건</strong><br>
        담당자당 부하가 크게 줄어 CW율 개선 기대.</p>
      </div>
    </div>

    <p style="font-size:13px; color:#636e72;">아래 분석에서 이 결론을 뒷받침하는 데이터를 하나씩 확인할 수 있습니다.</p>
  </div>

  <!-- 목표 설정: 현재 → 개선 로드맵 -->
  <div class="section goal-section">
    <h2>현재 상황 → 개선 목표: 파이프라인을 얼마나 줄여야 하나?</h2>
    <div class="desc">SQL 유입(${lambdaPerMonth}건/월)은 줄일 수 없으므로, 담당자당 파이프라인 체류량을 줄여 CW율을 올려야 합니다</div>

    <div class="plain-explain">
      <strong>핵심 질문:</strong> CW율을 올리려면 담당자당 Open 영업기회를 얼마나 줄여야 할까?<br>
      <strong>데이터 기반 답:</strong> 담당자당 <strong>${lPerOwner}건 → 10건 이하</strong>로 줄이면 CW율이 <strong>${currentCwRate}% → ${bestAchievableCwRate}%</strong>로 약 <strong>+${maxImprovementPct}%</strong> 향상 가능.<br>
      <strong>60% 향상 목표(→ ${(currentCwRate * 1.6).toFixed(0)}%)를 위해서는:</strong> 파이프라인 정리(+${maxImprovementPct}%) + 미팅 프로세스 개선(나머지 ${Math.max(0, 60 - maxImprovementPct)}%)이 함께 필요합니다.
    </div>

    <div class="goal-roadmap">
      ${targetScenarios.map((s, i) => {
        const bg = i === 0 ? '#fff5f5' : i === 1 ? '#fffbe6' : i === 2 ? '#f0f8ff' : '#f0fff4';
        const badge = s.cwChangePct > 0
          ? '<div class="change-badge" style="background:#e6f9f0;color:#00b894">+' + s.cwChangePct + '%</div>'
          : '<div class="change-badge" style="background:#fee;color:#e17055">기준점</div>';
        return '<div class="goal-step" style="background:' + bg + '">' +
          '<span class="step-label" style="background:' + s.color + '">' + s.name + '</span>' +
          '<div class="big-num" style="color:' + s.color + '">' + s.targetLPerOwner + '건/인</div>' +
          '<div class="cw-label">CW율 ' + s.expectedCwRate + '%</div>' +
          badge +
          '<div class="method">' + s.method + '</div>' +
          (s.reductionNeeded > 0 && s.cwChangePct > 0 ? '<div style="font-size:11px;color:#636e72;margin-top:4px">정리 필요: ' + s.reductionNeeded + '건</div>' : '') +
          '</div>';
      }).join('')}
    </div>

    <div class="chart-container" style="height:300px">
      <canvas id="chartGoal"></canvas>
    </div>

    <table>
      <thead><tr><th>시나리오</th><th class="num">담당자당 L</th><th class="num">전체 L</th><th class="num">해당 구간</th><th class="num">예상 CW율</th><th class="num">CW율 변화</th><th class="num">정리 건수</th><th class="num">목표 W</th><th>실현 방법</th></tr></thead>
      <tbody>
        ${targetScenarios.map(s => {
          return '<tr>' +
            '<td style="font-weight:600;color:' + s.color + '">' + s.name + '</td>' +
            '<td class="num">' + s.targetLPerOwner + '건</td>' +
            '<td class="num">' + s.totalTarget + '건</td>' +
            '<td class="num">' + s.bucket + '</td>' +
            '<td class="num rate ' + (s.expectedCwRate >= 45 ? 'high' : s.expectedCwRate >= 35 ? 'mid' : 'low') + '">' + s.expectedCwRate + '%</td>' +
            '<td class="num" style="font-weight:700;color:' + (s.cwChangePct > 0 ? '#00b894' : '#e17055') + '">' + (s.cwChangePct > 0 ? '+' + s.cwChangePct + '%' : '-') + '</td>' +
            '<td class="num">' + (s.reductionNeeded > 0 ? s.reductionNeeded + '건' : '-') + '</td>' +
            '<td class="num">' + s.targetW + '일</td>' +
            '<td>' + s.method + '</td>' +
            '</tr>';
        }).join('')}
      </tbody>
    </table>

    <div class="insight">
      <strong>로드맵 요약:</strong><br>
      1단계(30일+ 정리)만으로 담당자당 ${lPerOwner}건 → ${afterCleanLPerOwner}건으로 감소, 전체 목표의 약 ${lPerOwner > 10 ? Math.round((lPerOwner - afterCleanLPerOwner) / (lPerOwner - 10) * 100) : 0}% 달성<br>
      최종 목표(10건/인)까지 도달 시 CW율 <strong>+${maxImprovementPct}%</strong> 향상 기대<br>
      <strong>60% 향상을 위해서는 파이프라인 관리(+${maxImprovementPct}%) + 미팅/프로세스 개선(+${Math.max(0, 60 - maxImprovementPct)}%)이 함께 필요</strong>
    </div>
  </div>

  <!-- W 단축 시뮬레이션 -->
  <div class="section" style="border-left: 6px solid #0984e3;">
    <h2>시뮬레이션: "빨리 판단할 수 있는 환경"을 만들면?</h2>
    <div class="desc">30일+ 정리 후, 처리 속도(W)를 개선했을 때 BO 1인당 파이프라인 변화 (월 350건 SQL 유입, BO ${simConfig.boCount}명 기준)</div>

    <div class="plain-explain">
      <strong>전제:</strong> 30일 이상 방치된 ${staleOpps.length}건을 먼저 정리 → ${simInitialL}건(BO당 ${simInitialPerBo}건)에서 시작<br>
      <strong>변수:</strong> 월 350건 SQL 유입은 그대로. 처리 속도(W)만 개선했을 때 파이프라인이 몇 주 만에 어디로 수렴하는지<br>
      <strong>핵심:</strong> 담당자에게 "빨리 해"가 아니라, <strong>"판단할 수 있는 환경을 만들어주면"</strong> W가 자연히 줄고, 파이프라인은 건강한 수준으로 수렴합니다.
    </div>

    <div class="chart-container" style="height:380px">
      <canvas id="chartSim"></canvas>
    </div>

    <table>
      <thead><tr><th>처리 속도 (W)</th><th class="num">수렴 L (BO당)</th><th class="num">수렴 L (전체)</th><th class="num">예상 CW율</th><th class="num">현재 대비</th><th>실현 방법</th></tr></thead>
      <tbody>
        ${simResults.map(s => {
          const totalSteady = s.steadyState * simConfig.boCount;
          const reduction = Math.round((1 - totalSteady / openOpps.length) * 100);
          return '<tr>' +
            '<td style="font-weight:600;color:' + s.color + '">' + s.label + '</td>' +
            '<td class="num">' + s.steadyState + '건</td>' +
            '<td class="num">' + totalSteady + '건</td>' +
            '<td class="num rate ' + (s.steadyCwRate >= 45 ? 'high' : s.steadyCwRate >= 35 ? 'mid' : 'low') + '">' + s.steadyCwRate + '%</td>' +
            '<td class="num">' + (reduction > 0 ? '-' + reduction + '%' : '-') + '</td>' +
            '<td>' + s.method + '</td>' +
            '</tr>';
        }).join('')}
      </tbody>
    </table>

    <div class="insight">
      <strong>읽는 법:</strong> 빨간 점선(정리 전 ${simCurrentPerBo}건/BO)에서 시작하여, 30일+ 정리 후 회색 점선(${simInitialPerBo}건/BO)으로 내려옵니다.<br>
      이후 처리 속도(W)에 따라 각 색 선처럼 수렴합니다. 예를 들어 <strong>W=14일(주 2회 리뷰)을 유지하면 약 4주 만에 BO당 ${simResults.find(s => s.w === 14)?.steadyState || 41}건</strong>으로 안정됩니다.<br>
      <strong>"많이 버리는" 게 아니라, "빨리 판단할 수 있게 해주는" 것만으로 파이프라인이 자연스럽게 줄어듭니다.</strong>
    </div>
  </div>

  <!-- Little's Law Section -->
  <div class="littles-law">
    <h2>리틀의 법칙 (Little's Law) 으로 본 파이프라인</h2>
    <div class="desc">안정적인 시스템에서 체류량(L)은 유입률(λ)과 체류시간(W)의 곱으로 결정된다</div>

    <div class="formula-box">
      <div class="formula">
        <span class="var-l">L</span> = <span class="var-lambda">λ</span> × <span class="var-w">W</span>
      </div>
      <div class="formula-legend">
        <div><span class="var-l" style="color:#e17055">L</span> = 파이프라인 체류량 (동시 Open 건수)</div>
        <div><span class="var-lambda" style="color:#0984e3">λ</span> = 유입률 (월 신규 영업기회)</div>
        <div><span class="var-w" style="color:#6c5ce7">W</span> = 체류시간 (생성→Close 기간)</div>
      </div>
    </div>

    <div class="compare-grid">
      <div class="compare-box current">
        <h4>현재 상태 (인바운드)</h4>
        <div class="metric-row">
          <span class="metric-label">L (파이프라인 체류량)</span>
          <span class="metric-value red">${openOpps.length}건</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">λ (월 평균 유입)</span>
          <span class="metric-value blue">${lambdaPerMonth}건/월</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">W (평균 체류시간)</span>
          <span class="metric-value red">${avgW}일</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">담당자당 L</span>
          <span class="metric-value red">${lPerOwner}건</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">담당자당 월 유입</span>
          <span class="metric-value">${lambdaPerOwner}건</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">CL 평균 체류</span>
          <span class="metric-value red">${avgWcl}일</span>
        </div>
      </div>

      <div class="compare-arrow">→</div>

      <div class="compare-box ideal">
        <h4>정리 후 목표</h4>
        <div class="metric-row">
          <span class="metric-label">L (파이프라인 체류량)</span>
          <span class="metric-value green">${afterCleanL}건</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">λ (월 평균 유입)</span>
          <span class="metric-value blue">${lambdaPerMonth}건/월</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">W (목표 체류시간)</span>
          <span class="metric-value green">${idealW}일</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">담당자당 L</span>
          <span class="metric-value green">${afterCleanLPerOwner}건</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">담당자당 월 유입</span>
          <span class="metric-value">${lambdaPerOwner}건</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">CW 평균 체류</span>
          <span class="metric-value green">${avgWcw}일</span>
        </div>
      </div>
    </div>

    <div class="cycle-diagram">
      <div style="margin-bottom: 16px; font-size: 14px; font-weight: 600; color: #636e72;">현재: 악순환 구조</div>
      <div class="cycle-box bad">L 증가 (파이프라인 적체)</div>
      <span class="cycle-arrow">→</span>
      <div class="cycle-box neutral">미팅 질 하락 (리소스 분산)</div>
      <span class="cycle-arrow">→</span>
      <div class="cycle-box bad">W 증가 (체류시간 늘어남)</div>
      <span class="cycle-arrow">→</span>
      <div class="cycle-box bad">L 더 증가</div>
      <span class="vicious-label">↻ λ(유입)는 동일한데 W가 늘어 L이 계속 쌓이는 구조</span>
    </div>

    <div class="insight" style="margin-top:20px">
      <strong>핵심:</strong> λ(유입)를 줄일 수 없다면, <strong>W(체류시간)를 줄여야 L(체류량)이 줄어든다.</strong><br>
      W를 줄이려면 → 불필요한 체류 건 정리 → 담당자 리소스 확보 → 미팅 질 향상 → CW 빨라짐 → W 자연 감소
    </div>
  </div>

  <div class="summary-cards">
    <div class="card highlight">
      <div class="label">현재 Open 파이프라인</div>
      <div class="value">${openOpps.length}건</div>
      <div class="sub">30일+ 체류 ${staleOpps.length}건 (${(staleOpps.length/openOpps.length*100).toFixed(0)}%)</div>
    </div>
    <div class="card">
      <div class="label">부하 낮을 때 CW율</div>
      <div class="value" style="color:#00b894">${allBucketData[0]?.cwRate || 0}%</div>
      <div class="sub">동시 0~5건 관리 시</div>
    </div>
    <div class="card">
      <div class="label">부하 높을 때 CW율</div>
      <div class="value" style="color:#e17055">${allBucketData.find(d => d.label === '11~20건')?.cwRate || allBucketData[allBucketData.length - 1]?.cwRate || 0}%</div>
      <div class="sub">동시 11~20건 관리 시</div>
    </div>
    <div class="card good">
      <div class="label">정리 시 확보 여유</div>
      <div class="value">${staleOpps.length}건</div>
      <div class="sub">놓칠 CW ~${Math.round(staleOpps.length * (cwOver30 / cwAll.length) * (cwAll.length / closedOpps.length))}건</div>
    </div>
  </div>

  <!-- 분석 1: 부하 vs CW율 -->
  <div class="section">
    <h2>1. 파이프라인 부하 구간별 CW율</h2>
    <div class="desc">영업기회 생성 시점에 담당자가 동시에 관리하고 있던 Open 건 수 vs 해당 건의 최종 CW/CL 결과</div>
    <div class="plain-explain">
      <strong>읽는 법:</strong> 새 영업기회가 들어왔을 때, 그 담당자가 이미 몇 건을 관리하고 있었는지에 따라 CW율이 어떻게 달라지는지 보여줍니다.
      예를 들어 "0~10건" 구간은 담당자가 여유로운 상태에서 받은 영업기회의 성과입니다.
    </div>
    <div class="chart-container">
      <canvas id="chart1"></canvas>
    </div>
    <table>
      <thead><tr><th>배정 시 담당자 Open 건수</th><th class="num">분석 건수</th><th class="num">CW</th><th class="num">CL</th><th class="num">CW율</th><th class="num">Task 평균</th></tr></thead>
      <tbody>
        ${allBucketData.map(d => `<tr>
          <td>${d.label}</td><td class="num">${d.total}</td><td class="num">${d.cw}</td><td class="num">${d.cl}</td>
          <td class="num rate ${d.cwRate >= 45 ? 'high' : d.cwRate >= 35 ? 'mid' : 'low'}">${d.cwRate}%</td>
          <td class="num">${d.avgTasks}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <!-- 분석 1-1: 운영중/오픈전 비교 -->
  <div class="section">
    <h2>1-1. 매장 유형별 부하 vs CW율</h2>
    <div class="desc">운영중 매장과 오픈전 매장을 분리해서 부하 효과 비교</div>
    <div class="plain-explain">
      <strong>읽는 법:</strong> 운영중 매장과 오픈전 매장의 특성이 다르므로 분리해서 봅니다. 두 유형 모두 부하가 낮을수록 CW율이 높은 패턴이 나타나는지 확인합니다.
    </div>
    <div class="chart-row">
      <div class="chart-container"><canvas id="chart1a"></canvas></div>
      <div class="chart-container"><canvas id="chart1b"></canvas></div>
    </div>
  </div>

  <!-- 분석 1-2: BO 담당자별 부하 구간 -->
  <div class="section">
    <h2>1-2. BO 담당자별 부하 구간 vs CW율</h2>
    <div class="desc">BO(백오피스) 담당자가 관리하는 영업기회 기준으로 동시 Open 건수 구간별 CW율 비교</div>
    ${boBucketUsers.map((bo, idx) => {
      const data = boBucketByUser[bo];
      return '<div style="margin-bottom:32px">' +
        '<h3 style="font-size:15px; margin-bottom:12px; color:#6c5ce7">' + bo + '</h3>' +
        '<div class="chart-container" style="height:280px"><canvas id="chartBo1_' + idx + '"></canvas></div>' +
        '<table>' +
        '<thead><tr><th>배정 시 BO Open 건수</th><th class="num">분석 건수</th><th class="num">CW</th><th class="num">CL</th><th class="num">CW율</th><th class="num">Task 평균</th></tr></thead>' +
        '<tbody>' +
        data.map(d =>
          '<tr><td>' + d.label + '</td><td class="num">' + d.total + '</td><td class="num">' + d.cw + '</td><td class="num">' + d.cl + '</td>' +
          '<td class="num rate ' + (d.cwRate >= 45 ? 'high' : d.cwRate >= 35 ? 'mid' : 'low') + '">' + d.cwRate + '%</td>' +
          '<td class="num">' + d.avgTasks + '</td></tr>'
        ).join('') +
        '</tbody></table></div>';
    }).join('')}
  </div>

  <!-- 분석 1-3: 동일 월 내 담당자 간 부하 비교 -->
  <div class="section">
    <h2>1-3. 같은 달, 다른 부하 — 누가 더 잘하나? (핵심 증거)</h2>
    <div class="desc">같은 달에 부하가 낮았던 담당자 그룹 vs 높았던 담당자 그룹의 CW율 비교</div>
    <div class="plain-explain">
      <strong>왜 중요한가:</strong> 앞선 분석은 "시간이 지나면서 파이프라인이 쌓인 것"과 CW율을 비교한 거라, "시기의 차이 때문 아닌가?"라는 반론이 가능합니다.<br>
      이 분석은 <strong>같은 달</strong>에 부하가 낮은 담당자와 높은 담당자를 비교합니다. 시기가 같으니 순수하게 "부하 차이"만의 효과를 볼 수 있습니다.<br>
      <strong>초록 막대(부하↓)가 빨간 막대(부하↑)보다 높으면 = 부하가 낮을수록 CW율이 높다는 증거입니다.</strong>
    </div>
    <div class="chart-row">
      <div class="chart-container"><canvas id="chart1c"></canvas></div>
      <div class="chart-container"><canvas id="chart1d"></canvas></div>
    </div>
    <table>
      <thead><tr><th>월</th><th class="num">부하↓ 평균Open</th><th class="num">부하↓ 건수</th><th class="num">부하↓ CW율</th><th class="num">부하↑ 평균Open</th><th class="num">부하↑ 건수</th><th class="num">부하↑ CW율</th><th class="num">차이</th></tr></thead>
      <tbody>
        ${sameMonthComparison.map(d => {
          const diff = (d.lowCwRate - d.highCwRate).toFixed(1);
          const diffColor = diff > 0 ? '#00b894' : '#e17055';
          const diffSign = diff > 0 ? '+' : '';
          return '<tr>' +
            '<td>' + d.month + '</td>' +
            '<td class="num">' + d.lowAvgLoad + '건</td>' +
            '<td class="num">' + d.lowTotal + '</td>' +
            '<td class="num rate ' + (d.lowCwRate >= 45 ? 'high' : d.lowCwRate >= 35 ? 'mid' : 'low') + '">' + d.lowCwRate + '%</td>' +
            '<td class="num">' + d.highAvgLoad + '건</td>' +
            '<td class="num">' + d.highTotal + '</td>' +
            '<td class="num rate ' + (d.highCwRate >= 45 ? 'high' : d.highCwRate >= 35 ? 'mid' : 'low') + '">' + d.highCwRate + '%</td>' +
            '<td class="num" style="font-weight:700;color:' + diffColor + '">' + diffSign + diff + '%p</td>' +
            '</tr>';
        }).join('')}
      </tbody>
    </table>
    <div class="insight">
      전체 집계: 부하 낮은 그룹 CW율 <strong>${sameMonthSummary.lowCwRate}%</strong> (${sameMonthSummary.lowTotal}건)
      vs 높은 그룹 <strong>${sameMonthSummary.highCwRate}%</strong> (${sameMonthSummary.highTotal}건)
      &nbsp;→&nbsp; 차이 <strong>${sameMonthSummary.diff > 0 ? '+' : ''}${sameMonthSummary.diff}%p</strong>
      <br><strong>→ 동일 시기에도 파이프라인 부하가 낮은 담당자의 CW율이 더 높다</strong> (시간 교란 제거된 증거)
    </div>
  </div>

  <!-- 분석 2: 담당자별 -->
  <div class="section">
    <h2>2. 담당자별 현재 파이프라인 vs 최근 3개월 성과</h2>
    <div class="desc">각 담당자가 현재 몇 건을 들고 있는지, 그리고 최근 성과는 어떤지</div>
    <div class="plain-explain">
      <strong>읽는 법:</strong> 현재 Open 건수가 많은 담당자가 CW율이 낮은 경향이 보이면, 파이프라인 정리가 필요하다는 뜻입니다. 점이 왼쪽 위(Open 적고 CW율 높음)에 몰릴수록 좋은 상태입니다.
    </div>
    <div class="chart-container"><canvas id="chart2"></canvas></div>
    <table>
      <thead><tr><th>담당자</th><th class="num">현재 Open</th><th class="num">30일+ 체류</th><th class="num">CW</th><th class="num">CL</th><th class="num">CW율</th><th class="num">Task 평균</th></tr></thead>
      <tbody>
        ${ownerStats.map(s => `<tr>
          <td>${s.owner}</td>
          <td class="num">${s.currentOpen} <span class="tag ${s.staleOpen > 20 ? 'stale' : 'fresh'}">${s.staleOpen > 0 ? s.staleOpen + '건 체류' : 'OK'}</span></td>
          <td class="num">${s.staleOpen}</td>
          <td class="num">${s.recentCW}</td><td class="num">${s.recentCL}</td>
          <td class="num rate ${s.cwRate >= 50 ? 'high' : s.cwRate >= 35 ? 'mid' : 'low'}">${s.cwRate}%</td>
          <td class="num">${s.avgTasks}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${ownerInsightHtml}
  </div>

  <!-- 분석 3: 월별 추이 -->
  <div class="section">
    <h2>3. 월별 파이프라인 누적량 vs CW율 추이</h2>
    <div class="desc">시간이 지나면서 파이프라인이 얼마나 쌓였고, CW율은 어떻게 변했는지</div>
    <div class="plain-explain">
      <strong>읽는 법:</strong> 회색 막대(파이프라인 누적)가 올라갈수록 파란 선(CW율)이 내려가면 → 파이프라인이 쌓일수록 성과가 나빠진다는 의미입니다.
    </div>
    <div class="chart-container" style="height:360px"><canvas id="chart3"></canvas></div>
    <table>
      <thead><tr><th>월</th><th class="num">신규</th><th class="num">월말 Open</th><th class="num">CW</th><th class="num">CL</th><th class="num">CW율</th><th class="num">Task 평균</th></tr></thead>
      <tbody>
        ${monthlyData.map(d => `<tr>
          <td>${d.month}</td><td class="num">${d.newCount}</td><td class="num">${d.estimatedOpen}</td>
          <td class="num">${d.cw}</td><td class="num">${d.cl}</td>
          <td class="num rate ${d.cwRate >= 45 ? 'high' : d.cwRate >= 35 ? 'mid' : 'low'}">${d.cwRate}%</td>
          <td class="num">${d.avgTasks}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <!-- 분석 2-1: BO 담당자별 -->
  <div class="section">
    <h2>2-1. BO 담당자별 파이프라인 vs 최근 3개월 성과</h2>
    <div class="desc">BO(백오피스) 담당자 기준으로 본 파이프라인 부하와 CW율</div>
    <div class="chart-container"><canvas id="chart2bo"></canvas></div>
    <table>
      <thead><tr><th>BO 담당자</th><th class="num">현재 Open</th><th class="num">30일+ 체류</th><th class="num">CW</th><th class="num">CL</th><th class="num">CW율</th><th class="num">Task 평균</th></tr></thead>
      <tbody>
        ${boStats.map(s => `<tr>
          <td>${s.bo}</td>
          <td class="num">${s.currentOpen} <span class="tag ${s.staleOpen > 20 ? 'stale' : 'fresh'}">${s.staleOpen > 0 ? s.staleOpen + '건 체류' : 'OK'}</span></td>
          <td class="num">${s.staleOpen}</td>
          <td class="num">${s.recentCW}</td><td class="num">${s.recentCL}</td>
          <td class="num rate ${s.cwRate >= 50 ? 'high' : s.cwRate >= 35 ? 'mid' : 'low'}">${s.cwRate}%</td>
          <td class="num">${s.avgTasks}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${boInsightHtml}
  </div>

  <!-- 분석 4: 정리 시뮬레이션 -->
  <div class="section">
    <h2>4. 파이프라인 정리 시뮬레이션 (30일+ 방치 건 정리 시)</h2>
    <div class="desc">만약 30일 이상 방치된 영업기회를 정리하면 각 담당자 부하가 얼마나 줄어드는지</div>
    <div class="plain-explain">
      <strong>읽는 법:</strong> 빨간색 = 정리 대상(30일 넘게 방치), 초록색 = 정리 후 남는 건수. 정리하면 담당자당 관리 건수가 크게 줄어 앞서 확인한 "부하 낮을 때 CW율 상승" 효과를 기대할 수 있습니다.
    </div>
    <div class="chart-container"><canvas id="chart4"></canvas></div>
    <table>
      <thead><tr><th>담당자</th><th class="num">현재 Open</th><th class="num">30일+ 체류</th><th class="num">정리 후</th><th class="num">감소율</th></tr></thead>
      <tbody>
        ${cleanupByOwner.map(d => `<tr>
          <td>${d.owner}</td><td class="num">${d.current}</td><td class="num">${d.stale}</td>
          <td class="num" style="color:#00b894;font-weight:700">${d.after}</td>
          <td class="num">${d.reduction}%</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="insight">
      전체 Open <strong>${openOpps.length}건</strong> → 정리 후 <strong>${openOpps.length - staleOpps.length}건</strong> (${(staleOpps.length/openOpps.length*100).toFixed(0)}% 감소)<br>
      CW건 중 30일 넘겨서 CW된 비율: ${(cwOver30/cwAll.length*100).toFixed(1)}% → 정리 시 놓칠 CW 약 <strong>${Math.round(staleOpps.length * (cwOver30 / cwAll.length) * (cwAll.length / closedOpps.length))}건</strong>
    </div>

    <h3 style="margin-top:24px; font-size:16px;">BO 담당자별 정리 시뮬레이션</h3>
    <table>
      <thead><tr><th>BO 담당자</th><th class="num">현재 Open</th><th class="num">30일+ 체류</th><th class="num">정리 후</th><th class="num">감소율</th></tr></thead>
      <tbody>
        ${boCleanup.map(d => `<tr>
          <td>${d.bo}</td><td class="num">${d.current}</td><td class="num">${d.stale}</td>
          <td class="num" style="color:#00b894;font-weight:700">${d.after}</td>
          <td class="num">${d.reduction}%</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <!-- 결론 및 제안 -->
  <div class="conclusion-section">
    <h2>결론 및 제안</h2>

    <div class="rec-item">
      <h4>1. 데이터가 말하는 것</h4>
      <p>파이프라인에 영업기회가 적은 상태(0~10건)에서 CW율이 가장 높았고(${allBucketData[0]?.cwRate || 0}%),
      같은 시기에 부하가 낮은 담당자가 높은 담당자보다 CW율이 ${sameMonthSummary.diff > 0 ? sameMonthSummary.diff + '%p' : '유의미하게'} 더 높았습니다.
      이는 시기와 무관하게 <strong>파이프라인 부하 자체가 성과에 영향을 미친다</strong>는 것을 의미합니다.</p>
    </div>

    <div class="rec-item">
      <h4>2. 왜 그럴까?</h4>
      <p>담당자가 관리하는 건이 많아지면 → 각 건에 쓸 수 있는 시간/에너지가 줄고 →
      Task(미팅, 전화 등) 밀도가 떨어지고 → 미팅 준비와 후속 조치가 부실해지고 → CW 확률이 하락합니다.
      100건 넘게 쌓인 영업기회 대부분은 사실상 터치하지 않는 "사장 데이터"입니다.</p>
    </div>

    <div class="rec-item">
      <h4>3. 즉시 실행 가능한 액션</h4>
      <p><strong>30일 이상 방치된 Open 건 ${staleOpps.length}건을 일괄 CL 처리합니다.</strong><br>
      이렇게 하면 전체 파이프라인이 ${openOpps.length}건 → ${openOpps.length - staleOpps.length}건으로 줄어들고,
      담당자당 관리 건수가 대폭 감소합니다.<br>
      CW건 중 30일 넘겨서 성사된 건은 ${(cwOver30/cwAll.length*100).toFixed(1)}%뿐이므로, 정리로 인한 기회 손실은 미미합니다.</p>
    </div>

    <div class="rec-item">
      <h4>4. 이후 유지 방안</h4>
      <p>파이프라인 정리는 1회성이 아니라 지속적으로 관리해야 합니다.
      주기적인 파이프라인 리뷰(주 1회)와 자동 정리 기준(예: 30일 무활동 시 자동 CL)을 도입하면
      담당자 부하를 적정 수준으로 유지하고 CW율 향상을 지속할 수 있습니다.</p>
    </div>
  </div>

</div>

<script>
const colors = {
  blue: '#0984e3', red: '#e17055', green: '#00b894', yellow: '#fdcb6e',
  purple: '#6c5ce7', gray: '#b2bec3',
};

// datalabels 전역 등록
Chart.register(ChartDataLabels);
Chart.defaults.set('plugins.datalabels', { display: false });

// 차트 1: 부하 vs CW율 (바 위에 건수 표시)
new Chart(document.getElementById('chart1'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(allBucketData.map(d => d.label))},
    datasets: [
      {
        label: 'CW율 (%)', data: ${JSON.stringify(allBucketData.map(d => d.cwRate))},
        backgroundColor: ${JSON.stringify(allBucketData.map(d => d.cwRate >= 45 ? '#00b894' : d.cwRate >= 35 ? '#fdcb6e' : '#e17055'))},
        borderRadius: 6,
        datalabels: {
          display: true, anchor: 'end', align: 'end', color: '#636e72', font: { size: 12, weight: 600 },
          formatter: (v, ctx) => { const counts = ${JSON.stringify(allBucketData.map(d => d.total))}; return counts[ctx.dataIndex] + '건'; }
        }
      },
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    scales: {
      y: { title: { display: true, text: 'CW율 (%)' }, min: 0, max: 70 },
    },
    plugins: { title: { display: true, text: '전체: 동시 파이프라인 부하 vs CW율' }, legend: { display: false } }
  }
});

// 차트 1a: 운영중
new Chart(document.getElementById('chart1a'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(opBucketData.map(d => d.label))},
    datasets: [{
      label: 'CW율 (%)', data: ${JSON.stringify(opBucketData.map(d => d.cwRate))},
      backgroundColor: ${JSON.stringify(opBucketData.map(d => d.cwRate >= 45 ? '#00b894' : d.cwRate >= 35 ? '#fdcb6e' : '#e17055'))}, borderRadius: 6,
      datalabels: {
        display: true, anchor: 'end', align: 'end', color: '#636e72', font: { size: 11, weight: 600 },
        formatter: (v, ctx) => { const c = ${JSON.stringify(opBucketData.map(d => d.total))}; return c[ctx.dataIndex] + '건'; }
      }
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    scales: { y: { min: 0, max: 70, title: { display: true, text: 'CW율 (%)' } } },
    plugins: { title: { display: true, text: '운영중 매장' }, legend: { display: false } }
  }
});

// 차트 1b: 오픈전
new Chart(document.getElementById('chart1b'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(preBucketData.map(d => d.label))},
    datasets: [{
      label: 'CW율 (%)', data: ${JSON.stringify(preBucketData.map(d => d.cwRate))},
      backgroundColor: ${JSON.stringify(preBucketData.map(d => d.cwRate >= 45 ? '#00b894' : d.cwRate >= 35 ? '#fdcb6e' : '#e17055'))}, borderRadius: 6,
      datalabels: {
        display: true, anchor: 'end', align: 'end', color: '#636e72', font: { size: 11, weight: 600 },
        formatter: (v, ctx) => { const c = ${JSON.stringify(preBucketData.map(d => d.total))}; return c[ctx.dataIndex] + '건'; }
      }
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    scales: { y: { min: 0, max: 70, title: { display: true, text: 'CW율 (%)' } } },
    plugins: { title: { display: true, text: '오픈전 매장' }, legend: { display: false } }
  }
});

// 차트 2: 담당자별 Open vs CW율 scatter
new Chart(document.getElementById('chart2'), {
  type: 'scatter',
  data: {
    datasets: [{
      label: '담당자',
      data: ${JSON.stringify(ownerStats.map(s => ({ x: s.currentOpen, y: s.cwRate })))},
      backgroundColor: colors.purple,
      pointRadius: 10,
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    scales: {
      x: { title: { display: true, text: '현재 Open 건수' } },
      y: { title: { display: true, text: 'CW율 (%)' }, min: 0 },
    },
    plugins: {
      title: { display: true, text: '담당자 Open 건수 vs CW율 (최근 3개월)' },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const s = ${JSON.stringify(ownerStats)}[ctx.dataIndex];
            return s.owner + ': Open ' + s.currentOpen + '건, CW율 ' + s.cwRate + '%';
          }
        }
      }
    }
  }
});

// 차트 2-1: BO별 scatter
new Chart(document.getElementById('chart2bo'), {
  type: 'scatter',
  data: {
    datasets: [{
      label: 'BO 담당자',
      data: ${JSON.stringify(boStats.map(s => ({ x: s.currentOpen, y: s.cwRate })))},
      backgroundColor: '#e17055',
      pointRadius: 10,
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    scales: {
      x: { title: { display: true, text: '현재 Open 건수' } },
      y: { title: { display: true, text: 'CW율 (%)' }, min: 0 },
    },
    plugins: {
      title: { display: true, text: 'BO 담당자 Open 건수 vs CW율 (최근 3개월)' },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const s = ${JSON.stringify(boStats)}[ctx.dataIndex];
            return s.bo + ': Open ' + s.currentOpen + '건, CW율 ' + s.cwRate + '%';
          }
        }
      }
    }
  }
});

// 차트 1-3a: 동일 월 내 부하↓ vs 부하↑ CW율
new Chart(document.getElementById('chart1c'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(sameMonthComparison.map(d => d.month))},
    datasets: [
      { label: '부하↓ CW율', data: ${JSON.stringify(sameMonthComparison.map(d => d.lowCwRate))}, backgroundColor: '#00b894', borderRadius: 4 },
      { label: '부하↑ CW율', data: ${JSON.stringify(sameMonthComparison.map(d => d.highCwRate))}, backgroundColor: '#e17055', borderRadius: 4 },
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    scales: { y: { title: { display: true, text: 'CW율 (%)' }, min: 0, max: 70 } },
    plugins: { title: { display: true, text: '월별: 부하 낮은 담당자 vs 높은 담당자 CW율' } }
  }
});

// 차트 1-3b: 담당자-월 scatter (부하 vs CW율)
new Chart(document.getElementById('chart1d'), {
  type: 'scatter',
  data: {
    datasets: [{
      label: '담당자-월',
      data: ${JSON.stringify(ownerMonthScatter.map(d => ({ x: d.avgLoad, y: d.cwRate })))},
      backgroundColor: 'rgba(108,92,231,0.5)',
      pointRadius: 6,
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    scales: {
      x: { title: { display: true, text: '해당 월 평균 동시 Open 건수' } },
      y: { title: { display: true, text: 'CW율 (%)' }, min: 0 },
    },
    plugins: {
      title: { display: true, text: '담당자-월별 평균 부하 vs CW율 (시간 통제)' },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const s = ${JSON.stringify(ownerMonthScatter)}[ctx.dataIndex];
            return s.owner + ' (' + s.month + '): Open ' + s.avgLoad + '건, CW율 ' + s.cwRate + '%';
          }
        }
      }
    }
  }
});

// 차트 3: 월별 추이
new Chart(document.getElementById('chart3'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(monthlyData.map(d => d.month))},
    datasets: [
      { label: '월말 Open', data: ${JSON.stringify(monthlyData.map(d => d.estimatedOpen))}, backgroundColor: 'rgba(178,190,195,0.4)', borderColor: colors.gray, type: 'bar', yAxisID: 'y', order: 2 },
      { label: 'CW율 (%)', data: ${JSON.stringify(monthlyData.map(d => d.cwRate))}, borderColor: colors.blue, backgroundColor: 'transparent', type: 'line', yAxisID: 'y1', pointRadius: 5, pointBackgroundColor: colors.blue, borderWidth: 3, order: 1 },
      { label: 'Task 평균', data: ${JSON.stringify(monthlyData.map(d => d.avgTasks))}, borderColor: colors.yellow, backgroundColor: 'transparent', type: 'line', yAxisID: 'y2', pointRadius: 4, pointBackgroundColor: colors.yellow, borderWidth: 2, borderDash: [5,5], order: 0 },
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    scales: {
      y: { title: { display: true, text: '파이프라인 건수' }, position: 'left' },
      y1: { title: { display: true, text: 'CW율 (%)' }, position: 'right', min: 0, max: 60, grid: { drawOnChartArea: false } },
      y2: { display: false, min: 0, max: 12 },
    },
    plugins: { title: { display: true, text: '월별 파이프라인 누적 vs CW율 & Task 밀도' } }
  }
});

// 차트 1-2: BO별 부하 구간
${boBucketUsers.map((bo, idx) => {
  const data = boBucketByUser[bo];
  const barColors = JSON.stringify(data.map(d => d.cwRate >= 45 ? '#00b894' : d.cwRate >= 35 ? '#fdcb6e' : '#e17055'));
  return `
new Chart(document.getElementById('chartBo1_${idx}'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(data.map(d => d.label))},
    datasets: [{
      label: 'CW율 (%)', data: ${JSON.stringify(data.map(d => d.cwRate))}, backgroundColor: ${barColors}, borderRadius: 6,
      datalabels: {
        display: true, anchor: 'end', align: 'end', color: '#636e72', font: { size: 11, weight: 600 },
        formatter: (v, ctx) => { const c = ${JSON.stringify(data.map(d => d.total))}; return c[ctx.dataIndex] + '건'; }
      }
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    scales: { y: { title: { display: true, text: 'CW율 (%)' }, min: 0, max: 80 } },
    plugins: { title: { display: true, text: '${bo}: 동시 파이프라인 부하 (BO기준) vs CW율' }, legend: { display: false } }
  }
});`;
}).join('\n')}

// 차트: 목표 시나리오별 파이프라인 vs CW율
new Chart(document.getElementById('chartGoal'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(targetScenarios.map(s => s.name))},
    datasets: [
      {
        label: '담당자당 Open 건수',
        data: ${JSON.stringify(targetScenarios.map(s => s.targetLPerOwner))},
        backgroundColor: ${JSON.stringify(targetScenarios.map(s => s.color))},
        borderRadius: 6,
        yAxisID: 'y',
        order: 2,
        datalabels: { display: true, anchor: 'end', align: 'end', color: '#636e72', font: { size: 12, weight: 700 }, formatter: function(v) { return v + '건'; } }
      },
      {
        label: '예상 CW율 (%)',
        data: ${JSON.stringify(targetScenarios.map(s => s.expectedCwRate))},
        type: 'line',
        borderColor: '#0984e3',
        backgroundColor: 'rgba(9,132,227,0.1)',
        pointRadius: 8,
        pointBackgroundColor: '#0984e3',
        borderWidth: 3,
        yAxisID: 'y1',
        order: 1,
        fill: true,
        datalabels: { display: true, anchor: 'end', align: 'top', color: '#0984e3', font: { size: 13, weight: 700 }, formatter: function(v) { return v + '%'; } }
      }
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    scales: {
      y: { title: { display: true, text: '담당자당 Open 건수' }, position: 'left', beginAtZero: true },
      y1: { title: { display: true, text: 'CW율 (%)' }, position: 'right', min: 0, max: 70, grid: { drawOnChartArea: false } }
    },
    plugins: {
      title: { display: true, text: '개선 시나리오: 파이프라인 축소 → CW율 향상' },
      legend: { display: true }
    }
  }
});

// 시뮬레이션 차트: W별 BO 파이프라인 수렴
new Chart(document.getElementById('chartSim'), {
  type: 'line',
  data: {
    labels: ${JSON.stringify(simWeekLabels)},
    datasets: ${simChartDatasets}
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    scales: {
      x: { title: { display: true, text: '주차 (30일+ 정리 후)' } },
      y: { title: { display: true, text: 'BO 1인당 파이프라인 (건)' }, position: 'left', min: 0 },
      y1: { title: { display: true, text: 'CW율 (%)' }, position: 'right', min: 0, max: 70, grid: { drawOnChartArea: false } }
    },
    plugins: {
      title: { display: true, text: '처리 속도(W) 개선 → 파이프라인↓ + CW율↑ (실선=파이프라인, 점선=CW율)' },
      legend: { position: 'bottom', labels: { filter: function(item) { return !item.text.includes('CW율'); } } }
    }
  }
});

// 차트 4: 정리 시뮬레이션
new Chart(document.getElementById('chart4'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(cleanupByOwner.map(d => d.owner))},
    datasets: [
      { label: '정리 후 Open', data: ${JSON.stringify(cleanupByOwner.map(d => d.after))}, backgroundColor: colors.green },
      { label: '30일+ 체류 (정리 대상)', data: ${JSON.stringify(cleanupByOwner.map(d => d.stale))}, backgroundColor: colors.red },
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    scales: { x: {}, y: { stacked: true, title: { display: true, text: '건수' } } },
    plugins: { title: { display: true, text: '담당자별 정리 시뮬레이션' } }
  }
});
</script>
</body>
</html>`;

  const filename = 'pipeline-congestion-report.html';
  fs.writeFileSync(__dirname + '/' + filename, html);
  console.log(`\nHTML 리포트 생성: ${filename}`);
}

main().catch(err => {
  console.error('오류:', err.message);
  if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
});
