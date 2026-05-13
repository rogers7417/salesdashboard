/**
 * 설치 트래킹 전용 데이터 추출
 * - Salesforce에서 InstallHopeDate__c가 있는 전체 오픈 영업기회를 직접 쿼리
 * - KPI 월별 데이터와 무관하게 독립 동작
 */
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

// ============================================
// Salesforce 유틸 (kpi-extract.js와 동일)
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

async function soqlQuery(instanceUrl, accessToken, query) {
  const url = `${instanceUrl}/services/data/v59.0/query`;
  const res = await axios.get(url, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    params: { q: query }
  });
  return res.data;
}

async function soqlQueryAll(instanceUrl, accessToken, query) {
  let allRecords = [];
  let result = await soqlQuery(instanceUrl, accessToken, query);
  allRecords.push(...(result.records || []));
  while (result.nextRecordsUrl) {
    const nextUrl = `${instanceUrl}${result.nextRecordsUrl}`;
    const res = await axios.get(nextUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    result = res.data;
    allRecords.push(...(result.records || []));
  }
  return allRecords;
}

function utcToKSTDateStr(utcDateStr) {
  if (!utcDateStr) return null;
  const d = new Date(utcDateStr);
  return new Date(d.getTime() + 9 * 3600000).toISOString().substring(0, 10);
}

function countBizDays(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  if (end <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  cur.setDate(cur.getDate() + 1);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function safeStr(v) {
  if (v === null || v === undefined) return null;
  return String(v).trim();
}

// ============================================
// 메인 추출 함수
// ============================================
async function extractInstallTracking() {
  const startTime = Date.now();
  console.log(`\n🔧 [설치 트래킹] 데이터 추출 시작...`);

  // 1. Salesforce 인증
  const { accessToken, instanceUrl } = await getSalesforceToken();
  console.log(`  ✅ Salesforce 인증 성공`);

  // 2. 전체 오픈 영업기회 중 InstallHopeDate__c가 있는 것 쿼리
  const oppQuery = `
    SELECT Id, Name, StageName, InstallHopeDate__c,
           CreatedDate, CloseDate, AgeInDays,
           BOUser__c, FieldUser__c,
           RecordType.Name, Owner.Name, OwnerId, Owner_Department__c,
           Account.Name, Account.BranchName__c,
           fm_CompanyStatus__c, Loss_Reason__c,
           (SELECT Id FROM ContractOpportunities__r)
    FROM Opportunity
    WHERE StageName NOT IN ('Closed Won', 'Closed Lost')
      AND InstallHopeDate__c != NULL
    ORDER BY InstallHopeDate__c ASC
  `;
  const opps = await soqlQueryAll(instanceUrl, accessToken, oppQuery);
  console.log(`  📋 InstallHopeDate가 있는 오픈 Opp: ${opps.length}건`);

  if (opps.length === 0) {
    console.log('  ⚠️  조건에 맞는 영업기회가 없습니다.');
    const result = { extractedAt: new Date().toISOString(), summary: { total: 0 }, opportunities: [] };
    fs.writeFileSync(path.join(DATA_DIR, 'install-tracking.json'), JSON.stringify(result, null, 2));
    return result;
  }

  // oppId 목록
  const oppIds = opps.map(o => o.Id);

  // 2-1. BOUser__c / FieldUser__c User ID → Name 매핑
  const userIds = new Set();
  opps.forEach(o => {
    if (o.BOUser__c) userIds.add(o.BOUser__c);
    if (o.FieldUser__c) userIds.add(o.FieldUser__c);
  });
  const userNameMap = {};
  if (userIds.size > 0) {
    const idArr = [...userIds];
    for (let i = 0; i < idArr.length; i += 200) {
      const batch = idArr.slice(i, i + 200).map(id => `'${id}'`).join(',');
      const userQuery = `SELECT Id, Name FROM User WHERE Id IN (${batch})`;
      const users = await soqlQueryAll(instanceUrl, accessToken, userQuery);
      users.forEach(u => { userNameMap[u.Id] = u.Name; });
    }
    console.log(`  👤 User 이름 매핑: ${Object.keys(userNameMap).length}명`);
  }

  // 3. Opp별 Task 조회 (배치 분할)
  console.log(`  📞 Opp Task 조회 중...`);
  let allTasks = [];
  for (let i = 0; i < oppIds.length; i += 200) {
    const batch = oppIds.slice(i, i + 200);
    const ids = batch.map(id => `'${id}'`).join(',');
    const taskQuery = `SELECT Id, WhatId, Subject, Description, Status, ActivityDate, CreatedDate FROM Task WHERE WhatId IN (${ids}) ORDER BY WhatId, CreatedDate`;
    const taskResult = await soqlQuery(instanceUrl, accessToken, taskQuery);
    allTasks = allTasks.concat(taskResult.records || []);
  }
  console.log(`  📞 Task: ${allTasks.length}건`);

  // 4. Visit__c 조회 (배치 분할)
  console.log(`  🏠 Visit 조회 중...`);
  let allVisits = [];
  for (let i = 0; i < oppIds.length; i += 200) {
    const batch = oppIds.slice(i, i + 200);
    const ids = batch.map(id => `'${id}'`).join(',');
    const visitQuery = `SELECT Id, Opportunity__c, Visit_Status__c, LocalInviteDate__c, ConselStart__c, ConselEnd__c, Realtime__c, VisitAssignmentDate__c, IsVisitComplete__c FROM Visit__c WHERE Opportunity__c IN (${ids}) ORDER BY Opportunity__c, ConselStart__c DESC`;
    const visitResult = await soqlQuery(instanceUrl, accessToken, visitQuery);
    allVisits = allVisits.concat(visitResult.records || []);
  }
  console.log(`  🏠 Visit: ${allVisits.length}건`);

  // 5. 인바운드/채널 담당자 구분을 위한 User 부서 정보
  //    Owner_Department__c로 구분 (채널 = '채널세일즈팀' 등)
  //    또는 RecordType.Name으로 구분

  // ============================================
  // 데이터 가공
  // ============================================
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Task 매핑
  const tasksByOpp = {};
  allTasks.forEach(t => {
    if (!tasksByOpp[t.WhatId]) tasksByOpp[t.WhatId] = [];
    tasksByOpp[t.WhatId].push(t);
  });

  // Visit 매핑
  const visitByOpp = {};
  allVisits.forEach(v => {
    const oppId = v.Opportunity__c;
    if (!oppId) return;
    if (!visitByOpp[oppId]) visitByOpp[oppId] = { visits: [] };
    visitByOpp[oppId].visits.push(v);
  });

  // Visit 정보 계산
  Object.entries(visitByOpp).forEach(([oppId, info]) => {
    const completed = info.visits.filter(v => v.Visit_Status__c === '방문완료');
    const scheduled = info.visits.filter(v => v.Visit_Status__c !== '방문완료' && v.Visit_Status__c !== '방문취소');
    info.hasVisitComplete = completed.length > 0;
    info.visitCount = info.visits.length;
    info.completedCount = completed.length;
    info.lastVisitDate = null;
    info.daysSinceVisit = null;
    info.bizDaysSinceVisit = null;

    if (completed.length > 0) {
      const latest = completed.sort((a, b) =>
        (b.LocalInviteDate__c || b.ConselStart__c || '').localeCompare(a.LocalInviteDate__c || a.ConselStart__c || '')
      )[0];
      const completeDateStr = latest.LocalInviteDate__c || latest.ConselStart__c || latest.VisitAssignmentDate__c;
      if (completeDateStr) {
        info.lastVisitDate = utcToKSTDateStr(completeDateStr);
        const visitDate = new Date(completeDateStr);
        visitDate.setHours(0, 0, 0, 0);
        info.daysSinceVisit = Math.floor((today - visitDate) / (1000 * 60 * 60 * 24));
        info.bizDaysSinceVisit = countBizDays(visitDate, today);
      }
    }

    if (scheduled.length > 0) {
      const next = scheduled.sort((a, b) =>
        (a.LocalInviteDate__c || a.ConselStart__c || '').localeCompare(b.LocalInviteDate__c || b.ConselStart__c || '')
      )[0];
      info.nextVisitDate = utcToKSTDateStr(next.LocalInviteDate__c || next.ConselStart__c || next.VisitAssignmentDate__c);
    }
  });

  // 각 Opp 가공
  const enriched = opps.map(opp => {
    const oppId = opp.Id;
    const tasks = tasksByOpp[oppId] || [];
    const vi = visitByOpp[oppId] || {};
    const installHopeDate = opp.InstallHopeDate__c;

    // D-Day 계산
    const installDate = new Date(installHopeDate + 'T00:00:00');
    const dDay = Math.ceil((installDate - today) / (1000 * 60 * 60 * 24));

    // Task 분석
    const openTasks = tasks.filter(t => t.Status !== 'Completed');
    const lastTask = tasks.length > 0 ? tasks[tasks.length - 1] : null;
    let daysSinceLastTask = null;
    if (lastTask) {
      const lastTaskDate = new Date(lastTask.CreatedDate);
      daysSinceLastTask = Math.floor((today - lastTaskDate) / (1000 * 60 * 60 * 24));
    }

    // 다음 미완료 과업 (ActivityDate 기준 가장 가까운 것)
    const nextOpenTask = openTasks
      .filter(t => t.ActivityDate)
      .sort((a, b) => (a.ActivityDate || '').localeCompare(b.ActivityDate || ''))[0]
      || openTasks[0] || null;

    // 계약 여부
    const hasContract = !!(opp.ContractOpportunities__r &&
      opp.ContractOpportunities__r.records &&
      opp.ContractOpportunities__r.records.length > 0);

    // 구분 (RecordType 또는 부서 기반)
    const dept = opp.Owner_Department__c || '';
    const isChannel = dept.includes('채널') || dept.includes('Channel');
    const section = isChannel ? '채널' : '인바운드';

    // 담당자 이름 (User ID → Name 변환)
    const boUser = userNameMap[opp.BOUser__c] || safeStr(opp.Owner?.Name) || '-';
    const fieldUser = userNameMap[opp.FieldUser__c] || '-';

    return {
      oppId,
      name: opp.Name,
      stageName: opp.StageName,
      installHopeDate,
      dDay,
      isOverdue: dDay < 0,
      section,
      boUser,
      fieldUser,
      hasContract,
      ageInDays: opp.AgeInDays || 0,
      createdDate: utcToKSTDateStr(opp.CreatedDate),
      accountName: opp.Account?.Name || '-',
      branchName: opp.Account?.BranchName__c || '-',
      companyStatus: opp.fm_CompanyStatus__c || '-',
      // Task 정보
      taskCount: tasks.length,
      lastTaskDate: lastTask ? utcToKSTDateStr(lastTask.CreatedDate) : null,
      lastTaskSubject: lastTask ? safeStr(lastTask.Subject) : null,
      daysSinceLastTask,
      hasOpenTask: openTasks.length > 0,
      openTaskCount: openTasks.length,
      nextTaskSubject: nextOpenTask ? safeStr(nextOpenTask.Subject) : null,
      nextTaskDate: nextOpenTask?.ActivityDate || null,
      // Visit 정보
      lastVisitDate: vi?.lastVisitDate || null,
      nextVisitDate: vi?.nextVisitDate || null,
      daysSinceVisit: vi?.daysSinceVisit ?? null,
      bizDaysSinceVisit: vi?.bizDaysSinceVisit ?? null,
      visitCount: vi?.visitCount || 0,
    };
  });

  // 트래킹 상태 판정
  enriched.forEach(opp => {
    opp.trackingStatus = computeTrackingStatus(opp, opp.dDay);
  });

  // installHopeDate ASC 정렬 (이미 쿼리에서 정렬했지만 확인)
  enriched.sort((a, b) => a.installHopeDate.localeCompare(b.installHopeDate));

  // Summary
  const summary = {
    total: enriched.length,
    overdue: enriched.filter(o => o.dDay < 0).length,
    imminent: enriched.filter(o => o.dDay >= 0 && o.dDay <= 7).length,
    unmanaged: enriched.filter(o => o.trackingStatus === '위험').length,
    wellManaged: enriched.filter(o => o.trackingStatus === '양호').length,
    caution: enriched.filter(o => o.trackingStatus === '주의').length,
  };

  const result = {
    extractedAt: new Date().toISOString(),
    asOfDate: today.toISOString().slice(0, 10),
    summary,
    opportunities: enriched,
  };

  // 저장
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const filePath = path.join(DATA_DIR, 'install-tracking.json');
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2));

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ [설치 트래킹] 추출 완료 (${duration}s)`);
  console.log(`   전체: ${summary.total}건 | 초과: ${summary.overdue}건 | 7일이내: ${summary.imminent}건 | 위험: ${summary.unmanaged}건 | 양호: ${summary.wellManaged}건`);
  console.log(`   저장: ${filePath}\n`);

  return result;
}

/**
 * 트래킹 상태 판정
 * - 양호: 미완료 과업 있음 OR 최근과업 3일이내 OR 최근방문 7일이내
 * - 주의: 최근과업 4~7일 경과, 미완료과업 없음
 * - 위험: 최근과업 7일+ 경과(또는 없음), 미완료과업 없음, 최근방문 없음
 * - D-3 이내 + 양호 아님 → 위험 상향
 */
function computeTrackingStatus(opp, dDay) {
  const { hasOpenTask, daysSinceLastTask, daysSinceVisit } = opp;

  // 양호 조건
  if (hasOpenTask) return '양호';
  if (daysSinceLastTask !== null && daysSinceLastTask !== undefined && daysSinceLastTask <= 3) return '양호';
  if (daysSinceVisit !== null && daysSinceVisit !== undefined && daysSinceVisit <= 7) return '양호';

  // 주의 조건
  if (daysSinceLastTask !== null && daysSinceLastTask !== undefined && daysSinceLastTask <= 7) {
    if (dDay <= 3) return '위험';
    return '주의';
  }

  // 위험
  return '위험';
}

// ============================================
// 실행
// ============================================
if (require.main === module) {
  extractInstallTracking()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ 설치 트래킹 추출 실패:', err.message);
      process.exit(1);
    });
}

module.exports = { extractInstallTracking };
