require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

// ============================================
// 공통 유틸리티
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

// 날짜 유틸
function utcToKSTDateStr(utcDateStr) {
  if (!utcDateStr) return null;
  const d = new Date(utcDateStr);
  return new Date(d.getTime() + 9 * 3600000).toISOString().substring(0, 10);
}

// 영업일 계산 (주말 제외)
function countBizDays(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  if (end <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  cur.setDate(cur.getDate() + 1); // 다음 날부터 카운트
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function kstToUTC(kstDateStr, isStart = true) {
  const [year, month, day] = kstDateStr.split('-').map(Number);
  if (isStart) {
    return new Date(Date.UTC(year, month - 1, day - 1, 15, 0, 0)).toISOString();
  } else {
    return new Date(Date.UTC(year, month - 1, day, 14, 59, 59)).toISOString();
  }
}

function getMonthRange(targetMonth) {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);

  let startDate, endDate, periodLabel;
  if (targetMonth) {
    const [year, month] = targetMonth.split('-').map(Number);
    startDate = `${targetMonth}-01`;
    // 어제 or 월말 중 작은 값
    const lastDay = new Date(year, month, 0).getDate();
    const kstYear = kstNow.getUTCFullYear();
    const kstMonth = kstNow.getUTCMonth() + 1;
    const kstDate = kstNow.getUTCDate();
    if (year === kstYear && month === kstMonth) {
      // 이번달이면 어제까지
      const yesterday = kstDate - 1;
      endDate = `${targetMonth}-${String(yesterday).padStart(2, '0')}`;
      periodLabel = `${year}년 ${month}월 (${yesterday}일까지)`;
    } else {
      endDate = `${targetMonth}-${String(lastDay).padStart(2, '0')}`;
      periodLabel = `${year}년 ${month}월`;
    }
  } else {
    const kstYear = kstNow.getUTCFullYear();
    const kstMonth = kstNow.getUTCMonth() + 1;
    const kstDate = kstNow.getUTCDate();
    const yesterday = kstDate - 1;
    const monthStr = `${kstYear}-${String(kstMonth).padStart(2, '0')}`;
    startDate = `${monthStr}-01`;
    endDate = `${monthStr}-${String(yesterday).padStart(2, '0')}`;
    periodLabel = `${kstYear}년 ${kstMonth}월 (${yesterday}일까지)`;
    targetMonth = monthStr;
  }
  return { startDate, endDate, periodLabel, targetMonth };
}

function parseKSTDateTime(kstDateStr) {
  if (!kstDateStr) return null;
  const [datePart, timePart] = kstDateStr.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = (timePart || '00:00:00').split(':').map(Number);
  return { year, month, day, hour, minute, second, dayOfWeek: new Date(year, month - 1, day).getDay(), dateStr: datePart };
}

// MQL 판정
const MQL_EXCLUDE_LOSS_REASONS = [
  '오생성', '오인입', '중복유입', '추가설치',
  '마케팅 전달', '전략실 전달', '파트너스 전달',
  '프랜차이즈본사문의', '기고객상담', '부서이관'
];

function isMQL(lead) {
  if (lead.Status === '배정대기') return false;
  if (!lead.LossReason__c) return true;
  return !MQL_EXCLUDE_LOSS_REASONS.some(reason => lead.LossReason__c.includes(reason));
}

// FRT 구간 분류
function classifyFRTBucket(frtMinutes) {
  if (frtMinutes === null) return 'NO_TASK';
  if (frtMinutes <= 10) return '10분 이내';
  if (frtMinutes <= 20) return '10~20분';
  if (frtMinutes <= 30) return '20~30분';
  if (frtMinutes <= 60) return '30~60분';
  if (frtMinutes <= 120) return '1~2시간';
  if (frtMinutes <= 240) return '2~4시간';
  if (frtMinutes <= 480) return '4~8시간';
  return '8시간 초과';
}

function classifyAgeBucket(ageInDays) {
  if (ageInDays <= 3) return 'within3';
  if (ageInDays <= 7) return 'day4to7';
  if (ageInDays <= 14) return 'over7';
  if (ageInDays <= 30) return 'over14';
  return 'over30';
}

// 영업일(평일) 필터
function isWeekday(dateStr) {
  const day = new Date(dateStr).getDay();
  return day !== 0 && day !== 6;
}

// 기간 내 영업일 수 계산
function countWeekdays(startDate, endDate) {
  let count = 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
  }
  return count;
}

// 자동발송 Task 제외용 OwnerId (inbound-sales-report.js 기준)
const AUTO_TASK_OWNER_ID = '005IR00000FgbZtYAJ';

// ============================================
// 인바운드 데이터 수집
// ============================================
async function collectInboundData(instanceUrl, accessToken, startDate, endDate) {
  const startUTC = kstToUTC(startDate, true);
  const endUTC = kstToUTC(endDate, false);
  console.log(`\n📥 인바운드 데이터 수집 (${startDate} ~ ${endDate})`);

  // 1. 인바운드세일즈 User 조회
  const userQuery = `SELECT Id, Name FROM User WHERE Department = '인바운드세일즈' AND IsActive = true`;
  const usersResult = await soqlQuery(instanceUrl, accessToken, userQuery);
  const users = usersResult.records;
  const userIds = users.map(u => `'${u.Id}'`).join(',');
  const userNameMap = {};
  users.forEach(u => { userNameMap[u.Id] = u.Name; });
  console.log(`  👥 인바운드세일즈 인원: ${users.length}명`);

  // 2. Lead 조회 (인바운드 필터)
  const leadQuery = `
    SELECT Id, CreatedDate, CreatedTime__c, OwnerId, Name, Status, LossReason__c, LossReason_Contract__c, LossReasonDetail__c, ConvertedOpportunityId, Company, LeadSource
    FROM Lead
    WHERE CreatedDate >= ${startUTC}
      AND CreatedDate < ${endUTC}
      AND (ServiceType__c = '테이블오더' OR ServiceType__c = '티오더 웨이팅')
      AND (LossReason__c = NULL OR LossReason__c != '오생성')
      AND (LeadSource = NULL OR LeadSource != '아웃바운드')
      AND PartnerName__c = NULL
      AND (StoreType__c = NULL OR StoreType__c != '프랜차이즈제휴')
  `.replace(/\s+/g, ' ').trim();
  const leadsRecords = await soqlQueryAll(instanceUrl, accessToken, leadQuery);
  const leads = leadsRecords.filter(l => !l.Company || !l.Company.toLowerCase().includes('test'));
  console.log(`  📋 인바운드 Lead: ${leads.length}건`);

  // 3. Opportunity 조회
  const convertedOppIds = leads.filter(l => l.ConvertedOpportunityId).map(l => l.ConvertedOpportunityId);
  let opportunities = [];
  if (convertedOppIds.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < convertedOppIds.length; i += chunkSize) {
      const chunk = convertedOppIds.slice(i, i + chunkSize);
      const oppIds = chunk.map(id => `'${id}'`).join(',');
      const oppQuery = `SELECT Id, Name, Loss_Reason__c, Loss_Reason_Oppt__c, Loss_Reason_Oppt_2depth__c, Loss_Reason_Detail__c, StageName, FieldUser__c, BOUser__c, AgeInDays, SalesInviteDate__c, CreatedDate, CloseDate, InstallHopeDate__c, RecordType.Name, fm_CompanyStatus__c, (SELECT Id FROM ContractOpportunities__r) FROM Opportunity WHERE Id IN (${oppIds})`;
      const oppResult = await soqlQuery(instanceUrl, accessToken, oppQuery);
      opportunities = opportunities.concat(oppResult.records);
    }
  }
  console.log(`  📊 인바운드 Opportunity: ${opportunities.length}건`);

  // Field/BO User 정보 조회
  const fieldBoUserIds = new Set();
  opportunities.forEach(opp => {
    if (opp.FieldUser__c) fieldBoUserIds.add(opp.FieldUser__c);
    if (opp.BOUser__c) fieldBoUserIds.add(opp.BOUser__c);
  });
  if (fieldBoUserIds.size > 0) {
    const fbUserIds = [...fieldBoUserIds].map(id => `'${id}'`).join(',');
    const fbUserQuery = `SELECT Id, Name FROM User WHERE Id IN (${fbUserIds})`;
    const fbUsersResult = await soqlQuery(instanceUrl, accessToken, fbUserQuery);
    fbUsersResult.records.forEach(u => { userNameMap[u.Id] = u.Name; });
  }

  // 4. Quote 조회
  let quotes = [];
  if (convertedOppIds.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < convertedOppIds.length; i += chunkSize) {
      const chunk = convertedOppIds.slice(i, i + chunkSize);
      const oppIds = chunk.map(id => `'${id}'`).join(',');
      const quoteQuery = `SELECT Id, OpportunityId, CreatedDate FROM Quote WHERE OpportunityId IN (${oppIds}) ORDER BY OpportunityId, CreatedDate DESC`;
      const quoteResult = await soqlQuery(instanceUrl, accessToken, quoteQuery);
      quotes = quotes.concat(quoteResult.records);
    }
  }
  console.log(`  📝 Quote: ${quotes.length}건`);

  // 5. Lead별 첫 Task 조회 (자동발송 제외)
  let leadTasks = [];
  if (leads.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < leads.length; i += chunkSize) {
      const chunk = leads.slice(i, i + chunkSize);
      const leadIds = chunk.map(l => `'${l.Id}'`).join(',');
      const taskQuery = `SELECT Id, Lead__c, OwnerId, CreatedDate, Subject, Status, ActivityDate, Description FROM Task WHERE Lead__c IN (${leadIds}) AND OwnerId != '${AUTO_TASK_OWNER_ID}' ORDER BY Lead__c, CreatedDate ASC`;
      const tasksRecords = await soqlQueryAll(instanceUrl, accessToken, taskQuery);
      leadTasks = leadTasks.concat(tasksRecords);
    }
  }
  console.log(`  📞 Lead Task (FRT): ${leadTasks.length}건`);

  // 6. 담당자별 전체 Task 조회 (일별 생산량)
  const dailyTaskQuery = `SELECT Id, OwnerId, CreatedDate FROM Task WHERE OwnerId IN (${userIds}) AND CreatedDate >= ${startUTC} AND CreatedDate < ${endUTC}`;
  const dailyTasks = await soqlQueryAll(instanceUrl, accessToken, dailyTaskQuery);
  console.log(`  📝 Daily Task: ${dailyTasks.length}건`);

  // 7. Opportunity별 Task 조회 (리터치 분석)
  let oppTasks = [];
  if (convertedOppIds.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < convertedOppIds.length; i += chunkSize) {
      const chunk = convertedOppIds.slice(i, i + chunkSize);
      const oppIds = chunk.map(id => `'${id}'`).join(',');
      const oppTaskQuery = `SELECT Id, WhatId, Subject, Description, Status, ActivityDate, CreatedDate FROM Task WHERE WhatId IN (${oppIds}) ORDER BY WhatId, CreatedDate`;
      const oppTaskResult = await soqlQuery(instanceUrl, accessToken, oppTaskQuery);
      oppTasks = oppTasks.concat(oppTaskResult.records);
    }
  }
  console.log(`  📞 Opp Task (리터치): ${oppTasks.length}건`);

  // 8. OBS Lead 조회 (Field Sales 담당자가 생성한 Lead)
  const fieldUserIds = [...new Set(opportunities.filter(o => o.FieldUser__c).map(o => o.FieldUser__c))];
  let obsLeads = [];
  if (fieldUserIds.length > 0) {
    const fieldIds = fieldUserIds.map(id => `'${id}'`).join(',');
    const obsQuery = `
      SELECT Id, OwnerId, CreatedDate
      FROM Lead
      WHERE CreatedDate >= ${startUTC}
        AND CreatedDate < ${endUTC}
        AND OwnerId IN (${fieldIds})
    `.replace(/\s+/g, ' ').trim();
    obsLeads = await soqlQueryAll(instanceUrl, accessToken, obsQuery);
  }
  console.log(`  🏃 OBS Lead (Field 생성): ${obsLeads.length}건`);

  // 9. 이월 포함 CW: CloseDate가 이번 달인 전체 인바운드 Opportunity (이전 달 생성 Lead 포함)
  const cwOppQuery = `
    SELECT Id, Name, StageName, FieldUser__c, BOUser__c, CloseDate, CreatedDate, AgeInDays, Loss_Reason__c, InstallHopeDate__c, (SELECT Id FROM ContractOpportunities__r)
    FROM Opportunity
    WHERE StageName IN ('Closed Won', 'Closed Lost')
      AND CloseDate >= ${startDate}
      AND CloseDate <= ${endDate}
      AND (FieldUser__c != NULL OR BOUser__c != NULL)
  `.replace(/\s+/g, ' ').trim();
  const cwOppsResult = await soqlQueryAll(instanceUrl, accessToken, cwOppQuery);
  // 이번 달 Lead에서 온 Opp ID 세트 (중복 제거용)
  const thisMonthOppIds = new Set(convertedOppIds);
  // 이월 Opp = CloseDate가 이번 달이지만 이번 달 Lead에서 온 것이 아닌 것
  const carryoverOpps = cwOppsResult.filter(o => !thisMonthOppIds.has(o.Id));
  console.log(`  📊 이월 포함 CW/CL (CloseDate 기준): ${cwOppsResult.length}건 (이월분: ${carryoverOpps.length}건)`);

  // 이월 Opp의 Field/BO User 이름 매핑
  const carryoverUserIds = new Set();
  carryoverOpps.forEach(o => {
    if (o.FieldUser__c) carryoverUserIds.add(o.FieldUser__c);
    if (o.BOUser__c) carryoverUserIds.add(o.BOUser__c);
  });
  const newUserIds = [...carryoverUserIds].filter(id => !userNameMap[id]);
  if (newUserIds.length > 0) {
    const ids = newUserIds.map(id => `'${id}'`).join(',');
    const uResult = await soqlQuery(instanceUrl, accessToken, `SELECT Id, Name FROM User WHERE Id IN (${ids})`);
    uResult.records.forEach(u => { userNameMap[u.Id] = u.Name; });
  }

  // 10. 계약 데이터 (Contract__c) — 신규/추가설치 구분의 정확한 소스
  const [cYear, cMonth] = startDate.split('-').map(Number);
  const nextMonth = cMonth === 12 ? `${cYear + 1}-01-01` : `${cYear}-${String(cMonth + 1).padStart(2, '0')}-01`;
  const contractQuery = `
    SELECT Id, Opportunity__r.RecordType.Name, Opportunity__r.BOUser__c, Opportunity__r.BOUser__r.Name,
           Opportunity__r.FieldUser__c, Opportunity__r.FieldUser__r.Name,
           Opportunity__r.Owner_Department__c, Opportunity__r.Id,
           Opportunity__r.Account.Name, Opportunity__r.Account.BranchName__c,
           Opportunity__r.TotalNumberofEveryTablet__c, ContractDateStart__c
    FROM Contract__c
    WHERE Opportunity__c != NULL
      AND ContractDateStart__c >= ${startDate}
      AND ContractDateStart__c < ${nextMonth}
      AND (ContractStatus__c = '계약서명완료' OR ContractStatus__c = '계약서명대기')
      AND RecordTypeId != '012TJ000002eJu1YAE'
  `.replace(/\s+/g, ' ').trim();
  const contractsRaw = await soqlQueryAll(instanceUrl, accessToken, contractQuery);
  const contracts = contractsRaw.map(c => ({
    id: c.Id,
    recordTypeName: c.Opportunity__r?.RecordType?.Name || '',
    boUserId: c.Opportunity__r?.BOUser__c || null,
    boUser: c.Opportunity__r?.BOUser__r?.Name || null,
    fieldUserId: c.Opportunity__r?.FieldUser__c || null,
    fieldUser: c.Opportunity__r?.FieldUser__r?.Name || null,
    ownerDept: c.Opportunity__r?.Owner_Department__c || null,
    oppId: c.Opportunity__r?.Id || null,
    accountName: c.Opportunity__r?.Account?.Name || '',
    branchName: c.Opportunity__r?.Account?.BranchName__c || '',
    tabletQty: c.Opportunity__r?.TotalNumberofEveryTablet__c || 0,
    contractStart: c.ContractDateStart__c,
  }));
  console.log(`  📝 계약 (ContractDateStart 기준): ${contracts.length}건`);

  // 11. Visit__c 조회 (진행중 Opp의 방문 여부/일자)
  let visits = [];
  if (convertedOppIds.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < convertedOppIds.length; i += chunkSize) {
      const chunk = convertedOppIds.slice(i, i + chunkSize);
      const oppIds = chunk.map(id => `'${id}'`).join(',');
      const visitQuery = `SELECT Id, Opportunity__c, Visit_Status__c, LocalInviteDate__c, ConselStart__c, ConselEnd__c, Realtime__c, VisitAssignmentDate__c, IsVisitComplete__c FROM Visit__c WHERE Opportunity__c IN (${oppIds}) ORDER BY Opportunity__c, ConselStart__c DESC`;
      const visitResult = await soqlQuery(instanceUrl, accessToken, visitQuery);
      visits = visits.concat(visitResult.records);
    }
  }
  console.log(`  🏠 Visit: ${visits.length}건`);

  return { leads, opportunities, quotes, leadTasks, dailyTasks, oppTasks, obsLeads, users, userNameMap, fieldUserIds, carryoverOpps, allClosedOpps: cwOppsResult, contracts, visits };
}

// ============================================
// OpportunityFieldHistory 기반 CW/CL 변경 이력 수집
// ============================================
async function fetchStageChangeHistory(instanceUrl, accessToken, startDate, endDate, existingUserNameMap = {}) {
  console.log('\n📜 OpportunityFieldHistory 수집...');
  const startUTC = kstToUTC(startDate, true);
  const endUTC = kstToUTC(endDate, false);

  // 1) 이번 달 StageName 변경 이력 전체 조회
  const histQuery = `
    SELECT OpportunityId, Field, OldValue, NewValue, CreatedDate
    FROM OpportunityFieldHistory
    WHERE Field = 'StageName'
      AND CreatedDate >= ${startUTC}
      AND CreatedDate <= ${endUTC}
    ORDER BY CreatedDate ASC
  `.replace(/\s+/g, ' ').trim();
  const histRecords = await soqlQueryAll(instanceUrl, accessToken, histQuery);
  console.log(`  전체 StageName 변경: ${histRecords.length}건`);

  // 2) CW/CL만 필터 + Opp별 첫 번째 변경만 (중복 제거)
  const cwclMap = {}; // oppId → { stageName, changeDate }
  histRecords.forEach(r => {
    if (r.NewValue !== 'Closed Won' && r.NewValue !== 'Closed Lost') return;
    if (cwclMap[r.OpportunityId]) return; // 이미 기록된 Opp → 첫 번째 변경만
    const kstDate = utcToKSTDateStr(r.CreatedDate);
    cwclMap[r.OpportunityId] = {
      oppId: r.OpportunityId,
      stageName: r.NewValue,
      isCW: r.NewValue === 'Closed Won',
      isCL: r.NewValue === 'Closed Lost',
      oldStage: r.OldValue,
      changeDate: kstDate, // KST 일자
      changeTimestamp: r.CreatedDate, // 원본 UTC
    };
  });
  const cwclList = Object.values(cwclMap);
  const cwCount = cwclList.filter(x => x.isCW).length;
  const clCount = cwclList.filter(x => x.isCL).length;
  console.log(`  CW/CL 변경 (고유 Opp): ${cwclList.length}건 (CW: ${cwCount}, CL: ${clCount})`);

  if (cwclList.length === 0) return [];

  // 3) 해당 Opp 상세 조회 (BOUser, FieldUser, RecordType 등)
  const oppIds = cwclList.map(x => x.oppId);
  const chunkSize = 200;
  let oppDetails = [];
  for (let i = 0; i < oppIds.length; i += chunkSize) {
    const chunk = oppIds.slice(i, i + chunkSize);
    const ids = chunk.map(id => `'${id}'`).join(',');
    const oppQuery = `
      SELECT Id, Name, StageName, BOUser__c, FieldUser__c, CloseDate, CreatedDate,
             RecordType.Name, Owner.Name, OwnerId, Owner_Department__c,
             Account.Name, Account.BranchName__c, fm_CompanyStatus__c, InstallHopeDate__c
      FROM Opportunity WHERE Id IN (${ids})
    `.replace(/\s+/g, ' ').trim();
    const res = await soqlQuery(instanceUrl, accessToken, oppQuery);
    oppDetails = oppDetails.concat(res.records || []);
  }

  // 4) User 이름 매핑 보충
  const userNameMap = { ...existingUserNameMap };
  const newUserIds = new Set();
  oppDetails.forEach(o => {
    if (o.BOUser__c && !userNameMap[o.BOUser__c]) newUserIds.add(o.BOUser__c);
    if (o.FieldUser__c && !userNameMap[o.FieldUser__c]) newUserIds.add(o.FieldUser__c);
  });
  if (newUserIds.size > 0) {
    const ids = [...newUserIds].map(id => `'${id}'`).join(',');
    const uResult = await soqlQuery(instanceUrl, accessToken, `SELECT Id, Name FROM User WHERE Id IN (${ids})`);
    uResult.records.forEach(u => { userNameMap[u.Id] = u.Name; });
  }

  // 5) History + Opp 상세 병합
  const oppMap = {};
  oppDetails.forEach(o => { oppMap[o.Id] = o; });

  const enriched = cwclList.map(h => {
    const opp = oppMap[h.oppId] || {};
    return {
      ...h,
      oppName: opp.Name || '',
      boUserId: opp.BOUser__c || null,
      boUserName: opp.BOUser__c ? (userNameMap[opp.BOUser__c] || opp.BOUser__c) : null,
      fieldUserId: opp.FieldUser__c || null,
      fieldUserName: opp.FieldUser__c ? (userNameMap[opp.FieldUser__c] || opp.FieldUser__c) : null,
      recordTypeName: opp.RecordType?.Name || '',
      ownerDept: opp.Owner_Department__c || '',
      ownerName: opp.Owner?.Name || '',
      accountName: opp.Account?.Name || '',
      branchName: opp.Account?.BranchName__c || '',
      companyStatus: opp.fm_CompanyStatus__c || '',
      closeDate: opp.CloseDate,
      installHopeDate: opp.InstallHopeDate__c || null,
      oppCreatedDate: opp.CreatedDate,
    };
  });

  console.log(`  ✅ History CW/CL 데이터 완성: ${enriched.length}건`);
  return enriched;
}

