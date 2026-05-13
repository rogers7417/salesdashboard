const axios = require('axios');

const API_VERSION = process.env.SF_API_VERSION || 'v58.0';

const esc = (value) => String(value ?? '').replace(/'/g, "\\'");

async function queryAll(instanceUrl, accessToken, soql) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  let url = `${instanceUrl}/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`;
  let response = await axios.get(url, { headers, timeout: 30000 });
  const records = [...response.data.records];

  while (!response.data.done && response.data.nextRecordsUrl) {
    url = `${instanceUrl}${response.data.nextRecordsUrl}`;
    response = await axios.get(url, { headers, timeout: 30000 });
    records.push(...response.data.records);
  }

  return records;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parsePositiveInt(raw, fallback, { min = 1, max = 1000 } = {}) {
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n >= min && n <= max) return n;
  return fallback;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let idx = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      results[i] = await mapper(items[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}

function buildClosedLostOppSoql(startIso, endIso) {
  return `
    SELECT
      Id,
      Name,
      CreatedDate,
      AccountId,
      Account.Name,
      LeadSource,
      LastStageChangeDate,
      fm_Department__c,
      ChurnCompetitor__c,
      Loss_Reason__c,
      Loss_Reason_Oppt__c,
      Loss_Reason_Oppt_2depth__c,
      Loss_Reason_Oppt_3depth__c,
      Loss_Reason_Detail__c
    FROM Opportunity
    WHERE StageName = 'Closed Lost'
      AND LastStageChangeDate >= ${startIso}
      AND LastStageChangeDate <  ${endIso}
    ORDER BY LastStageChangeDate DESC
  `.trim();
}

function buildCaseSoql(accountId, limit) {
  return `
    SELECT
      AccountId,
      CreatedDate,
      Id,
      Type,
      Type2__c,
      Type3__c,
      Description__c,
      CaseLeadtime__c
    FROM Case
    WHERE AccountId = '${esc(accountId)}'
    ORDER BY CreatedDate DESC
    LIMIT ${limit}
  `.trim();
}

async function fetchTasksForOppIds(instanceUrl, accessToken, oppIds) {
  if (!oppIds?.length) return [];
  const tasks = [];
  const batchSize = 200;
  for (const batch of chunk(oppIds, batchSize)) {
    const list = batch.map((id) => `'${esc(id)}'`).join(',');
    const soql = `
      SELECT
        Id,
        WhatId,
        Subject,
        Status,
        ActivityDate,
        CreatedDate,
        Description,
        CallDisposition,
        CallDurationInSeconds,
        CallType,
        OwnerId,
        Owner.Name,
        Priority
      FROM Task
      WHERE WhatId IN (${list})
      ORDER BY CreatedDate DESC
    `;
    const rows = await queryAll(instanceUrl, accessToken, soql);
    tasks.push(...rows);
  }
  return tasks;
}

async function fetchClosedLostGrid({ token, startDate, endDate, options = {} }) {
  const startIso = `${startDate}T00:00:00Z`;
  const endIsoDate = new Date(`${endDate}T00:00:00Z`);
  endIsoDate.setUTCDate(endIsoDate.getUTCDate() + 1);
  const endIso = endIsoDate.toISOString().replace('.000Z', 'Z');

  const caseLimit = parsePositiveInt(options.caseLimit, 10, { min: 1, max: 200 });
  const concurrency = parsePositiveInt(options.concurrency, 6, { min: 1, max: 32 });
  const taskLimit = parsePositiveInt(options.taskLimit, 10, { min: 1, max: 200 });

  const accessToken = token.access_token;
  const instanceUrl = token.instance_url;

  console.log('  📊 Opportunity 조회 중...');
  const oppSoql = buildClosedLostOppSoql(startIso, endIso);
  const opps = await queryAll(instanceUrl, accessToken, oppSoql);
  console.log(`  ✅ Opportunity ${opps.length}건 조회 완료`);

  const oppIds = [...new Set(opps.map((o) => o.Id).filter(Boolean))];
  const accountIds = [...new Set(opps.map((o) => o.AccountId).filter(Boolean))];

  console.log('  📊 Case 조회 중...');
  const caseEntries = await mapLimit(accountIds, concurrency, async (accountId) => {
    const soql = buildCaseSoql(accountId, caseLimit);
    const cases = await queryAll(instanceUrl, accessToken, soql);
    return [
      accountId,
      (cases || []).map((c) => ({
        id: c.Id || null,
        createdDate: c.CreatedDate || null,
        type: c.Type || null,
        type2: c.Type2__c || null,
        type3: c.Type3__c || null,
        description: c.Description__c || null,
        descriptionShort: typeof c.Description__c === 'string' ? c.Description__c.slice(0, 120) : null,
        caseLeadtime: c.CaseLeadtime__c ?? null,
      })),
    ];
  });
  console.log(`  ✅ Case ${caseEntries.length}개 Account 조회 완료`);

  const caseMap = new Map(caseEntries);

  console.log('  📊 Task 조회 중...');
  const taskRows = await fetchTasksForOppIds(instanceUrl, accessToken, oppIds);
  console.log(`  ✅ Task ${taskRows.length}건 조회 완료`);

  const taskMap = new Map();
  taskRows.forEach((t) => {
    const key = t.WhatId || null;
    if (!key) return;
    if (!taskMap.has(key)) taskMap.set(key, []);
    const list = taskMap.get(key);
    if (list.length >= taskLimit) return;
    list.push({
      id: t.Id || null,
      subject: t.Subject || null,
      status: t.Status || null,
      activityDate: t.ActivityDate || null,
      createdDate: t.CreatedDate || null,
      description: t.Description || null,
      callDisposition: t.CallDisposition || null,
      callDurationSeconds: t.CallDurationInSeconds ?? null,
      callType: t.CallType || null,
      ownerId: t.OwnerId || null,
      ownerName: t.Owner?.Name ?? null,
      priority: t.Priority || null,
    });
  });

  const rows = opps.map((o) => {
    const cases = caseMap.get(o.AccountId) || [];
    const tasks = taskMap.get(o.Id) || [];
    return {
      opportunity: {
        id: o.Id || null,
        name: o.Name || null,
        createdDate: o.CreatedDate || null,
        leadSource: o.LeadSource || null,
        lastStageChangeDate: o.LastStageChangeDate || null,
        department: o.fm_Department__c || null,
        churnCompetitor: o.ChurnCompetitor__c || null,
        accountId: o.AccountId || null,
        accountName: o.Account?.Name ?? null,
      },
      loss: {
        reason: o.Loss_Reason__c || null,
        r1: o.Loss_Reason_Oppt__c || null,
        r2: o.Loss_Reason_Oppt_2depth__c || null,
        r3: o.Loss_Reason_Oppt_3depth__c || null,
        detail: o.Loss_Reason_Detail__c || null,
      },
      latestCase: cases[0] || null,
      recentCases: cases,
      recentTasks: tasks,
    };
  });

  const lossCategoryMap = new Map();
  rows.forEach((row) => {
    const key = row.loss?.r2 || '미지정';
    lossCategoryMap.set(key, (lossCategoryMap.get(key) || 0) + 1);
  });
  const lossCategories = Array.from(lossCategoryMap.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'));

  return {
    dateUtc: `${startDate}~${endDate}`,
    startIso,
    endIso,
    startDate,
    endDate,
    summary: {
      closedLostCount: opps.length,
      accountCount: accountIds.length,
      lossCategories,
    },
    rows,
  };
}

module.exports = {
  fetchClosedLostGrid,
};
