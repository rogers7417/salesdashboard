/**
 * CreatedDate vs CreatedTime__c 오차 검출
 * 기간: 2026-01-01 ~ 2026-03-31
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function getSalesforceToken() {
  const url = `${process.env.SF_LOGIN_URL}/services/oauth2/token`;
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', process.env.SF_CLIENT_ID);
  params.append('client_secret', process.env.SF_CLIENT_SECRET);
  params.append('username', process.env.SF_USERNAME);
  params.append('password', decodeURIComponent(process.env.SF_PASSWORD));
  const r = await axios.post(url, params);
  return { accessToken: r.data.access_token, instanceUrl: r.data.instance_url };
}

async function soqlQueryAll(instanceUrl, accessToken, query) {
  let all = [];
  let next = `${instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(query)}`;
  while (next) {
    const r = await axios.get(next, { headers: { Authorization: `Bearer ${accessToken}` } });
    all.push(...(r.data.records || []));
    next = r.data.nextRecordsUrl ? `${instanceUrl}${r.data.nextRecordsUrl}` : null;
  }
  return all;
}

// CreatedDate (UTC ISO) → KST Date 객체
function utcToKST(utcStr) {
  const d = new Date(utcStr);
  return new Date(d.getTime() + 9 * 3600000);
}

// CreatedTime__c "YYYY-MM-DD HH:mm:ss" → Date 객체 (KST)
function parseKST(str) {
  if (!str) return null;
  const [date, time] = str.split(' ');
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi, s] = (time || '00:00:00').split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, mi, s || 0));
}

async function main() {
  console.log('🚀 Lead 시간 필드 오차 검출 (2026-01-01 ~ 2026-03-31)\n');
  const { accessToken, instanceUrl } = await getSalesforceToken();

  const startUTC = '2025-12-31T15:00:00Z'; // KST 2026-01-01 00:00
  const endUTC = '2026-03-31T14:59:59Z';   // KST 2026-03-31 23:59

  console.log('📊 Lead 조회 중...');
  const leads = await soqlQueryAll(instanceUrl, accessToken,
    `SELECT Id, Name, Company, LeadSource, OwnerId, Owner.Name, CreatedDate, CreatedTime__c
     FROM Lead
     WHERE CreatedDate >= ${startUTC} AND CreatedDate <= ${endUTC}
     AND CreatedTime__c != null`);
  console.log(`  → ${leads.length}건\n`);

  // 오차 계산
  const mismatches = [];
  const diffBuckets = { '0~1분': 0, '1~5분': 0, '5~60분': 0, '1~24시간': 0, '24시간+': 0 };
  let totalDiffMin = 0;
  let matched = 0;

  leads.forEach(l => {
    const kstFromUTC = utcToKST(l.CreatedDate);
    const kstFromField = parseKST(l.CreatedTime__c);
    if (!kstFromField) return;

    const diffMs = Math.abs(kstFromUTC.getTime() - kstFromField.getTime());
    const diffMin = Math.round(diffMs / 60000);

    if (diffMin === 0) matched++;
    else {
      totalDiffMin += diffMin;
      if (diffMin <= 1) diffBuckets['0~1분']++;
      else if (diffMin <= 5) diffBuckets['1~5분']++;
      else if (diffMin <= 60) diffBuckets['5~60분']++;
      else if (diffMin <= 1440) diffBuckets['1~24시간']++;
      else diffBuckets['24시간+']++;

      mismatches.push({
        leadId: l.Id,
        company: l.Company || '-',
        owner: l.Owner?.Name || '-',
        leadSource: l.LeadSource || '-',
        createdDateKST: kstFromUTC.toISOString().replace('T', ' ').slice(0, 19),
        createdTimeC: l.CreatedTime__c,
        diffMinutes: diffMin,
        diffHours: +(diffMin / 60).toFixed(2),
      });
    }
  });

  // 출력
  console.log('═══════════════════════════════════════════════════════');
  console.log('  요약');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  총 Lead (CreatedTime__c 있음): ${leads.length}건`);
  console.log(`  일치: ${matched}건 (${(matched / leads.length * 100).toFixed(1)}%)`);
  console.log(`  불일치: ${mismatches.length}건 (${(mismatches.length / leads.length * 100).toFixed(1)}%)`);
  console.log(`\n  오차 구간별 분포:`);
  Object.entries(diffBuckets).forEach(([k, v]) => {
    if (v) console.log(`    ${k.padEnd(10)}: ${v}건`);
  });

  // 24시간+ 케이스 TOP 20
  const bigDiff = mismatches.filter(m => m.diffMinutes >= 1440).sort((a, b) => b.diffMinutes - a.diffMinutes);
  if (bigDiff.length) {
    console.log(`\n  🚨 24시간 이상 오차 TOP 20:`);
    console.log('  LeadId              회사          Owner    Source      CreatedDate(KST)     CreatedTime__c       오차');
    bigDiff.slice(0, 20).forEach(m => {
      console.log(`  ${m.leadId}  ${m.company.padEnd(10)}  ${m.owner.padEnd(6)}  ${(m.leadSource || '').padEnd(10)}  ${m.createdDateKST}  ${m.createdTimeC}  ${m.diffHours}h`);
    });
  }

  // LeadSource별 불일치 집계
  const bySource = {};
  mismatches.forEach(m => {
    bySource[m.leadSource] = bySource[m.leadSource] || { total: 0, over24h: 0 };
    bySource[m.leadSource].total++;
    if (m.diffMinutes >= 1440) bySource[m.leadSource].over24h++;
  });
  console.log('\n  📋 LeadSource별 불일치 건수:');
  Object.entries(bySource).sort((a, b) => b[1].total - a[1].total).forEach(([k, v]) => {
    console.log(`    ${k.padEnd(18)}: ${v.total}건 (24h+ ${v.over24h}건)`);
  });

  // 저장
  const outDir = path.join(__dirname, '../../reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const out = {
    period: '2026-01-01 ~ 2026-03-31',
    total: leads.length,
    matched,
    mismatched: mismatches.length,
    buckets: diffBuckets,
    bySource,
    rows: mismatches.sort((a, b) => b.diffMinutes - a.diffMinutes),
  };
  const outPath = path.join(outDir, 'lead-time-mismatch-2026Q1.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n💾 저장: ${outPath}`);
}

main().catch(e => {
  console.error('❌', e.message);
  if (e.response?.data) console.error(JSON.stringify(e.response.data, null, 2));
  process.exit(1);
});