// ============================================
// 채널 데이터 수집
// ============================================
async function collectChannelData(instanceUrl, accessToken, startDate, endDate, targetMonth) {
  const startUTC = kstToUTC(startDate, true);
  const endUTC = kstToUTC(endDate, false);
  console.log(`\n📥 채널 데이터 수집 (${startDate} ~ ${endDate})`);

  // 1. 채널세일즈팀 User 조회
  const userQuery = `SELECT Id, Name FROM User WHERE Department = '채널세일즈팀' AND IsActive = true`;
  const usersResult = await soqlQuery(instanceUrl, accessToken, userQuery);
  const users = usersResult.records;
  const userNameMap = {};
  users.forEach(u => { userNameMap[u.Id] = u.Name; });
  console.log(`  👥 채널세일즈팀 인원: ${users.length}명`);

  // 2. 채널 Lead 조회 (TM용 - 인바운드 반대 조건)
  const channelLeadQuery = `
    SELECT Id, CreatedDate, CreatedTime__c, OwnerId, Name, Status, LossReason__c, LossReason_Contract__c, LossReasonDetail__c, ConvertedOpportunityId, Company, LeadSource, PartnerName__c, BrandName__c
    FROM Lead
    WHERE CreatedDate >= ${startUTC}
      AND CreatedDate < ${endUTC}
      AND (ServiceType__c = '테이블오더' OR ServiceType__c = '티오더 웨이팅')
      AND (LossReason__c = NULL OR LossReason__c != '오생성')
      AND (PartnerName__c != NULL OR StoreType__c = '프랜차이즈제휴')
  `.replace(/\s+/g, ' ').trim();
  const channelLeadsRecords = await soqlQueryAll(instanceUrl, accessToken, channelLeadQuery);
  const channelLeads = channelLeadsRecords.filter(l => !l.Company || !l.Company.toLowerCase().includes('test'));
  console.log(`  📋 채널 Lead: ${channelLeads.length}건`);

  // 2-1. 기간 내 전환된 채널 Lead 조회 (ConvertedDate 기준 — 방문배정 카운트용)
  // Lead 생성일이 아닌 실제 전환일 기준으로 카운트하기 위해 별도 쿼리
  const convertedLeadQuery = `
    SELECT Id, Name, Company, CreatedDate, ConvertedDate, ConvertedOpportunityId, OwnerId, Owner.Name
    FROM Lead
    WHERE ConvertedDate >= ${startDate}
      AND ConvertedDate <= ${endDate}
      AND IsConverted = true
      AND (ServiceType__c = '테이블오더' OR ServiceType__c = '티오더 웨이팅')
      AND (LossReason__c = NULL OR LossReason__c != '오생성')
      AND (PartnerName__c != NULL OR StoreType__c = '프랜차이즈제휴')
  `.replace(/\s+/g, ' ').trim();
  const convertedLeadsRaw = await soqlQueryAll(instanceUrl, accessToken, convertedLeadQuery);
  const channelConvertedLeads = convertedLeadsRaw.filter(l => !l.Company || !l.Company.toLowerCase().includes('test'));
  console.log(`  🔄 기간 내 전환 Lead (ConvertedDate): ${channelConvertedLeads.length}건`);

  // 3. 채널 Lead별 첫 Task 조회 (FRT용)
  let channelLeadTasks = [];
  if (channelLeads.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < channelLeads.length; i += chunkSize) {
      const chunk = channelLeads.slice(i, i + chunkSize);
      const leadIds = chunk.map(l => `'${l.Id}'`).join(',');
      const taskQuery = `SELECT Id, Lead__c, OwnerId, CreatedDate, Subject, Status, ActivityDate, Description FROM Task WHERE Lead__c IN (${leadIds}) AND OwnerId != '${AUTO_TASK_OWNER_ID}' ORDER BY Lead__c, CreatedDate ASC`;
      const chTaskRecords = await soqlQueryAll(instanceUrl, accessToken, taskQuery);
      channelLeadTasks = channelLeadTasks.concat(chTaskRecords);
    }
  }
  console.log(`  📞 채널 Lead Task (FRT): ${channelLeadTasks.length}건`);

  // 4. LeadSource 기반 채널 Lead 조회 (AM용 - 일별 리드 확보 수)
  const sourceLeadQuery = `
    SELECT Id, Name, Company, Status, PartnerName__c, BrandName__c, LeadSource, CreatedDate, OwnerId, Owner.Name, ConvertedOpportunityId, IsConverted, ConvertedDate
    FROM Lead
    WHERE LeadSource IN ('파트너사 소개', '프랜차이즈소개')
      AND CreatedDate >= ${startUTC}
      AND CreatedDate < ${endUTC}
    ORDER BY CreatedDate DESC
  `.replace(/\s+/g, ' ').trim();
  const sourceLeads = await soqlQueryAll(instanceUrl, accessToken, sourceLeadQuery);
  const partnerSourceLeads = sourceLeads.filter(l => l.LeadSource === '파트너사 소개');
  const franchiseSourceLeads = sourceLeads.filter(l => l.LeadSource === '프랜차이즈소개');
  console.log(`  📋 LeadSource 기반 - 파트너사: ${partnerSourceLeads.length}건, 프랜차이즈: ${franchiseSourceLeads.length}건`);

  // 5. 파트너사 Account 조회
  const partnerQuery = `
    SELECT Id, Name, OwnerId, Owner.Name, fm_AccountType__c, Progress__c, MOUstartdate__c, MOUenddate__c, CreatedDate
    FROM Account
    WHERE fm_AccountType__c = '파트너사'
    ORDER BY Name
  `.replace(/\s+/g, ' ').trim();
  const partners = await soqlQueryAll(instanceUrl, accessToken, partnerQuery);
  console.log(`  🏢 파트너사: ${partners.length}건`);

  // 6. 프랜차이즈 본사 Account 조회
  const hqQuery = `
    SELECT Id, Name, OwnerId, Owner.Name, fm_AccountType__c, Progress__c, MOUstartdate__c, MOUenddate__c, CreatedDate
    FROM Account
    WHERE fm_AccountType__c = '프랜차이즈본사'
    ORDER BY Name
  `.replace(/\s+/g, ' ').trim();
  const franchiseHQAccounts = await soqlQueryAll(instanceUrl, accessToken, hqQuery);
  console.log(`  🏢 프랜차이즈 본사: ${franchiseHQAccounts.length}건`);

  // 7. 프랜차이즈 브랜드 Account 조회
  const brandQuery = `
    SELECT Id, Name, OwnerId, Owner.Name, fm_AccountType__c, Progress__c, MOUstartdate__c, MOUenddate__c, FRHQ__c, CreatedDate
    FROM Account
    WHERE fm_AccountType__c = '브랜드'
    ORDER BY Name
  `.replace(/\s+/g, ' ').trim();
  const franchiseBrands = await soqlQueryAll(instanceUrl, accessToken, brandQuery);
  console.log(`  🏷️ 프랜차이즈 브랜드: ${franchiseBrands.length}건`);

  // 8. 채널세일즈팀 Opportunity 조회 (BOUser__c 포함)
  let opportunities = [];
  if (users.length > 0) {
    const channelUserIds = users.map(u => `'${u.Id}'`).join(',');
    const oppQuery = `
      SELECT Id, Name, StageName, Amount, CloseDate, AccountId, Account.Name, OwnerId, Owner.Name, CreatedDate, LeadSource, IsClosed, IsWon, Loss_Reason__c, AgeInDays, BOUser__c, FieldUser__c, InstallHopeDate__c, fm_CompanyStatus__c, (SELECT Id FROM ContractOpportunities__r)
      FROM Opportunity
      WHERE OwnerId IN (${channelUserIds})
      ORDER BY CreatedDate DESC
    `.replace(/\s+/g, ' ').trim();
    opportunities = await soqlQueryAll(instanceUrl, accessToken, oppQuery);
  }
  console.log(`  💼 채널 Opportunity: ${opportunities.length}건`);

  // BO/Field User 이름 매핑 추가
  const boFieldIds = new Set();
  opportunities.forEach(o => {
    if (o.BOUser__c) boFieldIds.add(o.BOUser__c);
    if (o.FieldUser__c) boFieldIds.add(o.FieldUser__c);
  });
  if (boFieldIds.size > 0) {
    const ids = [...boFieldIds].map(id => `'${id}'`).join(',');
    const uQuery = `SELECT Id, Name FROM User WHERE Id IN (${ids})`;
    const uResult = await soqlQuery(instanceUrl, accessToken, uQuery);
    uResult.records.forEach(u => { userNameMap[u.Id] = u.Name; });
  }

  // 9. Event 조회 (채널 Account 대상 미팅)
  const eventQuery = `
    SELECT Id, Subject, Description, WhatId, OwnerId, Owner.Name, ActivityDate, StartDateTime, EndDateTime, Type, CreatedDate
    FROM Event
    WHERE What.Type = 'Account'
      AND ActivityDate >= ${startDate}
      AND ActivityDate <= ${endDate}
    ORDER BY ActivityDate DESC
  `.replace(/\s+/g, ' ').trim();
  const allEvents = await soqlQueryAll(instanceUrl, accessToken, eventQuery);
  const allAccountIds = new Set([...partners, ...franchiseBrands, ...franchiseHQAccounts].map(a => a.Id));
  const channelEvents = allEvents.filter(e => allAccountIds.has(e.WhatId));
  console.log(`  📅 채널 Event (미팅): ${channelEvents.length}건`);

  // 10. 전체 LeadSource 기반 Lead 조회 (AM 활성 파트너 집계용 - 최근 90일)
  const threeMonthsAgo = new Date(new Date(startDate).getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
  const allSourceLeadQuery = `
    SELECT Id, PartnerName__c, BrandName__c, LeadSource, CreatedDate, IsConverted
    FROM Lead
    WHERE LeadSource IN ('파트너사 소개', '프랜차이즈소개')
      AND CreatedDate >= ${kstToUTC(threeMonthsAgo, true)}
    ORDER BY CreatedDate DESC
  `.replace(/\s+/g, ' ').trim();
  const allSourceLeads = await soqlQueryAll(instanceUrl, accessToken, allSourceLeadQuery);
  console.log(`  📋 전체 채널 Lead (90일): ${allSourceLeads.length}건`);

  // 11. 채널 Opportunity별 Task 조회 (과업 정보)
  let channelOppTasks = [];
  const openOppIds = opportunities.filter(o => !o.IsClosed).map(o => o.Id);
  if (openOppIds.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < openOppIds.length; i += chunkSize) {
      const chunk = openOppIds.slice(i, i + chunkSize);
      const ids = chunk.map(id => `'${id}'`).join(',');
      const tQuery = `SELECT Id, WhatId, Subject, Description, Status, ActivityDate, CreatedDate FROM Task WHERE WhatId IN (${ids}) ORDER BY WhatId, CreatedDate`;
      const tResult = await soqlQuery(instanceUrl, accessToken, tQuery);
      channelOppTasks = channelOppTasks.concat(tResult.records);
    }
  }
  console.log(`  📞 채널 Opp Task (과업): ${channelOppTasks.length}건`);

  // 12. 채널 Open Opp의 전체 Stage History 조회
  let channelStageHistory = [];
  if (openOppIds.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < openOppIds.length; i += chunkSize) {
      const chunk = openOppIds.slice(i, i + chunkSize);
      const ids = chunk.map(id => `'${id}'`).join(',');
      const histQuery = `
        SELECT OpportunityId, OldValue, NewValue, CreatedDate
        FROM OpportunityFieldHistory
        WHERE OpportunityId IN (${ids})
          AND Field = 'StageName'
        ORDER BY CreatedDate ASC
      `.replace(/\s+/g, ' ').trim();
      const histResult = await soqlQueryAll(instanceUrl, accessToken, histQuery);
      channelStageHistory = channelStageHistory.concat(histResult);
    }
  }
  console.log(`  📜 채널 Open Opp Stage History: ${channelStageHistory.length}건`);

  // 13. 채널 Visit__c 조회
  let channelVisits = [];
  const allOppIds = opportunities.map(o => o.Id);
  if (allOppIds.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < allOppIds.length; i += chunkSize) {
      const chunk = allOppIds.slice(i, i + chunkSize);
      const oppIds = chunk.map(id => `'${id}'`).join(',');
      const visitQuery = `SELECT Id, Opportunity__c, Visit_Status__c, LocalInviteDate__c, ConselStart__c, ConselEnd__c, Realtime__c, VisitAssignmentDate__c, IsVisitComplete__c FROM Visit__c WHERE Opportunity__c IN (${oppIds}) ORDER BY Opportunity__c, ConselStart__c DESC`;
      const visitResult = await soqlQuery(instanceUrl, accessToken, visitQuery);
      channelVisits = channelVisits.concat(visitResult.records);
    }
  }
  console.log(`  🏠 채널 Visit: ${channelVisits.length}건`);

  // 11. 채널 Quote 조회 (신규 테이블오더만, 채널세일즈팀 Opp 기준)
  const channelUserIds = users.map(u => `'${u.Id}'`).join(',');
  const quoteQuery = `
    SELECT Id, Name, CreatedDate, OpportunityId, FinalQuoteCheck__c,
           GrandTotal, Opportunity.Owner.Name, Opportunity.OwnerId,
           Opportunity.Account.Name
    FROM Quote
    WHERE CreatedDate >= ${startUTC} AND CreatedDate < ${endUTC}
      AND Opportunity.OwnerId IN (${channelUserIds})
      AND RecordType.Name = '1. 테이블오더 (신규)'
    ORDER BY CreatedDate DESC
  `.replace(/\s+/g, ' ').trim();
  const channelQuotes = await soqlQueryAll(instanceUrl, accessToken, quoteQuery);
  console.log(`  📝 채널 Quote(신규): ${channelQuotes.length}건`);

  return {
    users, userNameMap,
    channelLeads, channelLeadTasks, channelConvertedLeads,
    sourceLeads, partnerSourceLeads, franchiseSourceLeads,
    partners, franchiseHQAccounts, franchiseBrands,
    opportunities, channelEvents, channelOppTasks,
    allSourceLeads, allAccountIds,
    targetMonth, threeMonthsAgo,
    channelVisits, channelStageHistory,
    channelQuotes
  };
}

