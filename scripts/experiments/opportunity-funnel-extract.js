const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sf = require('../dashboard/backend/services/salesforce');

async function extractOpportunityFunnel(quarter = '2026-Q1') {
  // Parse quarter
  const [year, q] = quarter.split('-Q');
  const qNum = parseInt(q, 10);
  const startMonth = (qNum - 1) * 3 + 1;
  const endMonth = startMonth + 3;
  const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01T00:00:00Z`;
  const endDate = endMonth <= 12
    ? `${year}-${String(endMonth).padStart(2, '0')}-01T00:00:00Z`
    : `${parseInt(year) + 1}-01-01T00:00:00Z`;

  const departments = ['인바운드세일즈', '채널세일즈팀'];
  const deptFilter = departments.map(d => `'${d}'`).join(', ');

  console.log(`[funnel] Extracting ${quarter} (${startDate} ~ ${endDate})`);
  console.log(`[funnel] Departments: ${departments.join(', ')}`);

  // 1. Opportunities
  console.log('[funnel] Querying Opportunities...');
  const opps = await sf.queryAll(`
    SELECT Id, Name, StageName, CreatedDate, CloseDate, LastStageChangeDate,
           OwnerId, Owner.Name, Owner_Department__c,
           AccountId, Account.Name, Account.CompanyStatus__c, Account.StoreType__c,
           Amount, LeadSource, IsWon, IsClosed,
           Type, fm_OpportunityRecordTypeDeveloperName__c
    FROM Opportunity
    WHERE CreatedDate >= ${startDate} AND CreatedDate < ${endDate}
      AND Owner_Department__c IN (${deptFilter})
    ORDER BY CreatedDate ASC
  `);
  console.log(`[funnel] Opportunities: ${opps.length}`);

  const oppIds = opps.map(o => o.Id);
  if (oppIds.length === 0) {
    console.log('[funnel] No opportunities found.');
    return { opportunities: [], funnel: [] };
  }

  // Build IN clause in batches (SF limit ~20K chars)
  const batchQuery = async (queryFn, ids, batchSize = 500) => {
    const results = [];
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const batchResults = await queryFn(batch);
      results.push(...batchResults);
    }
    return results;
  };

  // 2. Quotes (첫 견적)
  console.log('[funnel] Querying Quotes...');
  const quotes = await batchQuery(async (batch) => {
    const inClause = batch.map(id => `'${id}'`).join(',');
    return sf.queryAll(`
      SELECT Id, OpportunityId, CreatedDate, FinalQuoteCheck__c, Status
      FROM Quote
      WHERE OpportunityId IN (${inClause})
      ORDER BY CreatedDate ASC
    `);
  }, oppIds);
  console.log(`[funnel] Quotes: ${quotes.length}`);

  // 3. Contracts (최종 계약 = 계약서명완료)
  console.log('[funnel] Querying Contracts (계약서명완료)...');
  const contracts = await batchQuery(async (batch) => {
    const inClause = batch.map(id => `'${id}'`).join(',');
    return sf.queryAll(`
      SELECT Id, Opportunity__c, CreatedDate, ContractCreateDate__c, ContractSignedDate__c,
             ContractStatus__c, ContractType__c
      FROM Contract__c
      WHERE Opportunity__c IN (${inClause})
        AND ContractStatus__c = '계약서명완료'
      ORDER BY CreatedDate ASC
    `);
  }, oppIds);
  console.log(`[funnel] Contracts (서명완료): ${contracts.length}`);

  // 4. Orders (첫 출고신청)
  console.log('[funnel] Querying Orders...');
  const orders = await batchQuery(async (batch) => {
    const inClause = batch.map(id => `'${id}'`).join(',');
    return sf.queryAll(`
      SELECT Id, OpportunityId, CreatedDate, EffectiveDate, Status, OutputDate__c
      FROM Order
      WHERE OpportunityId IN (${inClause})
      ORDER BY CreatedDate ASC
    `);
  }, oppIds);
  console.log(`[funnel] Orders: ${orders.length}`);

  // Build lookup maps (first record per opportunity)
  const firstByOpp = (records, oppIdField) => {
    const map = {};
    for (const r of records) {
      const oppId = r[oppIdField];
      if (!map[oppId]) map[oppId] = r;
    }
    return map;
  };

  const firstQuote = firstByOpp(quotes, 'OpportunityId');
  const firstContract = firstByOpp(contracts, 'Opportunity__c');
  const firstOrder = firstByOpp(orders, 'OpportunityId');

  // 5. Build funnel data
  const funnel = opps.map(opp => {
    const q = firstQuote[opp.Id];
    const c = firstContract[opp.Id];
    const o = firstOrder[opp.Id];

    const created = opp.CreatedDate;
    const quoteDate = q ? q.CreatedDate : null;
    const contractDate = c ? (c.ContractCreateDate__c || c.CreatedDate) : null;
    const orderDate = o ? o.CreatedDate : null;
    const outputDate = o ? o.OutputDate__c : null; // 실제 출고완료일
    // LastStageChangeDate = 실제 CW 처리일, CloseDate = 예상 마감일(분기말 기본값)
    const cwDate = opp.IsWon ? (opp.LastStageChangeDate || opp.CloseDate) : null;

    // Calculate days between stages
    const daysBetween = (from, to) => {
      if (!from || !to) return null;
      const d1 = new Date(from);
      const d2 = new Date(to);
      return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    };

    return {
      opportunityId: opp.Id,
      name: opp.Name,
      accountName: opp.Account?.Name,
      companyStatus: opp.Account?.CompanyStatus__c || null,
      storeType: opp.Account?.StoreType__c || null,
      stageName: opp.StageName,
      ownerName: opp.Owner?.Name,
      department: opp.Owner_Department__c,
      leadSource: opp.LeadSource,
      amount: opp.Amount,
      isWon: opp.IsWon,
      isClosed: opp.IsClosed,
      // Timestamps
      timestamps: {
        created,
        firstQuote: quoteDate,
        firstContract: contractDate,
        firstOrder: orderDate,
        outputDate,
        closedWon: cwDate,
      },
      // Days between stages
      daysToQuote: daysBetween(created, quoteDate),
      daysToContract: daysBetween(created, contractDate),
      daysToOrder: daysBetween(created, orderDate),
      daysToOutput: daysBetween(created, outputDate),
      daysToCW: daysBetween(created, cwDate),
      daysQuoteToContract: daysBetween(quoteDate, contractDate),
      daysContractToOrder: daysBetween(contractDate, orderDate),
      daysOrderToOutput: daysBetween(orderDate, outputDate),
      daysOutputToCW: daysBetween(outputDate, cwDate),
      daysOrderToCW: daysBetween(orderDate, cwDate),
    };
  });

  // 6. Summary stats
  const won = funnel.filter(f => f.isWon);
  const withQuote = funnel.filter(f => f.timestamps.firstQuote);
  const withContract = funnel.filter(f => f.timestamps.firstContract);
  const withOrder = funnel.filter(f => f.timestamps.firstOrder);
  const withOutput = funnel.filter(f => f.timestamps.outputDate);

  const avgDays = (arr, field) => {
    const valid = arr.map(f => f[field]).filter(d => d !== null && d >= 0);
    return valid.length > 0 ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
  };

  const medianDays = (arr, field) => {
    const valid = arr.map(f => f[field]).filter(d => d !== null && d >= 0).sort((a, b) => a - b);
    if (valid.length === 0) return null;
    const mid = Math.floor(valid.length / 2);
    return valid.length % 2 === 0 ? Math.round((valid[mid - 1] + valid[mid]) / 2) : valid[mid];
  };

  // Per-department summary
  const deptSummary = {};
  for (const dept of departments) {
    const deptFunnel = funnel.filter(f => f.department === dept);
    const deptWon = deptFunnel.filter(f => f.isWon);
    deptSummary[dept] = {
      total: deptFunnel.length,
      won: deptWon.length,
      withQuote: deptFunnel.filter(f => f.timestamps.firstQuote).length,
      withContract: deptFunnel.filter(f => f.timestamps.firstContract).length,
      withOrder: deptFunnel.filter(f => f.timestamps.firstOrder).length,
      withOutput: deptFunnel.filter(f => f.timestamps.outputDate).length,
      conversionRate: deptFunnel.length > 0
        ? `${((deptWon.length / deptFunnel.length) * 100).toFixed(1)}%` : '0%',
      avgDays: {
        toQuote: avgDays(deptFunnel, 'daysToQuote'),
        toContract: avgDays(deptFunnel, 'daysToContract'),
        toOrder: avgDays(deptFunnel, 'daysToOrder'),
        toOutput: avgDays(deptFunnel, 'daysToOutput'),
        toCW: avgDays(deptWon, 'daysToCW'),
        quoteToContract: avgDays(deptFunnel, 'daysQuoteToContract'),
        contractToOrder: avgDays(deptFunnel, 'daysContractToOrder'),
        orderToOutput: avgDays(deptFunnel, 'daysOrderToOutput'),
        outputToCW: avgDays(deptFunnel, 'daysOutputToCW'),
        orderToCW: avgDays(deptFunnel, 'daysOrderToCW'),
      },
      medianDays: {
        toQuote: medianDays(deptFunnel, 'daysToQuote'),
        toContract: medianDays(deptFunnel, 'daysToContract'),
        toOrder: medianDays(deptFunnel, 'daysToOrder'),
        toOutput: medianDays(deptFunnel, 'daysToOutput'),
        toCW: medianDays(deptWon, 'daysToCW'),
        quoteToContract: medianDays(deptFunnel, 'daysQuoteToContract'),
        contractToOrder: medianDays(deptFunnel, 'daysContractToOrder'),
        orderToOutput: medianDays(deptFunnel, 'daysOrderToOutput'),
        outputToCW: medianDays(deptFunnel, 'daysOutputToCW'),
        orderToCW: medianDays(deptFunnel, 'daysOrderToCW'),
      },
    };
  }

  const summary = {
    quarter,
    period: { start: startDate, end: endDate },
    departments,
    total: funnel.length,
    won: won.length,
    lost: funnel.filter(f => f.isClosed && !f.isWon).length,
    inProgress: funnel.filter(f => !f.isClosed).length,
    withQuote: withQuote.length,
    withContract: withContract.length,
    withOrder: withOrder.length,
    withOutput: withOutput.length,
    conversionRate: funnel.length > 0
      ? `${((won.length / funnel.length) * 100).toFixed(1)}%` : '0%',
    avgDays: {
      toQuote: avgDays(funnel, 'daysToQuote'),
      toContract: avgDays(funnel, 'daysToContract'),
      toOrder: avgDays(funnel, 'daysToOrder'),
      toOutput: avgDays(funnel, 'daysToOutput'),
      toCW: avgDays(won, 'daysToCW'),
      quoteToContract: avgDays(funnel, 'daysQuoteToContract'),
      contractToOrder: avgDays(funnel, 'daysContractToOrder'),
      orderToOutput: avgDays(funnel, 'daysOrderToOutput'),
      outputToCW: avgDays(funnel, 'daysOutputToCW'),
      orderToCW: avgDays(funnel, 'daysOrderToCW'),
    },
    medianDays: {
      toQuote: medianDays(funnel, 'daysToQuote'),
      toContract: medianDays(funnel, 'daysToContract'),
      toOrder: medianDays(funnel, 'daysToOrder'),
      toOutput: medianDays(funnel, 'daysToOutput'),
      toCW: medianDays(won, 'daysToCW'),
      quoteToContract: medianDays(funnel, 'daysQuoteToContract'),
      contractToOrder: medianDays(funnel, 'daysContractToOrder'),
      orderToOutput: medianDays(funnel, 'daysOrderToOutput'),
      outputToCW: medianDays(funnel, 'daysOutputToCW'),
      orderToCW: medianDays(funnel, 'daysOrderToCW'),
    },
    byDepartment: deptSummary,
    byCompanyStatus: (() => {
      const statusGroups = {};
      for (const f of funnel) {
        const status = f.companyStatus || '(미지정)';
        if (!statusGroups[status]) statusGroups[status] = { total: 0, won: 0, lost: 0, inProgress: 0 };
        statusGroups[status].total++;
        if (f.isWon) statusGroups[status].won++;
        else if (f.isClosed) statusGroups[status].lost++;
        else statusGroups[status].inProgress++;
      }
      for (const [status, data] of Object.entries(statusGroups)) {
        data.conversionRate = data.total > 0
          ? `${((data.won / data.total) * 100).toFixed(1)}%` : '0%';
        const statusFunnel = funnel.filter(f => (f.companyStatus || '(미지정)') === status);
        const statusWon = statusFunnel.filter(f => f.isWon);
        data.avgDays = {
          toQuote: avgDays(statusFunnel, 'daysToQuote'),
          toContract: avgDays(statusFunnel, 'daysToContract'),
          toOrder: avgDays(statusFunnel, 'daysToOrder'),
          toOutput: avgDays(statusFunnel, 'daysToOutput'),
          toCW: avgDays(statusWon, 'daysToCW'),
          quoteToContract: avgDays(statusFunnel, 'daysQuoteToContract'),
          orderToOutput: avgDays(statusFunnel, 'daysOrderToOutput'),
          outputToCW: avgDays(statusFunnel, 'daysOutputToCW'),
          orderToCW: avgDays(statusFunnel, 'daysOrderToCW'),
        };
        data.medianDays = {
          toQuote: medianDays(statusFunnel, 'daysToQuote'),
          toContract: medianDays(statusFunnel, 'daysToContract'),
          toOrder: medianDays(statusFunnel, 'daysToOrder'),
          toOutput: medianDays(statusFunnel, 'daysToOutput'),
          toCW: medianDays(statusWon, 'daysToCW'),
          quoteToContract: medianDays(statusFunnel, 'daysQuoteToContract'),
          orderToOutput: medianDays(statusFunnel, 'daysOrderToOutput'),
          outputToCW: medianDays(statusFunnel, 'daysOutputToCW'),
          orderToCW: medianDays(statusFunnel, 'daysOrderToCW'),
        };
      }
      return statusGroups;
    })(),
    generatedAt: new Date().toISOString(),
  };

  console.log('\n=== Funnel Summary ===');
  console.log(JSON.stringify(summary, null, 2));

  // Save to file
  const fs = require('fs');
  const outputDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `opportunity-funnel-${quarter}.json`);
  fs.writeFileSync(outputPath, JSON.stringify({ summary, funnel }, null, 2));
  console.log(`\n[funnel] Saved to ${outputPath}`);

  return { summary, funnel };
}

module.exports = { extractOpportunityFunnel };

if (require.main === module) {
  const quarter = process.argv[2] || '2026-Q1';
  extractOpportunityFunnel(quarter)
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[funnel] Error:', err.message || err);
      process.exit(1);
    });
}
