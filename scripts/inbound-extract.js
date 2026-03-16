const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { generateReport } = require('../dashboard/backend/services/inbound-report');
const { uploadJSON } = require('../lib/s3-upload');

const MODES = ['daily', 'weekly', 'monthly', 'monthly-current'];

function buildSummary(report) {
  return {
    period: report.period,
    periodLabel: report.periodLabel,
    summary: report.summary,
    frt: {
      avgFRT: report.frt.avgFRT,
      frtRate: report.frt.frtRate,
    },
    generatedAt: report.generatedAt,
  };
}

async function runInboundExtract() {
  const totalStart = Date.now();
  console.log(`[inbound-extract] Starting extraction for modes: ${MODES.join(', ')}`);

  const results = {};
  const errors = {};

  for (const mode of MODES) {
    const modeStart = Date.now();
    console.log(`[inbound-extract] [${mode}] Generating report...`);

    try {
      const report = await generateReport(mode);
      const elapsed = ((Date.now() - modeStart) / 1000).toFixed(1);
      console.log(`[inbound-extract] [${mode}] Report generated (${elapsed}s)`);

      // Upload full report
      const fullKey = `inbound/${mode}.json`;
      console.log(`[inbound-extract] [${mode}] Uploading full report to ${fullKey}...`);
      await uploadJSON(fullKey, report);
      console.log(`[inbound-extract] [${mode}] Full report uploaded.`);

      // Upload summary
      const summary = buildSummary(report);
      const summaryKey = `inbound/summary/${mode}.json`;
      console.log(`[inbound-extract] [${mode}] Uploading summary to ${summaryKey}...`);
      await uploadJSON(summaryKey, summary);
      console.log(`[inbound-extract] [${mode}] Summary uploaded.`);

      results[mode] = { fullKey, summaryKey };
    } catch (error) {
      const elapsed = ((Date.now() - modeStart) / 1000).toFixed(1);
      console.error(`[inbound-extract] [${mode}] Error after ${elapsed}s:`, error.message || error);
      errors[mode] = error.message || String(error);
    }
  }

  const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
  const successCount = Object.keys(results).length;
  const errorCount = Object.keys(errors).length;

  console.log(`[inbound-extract] Done. ${successCount}/${MODES.length} succeeded in ${totalElapsed}s`);

  if (errorCount > 0) {
    console.error(`[inbound-extract] Failed modes: ${Object.keys(errors).join(', ')}`);
  }

  return { results, errors };
}

module.exports = { runInboundExtract };

// Standalone execution
if (require.main === module) {
  runInboundExtract()
    .then(({ errors }) => {
      process.exit(Object.keys(errors).length > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error('[inbound-extract] Fatal error:', error);
      process.exit(1);
    });
}
