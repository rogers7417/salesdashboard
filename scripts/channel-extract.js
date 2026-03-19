const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { collectChannelData } = require('../channel-sales-report/salesforce');
const { calculateStats } = require('../channel-sales-report/stats');
const { uploadJSON } = require('../lib/s3-upload');

function getCurrentMonth() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
}

function stripRawData(stats) {
  const strip = (items) =>
    items.map(({ rawData, ...rest }) => rest);

  return {
    ...stats,
    partnerStats: stats.partnerStats ? strip(stats.partnerStats) : stats.partnerStats,
    franchiseStats: stats.franchiseStats ? strip(stats.franchiseStats) : stats.franchiseStats,
  };
}

async function runChannelExtract(targetMonth) {
  const month = targetMonth || getCurrentMonth();
  const [year, mm] = month.split('-');
  const label = `${year}년 ${parseInt(mm, 10)}월`;

  console.log(`[channel-extract] Starting extraction for ${month} (${label})`);

  try {
    // 1. Collect raw Salesforce data
    console.log('[channel-extract] Collecting channel data from Salesforce...');
    const rawData = await collectChannelData(month);
    console.log('[channel-extract] Channel data collected.');

    // 2. Calculate stats
    console.log('[channel-extract] Calculating stats...');
    const stats = await calculateStats(rawData, month);
    console.log('[channel-extract] Stats calculated.');

    // 3. Build period metadata
    const period = { year: parseInt(year, 10), month: parseInt(mm, 10), label };
    const generatedAt = new Date().toISOString();

    // 4. Build full report (strip rawData from partner/franchise stats)
    const fullReport = {
      period,
      ...stripRawData(stats),
      generatedAt,
    };

    // 5. Build summary report
    const summaryReport = {
      period,
      summary: stats.summary,
      generatedAt,
    };

    // 6. Build KPI v2 slim report (29MB → ~3MB)
    const rawDataSlim = stats.rawData ? {
      channelEvents: (stats.rawData.channelEvents || []).map(e => ({
        Id: e.Id, WhatId: e.WhatId, Subject: e.Subject, Description: e.Description,
        CreatedDate: e.CreatedDate, ActivityDate: e.ActivityDate,
        Owner: e.Owner ? { Name: e.Owner.Name } : null,
      })),
      partners: (stats.rawData.partners || []).map(a => ({
        Id: a.Id, Name: a.Name, Progress__c: a.Progress__c, MOUstartdate__c: a.MOUstartdate__c,
        Owner: a.Owner ? { Name: a.Owner.Name } : null,
        fm_AccountType__c: a.fm_AccountType__c, CreatedDate: a.CreatedDate,
      })),
      franchiseHQAccounts: (stats.rawData.franchiseHQAccounts || []).map(a => ({
        Id: a.Id, Name: a.Name, Progress__c: a.Progress__c, MOUstartdate__c: a.MOUstartdate__c,
        Owner: a.Owner ? { Name: a.Owner.Name } : null,
        fm_AccountType__c: a.fm_AccountType__c, CreatedDate: a.CreatedDate,
      })),
      channelTasks: (stats.rawData.channelTasks || []).map(t => ({
        WhatId: t.WhatId, CreatedDate: t.CreatedDate, Subject: t.Subject,
        ActivityDate: t.ActivityDate, Status: t.Status, Type: t.Type,
        Owner: t.Owner ? { Name: t.Owner.Name } : null,
      })),
    } : null;

    // 히트맵 sparse 변환 (활동 있는 날만)
    const sparseDailyActivity = (arr) =>
      (arr || []).filter(d => d.leads > 0 || d.meetings > 0 || d.count > 0);

    const channelLeadsByOwner = stats.summary?.channelLeadsByOwner;
    const sparseChannelLeadsByOwner = channelLeadsByOwner ? {
      ...channelLeadsByOwner,
      amHeatmap: channelLeadsByOwner.amHeatmap ? {
        ...channelLeadsByOwner.amHeatmap,
        data: (channelLeadsByOwner.amHeatmap.data || []).map(d => ({
          ...d,
          dailyData: (d.dailyData || []).filter(dd => dd.count > 0)
        }))
      } : null
    } : null;

    const kpiV2Report = {
      period,
      kpi: stats.kpi,
      summary: stats.summary ? {
        channelLeadsByOwner: sparseChannelLeadsByOwner,
      } : null,
      mouStats: stats.mouStats,
      partnerStats: (stripRawData(stats).partnerStats || []).map(({ leads, referredStores, dailyLeads, ...rest }) => ({
        ...rest,
        dailyActivity: sparseDailyActivity(rest.dailyActivity)
      })),
      franchiseHQList: (stats.franchiseHQList || []).map(hq => ({
        ...hq,
        dailyActivity: sparseDailyActivity(hq.dailyActivity)
      })),
      rawData: rawDataSlim,
      generatedAt,
    };

    // 7. Upload full report to S3
    const fullKey = `channel/${month}.json`;
    console.log(`[channel-extract] Uploading full report to ${fullKey}...`);
    await uploadJSON(fullKey, fullReport);
    console.log(`[channel-extract] Full report uploaded.`);

    // 8. Upload KPI v2 slim report to S3
    const kpiV2Key = `channel/kpi-v2/${month}.json`;
    console.log(`[channel-extract] Uploading KPI v2 report to ${kpiV2Key}...`);
    await uploadJSON(kpiV2Key, kpiV2Report);
    const kpiV2Size = JSON.stringify(kpiV2Report).length;
    console.log(`[channel-extract] KPI v2 report uploaded. (${(kpiV2Size / 1024 / 1024).toFixed(1)}MB)`);

    // 9. Upload summary report to S3
    const summaryKey = `channel/summary/${month}.json`;
    console.log(`[channel-extract] Uploading summary to ${summaryKey}...`);
    await uploadJSON(summaryKey, summaryReport);
    console.log(`[channel-extract] Summary uploaded.`);

    console.log(`[channel-extract] Done. (${month})`);

    return { fullReport, summaryReport, kpiV2Report };
  } catch (error) {
    console.error(`[channel-extract] Error during extraction for ${month}:`, error.message || error);
    throw error;
  }
}

module.exports = { runChannelExtract };

// Standalone execution
if (require.main === module) {
  const targetMonth = process.argv[2] || getCurrentMonth();
  runChannelExtract(targetMonth)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
