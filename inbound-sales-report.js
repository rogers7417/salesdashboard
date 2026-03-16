require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

// ============================================
// 목표 설정 (Business Plan 기준)
// ============================================
const TARGETS = {
  mqlConversionRate: 70,      // MQL 전환율 목표 (%)
  sqlConversionRate: 90,      // SQL 전환율 목표 (%)
  visitConversionRate: 75,    // 방문전환율 목표 (%)
  cwConversionRate: 60,       // CW 전환율 목표 (%)
  frtComplianceRate: 80,      // FRT 준수율 목표 (%)
  wrongEntryRate: 10,         // 오인입율 목표 상한 (%)
  monthlyVisitTarget: 75,     // 월간 방문완료 목표 (건)
  monthlyCWTarget: 45,        // 월간 CW 목표 (건)
};

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

async function soqlQuery(instanceUrl, accessToken, query) {
  const url = `${instanceUrl}/services/data/v59.0/query`;
  const res = await axios.get(url, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    params: { q: query }
  });
  return res.data;
}

// ============================================
// 날짜 유틸리티
// ============================================
function kstToUTC(kstDateStr, isStart = true) {
  const [year, month, day] = kstDateStr.split('-').map(Number);
  if (isStart) {
    return new Date(Date.UTC(year, month - 1, day - 1, 15, 0, 0)).toISOString();
  } else {
    return new Date(Date.UTC(year, month - 1, day, 14, 59, 59)).toISOString();
  }
}

function getDateRange(mode) {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  let startDate, endDate, periodLabel;

  if (mode === 'daily') {
    const yesterday = new Date(kstNow);
    yesterday.setDate(yesterday.getDate() - 1);
    startDate = yesterday.toISOString().split('T')[0];
    endDate = startDate;
    periodLabel = startDate;
  } else if (mode === 'weekly') {
    const dayOfWeek = kstNow.getDay();
    const lastSunday = new Date(kstNow);
    lastSunday.setDate(kstNow.getDate() - dayOfWeek);
    const lastMonday = new Date(lastSunday);
    lastMonday.setDate(lastSunday.getDate() - 6);
    startDate = lastMonday.toISOString().split('T')[0];
    endDate = lastSunday.toISOString().split('T')[0];
    periodLabel = `${startDate} ~ ${endDate}`;
  } else if (mode === 'monthly') {
    const lastMonth = new Date(kstNow.getFullYear(), kstNow.getMonth() - 1, 1);
    const lastDay = new Date(kstNow.getFullYear(), kstNow.getMonth(), 0).getDate();
    startDate = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}-01`;
    endDate = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}-${lastDay}`;
    periodLabel = `${lastMonth.getFullYear()}년 ${lastMonth.getMonth() + 1}월`;
  } else if (mode === 'monthly-current') {
    // KST 기준 어제 날짜 계산
    const kstYear = kstNow.getUTCFullYear();
    const kstMonth = kstNow.getUTCMonth();
    const kstDate = kstNow.getUTCDate();

    // 어제 날짜 (KST 기준)
    const yesterdayKST = new Date(Date.UTC(kstYear, kstMonth, kstDate - 1));
    const targetYear = yesterdayKST.getUTCFullYear();
    const targetMonth = yesterdayKST.getUTCMonth();
    const yesterdayDate = yesterdayKST.getUTCDate();

    startDate = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-01`;
    endDate = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(yesterdayDate).padStart(2, '0')}`;
    periodLabel = `${targetYear}년 ${targetMonth + 1}월 (${yesterdayDate}일까지)`;
  }
  return { startDate, endDate, periodLabel };
}

function parseKSTDateTime(kstDateStr) {
  const [datePart, timePart] = kstDateStr.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  return { year, month, day, hour, minute, second, dayOfWeek: new Date(year, month - 1, day).getDay(), dateStr: datePart };
}

function classifyTimeSlot(kstDateStr) {
  const { dayOfWeek, hour } = parseKSTDateTime(kstDateStr);
  if (dayOfWeek === 0 || dayOfWeek === 6) return 'WEEKEND';
  if (hour >= 10 && hour < 19) return 'BUSINESS_HOUR';
  return 'OFF_HOUR';
}

const TIME_SLOT_LABELS = {
  'BUSINESS_HOUR': '☀️ 영업시간',
  'OFF_HOUR': '🌙 영업외',
  'WEEKEND': '🗓️ 주말'
};

// ============================================
// MQL 판정
// ============================================
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

// ============================================
// FRT 구간 분류
// ============================================
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

// ============================================
// 데이터 수집
// ============================================
async function collectData(startDate, endDate) {
  const { accessToken, instanceUrl } = await getSalesforceToken();
  console.log('✅ Salesforce 연결 성공');

  const startUTC = kstToUTC(startDate, true);
  const endUTC = kstToUTC(endDate, false);
  console.log(`📅 조회 기간: ${startDate} ~ ${endDate} (KST)`);

  // 1. 인바운드세일즈 User 조회
  const userQuery = `SELECT Id, Name FROM User WHERE Department = '인바운드세일즈' AND IsActive = true`;
  const usersResult = await soqlQuery(instanceUrl, accessToken, userQuery);
  const insideUsers = usersResult.records;
  const userIds = insideUsers.map(u => `'${u.Id}'`).join(',');
  console.log(`👥 인바운드세일즈 인원: ${insideUsers.length}명`);

  // User 이름 매핑 (먼저 정의)
  const userNameMap = {};
  insideUsers.forEach(u => { userNameMap[u.Id] = u.Name; });

  // 2. Lead 조회 (인바운드 기준 - 대시보드와 동일)
  const leadQuery = `
    SELECT Id, CreatedDate, CreatedTime__c, OwnerId, Name, Status, LossReason__c, LossReason_Contract__c, ConvertedOpportunityId, Company, LeadSource
    FROM Lead
    WHERE CreatedDate >= ${startUTC}
      AND CreatedDate < ${endUTC}
      AND (ServiceType__c = '테이블오더' OR ServiceType__c = '티오더 웨이팅')
      AND (LossReason__c = NULL OR LossReason__c != '오생성')
      AND (LeadSource = NULL OR LeadSource != '아웃바운드')
      AND PartnerName__c = NULL
      AND (StoreType__c = NULL OR StoreType__c != '프랜차이즈제휴')
  `.replace(/\s+/g, ' ').trim();

  const leadsResult = await soqlQuery(instanceUrl, accessToken, leadQuery);
  // Company에 'test' 포함된 건 제외
  const leads = leadsResult.records.filter(l => !l.Company || !l.Company.toLowerCase().includes('test'));
  console.log(`📋 조회된 Lead: ${leads.length}건`);

  // 3. Opportunity 조회
  const convertedOppIds = leads.filter(l => l.ConvertedOpportunityId).map(l => l.ConvertedOpportunityId);
  let opportunities = [];
  if (convertedOppIds.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < convertedOppIds.length; i += chunkSize) {
      const chunk = convertedOppIds.slice(i, i + chunkSize);
      const oppIds = chunk.map(id => `'${id}'`).join(',');
      const oppQuery = `SELECT Id, Name, Loss_Reason__c, StageName, FieldUser__c, BOUser__c, AgeInDays, SalesInviteDate__c, CreatedDate, RecordType.Name, fm_CompanyStatus__c FROM Opportunity WHERE Id IN (${oppIds})`;
      const oppResult = await soqlQuery(instanceUrl, accessToken, oppQuery);
      opportunities = opportunities.concat(oppResult.records);
    }
  }
  console.log(`📊 조회된 Opportunity: ${opportunities.length}건`);

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

  // Quote 조회
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
  console.log(`📝 조회된 Quote: ${quotes.length}건`);

  // Opportunity별 최신 Quote 매핑
  const latestQuoteByOpp = {};
  quotes.forEach(q => {
    if (!latestQuoteByOpp[q.OpportunityId]) {
      latestQuoteByOpp[q.OpportunityId] = q;
    }
  });

  // Opportunity별 Task 조회 (리터치 분석용)
  let oppTasks = [];
  if (convertedOppIds.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < convertedOppIds.length; i += chunkSize) {
      const chunk = convertedOppIds.slice(i, i + chunkSize);
      const oppIds = chunk.map(id => `'${id}'`).join(',');
      const oppTaskQuery = `SELECT Id, WhatId, CreatedDate FROM Task WHERE WhatId IN (${oppIds}) ORDER BY WhatId, CreatedDate`;
      const oppTaskResult = await soqlQuery(instanceUrl, accessToken, oppTaskQuery);
      oppTasks = oppTasks.concat(oppTaskResult.records);
    }
  }
  console.log(`📞 Opportunity Task: ${oppTasks.length}건`);

  // Opportunity별 Task 매핑
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

    // 리터치 계산 (견적 후 Task)
    let retouchCount = 0;
    let lastTaskDate = null;
    let daysSinceLastTask = null;
    if (quote) {
      const quoteDate = new Date(quote.CreatedDate);
      const tasksAfterQuote = tasks.filter(t => new Date(t.CreatedDate) > quoteDate);
      retouchCount = tasksAfterQuote.length;
      if (tasksAfterQuote.length > 0) {
        lastTaskDate = tasksAfterQuote[tasksAfterQuote.length - 1].CreatedDate;
        daysSinceLastTask = Math.floor((new Date() - new Date(lastTaskDate)) / (1000 * 60 * 60 * 24));
      } else {
        // 견적 후 Task 없으면 견적일 기준
        daysSinceLastTask = Math.floor((new Date() - quoteDate) / (1000 * 60 * 60 * 24));
      }
    }

    // RecordType 분류 (신규/추가설치)
    const recordTypeRaw = opp.RecordType?.Name || '';
    const recordType = recordTypeRaw.includes('추가설치') ? '추가설치' : recordTypeRaw.includes('신규') ? '신규' : '기타';

    // 오픈전 여부 (fm_CompanyStatus__c = '오픈전')
    const companyStatus = opp.fm_CompanyStatus__c || '';
    const isPreOpen = companyStatus === '오픈전';

    oppDataMap[opp.Id] = {
      oppName: opp.Name,
      lossReason: opp.Loss_Reason__c,
      stageName: opp.StageName,
      isVisitConverted: opp.Loss_Reason__c !== '방문 전 취소',
      isCW: opp.StageName === 'Closed Won',
      isCL: opp.StageName === 'Closed Lost',
      isOpen,
      fieldUserId: opp.FieldUser__c,
      boUserId: opp.BOUser__c,
      ageInDays: opp.AgeInDays || 0,
      salesInviteDate: opp.SalesInviteDate__c,
      createdDate: opp.CreatedDate,
      recordType,
      companyStatus,
      isPreOpen,
      hasQuote: !!quote,
      quoteDate: quote ? quote.CreatedDate : null,
      retouchCount,
      lastTaskDate,
      daysSinceLastTask,
      isStale: daysSinceLastTask !== null && daysSinceLastTask >= 8
    };
  });

  // 4. Lead별 첫 Task 조회 (자동발송 제외)
  let leadTasks = [];
  if (leads.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < leads.length; i += chunkSize) {
      const chunk = leads.slice(i, i + chunkSize);
      const leadIds = chunk.map(l => `'${l.Id}'`).join(',');
      const taskQuery = `SELECT Id, Lead__c, CreatedDate FROM Task WHERE Lead__c IN (${leadIds}) AND OwnerId != '005IR00000FgbZtYAJ' ORDER BY Lead__c, CreatedDate ASC`;
      const tasksResult = await soqlQuery(instanceUrl, accessToken, taskQuery);
      leadTasks = leadTasks.concat(tasksResult.records);
    }
  }
  console.log(`📞 Lead 관련 Task: ${leadTasks.length}건`);

  // Lead별 첫 Task 매핑
  const firstTaskByLead = {};
  leadTasks.forEach(task => {
    if (!firstTaskByLead[task.Lead__c]) firstTaskByLead[task.Lead__c] = task;
  });

  // 5. 담당자별 전체 Task 조회 (일별 생산량용)
  const dailyTaskQuery = `SELECT Id, OwnerId, CreatedDate FROM Task WHERE OwnerId IN (${userIds}) AND CreatedDate >= ${startUTC} AND CreatedDate < ${endUTC}`;
  const dailyTasksResult = await soqlQuery(instanceUrl, accessToken, dailyTaskQuery);
  const dailyTasks = dailyTasksResult.records;
  console.log(`📝 인바운드세일즈 Task: ${dailyTasks.length}건`);

  // 6. Contract 조회 (이번달 계약 시작 기준)
  // 다음달 1일 계산
  const [sy, sm] = startDate.split('-').map(Number);
  const nextMonthFirst = new Date(sy, sm, 1).toISOString().slice(0, 10);

  const contractQuery = `
    SELECT Id, Name, ContractDateStart__c, ContractStatus__c,
      Opportunity__r.BOUser__c, Opportunity__r.BOUser__r.Name,
      Opportunity__r.FieldUser__c, Opportunity__r.FieldUser__r.Name,
      Opportunity__r.StageName, Opportunity__r.Name,
      Opportunity__r.Owner_Department__c,
      Opportunity__r.RecordTypeId, Opportunity__r.RecordType.Name,
      Opportunity__r.CreatedDate,
      Account__r.Name
    FROM Contract__c
    WHERE Opportunity__c != NULL
      AND ContractDateStart__c >= ${startDate}
      AND ContractDateStart__c < ${nextMonthFirst}
      AND ContractStatus__c IN ('계약서명완료','계약서명대기','요청취소')
      AND Opportunity__r.Owner_Department__c = '인바운드세일즈'
  `.replace(/\s+/g, ' ').trim();
  const contractsResult = await soqlQuery(instanceUrl, accessToken, contractQuery);
  const contracts = contractsResult.records;
  console.log(`📄 조회된 Contract: ${contracts.length}건`);

  // Contract의 BO/Field User 정보도 userNameMap에 추가
  contracts.forEach(c => {
    if (c.Opportunity__r?.BOUser__c && c.Opportunity__r?.BOUser__r?.Name) {
      userNameMap[c.Opportunity__r.BOUser__c] = c.Opportunity__r.BOUser__r.Name;
    }
    if (c.Opportunity__r?.FieldUser__c && c.Opportunity__r?.FieldUser__r?.Name) {
      userNameMap[c.Opportunity__r.FieldUser__c] = c.Opportunity__r.FieldUser__r.Name;
    }
  });

  return {
    leads,
    opportunities,
    oppDataMap,
    firstTaskByLead,
    dailyTasks,
    insideUsers,
    userNameMap,
    startDate,
    endDate,
    contracts
  };
}