// ============================================
// 인바운드 KPI 계산
// ============================================
function calculateInboundKPIs(data, startDate, endDate) {
  const { leads, opportunities, quotes, leadTasks, dailyTasks, oppTasks, obsLeads, users, userNameMap, fieldUserIds, carryoverOpps, allClosedOpps, contracts, visits = [], stageChangeHistory = [] } = data;

  // Lead별 Task 매핑 (전체 + 첫/마지막 Task + 미완료 Task)
  const allTasksByLead = {};
  const firstTaskByLead = {};
  const lastTaskByLead = {};
  const openTasksByLead = {};
  leadTasks.forEach(task => {
    if (!allTasksByLead[task.Lead__c]) allTasksByLead[task.Lead__c] = [];
    allTasksByLead[task.Lead__c].push(task);
    if (!firstTaskByLead[task.Lead__c]) firstTaskByLead[task.Lead__c] = task;
    lastTaskByLead[task.Lead__c] = task; // ORDER BY CreatedDate ASC이므로 마지막이 최신
    // 미완료 Task 수집 (Status가 Completed가 아닌 것)
    if (task.Status && task.Status !== 'Completed') {
      if (!openTasksByLead[task.Lead__c]) openTasksByLead[task.Lead__c] = [];
      openTasksByLead[task.Lead__c].push(task);
    }
  });

  // Opp별 최신 Quote 매핑
  const latestQuoteByOpp = {};
  quotes.forEach(q => {
    if (!latestQuoteByOpp[q.OpportunityId]) latestQuoteByOpp[q.OpportunityId] = q;
  });

  // Opp별 Task 매핑
  const tasksByOpp = {};
  oppTasks.forEach(t => {
    if (!tasksByOpp[t.WhatId]) tasksByOpp[t.WhatId] = [];
    tasksByOpp[t.WhatId].push(t);
  });

  // Opp 데이터 매핑
  const oppDataMap = {};
  opportunities.forEach(opp => {
    const isOpen = opp.StageName !== 'Closed Won' && opp.StageName !== 'Closed Lost';
    const quote = latestQuoteByOpp[opp.Id];
    const tasks = tasksByOpp[opp.Id] || [];

    let retouchCount = 0;
    let daysSinceLastTask = null;
    if (quote) {
      const quoteDate = new Date(quote.CreatedDate);
      const tasksAfterQuote = tasks.filter(t => new Date(t.CreatedDate) > quoteDate);
      retouchCount = tasksAfterQuote.length;
      if (tasksAfterQuote.length > 0) {
        const lastTaskDate = tasksAfterQuote[tasksAfterQuote.length - 1].CreatedDate;
        daysSinceLastTask = Math.floor((new Date() - new Date(lastTaskDate)) / (1000 * 60 * 60 * 24));
      } else {
        daysSinceLastTask = Math.floor((new Date() - quoteDate) / (1000 * 60 * 60 * 24));
      }
    }

    // 과업 정보: 최근 과업 + 다음(미완료) 과업
    const lastTask = tasks.length > 0 ? tasks[tasks.length - 1] : null;
    const openTasks = tasks.filter(t => t.Status !== 'Completed');
    const nextOpenTask = openTasks.length > 0
      ? openTasks.sort((a, b) => (a.ActivityDate || '9999').localeCompare(b.ActivityDate || '9999'))[0]
      : null;

    oppDataMap[opp.Id] = {
      stageName: opp.StageName,
      companyStatus: opp.fm_CompanyStatus__c || null,
      lossReason: opp.Loss_Reason__c,
      lossReasonMain: opp.Loss_Reason_Oppt__c || null,
      lossReasonMid: opp.Loss_Reason_Oppt_2depth__c || null,
      lossReasonDetail: opp.Loss_Reason_Detail__c || null,
      isVisitConverted: opp.Loss_Reason__c !== '방문 전 취소',
      isCW: opp.StageName === 'Closed Won',
      isCL: opp.StageName === 'Closed Lost',
      isOpen,
      fieldUserId: opp.FieldUser__c,
      boUserId: opp.BOUser__c,
      ageInDays: opp.AgeInDays || 0,
      closeDate: opp.CloseDate,
      installHopeDate: opp.InstallHopeDate__c || null,
      hasQuote: !!quote,
      hasContract: !!(opp.ContractOpportunities__r && opp.ContractOpportunities__r.records && opp.ContractOpportunities__r.records.length > 0),
      retouchCount,
      daysSinceLastTask,
      // 과업 정보
      taskCount: tasks.length,
      lastTaskSubject: lastTask?.Subject || null,
      lastTaskDate: lastTask ? utcToKSTDateStr(lastTask.CreatedDate) : null,
      hasOpenTask: openTasks.length > 0,
      openTaskCount: openTasks.length,
      nextTaskSubject: nextOpenTask?.Subject || null,
      nextTaskDate: nextOpenTask?.ActivityDate || null,
      // 전체 과업 목록
      tasks: tasks.map(t => ({
        id: t.Id,
        subject: t.Subject || '-',
        description: t.Description || null,
        status: t.Status || '-',
        activityDate: t.ActivityDate || null,
        createdDate: utcToKSTDateStr(t.CreatedDate),
      })),
    };
  });

  // Lead 데이터 가공
  const leadData = leads.map(lead => {
    const firstTask = firstTaskByLead[lead.Id];
    let frtMinutes = null;
    if (firstTask) {
      frtMinutes = Math.round((new Date(firstTask.CreatedDate) - new Date(lead.CreatedDate)) / 1000 / 60 * 10) / 10;
    }
    const mql = isMQL(lead);
    const oppData = lead.ConvertedOpportunityId ? oppDataMap[lead.ConvertedOpportunityId] : null;
    const dateStr = lead.CreatedTime__c ? parseKSTDateTime(lead.CreatedTime__c)?.dateStr : utcToKSTDateStr(lead.CreatedDate);

    const leadTaskList = allTasksByLead[lead.Id] || [];
    const lastTask = lastTaskByLead[lead.Id];
    const openTasks = openTasksByLead[lead.Id] || [];
    // 가장 가까운 미완료 Task (ActivityDate 기준)
    const nextOpenTask = openTasks.length > 0
      ? openTasks.sort((a, b) => (a.ActivityDate || '9999') < (b.ActivityDate || '9999') ? -1 : 1)[0]
      : null;
    return {
      id: lead.Id,
      ownerId: lead.OwnerId,
      dateStr,
      frtMinutes,
      frtBucket: classifyFRTBucket(frtMinutes),
      hasTask: !!firstTask,
      taskCount: leadTaskList.length,
      lastTaskSubject: lastTask?.Subject || null,
      lastTaskDate: lastTask ? utcToKSTDateStr(lastTask.CreatedDate) : null,
      frtOk: frtMinutes !== null && frtMinutes <= 20,
      isMQL: mql,
      isSQL: mql && lead.Status === 'Qualified',
      hasOpp: !!oppData,
      isVisitConverted: oppData?.isVisitConverted || false,
      isCW: oppData?.isCW || false,
      oppData,
      // 미완료 과업 정보
      hasOpenTask: openTasks.length > 0,
      openTaskCount: openTasks.length,
      nextTaskSubject: nextOpenTask?.Subject || null,
      nextTaskDate: nextOpenTask?.ActivityDate || null,
      openTaskList: openTasks.sort((a, b) => (a.ActivityDate || '9999') < (b.ActivityDate || '9999') ? -1 : 1)
        .map(t => ({ taskId: t.Id || null, subject: t.Subject || '-', date: t.ActivityDate || '-', status: t.Status || '-', owner: userNameMap[t.OwnerId] || '-', description: t.Description || null })),
    };
  });

  // ========== Inside Sales KPIs ==========
  const totalLeads = leadData.length;
  const mqlLeads = leadData.filter(l => l.isMQL);
  const sqlLeads = leadData.filter(l => l.isSQL);
  const withTask = leadData.filter(l => l.hasTask);
  const frtOk = leadData.filter(l => l.frtOk);
  const frtOver20 = withTask.filter(l => !l.frtOk);
  const visitConverted = leadData.filter(l => l.isVisitConverted);

  // 담당자별 Lead/MQL/SQL/FRT 집계
  const byOwner = {};
  leadData.forEach(l => {
    if (!byOwner[l.ownerId]) {
      byOwner[l.ownerId] = { name: userNameMap[l.ownerId] || l.ownerId, lead: 0, mql: 0, sql: 0, opp: 0, visitConverted: 0, cw: 0, withTask: 0, frtOk: 0, frtSum: 0 };
    }
    const o = byOwner[l.ownerId];
    o.lead++;
    if (l.isMQL) o.mql++;
    if (l.isSQL) o.sql++;
    if (l.hasOpp) o.opp++;
    if (l.isVisitConverted) o.visitConverted++;
    if (l.isCW) o.cw++;
    if (l.hasTask) { o.withTask++; o.frtSum += l.frtMinutes; }
    if (l.frtOk) o.frtOk++;
  });

  const ownerFunnelStats = Object.entries(byOwner).map(([ownerId, o]) => ({
    userId: ownerId, name: o.name,
    lead: o.lead, mql: o.mql, sql: o.sql, opp: o.opp, visitConverted: o.visitConverted, cw: o.cw,
    sqlConversionRate: o.mql > 0 ? +(o.sql / o.mql * 100).toFixed(1) : 0,
    frtOk: o.frtOk, frtOver20: o.withTask - o.frtOk,
    avgFrt: o.withTask > 0 ? +(o.frtSum / o.withTask).toFixed(1) : null,
    visitRate: o.sql > 0 ? +(o.visitConverted / o.sql * 100).toFixed(1) : 0
  })).sort((a, b) => b.lead - a.lead);

  // Daily Task 집계
  const taskByOwnerDate = {};
  dailyTasks.forEach(t => {
    const date = utcToKSTDateStr(t.CreatedDate);
    const key = `${t.OwnerId}_${date}`;
    if (!taskByOwnerDate[key]) taskByOwnerDate[key] = 0;
    taskByOwnerDate[key]++;
  });

  const allDates = [...new Set(dailyTasks.map(t => utcToKSTDateStr(t.CreatedDate)))].sort();
  const weekdays = allDates.filter(isWeekday);
  const totalWeekdays = countWeekdays(startDate, endDate);

  const ownerDailyTaskStats = users.map(u => {
    const dailyCounts = weekdays.map(d => taskByOwnerDate[`${u.Id}_${d}`] || 0);
    const totalTasks = dailyCounts.reduce((a, b) => a + b, 0);
    const avgDaily = totalWeekdays > 0 ? totalTasks / totalWeekdays : 0;
    const daysOver30 = dailyCounts.filter(t => t >= 30).length;
    return {
      userId: u.Id,
      name: u.Name,
      totalTasks,
      avgDaily: Math.round(avgDaily * 10) / 10,
      daysOver30,
      totalWeekdays
    };
  });

  // FRT 구간 분포
  const frtBuckets = {};
  withTask.forEach(l => {
    const bucket = l.frtBucket;
    frtBuckets[bucket] = (frtBuckets[bucket] || 0) + 1;
  });

  // Raw 데이터: 미달 건 상세 (Lead 원본에서 핵심 필드만 추출)
  const leadRawMap = {};
  leads.forEach(l => { leadRawMap[l.Id] = l; });

  // null 또는 문자열 "null" 처리 헬퍼
  const safeStr = (v) => (v && v !== 'null') ? v : null;

  // Lead 생성일 KST 변환 (CreatedTime__c가 있으면 우선, 없으면 CreatedDate UTC→KST)
  const leadCreatedKST = (raw) => {
    if (raw?.CreatedTime__c) return raw.CreatedTime__c.substring(0, 10);
    return utcToKSTDateStr(raw?.CreatedDate) || '-';
  };

  // Lead 생성 시간 정보 (주말/영업외 시간 구분용)
  const leadTimeInfo = (raw) => {
    if (raw?.CreatedTime__c) {
      const parsed = parseKSTDateTime(raw.CreatedTime__c);
      if (parsed) return { createdHour: parsed.hour, createdDow: parsed.dayOfWeek };
    }
    // CreatedDate (UTC) → KST 변환
    if (raw?.CreatedDate) {
      const d = new Date(raw.CreatedDate);
      const kst = new Date(d.getTime() + 9 * 3600000);
      return { createdHour: kst.getUTCHours(), createdDow: kst.getUTCDay() };
    }
    return { createdHour: null, createdDow: null };
  };

  // FRT 시간대별 준수율 (영업시간/영업외/주말)
  const frtByTimeSlot = { biz: { ok: 0, total: 0 }, offHour: { ok: 0, total: 0 }, weekend: { ok: 0, total: 0 } };
  withTask.forEach(l => {
    const raw = leadRawMap[l.id];
    const ti = leadTimeInfo(raw);
    const dow = ti.createdDow;
    const hour = ti.createdHour;
    let slot = 'biz';
    if (dow === 0 || dow === 6) slot = 'weekend';
    else if (hour !== null && (hour < 10 || hour >= 19)) slot = 'offHour';
    frtByTimeSlot[slot].total++;
    if (l.frtOk) frtByTimeSlot[slot].ok++;
  });

  // 종료 상태 판별 헬퍼
  const closedStatuses = new Set(['종료', 'Closed', 'Unqualified', 'Recycled']);
  const isClosedStatus = (status) => closedStatuses.has(status);

  const rawFrtOver20 = frtOver20.map(l => {
    const raw = leadRawMap[l.id];
    const status = raw?.Status || '-';
    const ti = leadTimeInfo(raw);
    return {
      leadId: l.id,
      name: safeStr(raw?.Name) || safeStr(raw?.Company) || '-',
      company: safeStr(raw?.Company) || '-',
      owner: userNameMap[l.ownerId] || l.ownerId,
      createdDate: leadCreatedKST(raw),
      createdHour: ti.createdHour,
      createdDow: ti.createdDow,
      status,
      group: isClosedStatus(status) ? 'closed' : (status === 'Qualified' ? 'qualified' : 'open'),
      taskCount: l.taskCount,
      lastTaskSubject: safeStr(l.lastTaskSubject) || '-',
      lastTaskDate: l.lastTaskDate || '-',
      frtMinutes: l.frtMinutes ? Math.round(l.frtMinutes) : null,
      frtBucket: l.frtBucket,
      lossReason: safeStr(raw?.LossReason__c) || '-',
      lossReasonSub: safeStr(raw?.LossReason_Contract__c) || '-',
      lossReasonDetail: safeStr(raw?.LossReasonDetail__c) || '-',
      hasOpenTask: l.hasOpenTask,
      openTaskCount: l.openTaskCount,
      nextTaskSubject: l.nextTaskSubject || '-',
      nextTaskDate: l.nextTaskDate || '-',
      openTaskList: l.openTaskList || [],
    };
  }).sort((a, b) => {
    // 그룹순 정렬: open(계류) → closed(종료) → qualified(전환)
    const groupOrder = { open: 0, closed: 1, qualified: 2 };
    const gDiff = (groupOrder[a.group] ?? 9) - (groupOrder[b.group] ?? 9);
    if (gDiff !== 0) return gDiff;
    return (b.frtMinutes || 0) - (a.frtMinutes || 0);
  });

  const unconvertedMQL = mqlLeads.filter(l => !l.isSQL && !l.hasOpp).map(l => {
    const raw = leadRawMap[l.id];
    const status = raw?.Status || '-';
    return {
      leadId: l.id,
      name: safeStr(raw?.Name) || safeStr(raw?.Company) || '-',
      company: safeStr(raw?.Company) || '-',
      owner: userNameMap[l.ownerId] || l.ownerId,
      createdDate: leadCreatedKST(raw),
      status,
      group: isClosedStatus(status) ? 'closed' : 'open',
      taskCount: l.taskCount,
      lastTaskSubject: safeStr(l.lastTaskSubject) || '-',
      lastTaskDate: l.lastTaskDate || '-',
      lossReason: safeStr(raw?.LossReason__c) || '-',
      lossReasonSub: safeStr(raw?.LossReason_Contract__c) || '-',
      lossReasonDetail: safeStr(raw?.LossReasonDetail__c) || '-',
      hasOpenTask: l.hasOpenTask,
      openTaskCount: l.openTaskCount,
      nextTaskSubject: l.nextTaskSubject || '-',
      nextTaskDate: l.nextTaskDate || '-',
      openTaskList: l.openTaskList || [],
    };
  }).sort((a, b) => {
    const groupOrder = { open: 0, closed: 1 };
    return (groupOrder[a.group] ?? 9) - (groupOrder[b.group] ?? 9);
  });

  const noVisitSQL = sqlLeads.filter(l => !l.isVisitConverted).map(l => {
    const raw = leadRawMap[l.id];
    const opp = l.oppData;
    const oppClosed = opp?.isCW || opp?.isCL;
    return {
      leadId: l.id,
      oppId: raw?.ConvertedOpportunityId || null,
      name: safeStr(raw?.Name) || safeStr(raw?.Company) || '-',
      company: safeStr(raw?.Company) || '-',
      owner: userNameMap[l.ownerId] || l.ownerId,
      createdDate: leadCreatedKST(raw),
      taskCount: l.taskCount,
      lastTaskSubject: safeStr(l.lastTaskSubject) || '-',
      lastTaskDate: l.lastTaskDate || '-',
      oppStage: opp?.stageName || '미전환',
      lossReason: opp?.lossReasonMain || opp?.lossReason || '-',
      lossReasonSub: opp?.lossReasonMid || '-',
      lossReasonDetail: opp?.lossReasonDetail || '-',
      group: oppClosed ? 'closed' : 'open',
      hasOpenTask: l.hasOpenTask,
      openTaskCount: l.openTaskCount,
      nextTaskSubject: l.nextTaskSubject || '-',
      nextTaskDate: l.nextTaskDate || '-',
      openTaskList: l.openTaskList || [],
    };
  }).sort((a, b) => {
    const groupOrder = { open: 0, closed: 1 };
    return (groupOrder[a.group] ?? 9) - (groupOrder[b.group] ?? 9);
  });

  const insideSales = {
    lead: totalLeads,
    mql: mqlLeads.length,
    sql: sqlLeads.length,
    sqlConversionRate: mqlLeads.length > 0 ? +(sqlLeads.length / mqlLeads.length * 100).toFixed(1) : 0,
    target_sqlConversionRate: 90,
    byOwner: ownerFunnelStats,
    frt: {
      totalWithTask: withTask.length,
      frtOk: frtOk.length,
      frtOver20: frtOver20.length,
      target_frtOver20: 0,
      avgFrtMinutes: withTask.length > 0 ? +(withTask.reduce((s, l) => s + l.frtMinutes, 0) / withTask.length).toFixed(1) : null,
      buckets: frtBuckets,
      byTimeSlot: {
        biz: { ...frtByTimeSlot.biz, rate: frtByTimeSlot.biz.total > 0 ? +(frtByTimeSlot.biz.ok / frtByTimeSlot.biz.total * 100).toFixed(1) : 0 },
        offHour: { ...frtByTimeSlot.offHour, rate: frtByTimeSlot.offHour.total > 0 ? +(frtByTimeSlot.offHour.ok / frtByTimeSlot.offHour.total * 100).toFixed(1) : 0 },
        weekend: { ...frtByTimeSlot.weekend, rate: frtByTimeSlot.weekend.total > 0 ? +(frtByTimeSlot.weekend.ok / frtByTimeSlot.weekend.total * 100).toFixed(1) : 0 },
      }
    },
    dailyTask: {
      byOwner: ownerDailyTaskStats,
      target_perPerson: 30
    },
    visitCount: visitConverted.length,
    target_visitCount: 75,
    visitRate: sqlLeads.length > 0 ? +(visitConverted.length / sqlLeads.length * 100).toFixed(1) : 0,
    target_visitRate: 90,
    rawData: {
      frtOver20: rawFrtOver20,
      unconvertedMQL,
      noVisitSQL,
    }
  };

  // ========== Field Sales KPIs ==========
  // 이번 달 Lead → Opp의 ID Set (carryover 구분용) — fieldUserStats보다 먼저 정의
  const thisMonthOppIds = new Set(leads.filter(l => l.ConvertedOpportunityId).map(l => l.ConvertedOpportunityId));

  const fieldUserStats = {};
  Object.entries(oppDataMap).forEach(([oppId, opp]) => {
    if (!opp.fieldUserId) return;
    if (!fieldUserStats[opp.fieldUserId]) {
      fieldUserStats[opp.fieldUserId] = { name: userNameMap[opp.fieldUserId] || opp.fieldUserId, total: 0, cw: 0, cl: 0, open: 0, thisMonthTotal: 0, thisMonthOpen: 0, carryoverTotal: 0, carryoverOpen: 0, thisMonthCW: 0, thisMonthCL: 0, carryoverCW: 0, carryoverCL: 0 };
    }
    const s = fieldUserStats[opp.fieldUserId];
    const isThisMonth = thisMonthOppIds.has(oppId);
    s.total++;
    if (isThisMonth) s.thisMonthTotal++; else s.carryoverTotal++;
    if (opp.isCW) { s.cw++; if (isThisMonth) s.thisMonthCW++; else s.carryoverCW++; }
    if (opp.isCL) { s.cl++; if (isThisMonth) s.thisMonthCL++; else s.carryoverCL++; }
    if (opp.isOpen) { s.open++; if (isThisMonth) s.thisMonthOpen++; else s.carryoverOpen++; }
  });

  const fieldStats = Object.entries(fieldUserStats).map(([userId, stats]) => ({
    userId, ...stats,
    // 전환율: 이번달 SQL 전체 대비 이번달 CW
    cwRate: stats.thisMonthTotal > 0 ? +(stats.thisMonthCW / stats.thisMonthTotal * 100).toFixed(1) : 0
  })).sort((a, b) => b.total - a.total);

  // Golden Time (견적단계 리터치)
  const quoteStageOpps = Object.entries(oppDataMap)
    .filter(([_, opp]) => opp.stageName === '견적')
    .map(([oppId, opp]) => ({ oppId, ...opp }));

  const goldenTimeViolations = {
    noQuote: quoteStageOpps.filter(o => !o.hasQuote).length,
    stale8plus: quoteStageOpps.filter(o => o.hasQuote && o.daysSinceLastTask >= 8).length,
    stale4to7: quoteStageOpps.filter(o => o.hasQuote && o.daysSinceLastTask >= 4 && o.daysSinceLastTask < 8).length,
    total: quoteStageOpps.length
  };

  // OBS Lead 생산
  const obsLeadByField = {};
  obsLeads.forEach(l => {
    const userId = l.OwnerId;
    if (!obsLeadByField[userId]) obsLeadByField[userId] = { name: userNameMap[userId] || userId, count: 0 };
    obsLeadByField[userId].count++;
  });

  // 이월 포함 CW (CloseDate 기준): Field Sales
  const carryoverFieldStats = {};
  (allClosedOpps || []).forEach(o => {
    const userId = o.FieldUser__c;
    if (!userId) return;
    if (!carryoverFieldStats[userId]) {
      carryoverFieldStats[userId] = { name: userNameMap[userId] || userId, total: 0, cw: 0, cl: 0, carryoverCW: 0, carryoverCL: 0 };
    }
    const isCarryover = !thisMonthOppIds.has(o.Id);
    carryoverFieldStats[userId].total++;
    if (o.StageName === 'Closed Won') {
      carryoverFieldStats[userId].cw++;
      if (isCarryover) carryoverFieldStats[userId].carryoverCW++;
    } else {
      carryoverFieldStats[userId].cl++;
      if (isCarryover) carryoverFieldStats[userId].carryoverCL++;
    }
  });

  const fieldCarryoverList = Object.entries(carryoverFieldStats).map(([userId, stats]) => ({
    userId, name: stats.name,
    totalClosed: stats.total, cw: stats.cw, cl: stats.cl,
    carryoverCW: stats.carryoverCW, carryoverCL: stats.carryoverCL,
    thisMonthCW: stats.cw - stats.carryoverCW,
    cwRate: stats.total > 0 ? +(stats.cw / stats.total * 100).toFixed(1) : 0
  })).sort((a, b) => b.cw - a.cw);

  // ===== Opp 이름 매핑 + Visit 매핑 (FS + BO 공용) =====
  const oppDetailMap = {};
  opportunities.forEach(opp => {
    oppDetailMap[opp.Id] = { name: opp.Name, createdDate: utcToKSTDateStr(opp.CreatedDate) };
  });

  const visitByOpp = {};
  (visits || []).forEach(v => {
    const oppId = v.Opportunity__c;
    if (!oppId) return;
    if (!visitByOpp[oppId]) {
      visitByOpp[oppId] = { visits: [] };
    }
    visitByOpp[oppId].visits.push(v);
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  Object.entries(visitByOpp).forEach(([oppId, info]) => {
    const completed = info.visits.filter(v => v.Visit_Status__c === '방문완료');
    const scheduled = info.visits.filter(v => v.Visit_Status__c !== '방문완료' && v.Visit_Status__c !== '방문취소');
    info.hasVisitComplete = completed.length > 0;
    info.visitCount = info.visits.length;
    info.completedCount = completed.length;
    info.lastVisitDate = null;
    info.nextVisitDate = null;
    info.daysSinceVisit = null;
    info.bizDaysSinceVisit = null;
    info.visitDurationMin = null;
    if (completed.length > 0) {
      const latest = completed.sort((a, b) => (b.LocalInviteDate__c || b.ConselStart__c || '').localeCompare(a.LocalInviteDate__c || a.ConselStart__c || ''))[0];
      const completeDateStr = latest.LocalInviteDate__c || latest.ConselStart__c || latest.VisitAssignmentDate__c;
      if (completeDateStr) {
        info.lastVisitDate = utcToKSTDateStr(completeDateStr);
        const visitDate = new Date(completeDateStr);
        visitDate.setHours(0, 0, 0, 0);
        info.daysSinceVisit = Math.floor((today - visitDate) / (1000 * 60 * 60 * 24));
        info.bizDaysSinceVisit = countBizDays(visitDate, today);
      }
      // 방문 소요 시간 (ConselStart → ConselEnd)
      if (latest.ConselStart__c && latest.ConselEnd__c) {
        const startMs = new Date(latest.ConselStart__c).getTime();
        const endMs = new Date(latest.ConselEnd__c).getTime();
        if (endMs > startMs) {
          info.visitDurationMin = Math.round((endMs - startMs) / (1000 * 60));
        }
      }
    }
    if (scheduled.length > 0) {
      const withDate = scheduled.filter(v => v.LocalInviteDate__c || v.ConselStart__c || v.VisitAssignmentDate__c);
      if (withDate.length > 0) {
        const earliest = withDate.sort((a, b) => {
          const da = a.LocalInviteDate__c || a.ConselStart__c || a.VisitAssignmentDate__c || '';
          const db = b.LocalInviteDate__c || b.ConselStart__c || b.VisitAssignmentDate__c || '';
          return da.localeCompare(db);
        })[0];
        const scheduleDateStr = earliest.LocalInviteDate__c || earliest.ConselStart__c || earliest.VisitAssignmentDate__c;
        if (scheduleDateStr) {
          info.nextVisitDate = utcToKSTDateStr(scheduleDateStr);
        }
      }
    }
    info.visitStatus = completed.length > 0 ? '방문완료'
      : scheduled.length > 0 ? '방문예정'
      : '방문취소';
  });

  // ===== Field Sales: Visit Calendar 데이터 =====
  const visitCalendarEvents = [];
  (visits || []).forEach(v => {
    const oppId = v.Opportunity__c;
    if (!oppId) return;
    const opp = oppDataMap[oppId];
    if (!opp || !opp.fieldUserId) return;
    const dateStr = v.LocalInviteDate__c
      ? utcToKSTDateStr(v.LocalInviteDate__c)
      : v.ConselStart__c
        ? utcToKSTDateStr(v.ConselStart__c)
        : v.VisitAssignmentDate__c
          ? utcToKSTDateStr(v.VisitAssignmentDate__c)
          : null;
    if (!dateStr) return;
    visitCalendarEvents.push({
      date: dateStr,
      fieldUser: userNameMap[opp.fieldUserId] || opp.fieldUserId,
      oppName: oppDetailMap[oppId]?.name || oppId,
      status: v.Visit_Status__c,
    });
  });
  const vcByUser = {};
  visitCalendarEvents.forEach(ev => {
    if (!vcByUser[ev.fieldUser]) vcByUser[ev.fieldUser] = {};
    if (!vcByUser[ev.fieldUser][ev.date]) vcByUser[ev.fieldUser][ev.date] = [];
    vcByUser[ev.fieldUser][ev.date].push({ oppName: ev.oppName, status: ev.status });
  });
  const visitCalendar = Object.entries(vcByUser).map(([name, dates]) => ({ name, dates }));

  // ===== Field Sales: Golden Time 위반 개별 목록 =====
  const goldenTimeViolationList = quoteStageOpps
    .filter(o => o.hasQuote && o.daysSinceLastTask >= 8)
    .map(o => {
      const vi = visitByOpp[o.oppId];
      return {
        oppId: o.oppId,
        name: oppDetailMap[o.oppId]?.name || o.oppId,
        fieldUser: userNameMap[o.fieldUserId] || o.fieldUserId || '-',
        boUser: o.boUserId ? (userNameMap[o.boUserId] || o.boUserId) : '(미배정)',
        stageName: o.stageName,
        ageInDays: o.ageInDays,
        daysSinceLastTask: o.daysSinceLastTask,
        lastTaskSubject: o.lastTaskSubject || '-',
        lastTaskDate: o.lastTaskDate || '-',
        hasOpenTask: o.hasOpenTask || false,
        openTaskCount: o.openTaskCount || 0,
        nextTaskSubject: o.nextTaskSubject || '-',
        nextTaskDate: o.nextTaskDate || '-',
        taskCount: o.taskCount || 0,
        tasks: o.tasks || [],
        createdDate: oppDetailMap[o.oppId]?.createdDate || '-',
        visitCompleteDate: vi?.lastVisitDate || null,
        visitScheduleDate: vi?.nextVisitDate || null,
        daysSinceVisit: vi?.daysSinceVisit ?? null,
        bizDaysSinceVisit: vi?.bizDaysSinceVisit ?? null,
        visitDurationMin: vi?.visitDurationMin ?? null,
      };
    })
    .sort((a, b) => b.daysSinceLastTask - a.daysSinceLastTask);

  // ===== Field Sales: rawOpenOpps =====
  const fsRawOpenOpps = Object.entries(oppDataMap)
    .filter(([_, opp]) => opp.isOpen && opp.fieldUserId)
    .map(([oppId, opp]) => {
      const vi = visitByOpp[oppId];
      return {
        oppId,
        name: oppDetailMap[oppId]?.name || oppId,
        fieldUser: userNameMap[opp.fieldUserId] || opp.fieldUserId || '-',
        boUser: opp.boUserId ? (userNameMap[opp.boUserId] || opp.boUserId) : '(미배정)',
        stageName: opp.stageName,
        companyStatus: opp.companyStatus || '-',
        ageInDays: opp.ageInDays,
        ageBucket: classifyAgeBucket(opp.ageInDays),
        closeDate: opp.closeDate || '-',
        installHopeDate: opp.installHopeDate || '-',
        createdDate: oppDetailMap[oppId]?.createdDate || '-',
        hasQuote: opp.hasQuote,
        hasContract: opp.hasContract || false,
        retouchCount: opp.retouchCount,
        daysSinceLastTask: opp.daysSinceLastTask,
        taskCount: opp.taskCount || 0,
        lastTaskSubject: opp.lastTaskSubject || '-',
        lastTaskDate: opp.lastTaskDate || '-',
        hasOpenTask: opp.hasOpenTask || false,
        openTaskCount: opp.openTaskCount || 0,
        nextTaskSubject: opp.nextTaskSubject || '-',
        nextTaskDate: opp.nextTaskDate || '-',
        tasks: opp.tasks || [],
        visitCompleteDate: vi?.lastVisitDate || null,
        visitScheduleDate: vi?.nextVisitDate || null,
        daysSinceVisit: vi?.daysSinceVisit ?? null,
        bizDaysSinceVisit: vi?.bizDaysSinceVisit ?? null,
        visitDurationMin: vi?.visitDurationMin ?? null,
        daysToVisit: (() => {
          const cd = oppDetailMap[oppId]?.createdDate;
          const vd = vi?.lastVisitDate;
          if (!cd || !vd) return null;
          const diff = Math.floor((new Date(vd) - new Date(cd)) / (1000 * 60 * 60 * 24));
          return diff >= 0 ? diff : 0;
        })(),
      };
    })
    .sort((a, b) => b.ageInDays - a.ageInDays);

  // ===== Field Sales: 방문후 7일+ 경과 =====
  const staleVisitOpps = fsRawOpenOpps
    .filter(o => o.daysSinceVisit !== null && o.daysSinceVisit >= 7)
    .sort((a, b) => b.daysSinceVisit - a.daysSinceVisit);

  // ===== Field Sales: rawClosedOpps =====
  const fsRawClosedOpps = (allClosedOpps || [])
    .filter(o => o.FieldUser__c)
    .map(o => ({
      oppId: o.Id,
      name: o.Name || o.Id,
      fieldUser: userNameMap[o.FieldUser__c] || o.FieldUser__c || '-',
      boUser: o.BOUser__c ? (userNameMap[o.BOUser__c] || o.BOUser__c) : '(미배정)',
      stageName: o.StageName,
      lossReason: o.Loss_Reason__c || '-',
      hasContract: !!(o.ContractOpportunities__r && o.ContractOpportunities__r.records && o.ContractOpportunities__r.records.length > 0),
      ageInDays: o.AgeInDays || 0,
      closeDate: o.CloseDate,
      installHopeDate: o.InstallHopeDate__c || '-',
    }))
    .sort((a, b) => (b.closeDate || '').localeCompare(a.closeDate || ''));

  // ===== Field Sales: agingSummary + lossReasonSummary =====
  const fsAgingSummary = { within3: 0, day4to7: 0, over7: 0, over14: 0, over30: 0 };
  fsRawOpenOpps.forEach(o => { fsAgingSummary[o.ageBucket] = (fsAgingSummary[o.ageBucket] || 0) + 1; });

  const fsLossReasonSummary = {};
  fsRawClosedOpps.filter(o => o.stageName === 'Closed Lost').forEach(o => {
    const reason = o.lossReason || '(미입력)';
    fsLossReasonSummary[reason] = (fsLossReasonSummary[reason] || 0) + 1;
  });

  const fieldSales = {
    cwConversionRate: {
      byUser: fieldStats,
      target: 60
    },
    cwWithCarryover: {
      byUser: fieldCarryoverList,
      totalCW: fieldCarryoverList.reduce((s, u) => s + u.cw, 0),
      totalCarryoverCW: fieldCarryoverList.reduce((s, u) => s + u.carryoverCW, 0),
      totalThisMonthCW: fieldCarryoverList.reduce((s, u) => s + u.thisMonthCW, 0),
      note: 'OpportunityFieldHistory 실제 변경일 기준 CW/CL (이월 포함)'
    },
    goldenTime: {
      ...goldenTimeViolations,
      violations: goldenTimeViolationList,
    },
    obsLeadCount: {
      total: obsLeads.length,
      target: 200,
      byUser: Object.values(obsLeadByField).sort((a, b) => b.count - a.count)
    },
    visitCalendar,
    staleVisit: {
      total: staleVisitOpps.length,
      over14: staleVisitOpps.filter(o => o.daysSinceVisit >= 14).length,
      opps: staleVisitOpps,
    },
    rawData: {
      rawOpenOpps: fsRawOpenOpps,
      rawClosedOpps: fsRawClosedOpps,
    },
    agingSummary: fsAgingSummary,
    lossReasonSummary: fsLossReasonSummary,
  };

  // ========== Back Office KPIs ==========
  // 인바운드세일즈 부서 소속 유저만 BO에 표시
  const inboundUserIds = new Set(users.map(u => u.Id));

  // --- Lead 기준: SQL(total) / Open(진행중) ---
  const boUserStats = {};
  Object.entries(oppDataMap).forEach(([oppId, opp]) => {
    const boId = opp.boUserId || '__unassigned__';
    if (boId !== '__unassigned__' && !inboundUserIds.has(boId)) return;
    if (!boUserStats[boId]) {
      boUserStats[boId] = {
        name: boId === '__unassigned__' ? '(미배정)' : (userNameMap[boId] || boId),
        total: 0, open: 0,
        thisMonthTotal: 0, thisMonthOpen: 0,
        carryoverTotal: 0, carryoverOpen: 0,
        openByAge: { within3: 0, day4to7: 0, over7: 0 },
      };
    }
    const bo = boUserStats[boId];
    const isThisMonthOpp = thisMonthOppIds.has(oppId);
    bo.total++;
    if (isThisMonthOpp) bo.thisMonthTotal++; else bo.carryoverTotal++;
    if (opp.isOpen) {
      bo.open++;
      if (isThisMonthOpp) bo.thisMonthOpen++; else bo.carryoverOpen++;
      const age = opp.ageInDays;
      if (age < 7) bo.openByAge.within3++;
      else bo.openByAge.over7++;
    }
  });

  // --- History 기준: CW/CL (OpportunityFieldHistory 실제 변경일 기준) ---
  // 인바운드 BO 담당자의 CW/CL만 필터
  const inboundHistory = stageChangeHistory.filter(h => {
    if (!h.boUserId) return false;
    return inboundUserIds.has(h.boUserId);
  });
  const boHistoryStats = {};
  inboundHistory.forEach(h => {
    const boId = h.boUserId;
    if (!boHistoryStats[boId]) {
      boHistoryStats[boId] = {
        name: h.boUserName || boId,
        cw: 0, cl: 0,
        dailyClose: {}, // changeDate 기준 일별 집계
      };
    }
    const bh = boHistoryStats[boId];
    const isThisMonth = thisMonthOppIds.has(h.oppId);
    if (!bh.dailyClose[h.changeDate]) {
      bh.dailyClose[h.changeDate] = { cw: 0, cl: 0, thisMonthCW: 0, thisMonthCL: 0, carryoverCW: 0, carryoverCL: 0 };
    }
    const dc = bh.dailyClose[h.changeDate];
    if (h.isCW) {
      bh.cw++;
      dc.cw++;
      if (isThisMonth) dc.thisMonthCW++; else dc.carryoverCW++;
    }
    if (h.isCL) {
      bh.cl++;
      dc.cl++;
      if (isThisMonth) dc.thisMonthCL++; else dc.carryoverCL++;
    }
  });

  // Lead 기준 + History 기준 병합
  const boStats = Object.entries(boUserStats).map(([userId, stats]) => {
    const hist = boHistoryStats[userId] || { cw: 0, cl: 0, dailyClose: {} };
    const closeDates = Object.entries(hist.dailyClose);
    const totalCloseActions = closeDates.reduce((sum, [_, d]) => sum + d.cw + d.cl, 0);
    const closeDays = closeDates.length;
    // 이월 여부: History CW 중 이번달 Lead가 아닌 것
    const historyCW = inboundHistory.filter(h => h.boUserId === userId && h.isCW);
    const historyCL = inboundHistory.filter(h => h.boUserId === userId && h.isCL);
    const carryoverCW = historyCW.filter(h => !thisMonthOppIds.has(h.oppId)).length;
    const carryoverCL = historyCL.filter(h => !thisMonthOppIds.has(h.oppId)).length;
    const totalThisMonth = closeDates.reduce((s, [_, d]) => s + (d.thisMonthCW || 0) + (d.thisMonthCL || 0), 0);
    const totalCarryover = closeDates.reduce((s, [_, d]) => s + (d.carryoverCW || 0) + (d.carryoverCL || 0), 0);
    const thisMonthCW = hist.cw - carryoverCW;
    const thisMonthCL = hist.cl - carryoverCL;
    return {
      userId, name: stats.name,
      total: stats.total, // 전체 SQL
      cw: hist.cw, cl: hist.cl, // CW/CL (History 기준)
      open: stats.open,
      thisMonthTotal: stats.thisMonthTotal, // 이번달 생성 SQL 전체 (Open 포함)
      thisMonthOpen: stats.thisMonthOpen,
      carryoverTotal: stats.carryoverTotal,
      carryoverOpen: stats.carryoverOpen,
      carryoverCW, carryoverCL,
      thisMonthCW,
      thisMonthCL,
      // 전환율: 이번달 SQL 전체 대비 CW
      cwRate: stats.thisMonthTotal > 0 ? +(thisMonthCW / stats.thisMonthTotal * 100).toFixed(1) : 0,
      openByAge: stats.openByAge,
      avgDailyClose: closeDays > 0 ? +(totalCloseActions / closeDays).toFixed(1) : 0,
      avgDailyCloseThisMonth: closeDays > 0 ? +(totalThisMonth / closeDays).toFixed(1) : 0,
      avgDailyCloseCarryover: closeDays > 0 ? +(totalCarryover / closeDays).toFixed(1) : 0,
      closeDays,
    };
  }).sort((a, b) => b.total - a.total);

  // cwWithCarryover (이전 호환 유지, History 기준으로 업데이트)
  const boCarryoverList = boStats.map(b => ({
    userId: b.userId, name: b.name,
    totalClosed: b.cw + b.cl, cw: b.cw, cl: b.cl,
    carryoverCW: b.carryoverCW, carryoverCL: b.carryoverCL,
    thisMonthCW: b.thisMonthCW,
    cwRate: b.cwRate,
  })).filter(b => (b.cw + b.cl) > 0).sort((a, b) => b.cw - a.cw);

  // oppDetailMap, visitByOpp는 Field Sales 섹션에서 이미 빌드됨 (공용)

  // rawOpenOpps: 진행중 Opportunity 개별 건 (인바운드 팀 + BOUser 미배정만)
  const rawOpenOpps = Object.entries(oppDataMap)
    .filter(([_, opp]) => opp.isOpen && (!opp.boUserId || inboundUserIds.has(opp.boUserId)))
    .map(([oppId, opp]) => {
      const vi = visitByOpp[oppId];
      return {
        oppId,
        name: oppDetailMap[oppId]?.name || oppId,
        boUser: opp.boUserId ? (userNameMap[opp.boUserId] || opp.boUserId) : '(미배정)',
        fieldUser: userNameMap[opp.fieldUserId] || opp.fieldUserId || '-',
        stageName: opp.stageName,
        companyStatus: opp.companyStatus || '-',
        ageInDays: opp.ageInDays,
        ageBucket: classifyAgeBucket(opp.ageInDays),
        closeDate: opp.closeDate || '-',
        installHopeDate: opp.installHopeDate || '-',
        createdDate: oppDetailMap[oppId]?.createdDate || '-',
        hasQuote: opp.hasQuote,
        hasContract: opp.hasContract || false,
        retouchCount: opp.retouchCount,
        daysSinceLastTask: opp.daysSinceLastTask,
        // 과업 정보
        taskCount: opp.taskCount || 0,
        lastTaskSubject: opp.lastTaskSubject || '-',
        lastTaskDate: opp.lastTaskDate || '-',
        hasOpenTask: opp.hasOpenTask || false,
        openTaskCount: opp.openTaskCount || 0,
        nextTaskSubject: opp.nextTaskSubject || '-',
        nextTaskDate: opp.nextTaskDate || '-',
        tasks: opp.tasks || [],
        // 방문 정보
        visitCompleteDate: vi?.lastVisitDate || null,
        visitScheduleDate: vi?.nextVisitDate || null,
        daysSinceVisit: vi?.daysSinceVisit ?? null,
        bizDaysSinceVisit: vi?.bizDaysSinceVisit ?? null,
        daysToVisit: (() => {
          const cd = oppDetailMap[oppId]?.createdDate;
          const vd = vi?.lastVisitDate;
          if (!cd || !vd) return null;
          const diff = Math.floor((new Date(vd) - new Date(cd)) / (1000 * 60 * 60 * 24));
          return diff >= 0 ? diff : 0;
        })(),
      };
    })
    .sort((a, b) => b.ageInDays - a.ageInDays);

  // rawClosedOpps: 이번달 마감 Opp 개별 건 (History 기준 — 실제 변경일)
  const rawClosedOpps = inboundHistory
    .map(h => ({
      oppId: h.oppId,
      name: h.oppName || h.oppId,
      boUser: h.boUserName || '(미배정)',
      fieldUser: h.fieldUserName || '-',
      stageName: h.stageName,
      oldStage: h.oldStage || '-',
      lossReason: '-',
      companyStatus: h.companyStatus || '-',
      changeDate: h.changeDate, // History 실제 변경일 (KST)
      closeDate: h.closeDate, // Opp의 CloseDate (참고용)
      installHopeDate: h.installHopeDate || '-',
      createdMonth: h.oppCreatedDate ? h.oppCreatedDate.substring(0, 7) : '-',
      isCarryover: !thisMonthOppIds.has(h.oppId),
    }))
    .sort((a, b) => (b.changeDate || '').localeCompare(a.changeDate || ''));

  // 에이징 분포 요약
  const agingSummary = { within3: 0, day4to7: 0, over7: 0, over14: 0, over30: 0 };
  rawOpenOpps.forEach(o => { agingSummary[o.ageBucket] = (agingSummary[o.ageBucket] || 0) + 1; });

  // 종료사유 분포 (CL만)
  const lossReasonSummary = {};
  rawClosedOpps.filter(o => o.stageName === 'Closed Lost').forEach(o => {
    const reason = o.lossReason || '(미입력)';
    lossReasonSummary[reason] = (lossReasonSummary[reason] || 0) + 1;
  });

  // 계약 기반 집계 (인바운드)
  const inboundContracts = (contracts || []).filter(c => c.ownerDept === '인바운드세일즈');
  const inboundContractsByType = {};
  inboundContracts.forEach(c => {
    const t = c.recordTypeName || '기타';
    inboundContractsByType[t] = (inboundContractsByType[t] || 0) + 1;
  });
  const inboundNewContracts = inboundContracts.filter(c => c.recordTypeName && c.recordTypeName.includes('신규'));
  const inboundAddInstallContracts = inboundContracts.filter(c => c.recordTypeName && c.recordTypeName.includes('추가설치'));
  // 신규 계약 중 이월 영업기회에서 발생한 건 (이번 달 Lead가 아닌 Opp)
  const inboundNewFromCarryover = inboundNewContracts.filter(c => c.oppId && !thisMonthOppIds.has(c.oppId));
  // 인바운드 계약 BO담당자별 집계
  const contractByBO = {};
  inboundContracts.forEach(c => {
    const bo = c.boUser || '(미지정)';
    if (!contractByBO[bo]) contractByBO[bo] = { total: 0, new: 0, newCarryover: 0, addInstall: 0, tablets: 0 };
    contractByBO[bo].total++;
    contractByBO[bo].tablets += c.tabletQty || 0;
    if (c.recordTypeName?.includes('신규')) {
      contractByBO[bo].new++;
      if (c.oppId && !thisMonthOppIds.has(c.oppId)) contractByBO[bo].newCarryover++;
    } else if (c.recordTypeName?.includes('추가설치')) contractByBO[bo].addInstall++;
  });

  const backOffice = {
    cwConversionRate: {
      byUser: boStats,
      target: 60
    },
    cwWithCarryover: {
      byUser: boCarryoverList,
      totalCW: boCarryoverList.reduce((s, u) => s + u.cw, 0),
      totalCarryoverCW: boCarryoverList.reduce((s, u) => s + u.carryoverCW, 0),
      totalThisMonthCW: boCarryoverList.reduce((s, u) => s + u.thisMonthCW, 0),
      note: 'OpportunityFieldHistory 실제 변경일 기준 CW/CL (이월 포함)'
    },
    contractSummary: {
      total: inboundContracts.length,
      new: inboundNewContracts.length,
      newFromCarryover: inboundNewFromCarryover.length,
      addInstall: inboundAddInstallContracts.length,
      byRecordType: inboundContractsByType,
      byBO: Object.entries(contractByBO).map(([name, v]) => ({ name, ...v })),
    },
    dailyClose: {
      byUser: boStats.map(b => ({ name: b.name, avgDailyClose: b.avgDailyClose, avgDailyCloseThisMonth: b.avgDailyCloseThisMonth, avgDailyCloseCarryover: b.avgDailyCloseCarryover })),
      target: 5
    },
    sqlBacklog: {
      byUser: boStats.map(b => ({ name: b.name, over7: b.openByAge.over7 })),
      totalOver7: boStats.reduce((sum, b) => sum + b.openByAge.over7, 0),
      totalOpen: rawOpenOpps.length,
      target: 10
    },
    rawData: {
      rawOpenOpps,
      rawClosedOpps,
    },
    agingSummary,
    lossReasonSummary,
  };

  return { insideSales, fieldSales, backOffice };
}

// ============================================
// 채널 KPI 계산
// ============================================
function calculateChannelKPIs(data, startDate, endDate) {
  const {
    users, userNameMap,
    channelLeads, channelLeadTasks, channelConvertedLeads = [],
    sourceLeads, partnerSourceLeads, franchiseSourceLeads,
    partners, franchiseHQAccounts, franchiseBrands,
    opportunities, channelEvents, channelOppTasks,
    allSourceLeads, allAccountIds,
    targetMonth, threeMonthsAgo,
    contracts,
    channelVisits = [],
    stageChangeHistory = [],
    channelStageHistory = [],
    channelQuotes = [],
  } = data;

  // ========== AE KPIs ==========
  // MOU 체결 수 (이번달)
  const mouPartnersThisMonth = partners.filter(p =>
    p.MOUstartdate__c && p.MOUstartdate__c.substring(0, 7) === targetMonth
  );
  const mouHQThisMonth = franchiseHQAccounts.filter(h =>
    h.MOUstartdate__c && h.MOUstartdate__c.substring(0, 7) === targetMonth
  );
  const mouBrandsThisMonth = franchiseBrands.filter(b =>
    b.MOUstartdate__c && b.MOUstartdate__c.substring(0, 7) === targetMonth
  );

  // MOU 네고 단계 진입 (Progress__c 값 기반)
  const allMOUAccounts = [...partners, ...franchiseHQAccounts, ...franchiseBrands];
  const progressValues = {};
  allMOUAccounts.forEach(a => {
    const p = a.Progress__c || '(없음)';
    progressValues[p] = (progressValues[p] || 0) + 1;
  });

  // Event 일별 집계 (AE/AM 공용)
  const eventsByOwnerDate = {};
  channelEvents.forEach(e => {
    const date = e.ActivityDate;
    const ownerId = e.OwnerId;
    const key = `${ownerId}_${date}`;
    if (!eventsByOwnerDate[key]) eventsByOwnerDate[key] = 0;
    eventsByOwnerDate[key]++;
  });

  const eventsByOwner = {};
  channelEvents.forEach(e => {
    const ownerId = e.OwnerId;
    if (!eventsByOwner[ownerId]) eventsByOwner[ownerId] = { name: userNameMap[ownerId] || e.Owner?.Name || ownerId, count: 0 };
    eventsByOwner[ownerId].count++;
  });

  const eventDays = [...new Set(channelEvents.map(e => e.ActivityDate))].filter(isWeekday).length;
  const totalWeekdays = countWeekdays(startDate, endDate);

  const ae = {
    mouCount: {
      partners: mouPartnersThisMonth.length,
      franchiseHQ: mouHQThisMonth.length,
      franchiseBrands: mouBrandsThisMonth.length,
      total: mouPartnersThisMonth.length + mouHQThisMonth.length,
      target: 4,
      details: {
        partners: mouPartnersThisMonth.map(p => ({ name: p.Name, mouStart: p.MOUstartdate__c, owner: p.Owner?.Name })),
        franchiseHQ: mouHQThisMonth.map(h => ({ name: h.Name, mouStart: h.MOUstartdate__c, owner: h.Owner?.Name }))
      }
    },
    mouNegoProgress: {
      byProgress: progressValues,
      note: 'Progress__c 필드값 분포 - 네고 단계 기준값 확인 필요'
    },
    meetingCount: {
      total: channelEvents.length,
      avgDaily: totalWeekdays > 0 ? +(channelEvents.length / totalWeekdays).toFixed(1) : 0,
      byOwner: Object.values(eventsByOwner).sort((a, b) => b.count - a.count),
      target_daily: 2
    }
  };

  // ========== AM KPIs ==========
  // 일별 리드 확보 수
  const dailyLeadCounts = {};
  const allPeriodSourceLeads = [...partnerSourceLeads, ...franchiseSourceLeads];
  allPeriodSourceLeads.forEach(l => {
    const date = utcToKSTDateStr(l.CreatedDate);
    if (date) {
      dailyLeadCounts[date] = (dailyLeadCounts[date] || 0) + 1;
    }
  });

  const leadDays = Object.keys(dailyLeadCounts).filter(isWeekday);
  const totalDailyLeads = leadDays.reduce((sum, d) => sum + dailyLeadCounts[d], 0);

  // 초기 안착률 (MOU 후 3개월 내 Lead ≥ 1)
  const mouPartners3m = partners.filter(p =>
    p.MOUstartdate__c && p.MOUstartdate__c >= threeMonthsAgo
  );

  const onboardingResults = mouPartners3m.map(p => {
    const mouDate = new Date(p.MOUstartdate__c);
    const mouEndWindow = new Date(mouDate.getFullYear(), mouDate.getMonth() + 3, mouDate.getDate()).toISOString().substring(0, 10);
    const myLeads = allSourceLeads.filter(l => l.PartnerName__c === p.Id);
    const leadsInWindow = myLeads.filter(l => {
      const leadDate = utcToKSTDateStr(l.CreatedDate);
      return leadDate >= p.MOUstartdate__c && leadDate <= mouEndWindow;
    });
    return { name: p.Name, mouStart: p.MOUstartdate__c, isSettled: leadsInWindow.length > 0, leadCount: leadsInWindow.length };
  });

  const settledCount = onboardingResults.filter(r => r.isSettled).length;

  // 기존 파트너 활성 유지 (90일 내 Lead ≥ 1)
  const activePartnerIds = new Set();
  allSourceLeads.forEach(l => {
    if (l.PartnerName__c) activePartnerIds.add(l.PartnerName__c);
    if (l.BrandName__c) activePartnerIds.add(l.BrandName__c);
  });

  const activePartnerCount = partners.filter(p => activePartnerIds.has(p.Id)).length;
  const activeBrandCount = franchiseBrands.filter(b => activePartnerIds.has(b.Id)).length;

  // AM 담당자별 리드 확보 수
  const leadByOwner = {};
  allPeriodSourceLeads.forEach(l => {
    const owner = l.Owner?.Name || '미배정';
    if (!leadByOwner[owner]) leadByOwner[owner] = { name: owner, partner: 0, franchise: 0, total: 0 };
    leadByOwner[owner].total++;
    if (l.LeadSource === '파트너사 소개') leadByOwner[owner].partner++;
    else leadByOwner[owner].franchise++;
  });
  const leadByOwnerList = Object.values(leadByOwner).sort((a, b) => b.total - a.total);

  const am = {
    dailyLeadCount: {
      total: allPeriodSourceLeads.length,
      avgDaily: leadDays.length > 0 ? +(totalDailyLeads / leadDays.length).toFixed(1) : 0,
      target_daily: '20~25',
      partner: partnerSourceLeads.length,
      franchise: franchiseSourceLeads.length,
      byOwner: leadByOwnerList
    },
    meetingCount: ae.meetingCount, // AE와 공유
    onboardingRate: {
      total: mouPartners3m.length,
      settled: settledCount,
      rate: mouPartners3m.length > 0 ? +(settledCount / mouPartners3m.length * 100).toFixed(1) : 0,
      target: 80
    },
    activePartnerCount: {
      partners: activePartnerCount,
      brands: activeBrandCount,
      total: activePartnerCount + activeBrandCount,
      target: 70
    }
  };

  // ========== TM KPIs (인바운드 로직 재활용, 채널 필터) ==========
  // 파트너/브랜드 ID→이름 맵 (Lead의 PartnerName__c, BrandName__c 변환용)
  const accountNameMap = {};
  partners.forEach(p => { accountNameMap[p.Id] = p.Name; });
  franchiseHQAccounts.forEach(h => { accountNameMap[h.Id] = h.Name; });
  franchiseBrands.forEach(b => { accountNameMap[b.Id] = b.Name; });

  // Lead별 첫 Task 매핑
  const firstTaskByLead = {};
  channelLeadTasks.forEach(task => {
    if (!firstTaskByLead[task.Lead__c]) firstTaskByLead[task.Lead__c] = task;
  });

  // Lead별 전체/마지막/미완료 Task 매핑 (Raw 데이터용)
  const chAllTasksByLead = {};
  const chLastTaskByLead = {};
  const chOpenTasksByLead = {};
  channelLeadTasks.forEach(task => {
    const lid = task.Lead__c;
    if (!chAllTasksByLead[lid]) chAllTasksByLead[lid] = [];
    chAllTasksByLead[lid].push(task);
    if (!chLastTaskByLead[lid] || new Date(task.CreatedDate) > new Date(chLastTaskByLead[lid].CreatedDate)) {
      chLastTaskByLead[lid] = task;
    }
    if (task.Status !== 'Completed') {
      if (!chOpenTasksByLead[lid]) chOpenTasksByLead[lid] = [];
      chOpenTasksByLead[lid].push(task);
    }
  });

  // Lead 데이터 가공 (인바운드와 동일 로직)
  const channelLeadData = channelLeads.map(lead => {
    const firstTask = firstTaskByLead[lead.Id];
    let frtMinutes = null;
    if (firstTask) {
      frtMinutes = Math.round((new Date(firstTask.CreatedDate) - new Date(lead.CreatedDate)) / 1000 / 60 * 10) / 10;
    }
    const mql = isMQL(lead);
    const dateStr = lead.CreatedTime__c ? parseKSTDateTime(lead.CreatedTime__c)?.dateStr : utcToKSTDateStr(lead.CreatedDate);

    const leadTaskList = chAllTasksByLead[lead.Id] || [];
    const lastTask = chLastTaskByLead[lead.Id];
    const openTasks = chOpenTasksByLead[lead.Id] || [];
    const nextOpenTask = openTasks.length > 0
      ? openTasks.sort((a, b) => (a.ActivityDate || '9999') < (b.ActivityDate || '9999') ? -1 : 1)[0]
      : null;

    return {
      id: lead.Id,
      ownerId: lead.OwnerId,
      dateStr,
      frtMinutes,
      frtBucket: classifyFRTBucket(frtMinutes),
      hasTask: !!firstTask,
      frtOk: frtMinutes !== null && frtMinutes <= 20,
      isMQL: mql,
      isSQL: mql && lead.Status === 'Qualified',
      isConverted: !!lead.ConvertedOpportunityId,
      // Task 상세 (Raw 데이터용)
      taskCount: leadTaskList.length,
      lastTaskSubject: lastTask?.Subject || null,
      lastTaskDate: lastTask ? utcToKSTDateStr(lastTask.CreatedDate) : null,
      hasOpenTask: openTasks.length > 0,
      openTaskCount: openTasks.length,
      nextTaskSubject: nextOpenTask?.Subject || null,
      nextTaskDate: nextOpenTask?.ActivityDate || null,
      openTaskList: openTasks.sort((a, b) => (a.ActivityDate || '9999') < (b.ActivityDate || '9999') ? -1 : 1)
        .map(t => ({ taskId: t.Id || null, subject: t.Subject || '-', date: t.ActivityDate || '-', status: t.Status || '-', owner: userNameMap[t.OwnerId] || '-', description: t.Description || null })),
    };
  });

  // 영업기회 전환 일별 집계 (방문배정 = ConvertedDate 기준)
  // Lead 생성일이 아닌 실제 전환일(ConvertedDate)로 카운트 → rawOpenOpps와 일치
  const dailyConversions = {};
  const conversionsByOwner = {};
  const conversionsByOwnerDate = {};  // OwnerId → { date → count } (일별 실적표용)
  channelConvertedLeads.forEach(l => {
    const dateStr = l.ConvertedDate; // YYYY-MM-DD
    if (dateStr && dateStr >= startDate && dateStr <= endDate) {
      dailyConversions[dateStr] = (dailyConversions[dateStr] || 0) + 1;
      if (l.OwnerId) {
        conversionsByOwner[l.OwnerId] = (conversionsByOwner[l.OwnerId] || 0) + 1;
        if (!conversionsByOwnerDate[l.OwnerId]) conversionsByOwnerDate[l.OwnerId] = {};
        conversionsByOwnerDate[l.OwnerId][dateStr] = (conversionsByOwnerDate[l.OwnerId][dateStr] || 0) + 1;
      }
    }
  });
  const totalConversions = Object.values(dailyConversions).reduce((s, v) => s + v, 0);

  // 견적 전환 일별 집계 (방문배정→견적 Stage 전환 = channelStageHistory에서 NewValue='견적')
  const channelOppOwnerMap = {};
  opportunities.forEach(o => { channelOppOwnerMap[o.Id] = o.OwnerId; });
  const dailyQuoteTransitions = {};
  const quoteTransitionsByOwner = {};
  let totalQuoteTransitions = 0;
  channelStageHistory.forEach(h => {
    if (h.NewValue === '견적') {
      const date = utcToKSTDateStr(h.CreatedDate);
      if (date >= startDate && date <= endDate) {
        dailyQuoteTransitions[date] = (dailyQuoteTransitions[date] || 0) + 1;
        totalQuoteTransitions++;
        const ownerId = channelOppOwnerMap[h.OpportunityId];
        if (ownerId) {
          quoteTransitionsByOwner[ownerId] = (quoteTransitionsByOwner[ownerId] || 0) + 1;
        }
      }
    }
  });

  // 채널 견적서 발송 통계 (Quote 오브젝트 기준 — 실제 견적 문서)
  const quoteSentByDate = {};
  const quoteSentByOwner = {};
  const quoteSentByOwnerId = {};  // OwnerId 기준 (tmByOwner 병합용)
  let quoteSentTotal = 0;
  let quoteSentFinal = 0;

  const quoteSentByOwnerIdDate = {};  // OwnerId → { date → count } (일별 실적표용)
  channelQuotes.forEach(q => {
    const date = utcToKSTDateStr(q.CreatedDate);
    const ownerName = q.Opportunity?.Owner?.Name || '-';
    const ownerId = q.Opportunity?.OwnerId || '-';
    const isFinal = q.FinalQuoteCheck__c === 'Y';

    if (!quoteSentByDate[date]) quoteSentByDate[date] = { total: 0, final: 0 };
    quoteSentByDate[date].total++;
    if (isFinal) quoteSentByDate[date].final++;

    if (!quoteSentByOwner[ownerName]) quoteSentByOwner[ownerName] = { name: ownerName, total: 0, final: 0 };
    quoteSentByOwner[ownerName].total++;
    if (isFinal) quoteSentByOwner[ownerName].final++;

    if (!quoteSentByOwnerId[ownerId]) quoteSentByOwnerId[ownerId] = { total: 0, final: 0 };
    quoteSentByOwnerId[ownerId].total++;
    if (isFinal) quoteSentByOwnerId[ownerId].final++;

    // 일별 × 담당자별 견적발송 추적
    if (!quoteSentByOwnerIdDate[ownerId]) quoteSentByOwnerIdDate[ownerId] = {};
    quoteSentByOwnerIdDate[ownerId][date] = (quoteSentByOwnerIdDate[ownerId][date] || 0) + 1;

    quoteSentTotal++;
    if (isFinal) quoteSentFinal++;
  });

  // 합산: 방문배정 + 견적발송(Quote 오브젝트) = TM 총 전환 건수
  const totalTMActions = totalConversions + quoteSentTotal;
  // 인원수: 방문배정 또는 견적발송 실적이 있는 인원
  const activeTmOwnerIds = new Set([...Object.keys(conversionsByOwner), ...Object.keys(quoteSentByOwnerId)]);
  const tmMemberCount = activeTmOwnerIds.size || 1;

  // 담당자별 일별 실적표 (방문배정 + 견적발송 피벗)
  const allDates = new Set([...Object.keys(dailyConversions), ...Object.keys(quoteSentByDate)]);
  const dailyByOwner = [];
  activeTmOwnerIds.forEach(ownerId => {
    const ownerName = userNameMap[ownerId] || ownerId;
    const visitByDate = conversionsByOwnerDate[ownerId] || {};
    const quoteByDate = quoteSentByOwnerIdDate[ownerId] || {};
    const ownerDates = new Set([...Object.keys(visitByDate), ...Object.keys(quoteByDate)]);
    ownerDates.forEach(date => {
      const visit = visitByDate[date] || 0;
      const quote = quoteByDate[date] || 0;
      dailyByOwner.push({ date, ownerName, visit, quote, total: visit + quote });
    });
  });
  dailyByOwner.sort((a, b) => b.date.localeCompare(a.date) || a.ownerName.localeCompare(b.ownerName));

  // FRT
  const chWithTask = channelLeadData.filter(l => l.hasTask);
  const chFrtOk = channelLeadData.filter(l => l.frtOk);
  const chFrtOver20 = chWithTask.filter(l => !l.frtOk);
  const chFrtBuckets = {};
  chWithTask.forEach(l => {
    const bucket = l.frtBucket;
    chFrtBuckets[bucket] = (chFrtBuckets[bucket] || 0) + 1;
  });

  // MQL→SQL 미전환
  const chMQL = channelLeadData.filter(l => l.isMQL);
  const chSQL = channelLeadData.filter(l => l.isSQL);
  const chUnconvertedMQL = chMQL.filter(l => !l.isSQL && !l.isConverted);

  // 7일 초과 SQL 잔량 — TM 구간 (방문배정~견적 단계만)
  const tmStageSet = new Set(['방문배정', '견적', '재견적']);
  const channelOpenOpps = opportunities.filter(o => !o.IsClosed);
  const tmOpenOpps = channelOpenOpps.filter(o => tmStageSet.has(o.StageName));
  const tmOver7 = tmOpenOpps.filter(o => (o.AgeInDays || 0) > 7);

  // Raw 데이터: 미달 건 상세 (채널 TM)
  const chLeadRawMap = {};
  channelLeads.forEach(l => { chLeadRawMap[l.Id] = l; });
  const chSafeStr = (v) => (v && v !== 'null') ? v : null;
  const chLeadCreatedKST = (raw) => {
    if (raw?.CreatedTime__c) return raw.CreatedTime__c.substring(0, 10);
    return utcToKSTDateStr(raw?.CreatedDate) || '-';
  };
  const chClosedStatuses = new Set(['종료', 'Closed', 'Unqualified', 'Recycled']);
  const chIsClosedStatus = (status) => chClosedStatuses.has(status);
  const chLeadTimeInfo = (raw) => {
    if (raw?.CreatedTime__c) {
      const parsed = parseKSTDateTime(raw.CreatedTime__c);
      if (parsed) return { createdHour: parsed.hour, createdDow: parsed.dayOfWeek };
    }
    if (raw?.CreatedDate) {
      const d = new Date(raw.CreatedDate);
      const kst = new Date(d.getTime() + 9 * 3600000);
      return { createdHour: kst.getUTCHours(), createdDow: kst.getUTCDay() };
    }
    return { createdHour: null, createdDow: null };
  };

  // FRT 시간대별 준수율 (영업시간/영업외/주말) — TM
  const chFrtByTimeSlot = { biz: { ok: 0, total: 0 }, offHour: { ok: 0, total: 0 }, weekend: { ok: 0, total: 0 } };
  chWithTask.forEach(l => {
    const raw = chLeadRawMap[l.id];
    const ti = chLeadTimeInfo(raw);
    const dow = ti.createdDow;
    const hour = ti.createdHour;
    let slot = 'biz';
    if (dow === 0 || dow === 6) slot = 'weekend';
    else if (hour !== null && (hour < 10 || hour >= 19)) slot = 'offHour';
    chFrtByTimeSlot[slot].total++;
    if (l.frtOk) chFrtByTimeSlot[slot].ok++;
  });

  const chRawFrtOver20 = chFrtOver20.map(l => {
    const raw = chLeadRawMap[l.id];
    const status = raw?.Status || '-';
    const ti = chLeadTimeInfo(raw);
    return {
      leadId: l.id,
      name: chSafeStr(raw?.Company) || chSafeStr(raw?.Name) || '-',
      contactName: chSafeStr(raw?.Name) || '-',
      company: chSafeStr(raw?.Company) || '-',
      owner: userNameMap[l.ownerId] || l.ownerId,
      partnerName: raw?.PartnerName__c ? (accountNameMap[raw.PartnerName__c] || null) : null,
      brandName: raw?.BrandName__c ? (accountNameMap[raw.BrandName__c] || null) : null,
      leadSource: raw?.LeadSource || null,
      createdDate: chLeadCreatedKST(raw),
      createdHour: ti.createdHour,
      createdDow: ti.createdDow,
      status,
      group: chIsClosedStatus(status) ? 'closed' : (status === 'Qualified' ? 'qualified' : 'open'),
      taskCount: l.taskCount,
      lastTaskSubject: chSafeStr(l.lastTaskSubject) || '-',
      lastTaskDate: l.lastTaskDate || '-',
      frtMinutes: l.frtMinutes ? Math.round(l.frtMinutes) : null,
      frtBucket: l.frtBucket,
      lossReason: chSafeStr(raw?.LossReason__c) || '-',
      lossReasonSub: chSafeStr(raw?.LossReason_Contract__c) || '-',
      lossReasonDetail: chSafeStr(raw?.LossReasonDetail__c) || '-',
      hasOpenTask: l.hasOpenTask,
      openTaskCount: l.openTaskCount,
      nextTaskSubject: l.nextTaskSubject || '-',
      nextTaskDate: l.nextTaskDate || '-',
      openTaskList: l.openTaskList || [],
    };
  }).sort((a, b) => {
    const groupOrder = { open: 0, closed: 1, qualified: 2 };
    const gDiff = (groupOrder[a.group] ?? 9) - (groupOrder[b.group] ?? 9);
    if (gDiff !== 0) return gDiff;
    return (b.frtMinutes || 0) - (a.frtMinutes || 0);
  });

  const chRawUnconvertedMQL = chUnconvertedMQL.map(l => {
    const raw = chLeadRawMap[l.id];
    const status = raw?.Status || '-';
    return {
      leadId: l.id,
      name: chSafeStr(raw?.Company) || chSafeStr(raw?.Name) || '-',
      contactName: chSafeStr(raw?.Name) || '-',
      company: chSafeStr(raw?.Company) || '-',
      owner: userNameMap[l.ownerId] || l.ownerId,
      partnerName: raw?.PartnerName__c ? (accountNameMap[raw.PartnerName__c] || null) : null,
      brandName: raw?.BrandName__c ? (accountNameMap[raw.BrandName__c] || null) : null,
      leadSource: raw?.LeadSource || null,
      createdDate: chLeadCreatedKST(raw),
      status,
      group: chIsClosedStatus(status) ? 'closed' : 'open',
      taskCount: l.taskCount,
      lastTaskSubject: chSafeStr(l.lastTaskSubject) || '-',
      lastTaskDate: l.lastTaskDate || '-',
      lossReason: chSafeStr(raw?.LossReason__c) || '-',
      lossReasonSub: chSafeStr(raw?.LossReason_Contract__c) || '-',
      lossReasonDetail: chSafeStr(raw?.LossReasonDetail__c) || '-',
      hasOpenTask: l.hasOpenTask,
      openTaskCount: l.openTaskCount,
      nextTaskSubject: l.nextTaskSubject || '-',
      nextTaskDate: l.nextTaskDate || '-',
      openTaskList: l.openTaskList || [],
    };
  }).sort((a, b) => {
    const groupOrder = { open: 0, closed: 1 };
    return (groupOrder[a.group] ?? 9) - (groupOrder[b.group] ?? 9);
  });

  // TM 담당자별 집계
  const tmByOwner = {};
  channelLeadData.forEach(l => {
    const ownerName = userNameMap[l.ownerId] || l.ownerId;
    if (!tmByOwner[l.ownerId]) {
      tmByOwner[l.ownerId] = { name: ownerName, lead: 0, mql: 0, sql: 0, converted: 0, quoteTransitions: 0, quoteSent: 0, quoteSentFinal: 0, withTask: 0, frtOk: 0, frtSum: 0, unconvertedMQL: 0 };
    }
    const o = tmByOwner[l.ownerId];
    o.lead++;
    if (l.isMQL) o.mql++;
    if (l.isSQL) o.sql++;
    // converted는 ConvertedDate 기준으로 별도 적용 (아래)
    if (l.hasTask) { o.withTask++; o.frtSum += l.frtMinutes; }
    if (l.frtOk) o.frtOk++;
    if (l.isMQL && !l.isSQL && !l.isConverted) o.unconvertedMQL++;
  });
  // 담당자별 방문배정 건수 (ConvertedDate 기준)
  Object.entries(conversionsByOwner).forEach(([ownerId, count]) => {
    if (!tmByOwner[ownerId]) {
      const ownerName = userNameMap[ownerId] || ownerId;
      tmByOwner[ownerId] = { name: ownerName, lead: 0, mql: 0, sql: 0, converted: 0, quoteTransitions: 0, quoteSent: 0, quoteSentFinal: 0, withTask: 0, frtOk: 0, frtSum: 0, unconvertedMQL: 0 };
    }
    tmByOwner[ownerId].converted = count;
  });
  // 담당자별 견적 전환 건수 합산 (Stage 전환 기반 — 참고용)
  Object.entries(quoteTransitionsByOwner).forEach(([ownerId, count]) => {
    if (tmByOwner[ownerId]) tmByOwner[ownerId].quoteTransitions = count;
  });
  // 담당자별 견적 발송 건수 합산 (Quote 오브젝트 기준 — KPI 계산에 사용)
  Object.entries(quoteSentByOwnerId).forEach(([ownerId, qs]) => {
    if (!tmByOwner[ownerId]) {
      const ownerName = userNameMap[ownerId] || ownerId;
      tmByOwner[ownerId] = { name: ownerName, lead: 0, mql: 0, sql: 0, converted: 0, quoteTransitions: 0, quoteSent: 0, quoteSentFinal: 0, withTask: 0, frtOk: 0, frtSum: 0, unconvertedMQL: 0 };
    }
    tmByOwner[ownerId].quoteSent = qs.total;
    tmByOwner[ownerId].quoteSentFinal = qs.final;
  });

  const tmOwnerStats = Object.entries(tmByOwner).map(([ownerId, o]) => {
    const totalActions = o.converted + o.quoteSent; // 방문배정 + 견적발송(Quote 오브젝트)
    return {
      userId: ownerId, name: o.name,
      lead: o.lead, mql: o.mql, sql: o.sql,
      converted: o.converted, quoteTransitions: o.quoteTransitions,
      quoteSent: o.quoteSent, quoteSentFinal: o.quoteSentFinal,
      totalActions,
      avgDailyActions: totalWeekdays > 0 ? +(totalActions / totalWeekdays).toFixed(1) : 0,
      avgDailyConversion: totalWeekdays > 0 ? +(o.converted / totalWeekdays).toFixed(1) : 0,
      frtOk: o.frtOk, frtOver20: o.withTask - o.frtOk,
      avgFrt: o.withTask > 0 ? +(o.frtSum / o.withTask).toFixed(1) : null,
      unconvertedMQL: o.unconvertedMQL
    };
  }).sort((a, b) => b.lead - a.lead);

  const tm = {
    dailyConversion: {
      visitAssigned: totalConversions,        // 방문배정 건수
      quoteSent: quoteSentTotal,              // 견적 발송 건수 (Quote 오브젝트 기준)
      quoteSentFinal: quoteSentFinal,         // 최종 견적 발송 건수
      quoteTransitions: totalQuoteTransitions, // Stage 전환 건수 (참고용)
      total: totalTMActions,                   // 합산 (방문배정 + 견적발송)
      avgDaily: totalWeekdays > 0 ? +(totalTMActions / totalWeekdays).toFixed(1) : 0,
      avgDailyPerPerson: totalWeekdays > 0 && tmMemberCount > 0
        ? +(totalTMActions / (tmMemberCount * totalWeekdays)).toFixed(1) : 0,
      tmMemberCount,
      totalWeekdays,
      target_daily: 5  // 인당 일 5건 목표
    },
    frt: {
      totalWithTask: chWithTask.length,
      frtOk: chFrtOk.length,
      frtOver20: chFrtOver20.length,
      target_frtOver20: 0,
      avgFrtMinutes: chWithTask.length > 0 ? +(chWithTask.reduce((s, l) => s + l.frtMinutes, 0) / chWithTask.length).toFixed(1) : null,
      buckets: chFrtBuckets,
      byTimeSlot: {
        biz: { ...chFrtByTimeSlot.biz, rate: chFrtByTimeSlot.biz.total > 0 ? +(chFrtByTimeSlot.biz.ok / chFrtByTimeSlot.biz.total * 100).toFixed(1) : 0 },
        offHour: { ...chFrtByTimeSlot.offHour, rate: chFrtByTimeSlot.offHour.total > 0 ? +(chFrtByTimeSlot.offHour.ok / chFrtByTimeSlot.offHour.total * 100).toFixed(1) : 0 },
        weekend: { ...chFrtByTimeSlot.weekend, rate: chFrtByTimeSlot.weekend.total > 0 ? +(chFrtByTimeSlot.weekend.ok / chFrtByTimeSlot.weekend.total * 100).toFixed(1) : 0 },
      }
    },
    unconvertedMQL: {
      count: chUnconvertedMQL.length,
      target: 0,
      funnel: { lead: channelLeadData.length, mql: chMQL.length, sql: chSQL.length }
    },
    sqlBacklog: {
      openTotal: tmOpenOpps.length,     // TM 구간(방문배정~견적) Open Opp 총수
      over7: tmOver7.length,            // TM 구간 7일 초과 건수
      target: 10,                       // 10건 이내 유지 목표
      byOwner: (() => {
        const ownerMap = {};
        tmOpenOpps.forEach(o => {
          const name = o.Owner?.Name || userNameMap[o.OwnerId] || '-';
          if (!ownerMap[name]) ownerMap[name] = { name, total: 0, over7: 0, stages: {} };
          ownerMap[name].total++;
          if ((o.AgeInDays || 0) > 7) ownerMap[name].over7++;
          const st = o.StageName || '-';
          ownerMap[name].stages[st] = (ownerMap[name].stages[st] || 0) + 1;
        });
        return Object.values(ownerMap).sort((a, b) => b.total - a.total);
      })()
    },
    quoteSent: {
      total: quoteSentTotal,
      final: quoteSentFinal,
      byOwner: Object.values(quoteSentByOwner).sort((a, b) => b.total - a.total),
      byDate: quoteSentByDate,
    },
    byOwner: tmOwnerStats,
    rawData: {
      frtOver20: chRawFrtOver20,
      unconvertedMQL: chRawUnconvertedMQL,
    }
  };

  // ========== Channel Back Office KPIs ==========
  // 이번 달 생성된 Opportunity만 필터 (CreatedDate 기준, KST 보정)
  const boStartUTC = new Date(kstToUTC(startDate, true)).getTime();
  const boEndUTC = new Date(kstToUTC(endDate, false)).getTime();
  const thisMonthCreatedOpps = opportunities.filter(o => {
    const created = new Date(o.CreatedDate).getTime();
    return created >= boStartUTC && created <= boEndUTC;
  });
  const thisMonthCreatedClosed = thisMonthCreatedOpps.filter(o => o.IsClosed);
  const thisMonthCreatedOpen = thisMonthCreatedOpps.filter(o => !o.IsClosed);

  // --- Lead 기준: SQL(total) / Open ---
  const chBoStats = {};
  thisMonthCreatedOpps.forEach(o => {
    const boId = o.BOUser__c || '__unassigned__';
    if (!chBoStats[boId]) {
      chBoStats[boId] = {
        name: boId === '__unassigned__' ? '(미배정)' : (userNameMap[boId] || boId),
        total: 0, open: 0,
        openByAge: { within3: 0, day4to7: 0, over7: 0 },
      };
    }
    chBoStats[boId].total++;
    if (!o.IsClosed) {
      chBoStats[boId].open++;
      const age = o.AgeInDays || 0;
      if (age < 7) chBoStats[boId].openByAge.within3++;
      else chBoStats[boId].openByAge.over7++;
    }
  });

  // --- History 기준: CW/CL (OpportunityFieldHistory 실제 변경일 기준) ---
  // 채널 BO의 History = stageChangeHistory 중 채널세일즈 부서 OR 인바운드가 아닌 Opp
  const closedOpps = opportunities.filter(o => o.IsClosed);
  const channelOppIds = new Set(opportunities.map(o => o.Id));
  const channelHistory = stageChangeHistory.filter(h => channelOppIds.has(h.oppId));
  const chBoHistoryStats = {};
  const thisMonthChannelOppIdsForDaily = new Set(channelLeads.filter(l => l.ConvertedOpportunityId).map(l => l.ConvertedOpportunityId));
  channelHistory.forEach(h => {
    const boId = h.boUserId || '__unassigned__';
    if (!chBoHistoryStats[boId]) {
      chBoHistoryStats[boId] = {
        name: h.boUserName || (boId === '__unassigned__' ? '(미배정)' : boId),
        cw: 0, cl: 0,
        dailyClose: {},
      };
    }
    const bh = chBoHistoryStats[boId];
    const isThisMonth = thisMonthChannelOppIdsForDaily.has(h.oppId);
    if (!bh.dailyClose[h.changeDate]) {
      bh.dailyClose[h.changeDate] = { cw: 0, cl: 0, thisMonthCW: 0, thisMonthCL: 0, carryoverCW: 0, carryoverCL: 0 };
    }
    const dc = bh.dailyClose[h.changeDate];
    if (h.isCW) {
      bh.cw++;
      dc.cw++;
      if (isThisMonth) dc.thisMonthCW++; else dc.carryoverCW++;
    }
    if (h.isCL) {
      bh.cl++;
      dc.cl++;
      if (isThisMonth) dc.thisMonthCL++; else dc.carryoverCL++;
    }
  });

  // Lead 기준 + History 기준 병합
  const thisMonthChannelOppIds = new Set(channelLeads.filter(l => l.ConvertedOpportunityId).map(l => l.ConvertedOpportunityId));
  const chBoList = Object.entries(chBoStats).map(([userId, stats]) => {
    const hist = chBoHistoryStats[userId] || { cw: 0, cl: 0, dailyClose: {} };
    const closeDates = Object.entries(hist.dailyClose);
    const totalCloseActions = closeDates.reduce((sum, [_, d]) => sum + d.cw + d.cl, 0);
    const closeDays = closeDates.length;
    const historyCW = channelHistory.filter(h => (h.boUserId || '__unassigned__') === userId && h.isCW);
    const historyCL = channelHistory.filter(h => (h.boUserId || '__unassigned__') === userId && h.isCL);
    const carryoverCW = historyCW.filter(h => !thisMonthChannelOppIds.has(h.oppId)).length;
    const carryoverCL = historyCL.filter(h => !thisMonthChannelOppIds.has(h.oppId)).length;
    const totalThisMonth = closeDates.reduce((s, [_, d]) => s + (d.thisMonthCW || 0) + (d.thisMonthCL || 0), 0);
    const totalCarryover = closeDates.reduce((s, [_, d]) => s + (d.carryoverCW || 0) + (d.carryoverCL || 0), 0);
    return {
      userId, name: stats.name,
      total: stats.total,
      cw: hist.cw, cl: hist.cl,
      open: stats.open,
      over7: stats.openByAge.over7,
      carryoverCW, carryoverCL,
      thisMonthCW: hist.cw - carryoverCW,
      thisMonthCL: hist.cl - carryoverCL,
      // 전환율: 이번달 SQL 전체 대비 이번달 CW
      cwRate: stats.total > 0 ? +((hist.cw - carryoverCW) / stats.total * 100).toFixed(1) : 0,
      avgDailyClose: closeDays > 0 ? +(totalCloseActions / closeDays).toFixed(1) : 0,
      avgDailyCloseThisMonth: closeDays > 0 ? +(totalThisMonth / closeDays).toFixed(1) : 0,
      avgDailyCloseCarryover: closeDays > 0 ? +(totalCarryover / closeDays).toFixed(1) : 0,
      closeDays,
    };
  }).sort((a, b) => b.total - a.total);

  // cwWithCarryover (이전 호환 유지, History 기준으로 업데이트)
  const chBoCarryoverList = chBoList.map(b => ({
    userId: b.userId, name: b.name,
    totalClosed: b.cw + b.cl, cw: b.cw, cl: b.cl,
    carryoverCW: b.carryoverCW, carryoverCL: b.carryoverCL,
    thisMonthCW: b.thisMonthCW,
    cwRate: b.cwRate,
  })).filter(b => (b.cw + b.cl) > 0).sort((a, b) => b.cw - a.cw);

  // ========== 채널 BO Raw Data ==========
  // SQL 잔량 메트릭: 전체 진행중 Opp (날짜 무관 — 잔량 추적)
  const channelTotalOpenOpps = opportunities.filter(o => !o.IsClosed);
  // Raw 테이블: 이번달 생성 Open Opp만 표시 (인사이드처럼 월 기준)
  const channelAllOpenOpps = thisMonthCreatedOpen;

  // 채널 Opp별 Task 매핑
  const chTasksByOpp = {};
  (channelOppTasks || []).forEach(t => {
    if (!chTasksByOpp[t.WhatId]) chTasksByOpp[t.WhatId] = [];
    chTasksByOpp[t.WhatId].push(t);
  });

  // 채널 Opp별 Stage History 그룹핑
  const stageHistByOpp = {};
  channelStageHistory.forEach(h => {
    if (!stageHistByOpp[h.OpportunityId]) stageHistByOpp[h.OpportunityId] = [];
    stageHistByOpp[h.OpportunityId].push(h);
  });

  // Stage 체류시간 계산 함수
  function calcStageDwell(opp, histRecords) {
    const now = new Date();
    const created = new Date(opp.CreatedDate);
    const records = (histRecords || []).sort((a, b) => new Date(a.CreatedDate) - new Date(b.CreatedDate));

    const stages = [];
    let prevDate = created;
    let prevStage = records.length > 0 ? records[0].OldValue : opp.StageName;

    for (const r of records) {
      const changeDate = new Date(r.CreatedDate);
      const dwellDays = Math.round((changeDate - prevDate) / (1000 * 60 * 60 * 24) * 10) / 10;
      stages.push({ stage: prevStage, enteredDate: prevDate.toISOString().substring(0, 10), exitDate: changeDate.toISOString().substring(0, 10), dwellDays });
      prevDate = changeDate;
      prevStage = r.NewValue;
    }

    // 현재 단계 (진행중)
    const currentDwell = Math.round((now - prevDate) / (1000 * 60 * 60 * 24) * 10) / 10;
    stages.push({ stage: prevStage, enteredDate: prevDate.toISOString().substring(0, 10), exitDate: null, dwellDays: currentDwell });

    // 병목 = 가장 오래 머문 단계
    const bottleneck = stages.reduce((max, s) => s.dwellDays > max.dwellDays ? s : max, stages[0]);
    return { stages, bottleneck };
  }

  // 채널 Visit 매핑
  const chVisitByOpp = {};
  (channelVisits || []).forEach(v => {
    const oppId = v.Opportunity__c;
    if (!oppId) return;
    if (!chVisitByOpp[oppId]) chVisitByOpp[oppId] = { visits: [] };
    chVisitByOpp[oppId].visits.push(v);
  });
  const chToday = new Date();
  chToday.setHours(0, 0, 0, 0);
  Object.entries(chVisitByOpp).forEach(([oppId, info]) => {
    const completed = info.visits.filter(v => v.Visit_Status__c === '방문완료');
    const scheduled = info.visits.filter(v => v.Visit_Status__c !== '방문완료' && v.Visit_Status__c !== '방문취소');
    info.hasVisitComplete = completed.length > 0;
    info.visitCount = info.visits.length;
    info.completedCount = completed.length;
    info.lastVisitDate = null;
    info.nextVisitDate = null;
    info.daysSinceVisit = null;
    info.bizDaysSinceVisit = null;
    info.visitDurationMin = null;
    if (completed.length > 0) {
      const latest = completed.sort((a, b) => (b.LocalInviteDate__c || b.ConselStart__c || '').localeCompare(a.LocalInviteDate__c || a.ConselStart__c || ''))[0];
      const completeDateStr = latest.LocalInviteDate__c || latest.ConselStart__c || latest.VisitAssignmentDate__c;
      if (completeDateStr) {
        info.lastVisitDate = utcToKSTDateStr(completeDateStr);
        const vd = new Date(completeDateStr);
        vd.setHours(0, 0, 0, 0);
        info.daysSinceVisit = Math.floor((chToday - vd) / (1000 * 60 * 60 * 24));
        info.bizDaysSinceVisit = countBizDays(vd, chToday);
      }
      // 방문 소요 시간 (ConselStart → ConselEnd)
      if (latest.ConselStart__c && latest.ConselEnd__c) {
        const startMs = new Date(latest.ConselStart__c).getTime();
        const endMs = new Date(latest.ConselEnd__c).getTime();
        if (endMs > startMs) {
          info.visitDurationMin = Math.round((endMs - startMs) / (1000 * 60));
        }
      }
    }
    // 예정된 방문 일자 (LocalInviteDate__c → ConselStart__c → VisitAssignmentDate__c 우선순위)
    if (scheduled.length > 0) {
      const withDate = scheduled.filter(v => v.LocalInviteDate__c || v.ConselStart__c || v.VisitAssignmentDate__c);
      if (withDate.length > 0) {
        const earliest = withDate.sort((a, b) => {
          const da = a.LocalInviteDate__c || a.ConselStart__c || a.VisitAssignmentDate__c || '';
          const db = b.LocalInviteDate__c || b.ConselStart__c || b.VisitAssignmentDate__c || '';
          return da.localeCompare(db);
        })[0];
        const scheduleDateStr = earliest.LocalInviteDate__c || earliest.ConselStart__c || earliest.VisitAssignmentDate__c;
        if (scheduleDateStr) {
          info.nextVisitDate = utcToKSTDateStr(scheduleDateStr);
        }
      }
    }
    info.visitStatus = completed.length > 0 ? '방문완료' : scheduled.length > 0 ? '방문예정' : '방문취소';
  });

  // OppId → 파트너/프랜차이즈 매핑 (Lead 전환 정보에서 역추적)
  const oppPartnerMap = {};
  [...channelLeads, ...sourceLeads].forEach(l => {
    if (l.ConvertedOpportunityId && (l.PartnerName__c || l.BrandName__c)) {
      oppPartnerMap[l.ConvertedOpportunityId] = {
        partnerName: l.PartnerName__c ? (accountNameMap[l.PartnerName__c] || null) : null,
        brandName: l.BrandName__c ? (accountNameMap[l.BrandName__c] || null) : null,
      };
    }
  });

  // chRawOpenOpps: 채널 진행중 Opp 개별 건 (BOUser 미배정 포함)
  const chRawOpenOpps = channelAllOpenOpps
    .map(o => {
      const tasks = chTasksByOpp[o.Id] || [];
      const lastTask = tasks.length > 0 ? tasks[tasks.length - 1] : null;
      const openTasks = tasks.filter(t => t.Status !== 'Completed');
      const nextOpenTask = openTasks.length > 0
        ? openTasks.sort((a, b) => (a.ActivityDate || '9999').localeCompare(b.ActivityDate || '9999'))[0]
        : null;
      const vi = chVisitByOpp[o.Id];
      return {
        oppId: o.Id,
        name: o.Name || o.Id,
        accountName: o.Account?.Name || '-',
        boUser: o.BOUser__c ? (userNameMap[o.BOUser__c] || o.BOUser__c) : '(미배정)',
        fieldUser: userNameMap[o.FieldUser__c] || o.FieldUser__c || '-',
        ownerName: o.Owner?.Name || userNameMap[o.OwnerId] || '-',
        stageName: o.StageName,
        hasContract: !!(o.ContractOpportunities__r && o.ContractOpportunities__r.records && o.ContractOpportunities__r.records.length > 0),
        companyStatus: o.fm_CompanyStatus__c || '-',
        amount: o.Amount || 0,
        ageInDays: o.AgeInDays || 0,
        ageBucket: classifyAgeBucket(o.AgeInDays || 0),
        closeDate: o.CloseDate || '-',
        installHopeDate: o.InstallHopeDate__c || '-',
        createdDate: utcToKSTDateStr(o.CreatedDate),
        // 과업 정보
        taskCount: tasks.length,
        lastTaskSubject: lastTask?.Subject || '-',
        lastTaskDate: lastTask ? utcToKSTDateStr(lastTask.CreatedDate) : '-',
        hasOpenTask: openTasks.length > 0,
        openTaskCount: openTasks.length,
        nextTaskSubject: nextOpenTask?.Subject || '-',
        nextTaskDate: nextOpenTask?.ActivityDate || '-',
        openTaskList: openTasks.sort((a, b) => (a.ActivityDate || '9999') < (b.ActivityDate || '9999') ? -1 : 1)
          .map(t => ({ taskId: t.Id || null, subject: t.Subject || '-', date: t.ActivityDate || '-', status: t.Status || '-', owner: userNameMap[t.OwnerId] || '-', description: t.Description || null })),
        lastTouch: lastTask ? utcToKSTDateStr(lastTask.CreatedDate) : '-',
        tasks: tasks.map(t => ({
          id: t.Id,
          subject: t.Subject || '-',
          description: t.Description || '',
          status: t.Status || '-',
          activityDate: t.ActivityDate || null,
          createdDate: utcToKSTDateStr(t.CreatedDate),
        })),
        // 방문 정보
        visitCompleteDate: vi?.lastVisitDate || null,
        visitScheduleDate: vi?.nextVisitDate || null,
        daysSinceVisit: vi?.daysSinceVisit ?? null,
        bizDaysSinceVisit: vi?.bizDaysSinceVisit ?? null,
        daysToVisit: (() => {
          const cd = utcToKSTDateStr(o.CreatedDate);
          const vd = vi?.lastVisitDate;
          if (!cd || !vd) return null;
          const diff = Math.floor((new Date(vd) - new Date(cd)) / (1000 * 60 * 60 * 24));
          return diff >= 0 ? diff : 0;
        })(),
        // 파트너/프랜차이즈 정보 (Lead 역추적)
        partnerName: oppPartnerMap[o.Id]?.partnerName || null,
        brandName: oppPartnerMap[o.Id]?.brandName || null,
        // Stage 체류시간 분석
        ...(() => {
          const hist = stageHistByOpp[o.Id] || [];
          const { stages, bottleneck } = calcStageDwell(o, hist);
          return {
            stageHistory: stages,
            bottleneckStage: bottleneck.stage,
            bottleneckDays: bottleneck.dwellDays,
            currentStageDays: stages[stages.length - 1].dwellDays,
          };
        })(),
      };
    })
    .sort((a, b) => b.ageInDays - a.ageInDays);

  // TM/BO Stage 분리: TM = 견적 이전(방문배정, 견적, 재견적), BO = 견적 이후(선납금~)
  const TM_STAGES = ['방문배정', '견적', '재견적'];
  const chRawOpenOpps_TM = chRawOpenOpps.filter(o => TM_STAGES.includes(o.stageName));
  const chRawOpenOpps_BO = chRawOpenOpps.filter(o => !TM_STAGES.includes(o.stageName));
  console.log(`  📊 채널 Open Opp 분리 (이번달): TM ${chRawOpenOpps_TM.length}건, BO ${chRawOpenOpps_BO.length}건`);

  // TM SQL 잔량 Raw: 전체 Open Opp (날짜 무관 — 담당자별 합계와 일치시키기 위해)
  const chRawOpenOpps_TM_All = channelTotalOpenOpps
    .filter(o => TM_STAGES.includes(o.StageName))
    .map(o => {
      const tasks = chTasksByOpp[o.Id] || [];
      const lastTask = tasks.length > 0 ? tasks[tasks.length - 1] : null;
      const openTasks = tasks.filter(t => t.Status !== 'Completed');
      const vi = chVisitByOpp[o.Id];
      return {
        oppId: o.Id,
        name: o.Name || o.Id,
        accountName: o.Account?.Name || '-',
        ownerName: o.Owner?.Name || userNameMap[o.OwnerId] || '-',
        stageName: o.StageName,
        amount: o.Amount || 0,
        ageInDays: o.AgeInDays || 0,
        createdDate: utcToKSTDateStr(o.CreatedDate),
        hasOpenTask: openTasks.length > 0,
        openTaskList: openTasks.sort((a, b) => (a.ActivityDate || '9999') < (b.ActivityDate || '9999') ? -1 : 1)
          .map(t => ({ taskId: t.Id || null, subject: t.Subject || '-', date: t.ActivityDate || '-', status: t.Status || '-', owner: userNameMap[t.OwnerId] || '-', description: t.Description || null })),
        lastTouch: lastTask ? utcToKSTDateStr(lastTask.CreatedDate) : '-',
        visitCompleteDate: vi?.lastVisitDate || null,
        visitScheduleDate: vi?.nextVisitDate || null,
        daysSinceVisit: vi?.daysSinceVisit ?? null,
        partnerName: oppPartnerMap[o.Id]?.partnerName || null,
        brandName: oppPartnerMap[o.Id]?.brandName || null,
      };
    })
    .sort((a, b) => b.ageInDays - a.ageInDays);
  console.log(`  📊 채널 Open Opp 분리 (전체): TM_All ${chRawOpenOpps_TM_All.length}건`);

  // chRawClosedOpps: 채널 이번달 마감 Opp 개별 건 (History 기준 — 실제 변경일)
  const chClosedOppMap = {};
  closedOpps.forEach(o => { chClosedOppMap[o.Id] = o; });
  const chRawClosedOpps = channelHistory
    .map(h => {
      const opp = chClosedOppMap[h.oppId];
      return {
        oppId: h.oppId,
        name: h.oppName || h.oppId,
        accountName: h.accountName || '-',
        boUser: h.boUserName || '(미배정)',
        fieldUser: h.fieldUserName || '-',
        stageName: h.stageName,
        oldStage: h.oldStage || '-',
        lossReason: '-',
        companyStatus: h.companyStatus || '-',
        hasContract: !!(opp?.ContractOpportunities__r?.records?.length),
        changeDate: h.changeDate,
        closeDate: h.closeDate,
        installHopeDate: h.installHopeDate || '-',
        createdDate: opp ? utcToKSTDateStr(opp.CreatedDate) : '-',
        createdMonth: opp ? (opp.CreatedDate || '').substring(0, 7) : '-',
        isCarryover: !thisMonthChannelOppIds.has(h.oppId),
        partnerName: oppPartnerMap[h.oppId]?.partnerName || null,
        brandName: oppPartnerMap[h.oppId]?.brandName || null,
      };
    })
    .sort((a, b) => (b.changeDate || '').localeCompare(a.changeDate || ''));

  // 채널 에이징 분포
  const chAgingSummary = { within3: 0, day4to7: 0, over7: 0, over14: 0, over30: 0 };
  chRawOpenOpps.forEach(o => { chAgingSummary[o.ageBucket] = (chAgingSummary[o.ageBucket] || 0) + 1; });

  // 채널 종료사유 분포
  const chLossReasonSummary = {};
  chRawClosedOpps.filter(o => o.stageName === 'Closed Lost').forEach(o => {
    const reason = o.lossReason || '(미입력)';
    chLossReasonSummary[reason] = (chLossReasonSummary[reason] || 0) + 1;
  });

  // 계약 기반 집계 (채널)
  const channelContracts = (contracts || []).filter(c => c.ownerDept === '채널세일즈');
  const channelContractsByType = {};
  channelContracts.forEach(c => {
    const t = c.recordTypeName || '기타';
    channelContractsByType[t] = (channelContractsByType[t] || 0) + 1;
  });
  const channelNewContracts = channelContracts.filter(c => c.recordTypeName && c.recordTypeName.includes('신규'));
  const channelAddInstallContracts = channelContracts.filter(c => c.recordTypeName && c.recordTypeName.includes('추가설치'));
  const channelNewFromCarryover = channelNewContracts.filter(c => c.oppId && !thisMonthChannelOppIds.has(c.oppId));
  const chContractByBO = {};
  channelContracts.forEach(c => {
    const bo = c.boUser || '(미지정)';
    if (!chContractByBO[bo]) chContractByBO[bo] = { total: 0, new: 0, newCarryover: 0, addInstall: 0, tablets: 0 };
    chContractByBO[bo].total++;
    chContractByBO[bo].tablets += c.tabletQty || 0;
    if (c.recordTypeName?.includes('신규')) {
      chContractByBO[bo].new++;
      if (c.oppId && !thisMonthChannelOppIds.has(c.oppId)) chContractByBO[bo].newCarryover++;
    } else if (c.recordTypeName?.includes('추가설치')) chContractByBO[bo].addInstall++;
  });

  // BO 배정 후 리드타임: 견적 이후 단계(선납금~) Open Opp 중 AgeInDays > 1일인 건 추적
  const boLeadTimeByUser = {};
  chRawOpenOpps_BO.forEach(o => {
    const name = o.boUser || '(미배정)';
    if (!boLeadTimeByUser[name]) boLeadTimeByUser[name] = { name, open: 0, overdue: 0, totalAge: 0 };
    boLeadTimeByUser[name].open++;
    boLeadTimeByUser[name].totalAge += (o.currentStageDays ?? o.ageInDays ?? 0);
    if ((o.currentStageDays ?? o.ageInDays ?? 0) > 1) boLeadTimeByUser[name].overdue++;
  });
  const boLeadTimeUsers = Object.values(boLeadTimeByUser).map(u => ({
    ...u,
    avgAge: u.open > 0 ? +(u.totalAge / u.open).toFixed(1) : 0,
  })).sort((a, b) => b.overdue - a.overdue);
  const boOverdueTotal = chRawOpenOpps_BO.filter(o => (o.currentStageDays ?? o.ageInDays ?? 0) > 1).length;
  const boSameDayRate = chRawOpenOpps_BO.length > 0
    ? +(((chRawOpenOpps_BO.length - boOverdueTotal) / chRawOpenOpps_BO.length) * 100).toFixed(1)
    : 100;

  const channelBO = {
    cwConversionRate: {
      byUser: chBoList,
      target: 60
    },
    cwWithCarryover: {
      byUser: chBoCarryoverList,
      totalCW: chBoCarryoverList.reduce((s, u) => s + u.cw, 0),
      totalCarryoverCW: chBoCarryoverList.reduce((s, u) => s + u.carryoverCW, 0),
      totalThisMonthCW: chBoCarryoverList.reduce((s, u) => s + u.thisMonthCW, 0),
      note: 'OpportunityFieldHistory 실제 변경일 기준 CW/CL (이월 포함)'
    },
    contractSummary: {
      total: channelContracts.length,
      new: channelNewContracts.length,
      newFromCarryover: channelNewFromCarryover.length,
      addInstall: channelAddInstallContracts.length,
      byRecordType: channelContractsByType,
      byBO: Object.entries(chContractByBO).map(([name, v]) => ({ name, ...v })),
    },
    leadTime: {
      totalOpen: chRawOpenOpps_BO.length,
      overdueCount: boOverdueTotal,
      sameDayRate: boSameDayRate,
      byUser: boLeadTimeUsers,
      target: '당일 완료',
    },
    dailyClose: {
      byUser: chBoList.map(b => ({ name: b.name, avgDailyClose: b.avgDailyClose, avgDailyCloseThisMonth: b.avgDailyCloseThisMonth, avgDailyCloseCarryover: b.avgDailyCloseCarryover, totalCW: b.cw, totalCL: b.cl })),
      target: 3
    },
    sqlBacklog: {
      totalOpen: chRawOpenOpps_BO.length,
      totalOver7: chRawOpenOpps_BO.filter(o => (o.ageInDays ?? 0) > 7).length,
      byUser: (() => {
        const byUser = {};
        chRawOpenOpps_BO.forEach(o => {
          const name = o.boUser || '(미배정)';
          if (!byUser[name]) byUser[name] = { name, open: 0, over7: 0, totalAge: 0 };
          byUser[name].open++;
          byUser[name].totalAge += (o.ageInDays ?? 0);
          if ((o.ageInDays ?? 0) > 7) byUser[name].over7++;
        });
        return Object.values(byUser).map(u => ({
          ...u,
          avgDaysOpen: u.open > 0 ? +(u.totalAge / u.open).toFixed(1) : 0,
        })).sort((a, b) => b.over7 - a.over7);
      })(),
      target: 10
    },
    rawData: {
      rawOpenOpps: chRawOpenOpps_BO,  // BO 단계만 (이번달 생성)
      rawClosedOpps: chRawClosedOpps,
    },
    agingSummary: chAgingSummary,
    lossReasonSummary: chLossReasonSummary,
  };

  // TM rawData에 rawOpenOpps 추가 (이번달 생성 + 방문배정/견적/재견적 단계)
  tm.rawData.rawOpenOpps = chRawOpenOpps_TM;

  // TM sqlBacklog를 이번달 생성분으로 재계산 (담당자별 합계와 Raw 테이블 일치)
  tm.sqlBacklog = {
    openTotal: chRawOpenOpps_TM.length,
    over7: chRawOpenOpps_TM.filter(o => o.ageInDays > 7).length,
    target: 10,
    byOwner: (() => {
      const ownerMap = {};
      chRawOpenOpps_TM.forEach(o => {
        const name = o.ownerName || '-';
        if (!ownerMap[name]) ownerMap[name] = { name, total: 0, over7: 0, stages: {} };
        ownerMap[name].total++;
        if (o.ageInDays > 7) ownerMap[name].over7++;
        const st = o.stageName || '-';
        ownerMap[name].stages[st] = (ownerMap[name].stages[st] || 0) + 1;
      });
      return Object.values(ownerMap).sort((a, b) => b.total - a.total);
    })()
  };

  // TM rawData에 견적 발송 리스트 추가
  tm.rawData.quoteSentList = channelQuotes.map(q => ({
    quoteId: q.Id,
    name: q.Name,
    createdDate: utcToKSTDateStr(q.CreatedDate),
    ownerName: q.Opportunity?.Owner?.Name || '-',
    accountName: q.Opportunity?.Account?.Name || '-',
    isFinal: q.FinalQuoteCheck__c === 'Y',
    grandTotal: q.GrandTotal || 0,
  })).sort((a, b) => b.createdDate.localeCompare(a.createdDate));

  // TM rawData에 담당자별 일별 실적표 추가
  tm.rawData.dailyByOwner = dailyByOwner;

  return { ae, am, tm, backOffice: channelBO };
}

// ============================================
// 일별 데이터 필터 함수
// ============================================
function filterInboundDataForDay(data, dayDate) {
  const { leads, opportunities, quotes, leadTasks, dailyTasks, oppTasks, obsLeads, users, userNameMap, fieldUserIds, carryoverOpps, allClosedOpps, contracts, visits = [] } = data;

  // Lead: CreatedTime__c (KST) 또는 utcToKSTDateStr(CreatedDate)로 해당일 필터
  const filteredLeads = leads.filter(l => {
    if (l.CreatedTime__c) {
      const parsed = parseKSTDateTime(l.CreatedTime__c);
      return parsed?.dateStr === dayDate;
    }
    return utcToKSTDateStr(l.CreatedDate) === dayDate;
  });

  const filteredLeadIds = new Set(filteredLeads.map(l => l.Id));
  const filteredOppIds = new Set(filteredLeads.filter(l => l.ConvertedOpportunityId).map(l => l.ConvertedOpportunityId));

  return {
    leads: filteredLeads,
    opportunities: opportunities.filter(o => filteredOppIds.has(o.Id)),
    quotes: quotes.filter(q => filteredOppIds.has(q.OpportunityId)),
    leadTasks: leadTasks.filter(t => filteredLeadIds.has(t.Lead__c)),
    dailyTasks: dailyTasks.filter(t => utcToKSTDateStr(t.CreatedDate) === dayDate),
    oppTasks: oppTasks.filter(t => filteredOppIds.has(t.WhatId)),
    obsLeads: obsLeads.filter(l => utcToKSTDateStr(l.CreatedDate) === dayDate),
    users, userNameMap, fieldUserIds,
    carryoverOpps: carryoverOpps.filter(o => o.CloseDate === dayDate),
    allClosedOpps: allClosedOpps.filter(o => o.CloseDate === dayDate),
    contracts: (contracts || []).filter(c => c.contractStart === dayDate),
    visits,  // 방문은 Opp별 매핑이므로 전체 전달
    stageChangeHistory: (data.stageChangeHistory || []).filter(h => h.changeDate === dayDate),
  };
}

function filterChannelDataForDay(data, dayDate) {
  const filteredChannelLeads = data.channelLeads.filter(l => {
    if (l.CreatedTime__c) {
      return parseKSTDateTime(l.CreatedTime__c)?.dateStr === dayDate;
    }
    return utcToKSTDateStr(l.CreatedDate) === dayDate;
  });
  const filteredLeadIds = new Set(filteredChannelLeads.map(l => l.Id));

  const filteredSourceLeads = data.sourceLeads.filter(l => utcToKSTDateStr(l.CreatedDate) === dayDate);

  return {
    ...data,
    channelLeads: filteredChannelLeads,
    channelLeadTasks: data.channelLeadTasks.filter(t => filteredLeadIds.has(t.Lead__c)),
    sourceLeads: filteredSourceLeads,
    partnerSourceLeads: filteredSourceLeads.filter(l => l.LeadSource === '파트너사 소개'),
    franchiseSourceLeads: filteredSourceLeads.filter(l => l.LeadSource === '프랜차이즈소개'),
    channelEvents: data.channelEvents.filter(e => e.ActivityDate === dayDate),
    stageChangeHistory: (data.stageChangeHistory || []).filter(h => h.changeDate === dayDate),
    contracts: (data.contracts || []).filter(c => c.contractStart === dayDate),
    // opportunities, partners, HQ, brands, allSourceLeads: 그대로 유지
  };
}

// ============================================
// 메인 실행
// ============================================
async function main() {
  const targetMonthArg = process.argv[2]; // e.g. '2026-02'
  const dailyMode = process.argv.includes('--daily');
  const { startDate, endDate, periodLabel, targetMonth } = getMonthRange(targetMonthArg);

  console.log('============================================');
  console.log(`KPI 데이터 추출 - ${periodLabel}`);
  console.log('============================================');

  const { accessToken, instanceUrl } = await getSalesforceToken();
  console.log('✅ Salesforce 연결 성공');

  // 데이터 수집
  const inboundData = await collectInboundData(instanceUrl, accessToken, startDate, endDate);
  const channelData = await collectChannelData(instanceUrl, accessToken, startDate, endDate, targetMonth);

  // OpportunityFieldHistory에서 실제 CW/CL 변경 이력 수집
  const stageChangeHistory = await fetchStageChangeHistory(instanceUrl, accessToken, startDate, endDate, {
    ...inboundData.userNameMap,
  });
  inboundData.stageChangeHistory = stageChangeHistory;
  channelData.stageChangeHistory = stageChangeHistory;

  // KPI 계산
  console.log('\n📊 KPI 계산 중...');
  const inboundKPIs = calculateInboundKPIs(inboundData, startDate, endDate);
  // 계약 데이터는 인바운드에서 전체를 조회하므로 채널에도 공유
  channelData.contracts = inboundData.contracts;
  const channelKPIs = calculateChannelKPIs(channelData, startDate, endDate);

  // 결과 조합
  const result = {
    period: targetMonth,
    periodLabel,
    dateRange: { startDate, endDate },
    extractedAt: new Date().toISOString(),
    inbound: {
      insideSales: inboundKPIs.insideSales,
      fieldSales: inboundKPIs.fieldSales,
      backOffice: inboundKPIs.backOffice
    },
    channel: {
      ae: channelKPIs.ae,
      am: channelKPIs.am,
      tm: channelKPIs.tm,
      backOffice: channelKPIs.backOffice
    }
  };

  // JSON 파일 저장
  const outputDir = 'data';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = `${outputDir}/kpi-extract-${targetMonth}.json`;
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');

  // 콘솔 요약 출력
  console.log('\n============================================');
  console.log('📋 KPI 추출 요약');
  console.log('============================================');

  console.log('\n🔷 인바운드세일즈팀');
  console.log('  ┌─ Inside Sales ─────────────────────────');
  console.log(`  │ SQL 전환율: ${inboundKPIs.insideSales.sqlConversionRate}% (목표 90%)`);
  console.log(`  │ FRT 20분 초과: ${inboundKPIs.insideSales.frt.frtOver20}건 (목표 0건)`);
  console.log(`  │ 방문 완료: ${inboundKPIs.insideSales.visitCount}건 (목표 75건)`);
  console.log(`  │ 방문 완료율: ${inboundKPIs.insideSales.visitRate}% (목표 90%)`);
  console.log('  ├─ Field Sales ──────────────────────────');
  const fieldTotal = inboundKPIs.fieldSales.cwConversionRate.byUser;
  if (fieldTotal.length > 0) {
    const avgCWRate = +(fieldTotal.reduce((s, f) => s + f.cwRate, 0) / fieldTotal.length).toFixed(1);
    console.log(`  │ SQL→CW 전환율 (평균): ${avgCWRate}% (목표 60%)`);
  }
  console.log(`  │ 견적단계 정체 8일+: ${inboundKPIs.fieldSales.goldenTime.stale8plus}건`);
  console.log(`  │ OBS Lead 생산: ${inboundKPIs.fieldSales.obsLeadCount.total}건 (목표 200건)`);
  console.log('  ├─ Back Office ──────────────────────────');
  console.log(`  │ 7일 초과 SQL 잔량: ${inboundKPIs.backOffice.sqlBacklog.totalOver7}건 (목표 10건 이내)`);
  console.log('  └───────────────────────────────────────');

  console.log('\n🔶 채널세일즈팀');
  console.log('  ┌─ AE ──────────────────────────────────');
  console.log(`  │ 신규 MOU 체결: ${channelKPIs.ae.mouCount.total}건 (목표 4건)`);
  console.log(`  │ 미팅 일평균: ${channelKPIs.ae.meetingCount.avgDaily}건 (목표 2건)`);
  console.log('  ├─ AM ──────────────────────────────────');
  console.log(`  │ 채널 리드 일평균: ${channelKPIs.am.dailyLeadCount.avgDaily}건 (목표 20~25건)`);
  console.log(`  │ 초기 안착률: ${channelKPIs.am.onboardingRate.rate}% (목표 80%)`);
  console.log(`  │ 활성 파트너: ${channelKPIs.am.activePartnerCount.total}개 (목표 70개)`);
  console.log('  ├─ TM ──────────────────────────────────');
  console.log(`  │ 영업기회 전환 일평균: ${channelKPIs.tm.dailyConversion.avgDaily}건 (목표 5건)`);
  console.log(`  │ FRT 20분 초과: ${channelKPIs.tm.frt.frtOver20}건 (목표 0건)`);
  console.log(`  │ MQL→SQL 미전환: ${channelKPIs.tm.unconvertedMQL.count}건 (목표 0건)`);
  console.log(`  │ 7일 초과 SQL 잔량: ${channelKPIs.tm.sqlBacklog.over7}건 (목표 10건 이내)`);
  console.log('  ├─ Back Office ──────────────────────────');
  if (channelKPIs.backOffice.cwConversionRate.byUser.length > 0) {
    const avgCW = +(channelKPIs.backOffice.cwConversionRate.byUser.reduce((s, b) => s + b.cwRate, 0) / channelKPIs.backOffice.cwConversionRate.byUser.length).toFixed(1);
    console.log(`  │ SQL→CW 전환율 (평균): ${avgCW}% (목표 60%)`);
  }
  console.log('  └───────────────────────────────────────');

  console.log(`\n✅ 저장 완료: ${outputPath}`);

  // 일별 KPI 생성 (--daily 플래그)
  if (dailyMode) {
    console.log('\n📅 일별 KPI 생성 중...');
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const start = new Date(startDate);
    const end = new Date(endDate);
    let dayCount = 0;
    const dailyTrends = []; // 일별 추이 데이터 수집

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayStr = d.toISOString().substring(0, 10);
      const dayOfWeek = new Date(dayStr).getDay();

      // 인바운드 일별 필터 + 계산
      const dayInboundData = filterInboundDataForDay(inboundData, dayStr);
      const dayInboundKPIs = calculateInboundKPIs(dayInboundData, dayStr, dayStr);

      // 채널 일별 필터 + 계산
      const dayChannelData = filterChannelDataForDay(channelData, dayStr);
      const dayChannelKPIs = calculateChannelKPIs(dayChannelData, dayStr, dayStr);

      const dayResult = {
        period: dayStr,
        periodLabel: `${dayStr} (${dayNames[dayOfWeek]}요일)`,
        dateRange: { startDate: dayStr, endDate: dayStr },
        extractedAt: new Date().toISOString(),
        periodType: 'daily',
        parentMonth: targetMonth,
        inbound: {
          insideSales: dayInboundKPIs.insideSales,
          fieldSales: dayInboundKPIs.fieldSales,
          backOffice: dayInboundKPIs.backOffice
        },
        channel: {
          ae: dayChannelKPIs.ae,
          am: dayChannelKPIs.am,
          tm: dayChannelKPIs.tm,
          backOffice: dayChannelKPIs.backOffice
        }
      };

      const dayPath = `${outputDir}/kpi-extract-${dayStr}.json`;
      fs.writeFileSync(dayPath, JSON.stringify(dayResult, null, 2), 'utf-8');

      // 일별 추이 데이터 수집 (월간 파일에 임베드)
      const dis = dayInboundKPIs.insideSales;
      const dtm = dayChannelKPIs.tm;
      const disFrtTotal = dis.frt?.totalWithTask || 0;
      const disFrtOk = dis.frt?.frtOk || 0;
      const disFrtRate = disFrtTotal > 0 ? +((disFrtOk / disFrtTotal) * 100).toFixed(1) : null;
      // IS Daily Task 평균 (IS 담당자 기준)
      const isOwners = new Set((dis.byOwner || []).map(o => o.name));
      const isTaskOwners = (dis.dailyTask?.byOwner || []).filter(o => isOwners.has(o.name));
      const isTaskAvg = isTaskOwners.length > 0
        ? +(isTaskOwners.reduce((s, o) => s + o.avgDaily, 0) / isTaskOwners.length).toFixed(1)
        : null;

      dailyTrends.push({
        date: dayStr,
        dayName: dayNames[dayOfWeek],
        dayOfWeek,
        insideSales: {
          lead: dis.lead || 0,
          mql: dis.mql || 0,
          sql: dis.sql || 0,
          sqlConversionRate: dis.sqlConversionRate ?? null,
          frtRate: disFrtRate,
          frtOver20: dis.frt?.frtOver20 || 0,
          taskAvg: isTaskAvg,
          visitCount: dis.visitCount || 0,
          visitRate: dis.visitRate ?? null,
          rawCounts: {
            frtOver20: dis.rawData?.frtOver20?.length || 0,
            unconvertedMQL: dis.rawData?.unconvertedMQL?.length || 0,
            noVisitSQL: dis.rawData?.noVisitSQL?.length || 0,
          }
        },
        channelTM: {
          lead: dtm.byOwner?.reduce((s, o) => s + o.lead, 0) || 0,
          frtOver20: dtm.frt?.frtOver20 || 0,
          dailyConversion: dtm.dailyConversion?.total || 0,
          unconvertedMQL: dtm.unconvertedMQL?.count || 0,
        },
        // BO 일별 추이 데이터
        inboundBO: (() => {
          const dibo = dayInboundKPIs.backOffice;
          const boUsers = dibo?.cwConversionRate?.byUser || [];
          const totalSQL = boUsers.reduce((s, u) => s + u.total, 0);
          const totalCW = boUsers.reduce((s, u) => s + u.cw, 0);
          const totalCL = boUsers.reduce((s, u) => s + u.cl, 0);
          const totalClosed = totalCW + totalCL;
          const cwRate = totalSQL > 0 ? +((totalCW / totalSQL) * 100).toFixed(1) : null;
          return {
            sqlTotal: totalSQL,
            cw: totalCW,
            cl: totalCL,
            totalClosed,
            cwRate,
            sqlBacklogOpen: dibo?.sqlBacklog?.totalOpen ?? 0,
            sqlBacklogOver7: dibo?.sqlBacklog?.totalOver7 ?? 0,
            contracts: dibo?.contractSummary?.total ?? 0,
            contractsNew: dibo?.contractSummary?.new ?? 0,
            contractsNewFromCarryover: dibo?.contractSummary?.newFromCarryover ?? 0,
            contractsAddInstall: dibo?.contractSummary?.addInstall ?? 0,
          };
        })(),
        fieldSales: (() => {
          const dfs = dayInboundKPIs.fieldSales;
          const fsUsers = dfs?.cwConversionRate?.byUser || [];
          const totalSQL = fsUsers.reduce((s, u) => s + (u.total || 0), 0);
          const totalCW = fsUsers.reduce((s, u) => s + (u.cw || 0), 0);
          const totalCL = fsUsers.reduce((s, u) => s + (u.cl || 0), 0);
          const totalOpen = fsUsers.reduce((s, u) => s + (u.open || 0), 0);
          return {
            sqlTotal: totalSQL, cw: totalCW, cl: totalCL, open: totalOpen,
            cwRate: (totalCW + totalCL) > 0 ? +((totalCW / (totalCW + totalCL)) * 100).toFixed(1) : null,
            goldenTimeStale: dfs?.goldenTime?.staleCount ?? dfs?.goldenTime?.stale8plus ?? 0,
            obsLeadCount: dfs?.obsLeadCount?.total ?? dfs?.obsLeadCount ?? 0,
            staleVisitCount: dfs?.staleVisit?.total ?? 0,
          };
        })(),
        channelBO: (() => {
          const dcbo = dayChannelKPIs.backOffice;
          const cboUsers = dcbo?.cwConversionRate?.byUser || [];
          const totalSQL = cboUsers.reduce((s, u) => s + u.total, 0);
          const totalCW = cboUsers.reduce((s, u) => s + u.cw, 0);
          const totalCL = cboUsers.reduce((s, u) => s + u.cl, 0);
          const totalClosed = totalCW + totalCL;
          const cwRate = totalSQL > 0 ? +((totalCW / totalSQL) * 100).toFixed(1) : null;
          return {
            sqlTotal: totalSQL,
            cw: totalCW,
            cl: totalCL,
            totalClosed,
            cwRate,
            sqlBacklogOpen: dcbo?.sqlBacklog?.totalOpen ?? 0,
            sqlBacklogOver7: dcbo?.sqlBacklog?.totalOver7 ?? 0,
            contracts: dcbo?.contractSummary?.total ?? 0,
            contractsNew: dcbo?.contractSummary?.new ?? 0,
            contractsNewFromCarryover: dcbo?.contractSummary?.newFromCarryover ?? 0,
            contractsAddInstall: dcbo?.contractSummary?.addInstall ?? 0,
          };
        })(),
      });

      const leadCount = dayInboundData.leads.length + dayChannelData.channelLeads.length;
      console.log(`  📅 ${dayStr} (${dayNames[dayOfWeek]}): Lead ${leadCount}건`);
      dayCount++;
    }

    // 일별 추이 데이터를 월간 파일에 추가 저장
    result.dailyTrends = dailyTrends;
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`  📊 월간 파일에 dailyTrends ${dailyTrends.length}일치 추가`);

    console.log(`\n✅ 일별 KPI ${dayCount}개 파일 생성 완료`);
  }

  // ============================================
  // S3 업로드 + 주간 사전계산 + 메타데이터
  // ============================================
  if (process.env.S3_BUCKET_NAME) {
    const { uploadJSON } = require('./lib/s3-upload');
    const { aggregateWeeklyData, annotateCurrentStatus, generateWeeks } = require('./lib/kpi-aggregation');

    console.log('\n☁️  S3 업로드 시작...');

    // 1. 월간 파일 업로드
    await uploadJSON(`kpi/monthly/${targetMonth}.json`, result);

    // 2. 일별 파일 업로드 + 메타데이터 수집
    const outputDir = 'data';
    const allFiles = fs.readdirSync(outputDir);
    const dailyDates = allFiles
      .filter(f => /^kpi-extract-\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.includes(targetMonth))
      .map(f => f.match(/kpi-extract-(\d{4}-\d{2}-\d{2})\.json/)[1])
      .sort();

    for (const dateStr of dailyDates) {
      const dayContent = JSON.parse(fs.readFileSync(`${outputDir}/kpi-extract-${dateStr}.json`, 'utf-8'));
      await uploadJSON(`kpi/daily/${dateStr}.json`, dayContent);
    }
    console.log(`  ☁️  일별 ${dailyDates.length}개 업로드 완료`);

    // 3. 주간 사전계산 + 업로드
    const weeksData = generateWeeks(targetMonth, dailyDates);
    for (const week of weeksData.weeks) {
      const dailyDataArray = [];
      for (const d of week.dates) {
        try {
          const content = JSON.parse(fs.readFileSync(`${outputDir}/kpi-extract-${d}.json`, 'utf-8'));
          dailyDataArray.push(content);
        } catch (e) { /* skip */ }
      }
      if (dailyDataArray.length > 0) {
        const weeklyData = aggregateWeeklyData(dailyDataArray, week.start, week.end);
        await annotateCurrentStatus(weeklyData, targetMonth, outputDir);
        await uploadJSON(`kpi/weekly/${week.start}_${week.end}.json`, weeklyData);
      }
    }
    console.log(`  ☁️  주간 ${weeksData.weeks.length}개 사전계산 + 업로드 완료`);

    // 4. 메타데이터 업로드
    const allMonths = allFiles
      .filter(f => /^kpi-extract-\d{4}-\d{2}\.json$/.test(f))
      .map(f => f.match(/kpi-extract-(\d{4}-\d{2})\.json/)[1])
      .sort()
      .reverse();
    await uploadJSON('kpi/months.json', { months: allMonths });
    await uploadJSON(`kpi/dates/${targetMonth}.json`, { month: targetMonth, dates: dailyDates });
    await uploadJSON(`kpi/weeks/${targetMonth}.json`, weeksData);

    // 5. install-tracking.json 업로드 (있으면)
    try {
      const itData = JSON.parse(fs.readFileSync(`${outputDir}/install-tracking.json`, 'utf-8'));
      await uploadJSON('install-tracking.json', itData);
    } catch (e) { /* install-tracking 파일 없으면 무시 */ }

    console.log('☁️  S3 업로드 완료!\n');
  }
}

main().catch(err => {
  console.error('❌ 오류:', err.message);
  if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
  process.exit(1);
});
