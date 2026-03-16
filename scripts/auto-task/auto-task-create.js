/**
 * 방문 후 리터치 미진행 영업기회 자동 Task 생성
 *
 * 조건:
 * 1. 테이블오더 (신규) + 한국 + 인바운드팀
 * 2. 방문완료 후 영업일 3일 이상 경과
 * 3. 마지막 Task도 영업일 3일 이상 경과
 * 4. Open Task가 있으면 Skip
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const axios = require('axios');
const fs = require('fs');

// ============================================
// Salesforce 유틸
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

// ============================================
// 영업일 계산 (주말 제외)
// ============================================
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

function utcToKSTDateStr(utcDateStr) {
  if (!utcDateStr) return null;
  const d = new Date(utcDateStr);
  return new Date(d.getTime() + 9 * 3600000).toISOString().substring(0, 10);
}

// ============================================
// 설정
// ============================================
const INBOUND_TEAM = ['박효정', '정지영', '전수빈', '조현재'];
const BIZ_DAYS_THRESHOLD = 3; // 영업일 기준 경과일
const DRY_RUN = process.argv.includes('--dry-run');
const TASK_SUBJECT = '방문 후 리터치 미진행 - 확인 필요';

// ============================================
// 메인
// ============================================
async function main() {
  console.log('============================================');
  console.log('자동 Task 생성 스크립트');
  console.log(`모드: ${DRY_RUN ? '🔍 DRY RUN (생성하지 않음)' : '🚀 실행'}`);
  console.log(`조건: 방문후 영업일 ${BIZ_DAYS_THRESHOLD}일+ & 마지막Task 영업일 ${BIZ_DAYS_THRESHOLD}일+`);
  console.log('============================================\n');

  const { accessToken, instanceUrl } = await getSalesforceToken();
  console.log('✅ Salesforce 연결 성공\n');

  // KST 기준 오늘 날짜
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayStr = kstNow.toISOString().substring(0, 10);
  const today = new Date(todayStr);
  today.setHours(0, 0, 0, 0);
  console.log(`📅 기준일(KST): ${todayStr}\n`);

  // 1. 인바운드팀 User ID 조회
  const userQuery = `SELECT Id, Name FROM User WHERE IsActive = true AND Name IN ('${INBOUND_TEAM.join("','")}')`;
  const users = await soqlQuery(instanceUrl, accessToken, userQuery);
  const userMap = {};       // ID → Name
  const userIdByName = {};  // Name → ID (역매핑)
  (users.records || []).forEach(u => { userMap[u.Id] = u.Name; userIdByName[u.Name] = u.Id; });
  const userIds = Object.keys(userMap);
  console.log(`👥 인바운드팀 ${userIds.length}명: ${Object.values(userMap).join(', ')}`);

  // 2. 해당 팀의 오픈 영업기회 조회 (테이블오더 신규)
  const oppQuery = `SELECT Id, Name, StageName, BOUser__c, CreatedDate
    FROM Opportunity
    WHERE IsClosed = false
      AND BOUser__c IN ('${userIds.join("','")}')
      AND Name LIKE '%테이블오더%'
      AND Name LIKE '%(신규)%'
    ORDER BY CreatedDate ASC`;
  const opps = await soqlQueryAll(instanceUrl, accessToken, oppQuery);
  console.log(`📋 대상 영업기회: ${opps.length}건\n`);

  if (opps.length === 0) {
    console.log('대상 없음. 종료.');
    return;
  }

  // 3. 방문(Visit) 조회 - 방문완료 건
  const oppIds = opps.map(o => o.Id);
  let allVisits = [];
  for (let i = 0; i < oppIds.length; i += 200) {
    const batch = oppIds.slice(i, i + 200);
    const visitQuery = `SELECT Id, Opportunity__c, Visit_Status__c, LocalInviteDate__c, ConselStart__c, VisitAssignmentDate__c
      FROM Visit__c
      WHERE Opportunity__c IN ('${batch.join("','")}')
        AND Visit_Status__c = '방문완료'
      ORDER BY Opportunity__c, LocalInviteDate__c DESC`;
    const visits = await soqlQueryAll(instanceUrl, accessToken, visitQuery);
    allVisits = allVisits.concat(visits);
  }
  console.log(`🏠 방문완료 기록: ${allVisits.length}건`);

  // oppId별 마지막 방문일
  const lastVisitByOpp = {};
  allVisits.forEach(v => {
    const dateStr = v.LocalInviteDate__c || v.ConselStart__c || v.VisitAssignmentDate__c;
    if (!dateStr) return;
    const kstDate = utcToKSTDateStr(dateStr);
    if (!lastVisitByOpp[v.Opportunity__c] || kstDate > lastVisitByOpp[v.Opportunity__c]) {
      lastVisitByOpp[v.Opportunity__c] = kstDate;
    }
  });

  // 4. Task 조회 - 마지막 Task 날짜 + Open Task 유무
  let allTasks = [];
  for (let i = 0; i < oppIds.length; i += 200) {
    const batch = oppIds.slice(i, i + 200);
    const taskQuery = `SELECT Id, WhatId, Subject, Status, ActivityDate, CreatedDate
      FROM Task
      WHERE WhatId IN ('${batch.join("','")}')
      ORDER BY WhatId, CreatedDate DESC`;
    const tasks = await soqlQueryAll(instanceUrl, accessToken, taskQuery);
    allTasks = allTasks.concat(tasks);
  }
  console.log(`📝 Task 기록: ${allTasks.length}건\n`);

  // oppId별 마지막Task일, Open Task 유무
  const taskInfoByOpp = {};
  allTasks.forEach(t => {
    const oppId = t.WhatId;
    if (!taskInfoByOpp[oppId]) {
      taskInfoByOpp[oppId] = { lastTaskDate: null, hasOpenTask: false };
    }
    // 마지막 Task 날짜 (CreatedDate 기준)
    const taskDate = utcToKSTDateStr(t.CreatedDate);
    if (!taskInfoByOpp[oppId].lastTaskDate || taskDate > taskInfoByOpp[oppId].lastTaskDate) {
      taskInfoByOpp[oppId].lastTaskDate = taskDate;
    }
    // Open Task 유무
    if (t.Status === 'Open' || t.Status === 'Not Started') {
      taskInfoByOpp[oppId].hasOpenTask = true;
    }
  });

  // 5. 조건 필터링
  const candidates = [];
  const skipped = { noVisit: 0, visitOk: 0, taskRecent: 0, hasOpenTask: 0 };

  opps.forEach(o => {
    const lastVisit = lastVisitByOpp[o.Id];
    const taskInfo = taskInfoByOpp[o.Id] || { lastTaskDate: null, hasOpenTask: false };

    // 방문 없으면 Skip
    if (!lastVisit) { skipped.noVisit++; return; }

    // 방문 후 영업일 계산
    const bizDaysSinceVisit = countBizDays(new Date(lastVisit), today);
    if (bizDaysSinceVisit < BIZ_DAYS_THRESHOLD) { skipped.visitOk++; return; }

    // 마지막 Task 영업일 계산
    const bizDaysSinceTask = taskInfo.lastTaskDate ? countBizDays(new Date(taskInfo.lastTaskDate), today) : 999;
    if (bizDaysSinceTask < BIZ_DAYS_THRESHOLD) { skipped.taskRecent++; return; }

    // Open Task 있으면 Skip
    if (taskInfo.hasOpenTask) { skipped.hasOpenTask++; return; }

    candidates.push({
      oppId: o.Id,
      name: o.Name,
      stageName: o.StageName,
      boUser: userMap[o.BOUser__c] || o.BOUser__c,
      boUserId: o.BOUser__c,
      lastVisitDate: lastVisit,
      bizDaysSinceVisit,
      lastTaskDate: taskInfo.lastTaskDate,
      bizDaysSinceTask,
    });
  });

  console.log('============================================');
  console.log('필터링 결과');
  console.log('============================================');
  console.log(`  방문 없음 (Skip): ${skipped.noVisit}건`);
  console.log(`  방문 ${BIZ_DAYS_THRESHOLD}일 미만 (Skip): ${skipped.visitOk}건`);
  console.log(`  Task 최근 (Skip): ${skipped.taskRecent}건`);
  console.log(`  Open Task 있음 (Skip): ${skipped.hasOpenTask}건`);
  console.log(`  ✅ Task 생성 대상: ${candidates.length}건`);
  console.log();

  if (candidates.length === 0) {
    console.log('생성 대상 없음. 종료.');
    return;
  }

  // 담당자별 그룹핑 출력
  const byBO = {};
  candidates.forEach(c => {
    if (!byBO[c.boUser]) byBO[c.boUser] = [];
    byBO[c.boUser].push(c);
  });

  Object.entries(byBO).sort((a, b) => b[1].length - a[1].length).forEach(([bo, list]) => {
    console.log(`=== ${bo} (${list.length}건) ===`);
    list.forEach(c => {
      console.log(`  ${c.name} | ${c.stageName} | 방문후 영업일${c.bizDaysSinceVisit}일 | Task후 영업일${c.bizDaysSinceTask}일`);
    });
    console.log();
  });

  // 6. Task 생성
  if (DRY_RUN) {
    console.log('🔍 DRY RUN 모드 — Task를 생성하지 않습니다.');
    console.log(`실제 생성하려면: node auto-task-create.js`);
    return;
  }

  console.log(`🚀 ${candidates.length}건 Task 생성 시작...`);
  let created = 0;
  let failed = 0;

  for (const c of candidates) {
    try {
      const taskData = {
        WhatId: c.oppId,
        OwnerId: c.boUserId,
        Subject: TASK_SUBJECT,
        Status: 'Open',
        ActivityDate: todayStr,
      };

      const res = await axios.post(
        `${instanceUrl}/services/data/v59.0/sobjects/Task`,
        taskData,
        { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      );

      if (res.data.success) {
        created++;
        console.log(`  ✅ ${c.name} (${c.boUser}) → Task ID: ${res.data.id}`);
      }
    } catch (e) {
      failed++;
      console.error(`  ❌ ${c.name}: ${e.response?.data?.[0]?.message || e.message}`);
    }
  }

  console.log(`\n============================================`);
  console.log(`완료: 생성 ${created}건 / 실패 ${failed}건`);
  console.log(`============================================`);
}

main().catch(e => {
  console.error('❌ Error:', e.response?.data || e.message);
  process.exit(1);
});
