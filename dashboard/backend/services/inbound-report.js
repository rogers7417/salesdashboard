/**
 * 인바운드 세일즈 리포트 서비스
 * - Inside Sales (TM): Lead → MQL, FRT
 * - Inside Field (필드): Opportunity → 방문 → 계약
 * - Inside Back Office (백오피스): 견적 → 계약
 */
const sf = require('./salesforce');
const { kstToUTC, getDateRange } = require('./date-utils');

// MQL 제외 사유
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

// KST 날짜 파싱
function parseKSTDateTime(kstDateStr) {
  if (!kstDateStr) return { dateStr: null, hour: 0, dayOfWeek: 0 };
  const [datePart, timePart] = kstDateStr.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour] = (timePart || '00:00:00').split(':').map(Number);
  return { dateStr: datePart, hour, dayOfWeek: new Date(year, month - 1, day).getDay() };
}

// 시간대 분류
function classifyTimeSlot(kstDateStr) {
  const { dayOfWeek, hour } = parseKSTDateTime(kstDateStr);
  if (dayOfWeek === 0 || dayOfWeek === 6) return 'WEEKEND';
  if (hour >= 10 && hour < 19) return 'BUSINESS_HOUR';
  return 'OFF_HOUR';
}

// FRT 구간
function classifyFRTBucket(frtMinutes) {
  if (frtMinutes === null) return 'NO_TASK';
  if (frtMinutes <= 10) return '10분 이내';
  if (frtMinutes <= 20) return '10~20분';
  if (frtMinutes <= 30) return '20~30분';
  if (frtMinutes <= 60) return '30~60분';
  if (frtMinutes <= 120) return '1~2시간';
  return '2시간 초과';
}

/**
 * 데이터 수집
 */
async function collectData(startDate, endDate) {
  const startUTC = kstToUTC(startDate, true);
  const endUTC = kstToUTC(endDate, false);

  // 1. 인바운드세일즈 User 조회
  const usersResult = await sf.query(`SELECT Id, Name FROM User WHERE Department = '인바운드세일즈' AND IsActive = true`);
  const insideUsers = usersResult.records || [];
  const userIds = insideUsers.map(u => `'${u.Id}'`).join(',');
  const userNameMap = {};
  insideUsers.forEach(u => { userNameMap[u.Id] = u.Name; });

  // 2. Lead 조회
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

  const leadsResult = await sf.query(leadQuery);
  const leads = (leadsResult.records || []).filter(l => !l.Company || !l.Company.toLowerCase().includes('test'));

  // 3. Opportunity 조회 (Field/BO 담당자 포함)
  const convertedOppIds = leads.filter(l => l.ConvertedOpportunityId).map(l => l.ConvertedOpportunityId);
  let opportunities = [];
  const oppDataMap = {};

  if (convertedOppIds.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < convertedOppIds.length; i += chunkSize) {
      const chunk = convertedOppIds.slice(i, i + chunkSize);
      const oppIds = chunk.map(id => `'${id}'`).join(',');
      const oppResult = await sf.query(`
        SELECT Id, Name, Loss_Reason__c, StageName, FieldUser__c, BOUser__c, AgeInDays,
               SalesInviteDate__c, CreatedDate, RecordType.Name, fm_CompanyStatus__c
        FROM Opportunity WHERE Id IN (${oppIds})
      `);
      opportunities = opportunities.concat(oppResult.records || []);
    }
  }

  // Field/BO User 정보 조회
  const fieldBoUserIds = new Set();
  opportunities.forEach(opp => {
    if (opp.FieldUser__c) fieldBoUserIds.add(opp.FieldUser__c);
    if (opp.BOUser__c) fieldBoUserIds.add(opp.BOUser__c);
  });

  if (fieldBoUserIds.size > 0) {
    const fbUserIds = [...fieldBoUserIds].map(id => `'${id}'`).join(',');
    const fbUsersResult = await sf.query(`SELECT Id, Name FROM User WHERE Id IN (${fbUserIds})`);
    (fbUsersResult.records || []).forEach(u => { userNameMap[u.Id] = u.Name; });
  }

  // Quote 조회
  let quotes = [];
  if (convertedOppIds.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < convertedOppIds.length; i += chunkSize) {
      const chunk = convertedOppIds.slice(i, i + chunkSize);
      const oppIds = chunk.map(id => `'${id}'`).join(',');
      const quoteResult = await sf.query(`SELECT Id, OpportunityId, CreatedDate FROM Quote WHERE OpportunityId IN (${oppIds}) ORDER BY OpportunityId, CreatedDate DESC`);
      quotes = quotes.concat(quoteResult.records || []);
    }
  }

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
      const oppTaskResult = await sf.query(`SELECT Id, WhatId, OwnerId, CreatedDate FROM Task WHERE WhatId IN (${oppIds}) ORDER BY WhatId, CreatedDate`);
      oppTasks = oppTasks.concat(oppTaskResult.records || []);
    }
  }

  // Opportunity별 Task 매핑
  const tasksByOpp = {};
  oppTasks.forEach(t => {
    if (!tasksByOpp[t.WhatId]) tasksByOpp[t.WhatId] = [];
    tasksByOpp[t.WhatId].push(t);
  });

  // Opp 데이터 매핑
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
        daysSinceLastTask = Math.floor((new Date() - quoteDate) / (1000 * 60 * 60 * 24));
      }
    }

    // RecordType 분류 (신규/추가설치)
    const recordTypeRaw = opp.RecordType?.Name || '';
    const recordType = recordTypeRaw.includes('추가설치') ? '추가설치' : recordTypeRaw.includes('신규') ? '신규' : '기타';

    // 오픈전 여부
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

  // 4. Lead별 전체 Task 조회 (자동발송 제외)
  const firstTaskByLead = {};
  const allTasksByLead = {};
  if (leads.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < leads.length; i += chunkSize) {
      const chunk = leads.slice(i, i + chunkSize);
      const leadIds = chunk.map(l => `'${l.Id}'`).join(',');
      const tasksResult = await sf.query(`SELECT Id, Lead__c, Subject, CreatedDate FROM Task WHERE Lead__c IN (${leadIds}) AND OwnerId != '005IR00000FgbZtYAJ' ORDER BY Lead__c, CreatedDate ASC`);
      (tasksResult.records || []).forEach(task => {
        if (!firstTaskByLead[task.Lead__c]) firstTaskByLead[task.Lead__c] = task;
        if (!allTasksByLead[task.Lead__c]) allTasksByLead[task.Lead__c] = [];
        allTasksByLead[task.Lead__c].push(task);
      });
    }
  }

  // 5. 담당자별 Task (일별 생산량)
  let dailyTasks = [];
  if (userIds) {
    const dailyTasksResult = await sf.query(`SELECT Id, OwnerId, CreatedDate FROM Task WHERE OwnerId IN (${userIds}) AND CreatedDate >= ${startUTC} AND CreatedDate < ${endUTC}`);
    dailyTasks = dailyTasksResult.records || [];
  }

  // 6. Contract 조회
  const [sy, sm] = startDate.split('-').map(Number);
  const nextMonthFirst = new Date(sy, sm, 1).toISOString().slice(0, 10);
  let contracts = [];
  try {
    const contractResult = await sf.query(`
      SELECT Id, Name, Opportunity__c, ContractDateStart__c, ContractStatus__c,
        Opportunity__r.BOUser__c, Opportunity__r.BOUser__r.Name,
        Opportunity__r.FieldUser__c, Opportunity__r.FieldUser__r.Name,
        Opportunity__r.StageName, Opportunity__r.Name,
        Opportunity__r.RecordType.Name, Opportunity__r.CreatedDate,
        Opportunity__r.fm_CompanyStatus__c
      FROM Contract__c
      WHERE Opportunity__c != NULL
        AND ContractDateStart__c >= ${startDate}
        AND ContractDateStart__c < ${nextMonthFirst}
        AND ContractStatus__c IN ('계약서명완료','계약서명대기','요청취소')
        AND Opportunity__r.Owner_Department__c = '인바운드세일즈'
    `);
    contracts = contractResult.records || [];

    // Contract User 정보 추가
    contracts.forEach(c => {
      if (c.Opportunity__r?.BOUser__c && c.Opportunity__r?.BOUser__r?.Name) {
        userNameMap[c.Opportunity__r.BOUser__c] = c.Opportunity__r.BOUser__r.Name;
      }
      if (c.Opportunity__r?.FieldUser__c && c.Opportunity__r?.FieldUser__r?.Name) {
        userNameMap[c.Opportunity__r.FieldUser__c] = c.Opportunity__r.FieldUser__r.Name;
      }
    });
  } catch (err) {
    console.log('Contract 조회 스킵:', err.message);
  }

  // 7. Contract Opportunity에 대한 Task 조회 (리터치 분석용)
  let oppTaskMap = {};  // oppId → [{ createdDate, subject }]
  try {
    const contractOppIds = contracts
      .map(c => c.Opportunity__c)
      .filter(Boolean);
    if (contractOppIds.length > 0) {
      // WhatId = Opportunity Id인 Task 조회
      const chunks = [];
      for (let i = 0; i < contractOppIds.length; i += 200) {
        chunks.push(contractOppIds.slice(i, i + 200));
      }
      for (const chunk of chunks) {
        const ids = chunk.map(id => `'${id}'`).join(',');
        const taskResult = await sf.query(`
          SELECT Id, WhatId, OwnerId, CreatedDate, Subject
          FROM Task
          WHERE WhatId IN (${ids})
          ORDER BY CreatedDate ASC
        `);
        (taskResult.records || []).forEach(t => {
          const oppId = t.WhatId;
          if (!oppTaskMap[oppId]) oppTaskMap[oppId] = [];
          oppTaskMap[oppId].push({
            createdDate: t.CreatedDate,
            subject: t.Subject || '',
            ownerId: t.OwnerId
          });
        });
      }
    }
  } catch (err) {
    console.log('Contract Task 조회 스킵:', err.message);
  }

  // 8. 이번달 생성 Opportunity 전체 조회 (Lead 경유 여부 무관, 파이프라인 칸반용)
  let allOpportunities = [];
  try {
    const allOppResult = await sf.query(`
      SELECT Id, Name, StageName, BOUser__c, BOUser__r.Name, CreatedDate, RecordType.Name, AgeInDays
      FROM Opportunity
      WHERE Owner_Department__c = '인바운드세일즈'
        AND CreatedDate >= ${startDate}T00:00:00Z
        AND CreatedDate < ${nextMonthFirst}T00:00:00Z
    `);
    allOpportunities = allOppResult.records || [];
    console.log(`  → 이번달 전체 Opportunity: ${allOpportunities.length}건`);
  } catch (err) {
    console.log('전체 Opportunity 조회 스킵:', err.message);
  }

  // 9. Visit__c 조회 (방문 → CW 분석용)
  let visits = [];
  try {
    const visitResult = await sf.queryAll(`
      SELECT Id, Opportunity__c, Opportunity__r.StageName, Opportunity__r.CreatedDate,
             IsVisitComplete__c, Visit_Status__c, User__c, User__r.Name,
             VisitAssignmentDate__c, ConselStart__c, ConselEnd__c
      FROM Visit__c
      WHERE Opportunity__r.Owner_Department__c = '인바운드세일즈'
        AND Opportunity__r.CreatedDate >= ${startDate}T00:00:00Z
        AND Opportunity__r.CreatedDate < ${nextMonthFirst}T00:00:00Z
    `);
    visits = visitResult || [];
    console.log(`  → Visit: ${visits.length}건`);
  } catch (err) {
    console.log('Visit 조회 스킵:', err.message);
  }

  return { leads, opportunities, oppDataMap, firstTaskByLead, allTasksByLead, dailyTasks, insideUsers, userNameMap, startDate, endDate, contracts, oppTaskMap, allOpportunities, visits, tasksByOpp };
}

