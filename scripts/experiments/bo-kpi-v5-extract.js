const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const sf = require('../server/api/services/salesforce');
const fs = require('fs');

const IB_BO_NAMES = ['전수빈', '정지영', '박효정', '조현재'];
const CH_BO_NAMES = ['최영은', '장명진', '이은지', '김희수'];
const RT_FILTER = "RecordType.Name = '1. 테이블오더 (신규)'";

async function batchQuery(queryFn, ids, batchSize = 500) {
  const results = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    results.push(...await queryFn(batch));
  }
  return results;
}

function daysBetween(from, to) {
  return Math.floor((to - new Date(from)) / 86400000);
}

function weekOfMonth(dateStr) {
  const d = new Date(dateStr);
  return Math.min(4, Math.ceil(d.getUTCDate() / 7));
}

async function main() {
  const startDate = '2026-03-01T00:00:00Z';
  const endDate = '2026-04-01T00:00:00Z';
  const today = new Date('2026-03-23');

  // 1. User IDs
  console.log('[1] Finding User IDs...');
  const allNames = [...IB_BO_NAMES, ...CH_BO_NAMES];
  const users = await sf.queryAll(`SELECT Id, Name FROM User WHERE Name IN (${allNames.map(n => `'${n}'`).join(',')})`);
  const userMap = {};
  users.forEach(u => { userMap[u.Name] = u.Id; });

  const ibBoIds = IB_BO_NAMES.map(n => userMap[n]);
  const ibBoFilter = ibBoIds.map(id => `'${id}'`).join(',');
  const chBoIds = CH_BO_NAMES.map(n => userMap[n]);
  const chBoFilter = chBoIds.map(id => `'${id}'`).join(',');

  // ==========================================
  // IB BO
  // ==========================================

  // 2. 전환율 + CW: 3월 생성 신규 Opp (LastStageChangeDate 추가)
  console.log('\n[2] IB: March 신규 Opps (with LastStageChangeDate)...');
  const marchOpps = await sf.queryAll(`
    SELECT Id, Name, StageName, BOUser__c, IsWon, IsClosed, CreatedDate, LastStageChangeDate, Account.Name
    FROM Opportunity
    WHERE BOUser__c IN (${ibBoFilter})
      AND CreatedDate >= ${startDate} AND CreatedDate < ${endDate}
      AND ${RT_FILTER}
  `);
  console.log(`  March 신규 Opps: ${marchOpps.length}`);

  const marchOppIds = marchOpps.map(o => o.Id);
  const quotes = await batchQuery(async (batch) => {
    const inC = batch.map(id => `'${id}'`).join(',');
    return sf.queryAll(`SELECT Id, OpportunityId FROM Quote WHERE OpportunityId IN (${inC})`);
  }, marchOppIds);
  const quotedSet = new Set(quotes.map(q => q.OpportunityId));

  const contracts = await batchQuery(async (batch) => {
    const inC = batch.map(id => `'${id}'`).join(',');
    return sf.queryAll(`SELECT Id, Opportunity__c FROM Contract__c WHERE Opportunity__c IN (${inC}) AND ContractStatus__c = '계약서명완료'`);
  }, marchOppIds);
  const signedSet = new Set(contracts.map(c => c.Opportunity__c));

  // 3. Open 신규 Opps (all dates) + Tasks
  console.log('[3] IB: All Open 신규 Opps...');
  const ibOpenOpps = await sf.queryAll(`
    SELECT Id, Name, StageName, BOUser__c, CreatedDate, Account.Name
    FROM Opportunity
    WHERE BOUser__c IN (${ibBoFilter}) AND IsClosed = false AND ${RT_FILTER}
  `);
  console.log(`  Open 신규: ${ibOpenOpps.length}`);

  const ibOpenTasks = await batchQuery(async (batch) => {
    const inC = batch.map(id => `'${id}'`).join(',');
    return sf.queryAll(`SELECT Id, WhatId, ActivityDate, CreatedDate FROM Task WHERE WhatId IN (${inC})`);
  }, ibOpenOpps.map(o => o.Id));

  const ibTaskMap = {}, ibTaskCount = {};
  for (const t of ibOpenTasks) {
    const td = t.ActivityDate || t.CreatedDate?.substring(0, 10);
    if (!ibTaskMap[t.WhatId] || td > ibTaskMap[t.WhatId]) ibTaskMap[t.WhatId] = td;
    ibTaskCount[t.WhatId] = (ibTaskCount[t.WhatId] || 0) + 1;
  }

  // 4. Contracts (March, 신규)
  console.log('[4] IB: March Contracts...');
  const ibContracts = await sf.queryAll(`
    SELECT Id, Name, OwnerId, ContractStatus__c, CreatedDate, Opportunity__c,
           Opportunity__r.BOUser__c, Opportunity__r.TotalNumberofEveryTablet__c
    FROM Contract__c
    WHERE Opportunity__r.BOUser__c IN (${ibBoFilter})
      AND CreatedDate >= ${startDate} AND CreatedDate < ${endDate}
      AND Opportunity__r.${RT_FILTER}
  `);
  console.log(`  IB Contracts: ${ibContracts.length}`);

  const ibSignedOppIds = [...new Set(ibContracts.filter(c => c.ContractStatus__c === '계약서명완료').map(c => c.Opportunity__c).filter(Boolean))];
  const ibOrders = await batchQuery(async (batch) => {
    const inC = batch.map(id => `'${id}'`).join(',');
    return sf.queryAll(`SELECT Id, OpportunityId FROM Order WHERE OpportunityId IN (${inC})`);
  }, ibSignedOppIds);
  const ibOrderSet = new Set(ibOrders.map(o => o.OpportunityId));

  // Build IB results
  const ibResults = {};
  for (const name of IB_BO_NAMES) {
    const uid = userMap[name];

    // Pipeline (March)
    const pOpps = marchOpps.filter(o => o.BOUser__c === uid);
    const pQuoted = pOpps.filter(o => quotedSet.has(o.Id));
    const pSigned = pQuoted.filter(o => signedSet.has(o.Id));
    const pWip = pQuoted.filter(o => !o.IsClosed);
    const pCl = pQuoted.filter(o => o.IsClosed && !o.IsWon);
    const wipStages = {};
    pWip.forEach(o => { wipStages[o.StageName] = (wipStages[o.StageName] || 0) + 1; });
    const convRate = pQuoted.length > 0 ? ((pSigned.length / pQuoted.length) * 100).toFixed(1) + '%' : '0.0%';

    // CW conversion rate: CW opps with quotes / all quoted opps
    const pCW = pOpps.filter(o => o.StageName === 'Closed Won' && o.LastStageChangeDate);
    const pCWQuoted = pCW.filter(o => quotedSet.has(o.Id));
    const cwConvRate = pQuoted.length > 0 ? ((pCWQuoted.length / pQuoted.length) * 100).toFixed(1) + '%' : '0.0%';

    // Weekly CW counts (based on LastStageChangeDate)
    const weeklyCW = { 1: 0, 2: 0, 3: 0, 4: 0 };
    pCW.forEach(o => {
      const lsd = o.LastStageChangeDate;
      if (lsd && lsd >= '2026-03-01' && lsd < '2026-04-01') {
        weeklyCW[weekOfMonth(lsd)]++;
      }
    });

    // Contracts
    const pc = ibContracts.filter(c => c.Opportunity__r?.BOUser__c === uid);
    const pcSigned = pc.filter(c => c.ContractStatus__c === '계약서명완료');
    const pcSOppIds = [...new Set(pcSigned.map(c => c.Opportunity__c))];
    const pcWithOrder = pcSOppIds.filter(id => ibOrderSet.has(id));
    const tablets = pcSigned.reduce((s, c) => s + (c.Opportunity__r?.TotalNumberofEveryTablet__c || 0), 0);
    const wc = { 1: 0, 2: 0, 3: 0, 4: 0 };
    pc.forEach(c => { wc[Math.min(4, Math.ceil(new Date(c.CreatedDate).getUTCDate() / 7))]++; });

    // Open (신규 only)
    const pOpen = ibOpenOpps.filter(o => o.BOUser__c === uid);
    const stageBreakdown = {};
    pOpen.forEach(o => { stageBreakdown[o.StageName] = (stageBreakdown[o.StageName] || 0) + 1; });

    // Activity classification
    const active = [], loose = [], stale = [], noTask = [];
    for (const opp of pOpen) {
      const lt = ibTaskMap[opp.Id];
      const cnt = ibTaskCount[opp.Id] || 0;
      const daysOld = daysBetween(opp.CreatedDate, today);
      const row = { name: opp.Name, account: opp.Account?.Name, stage: opp.StageName,
        createdDate: opp.CreatedDate?.substring(0, 10), daysOld, lastTaskDate: lt || null,
        daysSinceTask: lt ? daysBetween(lt, today) : null, totalTasks: cnt };
      if (!lt) noTask.push(row);
      else if (row.daysSinceTask <= 7) active.push(row);
      else if (row.daysSinceTask <= 30) loose.push(row);
      else stale.push(row);
    }

    const noActivity7d = pOpen.filter(o => {
      const lt = ibTaskMap[o.Id];
      return !lt || daysBetween(lt, today) > 7;
    }).length;

    const over45d = pOpen.filter(o => daysBetween(o.CreatedDate, today) >= 45).length;

    const noTaskStages = {};
    noTask.forEach(r => { noTaskStages[r.stage] = (noTaskStages[r.stage] || 0) + 1; });

    ibResults[name] = {
      name,
      pipeline: { totalOpps: pOpps.length, quotedOpps: pQuoted.length, signedOpps: pSigned.length,
        wipOpps: pWip.length, clOpps: pCl.length, noQuoteOpps: pOpps.length - pQuoted.length, wipStages },
      conversionRate: { quotedOpps: pQuoted.length, signedQuotedOpps: pSigned.length, rate: convRate },
      cwConversionRate: { quotedOpps: pQuoted.length, cwOpps: pCWQuoted.length, rate: cwConvRate },
      weeklyCW,
      contracts: { total: pc.length, signed: pcSigned.length, pending: pc.length - pcSigned.length },
      orderCompletionRate: { signedOpps: pcSOppIds.length, withOrder: pcWithOrder.length,
        rate: pcSOppIds.length > 0 ? ((pcWithOrder.length / pcSOppIds.length) * 100).toFixed(1) + '%' : '0.0%' },
      monthlyTablets: tablets,
      weeklyContracts: wc,
      openPipeline: { totalOpen: pOpen.length, stageBreakdown },
      activityClassification: {
        active: active.length, loose: loose.length, stale: stale.length, noTask: noTask.length,
        noTaskStages, staleDetails: stale, noTaskDetails: noTask,
      },
      noActivity7days: { count: noActivity7d, totalOpenOpps: pOpen.length },
      over45daysPending: over45d,
    };

    console.log(`  ${name}: pipeline ${pOpps.length}→quoted ${pQuoted.length}→CW ${pCWQuoted.length} (${cwConvRate}) | signed ${pSigned.length} (${convRate}) | weeklyCW [${weeklyCW[1]},${weeklyCW[2]},${weeklyCW[3]},${weeklyCW[4]}]`);
  }

  // ==========================================
  // CH BO
  // ==========================================
  console.log('\n[5] CH BO: March Contracts (신규)...');
  const chContracts = await sf.queryAll(`
    SELECT Id, Name, OwnerId, Owner.Name, ContractStatus__c, CreatedDate,
           ContractSignedDate__c, Opportunity__c,
           Opportunity__r.TotalNumberofEveryTablet__c
    FROM Contract__c
    WHERE OwnerId IN (${chBoFilter})
      AND CreatedDate >= ${startDate} AND CreatedDate < ${endDate}
      AND Opportunity__r.${RT_FILTER}
  `);
  console.log(`  CH Contracts (신규): ${chContracts.length}`);

  // CH: Get Opps linked to CH contracts for CW conversion + weekly CW
  // CH BO owns Contract__c, not Opportunity — link through Contract__c.Opportunity__c
  const chContractOppIds = [...new Set(chContracts.map(c => c.Opportunity__c).filter(Boolean))];
  console.log('[5b] CH BO: Querying Opps linked to CH contracts...');
  let chLinkedOpps = [];
  if (chContractOppIds.length > 0) {
    chLinkedOpps = await batchQuery(async (batch) => {
      const inC = batch.map(id => `'${id}'`).join(',');
      return sf.queryAll(`SELECT Id, Name, StageName, IsWon, IsClosed, CreatedDate, LastStageChangeDate FROM Opportunity WHERE Id IN (${inC})`);
    }, chContractOppIds);
  }
  const chLinkedOppMap = {};
  chLinkedOpps.forEach(o => { chLinkedOppMap[o.Id] = o; });
  console.log(`  CH linked Opps: ${chLinkedOpps.length}`);

  // Quotes for CH linked opps
  let chQuotes = [];
  if (chContractOppIds.length > 0) {
    chQuotes = await batchQuery(async (batch) => {
      const inC = batch.map(id => `'${id}'`).join(',');
      return sf.queryAll(`SELECT Id, OpportunityId FROM Quote WHERE OpportunityId IN (${inC})`);
    }, chContractOppIds);
  }
  const chQuotedSet = new Set(chQuotes.map(q => q.OpportunityId));

  const chSignedOppIds = [...new Set(chContracts.filter(c => c.ContractStatus__c === '계약서명완료').map(c => c.Opportunity__c).filter(Boolean))];
  let chOrders = [];
  if (chSignedOppIds.length > 0) {
    chOrders = await batchQuery(async (batch) => {
      const inC = batch.map(id => `'${id}'`).join(',');
      return sf.queryAll(`SELECT Id, OpportunityId FROM Order WHERE OpportunityId IN (${inC})`);
    }, chSignedOppIds);
  }
  const chOrderSet = new Set(chOrders.map(o => o.OpportunityId));

  // CH open contracts (신규 only)
  console.log('[6] CH: Open Contracts (신규)...');
  const chOpenContracts = await sf.queryAll(`
    SELECT Id, Name, OwnerId, ContractStatus__c, CreatedDate,
           Opportunity__c, Opportunity__r.Account.Name
    FROM Contract__c
    WHERE OwnerId IN (${chBoFilter})
      AND ContractStatus__c IN ('계약서명대기','계약서발송완료','계약서발송','사전심사발송','사전심사','계약서작성필요','견적변동')
      AND Opportunity__r.${RT_FILTER}
  `);
  console.log(`  CH Open (신규): ${chOpenContracts.length}`);

  const chOpenOppIds = [...new Set(chOpenContracts.map(c => c.Opportunity__c).filter(Boolean))];
  let chOpenTasks = [];
  if (chOpenOppIds.length > 0) {
    chOpenTasks = await batchQuery(async (batch) => {
      const inC = batch.map(id => `'${id}'`).join(',');
      return sf.queryAll(`SELECT Id, WhatId, ActivityDate, CreatedDate FROM Task WHERE WhatId IN (${inC})`);
    }, chOpenOppIds);
  }
  const chTaskMap = {}, chTaskCount = {};
  for (const t of chOpenTasks) {
    const td = t.ActivityDate || t.CreatedDate?.substring(0, 10);
    if (!chTaskMap[t.WhatId] || td > chTaskMap[t.WhatId]) chTaskMap[t.WhatId] = td;
    chTaskCount[t.WhatId] = (chTaskCount[t.WhatId] || 0) + 1;
  }

  const chResults = {};
  for (const name of CH_BO_NAMES) {
    const uid = userMap[name];
    const pc = chContracts.filter(c => c.OwnerId === uid);
    const pcSigned = pc.filter(c => c.ContractStatus__c === '계약서명완료');
    const sOppIds = [...new Set(pcSigned.map(c => c.Opportunity__c))];
    const withOrder = sOppIds.filter(id => chOrderSet.has(id));
    const tablets = pcSigned.reduce((s, c) => s + (c.Opportunity__r?.TotalNumberofEveryTablet__c || 0), 0);
    const wc = { 1: 0, 2: 0, 3: 0, 4: 0 };
    pc.forEach(c => { wc[Math.min(4, Math.ceil(new Date(c.CreatedDate).getUTCDate() / 7))]++; });

    // Conversion rates for CH (via contract-linked opps)
    const chUserOppIds = [...new Set(pc.map(c => c.Opportunity__c).filter(Boolean))];
    const chUserOpps = chUserOppIds.map(id => chLinkedOppMap[id]).filter(Boolean);
    const chMarchUserOpps = chUserOpps.filter(o => o.CreatedDate >= startDate && o.CreatedDate < endDate);
    const chpQuoted = chMarchUserOpps.filter(o => chQuotedSet.has(o.Id));

    // 견적→계약서명완료 conversion
    const chSignedOppSet = new Set(sOppIds);
    const chpSignedQuoted = chpQuoted.filter(o => chSignedOppSet.has(o.Id));
    const chConvRate = chpQuoted.length > 0 ? ((chpSignedQuoted.length / chpQuoted.length) * 100).toFixed(1) + '%' : '0.0%';

    // 견적→CW conversion
    const chpCW = chMarchUserOpps.filter(o => o.StageName === 'Closed Won' && o.LastStageChangeDate);
    const chpCWQuoted = chpCW.filter(o => chQuotedSet.has(o.Id));
    const chCwConvRate = chpQuoted.length > 0 ? ((chpCWQuoted.length / chpQuoted.length) * 100).toFixed(1) + '%' : '0.0%';

    // Weekly CW counts (from contract-linked CW opps, by LastStageChangeDate)
    const chWeeklyCW = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const chCWAll = chUserOpps.filter(o => o.StageName === 'Closed Won' && o.LastStageChangeDate);
    chCWAll.forEach(o => {
      const lsd = o.LastStageChangeDate;
      if (lsd && lsd >= '2026-03-01' && lsd < '2026-04-01') {
        chWeeklyCW[weekOfMonth(lsd)]++;
      }
    });

    // Lead time
    const lt = { total: pcSigned.length, within5days: 0 };
    pcSigned.forEach(c => {
      if (c.ContractSignedDate__c && c.CreatedDate) {
        if (daysBetween(c.CreatedDate, new Date(c.ContractSignedDate__c)) <= 5) lt.within5days++;
      }
    });
    lt.rate = lt.total > 0 ? ((lt.within5days / lt.total) * 100).toFixed(1) + '%' : '0.0%';

    // Open contracts (신규)
    const pOpen = chOpenContracts.filter(c => c.OwnerId === uid);
    const franchiseOver7d = pOpen.filter(c => daysBetween(c.CreatedDate, today) > 7).length;
    const individualOver10d = pOpen.filter(c => daysBetween(c.CreatedDate, today) > 10).length;

    // Activity classification
    const active = [], loose = [], stale = [], noTask = [];
    for (const c of pOpen) {
      const lastT = c.Opportunity__c ? chTaskMap[c.Opportunity__c] : null;
      const cnt = c.Opportunity__c ? (chTaskCount[c.Opportunity__c] || 0) : 0;
      const daysOld = daysBetween(c.CreatedDate, today);
      const row = { contract: c.Name, account: c.Opportunity__r?.Account?.Name,
        createdDate: c.CreatedDate?.substring(0, 10), daysOld, lastTaskDate: lastT || null,
        daysSinceTask: lastT ? daysBetween(lastT, today) : null, totalTasks: cnt };
      if (!lastT) noTask.push(row);
      else if (row.daysSinceTask <= 5) active.push(row);
      else if (row.daysSinceTask <= 30) loose.push(row);
      else stale.push(row);
    }

    const noActivity5d = pOpen.filter(c => {
      const lt2 = c.Opportunity__c ? chTaskMap[c.Opportunity__c] : null;
      return !lt2 || daysBetween(lt2, today) > 5;
    }).length;

    const over45d = pOpen.filter(c => daysBetween(c.CreatedDate, today) >= 45).length;

    chResults[name] = {
      name,
      conversionRate: { quotedOpps: chpQuoted.length, signedQuotedOpps: chpSignedQuoted.length, rate: chConvRate },
      cwConversionRate: { quotedOpps: chpQuoted.length, cwOpps: chpCWQuoted.length, rate: chCwConvRate },
      weeklyCW: chWeeklyCW,
      contracts: { total: pc.length, signed: pcSigned.length, pending: pc.length - pcSigned.length },
      orderCompletionRate: { signedOpps: sOppIds.length, withOrder: withOrder.length,
        rate: sOppIds.length > 0 ? ((withOrder.length / sOppIds.length) * 100).toFixed(1) + '%' : '0.0%' },
      monthlyTablets: tablets,
      weeklyContracts: wc,
      franchiseLeadTime: lt,
      individualLeadTime: { total: 0, within7days: 0, rate: '0.0%' },
      franchiseOver7daysPending: franchiseOver7d,
      individualOver10daysPending: individualOver10d,
      openPipeline: { totalOpen: pOpen.length },
      activityClassification: {
        active: active.length, loose: loose.length, stale: stale.length, noTask: noTask.length,
        staleDetails: stale, noTaskDetails: noTask,
      },
      noActivity5days: { count: noActivity5d, totalOpenContracts: pOpen.length },
      over45daysPending: over45d,
      monthlyProcessed: pcSigned.length,
    };

    console.log(`  ${name}: 계약${chConvRate}(${chpSignedQuoted.length}/${chpQuoted.length}) CW${chCwConvRate}(${chpCWQuoted.length}/${chpQuoted.length}) | weeklyCW [${chWeeklyCW[1]},${chWeeklyCW[2]},${chWeeklyCW[3]},${chWeeklyCW[4]}] | contracts ${pc.length}/${pcSigned.length}`);
  }

  // Output
  const output = {
    period: '2026-03', asOf: '2026-03-23', generatedAt: new Date().toISOString(),
    criteria: {
      recordType: '테이블오더 신규만 (CCTV/추가설치/멀티오더/추가구매 제외)',
      conversionRate: '3월 생성 신규 Opp 중 견적있는 건 대비 계약서명완료 (WIP+CL 포함 분모)',
      cwConversionRate: '3월 생성 신규 Opp 중 견적있는 건 대비 CW(마감) 건 (WIP+CL+CW 포함 분모)',
      weeklyCW: 'CW(마감) 건수를 LastStageChangeDate 기준 주차별 집계',
      pendingAndActivity: '전체 Open 신규 건 기준, Task 기반 무활동',
    },
    ibBO: ibResults, chBO: chResults,
  };

  const outputPath = path.join(__dirname, '..', 'reports', 'bo-kpi-current-2026-03.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved to ${outputPath}`);
}

main().then(() => process.exit(0)).catch(err => { console.error('Error:', err.message || err); process.exit(1); });
