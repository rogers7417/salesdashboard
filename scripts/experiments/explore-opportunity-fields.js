const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sf = require('../dashboard/backend/services/salesforce');

async function describeObject(objectName) {
  const { accessToken, instanceUrl } = await sf.getToken();
  const axios = require('axios');
  const res = await axios.get(
    `${instanceUrl}/services/data/v59.0/sobjects/${objectName}/describe`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );
  return res.data.fields;
}

async function main() {
  const objects = ['Opportunity', 'Quote', 'Contract__c', 'Order'];

  for (const obj of objects) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Object: ${obj}`);
    console.log('='.repeat(60));
    try {
      const fields = await describeObject(obj);
      // Show key fields: name, type, label
      const relevant = fields
        .filter(f => {
          const n = f.name.toLowerCase();
          const l = (f.label || '').toLowerCase();
          return n.includes('date') || n.includes('time') || n.includes('stage')
            || n.includes('status') || n.includes('opportunity') || n.includes('created')
            || n.includes('contract') || n.includes('quote') || n.includes('order')
            || n.includes('owner') || n.includes('name') || n.includes('amount')
            || n.includes('close') || n.includes('account') || n.includes('type')
            || n.includes('department') || n.includes('team') || n.includes('source')
            || n.includes('cw') || n.includes('won') || n === 'id'
            || l.includes('cw') || l.includes('계약') || l.includes('견적')
            || l.includes('출고') || l.includes('영업') || l.includes('단계');
        })
        .map(f => `  ${f.name} (${f.type}) - ${f.label}`)
        .sort();
      console.log(`Total fields: ${fields.length}, Relevant: ${relevant.length}`);
      relevant.forEach(f => console.log(f));
    } catch (err) {
      console.error(`  Error: ${err.response?.data?.[0]?.message || err.message}`);
    }
  }

  // Also try some test queries
  console.log(`\n${'='.repeat(60)}`);
  console.log('Test queries');
  console.log('='.repeat(60));

  try {
    const opps = await sf.query(`
      SELECT Id, Name, StageName, CreatedDate, CloseDate, Amount, OwnerId,
             Owner.Name, AccountId, Account.Name, Type, LeadSource
      FROM Opportunity
      WHERE CreatedDate >= 2026-01-01T00:00:00Z AND CreatedDate < 2026-04-01T00:00:00Z
      LIMIT 5
    `);
    console.log(`\nOpportunity sample (${opps.totalSize} total):`);
    (opps.records || []).forEach(r => {
      console.log(`  ${r.Name} | Stage: ${r.StageName} | Created: ${r.CreatedDate} | Close: ${r.CloseDate}`);
    });
  } catch (err) {
    console.error('Opportunity query error:', err.response?.data?.[0]?.message || err.message);
  }

  // Check Quote
  try {
    const quotes = await sf.query(`
      SELECT Id, Name, OpportunityId, CreatedDate, Status
      FROM Quote
      WHERE CreatedDate >= 2026-01-01T00:00:00Z
      LIMIT 5
    `);
    console.log(`\nQuote sample (${quotes.totalSize} total):`);
    (quotes.records || []).forEach(r => {
      console.log(`  ${r.Name} | OppId: ${r.OpportunityId} | Created: ${r.CreatedDate} | Status: ${r.Status}`);
    });
  } catch (err) {
    console.error('Quote query error:', err.response?.data?.[0]?.message || err.message);
  }

  // Check Contract__c
  try {
    const contracts = await sf.query(`
      SELECT Id, Name, CreatedDate
      FROM Contract__c
      LIMIT 5
    `);
    console.log(`\nContract__c sample (${contracts.totalSize} total):`);
    (contracts.records || []).forEach(r => {
      console.log(`  ${r.Name} | Created: ${r.CreatedDate}`);
    });
  } catch (err) {
    console.error('Contract__c query error:', err.response?.data?.[0]?.message || err.message);
  }

  // Check Order
  try {
    const orders = await sf.query(`
      SELECT Id, Name, OpportunityId, CreatedDate, Status, Type
      FROM Order
      WHERE CreatedDate >= 2026-01-01T00:00:00Z
      LIMIT 5
    `);
    console.log(`\nOrder sample (${orders.totalSize} total):`);
    (orders.records || []).forEach(r => {
      console.log(`  ${r.Name} | OppId: ${r.OpportunityId} | Created: ${r.CreatedDate} | Status: ${r.Status}`);
    });
  } catch (err) {
    console.error('Order query error:', err.response?.data?.[0]?.message || err.message);
  }
}

main().catch(console.error);