/**
 * 통계 계산
 */
function calculateStats(data) {
  const { leads, oppDataMap, firstTaskByLead, allTasksByLead, dailyTasks, insideUsers, userNameMap, startDate, endDate, contracts, oppTaskMap = {}, allOpportunities = [], visits = [], tasksByOpp = {} } = data;

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

    // Task 패턴 분석용 데이터 (부재중 구분)
    const leadTasks = allTasksByLead[lead.Id] || [];
    const taskCount = leadTasks.length;
    const missedCount = leadTasks.filter(t => t.Subject && t.Subject.includes('부재')).length;
    const connectedCount = taskCount - missedCount;
    let avgTaskGapDays = null;
    let taskGaps = [];
    if (leadTasks.length >= 2) {
      const taskDates = leadTasks.map(t => new Date(t.CreatedDate).getTime()).sort((a, b) => a - b);
      for (let ti = 1; ti < taskDates.length; ti++) {
        taskGaps.push(Math.round((taskDates[ti] - taskDates[ti - 1]) / (1000 * 60 * 60 * 24) * 10) / 10);
      }
      avgTaskGapDays = Math.round(taskGaps.reduce((a, b) => a + b, 0) / taskGaps.length * 10) / 10;
    }

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
      isCL: oppData?.isCL || false,
      isWrongEntry: lead.LossReason__c === '오인입',
      lossReasonContract: lead.LossReason_Contract__c,
      leadSource: lead.LeadSource || '(미지정)',
      taskCount,
      missedCount,
      connectedCount,
      avgTaskGapDays,
      oppData
    };
  });

  // ========== Inside Sales (TM) 통계 ==========
  const total = leadData.length;
  const mqlLeads = leadData.filter(l => l.isMQL);
  const sqlLeads = leadData.filter(l => l.isSQL);
  const visitConverted = leadData.filter(l => l.isVisitConverted);
  const cwLeads = leadData.filter(l => l.isCW);
  const wrongEntry = leadData.filter(l => l.isWrongEntry);
  const withTask = leadData.filter(l => l.hasTask);
  const frtOk = leadData.filter(l => l.frtOk);

  // TM 담당자별 집계 (상세 지표 추가)
  const byOwner = {};
  leadData.forEach(l => {
    if (!byOwner[l.ownerId]) {
      byOwner[l.ownerId] = {
        name: l.ownerName,
        total: 0, mql: 0, sql: 0, visit: 0, cw: 0, frtOk: 0, withTask: 0, wrongEntry: 0,
        frtValues: [],
        byTimeSlot: {
          BUSINESS_HOUR: { total: 0, mql: 0, wrongEntry: 0, frtOk: 0, withTask: 0, frtValues: [] },
          OFF_HOUR: { total: 0, mql: 0, wrongEntry: 0, frtOk: 0, withTask: 0, frtValues: [] },
          WEEKEND: { total: 0, mql: 0, wrongEntry: 0, frtOk: 0, withTask: 0, frtValues: [] }
        }
      };
    }
    const o = byOwner[l.ownerId];
    o.total++;
    if (l.isMQL) o.mql++;
    if (l.isSQL) o.sql++;
    if (l.isVisitConverted) o.visit++;
    if (l.isCW) o.cw++;
    if (l.hasTask) o.withTask++;
    if (l.frtOk) o.frtOk++;
    if (l.isWrongEntry) o.wrongEntry++;
    if (l.frtMinutes !== null) o.frtValues.push(l.frtMinutes);

    // 시간대별 집계
    const ts = o.byTimeSlot[l.timeSlot];
    if (ts) {
      ts.total++;
      if (l.isMQL) ts.mql++;
      if (l.isWrongEntry) ts.wrongEntry++;
      if (l.hasTask) ts.withTask++;
      if (l.frtOk) ts.frtOk++;
      if (l.frtMinutes !== null) ts.frtValues.push(l.frtMinutes);
    }
  });

  // TM별 Task 집계 (일평균 계산용)
  const taskByOwner = {};
  const taskDates = new Set();
  dailyTasks.forEach(t => {
    const dateStr = t.CreatedDate.split('T')[0];
    taskDates.add(dateStr);
    if (!taskByOwner[t.OwnerId]) taskByOwner[t.OwnerId] = 0;
    taskByOwner[t.OwnerId]++;
  });
  const workingDays = taskDates.size || 1;

  // 전체 시간대별 집계
  const overallTimeSlot = {
    BUSINESS_HOUR: 0,
    OFF_HOUR: 0,
    WEEKEND: 0
  };
  leadData.forEach(l => {
    if (overallTimeSlot[l.timeSlot] !== undefined) {
      overallTimeSlot[l.timeSlot]++;
    }
  });

  // 인바운드세일즈 팀원 ID 셋 (팀원이 아닌 담당자 필터용)
  const insideUserIds = new Set(insideUsers.map(u => u.Id));

  const tmStats = Object.entries(byOwner)
    .filter(([id]) => insideUserIds.has(id))  // 인바운드세일즈 팀원만 포함
    .map(([id, d]) => {
      const avgFRT = d.frtValues.length > 0 ? Math.round(d.frtValues.reduce((a, b) => a + b, 0) / d.frtValues.length) : null;
      const taskTotal = taskByOwner[id] || 0;
      const dailyAvgTask = Math.round(taskTotal / workingDays * 10) / 10;

      // 시간대별 통계
      const timeSlotStats = {};
      ['BUSINESS_HOUR', 'OFF_HOUR', 'WEEKEND'].forEach(slot => {
        const ts = d.byTimeSlot[slot];
        const tsAvgFRT = ts.frtValues.length > 0 ? Math.round(ts.frtValues.reduce((a, b) => a + b, 0) / ts.frtValues.length) : null;
        timeSlotStats[slot] = {
          total: ts.total,
          mql: ts.mql,
          mqlRate: ts.total > 0 ? Math.round(ts.mql / ts.total * 100) : 0,
          wrongEntry: ts.wrongEntry,
          wrongEntryRate: ts.total > 0 ? Math.round(ts.wrongEntry / ts.total * 100) : 0,
          frtOk: ts.frtOk,
          frtRate: ts.withTask > 0 ? Math.round(ts.frtOk / ts.withTask * 100) : 0,
          avgFRT: tsAvgFRT
        };
      });

      return {
        ownerId: id,
        ownerName: d.name,
        total: d.total,
        mql: d.mql,
        sql: d.sql,
        visit: d.visit,
        cw: d.cw,
        frtOk: d.frtOk,
        withTask: d.withTask,
        wrongEntry: d.wrongEntry,
        mqlRate: d.total > 0 ? Math.round(d.mql / d.total * 100) : 0,
        sqlRate: d.mql > 0 ? Math.round(d.sql / d.mql * 100) : 0,
        frtRate: d.withTask > 0 ? Math.round(d.frtOk / d.withTask * 100) : 0,
        wrongEntryRate: d.total > 0 ? Math.round(d.wrongEntry / d.total * 100) : 0,
        avgFRT,
        taskTotal,
        dailyAvgTask,
        timeSlotStats
      };
    })
    .sort((a, b) => b.total - a.total);

  // 일별 집계 (FRT, 오인입 포함)
  const byDate = {};
  leadData.forEach(l => {
    if (!l.dateStr) return;
    if (!byDate[l.dateStr]) byDate[l.dateStr] = { total: 0, mql: 0, sql: 0, cw: 0, withTask: 0, frtOk: 0, wrongEntry: 0, frtOkMql: 0, frtFailMql: 0, frtOkTotal: 0, frtFailTotal: 0 };
    byDate[l.dateStr].total++;
    if (l.isMQL) byDate[l.dateStr].mql++;
    if (l.isSQL) byDate[l.dateStr].sql++;
    if (l.isCW) byDate[l.dateStr].cw++;
    if (l.hasTask) {
      byDate[l.dateStr].withTask++;
      if (l.frtOk) {
        byDate[l.dateStr].frtOk++;
        byDate[l.dateStr].frtOkTotal++;
        if (l.isMQL) byDate[l.dateStr].frtOkMql++;
      } else {
        byDate[l.dateStr].frtFailTotal++;
        if (l.isMQL) byDate[l.dateStr].frtFailMql++;
      }
    }
    if (l.isWrongEntry) byDate[l.dateStr].wrongEntry++;
  });

  const dailyStats = Object.entries(byDate)
    .map(([date, d]) => ({
      date,
      ...d,
      mqlRate: d.total > 0 ? Math.round(d.mql / d.total * 100) : 0,
      frtRate: d.withTask > 0 ? Math.round(d.frtOk / d.withTask * 100) : 0,
      wrongEntryRate: d.total > 0 ? Math.round(d.wrongEntry / d.total * 100) : 0,
      frtOkMqlRate: d.frtOkTotal > 0 ? Math.round(d.frtOkMql / d.frtOkTotal * 100) : null,
      frtFailMqlRate: d.frtFailTotal > 0 ? Math.round(d.frtFailMql / d.frtFailTotal * 100) : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // FRT 응대속도 vs 전환율 상관관계 (MQL + SQL)
  const frtCorrelation = (() => {
    const leadsWithTask = leadData.filter(l => l.hasTask && !l.isWrongEntry);
    const frtOkLeads = leadsWithTask.filter(l => l.frtOk);
    const frtFailLeads = leadsWithTask.filter(l => !l.frtOk);
    return {
      frtOk: {
        total: frtOkLeads.length,
        mql: frtOkLeads.filter(l => l.isMQL).length,
        mqlRate: frtOkLeads.length > 0 ? Math.round(frtOkLeads.filter(l => l.isMQL).length / frtOkLeads.length * 100) : 0,
        sql: frtOkLeads.filter(l => l.isSQL).length,
        sqlRate: frtOkLeads.length > 0 ? Math.round(frtOkLeads.filter(l => l.isSQL).length / frtOkLeads.length * 100) : 0,
        visit: frtOkLeads.filter(l => l.hasOpp && l.isVisitConverted).length,
        visitRate: frtOkLeads.length > 0 ? Math.round(frtOkLeads.filter(l => l.hasOpp && l.isVisitConverted).length / frtOkLeads.length * 100) : 0,
      },
      frtFail: {
        total: frtFailLeads.length,
        mql: frtFailLeads.filter(l => l.isMQL).length,
        mqlRate: frtFailLeads.length > 0 ? Math.round(frtFailLeads.filter(l => l.isMQL).length / frtFailLeads.length * 100) : 0,
        sql: frtFailLeads.filter(l => l.isSQL).length,
        sqlRate: frtFailLeads.length > 0 ? Math.round(frtFailLeads.filter(l => l.isSQL).length / frtFailLeads.length * 100) : 0,
        visit: frtFailLeads.filter(l => l.hasOpp && l.isVisitConverted).length,
        visitRate: frtFailLeads.length > 0 ? Math.round(frtFailLeads.filter(l => l.hasOpp && l.isVisitConverted).length / frtFailLeads.length * 100) : 0,
      },
      // FRT 구간별 전환율
      byBucket: (() => {
        const buckets = {};
        leadsWithTask.forEach(l => {
          const b = l.frtBucket || 'NO_TASK';
          if (!buckets[b]) buckets[b] = { total: 0, mql: 0, sql: 0, visit: 0 };
          buckets[b].total++;
          if (l.isMQL) buckets[b].mql++;
          if (l.isSQL) buckets[b].sql++;
          if (l.hasOpp && l.isVisitConverted) buckets[b].visit++;
        });
        return ['10분 이내', '10~20분', '20~30분', '30~60분', '1~2시간', '2시간 초과']
          .filter(b => buckets[b])
          .map(b => ({
            bucket: b,
            total: buckets[b].total,
            mql: buckets[b].mql,
            mqlRate: buckets[b].total > 0 ? Math.round(buckets[b].mql / buckets[b].total * 100) : 0,
            sql: buckets[b].sql,
            sqlRate: buckets[b].total > 0 ? Math.round(buckets[b].sql / buckets[b].total * 100) : 0,
            visit: buckets[b].visit,
            visitRate: buckets[b].total > 0 ? Math.round(buckets[b].visit / buckets[b].total * 100) : 0,
          }));
      })(),
    };
  })();

  // 평균 FRT
  const frtValues = mqlLeads.filter(l => l.frtMinutes !== null).map(l => l.frtMinutes);
  const avgFRT = frtValues.length > 0 ? Math.round(frtValues.reduce((a, b) => a + b, 0) / frtValues.length * 10) / 10 : null;

  // ========== Inside Field (필드) 통계 ==========
  const fieldUserStats = {};
  Object.entries(oppDataMap).forEach(([oppId, opp]) => {
    if (opp.fieldUserId) {
      if (!fieldUserStats[opp.fieldUserId]) {
        fieldUserStats[opp.fieldUserId] = {
          name: userNameMap[opp.fieldUserId] || opp.fieldUserId,
          total: 0, cw: 0, cl: 0, open: 0,
          contractProgress: 0, shipmentProgress: 0, installProgress: 0,
          byStage: {}
        };
      }
      const fs = fieldUserStats[opp.fieldUserId];
      fs.total++;
      if (opp.isCW) fs.cw++;
      if (opp.isCL) fs.cl++;
      if (opp.isOpen) fs.open++;
      if (opp.stageName === '계약진행') fs.contractProgress++;
      if (opp.stageName === '출고진행') fs.shipmentProgress++;
      if (opp.stageName === '설치진행') fs.installProgress++;
      fs.byStage[opp.stageName] = (fs.byStage[opp.stageName] || 0) + 1;
    }
  });

  const fieldStats = Object.entries(fieldUserStats)
    .map(([userId, stats]) => {
      const expectedCW = stats.contractProgress + stats.shipmentProgress + stats.installProgress;
      const expectedClose = stats.cw + expectedCW;
      const expectedCloseRate = stats.total > 0 ? Math.round(expectedClose / stats.total * 100) : 0;

      return {
        userId,
        name: stats.name,
        total: stats.total,
        cw: stats.cw,
        cl: stats.cl,
        open: stats.open,
        contractProgress: stats.contractProgress,
        shipmentProgress: stats.shipmentProgress,
        installProgress: stats.installProgress,
        expectedCW,
        expectedClose,
        expectedCloseRate,
        cwRate: stats.total > 0 ? Math.round(stats.cw / stats.total * 100) : 0,
        clRate: stats.total > 0 ? Math.round(stats.cl / stats.total * 100) : 0,
        byStage: stats.byStage
      };
    })
    .sort((a, b) => b.total - a.total);

  // 방문 예정 분석
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

  const visitByWeek = { '과거': 0, '오늘': 0, '이번주': 0, '다음주': 0, '2주후+': 0 };
  const visitByField = {};

  Object.entries(oppDataMap).forEach(([oppId, opp]) => {
    if (opp.salesInviteDate && opp.isOpen) {
      const week = getWeekLabel(opp.salesInviteDate);
      if (week) {
        visitByWeek[week]++;
        if (week === '오늘' || week === '이번주' || week === '다음주') {
          const field = userNameMap[opp.fieldUserId] || '(미배정)';
          visitByField[field] = (visitByField[field] || 0) + 1;
        }
      }
    }
  });

  // ========== Visit → CW 분석 ==========
  const visitAnalysis = (() => {
    // Opp별로 Visit 그룹핑
    const byOpp = {};
    visits.forEach(v => {
      const oppId = v.Opportunity__c;
      if (!oppId) return;
      if (!byOpp[oppId]) byOpp[oppId] = { stage: v.Opportunity__r?.StageName, visits: [] };
      byOpp[oppId].visits.push(v);
    });

    // 전체 Opp 중 Visit 있는/없는 분류
    const allOppIds = new Set(Object.keys(oppDataMap));
    const oppWithVisit = new Set(Object.keys(byOpp));
    const oppWithoutVisit = [...allOppIds].filter(id => !oppWithVisit.has(id));

    // 방문상태별 집계
    const byStatus = { '방문완료': { total: 0, cw: 0, cl: 0 }, '배정완료': { total: 0, cw: 0, cl: 0 }, '방문취소': { total: 0, cw: 0, cl: 0 } };
    Object.values(byOpp).forEach(opp => {
      const hasComplete = opp.visits.some(v => v.Visit_Status__c === '방문완료');
      const allCancelled = opp.visits.every(v => v.Visit_Status__c === '방문취소');
      const status = allCancelled ? '방문취소' : hasComplete ? '방문완료' : '배정완료';
      byStatus[status].total++;
      if (opp.stage === 'Closed Won') byStatus[status].cw++;
      if (opp.stage === 'Closed Lost') byStatus[status].cl++;
    });

    // Visit 없는 Opp
    let noVisit = { total: oppWithoutVisit.length, cw: 0, cl: 0 };
    oppWithoutVisit.forEach(oppId => {
      const opp = oppDataMap[oppId];
      if (opp?.isCW) noVisit.cw++;
      if (opp?.isCL) noVisit.cl++;
    });

    // 담당자별 방문→CW (Field User 기준)
    const byUser = {};
    visits.forEach(v => {
      const userName = v.User__r?.Name || '(미배정)';
      const oppId = v.Opportunity__c;
      if (!oppId) return;
      if (!byUser[userName]) byUser[userName] = {};
      if (!byUser[userName][oppId]) {
        byUser[userName][oppId] = { stage: v.Opportunity__r?.StageName, statuses: [] };
      }
      byUser[userName][oppId].statuses.push(v.Visit_Status__c);
    });

    const userStats = Object.entries(byUser)
      .map(([name, opps]) => {
        const oppList = Object.values(opps);
        const total = oppList.length;
        const visited = oppList.filter(o => o.statuses.includes('방문완료')).length;
        const cwAfterVisit = oppList.filter(o => o.statuses.includes('방문완료') && o.stage === 'Closed Won').length;
        const clAfterVisit = oppList.filter(o => o.statuses.includes('방문완료') && o.stage === 'Closed Lost').length;
        const cwTotal = oppList.filter(o => o.stage === 'Closed Won').length;
        return {
          name, total, visited,
          visitRate: total > 0 ? Math.round(visited / total * 100) : 0,
          cwAfterVisit,
          clAfterVisit,
          cwRateAfterVisit: visited > 0 ? Math.round(cwAfterVisit / visited * 100) : 0,
          cwTotal
        };
      })
      .filter(u => u.total > 0)
      .sort((a, b) => b.total - a.total);

    return {
      totalOpps: allOppIds.size,
      oppsWithVisit: oppWithVisit.size,
      oppsWithoutVisit: oppWithoutVisit.length,
      byStatus,
      noVisit,
      userStats
    };
  })();

  // ========== Field 리터치 분석 ==========
  const fieldRetouchAnalysis = (() => {
    // Field User ID 셋
    const fieldUserIds = new Set(Object.keys(fieldUserStats));

    // Opp별 Task에서 Field 담당자의 Task만 필터
    const byUser = {};
    Object.entries(oppDataMap).forEach(([oppId, opp]) => {
      if (!opp.fieldUserId) return;
      const fieldName = userNameMap[opp.fieldUserId] || '(미배정)';
      if (!byUser[fieldName]) byUser[fieldName] = { total: 0, withTask: 0, totalTasks: 0, cwWithTask: 0, cwNoTask: 0, clWithTask: 0, clNoTask: 0 };

      const bu = byUser[fieldName];
      bu.total++;

      // 이 Opp의 Task 중 Field 담당자(OwnerId)가 생성한 Task
      const allTasks = tasksByOpp[oppId] || [];
      const fieldTasks = allTasks.filter(t => t.OwnerId === opp.fieldUserId);

      if (fieldTasks.length > 0) {
        bu.withTask++;
        bu.totalTasks += fieldTasks.length;
        if (opp.isCW) bu.cwWithTask++;
        if (opp.isCL) bu.clWithTask++;
      } else {
        if (opp.isCW) bu.cwNoTask++;
        if (opp.isCL) bu.clNoTask++;
      }
    });

    // 전체 통계
    let totalWithFieldTask = 0, totalNoFieldTask = 0;
    let cwWithTask = 0, cwNoTask = 0;
    Object.values(byUser).forEach(u => {
      totalWithFieldTask += u.withTask;
      totalNoFieldTask += u.total - u.withTask;
      cwWithTask += u.cwWithTask;
      cwNoTask += u.cwNoTask;
    });

    const userStats = Object.entries(byUser)
      .map(([name, u]) => ({
        name,
        total: u.total,
        withTask: u.withTask,
        taskRate: u.total > 0 ? Math.round(u.withTask / u.total * 100) : 0,
        avgTasks: u.withTask > 0 ? Math.round(u.totalTasks / u.withTask * 10) / 10 : 0,
        cwWithTask: u.cwWithTask,
        cwNoTask: u.cwNoTask,
        cwRateWithTask: u.withTask > 0 ? Math.round(u.cwWithTask / u.withTask * 100) : 0,
        cwRateNoTask: (u.total - u.withTask) > 0 ? Math.round(u.cwNoTask / (u.total - u.withTask) * 100) : 0,
      }))
      .filter(u => u.total > 0)
      .sort((a, b) => b.total - a.total);

    return {
      totalWithFieldTask,
      totalNoFieldTask,
      cwWithTask,
      cwNoTask,
      cwRateWithTask: totalWithFieldTask > 0 ? Math.round(cwWithTask / totalWithFieldTask * 100) : 0,
      cwRateNoTask: totalNoFieldTask > 0 ? Math.round(cwNoTask / totalNoFieldTask * 100) : 0,
      userStats
    };
  })();

  // ========== 견적 후 Field 리터치 분석 ==========
  const postQuoteFieldRetouch = (() => {
    const byUser = {};
    const staleOpps = []; // 견적 후 Field Task 없는 오픈 Opp
    const allPostQuote = []; // 견적 보유 전체 Opp 분석용

    Object.entries(oppDataMap).forEach(([oppId, opp]) => {
      if (!opp.hasQuote || !opp.fieldUserId) return;

      const fieldName = userNameMap[opp.fieldUserId] || '(미배정)';
      if (!byUser[fieldName]) byUser[fieldName] = {
        quoted: 0, withFieldTask: 0, totalFieldTasks: 0,
        cwWithTask: 0, cwNoTask: 0, clWithTask: 0, clNoTask: 0,
        openWithTask: 0, openNoTask: 0,
        totalResponseDays: 0, responseCount: 0,
        totalLastGapDays: 0, lastGapCount: 0,
      };
      const bu = byUser[fieldName];
      bu.quoted++;

      // 견적 후 Field 담당자 Task 필터
      const allTasks = tasksByOpp[oppId] || [];
      const quoteDate = new Date(opp.quoteDate);
      const fieldTasksAfterQuote = allTasks.filter(t =>
        t.OwnerId === opp.fieldUserId && new Date(t.CreatedDate) > quoteDate
      );

      const hasFieldTask = fieldTasksAfterQuote.length > 0;
      const oppInfo = {
        oppId, oppName: opp.oppName, fieldUser: fieldName,
        boUser: userNameMap[opp.boUserId] || '(미배정)',
        stage: opp.stageName, quoteDate: opp.quoteDate,
        fieldTaskCount: fieldTasksAfterQuote.length,
        hasFieldTask,
      };

      if (hasFieldTask) {
        bu.withFieldTask++;
        bu.totalFieldTasks += fieldTasksAfterQuote.length;

        // 견적→첫 Field Task 응답일
        const firstTaskDate = new Date(fieldTasksAfterQuote[0].CreatedDate);
        const responseDays = Math.floor((firstTaskDate - quoteDate) / (1000 * 60 * 60 * 24));
        bu.totalResponseDays += responseDays;
        bu.responseCount++;
        oppInfo.responseDays = responseDays;

        // 마지막 Field Task 이후 경과일
        const lastTaskDate = new Date(fieldTasksAfterQuote[fieldTasksAfterQuote.length - 1].CreatedDate);
        const lastGapDays = Math.floor((new Date() - lastTaskDate) / (1000 * 60 * 60 * 24));
        oppInfo.lastGapDays = lastGapDays;
        if (opp.isOpen) {
          bu.totalLastGapDays += lastGapDays;
          bu.lastGapCount++;
        }

        if (opp.isCW) bu.cwWithTask++;
        if (opp.isCL) bu.clWithTask++;
        if (opp.isOpen) bu.openWithTask++;
      } else {
        if (opp.isCW) bu.cwNoTask++;
        if (opp.isCL) bu.clNoTask++;
        if (opp.isOpen) {
          bu.openNoTask++;
          const gapDays = Math.floor((new Date() - quoteDate) / (1000 * 60 * 60 * 24));
          oppInfo.daysSinceQuote = gapDays;
          staleOpps.push(oppInfo);
        }
      }
      allPostQuote.push(oppInfo);
    });

    // 전체 통계
    let totalQuoted = 0, totalWithTask = 0, totalNoTask = 0;
    let cwWith = 0, cwNo = 0, openWith = 0, openNo = 0;
    Object.values(byUser).forEach(u => {
      totalQuoted += u.quoted;
      totalWithTask += u.withFieldTask;
      totalNoTask += u.quoted - u.withFieldTask;
      cwWith += u.cwWithTask;
      cwNo += u.cwNoTask;
      openWith += u.openWithTask;
      openNo += u.openNoTask;
    });

    const userStats = Object.entries(byUser)
      .map(([name, u]) => {
        const noTask = u.quoted - u.withFieldTask;
        return {
          name,
          quoted: u.quoted,
          withFieldTask: u.withFieldTask,
          fieldTaskRate: u.quoted > 0 ? Math.round(u.withFieldTask / u.quoted * 100) : 0,
          avgFieldTasks: u.withFieldTask > 0 ? Math.round(u.totalFieldTasks / u.withFieldTask * 10) / 10 : 0,
          avgResponseDays: u.responseCount > 0 ? Math.round(u.totalResponseDays / u.responseCount * 10) / 10 : null,
          avgLastGapDays: u.lastGapCount > 0 ? Math.round(u.totalLastGapDays / u.lastGapCount * 10) / 10 : null,
          cwWithTask: u.cwWithTask,
          cwNoTask: u.cwNoTask,
          cwRateWithTask: u.withFieldTask > 0 ? Math.round(u.cwWithTask / u.withFieldTask * 100) : 0,
          cwRateNoTask: noTask > 0 ? Math.round(u.cwNoTask / noTask * 100) : 0,
          openNoTask: u.openNoTask,
        };
      })
      .filter(u => u.quoted > 0)
      .sort((a, b) => b.quoted - a.quoted);

    // 방치 Opp 정렬 (오래된 순)
    staleOpps.sort((a, b) => (b.daysSinceQuote || 0) - (a.daysSinceQuote || 0));

    return {
      totalQuoted, totalWithTask, totalNoTask,
      fieldTaskRate: totalQuoted > 0 ? Math.round(totalWithTask / totalQuoted * 100) : 0,
      cwWithTask: cwWith, cwNoTask: cwNo,
      cwRateWithTask: totalWithTask > 0 ? Math.round(cwWith / totalWithTask * 100) : 0,
      cwRateNoTask: totalNoTask > 0 ? Math.round(cwNo / totalNoTask * 100) : 0,
      openWithTask: openWith, openNoTask: openNo,
      staleOpps: staleOpps.slice(0, 20), // 상위 20건
      userStats,
    };
  })();

  // ========== Inside Back Office (백오피스) 통계 ==========
  const boUserStats = {};
  const quoteStageOpps = [];

  Object.entries(oppDataMap).forEach(([oppId, opp]) => {
    // BO 담당자 통계
    if (opp.boUserId) {
      if (!boUserStats[opp.boUserId]) {
        boUserStats[opp.boUserId] = {
          name: userNameMap[opp.boUserId] || opp.boUserId,
          total: 0, cw: 0, cl: 0, open: 0,
          openByAge: { within3: 0, day4to7: 0, over7: 0 },
          contractProgress: 0, shipmentProgress: 0, installProgress: 0
        };
      }
      const bs = boUserStats[opp.boUserId];
      bs.total++;
      if (opp.isCW) bs.cw++;
      if (opp.isCL) bs.cl++;
      if (opp.isOpen) {
        bs.open++;
        const age = opp.ageInDays;
        if (age <= 3) bs.openByAge.within3++;
        else if (age <= 7) bs.openByAge.day4to7++;
        else bs.openByAge.over7++;
      }
      if (opp.stageName === '계약진행') bs.contractProgress++;
      if (opp.stageName === '출고진행') bs.shipmentProgress++;
      if (opp.stageName === '설치진행') bs.installProgress++;
    }

    // 견적 단계 분석
    if (opp.stageName === '견적') {
      quoteStageOpps.push({
        oppId,
        ...opp,
        boUser: userNameMap[opp.boUserId] || '(미배정)',
        fieldUser: userNameMap[opp.fieldUserId] || '(미배정)'
      });
    }
  });

  const boStats = Object.entries(boUserStats)
    .map(([userId, stats]) => {
      const processed = stats.cw + stats.cl;
      const netChange = stats.total - processed;
      const expectedCW = stats.contractProgress + stats.shipmentProgress + stats.installProgress;
      const expectedClose = stats.cw + expectedCW;
      const expectedCloseRate = stats.total > 0 ? Math.round(expectedClose / stats.total * 100) : 0;

      // 워크로드 상태 판정
      let workloadStatus = '🟢 양호';
      if (netChange >= 20) workloadStatus = '🔴 과부하';
      else if (netChange >= 10) workloadStatus = '🟡 누적중';

      return {
        userId,
        name: stats.name,
        total: stats.total,
        cw: stats.cw,
        cl: stats.cl,
        open: stats.open,
        processed,
        netChange,
        workloadStatus,
        openByAge: stats.openByAge,
        contractProgress: stats.contractProgress,
        shipmentProgress: stats.shipmentProgress,
        installProgress: stats.installProgress,
        expectedCW,
        expectedClose,
        expectedCloseRate,
        cwRate: stats.total > 0 ? Math.round(stats.cw / stats.total * 100) : 0,
        clRate: stats.total > 0 ? Math.round(stats.cl / stats.total * 100) : 0
      };
    })
    .sort((a, b) => b.total - a.total);

  // 견적 단계 현황
  const quoteStageWithQuote = quoteStageOpps.filter(o => o.hasQuote);
  const quoteStageNoQuote = quoteStageOpps.filter(o => !o.hasQuote);
  const stale8plus = quoteStageWithQuote.filter(o => o.daysSinceLastTask >= 8);
  const stale4to7 = quoteStageWithQuote.filter(o => o.daysSinceLastTask >= 4 && o.daysSinceLastTask < 8);

  // BO별 견적 관리 현황
  const boQuoteStats = {};
  quoteStageOpps.forEach(o => {
    const bo = o.boUser;
    if (!boQuoteStats[bo]) boQuoteStats[bo] = { total: 0, withQuote: 0, stale8plus: 0, preOpen: 0, normal: 0 };
    boQuoteStats[bo].total++;
    if (o.isPreOpen) boQuoteStats[bo].preOpen++;
    else boQuoteStats[bo].normal++;
    if (o.hasQuote) {
      boQuoteStats[bo].withQuote++;
      if (o.daysSinceLastTask >= 8) boQuoteStats[bo].stale8plus++;
    }
  });

  // Contract 통계 (당월/이월, 신규/추가설치, 오픈전/영업중, LeadTime 포함)
  const contractStats = {
    total: contracts?.length || 0,
    byStatus: {},
    byRecordType: { '신규': 0, '추가설치': 0 },
    byBO: {},
    byField: {},
    byOrigin: { current: 0, carryOver: 0 },
    byOriginMonth: {},
    byBODetailed: {},  // BO별 상세 (신규/추가설치, 당월/이월, 오픈전/영업중, leadTime)
    leadTime: { current: [], carryOver: [] },  // LeadTime 배열 (당월/이월 분리)
    byCompanyStatus: { '오픈전': 0, '영업중': 0, '기타': 0 }
  };

  if (contracts && contracts.length > 0) {
    contracts.forEach(c => {
      const status = c.ContractStatus__c || '(없음)';
      contractStats.byStatus[status] = (contractStats.byStatus[status] || 0) + 1;

      const recordType = c.Opportunity__r?.RecordType?.Name || '';
      const isNew = recordType.includes('신규');
      const isAdditional = recordType.includes('추가설치');
      if (isAdditional) contractStats.byRecordType['추가설치']++;
      else if (isNew) contractStats.byRecordType['신규']++;

      const boName = c.Opportunity__r?.BOUser__r?.Name || '(미배정)';
      contractStats.byBO[boName] = (contractStats.byBO[boName] || 0) + 1;

      const fieldName = c.Opportunity__r?.FieldUser__r?.Name || '(미배정)';
      contractStats.byField[fieldName] = (contractStats.byField[fieldName] || 0) + 1;

      // 매장 상태 (값: '영업중', '오픈전')
      const companyStatus = c.Opportunity__r?.fm_CompanyStatus__c || '';
      const isPreOpen = companyStatus === '오픈전';
      const isOperating = companyStatus === '영업중';
      if (isPreOpen) contractStats.byCompanyStatus['오픈전']++;
      else if (isOperating) contractStats.byCompanyStatus['영업중']++;
      else contractStats.byCompanyStatus['기타']++;

      // 당월/이월 구분: Opp 생성일 기준
      const oppCreated = c.Opportunity__r?.CreatedDate;
      const oppMonth = oppCreated ? oppCreated.slice(0, 7) : null;
      const targetMonth = startDate.slice(0, 7);
      const isCurrent = oppMonth === targetMonth;

      if (oppMonth) {
        contractStats.byOriginMonth[oppMonth] = (contractStats.byOriginMonth[oppMonth] || 0) + 1;
        if (isCurrent) contractStats.byOrigin.current++;
        else contractStats.byOrigin.carryOver++;
      }

      // LeadTime 계산 (Opp 생성일 → 계약 시작일)
      let leadTimeDays = null;
      if (oppCreated && c.ContractDateStart__c) {
        const oppDate = new Date(oppCreated);
        const contractDate = new Date(c.ContractDateStart__c);
        leadTimeDays = Math.round((contractDate - oppDate) / (1000 * 60 * 60 * 24));
        if (leadTimeDays >= 0) {
          if (isCurrent) contractStats.leadTime.current.push(leadTimeDays);
          else contractStats.leadTime.carryOver.push(leadTimeDays);
        }
      }

      // Opportunity Task 리터치 분석
      const oppId = c.Opportunity__c;
      const tasks = oppTaskMap[oppId] || [];
      let taskCount = tasks.length;
      let maxGapDays = 0;
      let avgGapDays = null;
      let missedCount = 0;

      if (tasks.length > 0 && oppCreated) {
        // 간격 계산: Opp 생성일 → 첫 Task, Task 간 간격, 마지막 Task → 계약일
        const dates = [new Date(oppCreated), ...tasks.map(t => new Date(t.createdDate))];
        if (c.ContractDateStart__c) dates.push(new Date(c.ContractDateStart__c));
        const gaps = [];
        for (let i = 1; i < dates.length; i++) {
          const gap = Math.round((dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24));
          if (gap >= 0) gaps.push(gap);
        }
        if (gaps.length > 0) {
          maxGapDays = Math.max(...gaps);
          avgGapDays = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length * 10) / 10;
        }
        missedCount = tasks.filter(t => t.subject && t.subject.includes('부재')).length;
      }

      // BO 담당자별 상세
      if (!contractStats.byBODetailed[boName]) {
        contractStats.byBODetailed[boName] = {
          total: 0, current: 0, carryOver: 0,
          신규: 0, 추가설치: 0,
          오픈전: 0, 영업중: 0,
          leadTimes: [], cwRate: 0,
          retouchGaps: [], maxGaps: [], taskCounts: []
        };
      }
      const bd = contractStats.byBODetailed[boName];
      bd.total++;
      if (isCurrent) bd.current++;
      else bd.carryOver++;
      if (isNew) bd['신규']++;
      if (isAdditional) bd['추가설치']++;
      if (isPreOpen) bd['오픈전']++;
      else if (isOperating) bd['영업중']++;
      if (leadTimeDays !== null && leadTimeDays >= 0) bd.leadTimes.push(leadTimeDays);
      if (avgGapDays !== null) bd.retouchGaps.push(avgGapDays);
      bd.maxGaps.push(maxGapDays);
      bd.taskCounts.push(taskCount);

      // 전체 리터치 통계 수집
      if (!contractStats._retouchRaw) contractStats._retouchRaw = [];
      contractStats._retouchRaw.push({
        leadTimeDays, taskCount, avgGapDays, maxGapDays, missedCount, isCurrent, boName
      });
    });
  }

  // LeadTime 요약 계산
  const calcLeadTimeSummary = (days) => {
    if (!days.length) return { avg: 0, count: 0, buckets: {} };
    const avg = Math.round(days.reduce((s, d) => s + d, 0) / days.length * 10) / 10;
    const buckets = { '0~7일': 0, '8~14일': 0, '15~30일': 0, '30일+': 0 };
    days.forEach(d => {
      if (d <= 7) buckets['0~7일']++;
      else if (d <= 14) buckets['8~14일']++;
      else if (d <= 30) buckets['15~30일']++;
      else buckets['30일+']++;
    });
    return { avg, count: days.length, buckets };
  };
  contractStats.leadTimeSummary = {
    current: calcLeadTimeSummary(contractStats.leadTime.current),
    carryOver: calcLeadTimeSummary(contractStats.leadTime.carryOver)
  };
  // leadTime 원본 배열은 전송하지 않음 (용량 절약)
  delete contractStats.leadTime;

  // BO별 평균 leadTime + 리터치 통계 계산
  Object.values(contractStats.byBODetailed).forEach(bd => {
    bd.avgLeadTime = bd.leadTimes.length > 0
      ? Math.round(bd.leadTimes.reduce((s, d) => s + d, 0) / bd.leadTimes.length * 10) / 10
      : null;
    bd.avgRetouchGap = bd.retouchGaps.length > 0
      ? Math.round(bd.retouchGaps.reduce((s, g) => s + g, 0) / bd.retouchGaps.length * 10) / 10
      : null;
    bd.avgMaxGap = bd.maxGaps.length > 0
      ? Math.round(bd.maxGaps.reduce((s, g) => s + g, 0) / bd.maxGaps.length * 10) / 10
      : null;
    bd.avgTaskCount = bd.taskCounts.length > 0
      ? Math.round(bd.taskCounts.reduce((s, c) => s + c, 0) / bd.taskCounts.length * 10) / 10
      : 0;
    // 7일+ 방치 비율 (maxGap >= 7인 건수)
    bd.neglectedCount = bd.maxGaps.filter(g => g >= 7).length;
    bd.neglectedRate = bd.total > 0 ? Math.round(bd.neglectedCount / bd.total * 100) : 0;
    delete bd.leadTimes;
    delete bd.retouchGaps;
    delete bd.maxGaps;
    delete bd.taskCounts;
  });

  // 리터치 vs LeadTime 상관관계
  const retouchRaw = contractStats._retouchRaw || [];
  const retouchAnalysis = {
    // 리터치 간격별 평균 LeadTime
    byRetouchGap: (() => {
      const buckets = { '2일 이내': [], '3~5일': [], '6~7일': [], '8일+': [] };
      retouchRaw.forEach(r => {
        if (r.avgGapDays === null) return;
        if (r.avgGapDays <= 2) buckets['2일 이내'].push(r.leadTimeDays);
        else if (r.avgGapDays <= 5) buckets['3~5일'].push(r.leadTimeDays);
        else if (r.avgGapDays <= 7) buckets['6~7일'].push(r.leadTimeDays);
        else buckets['8일+'].push(r.leadTimeDays);
      });
      return Object.entries(buckets).map(([gap, lts]) => ({
        gap,
        count: lts.length,
        avgLeadTime: lts.length > 0 ? Math.round(lts.reduce((s, d) => s + d, 0) / lts.length * 10) / 10 : 0
      }));
    })(),
    // Task 횟수별 평균 LeadTime
    byTaskCount: (() => {
      const buckets = { '0회': [], '1~2회': [], '3~5회': [], '6회+': [] };
      retouchRaw.forEach(r => {
        if (r.leadTimeDays === null) return;
        if (r.taskCount === 0) buckets['0회'].push(r.leadTimeDays);
        else if (r.taskCount <= 2) buckets['1~2회'].push(r.leadTimeDays);
        else if (r.taskCount <= 5) buckets['3~5회'].push(r.leadTimeDays);
        else buckets['6회+'].push(r.leadTimeDays);
      });
      return Object.entries(buckets).map(([tc, lts]) => ({
        taskCount: tc,
        count: lts.length,
        avgLeadTime: lts.length > 0 ? Math.round(lts.reduce((s, d) => s + d, 0) / lts.length * 10) / 10 : 0
      }));
    })(),
    // 전체 요약
    summary: {
      totalWithTask: retouchRaw.filter(r => r.taskCount > 0).length,
      totalNoTask: retouchRaw.filter(r => r.taskCount === 0).length,
      avgTaskCount: retouchRaw.length > 0
        ? Math.round(retouchRaw.reduce((s, r) => s + r.taskCount, 0) / retouchRaw.length * 10) / 10
        : 0,
      neglected7plus: retouchRaw.filter(r => r.maxGapDays >= 7).length
    }
  };
  contractStats.retouchAnalysis = retouchAnalysis;
  delete contractStats._retouchRaw;

  // SQL 생산 vs CW 추이 (일별 흐름 + 예측)
  const sqlCwFlow = (() => {
    const dailySql = {};  // 날짜별 SQL(Opp) 생성 건수
    const dailyCw = {};   // 날짜별 CW(계약) 건수
    const dailyCwCurrent = {};  // 당월 Opp → CW
    const dailyCwCarryOver = {};  // 이월 Opp → CW
    const dailyCwAdditional = {};  // 추가설치 CW
    const targetMonth = startDate.slice(0, 7);
    let totalCurrent = 0, totalCarryOver = 0, totalAdditional = 0;

    // 모든 Opportunity의 생성일 집계 (BO 배정 기준)
    Object.values(oppDataMap).forEach(opp => {
      if (!opp.boUserId) return;  // BO 배정된 건만
      const day = opp.createdDate?.slice(0, 10);
      if (day) dailySql[day] = (dailySql[day] || 0) + 1;
    });

    // Contract의 CW 날짜 집계 (당월/이월/추가설치 구분)
    if (contracts && contracts.length > 0) {
      contracts.forEach(c => {
        const day = c.ContractDateStart__c;
        if (!day) return;
        dailyCw[day] = (dailyCw[day] || 0) + 1;

        // 당월 vs 이월
        const oppCreated = c.Opportunity__r?.CreatedDate;
        const oppMonth = oppCreated ? oppCreated.slice(0, 7) : null;
        const isCurrent = oppMonth === targetMonth;
        if (isCurrent) {
          dailyCwCurrent[day] = (dailyCwCurrent[day] || 0) + 1;
          totalCurrent++;
        } else {
          dailyCwCarryOver[day] = (dailyCwCarryOver[day] || 0) + 1;
          totalCarryOver++;
        }

        // 추가설치
        const recordType = c.Opportunity__r?.RecordType?.Name || '';
        if (recordType.includes('추가설치')) {
          dailyCwAdditional[day] = (dailyCwAdditional[day] || 0) + 1;
          totalAdditional++;
        }
      });
    }

    // 날짜 범위 생성 (startDate ~ endDate + 14일 예측)
    const allDates = new Set([...Object.keys(dailySql), ...Object.keys(dailyCw)]);
    const sd = new Date(startDate);
    const ed = new Date(endDate);
    const predEnd = new Date(ed);
    predEnd.setDate(predEnd.getDate() + 14);  // 2주 예측

    for (let d = new Date(sd); d <= predEnd; d.setDate(d.getDate() + 1)) {
      allDates.add(d.toISOString().slice(0, 10));
    }

    const sortedDates = [...allDates].sort();

    // 평균 LeadTime (당월 기준)
    const avgLT = contractStats.leadTimeSummary?.current?.avg || 7;

    // 예측 CW: SQL 생성일 + avgLeadTime 일 후에 CW 될 것으로 예측
    const predictedCw = {};
    Object.entries(dailySql).forEach(([day, count]) => {
      const predDate = new Date(day);
      predDate.setDate(predDate.getDate() + Math.round(avgLT));
      const predDay = predDate.toISOString().slice(0, 10);
      predictedCw[predDay] = (predictedCw[predDay] || 0) + count;
    });

    // 일별 데이터 조합
    const daily = sortedDates
      .filter(d => d >= startDate && d <= predEnd.toISOString().slice(0, 10))
      .map(date => ({
        date: date.slice(5),  // MM-DD
        fullDate: date,
        sql: dailySql[date] || 0,
        cw: dailyCw[date] || 0,
        cwCurrent: dailyCwCurrent[date] || 0,
        cwCarryOver: dailyCwCarryOver[date] || 0,
        cwAdditional: dailyCwAdditional[date] || 0,
        predictedCw: predictedCw[date] || 0,
        isPrediction: date > endDate
      }));

    // 누적 집계
    let cumSql = 0, cumCw = 0, cumCwCurrent = 0, cumCwCarryOver = 0;
    daily.forEach(d => {
      if (!d.isPrediction) {
        cumSql += d.sql;
        cumCw += d.cw;
        cumCwCurrent += d.cwCurrent || 0;
        cumCwCarryOver += d.cwCarryOver || 0;
      }
      d.cumSql = cumSql;
      d.cumCw = cumCw;
      d.cumCwCurrent = cumCwCurrent;
      d.cumCwCarryOver = cumCwCarryOver;
    });

    // 바쁜 날 예측 (이번달 SQL 기준으로 향후 CW 집중일)
    const busyDays = Object.entries(predictedCw)
      .filter(([day]) => day > endDate)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([day, count]) => ({ date: day, predicted: count }));

    return {
      daily,
      avgLeadTime: avgLT,
      totalSql: cumSql,
      totalCw: cumCw,
      totalCwCurrent: totalCurrent,
      totalCwCarryOver: totalCarryOver,
      totalCwAdditional: totalAdditional,
      busyDays
    };
  })();
  contractStats.sqlCwFlow = sqlCwFlow;

  // ========== FRT 구간별 통계 ==========
  const FRT_BUCKET_ORDER = ['10분 이내', '10~20분', '20~30분', '30~60분', '1~2시간', '2시간 초과', 'NO_TASK'];
  const frtBucketAgg = {};
  FRT_BUCKET_ORDER.forEach(b => { frtBucketAgg[b] = { count: 0, converted: 0, wrongEntry: 0 }; });
  leadData.forEach(l => {
    const bucket = l.frtBucket;
    if (frtBucketAgg[bucket]) {
      frtBucketAgg[bucket].count++;
      if (l.isCW) frtBucketAgg[bucket].converted++;
      if (l.isWrongEntry) frtBucketAgg[bucket].wrongEntry++;
    }
  });
  const frtBuckets = FRT_BUCKET_ORDER
    .map(bucket => ({
      bucket,
      count: frtBucketAgg[bucket].count,
      converted: frtBucketAgg[bucket].converted,
      conversionRate: frtBucketAgg[bucket].count > 0 ? Math.round(frtBucketAgg[bucket].converted / frtBucketAgg[bucket].count * 100) : 0,
      wrongEntry: frtBucketAgg[bucket].wrongEntry,
      wrongEntryRate: frtBucketAgg[bucket].count > 0 ? Math.round(frtBucketAgg[bucket].wrongEntry / frtBucketAgg[bucket].count * 100) : 0,
    }))
    .filter(b => b.count > 0);

  // ========== 시간대별 FRT 상세 통계 ==========
  const timeSlotDetail = {};
  ['BUSINESS_HOUR', 'OFF_HOUR', 'WEEKEND'].forEach(slot => {
    const slotLeads = leadData.filter(l => l.timeSlot === slot);
    const slotMQL = slotLeads.filter(l => l.isMQL);
    const slotWithTask = slotLeads.filter(l => l.hasTask);
    const slotFrtOk = slotLeads.filter(l => l.frtOk);
    const slotCW = slotLeads.filter(l => l.isCW);
    const slotWrongEntry = slotLeads.filter(l => l.isWrongEntry);
    const slotFrtValues = slotLeads.filter(l => l.frtMinutes !== null).map(l => l.frtMinutes);
    const slotAvgFRT = slotFrtValues.length > 0 ? Math.round(slotFrtValues.reduce((a, b) => a + b, 0) / slotFrtValues.length * 10) / 10 : null;

    timeSlotDetail[slot] = {
      total: slotLeads.length,
      mql: slotMQL.length,
      withTask: slotWithTask.length,
      frtOk: slotFrtOk.length,
      frtRate: slotWithTask.length > 0 ? Math.round(slotFrtOk.length / slotWithTask.length * 100) : 0,
      avgFRT: slotAvgFRT,
      converted: slotCW.length,
      conversionRate: slotMQL.length > 0 ? Math.round(slotCW.length / slotMQL.length * 100) : 0,
      wrongEntry: slotWrongEntry.length,
      wrongEntryRate: slotLeads.length > 0 ? Math.round(slotWrongEntry.length / slotLeads.length * 100) : 0
    };
  });

  // ========== 오인입 사유 분석 ==========
  const wrongEntryReasons = {};
  leadData.filter(l => l.isWrongEntry).forEach(l => {
    const reason = l.lossReasonContract || '(사유 미입력)';
    wrongEntryReasons[reason] = (wrongEntryReasons[reason] || 0) + 1;
  });
  const wrongEntryByReason = Object.entries(wrongEntryReasons)
    .map(([reason, count]) => ({
      reason,
      count,
      rate: wrongEntry.length > 0 ? Math.round(count / wrongEntry.length * 100) : 0
    }))
    .sort((a, b) => b.count - a.count);

  // ========== FRT ↔ 오인입 상관관계 분석 ==========
  const frtWrongEntryCorrelation = (() => {
    // Pearson 상관계수 계산
    function pearsonR(x, y) {
      const n = x.length;
      if (n < 3) return { r: null, pValue: null, n };
      const sumX = x.reduce((a, b) => a + b, 0);
      const sumY = y.reduce((a, b) => a + b, 0);
      const sumXY = x.reduce((s, xi, i) => s + xi * y[i], 0);
      const sumX2 = x.reduce((s, xi) => s + xi * xi, 0);
      const sumY2 = y.reduce((s, yi) => s + yi * yi, 0);
      const num = n * sumXY - sumX * sumY;
      const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
      if (den === 0) return { r: 0, pValue: 1, n };
      const r = num / den;
      // t-statistic & approximate p-value (normal approximation)
      const rSq = Math.min(r * r, 0.9999);
      const t = r * Math.sqrt((n - 2) / (1 - rSq));
      const absT = Math.abs(t);
      const k = 1 / (1 + 0.2316419 * absT);
      const cdf = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-absT * absT / 2) *
        (0.319381530 * k - 0.356563782 * k * k + 1.781477937 * k * k * k - 1.821255978 * k * k * k * k + 1.330274429 * k * k * k * k * k);
      const pValue = 2 * (1 - cdf);
      return { r: Math.round(r * 1000) / 1000, pValue: Math.round(pValue * 10000) / 10000, n };
    }

    // 선형 회귀
    function linReg(x, y) {
      const n = x.length;
      if (n < 2) return { slope: 0, intercept: 0 };
      const sx = x.reduce((a, b) => a + b, 0);
      const sy = y.reduce((a, b) => a + b, 0);
      const sxy = x.reduce((s, xi, i) => s + xi * y[i], 0);
      const sx2 = x.reduce((s, xi) => s + xi * xi, 0);
      const denom = n * sx2 - sx * sx;
      if (denom === 0) return { slope: 0, intercept: sy / n };
      const slope = (n * sxy - sx * sy) / denom;
      const intercept = (sy - slope * sx) / n;
      return { slope: Math.round(slope * 1000) / 1000, intercept: Math.round(intercept * 100) / 100 };
    }

    // 일별 데이터 (Lead 3건 이상, Task 있는 날만)
    const validDays = dailyStats.filter(d => d.withTask > 0 && d.total >= 3);
    const frtRates = validDays.map(d => d.frtRate);
    const weRates = validDays.map(d => d.wrongEntryRate);

    // 동일일 상관관계
    const sameDay = pearsonR(frtRates, weRates);
    const regression = linReg(frtRates, weRates);

    // 래그 분석 (전일 FRT → 익일 오인입)
    const lag1 = pearsonR(frtRates.slice(0, -1), weRates.slice(1));
    const lag2 = pearsonR(frtRates.slice(0, -2), weRates.slice(2));

    // 산점도 데이터
    const scatterData = validDays.map(d => ({
      date: d.date,
      frtRate: d.frtRate,
      wrongEntryRate: d.wrongEntryRate,
      total: d.total,
    }));

    // FRT 구간별 오인입율 요약
    const bucketWrongEntry = frtBuckets
      .filter(b => b.bucket !== 'NO_TASK')
      .map(b => ({
        bucket: b.bucket,
        count: b.count,
        wrongEntry: b.wrongEntry,
        wrongEntryRate: b.wrongEntryRate,
      }));

    // FRT OK vs Fail 오인입 비교 (개별 Lead 단위)
    const leadsWithTaskAll = leadData.filter(l => l.hasTask);
    const frtOkWE = leadsWithTaskAll.filter(l => l.frtOk && l.isWrongEntry).length;
    const frtOkTotal = leadsWithTaskAll.filter(l => l.frtOk).length;
    const frtFailWE = leadsWithTaskAll.filter(l => !l.frtOk && l.isWrongEntry).length;
    const frtFailTotal = leadsWithTaskAll.filter(l => !l.frtOk).length;
    const frtOkWERate = frtOkTotal > 0 ? Math.round(frtOkWE / frtOkTotal * 1000) / 10 : 0;
    const frtFailWERate = frtFailTotal > 0 ? Math.round(frtFailWE / frtFailTotal * 1000) / 10 : 0;

    // 담당자별 FRT ↔ 오인입 관계
    const ownerCorrelation = tmStats.map(tm => ({
      ownerName: tm.ownerName,
      total: tm.total,
      frtRate: tm.frtRate,
      wrongEntryRate: tm.wrongEntryRate,
      frtOk: tm.frtOk,
      wrongEntry: tm.wrongEntry,
    }));

    // 해석 생성
    let interpretation = '';
    if (sameDay.r !== null) {
      const absR = Math.abs(sameDay.r);
      const direction = sameDay.r < 0 ? '음의' : '양의';
      const significant = sameDay.pValue !== null && sameDay.pValue < 0.05;
      if (absR >= 0.4) {
        interpretation = `FRT 준수율과 오인입율 사이에 ${direction} 상관관계(r=${sameDay.r})가 있습니다.${significant ? ' (통계적으로 유의미, p<0.05)' : ''} FRT 준수율이 낮은 날 오인입이 증가하는 경향이 관측됩니다.`;
      } else if (absR >= 0.2) {
        interpretation = `FRT 준수율과 오인입율 사이에 약한 ${direction} 상관관계(r=${sameDay.r})가 있습니다.${significant ? ' (통계적으로 유의미)' : ''} 일부 관련성이 관측되나 다른 요인의 영향도 큽니다.`;
      } else {
        interpretation = `일별 데이터 기준 FRT 준수율과 오인입율의 직접적 상관관계는 약합니다(r=${sameDay.r}). 개별 Lead 단위 또는 FRT 구간별 분석이 더 의미있을 수 있습니다.`;
      }
    } else {
      interpretation = '분석 가능한 일별 데이터가 부족합니다.';
    }

    // FRT OK/Fail 비교 결과 추가
    if (frtFailWERate > frtOkWERate) {
      interpretation += ` 개별 Lead 기준, FRT 미준수 Lead의 오인입율(${frtFailWERate}%)이 준수 Lead(${frtOkWERate}%)보다 ${Math.round((frtFailWERate - frtOkWERate) * 10) / 10}%p 높습니다.`;
    }

    return {
      correlation: { sameDay, lag1Day: lag1, lag2Day: lag2 },
      regression,
      scatterData,
      bucketWrongEntry,
      ownerCorrelation,
      frtOkVsFail: {
        frtOk: { total: frtOkTotal, wrongEntry: frtOkWE, wrongEntryRate: frtOkWERate },
        frtFail: { total: frtFailTotal, wrongEntry: frtFailWE, wrongEntryRate: frtFailWERate },
      },
      interpretation,
      summary: {
        totalDays: validDays.length,
        avgFrtRate: validDays.length > 0 ? Math.round(frtRates.reduce((a, b) => a + b, 0) / frtRates.length) : 0,
        avgWrongEntryRate: validDays.length > 0 ? Math.round(weRates.reduce((a, b) => a + b, 0) / weRates.length * 10) / 10 : 0,
      },
    };
  })();

  // ========== Task 패턴 분석 (부재중 vs 실통화 구분) ==========
  const taskPatternAnalysis = (() => {
    // 오인입 제외, Task 있는 Lead만
    const targetLeads = leadData.filter(l => !l.isWrongEntry && l.hasTask);

    // 전체 부재중 비율
    const totalTasks = targetLeads.reduce((s, l) => s + l.taskCount, 0);
    const totalMissed = targetLeads.reduce((s, l) => s + l.missedCount, 0);
    const totalConnected = totalTasks - totalMissed;
    const missedRate = totalTasks > 0 ? Math.round(totalMissed / totalTasks * 100) : 0;

    // 실통화 횟수 구간별 전환율 (부재중 제외한 실제 연결 횟수 기준)
    const connBuckets = { '0회 (부재만)': [], '1회': [], '2회': [], '3회+': [] };
    targetLeads.forEach(l => {
      if (l.connectedCount === 0) connBuckets['0회 (부재만)'].push(l);
      else if (l.connectedCount === 1) connBuckets['1회'].push(l);
      else if (l.connectedCount === 2) connBuckets['2회'].push(l);
      else connBuckets['3회+'].push(l);
    });

    const byConnectedCount = Object.entries(connBuckets)
      .filter(([, arr]) => arr.length > 0)
      .map(([bucket, arr]) => ({
        bucket,
        count: arr.length,
        mql: arr.filter(l => l.isMQL).length,
        mqlRate: arr.length > 0 ? Math.round(arr.filter(l => l.isMQL).length / arr.length * 100) : 0,
        cw: arr.filter(l => l.isCW).length,
        cwRate: arr.length > 0 ? Math.round(arr.filter(l => l.isCW).length / arr.length * 100) : 0,
        avgTotalTasks: arr.length > 0 ? Math.round(arr.reduce((s, l) => s + l.taskCount, 0) / arr.length * 10) / 10 : 0,
        avgMissed: arr.length > 0 ? Math.round(arr.reduce((s, l) => s + l.missedCount, 0) / arr.length * 10) / 10 : 0,
      }));

    // 전체 Task 횟수 구간별 (기존 유지)
    const taskBuckets = { '1회': [], '2회': [], '3회': [], '4~5회': [], '6회+': [] };
    targetLeads.forEach(l => {
      if (l.taskCount === 1) taskBuckets['1회'].push(l);
      else if (l.taskCount === 2) taskBuckets['2회'].push(l);
      else if (l.taskCount === 3) taskBuckets['3회'].push(l);
      else if (l.taskCount <= 5) taskBuckets['4~5회'].push(l);
      else taskBuckets['6회+'].push(l);
    });

    const byTaskCount = Object.entries(taskBuckets)
      .filter(([, arr]) => arr.length > 0)
      .map(([bucket, arr]) => ({
        bucket,
        count: arr.length,
        mqlRate: arr.length > 0 ? Math.round(arr.filter(l => l.isMQL).length / arr.length * 100) : 0,
        cwRate: arr.length > 0 ? Math.round(arr.filter(l => l.isCW).length / arr.length * 100) : 0,
        avgMissedRate: (() => {
          const rates = arr.filter(l => l.taskCount > 0).map(l => l.missedCount / l.taskCount * 100);
          return rates.length > 0 ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : 0;
        })(),
      }));

    // CW vs non-CW 비교
    const mqlWithTask = targetLeads.filter(l => l.isMQL);
    const cwGroup = mqlWithTask.filter(l => l.isCW);
    const nonCwGroup = mqlWithTask.filter(l => !l.isCW);

    const avg = (arr, fn) => arr.length > 0 ? Math.round(arr.reduce((s, l) => s + fn(l), 0) / arr.length * 10) / 10 : 0;
    const cwAvgTasks = avg(cwGroup, l => l.taskCount);
    const cwAvgConnected = avg(cwGroup, l => l.connectedCount);
    const cwAvgMissed = avg(cwGroup, l => l.missedCount);
    const nonCwAvgTasks = avg(nonCwGroup, l => l.taskCount);
    const nonCwAvgConnected = avg(nonCwGroup, l => l.connectedCount);
    const nonCwAvgMissed = avg(nonCwGroup, l => l.missedCount);
    const cwAvgGap = (() => {
      const gaps = cwGroup.filter(l => l.avgTaskGapDays !== null).map(l => l.avgTaskGapDays);
      return gaps.length > 0 ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length * 10) / 10 : null;
    })();
    const nonCwAvgGap = (() => {
      const gaps = nonCwGroup.filter(l => l.avgTaskGapDays !== null).map(l => l.avgTaskGapDays);
      return gaps.length > 0 ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length * 10) / 10 : null;
    })();

    // 해석 생성
    let interpretation = `전체 Task 중 부재중 비율: ${missedRate}% (${totalMissed}/${totalTasks}건).`;
    if (cwAvgConnected > 0) {
      interpretation += ` CW Lead는 실통화 ${cwAvgConnected}회 + 부재 ${cwAvgMissed}회, 미전환은 실통화 ${nonCwAvgConnected}회 + 부재 ${nonCwAvgMissed}회.`;
    }
    if (cwAvgGap !== null && nonCwAvgGap !== null && cwAvgGap !== nonCwAvgGap) {
      interpretation += ` 접촉 간격: CW ${cwAvgGap}일 vs 미전환 ${nonCwAvgGap}일.`;
    }

    return {
      missedSummary: { totalTasks, totalMissed, totalConnected, missedRate },
      byConnectedCount,
      byTaskCount,
      cwVsNonCw: {
        cw: { count: cwGroup.length, avgTasks: cwAvgTasks, avgConnected: cwAvgConnected, avgMissed: cwAvgMissed, avgGapDays: cwAvgGap },
        nonCw: { count: nonCwGroup.length, avgTasks: nonCwAvgTasks, avgConnected: nonCwAvgConnected, avgMissed: nonCwAvgMissed, avgGapDays: nonCwAvgGap },
      },
      interpretation,
    };
  })();

  // ========== 골든 타임 분석 (FRT → 전환율 Decay Curve) ==========
  const goldenTimeAnalysis = (() => {
    // Task가 있고 오인입이 아닌 Lead
    const targetLeads = leadData.filter(l => l.hasTask && !l.isWrongEntry);

    // 시간대 구간별 전환율
    const timeBuckets = [
      { label: '5분 이내', min: 0, max: 5 },
      { label: '5~10분', min: 5, max: 10 },
      { label: '10~20분', min: 10, max: 20 },
      { label: '20~30분', min: 20, max: 30 },
      { label: '30분~1시간', min: 30, max: 60 },
      { label: '1~2시간', min: 60, max: 120 },
      { label: '2~4시간', min: 120, max: 240 },
      { label: '4~8시간', min: 240, max: 480 },
      { label: '8~24시간', min: 480, max: 1440 },
      { label: '24시간+', min: 1440, max: Infinity },
    ];

    // 골든 타임은 오인입 포함 전체 Lead 대상으로
    const allLeadsWithTask = leadData.filter(l => l.hasTask);
    const decayCurve = timeBuckets.map(({ label, min, max }) => {
      const bucket = allLeadsWithTask.filter(l => l.frtMinutes >= min && l.frtMinutes < max);
      const nonWE = bucket.filter(l => !l.isWrongEntry);
      return {
        label,
        count: bucket.length,
        mql: nonWE.filter(l => l.isMQL).length,
        mqlRate: nonWE.length > 0 ? Math.round(nonWE.filter(l => l.isMQL).length / nonWE.length * 100) : 0,
        sql: nonWE.filter(l => l.isSQL).length,
        sqlRate: nonWE.length > 0 ? Math.round(nonWE.filter(l => l.isSQL).length / nonWE.length * 100) : 0,
        cw: nonWE.filter(l => l.isCW).length,
        cwRate: nonWE.length > 0 ? Math.round(nonWE.filter(l => l.isCW).length / nonWE.length * 100) : 0,
        wrongEntry: bucket.filter(l => l.isWrongEntry).length,
        wrongEntryRate: bucket.length > 0 ? Math.round(bucket.filter(l => l.isWrongEntry).length / bucket.length * 100) : 0,
      };
    }).filter(b => b.count > 0);

    // 누적 전환율 (N분 이내 응대 시)
    const cumulative = timeBuckets.map(({ label, min, max }) => {
      const within = targetLeads.filter(l => l.frtMinutes < max);
      return {
        label: `${label}까지`,
        count: within.length,
        mql: within.filter(l => l.isMQL).length,
        mqlRate: within.length > 0 ? Math.round(within.filter(l => l.isMQL).length / within.length * 100) : 0,
        cw: within.filter(l => l.isCW).length,
        cwRate: within.length > 0 ? Math.round(within.filter(l => l.isCW).length / within.length * 100) : 0,
      };
    }).filter(b => b.count > 0);

    // 해석 (오인입율 중심으로 - 더 의미있는 차이)
    const fast = allLeadsWithTask.filter(l => l.frtMinutes <= 10);
    const slow = allLeadsWithTask.filter(l => l.frtMinutes > 60);
    const fastWERate = fast.length > 0 ? Math.round(fast.filter(l => l.isWrongEntry).length / fast.length * 100) : 0;
    const slowWERate = slow.length > 0 ? Math.round(slow.filter(l => l.isWrongEntry).length / slow.length * 100) : 0;
    const fastMqlRate = fast.length > 0 ? Math.round(fast.filter(l => !l.isWrongEntry && l.isMQL).length / fast.filter(l => !l.isWrongEntry).length * 100) : 0;
    const slowMqlRate = slow.length > 0 ? Math.round(slow.filter(l => !l.isWrongEntry && l.isMQL).length / (slow.filter(l => !l.isWrongEntry).length || 1) * 100) : 0;
    let interpretation = '';
    if (fast.length > 0 && slow.length > 0) {
      const parts = [];
      if (fastWERate !== slowWERate) {
        parts.push(`10분 이내 응대 시 오인입율 ${fastWERate}%, 1시간 초과 시 ${slowWERate}%`);
      }
      if (fastMqlRate !== slowMqlRate) {
        parts.push(`MQL율은 ${fastMqlRate}% vs ${slowMqlRate}%`);
      }
      interpretation = parts.join('. ') + (parts.length > 0 ? '.' : '');
      if (!interpretation) {
        interpretation = `10분 이내 응대(${fast.length}건) vs 1시간 초과(${slow.length}건) 비교 분석입니다.`;
      }
    }

    return { decayCurve, cumulative, interpretation };
  })();

  // ========== Lead Source별 효율 분석 ==========
  const leadSourceAnalysis = (() => {
    const bySource = {};
    leadData.forEach(l => {
      const src = l.leadSource;
      if (!bySource[src]) {
        bySource[src] = {
          total: 0, mql: 0, sql: 0, cw: 0, wrongEntry: 0,
          frtValues: [], taskCounts: [],
        };
      }
      const s = bySource[src];
      s.total++;
      if (l.isMQL) s.mql++;
      if (l.isSQL) s.sql++;
      if (l.isCW) s.cw++;
      if (l.isWrongEntry) s.wrongEntry++;
      if (l.frtMinutes !== null) s.frtValues.push(l.frtMinutes);
      if (l.taskCount > 0) s.taskCounts.push(l.taskCount);
    });

    const sources = Object.entries(bySource)
      .map(([source, s]) => ({
        source,
        total: s.total,
        mql: s.mql,
        mqlRate: s.total > 0 ? Math.round(s.mql / s.total * 100) : 0,
        sql: s.sql,
        sqlRate: s.mql > 0 ? Math.round(s.sql / s.mql * 100) : 0,
        cw: s.cw,
        cwRate: s.total > 0 ? Math.round(s.cw / s.total * 100) : 0,
        wrongEntry: s.wrongEntry,
        wrongEntryRate: s.total > 0 ? Math.round(s.wrongEntry / s.total * 100) : 0,
        avgFRT: s.frtValues.length > 0 ? Math.round(s.frtValues.reduce((a, b) => a + b, 0) / s.frtValues.length) : null,
        avgTasks: s.taskCounts.length > 0 ? Math.round(s.taskCounts.reduce((a, b) => a + b, 0) / s.taskCounts.length * 10) / 10 : 0,
      }))
      .filter(s => s.total >= 3) // 3건 이상만
      .sort((a, b) => b.total - a.total);

    // 해석 (CW율 기준 - MQL율은 전화 등 구조적 편향 있음)
    let interpretation = '';
    if (sources.length > 0) {
      const withCW = sources.filter(s => s.cw > 0 && s.total >= 5);
      if (withCW.length > 0) {
        const bestCW = withCW.reduce((best, s) => s.cwRate > best.cwRate ? s : best, withCW[0]);
        interpretation = `실질 전환율(CW)이 가장 높은 소스는 "${bestCW.source}"(${bestCW.cwRate}%, ${bestCW.cw}건)입니다.`;
      }
      const highWE = sources.filter(s => s.wrongEntryRate >= 20 && s.total >= 10);
      if (highWE.length > 0) {
        interpretation += ` 오인입율이 높은 소스: ${highWE.map(s => `${s.source}(${s.wrongEntryRate}%)`).join(', ')}.`;
      }
    }

    return { sources, interpretation };
  })();

  return {
    period: { startDate, endDate },
    // 전체 요약
    summary: {
      total,
      mql: mqlLeads.length,
      sql: sqlLeads.length,
      visit: visitConverted.length,
      cw: cwLeads.length,
      wrongEntry: wrongEntry.length,
      mqlRate: total > 0 ? Math.round(mqlLeads.length / total * 100) : 0,
      sqlRate: mqlLeads.length > 0 ? Math.round(sqlLeads.length / mqlLeads.length * 100) : 0,
      visitRate: sqlLeads.length > 0 ? Math.round(visitConverted.length / sqlLeads.length * 100) : 0,
      cwRate: visitConverted.length > 0 ? Math.round(cwLeads.length / visitConverted.length * 100) : 0,
      wrongEntryRate: total > 0 ? Math.round(wrongEntry.length / total * 100) : 0
    },
    // FRT 현황
    frt: {
      avgFRT,
      withTask: withTask.length,
      frtOk: frtOk.length,
      frtRate: withTask.length > 0 ? Math.round(frtOk.length / withTask.length * 100) : 0
    },
    // Inside Sales (TM)
    insideSales: {
      tmStats,
      dailyStats,
      timeSlotStats: overallTimeSlot,
      frtBuckets,
      timeSlotDetail,
      wrongEntryByReason,
      frtCorrelation,
      frtWrongEntryCorrelation,
      taskPatternAnalysis,
      goldenTimeAnalysis,
      leadSourceAnalysis
    },
    // Inside Field (필드)
    insideField: {
      fieldStats,
      visitByWeek,
      visitByField: Object.entries(visitByField).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      // 전체 파이프라인 단계 요약
      stageSummary: (() => {
        const stages = {};
        fieldStats.forEach(f => {
          Object.entries(f.byStage).forEach(([stage, count]) => {
            stages[stage] = (stages[stage] || 0) + count;
          });
        });
        const stageOrder = ['방문배정', '견적', '재견적', '선납금', '계약진행', '출고진행', '설치진행', 'Closed Won', 'Closed Lost'];
        return stageOrder
          .filter(s => stages[s])
          .map(s => ({ stage: s, count: stages[s] }));
      })(),
      visitAnalysis,
      fieldRetouchAnalysis,
      postQuoteFieldRetouch,
    },
    // Inside Back Office (백오피스)
    insideBackOffice: {
      boStats,
      quoteStage: {
        total: quoteStageOpps.length,
        withQuote: quoteStageWithQuote.length,
        noQuote: quoteStageNoQuote.length,
        stale8plus: stale8plus.length,
        stale4to7: stale4to7.length
      },
      boQuoteStats: Object.entries(boQuoteStats).map(([name, stats]) => ({ name, ...stats })).sort((a, b) => b.total - a.total),
      contractStats,
      // 이번달 Opp 전체 기준 파이프라인 칸반
      pipelineKanban: (() => {
        const stageOrder = ['방문배정', '견적', '재견적', '선납금', '계약진행', '출고진행', '설치진행', 'Closed Won', 'Closed Lost'];
        const stages = {};
        const byBO = {};
        stageOrder.forEach(s => { stages[s] = 0; });

        allOpportunities.forEach(opp => {
          const stage = opp.StageName || '기타';
          if (stages[stage] !== undefined) {
            stages[stage]++;
          } else {
            stages[stage] = 1;
          }
          // BO별 집계
          const boName = opp.BOUser__r?.Name || '(미배정)';
          if (!byBO[boName]) {
            byBO[boName] = {};
            stageOrder.forEach(s => { byBO[boName][s] = 0; });
          }
          if (byBO[boName][stage] !== undefined) {
            byBO[boName][stage]++;
          }
        });

        return {
          stageOrder,
          stages,
          byBO,
          total: allOpportunities.length
        };
      })()
    },
    // 기존 호환성 유지
    ownerStats: tmStats,
    dailyStats
  };
}

/**
 * 리포트 생성 (메인 함수)
 */
async function generateReport(mode, customStart = null, customEnd = null) {
  const { startDate, endDate, periodLabel } = getDateRange(mode, customStart, customEnd);

  console.log(`📊 인바운드 세일즈 리포트 생성: ${periodLabel}`);

  const data = await collectData(startDate, endDate);
  const stats = calculateStats(data);

  return {
    ...stats,
    periodLabel,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  generateReport,
  collectData,
  calculateStats
};