// ============================================
// 통계 계산
// ============================================
function calculateStats(data) {
  const { leads, oppDataMap, firstTaskByLead, dailyTasks, insideUsers, userNameMap, startDate, endDate, opportunities, contracts } = data;

  // Lead 데이터 가공
  const leadData = leads.map(lead => {
    const firstTask = firstTaskByLead[lead.Id];
    let frtMinutes = null;
    if (firstTask) {
      frtMinutes = Math.round((new Date(firstTask.CreatedDate) - new Date(lead.CreatedDate)) / 1000 / 60 * 10) / 10;
    }

    const timeSlot = classifyTimeSlot(lead.CreatedTime__c);
    const mql = isMQL(lead);
    const oppData = lead.ConvertedOpportunityId ? oppDataMap[lead.ConvertedOpportunityId] : null;
    const { dateStr } = parseKSTDateTime(lead.CreatedTime__c);

    return {
      id: lead.Id,
      ownerId: lead.OwnerId,
      ownerName: userNameMap[lead.OwnerId] || lead.OwnerId,
      dateStr,
      timeSlot,
      frtMinutes,
      frtBucket: classifyFRTBucket(frtMinutes),
      hasTask: !!firstTask,
      frtOk: frtMinutes !== null && frtMinutes <= 20,
      isMQL: mql,
      isSQL: mql && lead.Status === 'Qualified',
      hasOpp: !!oppData,
      isVisitConverted: oppData?.isVisitConverted || false,
      isCW: oppData?.isCW || false,
      isWrongEntry: lead.LossReason__c === '오인입',
      wrongEntryReason: lead.LossReason_Contract__c,
      isNoInquiry: lead.LossReason_Contract__c === '문의하지 않음',
      leadSource: lead.LeadSource || '(미지정)'
    };
  });

  // 담당자별 집계
  const byOwner = {};
  leadData.forEach(l => {
    if (!byOwner[l.ownerId]) {
      byOwner[l.ownerId] = {
        name: l.ownerName,
        leads: [],
        byTimeSlot: { BUSINESS_HOUR: [], OFF_HOUR: [], WEEKEND: [] }
      };
    }
    byOwner[l.ownerId].leads.push(l);
    byOwner[l.ownerId].byTimeSlot[l.timeSlot].push(l);
  });

  // 담당자별 Task 일별 집계
  const taskByOwnerDate = {};
  dailyTasks.forEach(t => {
    const date = t.CreatedDate.split('T')[0];
    const key = `${t.OwnerId}_${date}`;
    if (!taskByOwnerDate[key]) taskByOwnerDate[key] = 0;
    taskByOwnerDate[key]++;
  });

  // 날짜 목록 (평일만)
  const allDates = [...new Set(dailyTasks.map(t => t.CreatedDate.split('T')[0]))].sort();
  const weekdays = allDates.filter(d => {
    const day = new Date(d).getDay();
    return day !== 0 && day !== 6;
  });

  // 담당자별 통계
  const ownerStats = Object.entries(byOwner).map(([ownerId, ownerData]) => {
    const leads = ownerData.leads;
    const mqlLeads = leads.filter(l => l.isMQL);
    const sqlLeads = leads.filter(l => l.isSQL);
    const oppLeads = leads.filter(l => l.hasOpp);
    const visitConvertedLeads = leads.filter(l => l.isVisitConverted);
    const cwLeads = leads.filter(l => l.isCW);
    const wrongEntryLeads = leads.filter(l => l.isWrongEntry);
    const withTaskLeads = leads.filter(l => l.hasTask);
    const frtOkLeads = leads.filter(l => l.frtOk);

    // Task 통계
    const dailyTaskCounts = weekdays.map(d => taskByOwnerDate[`${ownerId}_${d}`] || 0);
    const totalTasks = dailyTaskCounts.reduce((a, b) => a + b, 0);
    const avgDaily = dailyTaskCounts.length > 0 ? totalTasks / dailyTaskCounts.length : 0;
    const daysOver30 = dailyTaskCounts.filter(t => t >= 30).length;

    // 시간대별 통계
    const timeSlotStats = {};
    ['BUSINESS_HOUR', 'OFF_HOUR', 'WEEKEND'].forEach(slot => {
      const slotLeads = ownerData.byTimeSlot[slot];
      const slotWithTask = slotLeads.filter(l => l.hasTask);
      const slotFrtOk = slotLeads.filter(l => l.frtOk);
      const slotWrongEntry = slotLeads.filter(l => l.isWrongEntry);
      const slotConverted = slotLeads.filter(l => l.hasOpp);

      timeSlotStats[slot] = {
        total: slotLeads.length,
        withTask: slotWithTask.length,
        frtOk: slotFrtOk.length,
        frtRate: slotWithTask.length > 0 ? (slotFrtOk.length / slotWithTask.length * 100).toFixed(1) : 0,
        avgFrt: slotWithTask.length > 0 ? slotWithTask.reduce((s, l) => s + l.frtMinutes, 0) / slotWithTask.length : null,
        wrongEntry: slotWrongEntry.length,
        wrongEntryRate: slotLeads.length > 0 ? (slotWrongEntry.length / slotLeads.length * 100).toFixed(1) : 0,
        converted: slotConverted.length,
        conversionRate: slotLeads.length > 0 ? (slotConverted.length / slotLeads.length * 100).toFixed(1) : 0
      };
    });

    return {
      ownerId,
      name: ownerData.name,
      // 퍼널
      lead: leads.length,
      mql: mqlLeads.length,
      mqlRate: leads.length > 0 ? (mqlLeads.length / leads.length * 100).toFixed(1) : 0,
      sql: sqlLeads.length,
      sqlRate: mqlLeads.length > 0 ? (sqlLeads.length / mqlLeads.length * 100).toFixed(1) : 0,
      opp: oppLeads.length,
      visitConverted: visitConvertedLeads.length,
      visitConvertedRate: oppLeads.length > 0 ? (visitConvertedLeads.length / oppLeads.length * 100).toFixed(1) : 0,
      cw: cwLeads.length,
      cwRate: oppLeads.length > 0 ? (cwLeads.length / oppLeads.length * 100).toFixed(1) : 0,
      // FRT
      withTask: withTaskLeads.length,
      frtOk: frtOkLeads.length,
      frtRate: withTaskLeads.length > 0 ? (frtOkLeads.length / withTaskLeads.length * 100).toFixed(1) : 0,
      avgFrt: withTaskLeads.length > 0 ? withTaskLeads.reduce((s, l) => s + l.frtMinutes, 0) / withTaskLeads.length : null,
      // 오인입
      wrongEntry: wrongEntryLeads.length,
      wrongEntryRate: leads.length > 0 ? (wrongEntryLeads.length / leads.length * 100).toFixed(1) : 0,
      // Task
      totalTasks,
      avgDaily,
      daysOver30,
      totalWeekdays: weekdays.length,
      dailyTaskCounts,
      // 시간대별
      timeSlotStats
    };
  }).sort((a, b) => b.lead - a.lead);

  // FRT 구간별 분석
  const frtBuckets = ['10분 이내', '10~20분', '20~30분', '30~60분', '1~2시간', '2~4시간', '4~8시간', '8시간 초과', 'NO_TASK'];
  const timeSlots = ['BUSINESS_HOUR', 'OFF_HOUR', 'WEEKEND'];

  const frtBucketStats = frtBuckets.map(bucket => {
    const bucketLeads = leadData.filter(l => l.frtBucket === bucket);
    const wrongEntry = bucketLeads.filter(l => l.isWrongEntry).length;
    const noInquiry = bucketLeads.filter(l => l.isNoInquiry).length;
    const converted = bucketLeads.filter(l => l.hasOpp).length;

    // 시간대별 통계
    const byTimeSlot = {};
    timeSlots.forEach(slot => {
      const slotLeads = bucketLeads.filter(l => l.timeSlot === slot);
      const slotWrongEntry = slotLeads.filter(l => l.isWrongEntry).length;
      const slotConverted = slotLeads.filter(l => l.hasOpp).length;
      byTimeSlot[slot] = {
        total: slotLeads.length,
        wrongEntry: slotWrongEntry,
        wrongEntryRate: slotLeads.length > 0 ? (slotWrongEntry / slotLeads.length * 100).toFixed(1) : 0,
        converted: slotConverted,
        conversionRate: slotLeads.length > 0 ? (slotConverted / slotLeads.length * 100).toFixed(1) : 0
      };
    });

    return {
      bucket,
      total: bucketLeads.length,
      wrongEntry,
      wrongEntryRate: bucketLeads.length > 0 ? (wrongEntry / bucketLeads.length * 100).toFixed(1) : 0,
      noInquiry,
      noInquiryRate: bucketLeads.length > 0 ? (noInquiry / bucketLeads.length * 100).toFixed(1) : 0,
      converted,
      conversionRate: bucketLeads.length > 0 ? (converted / bucketLeads.length * 100).toFixed(1) : 0,
      byTimeSlot
    };
  });

  // 오인입 사유 분석
  const wrongEntryReasons = {};
  leadData.filter(l => l.isWrongEntry).forEach(l => {
    const reason = l.wrongEntryReason || '(없음)';
    if (!wrongEntryReasons[reason]) wrongEntryReasons[reason] = 0;
    wrongEntryReasons[reason]++;
  });

  // 전체 요약
  // 오픈전 건수 집계
  const oppValues = Object.values(oppDataMap);
  const preOpenOpps = oppValues.filter(o => o.isPreOpen);
  const preOpenStats = {
    total: preOpenOpps.length,
    open: preOpenOpps.filter(o => o.isOpen).length,
    cw: preOpenOpps.filter(o => o.isCW).length,
    cl: preOpenOpps.filter(o => o.isCL).length
  };

  const totalStats = {
    lead: leadData.length,
    mql: leadData.filter(l => l.isMQL).length,
    sql: leadData.filter(l => l.isSQL).length,
    opp: leadData.filter(l => l.hasOpp).length,
    visitConverted: leadData.filter(l => l.isVisitConverted).length,
    cw: leadData.filter(l => l.isCW).length,
    withTask: leadData.filter(l => l.hasTask).length,
    frtOk: leadData.filter(l => l.frtOk).length,
    wrongEntry: leadData.filter(l => l.isWrongEntry).length,
    preOpen: preOpenStats  // 오픈전 통계
  };

  // 채널별(LeadSource) 리드 품질 분석
  const leadBySource = {};
  leadData.forEach(l => {
    const source = l.leadSource;
    if (!leadBySource[source]) {
      leadBySource[source] = {
        total: 0,
        mql: 0,
        sql: 0,
        opp: 0,
        cw: 0,
        wrongEntry: 0
      };
    }
    leadBySource[source].total++;
    if (l.isMQL) leadBySource[source].mql++;
    if (l.isSQL) leadBySource[source].sql++;
    if (l.hasOpp) leadBySource[source].opp++;
    if (l.isCW) leadBySource[source].cw++;
    if (l.isWrongEntry) leadBySource[source].wrongEntry++;
  });

  // 채널별 전환율 계산
  Object.keys(leadBySource).forEach(source => {
    const s = leadBySource[source];
    s.mqlRate = s.total > 0 ? (s.mql / s.total * 100).toFixed(1) : '0.0';
    s.sqlRate = s.mql > 0 ? (s.sql / s.mql * 100).toFixed(1) : '0.0';
    s.cwRate = s.opp > 0 ? (s.cw / s.opp * 100).toFixed(1) : '0.0';
    s.wrongEntryRate = s.total > 0 ? (s.wrongEntry / s.total * 100).toFixed(1) : '0.0';
  });

  // CL(Closed Lost) 사유 분석
  const clReasons = {};
  let clTotal = 0;
  Object.values(oppDataMap).forEach(opp => {
    if (opp.isCL) {
      clTotal++;
      const reason = opp.lossReason || '(미지정)';
      if (!clReasons[reason]) {
        clReasons[reason] = { count: 0, controllable: false };
      }
      clReasons[reason].count++;
      // 컨트롤 가능한 사유 분류 (예시 - 실제 사유에 맞게 조정 필요)
      if (['고객무응답', '경쟁사', '예산보류', '오픈미확정'].includes(reason)) {
        clReasons[reason].controllable = true;
      }
    }
  });
  // CL 사유별 비율 계산
  Object.keys(clReasons).forEach(reason => {
    clReasons[reason].rate = clTotal > 0 ? (clReasons[reason].count / clTotal * 100).toFixed(1) : '0.0';
  });
  const clStats = {
    total: clTotal,
    byReason: clReasons,
    controllable: Object.entries(clReasons).filter(([_, v]) => v.controllable).reduce((s, [_, v]) => s + v.count, 0),
    uncontrollable: Object.entries(clReasons).filter(([_, v]) => !v.controllable).reduce((s, [_, v]) => s + v.count, 0)
  };

  // Field 담당자별 통계 (영업기회 기준)
  const fieldUserStats = {};
  const boUserStats = {};

  Object.entries(oppDataMap).forEach(([oppId, opp]) => {
    // Field 담당자 통계
    if (opp.fieldUserId) {
      if (!fieldUserStats[opp.fieldUserId]) {
        fieldUserStats[opp.fieldUserId] = {
          name: userNameMap[opp.fieldUserId] || opp.fieldUserId,
          total: 0,
          cw: 0,
          cl: 0,
          open: 0,
          contractProgress: 0,  // 계약진행
          shipmentProgress: 0,  // 출고진행
          installProgress: 0    // 설치진행
        };
      }
      fieldUserStats[opp.fieldUserId].total++;
      if (opp.isCW) fieldUserStats[opp.fieldUserId].cw++;
      if (opp.isCL) fieldUserStats[opp.fieldUserId].cl++;
      if (opp.isOpen) fieldUserStats[opp.fieldUserId].open++;
      if (opp.stageName === '계약진행') fieldUserStats[opp.fieldUserId].contractProgress++;
      if (opp.stageName === '출고진행') fieldUserStats[opp.fieldUserId].shipmentProgress++;
      if (opp.stageName === '설치진행') fieldUserStats[opp.fieldUserId].installProgress++;
    }

    // BO 담당자 통계
    if (opp.boUserId) {
      if (!boUserStats[opp.boUserId]) {
        boUserStats[opp.boUserId] = {
          name: userNameMap[opp.boUserId] || opp.boUserId,
          total: 0,
          cw: 0,
          cl: 0,
          open: 0,
          openByAge: { within3: 0, day4to7: 0, over7: 0 },
          contractProgress: 0,  // 계약진행
          shipmentProgress: 0,  // 출고진행
          installProgress: 0    // 설치진행
        };
      }
      boUserStats[opp.boUserId].total++;
      if (opp.isCW) boUserStats[opp.boUserId].cw++;
      if (opp.isCL) boUserStats[opp.boUserId].cl++;
      if (opp.isOpen) {
        boUserStats[opp.boUserId].open++;
        const age = opp.ageInDays;
        if (age <= 3) boUserStats[opp.boUserId].openByAge.within3++;
        else if (age <= 7) boUserStats[opp.boUserId].openByAge.day4to7++;
        else boUserStats[opp.boUserId].openByAge.over7++;
      }
      if (opp.stageName === '계약진행') boUserStats[opp.boUserId].contractProgress++;
      if (opp.stageName === '출고진행') boUserStats[opp.boUserId].shipmentProgress++;
      if (opp.stageName === '설치진행') boUserStats[opp.boUserId].installProgress++;
    }
  });

  // Field 담당자 정렬 (CW율 기준)
  const fieldStats = Object.entries(fieldUserStats).map(([userId, stats]) => ({
    userId,
    ...stats,
    cwRate: stats.total > 0 ? (stats.cw / stats.total * 100).toFixed(1) : 0,
    clRate: stats.total > 0 ? (stats.cl / stats.total * 100).toFixed(1) : 0
  })).sort((a, b) => b.total - a.total);

  // BO 담당자 정렬 (total 기준)
  const boStats = Object.entries(boUserStats).map(([userId, stats]) => ({
    userId,
    ...stats,
    cwRate: stats.total > 0 ? (stats.cw / stats.total * 100).toFixed(1) : 0,
    clRate: stats.total > 0 ? (stats.cl / stats.total * 100).toFixed(1) : 0
  })).sort((a, b) => b.total - a.total);

  // 견적 단계 분석 (StageName = '견적')
  const quoteStageOpps = Object.entries(oppDataMap)
    .filter(([_, opp]) => opp.stageName === '견적')
    .map(([oppId, opp]) => ({ oppId, ...opp, boUser: userNameMap[opp.boUserId] || '(미배정)' }));

  const quoteStageWithQuote = quoteStageOpps.filter(o => o.hasQuote);
  const quoteStageNoQuote = quoteStageOpps.filter(o => !o.hasQuote); // 견적 단계지만 견적 미발송
  const stale8plus = quoteStageWithQuote.filter(o => o.daysSinceLastTask >= 8).sort((a, b) => b.daysSinceLastTask - a.daysSinceLastTask);
  const stale4to7 = quoteStageWithQuote.filter(o => o.daysSinceLastTask >= 4 && o.daysSinceLastTask < 8).sort((a, b) => b.daysSinceLastTask - a.daysSinceLastTask);

  // 오픈전/일반 구분
  const quoteStagePreOpen = quoteStageOpps.filter(o => o.isPreOpen);
  const quoteStageNormal = quoteStageOpps.filter(o => !o.isPreOpen);
  const quoteStageNoQuoteNormal = quoteStageNoQuote.filter(o => !o.isPreOpen);
  const quoteStageNoQuotePreOpen = quoteStageNoQuote.filter(o => o.isPreOpen);
  const stale8plusNormal = stale8plus.filter(o => !o.isPreOpen);
  const stale8plusPreOpen = stale8plus.filter(o => o.isPreOpen);
  const stale4to7Normal = stale4to7.filter(o => !o.isPreOpen);
  const stale4to7PreOpen = stale4to7.filter(o => o.isPreOpen);

  // BO별 견적 관리 현황
  const boQuoteStats = {};
  quoteStageOpps.forEach(o => {
    const bo = o.boUser;
    if (!boQuoteStats[bo]) boQuoteStats[bo] = {
      total: 0, withQuote: 0, staleCount: 0, stale8plus: 0,
      preOpenTotal: 0, normalTotal: 0
    };
    boQuoteStats[bo].total++;
    if (o.isPreOpen) {
      boQuoteStats[bo].preOpenTotal++;
    } else {
      boQuoteStats[bo].normalTotal++;
    }
    if (o.hasQuote) {
      boQuoteStats[bo].withQuote++;
      if (o.daysSinceLastTask > 3) boQuoteStats[bo].staleCount++;
      if (o.daysSinceLastTask >= 8) boQuoteStats[bo].stale8plus++;
    }
  });

  // 방문 희망일 분포
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const getWeekLabel = (dateStr) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const diffDays = Math.floor((date - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return '과거';
    if (diffDays === 0) return '오늘';
    if (diffDays <= 7) return '이번주';
    if (diffDays <= 14) return '다음주';
    return '2주후+';
  };

  const visitByWeek = { '과거': [], '오늘': [], '이번주': [], '다음주': [], '2주후+': [] };
  const visitByField = {};
  const visitByDate = {}; // 날짜별 방문 건수

  Object.entries(oppDataMap).forEach(([oppId, opp]) => {
    if (opp.salesInviteDate) {
      const week = getWeekLabel(opp.salesInviteDate);
      const dateKey = opp.salesInviteDate; // YYYY-MM-DD

      // 날짜별 집계
      if (!visitByDate[dateKey]) visitByDate[dateKey] = [];
      visitByDate[dateKey].push({
        oppId,
        ...opp,
        fieldUser: userNameMap[opp.fieldUserId] || '(미배정)',
        boUser: userNameMap[opp.boUserId] || '(미배정)'
      });

      if (week) {
        visitByWeek[week].push({
          oppId,
          ...opp,
          fieldUser: userNameMap[opp.fieldUserId] || '(미배정)',
          boUser: userNameMap[opp.boUserId] || '(미배정)'
        });

        // 이번주/다음주 Field별 집계
        if (week === '오늘' || week === '이번주' || week === '다음주') {
          const field = userNameMap[opp.fieldUserId] || '(미배정)';
          if (!visitByField[field]) visitByField[field] = [];
          visitByField[field].push({ oppId, ...opp });
        }
      }
    }
  });

  // ========== 계약 기준 통계 (Contract-based WIP) ==========
  const contractStats = {
    total: contracts?.length || 0,
    cw: 0,
    cwThisMonth: 0,  // 이번달 영업기회에서 CW
    cwPrevMonth: 0,  // 이전 영업기회에서 CW
    byStatus: {},
    byStage: {},
    byRecordType: {},  // RecordType별 (신규/추가설치)
    byBO: {},
    byField: {},
    wip: [], // CW가 아닌 진행중 건
    // 계약 소요일 통계
    leadTimeStats: {
      all: [],  // 전체 소요일 배열
      thisMonth: [],  // 이번달 영업기회 소요일
      prevMonth: [],  // 이전달 영업기회 소요일
      byRange: { '0-7일': 0, '8-14일': 0, '15-30일': 0, '30일+': 0 },
      byRangeThisMonth: { '0-7일': 0, '8-14일': 0, '15-30일': 0, '30일+': 0 },
      byRangePrevMonth: { '0-7일': 0, '8-14일': 0, '15-30일': 0, '30일+': 0 }
    }
  };

  // 이번달 영업기회인지 판별하는 함수
  const isThisMonthOpp = (oppCreatedDate) => {
    if (!oppCreatedDate) return false;
    const oppDate = oppCreatedDate.substring(0, 10); // YYYY-MM-DD
    return oppDate >= startDate && oppDate < endDate;
  };

  if (contracts && contracts.length > 0) {
    contracts.forEach(c => {
      // ContractStatus별
      const status = c.ContractStatus__c || '(없음)';
      contractStats.byStatus[status] = (contractStats.byStatus[status] || 0) + 1;

      // Opportunity StageName별
      const stage = c.Opportunity__r?.StageName || '(없음)';
      contractStats.byStage[stage] = (contractStats.byStage[stage] || 0) + 1;

      // 이번달 영업기회 여부
      const oppCreatedDate = c.Opportunity__r?.CreatedDate;
      const isCurrentMonthOpp = isThisMonthOpp(oppCreatedDate);

      // 계약 소요일 계산 (영업기회 생성 → 계약 시작)
      let leadTimeDays = null;
      if (oppCreatedDate && c.ContractDateStart__c) {
        const oppDate = new Date(oppCreatedDate);
        const contractDate = new Date(c.ContractDateStart__c);
        leadTimeDays = Math.floor((contractDate - oppDate) / (1000 * 60 * 60 * 24));
        if (leadTimeDays >= 0) {
          contractStats.leadTimeStats.all.push(leadTimeDays);
          if (leadTimeDays <= 7) contractStats.leadTimeStats.byRange['0-7일']++;
          else if (leadTimeDays <= 14) contractStats.leadTimeStats.byRange['8-14일']++;
          else if (leadTimeDays <= 30) contractStats.leadTimeStats.byRange['15-30일']++;
          else contractStats.leadTimeStats.byRange['30일+']++;

          // 이번달/이전달 영업기회 구분
          if (isCurrentMonthOpp) {
            contractStats.leadTimeStats.thisMonth.push(leadTimeDays);
            if (leadTimeDays <= 7) contractStats.leadTimeStats.byRangeThisMonth['0-7일']++;
            else if (leadTimeDays <= 14) contractStats.leadTimeStats.byRangeThisMonth['8-14일']++;
            else if (leadTimeDays <= 30) contractStats.leadTimeStats.byRangeThisMonth['15-30일']++;
            else contractStats.leadTimeStats.byRangeThisMonth['30일+']++;
          } else {
            contractStats.leadTimeStats.prevMonth.push(leadTimeDays);
            if (leadTimeDays <= 7) contractStats.leadTimeStats.byRangePrevMonth['0-7일']++;
            else if (leadTimeDays <= 14) contractStats.leadTimeStats.byRangePrevMonth['8-14일']++;
            else if (leadTimeDays <= 30) contractStats.leadTimeStats.byRangePrevMonth['15-30일']++;
            else contractStats.leadTimeStats.byRangePrevMonth['30일+']++;
          }
        }
      }

      // 전체 CW 통계 (이번달/이전달 구분)
      if (stage === 'Closed Won') {
        contractStats.cw++;
        if (isCurrentMonthOpp) contractStats.cwThisMonth++;
        else contractStats.cwPrevMonth++;
      }

      // RecordType별 (신규/추가설치 분류)
      const recordTypeRaw = c.Opportunity__r?.RecordType?.Name || '(없음)';
      const recordTypeCategory = recordTypeRaw.includes('추가설치') ? '추가설치' : recordTypeRaw.includes('신규') ? '신규' : '기타';

      if (!contractStats.byRecordType[recordTypeCategory]) {
        contractStats.byRecordType[recordTypeCategory] = { total: 0, cw: 0, wip: 0 };
      }
      contractStats.byRecordType[recordTypeCategory].total++;
      if (stage === 'Closed Won') contractStats.byRecordType[recordTypeCategory].cw++;
      else if (stage !== 'Closed Lost') contractStats.byRecordType[recordTypeCategory].wip++;

      // BO별 (RecordType 포함)
      const bo = c.Opportunity__r?.BOUser__r?.Name || '(미배정)';
      if (!contractStats.byBO[bo]) {
        contractStats.byBO[bo] = {
          total: 0, cw: 0, cwThisMonth: 0, cwPrevMonth: 0, wip: 0,
          계약진행: 0, 출고진행: 0, 설치진행: 0, 계약서명대기: 0,
          신규: { total: 0, cw: 0, wip: 0 },
          추가설치: { total: 0, cw: 0, wip: 0 },
          leadTimes: [],  // 전체 소요일 배열
          leadTimesThisMonth: [],  // 이번달 영업기회 소요일
          leadTimesPrevMonth: []   // 이전 영업기회 소요일
        };
      }
      if (leadTimeDays !== null && leadTimeDays >= 0) {
        contractStats.byBO[bo].leadTimes.push(leadTimeDays);
        if (isCurrentMonthOpp) {
          contractStats.byBO[bo].leadTimesThisMonth.push(leadTimeDays);
        } else {
          contractStats.byBO[bo].leadTimesPrevMonth.push(leadTimeDays);
        }
      }
      contractStats.byBO[bo].total++;
      if (stage === 'Closed Won') {
        contractStats.byBO[bo].cw++;
        if (isCurrentMonthOpp) contractStats.byBO[bo].cwThisMonth++;
        else contractStats.byBO[bo].cwPrevMonth++;
      } else {
        contractStats.byBO[bo].wip++;
      }
      if (stage === '계약진행') contractStats.byBO[bo]['계약진행']++;
      if (stage === '출고진행') contractStats.byBO[bo]['출고진행']++;
      if (stage === '설치진행') contractStats.byBO[bo]['설치진행']++;
      if (c.ContractStatus__c === '계약서명대기') contractStats.byBO[bo]['계약서명대기']++;
      // BO별 신규/추가설치
      if (recordTypeCategory === '신규' || recordTypeCategory === '추가설치') {
        contractStats.byBO[bo][recordTypeCategory].total++;
        if (stage === 'Closed Won') contractStats.byBO[bo][recordTypeCategory].cw++;
        else if (stage !== 'Closed Lost') contractStats.byBO[bo][recordTypeCategory].wip++;
      }

      // Field별 (RecordType 포함)
      const field = c.Opportunity__r?.FieldUser__r?.Name || '(미배정)';
      if (!contractStats.byField[field]) {
        contractStats.byField[field] = {
          total: 0, cw: 0, cwThisMonth: 0, cwPrevMonth: 0, wip: 0,
          계약진행: 0, 출고진행: 0, 설치진행: 0,
          신규: { total: 0, cw: 0, wip: 0 },
          추가설치: { total: 0, cw: 0, wip: 0 },
          leadTimes: [],  // 전체 소요일 배열
          leadTimesThisMonth: [],  // 이번달 영업기회 소요일
          leadTimesPrevMonth: []   // 이전 영업기회 소요일
        };
      }
      if (leadTimeDays !== null && leadTimeDays >= 0) {
        contractStats.byField[field].leadTimes.push(leadTimeDays);
        if (isCurrentMonthOpp) {
          contractStats.byField[field].leadTimesThisMonth.push(leadTimeDays);
        } else {
          contractStats.byField[field].leadTimesPrevMonth.push(leadTimeDays);
        }
      }
      contractStats.byField[field].total++;
      if (stage === 'Closed Won') {
        contractStats.byField[field].cw++;
        if (isCurrentMonthOpp) contractStats.byField[field].cwThisMonth++;
        else contractStats.byField[field].cwPrevMonth++;
      } else {
        contractStats.byField[field].wip++;
      }
      if (stage === '계약진행') contractStats.byField[field]['계약진행']++;
      if (stage === '출고진행') contractStats.byField[field]['출고진행']++;
      if (stage === '설치진행') contractStats.byField[field]['설치진행']++;
      // Field별 신규/추가설치
      if (recordTypeCategory === '신규' || recordTypeCategory === '추가설치') {
        contractStats.byField[field][recordTypeCategory].total++;
        if (stage === 'Closed Won') contractStats.byField[field][recordTypeCategory].cw++;
        else if (stage !== 'Closed Lost') contractStats.byField[field][recordTypeCategory].wip++;
      }

      // WIP 목록 (CW 아닌 건)
      if (stage !== 'Closed Won' && stage !== 'Closed Lost') {
        contractStats.wip.push({
          name: c.Name,
          stage,
          status: c.ContractStatus__c,
          recordType: recordTypeCategory,
          bo,
          field,
          account: c.Account__r?.Name || '-',
          oppName: c.Opportunity__r?.Name || '-',
          contractStart: c.ContractDateStart__c
        });
      }
    });
  }

  // ========== 3단계: 주차별 추이 ==========
  const weeklyTrend = {};
  leadData.forEach(l => {
    // ISO 주차 계산
    const date = new Date(l.dateStr);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay() + 1); // 월요일 기준
    const weekKey = weekStart.toISOString().split('T')[0];

    if (!weeklyTrend[weekKey]) {
      weeklyTrend[weekKey] = {
        weekStart: weekKey,
        lead: 0, mql: 0, sql: 0, opp: 0, cw: 0,
        wrongEntry: 0, frtOk: 0, withTask: 0
      };
    }
    weeklyTrend[weekKey].lead++;
    if (l.isMQL) weeklyTrend[weekKey].mql++;
    if (l.isSQL) weeklyTrend[weekKey].sql++;
    if (l.hasOpp) weeklyTrend[weekKey].opp++;
    if (l.isCW) weeklyTrend[weekKey].cw++;
    if (l.isWrongEntry) weeklyTrend[weekKey].wrongEntry++;
    if (l.frtOk) weeklyTrend[weekKey].frtOk++;
    if (l.hasTask) weeklyTrend[weekKey].withTask++;
  });

  // 주차별 전환율 계산
  Object.keys(weeklyTrend).forEach(week => {
    const w = weeklyTrend[week];
    w.mqlRate = w.lead > 0 ? parseFloat((w.mql / w.lead * 100).toFixed(1)) : 0;
    w.sqlRate = w.mql > 0 ? parseFloat((w.sql / w.mql * 100).toFixed(1)) : 0;
    w.frtRate = w.withTask > 0 ? parseFloat((w.frtOk / w.withTask * 100).toFixed(1)) : 0;
    w.wrongEntryRate = w.lead > 0 ? parseFloat((w.wrongEntry / w.lead * 100).toFixed(1)) : 0;
  });

  // 정렬된 배열로 변환
  const weeklyTrendArray = Object.values(weeklyTrend).sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // ========== 3단계: BO 워크로드 밸런스 ==========
  // Lead 전환 기준 (대부분 신규 영업기회)
  const boWorkload = {};
  Object.entries(oppDataMap).forEach(([oppId, opp]) => {
    if (!opp.boUserId) return;
    const bo = userNameMap[opp.boUserId] || opp.boUserId;

    if (!boWorkload[bo]) {
      boWorkload[bo] = {
        name: bo,
        currentOpen: 0,        // 현재 진행중 (전체)
        normalOpen: 0,         // 일반 진행중 (오픈전 제외)
        preOpenOpen: 0,        // 오픈전 진행중
        periodInflow: 0,       // 기간 내 배정 (Lead 전환)
        periodProcessed: 0,    // 기간 내 처리 (CW + CL)
        periodCW: 0,
        periodCL: 0,
        netChange: 0           // 순증감 (inflow - processed)
      };
    }

    // 현재 진행중 (전체 및 오픈전 구분)
    if (opp.isOpen) {
      boWorkload[bo].currentOpen++;
      if (opp.isPreOpen) {
        boWorkload[bo].preOpenOpen++;
      } else {
        boWorkload[bo].normalOpen++;
      }
    }

    // 기간 내 생성된 영업기회 (inflow)
    if (opp.createdDate) {
      const created = opp.createdDate.split('T')[0];
      if (created >= startDate && created <= endDate) {
        boWorkload[bo].periodInflow++;
      }
    }

    // 기간 내 완료 (CW/CL)
    if (opp.isCW) boWorkload[bo].periodCW++;
    if (opp.isCL) boWorkload[bo].periodCL++;
    boWorkload[bo].periodProcessed = boWorkload[bo].periodCW + boWorkload[bo].periodCL;
    boWorkload[bo].netChange = boWorkload[bo].periodInflow - boWorkload[bo].periodProcessed;
  });

  // ========== 3단계: Field 행동지표 ==========
  const fieldActivityStats = {};
  Object.entries(oppDataMap).forEach(([oppId, opp]) => {
    if (!opp.fieldUserId) return;
    const field = userNameMap[opp.fieldUserId] || opp.fieldUserId;

    if (!fieldActivityStats[field]) {
      fieldActivityStats[field] = {
        name: field,
        totalOpps: 0,
        // 일반 (오픈전 제외)
        normalOpen: 0,
        normalRetouchDaysSum: 0,
        normalRetouchCount: 0,
        normalRetouchOver7: 0,
        avgRetouchDays: null,
        retouchOver7: 0,
        // 오픈전
        preOpenCount: 0,
        preOpenOpen: 0,
        preOpenRetouchDaysSum: 0,
        preOpenRetouchCount: 0,
        preOpenRetouchOver7: 0,
        preOpenAvgRetouchDays: null,
        // 전체 결과
        cw: 0,
        cl: 0,
        open: 0
      };
    }

    const f = fieldActivityStats[field];
    f.totalOpps++;
    if (opp.isCW) f.cw++;
    if (opp.isCL) f.cl++;
    if (opp.isOpen) f.open++;

    if (opp.isPreOpen) {
      // 오픈전 건
      f.preOpenCount++;
      if (opp.isOpen) {
        f.preOpenOpen++;
        if (opp.daysSinceLastTask !== null) {
          f.preOpenRetouchDaysSum += opp.daysSinceLastTask;
          f.preOpenRetouchCount++;
          if (opp.daysSinceLastTask > 7) f.preOpenRetouchOver7++;
        }
      }
    } else {
      // 일반 건 (오픈전 제외)
      if (opp.isOpen) {
        f.normalOpen++;
        if (opp.daysSinceLastTask !== null) {
          f.normalRetouchDaysSum += opp.daysSinceLastTask;
          f.normalRetouchCount++;
          if (opp.daysSinceLastTask > 7) f.normalRetouchOver7++;
        }
      }
    }
  });

  // 평균 계산
  Object.values(fieldActivityStats).forEach(f => {
    // 일반 건 평균
    f.avgRetouchDays = f.normalRetouchCount > 0
      ? parseFloat((f.normalRetouchDaysSum / f.normalRetouchCount).toFixed(1))
      : null;
    f.retouchOver7 = f.normalRetouchOver7;
    // 오픈전 건 평균
    f.preOpenAvgRetouchDays = f.preOpenRetouchCount > 0
      ? parseFloat((f.preOpenRetouchDaysSum / f.preOpenRetouchCount).toFixed(1))
      : null;
    f.cwRate = f.totalOpps > 0 ? parseFloat((f.cw / f.totalOpps * 100).toFixed(1)) : 0;
    // 불필요한 중간 필드 제거
    delete f.normalRetouchDaysSum;
    delete f.normalRetouchCount;
    delete f.preOpenRetouchDaysSum;
    delete f.preOpenRetouchCount;
  });

  return {
    leadData,
    ownerStats,
    frtBucketStats,
    wrongEntryReasons,
    totalStats,
    leadBySource,
    clStats,
    weeklyTrend: weeklyTrendArray,
    boWorkload: Object.values(boWorkload).sort((a, b) => b.currentOpen - a.currentOpen),
    fieldActivityStats: Object.values(fieldActivityStats).sort((a, b) => b.totalOpps - a.totalOpps),
    weekdays,
    taskByOwnerDate,
    fieldStats,
    boStats,
    // 견적/방문 관련
    quoteStageOpps,
    quoteStageWithQuote,
    quoteStageNoQuote,
    quoteStagePreOpen,
    quoteStageNormal,
    quoteStageNoQuoteNormal,
    quoteStageNoQuotePreOpen,
    stale8plus,
    stale4to7,
    stale8plusNormal,
    stale8plusPreOpen,
    stale4to7Normal,
    stale4to7PreOpen,
    boQuoteStats,
    visitByWeek,
    visitByField,
    visitByDate,
    // 계약 기준
    contractStats
  };
}

