const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const sf = require('../server/api/services/salesforce');
const fs = require('fs');

const IB_BO_NAMES = ['전수빈', '정지영', '박효정', '조현재'];
const CH_BO_NAMES = ['최영은', '장명진', '이은지', '김희수'];

async function batchQuery(queryFn, ids, batchSize = 500) {
  const results = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const batchResults = await queryFn(batch);
    results.push(...batchResults);
  }
  return results;
}

async function main() {
  const startDate = '2026-03-01T00:00:00Z';
  const endDate = '2026-04-01T00:00:00Z';
  const today = new Date('2026-03-23');

  // ==========================================
  // 1. Find IB BO User IDs via BOUser__c
  // ==========================================
  console.log('[1] Finding IB BO User IDs...');
  const boNameFilter = IB_BO_NAMES.map(n => `'${n}'`).join(',');
  const boUsers = await sf.queryAll(`
    SELECT Id, Name FROM User WHERE Name IN (${boNameFilter})
  `);
  const boUserMap = {};
  boUsers.forEach(u => { boUserMap[u.Name] = u.Id; });
  console.log('  IB BO Users:', JSON.stringify(boUserMap, null, 2));

  // ==========================================
  // 2. Find CH BO User IDs
  // ==========================================
  console.log('[2] Finding CH BO User IDs...');
  const chNameFilter = CH_BO_NAMES.map(n => `'${n}'`).join(',');
  const chUsers = await sf.queryAll(`
    SELECT Id, Name FROM User WHERE Name IN (${chNameFilter})
  `);
  const chUserMap = {};
  chUsers.forEach(u => { chUserMap[u.Name] = u.Id; });
  console.log('  CH BO Users:', JSON.stringify(chUserMap, null, 2));

  // ==========================================
  // 3. IB BO: 전환율 — 3월 생성 Opportunity 기준
  // ==========================================
  console.log('\n[3] IB BO: March-created Opportunities by BOUser__c...');
  const allBoUserIds = Object.values(boUserMap).map(id => `'${id}'`).join(',');

  // All March-created Opps assigned to IB BO
  const marchOpps = await sf.queryAll(`
    SELECT Id, Name, StageName, BOUser__c, BOUser__r.Name, CreatedDate,
           Owner.Name, Owner_Department__c, Account.Name,
           RecordType.Name, IsClosed, IsWon
    FROM Opportunity
    WHERE BOUser__c IN (${allBoUserIds})
      AND CreatedDate >= ${startDate}
      AND CreatedDate < ${endDate}
    ORDER BY BOUser__c, CreatedDate ASC
  `);
  console.log(`  March Opps with IB BO: ${marchOpps.length}`);

  // Get Quotes for these Opps
  const marchOppIds = marchOpps.map(o => o.Id);
  let marchQuotes = [];
  if (marchOppIds.length > 0) {
    marchQuotes = await batchQuery(async (batch) => {
      const inClause = batch.map(id => `'${id}'`).join(',');
      return sf.queryAll(`
        SELECT Id, OpportunityId, CreatedDate
        FROM Quote
        WHERE OpportunityId IN (${inClause})
      `);
    }, marchOppIds);
  }
  console.log(`  Quotes for March Opps: ${marchQuotes.length}`);

  // Quoted Opp IDs (has at least one Quote)
  const quotedOppIds = new Set(marchQuotes.map(q => q.OpportunityId));

  // Get Contracts (서명완료) for these Opps
  let marchContracts = [];
  if (marchOppIds.length > 0) {
    marchContracts = await batchQuery(async (batch) => {
      const inClause = batch.map(id => `'${id}'`).join(',');
      return sf.queryAll(`
        SELECT Id, Opportunity__c, ContractStatus__c
        FROM Contract__c
        WHERE Opportunity__c IN (${inClause})
          AND ContractStatus__c = '계약서명완료'
      `);
    }, marchOppIds);
  }
  const signedOppIds = new Set(marchContracts.map(c => c.Opportunity__c));

  // Build IB BO pipeline per person
  console.log('\n=== IB BO Pipeline (3월 생성 영업기회) ===');
  const ibPipeline = {};
  for (const name of IB_BO_NAMES) {
    const userId = boUserMap[name];
    const personOpps = marchOpps.filter(o => o.BOUser__c === userId);
    const quoted = personOpps.filter(o => quotedOppIds.has(o.Id));
    const signed = quoted.filter(o => signedOppIds.has(o.Id));
    const wip = quoted.filter(o => !o.IsClosed && !signedOppIds.has(o.Id));
    const cl = quoted.filter(o => o.IsClosed && !o.IsWon && !signedOppIds.has(o.Id));
    const noQuote = personOpps.filter(o => !quotedOppIds.has(o.Id));

    const convRate = quoted.length > 0
      ? ((signed.length / quoted.length) * 100).toFixed(1) + '%'
      : '0.0%';

    ibPipeline[name] = {
      totalOpps: personOpps.length,
      quotedOpps: quoted.length,
      signedOpps: signed.length,
      wipOpps: wip.length,
      clOpps: cl.length,
      noQuoteOpps: noQuote.length,
      conversionRate: convRate,
    };

    console.log(`\n  ${name}:`);
    console.log(`    전체 영업기회: ${personOpps.length}`);
    console.log(`    견적 발송: ${quoted.length}`);
    console.log(`    계약서명완료: ${signed.length}`);
    console.log(`    견적 단계 (WIP): ${wip.length}`);
    console.log(`    CL: ${cl.length}`);
    console.log(`    견적 미발송: ${noQuote.length}`);
    console.log(`    전환율: ${convRate}`);

    // Show stage breakdown for WIP
    if (wip.length > 0) {
      const stageBreakdown = {};
      wip.forEach(o => {
        stageBreakdown[o.StageName] = (stageBreakdown[o.StageName] || 0) + 1;
      });
      console.log(`    WIP 단계별: ${JSON.stringify(stageBreakdown)}`);
    }
  }

  // ==========================================
  // 4. IB BO: 잔량 + 무활동 — 전체 Open 건 기준
  // ==========================================
  console.log('\n[4] IB BO: All Open Opportunities...');
  const allOpenOpps = await sf.queryAll(`
    SELECT Id, Name, StageName, BOUser__c, BOUser__r.Name, CreatedDate,
           Owner.Name, Account.Name, RecordType.Name, ContractStatus__c
    FROM Opportunity
    WHERE BOUser__c IN (${allBoUserIds})
      AND IsClosed = false
    ORDER BY BOUser__c, CreatedDate ASC
  `);
  console.log(`  All Open Opps with IB BO: ${allOpenOpps.length}`);

  // Get Tasks for these Opps
  const openOppIds = allOpenOpps.map(o => o.Id);
  let openTasks = [];
  if (openOppIds.length > 0) {
    openTasks = await batchQuery(async (batch) => {
      const inClause = batch.map(id => `'${id}'`).join(',');
      return sf.queryAll(`
        SELECT Id, WhatId, ActivityDate, CreatedDate
        FROM Task
        WHERE WhatId IN (${inClause})
        ORDER BY CreatedDate DESC
      `);
    }, openOppIds);
  }
  console.log(`  Tasks for Open Opps: ${openTasks.length}`);

  // Build task map: OppId -> latest task date
  const latestTaskMap = {};
  for (const t of openTasks) {
    const taskDate = t.ActivityDate || t.CreatedDate?.substring(0, 10);
    if (!latestTaskMap[t.WhatId] || taskDate > latestTaskMap[t.WhatId]) {
      latestTaskMap[t.WhatId] = taskDate;
    }
  }

  // Task count map
  const taskCountMap = {};
  for (const t of openTasks) {
    taskCountMap[t.WhatId] = (taskCountMap[t.WhatId] || 0) + 1;
  }

  console.log('\n=== IB BO Open Pipeline (전체 Open 건) ===');
  const ibOpenMetrics = {};
  for (const name of IB_BO_NAMES) {
    const userId = boUserMap[name];
    const personOpenOpps = allOpenOpps.filter(o => o.BOUser__c === userId);

    // Stage breakdown
    const stageBreakdown = {};
    personOpenOpps.forEach(o => {
      stageBreakdown[o.StageName] = (stageBreakdown[o.StageName] || 0) + 1;
    });

    // 7일 초과 무활동
    const noActivity7d = [];
    for (const opp of personOpenOpps) {
      const lastTask = latestTaskMap[opp.Id];
      if (!lastTask) {
        // No task at all
        noActivity7d.push({
          oppId: opp.Id,
          name: opp.Name,
          account: opp.Account?.Name,
          stage: opp.StageName,
          createdDate: opp.CreatedDate?.substring(0, 10),
          lastTaskDate: null,
          daysSinceTask: null,
          totalTasks: 0,
        });
      } else {
        const daysSince = Math.floor((today - new Date(lastTask)) / (1000 * 60 * 60 * 24));
        if (daysSince > 7) {
          noActivity7d.push({
            oppId: opp.Id,
            name: opp.Name,
            account: opp.Account?.Name,
            stage: opp.StageName,
            createdDate: opp.CreatedDate?.substring(0, 10),
            lastTaskDate: lastTask,
            daysSinceTask: daysSince,
            totalTasks: taskCountMap[opp.Id] || 0,
          });
        }
      }
    }

    // 7일 초과 잔량 (CreatedDate + 7일 지난 Open 건)
    const over7d = personOpenOpps.filter(o => {
      const created = new Date(o.CreatedDate);
      const daysOld = Math.floor((today - created) / (1000 * 60 * 60 * 24));
      return daysOld > 7;
    });

    // 45일+ 장기 건
    const over45d = personOpenOpps.filter(o => {
      const created = new Date(o.CreatedDate);
      const daysOld = Math.floor((today - created) / (1000 * 60 * 60 * 24));
      return daysOld >= 45;
    });

    ibOpenMetrics[name] = {
      totalOpen: personOpenOpps.length,
      stageBreakdown,
      over7daysPending: over7d.length,
      noActivity7days: noActivity7d.length,
      noActivity7dDetails: noActivity7d,
      over45daysPending: over45d.length,
      over45dDetails: over45d.map(o => ({
        oppId: o.Id,
        name: o.Name,
        account: o.Account?.Name,
        stage: o.StageName,
        createdDate: o.CreatedDate?.substring(0, 10),
        daysOld: Math.floor((today - new Date(o.CreatedDate)) / (1000 * 60 * 60 * 24)),
      })),
    };

    console.log(`\n  ${name}: Open ${personOpenOpps.length}건`);
    console.log(`    단계별: ${JSON.stringify(stageBreakdown)}`);
    console.log(`    7일 초과 잔량: ${over7d.length}건`);
    console.log(`    무활동 7일+: ${noActivity7d.length}건`);
    console.log(`    45일+ 장기: ${over45d.length}건`);
  }

  // ==========================================
  // 5. IB BO: 기타 지표 (계약→출고, 태블릿, 주차별)
  //    Contract__c 기준 — 3월 계약
  // ==========================================
  console.log('\n[5] IB BO: Contract metrics (March)...');
  const ibContracts = await sf.queryAll(`
    SELECT Id, Name, OwnerId, Owner.Name, ContractStatus__c, CreatedDate,
           ContractSignedDate__c, Opportunity__c, Opportunity__r.BOUser__c,
           Opportunity__r.TotalNumberofEveryTablet__c
    FROM Contract__c
    WHERE Opportunity__r.BOUser__c IN (${allBoUserIds})
      AND CreatedDate >= ${startDate}
      AND CreatedDate < ${endDate}
    ORDER BY CreatedDate ASC
  `);
  console.log(`  IB Contracts (March): ${ibContracts.length}`);

  // Get Orders for signed contracts
  const signedContractOppIds = [...new Set(
    ibContracts
      .filter(c => c.ContractStatus__c === '계약서명완료')
      .map(c => c.Opportunity__c)
  )];
  let ibOrders = [];
  if (signedContractOppIds.length > 0) {
    ibOrders = await batchQuery(async (batch) => {
      const inClause = batch.map(id => `'${id}'`).join(',');
      return sf.queryAll(`
        SELECT Id, OpportunityId FROM Order WHERE OpportunityId IN (${inClause})
      `);
    }, signedContractOppIds);
  }
  const orderedOppIds = new Set(ibOrders.map(o => o.OpportunityId));

  const ibContractMetrics = {};
  for (const name of IB_BO_NAMES) {
    const userId = boUserMap[name];
    const personContracts = ibContracts.filter(c => c.Opportunity__r?.BOUser__c === userId);
    const signed = personContracts.filter(c => c.ContractStatus__c === '계약서명완료');
    const pending = personContracts.filter(c => c.ContractStatus__c !== '계약서명완료');

    // Order completion
    const signedOppIdsForPerson = [...new Set(signed.map(c => c.Opportunity__c))];
    const withOrder = signedOppIdsForPerson.filter(id => orderedOppIds.has(id));

    // Monthly tablets
    const tablets = signed.reduce((sum, c) =>
      sum + (c.Opportunity__r?.TotalNumberofEveryTablet__c || 0), 0);

    // Weekly contracts
    const weeklyContracts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    personContracts.forEach(c => {
      const d = new Date(c.CreatedDate);
      const day = d.getUTCDate();
      const week = Math.min(4, Math.ceil(day / 7));
      weeklyContracts[week]++;
    });

    ibContractMetrics[name] = {
      totalContracts: personContracts.length,
      signedContracts: signed.length,
      pendingContracts: pending.length,
      orderCompletion: {
        signedOpps: signedOppIdsForPerson.length,
        withOrder: withOrder.length,
        rate: signedOppIdsForPerson.length > 0
          ? ((withOrder.length / signedOppIdsForPerson.length) * 100).toFixed(1) + '%'
          : '0.0%',
      },
      monthlyTablets: tablets,
      weeklyContracts,
    };

    console.log(`\n  ${name}:`);
    console.log(`    계약: ${personContracts.length} (서명: ${signed.length}, 잔여: ${pending.length})`);
    console.log(`    출고완료율: ${ibContractMetrics[name].orderCompletion.rate} (${withOrder.length}/${signedOppIdsForPerson.length})`);
    console.log(`    태블릿: ${tablets}`);
    console.log(`    주차별: ${JSON.stringify(weeklyContracts)}`);
  }

  // ==========================================
  // 6. CH BO: Contract metrics + Open pipeline
  // ==========================================
  console.log('\n[6] CH BO: Contract metrics...');
  const allChUserIds = Object.values(chUserMap).map(id => `'${id}'`).join(',');

  // March contracts owned by CH BO
  const chContracts = await sf.queryAll(`
    SELECT Id, Name, OwnerId, Owner.Name, ContractStatus__c, CreatedDate,
           ContractSignedDate__c, ContractType__c, Opportunity__c,
           Opportunity__r.TotalNumberofEveryTablet__c,
           Opportunity__r.Account.Name, Opportunity__r.Account.BranchName__c
    FROM Contract__c
    WHERE OwnerId IN (${allChUserIds})
      AND CreatedDate >= ${startDate}
      AND CreatedDate < ${endDate}
    ORDER BY CreatedDate ASC
  `);
  console.log(`  CH Contracts (March): ${chContracts.length}`);

  // Orders for signed CH contracts
  const chSignedOppIds = [...new Set(
    chContracts
      .filter(c => c.ContractStatus__c === '계약서명완료')
      .map(c => c.Opportunity__c)
      .filter(Boolean)
  )];
  console.log(`  CH Signed Opp IDs: ${chSignedOppIds.length}`);
  let chOrders = [];
  if (chSignedOppIds.length > 0) {
    console.log('  Querying CH Orders...');
    chOrders = await batchQuery(async (batch) => {
      const inClause = batch.map(id => `'${id}'`).join(',');
      return sf.queryAll(`
        SELECT Id, OpportunityId FROM Order WHERE OpportunityId IN (${inClause})
      `);
    }, chSignedOppIds);
  }
  const chOrderedOppIds = new Set(chOrders.map(o => o.OpportunityId));

  // CH: All open contracts (for pending/no-activity)
  console.log('\n[7] CH BO: All Open Contracts...');
  const chOpenContracts = await sf.queryAll(`
    SELECT Id, Name, OwnerId, Owner.Name, ContractStatus__c, CreatedDate,
           Opportunity__c, Opportunity__r.Account.Name, ContractType__c,
           ContractSignedDate__c
    FROM Contract__c
    WHERE OwnerId IN (${allChUserIds})
      AND ContractStatus__c IN ('계약서명대기', '계약서발송완료', '계약서발송', '사전심사발송', '사전심사', '계약서작성필요', '견적변동')
    ORDER BY CreatedDate ASC
  `);
  console.log(`  CH Open Contracts: ${chOpenContracts.length}`);

  // Get Opp IDs for open CH contracts to query Tasks
  const chOpenOppIds = [...new Set(chOpenContracts.map(c => c.Opportunity__c).filter(Boolean))];
  let chOpenTasks = [];
  if (chOpenOppIds.length > 0) {
    chOpenTasks = await batchQuery(async (batch) => {
      const inClause = batch.map(id => `'${id}'`).join(',');
      return sf.queryAll(`
        SELECT Id, WhatId, ActivityDate, CreatedDate
        FROM Task
        WHERE WhatId IN (${inClause})
        ORDER BY CreatedDate DESC
      `);
    }, chOpenOppIds);
  }

  const chLatestTaskMap = {};
  for (const t of chOpenTasks) {
    const taskDate = t.ActivityDate || t.CreatedDate?.substring(0, 10);
    if (!chLatestTaskMap[t.WhatId] || taskDate > chLatestTaskMap[t.WhatId]) {
      chLatestTaskMap[t.WhatId] = taskDate;
    }
  }

  const chContractMetrics = {};
  for (const name of CH_BO_NAMES) {
    const userId = chUserMap[name];
    const personContracts = chContracts.filter(c => c.OwnerId === userId);
    const signed = personContracts.filter(c => c.ContractStatus__c === '계약서명완료');
    const pending = personContracts.filter(c => c.ContractStatus__c !== '계약서명완료');

    // Order completion
    const signedOppIdsForPerson = [...new Set(signed.map(c => c.Opportunity__c))];
    const withOrder = signedOppIdsForPerson.filter(id => chOrderedOppIds.has(id));

    // Tablets
    const tablets = signed.reduce((sum, c) =>
      sum + (c.Opportunity__r?.TotalNumberofEveryTablet__c || 0), 0);

    // Weekly contracts
    const weeklyContracts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    personContracts.forEach(c => {
      const d = new Date(c.CreatedDate);
      const day = d.getUTCDate();
      const week = Math.min(4, Math.ceil(day / 7));
      weeklyContracts[week]++;
    });

    // Franchise lead time (계약서명완료 기준, 서명일 - 생성일)
    const franchiseContracts = signed.filter(c => {
      const type = c.ContractType__c || '';
      return type.includes('프랜차이즈') || type.includes('제휴');
    });
    // All signed for franchise calculation (since ContractType might not be set)
    // Use all signed contracts and check days
    const franchiseLeadTime = { total: signed.length, within5days: 0 };
    signed.forEach(c => {
      if (c.ContractSignedDate__c && c.CreatedDate) {
        const created = new Date(c.CreatedDate);
        const signedDate = new Date(c.ContractSignedDate__c);
        const days = Math.floor((signedDate - created) / (1000 * 60 * 60 * 24));
        if (days <= 5) franchiseLeadTime.within5days++;
      }
    });
    franchiseLeadTime.rate = franchiseLeadTime.total > 0
      ? ((franchiseLeadTime.within5days / franchiseLeadTime.total) * 100).toFixed(1) + '%'
      : '0.0%';

    // Open contracts for this CH person
    const personOpenContracts = chOpenContracts.filter(c => c.OwnerId === userId);

    // Franchise 7d+ pending
    const franchiseOver7d = personOpenContracts.filter(c => {
      const created = new Date(c.CreatedDate);
      const days = Math.floor((today - created) / (1000 * 60 * 60 * 24));
      return days > 7;
    });

    // Individual 10d+ pending
    const individualOver10d = personOpenContracts.filter(c => {
      const created = new Date(c.CreatedDate);
      const days = Math.floor((today - created) / (1000 * 60 * 60 * 24));
      return days > 10;
    });

    // No activity 5 days (on open contracts)
    const noActivity5d = [];
    for (const c of personOpenContracts) {
      const oppId = c.Opportunity__c;
      const lastTask = oppId ? chLatestTaskMap[oppId] : null;
      if (!lastTask) {
        noActivity5d.push({
          contract: `${c.Id}_${c.Name}`,
          oppId,
          account: c.Opportunity__r?.Account?.Name,
          createdDate: c.CreatedDate?.substring(0, 10),
          lastTaskDate: null,
          daysSinceTask: null,
        });
      } else {
        const daysSince = Math.floor((today - new Date(lastTask)) / (1000 * 60 * 60 * 24));
        if (daysSince > 5) {
          noActivity5d.push({
            contract: `${c.Id}_${c.Name}`,
            oppId,
            account: c.Opportunity__r?.Account?.Name,
            createdDate: c.CreatedDate?.substring(0, 10),
            lastTaskDate: lastTask,
            daysSinceTask: daysSince,
          });
        }
      }
    }

    chContractMetrics[name] = {
      totalContracts: personContracts.length,
      signedContracts: signed.length,
      pendingContracts: pending.length,
      orderCompletion: {
        signedOpps: signedOppIdsForPerson.length,
        withOrder: withOrder.length,
        rate: signedOppIdsForPerson.length > 0
          ? ((withOrder.length / signedOppIdsForPerson.length) * 100).toFixed(1) + '%'
          : '0.0%',
      },
      monthlyTablets: tablets,
      weeklyContracts,
      franchiseLeadTime,
      individualLeadTime: { total: 0, within7days: 0, rate: '0.0%' },
      franchiseOver7daysPending: franchiseOver7d.length,
      individualOver10daysPending: individualOver10d.length,
      noActivity5days: noActivity5d.length,
      noActivity5dDetails: noActivity5d,
      monthlyProcessed: signed.length,
      totalOpen: personOpenContracts.length,
    };

    console.log(`\n  ${name}:`);
    console.log(`    계약: ${personContracts.length} (서명: ${signed.length}, 잔여: ${pending.length})`);
    console.log(`    출고완료율: ${chContractMetrics[name].orderCompletion.rate}`);
    console.log(`    태블릿: ${tablets}`);
    console.log(`    주차별: ${JSON.stringify(weeklyContracts)}`);
    console.log(`    Open 건: ${personOpenContracts.length}`);
    console.log(`    제휴 7일+: ${franchiseOver7d.length}, 개인 10일+: ${individualOver10d.length}`);
    console.log(`    무활동 5일+: ${noActivity5d.length}`);
  }

  // ==========================================
  // 7. 박효정 상태별 분포 (전체 Open 건)
  // ==========================================
  console.log('\n[7] 박효정 Open Opportunities - 상태별 분포...');
  const phyId = boUserMap['박효정'];
  const phyOpenOpps = allOpenOpps.filter(o => o.BOUser__c === phyId);
  const phyStageBreakdown = {};
  phyOpenOpps.forEach(o => {
    phyStageBreakdown[o.StageName] = (phyStageBreakdown[o.StageName] || 0) + 1;
  });
  console.log(`  박효정 Open 건: ${phyOpenOpps.length}`);
  console.log(`  단계별: ${JSON.stringify(phyStageBreakdown, null, 2)}`);

  // Age distribution
  const ageGroups = { '0-7일': 0, '8-30일': 0, '31-90일': 0, '91-180일': 0, '181-365일': 0, '365일+': 0 };
  phyOpenOpps.forEach(o => {
    const days = Math.floor((today - new Date(o.CreatedDate)) / (1000 * 60 * 60 * 24));
    if (days <= 7) ageGroups['0-7일']++;
    else if (days <= 30) ageGroups['8-30일']++;
    else if (days <= 90) ageGroups['31-90일']++;
    else if (days <= 180) ageGroups['91-180일']++;
    else if (days <= 365) ageGroups['181-365일']++;
    else ageGroups['365일+']++;
  });
  console.log(`  생성일 분포: ${JSON.stringify(ageGroups, null, 2)}`);

  // ==========================================
  // 8. Build output JSON
  // ==========================================
  const output = {
    period: '2026-03',
    asOf: '2026-03-23',
    generatedAt: new Date().toISOString(),
    criteria: {
      conversionRate: '3월 생성 Opportunity 중 견적 있는 건 → 계약서명완료/전체 (WIP+CL 포함)',
      pendingAndActivity: '전체 Open 건 기준 (생성일 무관)',
    },
    ibBO: {},
    chBO: {},
    ibPipeline: ibPipeline,
  };

  for (const name of IB_BO_NAMES) {
    const pipeline = ibPipeline[name];
    const contracts = ibContractMetrics[name];
    const open = ibOpenMetrics[name];

    output.ibBO[name] = {
      name,
      pipeline: {
        totalOpps: pipeline.totalOpps,
        quotedOpps: pipeline.quotedOpps,
        signedOpps: pipeline.signedOpps,
        wipOpps: pipeline.wipOpps,
        clOpps: pipeline.clOpps,
        noQuoteOpps: pipeline.noQuoteOpps,
      },
      conversionRate: {
        quotedOpps: pipeline.quotedOpps,
        signedQuotedOpps: pipeline.signedOpps,
        rate: pipeline.conversionRate,
        note: '3월생성 Opp 중 견적있는 건 대비 계약서명완료 (WIP+CL 포함 분모)',
      },
      contracts: {
        total: contracts.totalContracts,
        signed: contracts.signedContracts,
        pending: contracts.pendingContracts,
      },
      orderCompletionRate: contracts.orderCompletion,
      monthlyTablets: contracts.monthlyTablets,
      weeklyContracts: contracts.weeklyContracts,
      // All open (전체 기준)
      openPipeline: {
        totalOpen: open.totalOpen,
        stageBreakdown: open.stageBreakdown,
      },
      over7daysPending: open.over7daysPending,
      noActivity7days: {
        count: open.noActivity7days,
        totalOpenOpps: open.totalOpen,
        details: open.noActivity7dDetails.slice(0, 20),
        note: '전체 Open Opp 중 마지막 Task 7일 초과 or Task 없음',
      },
      over45daysPending: open.over45daysPending,
    };
  }

  for (const name of CH_BO_NAMES) {
    const metrics = chContractMetrics[name];
    output.chBO[name] = {
      name,
      contracts: {
        total: metrics.totalContracts,
        signed: metrics.signedContracts,
        pending: metrics.pendingContracts,
      },
      orderCompletionRate: metrics.orderCompletion,
      monthlyTablets: metrics.monthlyTablets,
      weeklyContracts: metrics.weeklyContracts,
      franchiseLeadTime: metrics.franchiseLeadTime,
      individualLeadTime: metrics.individualLeadTime,
      franchiseOver7daysPending: metrics.franchiseOver7daysPending,
      individualOver10daysPending: metrics.individualOver10daysPending,
      noActivity5days: {
        count: metrics.noActivity5days,
        totalOpenContracts: metrics.totalOpen,
        details: metrics.noActivity5dDetails,
        note: '전체 Open Contract의 Opp 중 마지막 Task 5일 초과 or Task 없음',
      },
      monthlyProcessed: metrics.monthlyProcessed,
    };
  }

  // 박효정 상세
  output.ibBO['박효정'].openPipeline.ageDistribution = ageGroups;

  const outputPath = path.join(__dirname, '..', 'reports', 'bo-kpi-v2-2026-03.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved to ${outputPath}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err.message || err);
    process.exit(1);
  });
