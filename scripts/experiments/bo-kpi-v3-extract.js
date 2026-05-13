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

  // 1. Find User IDs
  console.log('[1] Finding User IDs...');
  const allNames = [...IB_BO_NAMES, ...CH_BO_NAMES];
  const nameFilter = allNames.map(n => `'${n}'`).join(',');
  const users = await sf.queryAll(`SELECT Id, Name FROM User WHERE Name IN (${nameFilter})`);
  const userMap = {};
  users.forEach(u => { userMap[u.Name] = u.Id; });
  console.log('Users:', JSON.stringify(userMap, null, 2));

  const ibBoIds = IB_BO_NAMES.map(n => userMap[n]);
  const ibBoFilter = ibBoIds.map(id => `'${id}'`).join(',');

  // ==========================================
  // 2. IB BO 전환율: 3월 생성, 테이블오더 신규, BOUser__c 기준
  // ==========================================
  console.log('\n[2] IB BO Pipeline (테이블오더 신규, 3월 생성)...');
  const marchOpps = await sf.queryAll(`
    SELECT Id, Name, StageName, BOUser__c, BOUser__r.Name, IsWon, IsClosed,
           CreatedDate, Owner.Name, Account.Name
    FROM Opportunity
    WHERE BOUser__c IN (${ibBoFilter})
      AND CreatedDate >= ${startDate} AND CreatedDate < ${endDate}
      AND RecordType.Name = '1. 테이블오더 (신규)'
    ORDER BY BOUser__c, CreatedDate ASC
  `);
  console.log(`  March 신규 Opps (4 BO): ${marchOpps.length}`);

  // Quotes
  const marchOppIds = marchOpps.map(o => o.Id);
  const quotes = await batchQuery(async (batch) => {
    const inClause = batch.map(id => `'${id}'`).join(',');
    return sf.queryAll(`SELECT Id, OpportunityId FROM Quote WHERE OpportunityId IN (${inClause})`);
  }, marchOppIds);
  const quotedOppIds = new Set(quotes.map(q => q.OpportunityId));
  console.log(`  Quoted Opps: ${quotedOppIds.size}`);

  // Contracts (계약서명완료)
  const contracts = await batchQuery(async (batch) => {
    const inClause = batch.map(id => `'${id}'`).join(',');
    return sf.queryAll(`
      SELECT Id, Opportunity__c, ContractStatus__c
      FROM Contract__c WHERE Opportunity__c IN (${inClause}) AND ContractStatus__c = '계약서명완료'
    `);
  }, marchOppIds);
  const signedOppIds = new Set(contracts.map(c => c.Opportunity__c));
  console.log(`  Signed Opps: ${signedOppIds.size}`);

  // Pipeline per BO
  console.log('\n=== IB BO Pipeline ===');
  const ibPipeline = {};
  for (const name of IB_BO_NAMES) {
    const userId = userMap[name];
    const personOpps = marchOpps.filter(o => o.BOUser__c === userId);
    const quoted = personOpps.filter(o => quotedOppIds.has(o.Id));
    const signed = quoted.filter(o => signedOppIds.has(o.Id));
    const wip = quoted.filter(o => !o.IsClosed);
    const cl = quoted.filter(o => o.IsClosed && !o.IsWon);
    const noQuote = personOpps.filter(o => !quotedOppIds.has(o.Id));

    // WIP stage breakdown
    const wipStages = {};
    wip.forEach(o => { wipStages[o.StageName] = (wipStages[o.StageName] || 0) + 1; });

    const rate = quoted.length > 0
      ? ((signed.length / quoted.length) * 100).toFixed(1) + '%' : '0.0%';

    ibPipeline[name] = {
      totalOpps: personOpps.length,
      quotedOpps: quoted.length,
      signedOpps: signed.length,
      wipOpps: wip.length,
      clOpps: cl.length,
      noQuoteOpps: noQuote.length,
      wipStages,
      conversionRate: rate,
    };

    console.log(`  ${name}: total=${personOpps.length} quoted=${quoted.length} signed=${signed.length} WIP=${wip.length} CL=${cl.length} rate=${rate}`);
    if (Object.keys(wipStages).length > 0) {
      console.log(`    WIP: ${JSON.stringify(wipStages)}`);
    }
  }

  // ==========================================
  // 3. IB BO: 잔량 + 무활동 — 전체 Open 건 기준
  // ==========================================
  console.log('\n[3] IB BO: All Open Opportunities...');
  const allOpenOpps = await sf.queryAll(`
    SELECT Id, Name, StageName, BOUser__c, CreatedDate, Account.Name
    FROM Opportunity
    WHERE BOUser__c IN (${ibBoFilter})
      AND IsClosed = false
    ORDER BY BOUser__c, CreatedDate ASC
  `);
  console.log(`  All Open Opps: ${allOpenOpps.length}`);

  // Tasks for open opps
  const openOppIds = allOpenOpps.map(o => o.Id);
  const openTasks = await batchQuery(async (batch) => {
    const inClause = batch.map(id => `'${id}'`).join(',');
    return sf.queryAll(`
      SELECT Id, WhatId, ActivityDate, CreatedDate
      FROM Task WHERE WhatId IN (${inClause}) ORDER BY CreatedDate DESC
    `);
  }, openOppIds);

  const latestTaskMap = {};
  const taskCountMap = {};
  for (const t of openTasks) {
    const taskDate = t.ActivityDate || t.CreatedDate?.substring(0, 10);
    if (!latestTaskMap[t.WhatId] || taskDate > latestTaskMap[t.WhatId]) {
      latestTaskMap[t.WhatId] = taskDate;
    }
    taskCountMap[t.WhatId] = (taskCountMap[t.WhatId] || 0) + 1;
  }

  console.log('\n=== IB BO Open Metrics ===');
  const ibOpenMetrics = {};
  for (const name of IB_BO_NAMES) {
    const userId = userMap[name];
    const personOpen = allOpenOpps.filter(o => o.BOUser__c === userId);

    const stageBreakdown = {};
    personOpen.forEach(o => { stageBreakdown[o.StageName] = (stageBreakdown[o.StageName] || 0) + 1; });

    // 7일+ 무활동 (마지막 Task 7일 초과 or Task 없음)
    const noActivity7d = [];
    for (const opp of personOpen) {
      const lastTask = latestTaskMap[opp.Id];
      if (!lastTask) {
        noActivity7d.push({
          oppId: opp.Id, name: opp.Name, account: opp.Account?.Name,
          stage: opp.StageName, createdDate: opp.CreatedDate?.substring(0, 10),
          lastTaskDate: null, daysSinceTask: null, totalTasks: 0,
        });
      } else {
        const days = Math.floor((today - new Date(lastTask)) / 86400000);
        if (days > 7) {
          noActivity7d.push({
            oppId: opp.Id, name: opp.Name, account: opp.Account?.Name,
            stage: opp.StageName, createdDate: opp.CreatedDate?.substring(0, 10),
            lastTaskDate: lastTask, daysSinceTask: days,
            totalTasks: taskCountMap[opp.Id] || 0,
          });
        }
      }
    }

    // 45일+ (생성일 기준)
    const over45d = personOpen.filter(o => {
      const days = Math.floor((today - new Date(o.CreatedDate)) / 86400000);
      return days >= 45;
    });

    ibOpenMetrics[name] = {
      totalOpen: personOpen.length,
      stageBreakdown,
      noActivity7days: noActivity7d.length,
      noActivity7dDetails: noActivity7d,
      over45daysPending: over45d.length,
    };

    console.log(`  ${name}: Open=${personOpen.length} 무활동7일+=${noActivity7d.length} 45일+장기=${over45d.length}`);
  }

  // ==========================================
  // 4. IB BO: 계약/출고/태블릿 (3월, BOUser__c 기준)
  // ==========================================
  console.log('\n[4] IB BO: Contract metrics...');
  const ibContracts = await sf.queryAll(`
    SELECT Id, Name, OwnerId, Owner.Name, ContractStatus__c, CreatedDate,
           Opportunity__c, Opportunity__r.BOUser__c,
           Opportunity__r.TotalNumberofEveryTablet__c
    FROM Contract__c
    WHERE Opportunity__r.BOUser__c IN (${ibBoFilter})
      AND CreatedDate >= ${startDate} AND CreatedDate < ${endDate}
  `);

  const ibSignedOppIds = [...new Set(
    ibContracts.filter(c => c.ContractStatus__c === '계약서명완료').map(c => c.Opportunity__c).filter(Boolean)
  )];
  const ibOrders = await batchQuery(async (batch) => {
    const inClause = batch.map(id => `'${id}'`).join(',');
    return sf.queryAll(`SELECT Id, OpportunityId FROM Order WHERE OpportunityId IN (${inClause})`);
  }, ibSignedOppIds);
  const ibOrderedOppIds = new Set(ibOrders.map(o => o.OpportunityId));

  const ibContractMetrics = {};
  for (const name of IB_BO_NAMES) {
    const userId = userMap[name];
    const pc = ibContracts.filter(c => c.Opportunity__r?.BOUser__c === userId);
    const signed = pc.filter(c => c.ContractStatus__c === '계약서명완료');
    const pending = pc.filter(c => c.ContractStatus__c !== '계약서명완료');

    const signedOppIdsP = [...new Set(signed.map(c => c.Opportunity__c))];
    const withOrder = signedOppIdsP.filter(id => ibOrderedOppIds.has(id));

    const tablets = signed.reduce((s, c) => s + (c.Opportunity__r?.TotalNumberofEveryTablet__c || 0), 0);

    const wc = { 1: 0, 2: 0, 3: 0, 4: 0 };
    pc.forEach(c => {
      const day = new Date(c.CreatedDate).getUTCDate();
      wc[Math.min(4, Math.ceil(day / 7))]++;
    });

    ibContractMetrics[name] = {
      total: pc.length, signed: signed.length, pending: pending.length,
      orderCompletion: {
        signedOpps: signedOppIdsP.length, withOrder: withOrder.length,
        rate: signedOppIdsP.length > 0 ? ((withOrder.length / signedOppIdsP.length) * 100).toFixed(1) + '%' : '0.0%',
      },
      tablets, weeklyContracts: wc,
    };
    console.log(`  ${name}: contracts=${pc.length} signed=${signed.length} order=${ibContractMetrics[name].orderCompletion.rate} tablets=${tablets}`);
  }

  // ==========================================
  // 5. CH BO: same as before
  // ==========================================
  console.log('\n[5] CH BO...');
  const chBoIds = CH_BO_NAMES.map(n => userMap[n]);
  const chBoFilter = chBoIds.map(id => `'${id}'`).join(',');

  const chContracts = await sf.queryAll(`
    SELECT Id, Name, OwnerId, Owner.Name, ContractStatus__c, CreatedDate,
           ContractSignedDate__c, Opportunity__c,
           Opportunity__r.TotalNumberofEveryTablet__c
    FROM Contract__c
    WHERE OwnerId IN (${chBoFilter})
      AND CreatedDate >= ${startDate} AND CreatedDate < ${endDate}
  `);

  const chSignedOppIds = [...new Set(
    chContracts.filter(c => c.ContractStatus__c === '계약서명완료').map(c => c.Opportunity__c).filter(Boolean)
  )];
  let chOrders = [];
  if (chSignedOppIds.length > 0) {
    chOrders = await batchQuery(async (batch) => {
      const inClause = batch.map(id => `'${id}'`).join(',');
      return sf.queryAll(`SELECT Id, OpportunityId FROM Order WHERE OpportunityId IN (${inClause})`);
    }, chSignedOppIds);
  }
  const chOrderedOppIds = new Set(chOrders.map(o => o.OpportunityId));

  // CH open contracts
  const chOpenContracts = await sf.queryAll(`
    SELECT Id, Name, OwnerId, Owner.Name, ContractStatus__c, CreatedDate,
           Opportunity__c, Opportunity__r.Account.Name
    FROM Contract__c
    WHERE OwnerId IN (${chBoFilter})
      AND ContractStatus__c IN ('계약서명대기','계약서발송완료','계약서발송','사전심사발송','사전심사','계약서작성필요','견적변동')
  `);

  const chOpenOppIds = [...new Set(chOpenContracts.map(c => c.Opportunity__c).filter(Boolean))];
  let chOpenTasks = [];
  if (chOpenOppIds.length > 0) {
    chOpenTasks = await batchQuery(async (batch) => {
      const inClause = batch.map(id => `'${id}'`).join(',');
      return sf.queryAll(`SELECT Id, WhatId, ActivityDate, CreatedDate FROM Task WHERE WhatId IN (${inClause})`);
    }, chOpenOppIds);
  }
  const chTaskMap = {};
  for (const t of chOpenTasks) {
    const td = t.ActivityDate || t.CreatedDate?.substring(0, 10);
    if (!chTaskMap[t.WhatId] || td > chTaskMap[t.WhatId]) chTaskMap[t.WhatId] = td;
  }

  const chMetrics = {};
  for (const name of CH_BO_NAMES) {
    const userId = userMap[name];
    const pc = chContracts.filter(c => c.OwnerId === userId);
    const signed = pc.filter(c => c.ContractStatus__c === '계약서명완료');
    const pending = pc.filter(c => c.ContractStatus__c !== '계약서명완료');

    const sOppIds = [...new Set(signed.map(c => c.Opportunity__c))];
    const withOrder = sOppIds.filter(id => chOrderedOppIds.has(id));
    const tablets = signed.reduce((s, c) => s + (c.Opportunity__r?.TotalNumberofEveryTablet__c || 0), 0);

    const wc = { 1: 0, 2: 0, 3: 0, 4: 0 };
    pc.forEach(c => {
      const day = new Date(c.CreatedDate).getUTCDate();
      wc[Math.min(4, Math.ceil(day / 7))]++;
    });

    // Lead time
    const leadTime = { total: signed.length, within5days: 0 };
    signed.forEach(c => {
      if (c.ContractSignedDate__c && c.CreatedDate) {
        const days = Math.floor((new Date(c.ContractSignedDate__c) - new Date(c.CreatedDate)) / 86400000);
        if (days <= 5) leadTime.within5days++;
      }
    });
    leadTime.rate = leadTime.total > 0
      ? ((leadTime.within5days / leadTime.total) * 100).toFixed(1) + '%' : '0.0%';

    // Open contracts
    const pOpen = chOpenContracts.filter(c => c.OwnerId === userId);
    const franchiseOver7d = pOpen.filter(c => Math.floor((today - new Date(c.CreatedDate)) / 86400000) > 7);
    const individualOver10d = pOpen.filter(c => Math.floor((today - new Date(c.CreatedDate)) / 86400000) > 10);

    const noAct5d = [];
    for (const c of pOpen) {
      const lt = c.Opportunity__c ? chTaskMap[c.Opportunity__c] : null;
      if (!lt) {
        noAct5d.push({ contract: c.Name, oppId: c.Opportunity__c, account: c.Opportunity__r?.Account?.Name,
          createdDate: c.CreatedDate?.substring(0, 10), lastTaskDate: null, daysSinceTask: null });
      } else {
        const days = Math.floor((today - new Date(lt)) / 86400000);
        if (days > 5) {
          noAct5d.push({ contract: c.Name, oppId: c.Opportunity__c, account: c.Opportunity__r?.Account?.Name,
            createdDate: c.CreatedDate?.substring(0, 10), lastTaskDate: lt, daysSinceTask: days });
        }
      }
    }

    chMetrics[name] = {
      totalContracts: pc.length, signedContracts: signed.length, pendingContracts: pending.length,
      orderCompletion: {
        signedOpps: sOppIds.length, withOrder: withOrder.length,
        rate: sOppIds.length > 0 ? ((withOrder.length / sOppIds.length) * 100).toFixed(1) + '%' : '0.0%',
      },
      tablets, weeklyContracts: wc,
      franchiseLeadTime: leadTime,
      individualLeadTime: { total: 0, within7days: 0, rate: '0.0%' },
      franchiseOver7daysPending: franchiseOver7d.length,
      individualOver10daysPending: individualOver10d.length,
      noActivity5days: noAct5d.length,
      noActivity5dDetails: noAct5d,
      monthlyProcessed: signed.length,
      totalOpen: pOpen.length,
    };
    console.log(`  ${name}: contracts=${pc.length} signed=${signed.length} open=${pOpen.length} noAct5d=${noAct5d.length}`);
  }

  // ==========================================
  // 6. Build output JSON
  // ==========================================
  const output = {
    period: '2026-03',
    asOf: '2026-03-23',
    generatedAt: new Date().toISOString(),
    criteria: {
      conversionRate: '3월 생성 테이블오더 신규 Opp, 견적있는 건 대비 계약서명완료 (WIP+CL 포함 분모)',
      pendingAndActivity: '전체 Open 건 기준 (생성일 무관), Task 기반 무활동 체크',
    },
    ibBO: {},
    chBO: {},
  };

  for (const name of IB_BO_NAMES) {
    const p = ibPipeline[name];
    const c = ibContractMetrics[name];
    const o = ibOpenMetrics[name];

    output.ibBO[name] = {
      name,
      pipeline: {
        totalOpps: p.totalOpps, quotedOpps: p.quotedOpps, signedOpps: p.signedOpps,
        wipOpps: p.wipOpps, clOpps: p.clOpps, noQuoteOpps: p.noQuoteOpps,
        wipStages: p.wipStages,
      },
      conversionRate: {
        quotedOpps: p.quotedOpps, signedQuotedOpps: p.signedOpps,
        rate: p.conversionRate,
        note: '3월생성 테이블오더 신규 Opp 중 견적있는 건 대비 계약서명완료 (WIP+CL 포함)',
      },
      contracts: { total: c.total, signed: c.signed, pending: c.pending },
      orderCompletionRate: c.orderCompletion,
      monthlyTablets: c.tablets,
      weeklyContracts: c.weeklyContracts,
      openPipeline: { totalOpen: o.totalOpen, stageBreakdown: o.stageBreakdown },
      noActivity7days: {
        count: o.noActivity7days, totalOpenOpps: o.totalOpen,
        details: o.noActivity7dDetails.slice(0, 20),
        note: '전체 Open Opp 중 마지막 Task 7일 초과 or Task 없음',
      },
      over45daysPending: o.over45daysPending,
    };
  }

  for (const name of CH_BO_NAMES) {
    const m = chMetrics[name];
    output.chBO[name] = {
      name,
      contracts: { total: m.totalContracts, signed: m.signedContracts, pending: m.pendingContracts },
      orderCompletionRate: m.orderCompletion,
      monthlyTablets: m.tablets,
      weeklyContracts: m.weeklyContracts,
      franchiseLeadTime: m.franchiseLeadTime,
      individualLeadTime: m.individualLeadTime,
      franchiseOver7daysPending: m.franchiseOver7daysPending,
      individualOver10daysPending: m.individualOver10daysPending,
      noActivity5days: {
        count: m.noActivity5days, totalOpenContracts: m.totalOpen,
        details: m.noActivity5dDetails,
        note: '전체 Open Contract Opp 중 마지막 Task 5일 초과 or Task 없음',
      },
      monthlyProcessed: m.monthlyProcessed,
    };
  }

  const outputPath = path.join(__dirname, '..', 'reports', 'bo-kpi-current-2026-03.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved to ${outputPath}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('Error:', err.message || err); process.exit(1); });