// ============================================
// 리포트 출력 (콘솔)
// ============================================
function printReport(stats, periodLabel) {
  const { ownerStats, frtBucketStats, wrongEntryReasons, totalStats, weekdays, taskByOwnerDate, fieldStats, boStats,
          quoteStageOpps, quoteStageWithQuote, quoteStageNoQuote, stale8plus, stale4to7, boQuoteStats, visitByWeek, visitByField } = stats;

  console.log('\n');
  console.log('═'.repeat(100));
  console.log(`📊 인바운드 세일즈 리포트 (${periodLabel})`);
  console.log('═'.repeat(100));

  // 1. 전체 퍼널
  console.log('\n📈 전체 퍼널');
  console.log('─'.repeat(60));
  console.log(`
Lead        ${totalStats.lead}건
   ↓ ${(totalStats.mql / totalStats.lead * 100).toFixed(1)}%
MQL         ${totalStats.mql}건
   ↓ ${(totalStats.sql / totalStats.mql * 100).toFixed(1)}%
SQL         ${totalStats.sql}건
   ↓
영업기회    ${totalStats.opp}건
   ↓ ${(totalStats.visitConverted / totalStats.opp * 100).toFixed(1)}%
방문전환    ${totalStats.visitConverted}건
   ↓ ${(totalStats.cw / totalStats.opp * 100).toFixed(1)}% (참고: Field 영역)
CW(계약)    ${totalStats.cw}건
`);

  // 2. 담당자별 퍼널
  console.log('\n👤 담당자별 퍼널');
  console.log('─'.repeat(115));
  console.log('담당자'.padEnd(10) + 'Lead'.padStart(7) + 'MQL'.padStart(7) + 'MQL율'.padStart(8) + 'SQL'.padStart(7) + 'SQL율'.padStart(8) + '영업기회'.padStart(9) + '방문전환'.padStart(9) + '전환율'.padStart(8) + 'CW'.padStart(5) + '(참고)'.padStart(7));
  console.log('─'.repeat(115));

  ownerStats.filter(s => s.lead > 0 && !s.name.startsWith('005')).forEach(s => {
    console.log(
      s.name.substring(0, 8).padEnd(10) +
      (s.lead + '건').padStart(7) +
      (s.mql + '건').padStart(7) +
      (s.mqlRate + '%').padStart(8) +
      (s.sql + '건').padStart(7) +
      (s.sqlRate + '%').padStart(8) +
      (s.opp + '건').padStart(9) +
      (s.visitConverted + '건').padStart(9) +
      (s.visitConvertedRate + '%').padStart(8) +
      (s.cw + '건').padStart(5) +
      (s.cwRate + '%').padStart(7)
    );
  });

  // 3. 담당자별 FRT & Task
  console.log('\n\n👤 담당자별 FRT & Task 생산량');
  console.log('─'.repeat(100));
  console.log('담당자'.padEnd(10) + 'Lead'.padStart(7) + 'Task有'.padStart(8) + '평균FRT'.padStart(10) + 'FRT준수'.padStart(9) + '준수율'.padStart(8) + 'Task총'.padStart(8) + '일평균'.padStart(9) + '30+일수'.padStart(9));
  console.log('─'.repeat(100));

  ownerStats.filter(s => (s.lead > 0 || s.totalTasks > 100) && !s.name.startsWith('005')).forEach(s => {
    console.log(
      s.name.substring(0, 8).padEnd(10) +
      (s.lead + '건').padStart(7) +
      (s.withTask + '건').padStart(8) +
      (s.avgFrt ? s.avgFrt.toFixed(0) + '분' : '-').padStart(10) +
      (s.frtOk + '건').padStart(9) +
      (s.frtRate + '%').padStart(8) +
      (s.totalTasks + '건').padStart(8) +
      (s.avgDaily.toFixed(1) + '건').padStart(9) +
      (s.daysOver30 + '/' + s.totalWeekdays + '일').padStart(9)
    );
  });

  // 4. 담당자별 시간대별 FRT/오인입
  console.log('\n\n👤 담당자별 시간대별 분석');
  ownerStats.filter(s => s.lead > 0 && !s.name.startsWith('005')).forEach(s => {
    console.log('\n' + '─'.repeat(90));
    console.log(`👤 ${s.name} (Lead ${s.lead}건)`);
    console.log('─'.repeat(90));
    console.log('시간대'.padEnd(14) + 'Lead'.padStart(7) + '평균FRT'.padStart(10) + 'FRT준수'.padStart(9) + '준수율'.padStart(8) + '오인입'.padStart(8) + '오인입률'.padStart(9) + '전환'.padStart(7) + '전환율'.padStart(8));
    console.log('─'.repeat(90));

    ['BUSINESS_HOUR', 'OFF_HOUR', 'WEEKEND'].forEach(slot => {
      const st = s.timeSlotStats[slot];
      if (st.total === 0) return;
      console.log(
        TIME_SLOT_LABELS[slot].padEnd(14) +
        (st.total + '건').padStart(7) +
        (st.avgFrt ? st.avgFrt.toFixed(0) + '분' : '-').padStart(10) +
        (st.frtOk + '건').padStart(9) +
        (st.frtRate + '%').padStart(8) +
        (st.wrongEntry + '건').padStart(8) +
        (st.wrongEntryRate + '%').padStart(9) +
        (st.converted + '건').padStart(7) +
        (st.conversionRate + '%').padStart(8)
      );
    });
  });

  // 5. FRT 구간별 오인입/전환 분석
  console.log('\n\n📈 FRT 구간별 오인입/전환 분석');
  console.log('─'.repeat(85));
  console.log('FRT 구간'.padEnd(12) + '전체'.padStart(8) + '오인입'.padStart(8) + '오인입률'.padStart(10) + '문의X'.padStart(8) + '문의X률'.padStart(10) + '전환'.padStart(8) + '전환율'.padStart(10));
  console.log('─'.repeat(85));

  frtBucketStats.forEach(b => {
    if (b.total === 0) return;
    const bucketName = b.bucket === 'NO_TASK' ? 'Task없음' : b.bucket;
    console.log(
      bucketName.padEnd(12) +
      (b.total + '건').padStart(8) +
      (b.wrongEntry + '건').padStart(8) +
      (b.wrongEntryRate + '%').padStart(10) +
      (b.noInquiry + '건').padStart(8) +
      (b.noInquiryRate + '%').padStart(10) +
      (b.converted + '건').padStart(8) +
      (b.conversionRate + '%').padStart(10)
    );
  });

  // 6. 오인입 사유 분석
  const totalWrongEntry = Object.values(wrongEntryReasons).reduce((a, b) => a + b, 0);
  console.log('\n\n📋 오인입 사유 분석 (총 ' + totalWrongEntry + '건)');
  console.log('─'.repeat(50));

  Object.entries(wrongEntryReasons)
    .sort((a, b) => b[1] - a[1])
    .forEach(([reason, count]) => {
      const pct = (count / totalWrongEntry * 100).toFixed(1);
      console.log(reason.padEnd(25) + (count + '건').padStart(8) + (pct + '%').padStart(10));
    });

  // 7. Field 담당자별 통계
  console.log('\n\n🚗 Field 담당자별 CW 전환율');
  console.log('─'.repeat(85));
  console.log('Field 담당자'.padEnd(15) + '영업기회'.padStart(10) + 'CW'.padStart(8) + 'CW율'.padStart(8) + 'CL'.padStart(8) + 'CL율'.padStart(8) + '진행중'.padStart(10));
  console.log('─'.repeat(85));

  fieldStats.filter(s => s.total > 0).forEach(s => {
    console.log(
      s.name.substring(0, 12).padEnd(15) +
      (s.total + '건').padStart(10) +
      (s.cw + '건').padStart(8) +
      (s.cwRate + '%').padStart(8) +
      (s.cl + '건').padStart(8) +
      (s.clRate + '%').padStart(8) +
      (s.open + '건').padStart(10)
    );
  });

  // 8. BO 담당자별 통계
  console.log('\n\n📋 BO 담당자별 CW 전환율 & SQL 잔량');
  console.log('─'.repeat(100));
  console.log('BO 담당자'.padEnd(15) + '영업기회'.padStart(10) + 'CW'.padStart(8) + 'CW율'.padStart(8) + '진행중'.padStart(10) + '3일이내'.padStart(10) + '4~7일'.padStart(10) + '7일초과'.padStart(10));
  console.log('─'.repeat(100));

  boStats.filter(s => s.total > 0).forEach(s => {
    console.log(
      s.name.substring(0, 12).padEnd(15) +
      (s.total + '건').padStart(10) +
      (s.cw + '건').padStart(8) +
      (s.cwRate + '%').padStart(8) +
      (s.open + '건').padStart(10) +
      (s.openByAge.within3 + '건').padStart(10) +
      (s.openByAge.day4to7 + '건').padStart(10) +
      (s.openByAge.over7 + '건').padStart(10)
    );
  });

  // 9. 견적 단계 리터치 현황
  console.log('\n\n📝 견적 단계 리터치 현황');
  console.log('─'.repeat(100));
  console.log(`견적 단계: ${quoteStageOpps.length}건 | 견적有: ${quoteStageWithQuote.length}건 | 8일+ 경과: ${stale8plus.length}건 | 4~7일 경과: ${stale4to7.length}건`);

  if (quoteStageNoQuote.length > 0) {
    console.log('\n⚠️ 견적 미발송 건 (견적 단계이나 Quote 없음)');
    console.log('─'.repeat(100));
    quoteStageNoQuote.forEach(o => {
      const createdKST = o.createdDate ? new Date(new Date(o.createdDate).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0] : '-';
      console.log(`  ${(o.oppName || o.oppId).substring(0, 25).padEnd(25)} | 생성일: ${createdKST} | BO: ${o.boUser}`);
    });
  }

  if (stale8plus.length > 0) {
    console.log('\n🚨 8일+ 연락 끊긴 건');
    console.log('─'.repeat(100));
    stale8plus.slice(0, 10).forEach(o => {
      const quoteKST = o.quoteDate ? new Date(new Date(o.quoteDate).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0] : '-';
      const lastTaskKST = o.lastTaskDate ? new Date(new Date(o.lastTaskDate).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0] : quoteKST;
      console.log(`  ${(o.oppName || o.oppId).substring(0, 20).padEnd(20)} | 견적: ${quoteKST} | 마지막Task: ${lastTaskKST} | ${o.daysSinceLastTask}일 경과 | BO: ${o.boUser}`);
    });
  }

  if (stale4to7.length > 0) {
    console.log('\n⏰ 4~7일 경과 건');
    console.log('─'.repeat(100));
    stale4to7.forEach(o => {
      const quoteKST = o.quoteDate ? new Date(new Date(o.quoteDate).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0] : '-';
      const lastTaskKST = o.lastTaskDate ? new Date(new Date(o.lastTaskDate).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0] : quoteKST;
      console.log(`  ${(o.oppName || o.oppId).substring(0, 20).padEnd(20)} | 견적: ${quoteKST} | 마지막Task: ${lastTaskKST} | ${o.daysSinceLastTask}일 경과 | BO: ${o.boUser}`);
    });
  }

  // BO별 견적 관리 현황
  console.log('\n👤 BO별 견적 관리 현황 (견적 단계)');
  console.log('─'.repeat(70));
  console.log('BO 담당자'.padEnd(12) + '총건수'.padStart(8) + '견적有'.padStart(8) + '3일+경과'.padStart(10) + '8일+경과'.padStart(10));
  console.log('─'.repeat(70));
  Object.entries(boQuoteStats).sort((a, b) => b[1].total - a[1].total).forEach(([bo, data]) => {
    console.log(
      bo.substring(0, 10).padEnd(12) +
      (data.total + '건').padStart(8) +
      (data.withQuote + '건').padStart(8) +
      (data.staleCount + '건').padStart(10) +
      (data.stale8plus + '건').padStart(10)
    );
  });

  // 10. 방문 희망일 분포
  console.log('\n\n📅 방문 희망일 분포');
  console.log('─'.repeat(50));
  console.log('👤 Field 담당자별 방문 예정 (이번주 + 다음주)');
  console.log('─'.repeat(50));
  Object.entries(visitByField).sort((a, b) => b[1].length - a[1].length).forEach(([field, items]) => {
    console.log(`  ${field}: ${items.length}건`);
  });

  console.log('\n' + '═'.repeat(100));
  console.log('리포트 완료');
  console.log('═'.repeat(100));
}

