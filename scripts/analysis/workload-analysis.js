/**
 * 인바운드 BO/FS 워크로드 분석
 *
 * 목적: 인당 리소스 부족 여부 판단
 *
 * 산출:
 * - BO: 1인당 일평균 Task, 담당 Open Opp 수, 1건당 터치 빈도, 21일+ 적체 비율
 * - FS: 1인당 일평균 방문 (Visit__c), Task, 담당 Open Opp 수, 7일내 미터치 비율
 *
 * 기준 기간: 최근 14 영업일 (워크로드 평균)
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ============================================
// Salesforce
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
    const res = await axios.get(nextUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    allRecords.push(...(res.data.records || []));
    nextUrl = res.data.nextRecordsUrl ? `${instanceUrl}${res.data.nextRecordsUrl}` : null;
  }
  return allRecords;
}

// ============================================
// 유틸
// ============================================
const AUTO_TASK_OWNER_ID = '0050800000NlJW2AAN'; // 자동 Task 제외
const EXCLUDED_NAMES = ['정건욱']; // 파트장 등 제외

function utcToKSTDateStr(utc) {
  const d = new Date(utc);
  d.setHours(d.getHours() + 9);
  return d.toISOString().slice(0, 10);
}

function isWeekday(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

function countWorkdays(startDate, endDate) {
  let count = 0;
  const d = new Date(startDate);
  while (d <= new Date(endDate)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function daysBetween(d1, d2) {
  return Math.floor((new Date(d2) - new Date(d1)) / (1000 * 60 * 60 * 24));
}

// ============================================
// 메인
// ============================================
async function main() {
  console.log('🚀 워크로드 분석 시작\n');
  const { accessToken, instanceUrl } = await getSalesforceToken();

  // 분석 기간 (CLI 인자 또는 기본값)
  const startStr = process.argv[2] || '2025-12-01';
  const endStr = process.argv[3] || '2026-03-31';
  const startUTC = new Date(startStr + 'T00:00:00+09:00').toISOString();
  const endUTC = new Date(endStr + 'T23:59:59+09:00').toISOString();
  const workdays = countWorkdays(startStr, endStr);

  console.log(`📅 분석 기간: ${startStr} ~ ${endStr} (영업일 ${workdays}일)\n`);

  // ============================================
  // 1. 인바운드 사용자 조회 (BO + FS)
  // ============================================
  console.log('👥 인바운드 사용자 조회...');
  const userQuery = `
    SELECT Id, Name, Department, Title, IsActive
    FROM User
    WHERE Department = '인바운드세일즈' AND IsActive = true
  `;
  const users = await soqlQueryAll(instanceUrl, accessToken, userQuery);
  console.log(`  → ${users.length}명`);

  // BO/FS 분류 (Title 또는 별도 매핑 — 우선 전체 보고 추후 분류)
  const userMap = {};
  users.forEach(u => {
    if (EXCLUDED_NAMES.includes(u.Name)) return;
    userMap[u.Id] = { id: u.Id, name: u.Name, title: u.Title || '', dept: u.Department };
  });
  console.log(`  → 제외 후 ${Object.keys(userMap).length}명 (제외: ${EXCLUDED_NAMES.join(', ')})`);

  // ============================================
  // 2. 최근 14일 Task (Owner = 인바운드 멤버)
  // ============================================
  console.log('\n📝 최근 14일 Task 조회...');
  const userIds = users.map(u => `'${u.Id}'`).join(',');
  const taskQuery = `
    SELECT Id, OwnerId, CreatedDate, WhatId, Subject, Status
    FROM Task
    WHERE OwnerId IN (${userIds})
      AND OwnerId != '${AUTO_TASK_OWNER_ID}'
      AND CreatedDate >= ${startUTC}
      AND CreatedDate < ${endUTC}
  `;
  const tasks = await soqlQueryAll(instanceUrl, accessToken, taskQuery);
  console.log(`  → ${tasks.length}건`);

  // ============================================
  // 3. 최근 14일 Visit__c (필드 방문)
  // ============================================
  console.log('\n🚗 최근 14일 Visit__c 조회...');
  const visitQuery = `
    SELECT Id, Opportunity__c, Opportunity__r.OwnerId, Opportunity__r.FieldUser__c,
           Visit_Status__c, IsVisitComplete__c, ConselStart__c, ConselEnd__c,
           VisitAssignmentDate__c, LocalInviteDate__c, CreatedDate
    FROM Visit__c
    WHERE CreatedDate >= ${startUTC}
      AND CreatedDate < ${endUTC}
  `;
  const visits = await soqlQueryAll(instanceUrl, accessToken, visitQuery);
  console.log(`  → ${visits.length}건`);

  // ============================================
  // 4. 기간 내 활성 Opportunity (생성 OR 마감이 기간 내)
  // ============================================
  console.log('\n📂 기간 내 활성 Opportunity 조회...');
  const oppQuery = `
    SELECT Id, Name, OwnerId, BOUser__c, FieldUser__c, StageName, CreatedDate, CloseDate, IsClosed, IsWon,
           fm_CompanyStatus__c
    FROM Opportunity
    WHERE (BOUser__c IN (${userIds}) OR FieldUser__c IN (${userIds}))
      AND ((CreatedDate >= ${startUTC} AND CreatedDate <= ${endUTC})
        OR (CloseDate >= ${startStr} AND CloseDate <= ${endStr})
        OR (IsClosed = false))
  `;
  const openOpps = await soqlQueryAll(instanceUrl, accessToken, oppQuery);
  console.log(`  → ${openOpps.length}건`);

  // ============================================
  // 5. 집계: BO 관점 (BOUser__c 기준)
  // ============================================
  console.log('\n📊 집계 중...\n');

  const boStats = {};
  const fsStats = {};

  openOpps.forEach(o => {
    if (o.BOUser__c && userMap[o.BOUser__c]) {
      if (!boStats[o.BOUser__c]) {
        boStats[o.BOUser__c] = { name: userMap[o.BOUser__c].name, assignedOpps: 0, won: 0, lost: 0, stillOpen: 0, tasks: 0, touchedOpps: 0 };
      }
      boStats[o.BOUser__c].assignedOpps++;
      if (o.IsClosed && o.IsWon) boStats[o.BOUser__c].won++;
      else if (o.IsClosed) boStats[o.BOUser__c].lost++;
      else boStats[o.BOUser__c].stillOpen++;
    }
    if (o.FieldUser__c && userMap[o.FieldUser__c]) {
      if (!fsStats[o.FieldUser__c]) {
        fsStats[o.FieldUser__c] = { name: userMap[o.FieldUser__c].name, assignedOpps: 0, won: 0, lost: 0, stillOpen: 0, tasks: 0, visits: 0, visitsCompleted: 0, touchedOpps: 0 };
      }
      fsStats[o.FieldUser__c].assignedOpps++;
      if (o.IsClosed && o.IsWon) fsStats[o.FieldUser__c].won++;
      else if (o.IsClosed) fsStats[o.FieldUser__c].lost++;
      else fsStats[o.FieldUser__c].stillOpen++;
    }
  });

  // Task 카운트 + 터치한 Opp 추적
  const boTouchedOpps = {};
  const fsTouchedOpps = {};
  tasks.forEach(t => {
    if (boStats[t.OwnerId]) {
      boStats[t.OwnerId].tasks++;
      if (t.WhatId) { (boTouchedOpps[t.OwnerId] ||= new Set()).add(t.WhatId); }
    }
    if (fsStats[t.OwnerId]) {
      fsStats[t.OwnerId].tasks++;
      if (t.WhatId) { (fsTouchedOpps[t.OwnerId] ||= new Set()).add(t.WhatId); }
    }
  });
  Object.keys(boTouchedOpps).forEach(uid => { if (boStats[uid]) boStats[uid].touchedOpps = boTouchedOpps[uid].size; });
  Object.keys(fsTouchedOpps).forEach(uid => { if (fsStats[uid]) fsStats[uid].touchedOpps = fsTouchedOpps[uid].size; });

  // Visit 카운트 (FieldUser 기준)
  visits.forEach(v => {
    const fieldUser = v.Opportunity__r?.FieldUser__c;
    if (fieldUser && fsStats[fieldUser]) {
      fsStats[fieldUser].visits++;
      if (v.IsVisitComplete__c) fsStats[fieldUser].visitsCompleted++;
    }
  });

  // ============================================
  // 6. 출력
  // ============================================
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  BO 워크로드');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('이름      담당Opp  CW(승)  Lost  미마감  Task   일Task  터치Opp  Task/Opp  커버율');

  const boSorted = Object.values(boStats).sort((a, b) => b.assignedOpps - a.assignedOpps);
  const boTableData = [];
  boSorted.forEach(s => {
    const dailyTask = (s.tasks / workdays).toFixed(1);
    const taskPerOpp = s.assignedOpps ? (s.tasks / s.assignedOpps).toFixed(1) : '0';
    const coverage = s.assignedOpps ? ((s.touchedOpps / s.assignedOpps) * 100).toFixed(0) : '0';
    boTableData.push({ name: s.name, assignedOpps: s.assignedOpps, won: s.won, lost: s.lost, stillOpen: s.stillOpen, tasks: s.tasks, dailyTask, touchedOpps: s.touchedOpps, taskPerOpp, coverage: coverage + '%' });
    console.log(`${s.name.padEnd(8, ' ')}  ${String(s.assignedOpps).padStart(6)}  ${String(s.won).padStart(6)}  ${String(s.lost).padStart(4)}  ${String(s.stillOpen).padStart(6)}  ${String(s.tasks).padStart(5)}  ${dailyTask.padStart(6)}  ${String(s.touchedOpps).padStart(7)}  ${taskPerOpp.padStart(8)}  ${(coverage + '%').padStart(6)}`);
  });

  const boAssignedList = boSorted.map(s => s.assignedOpps);
  const boTaskList = boSorted.map(s => s.tasks / workdays);
  const boCoverageList = boSorted.filter(s => s.assignedOpps).map(s => s.touchedOpps / s.assignedOpps * 100);
  console.log('\n  📊 BO 요약');
  console.log(`     인원: ${boSorted.length}명`);
  console.log(`     1인당 담당 Opp 중앙값: ${median(boAssignedList).toFixed(0)}건`);
  console.log(`     1인당 일평균 Task 중앙값: ${median(boTaskList).toFixed(1)}건`);
  console.log(`     커버율 중앙값: ${median(boCoverageList).toFixed(0)}%  (담당 Opp 중 한 번이라도 터치한 비율)`);

  // ============================================
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  FS 워크로드 (FieldUser__c 기준)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('이름      담당Opp  CW(승)  Lost  미마감  Task  일Task  완료Visit  일Visit  Visit/Opp');

  const fsSorted = Object.values(fsStats).sort((a, b) => b.assignedOpps - a.assignedOpps);
  const fsTableData = [];
  fsSorted.forEach(s => {
    const dailyTask = (s.tasks / workdays).toFixed(1);
    const dailyVisit = (s.visitsCompleted / workdays).toFixed(1);
    const visitPerOpp = s.assignedOpps ? (s.visitsCompleted / s.assignedOpps).toFixed(2) : '0';
    fsTableData.push({ name: s.name, assignedOpps: s.assignedOpps, won: s.won, lost: s.lost, stillOpen: s.stillOpen, tasks: s.tasks, dailyTask, visits: s.visits, visitsCompleted: s.visitsCompleted, dailyVisit, visitPerOpp });
    console.log(`${s.name.padEnd(8, ' ')}  ${String(s.assignedOpps).padStart(6)}  ${String(s.won).padStart(6)}  ${String(s.lost).padStart(4)}  ${String(s.stillOpen).padStart(6)}  ${String(s.tasks).padStart(4)}  ${dailyTask.padStart(6)}  ${String(s.visitsCompleted).padStart(9)}  ${dailyVisit.padStart(7)}  ${visitPerOpp.padStart(9)}`);
  });

  const fsAssignedList = fsSorted.map(s => s.assignedOpps);
  const fsVisitList = fsSorted.map(s => s.visitsCompleted / workdays);
  console.log('\n  📊 FS 요약');
  console.log(`     인원: ${fsSorted.length}명`);
  console.log(`     1인당 담당 Opp 중앙값: ${median(fsAssignedList).toFixed(0)}건`);
  console.log(`     1인당 일평균 완료방문 중앙값: ${median(fsVisitList).toFixed(1)}건`);

  // 저장
  const reportsDir = path.join(__dirname, '../../reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const out = {
    period: { start: startStr, end: endStr, workdays },
    bo: { rows: boTableData, summary: {
      headcount: boSorted.length,
      medianAssignedOpps: median(boAssignedList),
      medianDailyTasks: median(boTaskList),
      medianCoverage: median(boCoverageList),
    }},
    fs: { rows: fsTableData, summary: {
      headcount: fsSorted.length,
      medianAssignedOpps: median(fsAssignedList),
      medianDailyVisits: median(fsVisitList),
    }},
  };
  const outPath = path.join(reportsDir, `workload-${endStr}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n💾 저장: ${outPath}`);
}

main().catch(e => {
  console.error('❌', e.message);
  if (e.response?.data) console.error(JSON.stringify(e.response.data, null, 2));
  process.exit(1);
});