// ============================================
// Slack 전송
// ============================================
async function sendSlack(stats, periodLabel, mode = 'daily') {
  const { ownerStats, totalStats, quoteStageOpps, quoteStageNoQuote, stale8plus, stale4to7, contractStats,
          quoteStageNoQuoteNormal, quoteStageNoQuotePreOpen, stale8plusNormal, stale8plusPreOpen,
          stale4to7Normal, stale4to7PreOpen, boWorkload, fieldActivityStats } = stats;

  const avgLeadTimeThisMonth = contractStats.leadTimeStats.thisMonth.length > 0
    ? (contractStats.leadTimeStats.thisMonth.reduce((a,b) => a+b, 0) / contractStats.leadTimeStats.thisMonth.length).toFixed(1)
    : '-';
  const avgLeadTimePrevMonth = contractStats.leadTimeStats.prevMonth.length > 0
    ? (contractStats.leadTimeStats.prevMonth.reduce((a,b) => a+b, 0) / contractStats.leadTimeStats.prevMonth.length).toFixed(1)
    : '-';

  // BO 워크로드 요약 (오픈전 포함)
  const boList = Object.values(boWorkload);
  const totalBoOpen = boList.reduce((sum, b) => sum + b.currentOpen, 0);
  const totalBoNormalOpen = boList.reduce((sum, b) => sum + b.normalOpen, 0);
  const totalBoPreOpenOpen = boList.reduce((sum, b) => sum + b.preOpenOpen, 0);

  // Field 행동지표 요약 (오픈전 포함)
  const fieldList = Object.values(fieldActivityStats);
  const totalFieldNormalOpen = fieldList.reduce((sum, f) => sum + f.normalOpen, 0);
  const totalFieldPreOpenOpen = fieldList.reduce((sum, f) => sum + f.preOpenOpen, 0);

  let message = '';

  if (mode === 'daily') {
    // Daily: 간단한 요약 - 당일 액션 아이템 중심
    message = `📊 인바운드 세일즈 데일리 리포트 (${periodLabel})

*📈 전체 퍼널*
Lead ${totalStats.lead}건 → MQL ${totalStats.mql}건(${(totalStats.mql / totalStats.lead * 100).toFixed(1)}%) → SQL ${totalStats.sql}건 → 방문전환 ${totalStats.visitConverted}건

*📞 Inside Sales*
• FRT 준수율: ${(totalStats.frtOk / totalStats.withTask * 100).toFixed(1)}% | 오인입: ${totalStats.wrongEntry}건(${(totalStats.wrongEntry / totalStats.lead * 100).toFixed(1)}%)

*🏃 Inside Field*
• 잔량: 일반 ${totalFieldNormalOpen}건 | 오픈전 ${totalFieldPreOpenOpen}건

*📋 Inside Back Office*
• 잔량: 일반 ${totalBoNormalOpen}건 | 오픈전 ${totalBoPreOpenOpen}건
• 견적 미발송: 일반 ${quoteStageNoQuoteNormal.length}건 | 오픈전 ${quoteStageNoQuotePreOpen.length}건
• 8일+경과: 일반 ${stale8plusNormal.length}건 | 오픈전 ${stale8plusPreOpen.length}건

*📄 이번달 계약*
• CW: ${contractStats.cw}건 (이번달 영업기회 ${contractStats.cwThisMonth}건 | 이전 ${contractStats.cwPrevMonth}건) | WIP: ${contractStats.wip.length}건
`;

  } else if (mode === 'weekly') {
    // Weekly: 주간 분석 - 담당자별 현황 포함
    const tmOwners = ownerStats.filter(s => s.lead > 0 && !s.name.startsWith('005'));
    const topPerformers = tmOwners.sort((a, b) => parseFloat(b.mqlRate) - parseFloat(a.mqlRate)).slice(0, 3);

    message = `📊 인바운드 세일즈 주간 리포트 (${periodLabel})

*📈 전체 퍼널*
Lead ${totalStats.lead}건 → MQL ${totalStats.mql}건(${(totalStats.mql / totalStats.lead * 100).toFixed(1)}%) → SQL ${totalStats.sql}건 → 방문전환 ${totalStats.visitConverted}건

*📞 Inside Sales*
• FRT 준수율: ${(totalStats.frtOk / totalStats.withTask * 100).toFixed(1)}% | 오인입: ${totalStats.wrongEntry}건
• MQL 전환율 TOP3: ${topPerformers.map((s, i) => `${s.name} ${s.mqlRate}%`).join(' | ')}

*🏃 Inside Field*
• 잔량: 일반 ${totalFieldNormalOpen}건 | 오픈전 ${totalFieldPreOpenOpen}건

*📋 Inside Back Office*
• 잔량: 일반 ${totalBoNormalOpen}건 | 오픈전 ${totalBoPreOpenOpen}건
• 견적: 전체 ${quoteStageOpps.length}건 | 미발송 ${quoteStageNoQuote.length}건(일반 ${quoteStageNoQuoteNormal.length}/오픈전 ${quoteStageNoQuotePreOpen.length})
• 8일+경과: 일반 ${stale8plusNormal.length}건 | 오픈전 ${stale8plusPreOpen.length}건

*📄 이번달 계약*
• CW: ${contractStats.cw}건 (이번달 영업기회 ${contractStats.cwThisMonth}건 | 이전 ${contractStats.cwPrevMonth}건) | WIP: ${contractStats.wip.length}건
`;

  } else {
    // Monthly: 전체 분석 - 모든 지표 포함
    message = `📊 인바운드 세일즈 월간 리포트 (${periodLabel})

*📈 전체 퍼널*
Lead ${totalStats.lead}건 → MQL ${totalStats.mql}건(${(totalStats.mql / totalStats.lead * 100).toFixed(1)}%) → SQL ${totalStats.sql}건 → 방문전환 ${totalStats.visitConverted}건

*📞 Inside Sales*
• FRT 준수율: ${(totalStats.frtOk / totalStats.withTask * 100).toFixed(1)}% | 오인입: ${totalStats.wrongEntry}건(${(totalStats.wrongEntry / totalStats.lead * 100).toFixed(1)}%)

*🏃 Inside Field*
• 잔량: 일반 ${totalFieldNormalOpen}건 | 오픈전 ${totalFieldPreOpenOpen}건

*📋 Inside Back Office*
• 잔량: 일반 ${totalBoNormalOpen}건 | 오픈전 ${totalBoPreOpenOpen}건
• 견적: 전체 ${quoteStageOpps.length}건 | 미발송 ${quoteStageNoQuote.length}건(일반 ${quoteStageNoQuoteNormal.length}/오픈전 ${quoteStageNoQuotePreOpen.length})
• 8일+경과: 일반 ${stale8plusNormal.length}건 | 오픈전 ${stale8plusPreOpen.length}건 | 4~7일: 일반 ${stale4to7Normal.length}건 | 오픈전 ${stale4to7PreOpen.length}건

*📄 이번달 계약*
• 전체: ${contractStats.total}건 | WIP: ${contractStats.wip.length}건
• CW: ${contractStats.cw}건 (이번달 영업기회 ${contractStats.cwThisMonth}건 | 이전 ${contractStats.cwPrevMonth}건)
• 신규: ${contractStats.byRecordType['신규']?.total || 0}건(WIP ${contractStats.byRecordType['신규']?.wip || 0}) | 추가설치: ${contractStats.byRecordType['추가설치']?.total || 0}건(WIP ${contractStats.byRecordType['추가설치']?.wip || 0})
• 평균소요일: 이번달 ${avgLeadTimeThisMonth}일 | 이전 ${avgLeadTimePrevMonth}일
`;
  }

  try {
    const response = await axios.post('https://slack.com/api/chat.postMessage', {
      channel: process.env.SLACK_CHANNEL_ID,
      text: message,
    }, {
      headers: { 'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' }
    });
    if (response.data.ok) {
      console.log('\n✅ Slack 전송 완료');
    } else {
      console.error('\n❌ Slack 전송 실패:', response.data.error);
    }
  } catch (error) {
    console.error('\n❌ Slack 전송 에러:', error.message);
  }
}

// ============================================
// HTML 리포트 생성
// ============================================
function generateHTML(stats, periodLabel, startDate, endDate, previousPeriodStats = null) {
  const { ownerStats, frtBucketStats, wrongEntryReasons, totalStats, fieldStats, boStats,
          quoteStageOpps, quoteStageWithQuote, quoteStageNoQuote, quoteStagePreOpen, quoteStageNormal,
          quoteStageNoQuoteNormal, quoteStageNoQuotePreOpen,
          stale8plus, stale4to7, stale8plusNormal, stale8plusPreOpen, stale4to7Normal, stale4to7PreOpen,
          boQuoteStats, visitByWeek, visitByField, visitByDate, contractStats,
          leadBySource, clStats, weeklyTrend, boWorkload, fieldActivityStats } = stats;

  // ID로 표기되는 담당자 제외 (인바운드세일즈 부서 외)
  const tmOwners = ownerStats.filter(s => s.lead > 0 && !s.name.startsWith('005'));
  const totalWrongEntry = Object.values(wrongEntryReasons).reduce((a, b) => a + b, 0);

  // 목표 대비 달성률 계산
  const mqlRate = totalStats.lead > 0 ? (totalStats.mql / totalStats.lead * 100) : 0;
  const sqlRate = totalStats.mql > 0 ? (totalStats.sql / totalStats.mql * 100) : 0;
  const frtRate = totalStats.withTask > 0 ? (totalStats.frtOk / totalStats.withTask * 100) : 0;
  const wrongEntryRateCalc = totalStats.lead > 0 ? (totalStats.wrongEntry / totalStats.lead * 100) : 0;

  const getStatus = (actual, target, isLowerBetter = false) => {
    if (isLowerBetter) {
      if (actual <= target) return { icon: '✅', class: 'good' };
      if (actual <= target * 1.5) return { icon: '⚠️', class: 'warn' };
      return { icon: '❌', class: 'bad' };
    }
    if (actual >= target) return { icon: '✅', class: 'good' };
    if (actual >= target * 0.9) return { icon: '⚠️', class: 'warn' };
    return { icon: '❌', class: 'bad' };
  };

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>인바운드 세일즈 리포트 - ${periodLabel}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; line-height: 1.6; }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    h1 { text-align: center; margin-bottom: 30px; color: #1a1a1a; }
    h2 { margin: 30px 0 15px; padding-bottom: 10px; border-bottom: 2px solid #3498db; color: #2c3e50; }
    h3 { margin: 20px 0 10px; color: #34495e; }
    .card { background: white; border-radius: 12px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
    .grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
    .stat-box { text-align: center; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 10px; }
    .stat-box.green { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); }
    .stat-box.orange { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }
    .stat-box.blue { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); }
    .stat-number { font-size: 2.5em; font-weight: bold; }
    .stat-label { font-size: 0.9em; opacity: 0.9; margin-top: 5px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th, td { padding: 12px 15px; text-align: center; border-bottom: 1px solid #eee; }
    th { background: #f8f9fa; font-weight: 600; color: #495057; }
    tr:hover { background: #f8f9fa; }
    .good { color: #27ae60; font-weight: bold; }
    .bad { color: #e74c3c; font-weight: bold; }
    .warn { color: #f39c12; font-weight: bold; }
    .chart-container { position: relative; height: 300px; margin: 20px 0; }
    .tag { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 0.8em; margin-left: 5px; }
    .tag.good { background: #d4edda; color: #155724; }
    .tag.bad { background: #f8d7da; color: #721c24; }
    @media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 인바운드 세일즈 리포트</h1>
    <p style="text-align:center; color:#666; margin-bottom:30px;">${periodLabel} (${startDate} ~ ${endDate})</p>

    <!-- 전체 퍼널 -->
    ${(() => {
      const stages = [
        { name: 'Lead', count: totalStats.lead, color: '#3498db' },
        { name: 'MQL', count: totalStats.mql, color: '#9b59b6' },
        { name: '영업기회', count: totalStats.opp, color: '#f39c12' },
        { name: '방문전환', count: totalStats.visitConverted, color: '#27ae60' },
        { name: '견적', count: quoteStageOpps.length, color: '#e67e22' }
      ];
      const maxCount = Math.max(...stages.map(s => s.count));

      return `<div style="display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:30px;">
        ${stages.map((stage, i) => {
          const ratio = stage.count / maxCount;
          const scale = Math.max(0.2, ratio);
          const height = Math.round(50 + scale * 80);
          const width = Math.round(60 + scale * 80);
          const labelSize = (0.7 + scale * 0.4).toFixed(2);
          const countSize = (1.2 + scale * 0.8).toFixed(2);
          const gap = Math.round(3 + scale * 5);
          return `
          <div style="display:flex; align-items:center;">
            <div style="background:${stage.color}; color:white; padding:10px; border-radius:12px; text-align:center; width:${width}px; height:${height}px; display:flex; flex-direction:column; justify-content:center; box-shadow:0 3px 10px rgba(0,0,0,0.15);">
              <div style="font-size:${labelSize}em; opacity:0.9; margin-bottom:${gap}px;">${stage.name}</div>
              <div style="font-size:${countSize}em; font-weight:bold;">${stage.count}</div>
            </div>
            ${i < stages.length - 1 ? '<div style="font-size:1.8em; color:#bdc3c7; padding:0 8px;">→</div>' : ''}
          </div>
        `}).join('')}
      </div>`;
    })()}

    <!-- ========== 목표 달성 현황 ========== -->
    <div style="border:1px solid #c8e6c9; border-radius:15px; padding:20px; margin:30px 0; background:#f1f8e9;">
      <div style="background:linear-gradient(135deg, #66bb6a 0%, #43a047 100%); color:white; padding:15px 25px; border-radius:10px; margin:-20px -20px 20px -20px;">
        <h2 style="margin:0; font-size:1.3em;">🎯 목표 달성 현황</h2>
        <p style="margin:5px 0 0 0; opacity:0.9; font-size:0.95em;">Business Plan 기준 KPI</p>
      </div>
      <div class="grid-3">
        ${[
          { label: 'MQL 전환율', actual: mqlRate.toFixed(1), target: TARGETS.mqlConversionRate, unit: '%' },
          { label: 'SQL 전환율', actual: sqlRate.toFixed(1), target: TARGETS.sqlConversionRate, unit: '%' },
          { label: 'FRT 준수율', actual: frtRate.toFixed(1), target: TARGETS.frtComplianceRate, unit: '%' },
          { label: '오인입율', actual: wrongEntryRateCalc.toFixed(1), target: TARGETS.wrongEntryRate, unit: '%', isLowerBetter: true },
          { label: '월간 방문', actual: totalStats.visitConverted, target: TARGETS.monthlyVisitTarget, unit: '건' },
          { label: '월간 CW', actual: totalStats.cw, target: TARGETS.monthlyCWTarget, unit: '건' }
        ].map(m => {
          const status = getStatus(parseFloat(m.actual), m.target, m.isLowerBetter);
          const gap = (parseFloat(m.actual) - m.target).toFixed(1);
          return `
          <div class="card" style="text-align:center;">
            <div style="font-size:0.9em; color:#666;">${m.label}</div>
            <div style="font-size:2em; font-weight:bold;" class="${status.class}">${m.actual}${m.unit}</div>
            <div style="font-size:0.85em; color:#888;">목표: ${m.target}${m.unit} (${gap >= 0 ? '+' : ''}${gap}) ${status.icon}</div>
          </div>
        `}).join('')}
      </div>
    </div>

    <!-- ========== 주차별 추이 ========== -->
    <div style="border:1px solid #b3e5fc; border-radius:15px; padding:20px; margin:30px 0; background:#e1f5fe;">
      <div style="background:linear-gradient(135deg, #29b6f6 0%, #0288d1 100%); color:white; padding:15px 25px; border-radius:10px; margin:-20px -20px 20px -20px;">
        <h2 style="margin:0; font-size:1.3em;">📈 주차별 추이</h2>
        <p style="margin:5px 0 0 0; opacity:0.9; font-size:0.95em;">시간에 따른 변화 추적</p>
      </div>
      <div class="card">
        <table>
          <thead>
            <tr><th>주차</th><th>Lead</th><th>MQL</th><th>MQL율</th><th>SQL</th><th>SQL율</th><th>CW</th><th>FRT준수율</th><th>오인입율</th></tr>
          </thead>
          <tbody>
            ${weeklyTrend.map(w => `
            <tr>
              <td><strong>${w.weekStart}</strong></td>
              <td>${w.lead}건</td>
              <td>${w.mql}건</td>
              <td class="${w.mqlRate >= TARGETS.mqlConversionRate ? 'good' : w.mqlRate >= TARGETS.mqlConversionRate * 0.9 ? 'warn' : 'bad'}">${w.mqlRate}%</td>
              <td>${w.sql}건</td>
              <td class="${w.sqlRate >= TARGETS.sqlConversionRate ? 'good' : w.sqlRate >= TARGETS.sqlConversionRate * 0.9 ? 'warn' : 'bad'}">${w.sqlRate}%</td>
              <td>${w.cw}건</td>
              <td class="${w.frtRate >= TARGETS.frtComplianceRate ? 'good' : w.frtRate >= TARGETS.frtComplianceRate * 0.9 ? 'warn' : 'bad'}">${w.frtRate}%</td>
              <td class="${w.wrongEntryRate <= TARGETS.wrongEntryRate ? 'good' : w.wrongEntryRate <= TARGETS.wrongEntryRate * 1.5 ? 'warn' : 'bad'}">${w.wrongEntryRate}%</td>
            </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="chart-container"><canvas id="weeklyTrendChart"></canvas></div>
    </div>

    <!-- ========== 채널별 리드 품질 ========== -->
    <div style="border:1px solid #ffe0b2; border-radius:15px; padding:20px; margin:30px 0; background:#fff3e0;">
      <div style="background:linear-gradient(135deg, #ffa726 0%, #fb8c00 100%); color:white; padding:15px 25px; border-radius:10px; margin:-20px -20px 20px -20px;">
        <h2 style="margin:0; font-size:1.3em;">📊 채널별 리드 품질</h2>
        <p style="margin:5px 0 0 0; opacity:0.9; font-size:0.95em;">LeadSource 기준 분석</p>
      </div>
      <div class="grid-2">
        <div class="card">
          <table>
            <thead>
              <tr><th>채널</th><th>건수</th><th>MQL율</th><th>SQL율</th><th>CW</th><th>오인입율</th></tr>
            </thead>
            <tbody>
              ${Object.entries(leadBySource).sort((a, b) => b[1].total - a[1].total).map(([source, data]) => `
              <tr>
                <td><strong>${source}</strong></td>
                <td>${data.total}건 (${(data.total / totalStats.lead * 100).toFixed(1)}%)</td>
                <td class="${parseFloat(data.mqlRate) >= 70 ? 'good' : parseFloat(data.mqlRate) >= 50 ? 'warn' : 'bad'}">${data.mqlRate}%</td>
                <td>${data.sqlRate}%</td>
                <td>${data.cw}건</td>
                <td class="${parseFloat(data.wrongEntryRate) <= 10 ? 'good' : parseFloat(data.wrongEntryRate) <= 20 ? 'warn' : 'bad'}">${data.wrongEntryRate}%</td>
              </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="chart-container"><canvas id="leadSourceChart"></canvas></div>
      </div>
    </div>

    <!-- ========== CL 사유 분석 ========== -->
    <div style="border:1px solid #ffcdd2; border-radius:15px; padding:20px; margin:30px 0; background:#ffebee;">
      <div style="background:linear-gradient(135deg, #ef5350 0%, #c62828 100%); color:white; padding:15px 25px; border-radius:10px; margin:-20px -20px 20px -20px;">
        <h2 style="margin:0; font-size:1.3em;">❌ CL(실패) 사유 분석</h2>
        <p style="margin:5px 0 0 0; opacity:0.9; font-size:0.95em;">왜 이탈했는지 파악</p>
      </div>
      <div class="grid-2">
        <div class="card">
          <h3>사유별 분포 (총 ${clStats.total}건)</h3>
          <table>
            <thead>
              <tr><th>사유</th><th>건수</th><th>비율</th></tr>
            </thead>
            <tbody>
              ${Object.entries(clStats.byReason).sort((a, b) => b[1].count - a[1].count).map(([reason, data]) => `
              <tr>
                <td><strong>${reason}</strong></td>
                <td>${data.count}건</td>
                <td>${data.rate}%</td>
              </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="chart-container"><canvas id="clReasonChart"></canvas></div>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════════════════ -->
    <!-- ═══════════════════════  📞 Inside Sales  ══════════════════════════════════════ -->
    <!-- ═══════════════════════════════════════════════════════════════════════════ -->
    <div style="border:3px solid #5dade2; border-radius:20px; padding:25px; margin:40px 0; background:linear-gradient(180deg, #eaf6fc 0%, #fff 100%);">
      <div style="background:linear-gradient(135deg, #5dade2 0%, #2980b9 100%); color:white; padding:20px 30px; border-radius:12px; margin:-25px -25px 25px -25px;">
        <h2 style="margin:0; font-size:1.5em;">📞 Inside Sales</h2>
        <p style="margin:8px 0 0 0; opacity:0.9;">Lead 생성 → MQL 전환 | FRT & Task 관리</p>
      </div>

    <!-- ========== Lead → MQL 구간 ========== -->
    <div style="border:1px solid #d0dce5; border-radius:15px; padding:20px; margin:30px 0; background:#f8fafb;">
      <div style="background:linear-gradient(135deg, #5dade2 0%, #bb8fce 100%); color:white; padding:15px 25px; border-radius:10px; margin:-20px -20px 20px -20px;">
        <h2 style="margin:0; font-size:1.3em;">📞 Lead → MQL</h2>
        <p style="margin:5px 0 0 0; opacity:0.9; font-size:0.95em;">빠른 터치가 핵심 | FRT(First Response Time) 분석</p>
      </div>

    <!-- 담당자별 FRT & Task -->
    <h3>⏱️ 담당자별 FRT & Task</h3>
    <div class="card">
      <table>
        <thead>
          <tr><th>담당자</th><th>Lead</th><th>Task有</th><th>평균FRT</th><th>FRT준수</th><th>준수율</th><th>Task총</th><th>일평균</th><th>30+일수</th></tr>
        </thead>
        <tbody>
          ${tmOwners.map(s => `
          <tr>
            <td><strong>${s.name}</strong></td>
            <td>${s.lead}건</td>
            <td>${s.withTask}건</td>
            <td>${s.avgFrt ? s.avgFrt.toFixed(0) + '분' : '-'}</td>
            <td>${s.frtOk}건</td>
            <td class="${Number(s.frtRate) >= 70 ? 'good' : Number(s.frtRate) >= 50 ? 'warn' : 'bad'}">${s.frtRate}%</td>
            <td>${s.totalTasks}건</td>
            <td class="${s.avgDaily >= 30 ? 'good' : s.avgDaily >= 20 ? 'warn' : 'bad'}">${s.avgDaily.toFixed(1)}건</td>
            <td>${s.daysOver30}/${s.totalWeekdays}일</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <!-- 담당자별 시간대별 -->
    <h3>🕐 담당자별 시간대별 분석</h3>
    <div class="grid-2">
      ${tmOwners.map(s => `
      <div class="card">
        <h3>${s.name} (Lead ${s.lead}건)</h3>
        <table>
          <thead>
            <tr><th>시간대</th><th>Lead</th><th>평균FRT</th><th>FRT준수율</th><th>오인입률</th><th>전환율</th></tr>
          </thead>
          <tbody>
            ${['BUSINESS_HOUR', 'OFF_HOUR', 'WEEKEND'].map(slot => {
              const st = s.timeSlotStats[slot];
              if (st.total === 0) return '';
              const label = slot === 'BUSINESS_HOUR' ? '☀️ 영업시간' : slot === 'OFF_HOUR' ? '🌙 영업외' : '🗓️ 주말';
              return `
              <tr>
                <td>${label}</td>
                <td>${st.total}건</td>
                <td>${st.avgFrt ? st.avgFrt.toFixed(0) + '분' : '-'}</td>
                <td class="${Number(st.frtRate) >= 70 ? 'good' : Number(st.frtRate) >= 30 ? 'warn' : 'bad'}">${st.frtRate}%</td>
                <td class="${Number(st.wrongEntryRate) <= 20 ? 'good' : Number(st.wrongEntryRate) <= 35 ? 'warn' : 'bad'}">${st.wrongEntryRate}%</td>
                <td class="${Number(st.conversionRate) >= 60 ? 'good' : Number(st.conversionRate) >= 40 ? 'warn' : 'bad'}">${st.conversionRate}%</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      `).join('')}
    </div>

    <!-- FRT 구간별 분석 -->
    <h3>📈 FRT 구간별 오인입/전환 분석</h3>
    <div class="card">
      <div class="grid-2">
        <div>
          <table>
            <thead>
              <tr><th>FRT 구간</th><th>전체</th><th>오인입</th><th>오인입률</th><th>전환</th><th>전환율</th></tr>
            </thead>
            <tbody>
              ${frtBucketStats.filter(b => b.total > 0).map(b => `
              <tr>
                <td>${b.bucket === 'NO_TASK' ? 'Task없음' : b.bucket}</td>
                <td>${b.total}건</td>
                <td>${b.wrongEntry}건</td>
                <td class="${Number(b.wrongEntryRate) <= 15 ? 'good' : Number(b.wrongEntryRate) <= 30 ? 'warn' : 'bad'}">${b.wrongEntryRate}%</td>
                <td>${b.converted}건</td>
                <td class="${Number(b.conversionRate) >= 60 ? 'good' : Number(b.conversionRate) >= 40 ? 'warn' : 'bad'}">${b.conversionRate}%</td>
              </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="chart-container">
          <canvas id="frtChart"></canvas>
        </div>
      </div>

      <!-- 시간대별 FRT 분석 - 영업시간 -->
      <h4 style="margin-top:25px; margin-bottom:15px;">☀️ 영업시간 FRT 분석</h4>
      <div class="grid-2">
        <table>
          <thead>
            <tr><th>FRT 구간</th><th>건수</th><th>오인입</th><th>오인입률</th><th>전환</th><th>전환율</th></tr>
          </thead>
          <tbody>
            ${frtBucketStats.filter(b => b.total > 0 && b.bucket !== 'NO_TASK').map(b => `
            <tr>
              <td>${b.bucket}</td>
              <td>${b.byTimeSlot.BUSINESS_HOUR.total}건</td>
              <td>${b.byTimeSlot.BUSINESS_HOUR.wrongEntry}건</td>
              <td class="${Number(b.byTimeSlot.BUSINESS_HOUR.wrongEntryRate) <= 15 ? 'good' : Number(b.byTimeSlot.BUSINESS_HOUR.wrongEntryRate) <= 30 ? 'warn' : 'bad'}">${b.byTimeSlot.BUSINESS_HOUR.wrongEntryRate}%</td>
              <td>${b.byTimeSlot.BUSINESS_HOUR.converted}건</td>
              <td class="${Number(b.byTimeSlot.BUSINESS_HOUR.conversionRate) >= 60 ? 'good' : Number(b.byTimeSlot.BUSINESS_HOUR.conversionRate) >= 40 ? 'warn' : 'bad'}">${b.byTimeSlot.BUSINESS_HOUR.conversionRate}%</td>
            </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="chart-container">
          <canvas id="frtBusinessChart"></canvas>
        </div>
      </div>

      <!-- 시간대별 FRT 분석 - 영업외 -->
      <h4 style="margin-top:25px; margin-bottom:15px;">🌙 영업외 FRT 분석</h4>
      <div class="grid-2">
        <table>
          <thead>
            <tr><th>FRT 구간</th><th>건수</th><th>오인입</th><th>오인입률</th><th>전환</th><th>전환율</th></tr>
          </thead>
          <tbody>
            ${frtBucketStats.filter(b => b.total > 0 && b.bucket !== 'NO_TASK').map(b => `
            <tr>
              <td>${b.bucket}</td>
              <td>${b.byTimeSlot.OFF_HOUR.total}건</td>
              <td>${b.byTimeSlot.OFF_HOUR.wrongEntry}건</td>
              <td class="${Number(b.byTimeSlot.OFF_HOUR.wrongEntryRate) <= 15 ? 'good' : Number(b.byTimeSlot.OFF_HOUR.wrongEntryRate) <= 30 ? 'warn' : 'bad'}">${b.byTimeSlot.OFF_HOUR.wrongEntryRate}%</td>
              <td>${b.byTimeSlot.OFF_HOUR.converted}건</td>
              <td class="${Number(b.byTimeSlot.OFF_HOUR.conversionRate) >= 60 ? 'good' : Number(b.byTimeSlot.OFF_HOUR.conversionRate) >= 40 ? 'warn' : 'bad'}">${b.byTimeSlot.OFF_HOUR.conversionRate}%</td>
            </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="chart-container">
          <canvas id="frtOffHourChart"></canvas>
        </div>
      </div>

      <!-- 시간대별 FRT 분석 - 주말 -->
      <h4 style="margin-top:25px; margin-bottom:15px;">🗓️ 주말 FRT 분석</h4>
      <div class="grid-2">
        <table>
          <thead>
            <tr><th>FRT 구간</th><th>건수</th><th>오인입</th><th>오인입률</th><th>전환</th><th>전환율</th></tr>
          </thead>
          <tbody>
            ${frtBucketStats.filter(b => b.total > 0 && b.bucket !== 'NO_TASK').map(b => `
            <tr>
              <td>${b.bucket}</td>
              <td>${b.byTimeSlot.WEEKEND.total}건</td>
              <td>${b.byTimeSlot.WEEKEND.wrongEntry}건</td>
              <td class="${Number(b.byTimeSlot.WEEKEND.wrongEntryRate) <= 15 ? 'good' : Number(b.byTimeSlot.WEEKEND.wrongEntryRate) <= 30 ? 'warn' : 'bad'}">${b.byTimeSlot.WEEKEND.wrongEntryRate}%</td>
              <td>${b.byTimeSlot.WEEKEND.converted}건</td>
              <td class="${Number(b.byTimeSlot.WEEKEND.conversionRate) >= 60 ? 'good' : Number(b.byTimeSlot.WEEKEND.conversionRate) >= 40 ? 'warn' : 'bad'}">${b.byTimeSlot.WEEKEND.conversionRate}%</td>
            </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="chart-container">
          <canvas id="frtWeekendChart"></canvas>
        </div>
      </div>
    </div>

    <!-- 오인입 사유 -->
    <h3>📋 오인입 사유 분석</h3>
    <div class="card">
      <div class="grid-2">
        <table>
          <thead>
            <tr><th>사유</th><th>건수</th><th>비율</th></tr>
          </thead>
          <tbody>
            ${Object.entries(wrongEntryReasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => `
            <tr>
              <td>${reason}</td>
              <td>${count}건</td>
              <td>${(count / totalWrongEntry * 100).toFixed(1)}%</td>
            </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="chart-container">
          <canvas id="reasonChart"></canvas>
        </div>
      </div>
    </div>
    </div><!-- Lead → MQL 구간 끝 -->

    <!-- ========== MQL → 영업기회 구간 ========== -->
    <div style="border:1px solid #ddd0e8; border-radius:15px; padding:20px; margin:30px 0; background:#fbf9fc;">
      <div style="background:linear-gradient(135deg, #bb8fce 0%, #f5b041 100%); color:white; padding:15px 25px; border-radius:10px; margin:-20px -20px 20px -20px;">
        <h2 style="margin:0; font-size:1.3em;">📊 MQL → 영업기회</h2>
        <p style="margin:5px 0 0 0; opacity:0.9; font-size:0.95em;">담당자별 전환 현황</p>
      </div>

    <!-- 담당자별 퍼널 -->
    <h3>👤 담당자별 퍼널</h3>
    <div class="card">
      <table>
        <thead>
          <tr><th>담당자</th><th>Lead</th><th>MQL</th><th>MQL율</th><th>SQL</th><th>SQL율</th><th>영업기회</th><th>방문전환</th><th>전환율</th></tr>
        </thead>
        <tbody>
          ${tmOwners.map(s => `
          <tr>
            <td><strong>${s.name}</strong></td>
            <td>${s.lead}건</td>
            <td>${s.mql}건</td>
            <td>${s.mqlRate}%</td>
            <td>${s.sql}건</td>
            <td class="${Number(s.sqlRate) >= 90 ? 'good' : Number(s.sqlRate) >= 70 ? 'warn' : 'bad'}">${s.sqlRate}%</td>
            <td>${s.opp}건</td>
            <td>${s.visitConverted}건</td>
            <td class="${Number(s.visitConvertedRate) >= 95 ? 'good' : 'warn'}">${s.visitConvertedRate}%</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    </div><!-- MQL → 영업기회 구간 끝 -->

    </div><!-- Inside Sales 끝 -->

    <!-- ═══════════════════════════════════════════════════════════════════════════ -->
    <!-- ═══════════════════════  🏃 Inside Field  ═══════════════════════════════════ -->
    <!-- ═══════════════════════════════════════════════════════════════════════════ -->
    <div style="border:3px solid #58d68d; border-radius:20px; padding:25px; margin:40px 0; background:linear-gradient(180deg, #eafaf1 0%, #fff 100%);">
      <div style="background:linear-gradient(135deg, #58d68d 0%, #27ae60 100%); color:white; padding:20px 30px; border-radius:12px; margin:-25px -25px 25px -25px;">
        <h2 style="margin:0; font-size:1.5em;">🏃 Inside Field</h2>
        <p style="margin:8px 0 0 0; opacity:0.9;">영업기회 → 방문 → 계약 | 현장 영업 관리</p>
      </div>

    <!-- Field 담당자별 CW 전환율 -->
    <h3>🚗 Field 담당자별 CW 전환율</h3>
    <div class="card">
      <table>
        <thead>
          <tr><th>Field 담당자</th><th>전체</th><th>계약진행</th><th>출고진행</th><th>설치진행</th><th>예상CW</th><th>CW</th><th>예상마감</th><th>예상마감율</th><th>CL</th><th>진행중</th></tr>
        </thead>
        <tbody>
          ${fieldStats.filter(s => s.total > 0).map(s => {
            const expectedCW = s.contractProgress + s.shipmentProgress + s.installProgress;
            const expectedClose = s.cw + expectedCW;
            const expectedCloseRate = s.total > 0 ? (expectedClose / s.total * 100).toFixed(1) : 0;
            return `
          <tr>
            <td><strong>${s.name}</strong></td>
            <td>${s.total}건</td>
            <td>${s.contractProgress}건</td>
            <td>${s.shipmentProgress}건</td>
            <td>${s.installProgress}건</td>
            <td><strong>${expectedCW}건</strong></td>
            <td>${s.cw}건</td>
            <td><strong>${expectedClose}건</strong></td>
            <td class="${Number(expectedCloseRate) >= 50 ? 'good' : Number(expectedCloseRate) >= 30 ? 'warn' : 'bad'}"><strong>${expectedCloseRate}%</strong></td>
            <td>${s.cl}건</td>
            <td>${s.open}건</td>
          </tr>
          `}).join('')}
        </tbody>
      </table>
      <p style="margin-top:15px; color:#666; font-size:0.9em;">
        * 예상CW = 계약진행 + 출고진행 + 설치진행 (CW 전환 가능성 높은 단계) | 예상마감 = CW + 예상CW
      </p>
    </div>

    <!-- Field 행동지표 -->
    <h3 style="margin-top:25px;">🏃 Field 행동지표 (리터치 현황)</h3>
    <div class="card">
      <table>
        <thead>
          <tr>
            <th rowspan="2">Field 담당자</th>
            <th rowspan="2">담당 건수</th>
            <th colspan="3" style="background:#e3f2fd; border-bottom:1px solid #90caf9;">일반 (리터치 SLA)</th>
            <th colspan="2" style="background:#fff3e0; border-bottom:1px solid #ffcc80;">오픈전</th>
            <th rowspan="2">CW</th>
            <th rowspan="2">CL</th>
            <th rowspan="2">진행중</th>
            <th rowspan="2">CW율</th>
          </tr>
          <tr>
            <th style="background:#e3f2fd;">평균</th>
            <th style="background:#e3f2fd;">7일↑</th>
            <th style="background:#e3f2fd;">진행중</th>
            <th style="background:#fff3e0;">건수</th>
            <th style="background:#fff3e0;">평균</th>
          </tr>
        </thead>
        <tbody>
          ${fieldActivityStats.map(f => `
          <tr>
            <td><strong>${f.name}</strong></td>
            <td>${f.totalOpps}건</td>
            <td class="${f.avgRetouchDays !== null && f.avgRetouchDays <= 7 ? 'good' : f.avgRetouchDays !== null && f.avgRetouchDays <= 10 ? 'warn' : 'bad'}">${f.avgRetouchDays !== null ? f.avgRetouchDays + '일' : '-'}</td>
            <td class="${f.retouchOver7 === 0 ? 'good' : f.retouchOver7 <= 3 ? 'warn' : 'bad'}">${f.retouchOver7}건</td>
            <td>${f.normalOpen}건</td>
            <td style="color:#ef6c00;">${f.preOpenCount}건</td>
            <td style="color:#ef6c00;">${f.preOpenAvgRetouchDays !== null ? f.preOpenAvgRetouchDays + '일' : '-'}</td>
            <td class="good">${f.cw}건</td>
            <td>${f.cl}건</td>
            <td>${f.open}건</td>
            <td>${f.cwRate}%</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
      <p style="font-size:0.85em; color:#666; margin-top:10px;">
        💡 <strong>일반</strong>: 오픈전 제외, 리터치 SLA 7일 기준 적용 | <strong>오픈전</strong>: 공사중/미오픈 업체, SLA 별도 관리
      </p>
    </div>

    <!-- 방문 희망일 분포 (캘린더) -->
    <h3 style="margin-top:25px;">📅 방문 희망일 분포</h3>
    <div class="card">
      <div class="grid-2">
        <div>
          <h4 style="margin-bottom:15px;">📆 이번달 방문 캘린더</h4>
          ${(() => {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth();
            const firstDay = new Date(year, month, 1).getDay();
            const lastDate = new Date(year, month + 1, 0).getDate();
            const today = now.getDate();

            let cal = '<div style="display:grid; grid-template-columns:repeat(7,1fr); gap:2px; text-align:center;">';
            cal += ['일','월','화','수','목','금','토'].map(d => `<div style="font-weight:bold; padding:8px; background:#f8f9fa; font-size:0.85em;">${d}</div>`).join('');

            for (let i = 0; i < firstDay; i++) {
              cal += '<div style="padding:8px;"></div>';
            }

            for (let d = 1; d <= lastDate; d++) {
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              const visits = visitByDate[dateStr] || [];
              const count = visits.length;
              const isToday = d === today;
              const isPast = d < today;

              let bgColor = '#fff';
              let textColor = '#333';
              if (count >= 5) { bgColor = '#e74c3c'; textColor = '#fff'; }
              else if (count >= 3) { bgColor = '#f39c12'; textColor = '#fff'; }
              else if (count >= 1) { bgColor = '#3498db'; textColor = '#fff'; }
              else if (isPast) { bgColor = '#f5f5f5'; textColor = '#999'; }

              const border = isToday ? 'border:3px solid #2c3e50;' : '';
              const dayOfWeek = new Date(year, month, d).getDay();
              const weekendColor = (dayOfWeek === 0 || dayOfWeek === 6) && count === 0 ? 'color:#e74c3c;' : '';

              cal += `<div style="padding:8px; background:${bgColor}; color:${textColor}; border-radius:6px; ${border} ${weekendColor} cursor:${count > 0 ? 'pointer' : 'default'};" ${count > 0 ? `title="${visits.map(v => v.fieldUser).join(', ')}"` : ''}>
                <div style="font-weight:bold;">${d}</div>
                ${count > 0 ? `<div style="font-size:0.75em;">${count}건</div>` : ''}
              </div>`;
            }
            cal += '</div>';
            return cal;
          })()}
          <div style="margin-top:10px; font-size:0.8em; color:#666;">
            <span style="display:inline-block; width:12px; height:12px; background:#3498db; border-radius:3px;"></span> 1~2건
            <span style="display:inline-block; width:12px; height:12px; background:#f39c12; border-radius:3px; margin-left:10px;"></span> 3~4건
            <span style="display:inline-block; width:12px; height:12px; background:#e74c3c; border-radius:3px; margin-left:10px;"></span> 5건+
          </div>
        </div>

        <div>
          <h4 style="margin-bottom:15px;">📆 다음달 방문 캘린더</h4>
          ${(() => {
            const now = new Date();
            const year = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
            const month = (now.getMonth() + 1) % 12;
            const firstDay = new Date(year, month, 1).getDay();
            const lastDate = new Date(year, month + 1, 0).getDate();

            let cal = '<div style="display:grid; grid-template-columns:repeat(7,1fr); gap:2px; text-align:center;">';
            cal += ['일','월','화','수','목','금','토'].map(d => `<div style="font-weight:bold; padding:8px; background:#f8f9fa; font-size:0.85em;">${d}</div>`).join('');

            for (let i = 0; i < firstDay; i++) {
              cal += '<div style="padding:8px;"></div>';
            }

            for (let d = 1; d <= lastDate; d++) {
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              const visits = visitByDate[dateStr] || [];
              const count = visits.length;

              let bgColor = '#fff';
              let textColor = '#333';
              if (count >= 5) { bgColor = '#e74c3c'; textColor = '#fff'; }
              else if (count >= 3) { bgColor = '#f39c12'; textColor = '#fff'; }
              else if (count >= 1) { bgColor = '#3498db'; textColor = '#fff'; }

              const dayOfWeek = new Date(year, month, d).getDay();
              const weekendColor = (dayOfWeek === 0 || dayOfWeek === 6) && count === 0 ? 'color:#e74c3c;' : '';

              cal += `<div style="padding:8px; background:${bgColor}; color:${textColor}; border-radius:6px; ${weekendColor}" ${count > 0 ? `title="${visits.map(v => v.fieldUser).join(', ')}"` : ''}>
                <div style="font-weight:bold;">${d}</div>
                ${count > 0 ? `<div style="font-size:0.75em;">${count}건</div>` : ''}
              </div>`;
            }
            cal += '</div>';
            return cal;
          })()}
        </div>
      </div>
    </div>

    <!-- Field 담당자별 방문 예정 -->
    <h3 style="margin-top:25px;">👤 Field 담당자별 방문 예정 (이번주+다음주)</h3>
    <div class="grid-2">
      <table>
        <thead><tr><th>Field 담당자</th><th>예정 건수</th><th>비율</th></tr></thead>
        <tbody>
          ${Object.entries(visitByField).sort((a, b) => b[1].length - a[1].length).map(([field, items]) => {
            const total = Object.values(visitByField).reduce((s, arr) => s + arr.length, 0);
            const pct = total > 0 ? (items.length / total * 100).toFixed(1) : 0;
            return `<tr><td>${field}</td><td>${items.length}건</td><td>${pct}%</td></tr>`;
          }).join('')}
        </tbody>
      </table>
      <div class="chart-container"><canvas id="visitFieldChart"></canvas></div>
    </div>

    <!-- Field 담당자별 계약 현황 -->
    <h3 style="margin-top:25px;">🚗 Field 담당자별 계약 현황</h3>
    <div class="card">
      <table>
        <thead>
          <tr>
            <th rowspan="2">Field 담당자</th>
            <th colspan="2" style="background:#e8f4fc;">신규</th>
            <th colspan="2" style="background:#fcf4e8;">추가설치</th>
            <th rowspan="2">전체</th>
            <th rowspan="2">WIP</th>
            <th colspan="3" style="background:#d5f5e3;">CW</th>
            <th rowspan="2">CW율</th>
          </tr>
          <tr>
            <th style="background:#e8f4fc;">전체</th><th style="background:#e8f4fc;">WIP</th>
            <th style="background:#fcf4e8;">전체</th><th style="background:#fcf4e8;">WIP</th>
            <th style="background:#d5f5e3;">합계</th><th style="background:#d5f5e3;">이번달</th><th style="background:#d5f5e3;">이전</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(contractStats.byField).filter(([name]) => name !== '(미배정)').sort((a,b) => b[1].total - a[1].total).map(([name, s]) => {
            const cwRate = s.total > 0 ? (s.cw / s.total * 100).toFixed(1) : 0;
            return `
          <tr>
            <td><strong>${name}</strong></td>
            <td style="background:#f4faff;">${s['신규'].total}건</td>
            <td style="background:#f4faff;" class="${s['신규'].wip > 0 ? 'warn' : ''}">${s['신규'].wip}건</td>
            <td style="background:#fffaf4;">${s['추가설치'].total}건</td>
            <td style="background:#fffaf4;" class="${s['추가설치'].wip > 0 ? 'warn' : ''}">${s['추가설치'].wip}건</td>
            <td><strong>${s.total}건</strong></td>
            <td class="${s.wip > 0 ? 'warn' : ''}">${s.wip}건</td>
            <td style="background:#eafaf1;"><strong>${s.cw}건</strong></td>
            <td style="background:#eafaf1;">${s.cwThisMonth}건</td>
            <td style="background:#eafaf1; color:#888;">${s.cwPrevMonth}건</td>
            <td class="${Number(cwRate) >= 80 ? 'good' : Number(cwRate) >= 50 ? 'warn' : ''}">${cwRate}%</td>
          </tr>
          `}).join('')}
        </tbody>
      </table>
    </div>

    </div><!-- Inside Field 끝 -->

    <!-- ═══════════════════════════════════════════════════════════════════════════ -->
    <!-- ═══════════════════════  📋 Inside Back Office  ══════════════════════════════════════ -->
    <!-- ═══════════════════════════════════════════════════════════════════════════ -->
    <div style="border:3px solid #ab47bc; border-radius:20px; padding:25px; margin:40px 0; background:linear-gradient(180deg, #f5eef8 0%, #fff 100%);">
      <div style="background:linear-gradient(135deg, #ab47bc 0%, #7b1fa2 100%); color:white; padding:20px 30px; border-radius:12px; margin:-25px -25px 25px -25px;">
        <h2 style="margin:0; font-size:1.5em;">📋 Inside Back Office</h2>
        <p style="margin:8px 0 0 0; opacity:0.9;">견적 → 계약 | 워크로드 & SLA 관리</p>
      </div>

    <!-- BO 워크로드 밸런스 -->
    <h3>⚖️ BO 워크로드 밸런스</h3>
    <div class="card">
      <table>
        <thead>
          <tr>
            <th rowspan="2">BO 담당자</th>
            <th rowspan="2">기간 내 배정</th>
            <th rowspan="2">CW</th>
            <th rowspan="2">CL</th>
            <th rowspan="2">처리</th>
            <th colspan="3" style="background:#e8f5e9; border-bottom:1px solid #a5d6a7;">진행중</th>
            <th rowspan="2">순증감</th>
            <th rowspan="2">상태</th>
          </tr>
          <tr>
            <th style="background:#e8f5e9;">전체</th>
            <th style="background:#e3f2fd;">일반</th>
            <th style="background:#fff3e0;">오픈전</th>
          </tr>
        </thead>
        <tbody>
          ${boWorkload.map(b => {
            const status = b.netChange > 10 ? { icon: '🔴', text: '과부하' } : b.netChange > 0 ? { icon: '🟡', text: '누적중' } : { icon: '🟢', text: '양호' };
            return `
            <tr>
              <td><strong>${b.name}</strong></td>
              <td><strong>${b.periodInflow}건</strong></td>
              <td class="good">${b.periodCW}건</td>
              <td>${b.periodCL}건</td>
              <td>${b.periodProcessed}건</td>
              <td>${b.currentOpen}건</td>
              <td style="color:#1976d2;">${b.normalOpen}건</td>
              <td style="color:#ef6c00;">${b.preOpenOpen}건</td>
              <td class="${b.netChange > 10 ? 'bad' : b.netChange > 0 ? 'warn' : 'good'}">${b.netChange >= 0 ? '+' : ''}${b.netChange}</td>
              <td>${status.icon} ${status.text}</td>
            </tr>
          `}).join('')}
        </tbody>
      </table>
      <p style="font-size:0.85em; color:#666; margin-top:10px;">
        💡 <strong>일반</strong>: 오픈전 제외, SLA 적용 대상 | <strong>오픈전</strong>: 공사중/미오픈 업체
      </p>
      <div class="chart-container"><canvas id="boWorkloadChart"></canvas></div>
    </div>

    <!-- BO 담당자별 CW 전환율 -->
    <h3 style="margin-top:25px;">📊 BO 담당자별 CW 전환율 & SQL 잔량</h3>
    <div class="card">
      <table>
        <thead>
          <tr><th>BO 담당자</th><th>전체</th><th>계약진행</th><th>출고진행</th><th>설치진행</th><th>예상CW</th><th>CW</th><th>예상마감</th><th>예상마감율</th><th>CL</th><th>진행중</th><th>3일이내</th><th>4~7일</th><th>7일초과</th></tr>
        </thead>
        <tbody>
          ${boStats.filter(s => s.total > 0).map(s => {
            const expectedCW = s.contractProgress + s.shipmentProgress + s.installProgress;
            const expectedClose = s.cw + expectedCW;
            const expectedCloseRate = s.total > 0 ? (expectedClose / s.total * 100).toFixed(1) : 0;
            return `
          <tr>
            <td><strong>${s.name}</strong></td>
            <td>${s.total}건</td>
            <td>${s.contractProgress}건</td>
            <td>${s.shipmentProgress}건</td>
            <td>${s.installProgress}건</td>
            <td><strong>${expectedCW}건</strong></td>
            <td>${s.cw}건</td>
            <td><strong>${expectedClose}건</strong></td>
            <td class="${Number(expectedCloseRate) >= 50 ? 'good' : Number(expectedCloseRate) >= 30 ? 'warn' : 'bad'}"><strong>${expectedCloseRate}%</strong></td>
            <td>${s.cl}건</td>
            <td class="${s.open > 10 ? 'warn' : ''}">${s.open}건</td>
            <td class="good">${s.openByAge.within3}건</td>
            <td class="warn">${s.openByAge.day4to7}건</td>
            <td class="${s.openByAge.over7 > 0 ? 'bad' : ''}">${s.openByAge.over7}건</td>
          </tr>
          `}).join('')}
        </tbody>
      </table>
      <p style="margin-top:15px; color:#666; font-size:0.9em;">
        * 예상CW = 계약진행 + 출고진행 + 설치진행 | 예상마감 = CW + 예상CW | SQL 잔량(3일이내/4~7일/7일초과) = AgeInDays 기준
      </p>
    </div>

    <!-- 견적 단계 리터치 현황 -->
    <h3 style="margin-top:25px;">📝 견적 단계 리터치 현황</h3>
    <div class="card">
      <div class="grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;">
        <div class="stat-box blue">
          <div class="stat-number">${quoteStageOpps.length}</div>
          <div class="stat-label">견적 단계 전체</div>
          <div style="font-size:0.8em; margin-top:5px;">일반 ${quoteStageNormal.length} | <span style="color:#ef6c00;">오픈전 ${quoteStagePreOpen.length}</span></div>
        </div>
        <div class="stat-box green">
          <div class="stat-number">${quoteStageWithQuote.length}</div>
          <div class="stat-label">견적 발송</div>
        </div>
        <div class="stat-box orange">
          <div class="stat-number">${stale4to7.length}</div>
          <div class="stat-label">4~7일 경과</div>
          <div style="font-size:0.8em; margin-top:5px;">일반 ${stale4to7Normal.length} | <span style="color:#ef6c00;">오픈전 ${stale4to7PreOpen.length}</span></div>
        </div>
        <div class="stat-box" style="background: linear-gradient(135deg, #eb3349 0%, #f45c43 100%);">
          <div class="stat-number">${stale8plus.length}</div>
          <div class="stat-label">8일+ 경과 🚨</div>
          <div style="font-size:0.8em; margin-top:5px;">일반 ${stale8plusNormal.length} | <span style="color:#fff3e0;">오픈전 ${stale8plusPreOpen.length}</span></div>
        </div>
      </div>

      ${quoteStageNoQuote.length > 0 ? `
      <h3>⚠️ 견적 미발송 (견적 단계이나 Quote 없음) - 총 ${quoteStageNoQuote.length}건</h3>
      ${quoteStageNoQuoteNormal.length > 0 ? `
      <h4 style="color:#1976d2; margin:10px 0 5px 0;">📌 일반 (${quoteStageNoQuoteNormal.length}건) - SLA 관리 대상</h4>
      <table>
        <thead><tr><th>업체</th><th>생성일</th><th>BO</th></tr></thead>
        <tbody>
          ${quoteStageNoQuoteNormal.map(o => {
            const createdKST = o.createdDate ? new Date(new Date(o.createdDate).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0] : '-';
            return `<tr><td>${o.oppName || o.oppId.substring(0, 18)}</td><td>${createdKST}</td><td>${o.boUser}</td></tr>`;
          }).join('')}
        </tbody>
      </table>` : ''}
      ${quoteStageNoQuotePreOpen.length > 0 ? `
      <h4 style="color:#ef6c00; margin:15px 0 5px 0;">🏗️ 오픈전 (${quoteStageNoQuotePreOpen.length}건)</h4>
      <table>
        <thead><tr><th>업체</th><th>생성일</th><th>BO</th></tr></thead>
        <tbody>
          ${quoteStageNoQuotePreOpen.map(o => {
            const createdKST = o.createdDate ? new Date(new Date(o.createdDate).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0] : '-';
            return `<tr style="background:#fff8e1;"><td>${o.oppName || o.oppId.substring(0, 18)}</td><td>${createdKST}</td><td>${o.boUser}</td></tr>`;
          }).join('')}
        </tbody>
      </table>` : ''}
      ` : ''}

      ${stale8plus.length > 0 ? `
      <h3>🚨 8일+ 연락 끊긴 건 - 총 ${stale8plus.length}건</h3>
      ${stale8plusNormal.length > 0 ? `
      <h4 style="color:#c62828; margin:10px 0 5px 0;">📌 일반 (${stale8plusNormal.length}건) - 긴급 팔로업 필요</h4>
      <table>
        <thead><tr><th>업체</th><th>견적일</th><th>마지막Task</th><th>경과일</th><th>BO</th></tr></thead>
        <tbody>
          ${stale8plusNormal.map(o => {
            const quoteKST = o.quoteDate ? new Date(new Date(o.quoteDate).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0] : '-';
            const lastTaskKST = o.lastTaskDate ? new Date(new Date(o.lastTaskDate).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0] : quoteKST;
            return `<tr><td>${o.oppName || o.oppId.substring(0, 18)}</td><td>${quoteKST}</td><td>${lastTaskKST}</td><td class="bad">${o.daysSinceLastTask}일</td><td>${o.boUser}</td></tr>`;
          }).join('')}
        </tbody>
      </table>` : ''}
      ${stale8plusPreOpen.length > 0 ? `
      <h4 style="color:#ef6c00; margin:15px 0 5px 0;">🏗️ 오픈전 (${stale8plusPreOpen.length}건)</h4>
      <table>
        <thead><tr><th>업체</th><th>견적일</th><th>마지막Task</th><th>경과일</th><th>BO</th></tr></thead>
        <tbody>
          ${stale8plusPreOpen.map(o => {
            const quoteKST = o.quoteDate ? new Date(new Date(o.quoteDate).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0] : '-';
            const lastTaskKST = o.lastTaskDate ? new Date(new Date(o.lastTaskDate).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0] : quoteKST;
            return `<tr style="background:#fff8e1;"><td>${o.oppName || o.oppId.substring(0, 18)}</td><td>${quoteKST}</td><td>${lastTaskKST}</td><td class="warn">${o.daysSinceLastTask}일</td><td>${o.boUser}</td></tr>`;
          }).join('')}
        </tbody>
      </table>` : ''}
      ` : '<p style="color:#27ae60;">✅ 8일+ 연락 끊긴 건 없음</p>'}

      ${stale4to7.length > 0 ? `
      <h3>⏰ 4~7일 경과 건 - 총 ${stale4to7.length}건</h3>
      ${stale4to7Normal.length > 0 ? `
      <h4 style="color:#1976d2; margin:10px 0 5px 0;">📌 일반 (${stale4to7Normal.length}건)</h4>
      <table>
        <thead><tr><th>업체</th><th>견적일</th><th>마지막Task</th><th>경과일</th><th>BO</th></tr></thead>
        <tbody>
          ${stale4to7Normal.map(o => {
            const quoteKST = o.quoteDate ? new Date(new Date(o.quoteDate).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0] : '-';
            const lastTaskKST = o.lastTaskDate ? new Date(new Date(o.lastTaskDate).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0] : quoteKST;
            return `<tr><td>${o.oppName || o.oppId.substring(0, 18)}</td><td>${quoteKST}</td><td>${lastTaskKST}</td><td class="warn">${o.daysSinceLastTask}일</td><td>${o.boUser}</td></tr>`;
          }).join('')}
        </tbody>
      </table>` : ''}
      ${stale4to7PreOpen.length > 0 ? `
      <h4 style="color:#ef6c00; margin:15px 0 5px 0;">🏗️ 오픈전 (${stale4to7PreOpen.length}건)</h4>
      <table>
        <thead><tr><th>업체</th><th>견적일</th><th>마지막Task</th><th>경과일</th><th>BO</th></tr></thead>
        <tbody>
          ${stale4to7PreOpen.map(o => {
            const quoteKST = o.quoteDate ? new Date(new Date(o.quoteDate).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0] : '-';
            const lastTaskKST = o.lastTaskDate ? new Date(new Date(o.lastTaskDate).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0] : quoteKST;
            return `<tr style="background:#fff8e1;"><td>${o.oppName || o.oppId.substring(0, 18)}</td><td>${quoteKST}</td><td>${lastTaskKST}</td><td>${o.daysSinceLastTask}일</td><td>${o.boUser}</td></tr>`;
          }).join('')}
        </tbody>
      </table>` : ''}
      ` : ''}

      <h3 style="margin-top:20px;">👤 BO별 견적 관리 현황</h3>
      <table>
        <thead>
          <tr>
            <th rowspan="2">BO 담당자</th>
            <th colspan="3" style="background:#e8f5e9; border-bottom:1px solid #a5d6a7;">총건수</th>
            <th rowspan="2">견적有</th>
            <th rowspan="2">3일+ 경과</th>
            <th rowspan="2">8일+ 경과</th>
          </tr>
          <tr>
            <th style="background:#e8f5e9;">전체</th>
            <th style="background:#e3f2fd;">일반</th>
            <th style="background:#fff3e0;">오픈전</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(boQuoteStats).sort((a, b) => b[1].total - a[1].total).map(([bo, data]) => `
          <tr>
            <td>${bo}</td>
            <td>${data.total}건</td>
            <td style="color:#1976d2;">${data.normalTotal}건</td>
            <td style="color:#ef6c00;">${data.preOpenTotal}건</td>
            <td>${data.withQuote}건</td>
            <td class="${data.staleCount > 5 ? 'warn' : ''}">${data.staleCount}건</td>
            <td class="${data.stale8plus > 3 ? 'bad' : ''}">${data.stale8plus}건</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <!-- BO 담당자별 계약 현황 -->
    <h3 style="margin-top:25px;">📋 BO 담당자별 계약 현황</h3>
    <div class="card">
      <table>
        <thead>
          <tr>
            <th rowspan="2">BO 담당자</th>
            <th colspan="2" style="background:#e8f4fc;">신규</th>
            <th colspan="2" style="background:#fcf4e8;">추가설치</th>
            <th rowspan="2">전체</th>
            <th rowspan="2">WIP</th>
            <th colspan="3" style="background:#d5f5e3;">CW</th>
            <th rowspan="2">CW율</th>
          </tr>
          <tr>
            <th style="background:#e8f4fc;">전체</th><th style="background:#e8f4fc;">WIP</th>
            <th style="background:#fcf4e8;">전체</th><th style="background:#fcf4e8;">WIP</th>
            <th style="background:#d5f5e3;">합계</th><th style="background:#d5f5e3;">이번달</th><th style="background:#d5f5e3;">이전</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(contractStats.byBO).sort((a,b) => b[1].total - a[1].total).map(([name, s]) => {
            const cwRate = s.total > 0 ? (s.cw / s.total * 100).toFixed(1) : 0;
            return `
          <tr>
            <td><strong>${name}</strong></td>
            <td style="background:#f4faff;">${s['신규'].total}건</td>
            <td style="background:#f4faff;" class="${s['신규'].wip > 0 ? 'warn' : ''}">${s['신규'].wip}건</td>
            <td style="background:#fffaf4;">${s['추가설치'].total}건</td>
            <td style="background:#fffaf4;" class="${s['추가설치'].wip > 0 ? 'warn' : ''}">${s['추가설치'].wip}건</td>
            <td><strong>${s.total}건</strong></td>
            <td class="${s.wip > 0 ? 'warn' : ''}">${s.wip}건</td>
            <td style="background:#eafaf1;"><strong>${s.cw}건</strong></td>
            <td style="background:#eafaf1;">${s.cwThisMonth}건</td>
            <td style="background:#eafaf1; color:#888;">${s.cwPrevMonth}건</td>
            <td class="${Number(cwRate) >= 80 ? 'good' : Number(cwRate) >= 50 ? 'warn' : ''}">${cwRate}%</td>
          </tr>
          `}).join('')}
        </tbody>
      </table>
    </div>

    </div><!-- Inside Back Office 끝 -->

    <!-- ═══════════════════════════════════════════════════════════════════════════ -->
    <!-- ═══════════════════════  📄 계약 현황 요약  ═══════════════════════════════ -->
    <!-- ═══════════════════════════════════════════════════════════════════════════ -->
    <div style="border:3px solid #9b59b6; border-radius:20px; padding:25px; margin:40px 0; background:linear-gradient(180deg, #faf5fc 0%, #fff 100%);">
      <div style="background:linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%); color:white; padding:20px 30px; border-radius:12px; margin:-25px -25px 25px -25px;">
        <h2 style="margin:0; font-size:1.5em;">📄 계약 현황 요약</h2>
        <p style="margin:8px 0 0 0; opacity:0.9;">이번달 계약 진행 | 소요일 분석</p>
      </div>

    <!-- 이번달 계약 진행 현황 -->
    <div class="card">
      <!-- 계약 현황 요약 -->
      <div class="grid-3" style="margin-bottom:25px;">
        <div class="stat-card">
          <div class="stat-value" style="color:#9b59b6;">${contractStats.total}건</div>
          <div class="stat-label">이번달 계약 전체</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:#27ae60;">${contractStats.byStage['Closed Won'] || 0}건</div>
          <div class="stat-label">CW (완료)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:#e67e22;">${contractStats.wip.length}건</div>
          <div class="stat-label">WIP (진행중)</div>
        </div>
      </div>
      <div class="grid-2" style="margin-bottom:25px;">
        <div class="stat-card">
          <div class="stat-value" style="color:#3498db;">${contractStats.leadTimeStats.thisMonth.length > 0 ? (contractStats.leadTimeStats.thisMonth.reduce((a,b) => a+b, 0) / contractStats.leadTimeStats.thisMonth.length).toFixed(1) : '-'}일</div>
          <div class="stat-label">평균 계약소요일 (이번달 영업기회 ${contractStats.leadTimeStats.thisMonth.length}건)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:#95a5a6;">${contractStats.leadTimeStats.prevMonth.length > 0 ? (contractStats.leadTimeStats.prevMonth.reduce((a,b) => a+b, 0) / contractStats.leadTimeStats.prevMonth.length).toFixed(1) : '-'}일</div>
          <div class="stat-label">평균 계약소요일 (이전 영업기회 ${contractStats.leadTimeStats.prevMonth.length}건)</div>
        </div>
      </div>

      <!-- 계약 소요일 분포 -->
      <div class="grid-3" style="margin-bottom:25px;">
        <div class="card">
          <h4 style="margin-bottom:10px;">⏱️ 이번달 영업기회 → 계약 (${contractStats.leadTimeStats.thisMonth.length}건)</h4>
          <table>
            <thead><tr><th>구간</th><th>건수</th><th>비율</th></tr></thead>
            <tbody>
              ${Object.entries(contractStats.leadTimeStats.byRangeThisMonth).map(([range, count]) => {
                const total = contractStats.leadTimeStats.thisMonth.length;
                const pct = total > 0 ? (count / total * 100).toFixed(1) : 0;
                const colorClass = range === '0-7일' ? 'good' : range === '30일+' ? 'bad' : '';
                return `<tr><td>${range}</td><td>${count}건</td><td class="${colorClass}">${pct}%</td></tr>`;
              }).join('')}
            </tbody>
          </table>
          <p style="margin-top:10px; color:#666; font-size:0.85em;">
            평균: <strong>${contractStats.leadTimeStats.thisMonth.length > 0 ? (contractStats.leadTimeStats.thisMonth.reduce((a,b) => a+b, 0) / contractStats.leadTimeStats.thisMonth.length).toFixed(1) : '-'}일</strong>
          </p>
        </div>
        <div class="card">
          <h4 style="margin-bottom:10px;">⏱️ 이전 영업기회 → 계약 (${contractStats.leadTimeStats.prevMonth.length}건)</h4>
          <table>
            <thead><tr><th>구간</th><th>건수</th><th>비율</th></tr></thead>
            <tbody>
              ${Object.entries(contractStats.leadTimeStats.byRangePrevMonth).map(([range, count]) => {
                const total = contractStats.leadTimeStats.prevMonth.length;
                const pct = total > 0 ? (count / total * 100).toFixed(1) : 0;
                const colorClass = range === '0-7일' ? 'good' : range === '30일+' ? 'bad' : '';
                return `<tr><td>${range}</td><td>${count}건</td><td class="${colorClass}">${pct}%</td></tr>`;
              }).join('')}
            </tbody>
          </table>
          <p style="margin-top:10px; color:#666; font-size:0.85em;">
            평균: <strong>${contractStats.leadTimeStats.prevMonth.length > 0 ? (contractStats.leadTimeStats.prevMonth.reduce((a,b) => a+b, 0) / contractStats.leadTimeStats.prevMonth.length).toFixed(1) : '-'}일</strong>
          </p>
        </div>
        <div class="card">
          <h4 style="margin-bottom:10px;">📊 소요일 분포 비교</h4>
          <div class="chart-container" style="height:200px;"><canvas id="leadTimeChart"></canvas></div>
        </div>
      </div>

      <!-- 단계별 분포 -->
      <div class="grid-3" style="margin-bottom:25px;">
        <div class="card">
          <h4 style="margin-bottom:10px;">📊 ContractStatus별</h4>
          <table>
            <thead><tr><th>상태</th><th>건수</th></tr></thead>
            <tbody>
              ${Object.entries(contractStats.byStatus).sort((a,b) => b[1] - a[1]).map(([status, count]) => `
              <tr><td>${status}</td><td>${count}건</td></tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="card">
          <h4 style="margin-bottom:10px;">📈 Opportunity StageName별</h4>
          <table>
            <thead><tr><th>단계</th><th>건수</th></tr></thead>
            <tbody>
              ${Object.entries(contractStats.byStage).sort((a,b) => b[1] - a[1]).map(([stage, count]) => `
              <tr>
                <td>${stage === 'Closed Won' ? '✅ ' + stage : stage === 'Closed Lost' ? '❌ ' + stage : '🔄 ' + stage}</td>
                <td>${count}건</td>
              </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="card">
          <h4 style="margin-bottom:10px;">🏷️ RecordType별 (신규/추가설치)</h4>
          <table>
            <thead><tr><th>유형</th><th>전체</th><th>CW</th><th>WIP</th></tr></thead>
            <tbody>
              ${Object.entries(contractStats.byRecordType).sort((a,b) => b[1].total - a[1].total).map(([rt, s]) => `
              <tr>
                <td><strong>${rt}</strong></td>
                <td>${s.total}건</td>
                <td>${s.cw}건</td>
                <td class="${s.wip > 0 ? 'warn' : ''}">${s.wip}건</td>
              </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      ${contractStats.wip.length > 0 ? `
      <!-- WIP 상세 목록 -->
      <h3 style="margin-top:25px;">🔄 WIP 상세 목록 (CW 전 단계 ${contractStats.wip.length}건)</h3>
      <div class="card" style="max-height:400px; overflow-y:auto;">
        <table>
          <thead>
            <tr><th>계약시작</th><th>유형</th><th>단계</th><th>Status</th><th>Account</th><th>BO</th><th>Field</th></tr>
          </thead>
          <tbody>
            ${contractStats.wip.sort((a,b) => a.contractStart.localeCompare(b.contractStart)).map(w => `
            <tr>
              <td>${w.contractStart}</td>
              <td><span style="background:${w.recordType === '신규' ? '#e8f4fc' : '#fcf4e8'}; padding:2px 6px; border-radius:3px; font-size:0.85em;">${w.recordType}</span></td>
              <td><strong>${w.stage}</strong></td>
              <td>${w.status}</td>
              <td>${w.account}</td>
              <td>${w.bo}</td>
              <td>${w.field}</td>
            </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ` : ''}

      <p style="margin-top:15px; color:#666; font-size:0.9em;">
        * 이번달 ContractDateStart__c 기준 | ContractStatus: 계약서명완료, 계약서명대기, 요청취소
      </p>
    </div><!-- 계약 현황 요약 끝 -->

    <p style="text-align:center; color:#999; margin-top:40px; font-size:0.9em;">
      Generated at ${new Date().toISOString().replace('T', ' ').substring(0, 19)} (KST)
    </p>
  </div>

  <script>
    // FRT 구간별 차트
    new Chart(document.getElementById('frtChart'), {
      type: 'line',
      data: {
        labels: [${frtBucketStats.filter(b => b.bucket !== 'NO_TASK' && b.total > 0).map(b => `'${b.bucket}'`).join(',')}],
        datasets: [{
          label: '오인입률',
          data: [${frtBucketStats.filter(b => b.bucket !== 'NO_TASK' && b.total > 0).map(b => b.wrongEntryRate).join(',')}],
          borderColor: '#e74c3c',
          backgroundColor: 'rgba(231, 76, 60, 0.1)',
          fill: true,
          tension: 0.3
        }, {
          label: '전환율',
          data: [${frtBucketStats.filter(b => b.bucket !== 'NO_TASK' && b.total > 0).map(b => b.conversionRate).join(',')}],
          borderColor: '#27ae60',
          backgroundColor: 'rgba(39, 174, 96, 0.1)',
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100 } }
      }
    });

    // 영업시간 FRT 차트
    new Chart(document.getElementById('frtBusinessChart'), {
      type: 'line',
      data: {
        labels: [${frtBucketStats.filter(b => b.bucket !== 'NO_TASK' && b.total > 0).map(b => `'${b.bucket}'`).join(',')}],
        datasets: [{
          label: '오인입률',
          data: [${frtBucketStats.filter(b => b.bucket !== 'NO_TASK' && b.total > 0).map(b => b.byTimeSlot.BUSINESS_HOUR.wrongEntryRate).join(',')}],
          borderColor: '#e74c3c',
          backgroundColor: 'rgba(231, 76, 60, 0.1)',
          fill: true,
          tension: 0.3
        }, {
          label: '전환율',
          data: [${frtBucketStats.filter(b => b.bucket !== 'NO_TASK' && b.total > 0).map(b => b.byTimeSlot.BUSINESS_HOUR.conversionRate).join(',')}],
          borderColor: '#27ae60',
          backgroundColor: 'rgba(39, 174, 96, 0.1)',
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100 } }
      }
    });

    // 영업외 FRT 차트
    new Chart(document.getElementById('frtOffHourChart'), {
      type: 'line',
      data: {
        labels: [${frtBucketStats.filter(b => b.bucket !== 'NO_TASK' && b.total > 0).map(b => `'${b.bucket}'`).join(',')}],
        datasets: [{
          label: '오인입률',
          data: [${frtBucketStats.filter(b => b.bucket !== 'NO_TASK' && b.total > 0).map(b => b.byTimeSlot.OFF_HOUR.wrongEntryRate).join(',')}],
          borderColor: '#e74c3c',
          backgroundColor: 'rgba(231, 76, 60, 0.1)',
          fill: true,
          tension: 0.3
        }, {
          label: '전환율',
          data: [${frtBucketStats.filter(b => b.bucket !== 'NO_TASK' && b.total > 0).map(b => b.byTimeSlot.OFF_HOUR.conversionRate).join(',')}],
          borderColor: '#27ae60',
          backgroundColor: 'rgba(39, 174, 96, 0.1)',
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100 } }
      }
    });

    // 주말 FRT 차트
    new Chart(document.getElementById('frtWeekendChart'), {
      type: 'line',
      data: {
        labels: [${frtBucketStats.filter(b => b.bucket !== 'NO_TASK' && b.total > 0).map(b => `'${b.bucket}'`).join(',')}],
        datasets: [{
          label: '오인입률',
          data: [${frtBucketStats.filter(b => b.bucket !== 'NO_TASK' && b.total > 0).map(b => b.byTimeSlot.WEEKEND.wrongEntryRate).join(',')}],
          borderColor: '#e74c3c',
          backgroundColor: 'rgba(231, 76, 60, 0.1)',
          fill: true,
          tension: 0.3
        }, {
          label: '전환율',
          data: [${frtBucketStats.filter(b => b.bucket !== 'NO_TASK' && b.total > 0).map(b => b.byTimeSlot.WEEKEND.conversionRate).join(',')}],
          borderColor: '#27ae60',
          backgroundColor: 'rgba(39, 174, 96, 0.1)',
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100 } }
      }
    });

    // 오인입 사유 차트
    new Chart(document.getElementById('reasonChart'), {
      type: 'doughnut',
      data: {
        labels: [${Object.keys(wrongEntryReasons).map(r => `'${r}'`).join(',')}],
        datasets: [{
          data: [${Object.values(wrongEntryReasons).join(',')}],
          backgroundColor: ['#3498db', '#9b59b6', '#e74c3c', '#f39c12', '#1abc9c', '#34495e', '#95a5a6']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false
      }
    });

    // Field 담당자별 방문 예정 차트
    new Chart(document.getElementById('visitFieldChart'), {
      type: 'bar',
      data: {
        labels: [${Object.keys(visitByField).map(f => `'${f}'`).join(',')}],
        datasets: [{
          label: '방문 예정',
          data: [${Object.values(visitByField).map(items => items.length).join(',')}],
          backgroundColor: '#3498db'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } }
      }
    });

    // 계약 소요일 분포 차트 (이번달 vs 이전달)
    new Chart(document.getElementById('leadTimeChart'), {
      type: 'bar',
      data: {
        labels: ['0-7일', '8-14일', '15-30일', '30일+'],
        datasets: [{
          label: '이번달 영업기회',
          data: [${Object.values(contractStats.leadTimeStats.byRangeThisMonth).join(',')}],
          backgroundColor: '#3498db'
        }, {
          label: '이전 영업기회',
          data: [${Object.values(contractStats.leadTimeStats.byRangePrevMonth).join(',')}],
          backgroundColor: '#95a5a6'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, position: 'bottom' } },
        scales: { y: { beginAtZero: true } }
      }
    });

    // 주차별 추이 차트
    new Chart(document.getElementById('weeklyTrendChart'), {
      type: 'line',
      data: {
        labels: [${weeklyTrend.map(w => `'${w.weekStart}'`).join(',')}],
        datasets: [{
          label: 'MQL 전환율',
          data: [${weeklyTrend.map(w => w.mqlRate).join(',')}],
          borderColor: '#9b59b6',
          tension: 0.3,
          yAxisID: 'y'
        }, {
          label: 'FRT 준수율',
          data: [${weeklyTrend.map(w => w.frtRate).join(',')}],
          borderColor: '#3498db',
          tension: 0.3,
          yAxisID: 'y'
        }, {
          label: '오인입율',
          data: [${weeklyTrend.map(w => w.wrongEntryRate).join(',')}],
          borderColor: '#e74c3c',
          tension: 0.3,
          yAxisID: 'y'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: '%' } } }
      }
    });

    // 채널별 리드 품질 차트
    new Chart(document.getElementById('leadSourceChart'), {
      type: 'bar',
      data: {
        labels: [${Object.keys(leadBySource).map(s => `'${s}'`).join(',')}],
        datasets: [{
          label: '건수',
          data: [${Object.values(leadBySource).map(d => d.total).join(',')}],
          backgroundColor: '#3498db'
        }, {
          label: '오인입',
          data: [${Object.values(leadBySource).map(d => d.wrongEntry).join(',')}],
          backgroundColor: '#e74c3c'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } }
      }
    });

    // CL 사유 차트
    new Chart(document.getElementById('clReasonChart'), {
      type: 'doughnut',
      data: {
        labels: [${Object.keys(clStats.byReason).map(r => `'${r}'`).join(',')}],
        datasets: [{
          data: [${Object.values(clStats.byReason).map(d => d.count).join(',')}],
          backgroundColor: ['#e74c3c', '#f39c12', '#9b59b6', '#3498db', '#1abc9c', '#95a5a6']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right' } }
      }
    });

    // BO 워크로드 차트
    new Chart(document.getElementById('boWorkloadChart'), {
      type: 'bar',
      data: {
        labels: [${boWorkload.map(b => `'${b.name}'`).join(',')}],
        datasets: [{
          label: '현재 진행중',
          data: [${boWorkload.map(b => b.currentOpen).join(',')}],
          backgroundColor: '#3498db'
        }, {
          label: '신규 배정',
          data: [${boWorkload.map(b => b.periodInflow).join(',')}],
          backgroundColor: '#2ecc71'
        }, {
          label: '처리 완료',
          data: [${boWorkload.map(b => b.periodProcessed).join(',')}],
          backgroundColor: '#9b59b6'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } }
      }
    });
  </script>
</body>
</html>`;

  const filename = `InboundSales_Report_${startDate.replace(/-/g, '')}_${endDate.replace(/-/g, '')}.html`;
  fs.writeFileSync(filename, html);
  console.log(`\n📄 HTML 리포트 생성: ${filename}`);
  return filename;
}

// ============================================
// 이전 기간 날짜 계산
// ============================================
function getPreviousPeriodRange(startDate, endDate, mode) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

  let prevStart, prevEnd;

  if (mode === 'daily') {
    // 전일 대비
    prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - 1);
    prevEnd = new Date(prevStart);
  } else if (mode === 'weekly') {
    // 전주 대비
    prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - 7);
    prevEnd = new Date(end);
    prevEnd.setDate(prevEnd.getDate() - 7);
  } else {
    // 전월 대비 (동일 일수)
    prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - diffDays + 1);
  }

  return {
    startDate: prevStart.toISOString().split('T')[0],
    endDate: prevEnd.toISOString().split('T')[0]
  };
}

// ============================================
// 메인 실행
// ============================================
async function main() {
  const mode = process.argv[2] || 'daily';
  const sendToSlack = process.argv.includes('--slack');
  const generateHtml = process.argv.includes('--html');
  const generateJson = process.argv.includes('--json');

  if (!['daily', 'weekly', 'monthly', 'monthly-current'].includes(mode)) {
    console.error('❌ 사용법: node inbound-sales-report.js [daily|weekly|monthly|monthly-current] [--slack] [--html] [--json]');
    process.exit(1);
  }

  console.log(`\n📊 인바운드 세일즈 ${mode.toUpperCase()} 리포트 생성 시작...\n`);

  const { startDate, endDate, periodLabel } = getDateRange(mode);
  const data = await collectData(startDate, endDate);

  if (!data || !data.leads || data.leads.length === 0) {
    console.log('⚠️ 조회된 데이터가 없습니다.');
    return;
  }

  const stats = calculateStats(data);

  // 이전 기간 데이터 수집 (HTML 또는 JSON 생성시)
  let previousPeriodStats = null;
  if (generateJson || generateHtml) {
    const prevRange = getPreviousPeriodRange(startDate, endDate, mode);
    console.log(`\n📊 이전 기간 데이터 수집: ${prevRange.startDate} ~ ${prevRange.endDate}`);
    try {
      const prevData = await collectData(prevRange.startDate, prevRange.endDate);
      if (prevData && prevData.leads && prevData.leads.length > 0) {
        const prevStats = calculateStats(prevData);
        previousPeriodStats = {
          period: { startDate: prevRange.startDate, endDate: prevRange.endDate },
          totalStats: prevStats.totalStats,
          leadBySource: prevStats.leadBySource,
          clStats: prevStats.clStats
        };
      }
    } catch (err) {
      console.log('⚠️ 이전 기간 데이터 수집 실패:', err.message);
    }
  }

  // 콘솔 출력
  printReport(stats, periodLabel);

  // Slack 전송 (옵션)
  if (sendToSlack) {
    // monthly-current는 monthly 메시지 포맷 사용
    const slackMode = mode === 'monthly-current' ? 'monthly' : mode;
    await sendSlack(stats, periodLabel, slackMode);
  }

  // HTML 생성 (옵션)
  if (generateHtml) {
    const filename = generateHTML(stats, periodLabel, startDate, endDate, previousPeriodStats);
    console.log(`\n🌐 브라우저에서 열기: open ${filename}`);
  }

  // JSON 생성 (옵션)
  if (generateJson) {
    // 목표 대비 달성률 계산
    const ts = stats.totalStats;
    const mqlRate = ts.lead > 0 ? (ts.mql / ts.lead * 100) : 0;
    const sqlRate = ts.mql > 0 ? (ts.sql / ts.mql * 100) : 0;
    const frtRate = ts.withTask > 0 ? (ts.frtOk / ts.withTask * 100) : 0;
    const wrongEntryRateCalc = ts.lead > 0 ? (ts.wrongEntry / ts.lead * 100) : 0;

    const achievement = {
      mqlConversionRate: { actual: parseFloat(mqlRate.toFixed(1)), target: TARGETS.mqlConversionRate, gap: parseFloat((mqlRate - TARGETS.mqlConversionRate).toFixed(1)), status: mqlRate >= TARGETS.mqlConversionRate ? '✅' : mqlRate >= TARGETS.mqlConversionRate * 0.9 ? '⚠️' : '❌' },
      sqlConversionRate: { actual: parseFloat(sqlRate.toFixed(1)), target: TARGETS.sqlConversionRate, gap: parseFloat((sqlRate - TARGETS.sqlConversionRate).toFixed(1)), status: sqlRate >= TARGETS.sqlConversionRate ? '✅' : sqlRate >= TARGETS.sqlConversionRate * 0.9 ? '⚠️' : '❌' },
      frtComplianceRate: { actual: parseFloat(frtRate.toFixed(1)), target: TARGETS.frtComplianceRate, gap: parseFloat((frtRate - TARGETS.frtComplianceRate).toFixed(1)), status: frtRate >= TARGETS.frtComplianceRate ? '✅' : frtRate >= TARGETS.frtComplianceRate * 0.9 ? '⚠️' : '❌' },
      wrongEntryRate: { actual: parseFloat(wrongEntryRateCalc.toFixed(1)), target: TARGETS.wrongEntryRate, gap: parseFloat((TARGETS.wrongEntryRate - wrongEntryRateCalc).toFixed(1)), status: wrongEntryRateCalc <= TARGETS.wrongEntryRate ? '✅' : wrongEntryRateCalc <= TARGETS.wrongEntryRate * 1.5 ? '⚠️' : '❌' },
      monthlyVisit: { actual: ts.visitConverted, target: TARGETS.monthlyVisitTarget, gap: ts.visitConverted - TARGETS.monthlyVisitTarget, status: ts.visitConverted >= TARGETS.monthlyVisitTarget ? '✅' : ts.visitConverted >= TARGETS.monthlyVisitTarget * 0.8 ? '⚠️' : '❌' },
      monthlyCW: { actual: ts.cw, target: TARGETS.monthlyCWTarget, gap: ts.cw - TARGETS.monthlyCWTarget, status: ts.cw >= TARGETS.monthlyCWTarget ? '✅' : ts.cw >= TARGETS.monthlyCWTarget * 0.8 ? '⚠️' : '❌' }
    };

    // 이전 기간 대비 변화량 계산
    let comparison = null;
    if (previousPeriodStats) {
      const prev = previousPeriodStats.totalStats;
      const prevMqlRate = prev.lead > 0 ? (prev.mql / prev.lead * 100) : 0;
      const prevSqlRate = prev.mql > 0 ? (prev.sql / prev.mql * 100) : 0;
      const prevFrtRate = prev.withTask > 0 ? (prev.frtOk / prev.withTask * 100) : 0;
      const prevWrongEntryRate = prev.lead > 0 ? (prev.wrongEntry / prev.lead * 100) : 0;

      comparison = {
        period: previousPeriodStats.period,
        lead: { current: ts.lead, previous: prev.lead, change: ts.lead - prev.lead, trend: ts.lead >= prev.lead ? '↑' : '↓' },
        mql: { current: ts.mql, previous: prev.mql, change: ts.mql - prev.mql, trend: ts.mql >= prev.mql ? '↑' : '↓' },
        sql: { current: ts.sql, previous: prev.sql, change: ts.sql - prev.sql, trend: ts.sql >= prev.sql ? '↑' : '↓' },
        cw: { current: ts.cw, previous: prev.cw, change: ts.cw - prev.cw, trend: ts.cw >= prev.cw ? '↑' : '↓' },
        mqlRate: { current: parseFloat(mqlRate.toFixed(1)), previous: parseFloat(prevMqlRate.toFixed(1)), change: parseFloat((mqlRate - prevMqlRate).toFixed(1)), trend: mqlRate >= prevMqlRate ? '↑' : '↓' },
        sqlRate: { current: parseFloat(sqlRate.toFixed(1)), previous: parseFloat(prevSqlRate.toFixed(1)), change: parseFloat((sqlRate - prevSqlRate).toFixed(1)), trend: sqlRate >= prevSqlRate ? '↑' : '↓' },
        frtRate: { current: parseFloat(frtRate.toFixed(1)), previous: parseFloat(prevFrtRate.toFixed(1)), change: parseFloat((frtRate - prevFrtRate).toFixed(1)), trend: frtRate >= prevFrtRate ? '↑' : '↓' },
        wrongEntryRate: { current: parseFloat(wrongEntryRateCalc.toFixed(1)), previous: parseFloat(prevWrongEntryRate.toFixed(1)), change: parseFloat((wrongEntryRateCalc - prevWrongEntryRate).toFixed(1)), trend: wrongEntryRateCalc <= prevWrongEntryRate ? '↑' : '↓' }
      };
    }

    const jsonData = {
      period: { label: periodLabel, startDate, endDate },
      generatedAt: new Date().toISOString(),
      targets: TARGETS,
      achievement,
      comparison,
      previousPeriod: previousPeriodStats,

      // 전체 통계
      totalStats: stats.totalStats,
      leadBySource: stats.leadBySource,
      clStats: stats.clStats,
      weeklyTrend: stats.weeklyTrend,

      // ========== Inside Sales ==========
      insideSales: {
        // Lead → MQL
        frtBucketStats: stats.frtBucketStats,
        wrongEntryReasons: stats.wrongEntryReasons,
        // MQL → 영업기회 (담당자별)
        ownerStats: stats.ownerStats
      },

      // ========== Inside Field ==========
      insideField: {
        // Field CW 전환율
        fieldStats: stats.fieldStats,
        // Field 행동지표 (일반/오픈전 구분)
        fieldActivityStats: Object.fromEntries(
          Object.entries(stats.fieldActivityStats).map(([name, s]) => [name, {
            name: s.name,
            totalOpps: s.totalOpps,
            // 일반
            normal: {
              open: s.normalOpen,
              avgRetouchDays: s.normalRetouchCount > 0
                ? (s.normalRetouchDaysSum / s.normalRetouchCount).toFixed(1)
                : null,
              retouchOver7: s.normalRetouchOver7
            },
            // 오픈전
            preOpen: {
              total: s.preOpenCount,
              open: s.preOpenOpen,
              avgRetouchDays: s.preOpenRetouchCount > 0
                ? (s.preOpenRetouchDaysSum / s.preOpenRetouchCount).toFixed(1)
                : null,
              retouchOver7: s.preOpenRetouchOver7
            },
            cw: s.cw,
            cl: s.cl
          }])
        ),
        // 방문 현황
        visitDistribution: {
          byWeek: stats.visitByWeek,
          byField: stats.visitByField,
          byDate: stats.visitByDate
        },
        // Field 계약 현황
        contractByField: Object.fromEntries(
          Object.entries(stats.contractStats.byField).map(([name, s]) => [name, {
            ...s,
            avgLeadTimeThisMonth: s.leadTimesThisMonth.length > 0
              ? (s.leadTimesThisMonth.reduce((a,b) => a+b, 0) / s.leadTimesThisMonth.length).toFixed(1)
              : null,
            avgLeadTimePrevMonth: s.leadTimesPrevMonth.length > 0
              ? (s.leadTimesPrevMonth.reduce((a,b) => a+b, 0) / s.leadTimesPrevMonth.length).toFixed(1)
              : null
          }])
        )
      },

      // ========== Inside Back Office ==========
      insideBackOffice: {
        // BO CW 전환율
        boStats: stats.boStats,
        // BO 워크로드 (일반/오픈전 구분)
        boWorkload: Object.fromEntries(
          Object.entries(stats.boWorkload).map(([name, s]) => [name, {
            name: s.name,
            currentOpen: s.currentOpen,
            normal: {
              open: s.normalOpen
            },
            preOpen: {
              open: s.preOpenOpen
            },
            periodInflow: s.periodInflow,
            periodProcessed: s.periodProcessed,
            periodCW: s.periodCW,
            periodCL: s.periodCL,
            netChange: s.netChange
          }])
        ),
        // 견적 관리 (일반/오픈전 구분)
        quoteStage: {
          total: stats.quoteStageOpps.length,
          withQuote: stats.quoteStageWithQuote.length,
          noQuote: {
            total: stats.quoteStageNoQuote.length,
            normal: stats.quoteStageNoQuoteNormal.length,
            preOpen: stats.quoteStageNoQuotePreOpen.length
          },
          stale8plus: {
            total: stats.stale8plus.length,
            normal: stats.stale8plusNormal.length,
            preOpen: stats.stale8plusPreOpen.length
          },
          stale4to7: {
            total: stats.stale4to7.length,
            normal: stats.stale4to7Normal.length,
            preOpen: stats.stale4to7PreOpen.length
          },
          byStatus: {
            normal: stats.quoteStageNormal.length,
            preOpen: stats.quoteStagePreOpen.length
          },
          boQuoteStats: stats.boQuoteStats
        },
        // BO 계약 현황
        contractByBO: Object.fromEntries(
          Object.entries(stats.contractStats.byBO).map(([name, s]) => [name, {
            ...s,
            avgLeadTimeThisMonth: s.leadTimesThisMonth.length > 0
              ? (s.leadTimesThisMonth.reduce((a,b) => a+b, 0) / s.leadTimesThisMonth.length).toFixed(1)
              : null,
            avgLeadTimePrevMonth: s.leadTimesPrevMonth.length > 0
              ? (s.leadTimesPrevMonth.reduce((a,b) => a+b, 0) / s.leadTimesPrevMonth.length).toFixed(1)
              : null
          }])
        )
      },

      // 전체 계약 현황 요약
      contractStats: {
        total: stats.contractStats.total,
        byStatus: stats.contractStats.byStatus,
        byStage: stats.contractStats.byStage,
        byRecordType: stats.contractStats.byRecordType,
        wip: stats.contractStats.wip,
        leadTimeStats: {
          thisMonth: {
            count: stats.contractStats.leadTimeStats.thisMonth.length,
            average: stats.contractStats.leadTimeStats.thisMonth.length > 0
              ? (stats.contractStats.leadTimeStats.thisMonth.reduce((a,b) => a+b, 0) / stats.contractStats.leadTimeStats.thisMonth.length).toFixed(1)
              : null,
            byRange: stats.contractStats.leadTimeStats.byRangeThisMonth,
            all: stats.contractStats.leadTimeStats.thisMonth
          },
          prevMonth: {
            count: stats.contractStats.leadTimeStats.prevMonth.length,
            average: stats.contractStats.leadTimeStats.prevMonth.length > 0
              ? (stats.contractStats.leadTimeStats.prevMonth.reduce((a,b) => a+b, 0) / stats.contractStats.leadTimeStats.prevMonth.length).toFixed(1)
              : null,
            byRange: stats.contractStats.leadTimeStats.byRangePrevMonth,
            all: stats.contractStats.leadTimeStats.prevMonth
          },
          total: {
            count: stats.contractStats.leadTimeStats.all.length,
            average: stats.contractStats.leadTimeStats.all.length > 0
              ? (stats.contractStats.leadTimeStats.all.reduce((a,b) => a+b, 0) / stats.contractStats.leadTimeStats.all.length).toFixed(1)
              : null,
            byRange: stats.contractStats.leadTimeStats.byRange
          }
        }
      }
    };
    const jsonFilename = `InboundSales_Report_${startDate.replace(/-/g, '')}_${endDate.replace(/-/g, '')}.json`;
    fs.writeFileSync(jsonFilename, JSON.stringify(jsonData, null, 2));
    console.log(`\n📄 JSON 데이터 생성: ${jsonFilename}`);
  }
}

main().catch(err => {
  console.error('❌ 에러:', err.message);
  if (err.response) console.error('   상세:', err.response.data);
});
