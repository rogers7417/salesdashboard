/**
 * BO 시스템 활동 분석 (Stage 변경 + 필드 수정)
 *
 * Task에 안 남는 보이지 않는 업무를 측정.
 * OpportunityFieldHistory 기반.
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
  const res = await axios.post(url, params);
  return { accessToken: res.data.access_token, instanceUrl: res.data.instance_url };
}

async function soqlQueryAll(instanceUrl, accessToken, query) {
  let allRecords = [];
  let nextUrl = `${instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(query)}`;
  while (nextUrl) {
    const res = await axios.get(nextUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    allRecords.push(...(res.data.records || []));
    nextUrl = res.data.nextRecordsUrl ? `${instanceUrl}${res.data.nextRecordsUrl}` : null;
  }
  return allRecords;
}

const EXCLUDED_NAMES = ['정건욱'];
const TEAM = process.argv[4] || 'inbound'; // 'inbound' | 'channel'
const BO_NAMES_INBOUND = ['전수빈', '정지영', '박효정', '조현재', '강수영'];
const BO_NAMES_CHANNEL = ['최영은', '장명진', '김희수'];
const BO_NAMES = TEAM === 'channel' ? BO_NAMES_CHANNEL : BO_NAMES_INBOUND;
const DEPT_FILTER = TEAM === 'channel' ? "(Department LIKE '%채널%')" : "Department = '인바운드세일즈'";

function countWorkdays(startDate, endDate) {
  let count = 0;
  const d = new Date(startDate);
  while (d <= new Date(endDate)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const startStr = process.argv[2] || '2025-12-01';
  const endStr = process.argv[3] || '2026-03-31';
  const startUTC = new Date(startStr + 'T00:00:00+09:00').toISOString();
  const endUTC = new Date(endStr + 'T23:59:59+09:00').toISOString();
  const workdays = countWorkdays(startStr, endStr);

  console.log(`📅 ${startStr} ~ ${endStr} (영업일 ${workdays}일)\n`);
  const { accessToken, instanceUrl } = await getSalesforceToken();

  // 인바운드 BO 사용자
  console.log('👥 BO 사용자 조회...');
  const userQuery = `SELECT Id, Name FROM User WHERE ${DEPT_FILTER} AND IsActive = true`;
  const users = await soqlQueryAll(instanceUrl, accessToken, userQuery);
  const userMap = {};
  users.forEach(u => {
    if (EXCLUDED_NAMES.includes(u.Name)) return;
    userMap[u.Id] = u.Name;
  });
  const targetUserIds = Object.keys(userMap).filter(id => BO_NAMES.includes(userMap[id]));
  console.log(`  메인 BO ${targetUserIds.length}명: ${targetUserIds.map(id => userMap[id]).join(', ')}\n`);

  const userIdsList = targetUserIds.map(id => `'${id}'`).join(',');

  // OpportunityFieldHistory 조회
  console.log('📊 OpportunityFieldHistory 조회 (필드 수정 + Stage 변경)...');
  const fhQuery = `
    SELECT Id, OpportunityId, Field, OldValue, NewValue, CreatedDate, CreatedById
    FROM OpportunityFieldHistory
    WHERE CreatedDate >= ${startUTC}
      AND CreatedDate <= ${endUTC}
      AND CreatedById IN (${userIdsList})
  `;
  const histories = await soqlQueryAll(instanceUrl, accessToken, fhQuery);
  console.log(`  → ${histories.length}건\n`);

  // 집계
  const stats = {};
  targetUserIds.forEach(uid => {
    stats[uid] = {
      name: userMap[uid],
      totalChanges: 0,
      stageChanges: 0,
      otherChanges: 0,
      touchedOpps: new Set(),
      fieldBreakdown: {},
    };
  });

  histories.forEach(h => {
    const s = stats[h.CreatedById];
    if (!s) return;
    s.totalChanges++;
    if (h.Field === 'StageName') s.stageChanges++;
    else s.otherChanges++;
    s.touchedOpps.add(h.OpportunityId);
    s.fieldBreakdown[h.Field] = (s.fieldBreakdown[h.Field] || 0) + 1;
  });

  // 출력
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  BO 시스템 활동 (Field History 기반)');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('이름      총변경  Stage변경  기타필드  터치Opp  일평균변경  Opp당변경');

  const rows = Object.values(stats).sort((a, b) => b.totalChanges - a.totalChanges);
  rows.forEach(s => {
    const dailyChanges = (s.totalChanges / workdays).toFixed(1);
    const perOpp = s.touchedOpps.size ? (s.totalChanges / s.touchedOpps.size).toFixed(1) : '0';
    console.log(`${s.name.padEnd(8)}  ${String(s.totalChanges).padStart(6)}  ${String(s.stageChanges).padStart(9)}  ${String(s.otherChanges).padStart(8)}  ${String(s.touchedOpps.size).padStart(7)}  ${dailyChanges.padStart(10)}  ${perOpp.padStart(9)}`);
  });

  // 필드별 TOP
  console.log('\n  📋 필드별 변경 TOP 10 (전체 합산)');
  const allFields = {};
  rows.forEach(s => {
    Object.entries(s.fieldBreakdown).forEach(([f, c]) => { allFields[f] = (allFields[f] || 0) + c; });
  });
  const topFields = Object.entries(allFields).sort((a, b) => b[1] - a[1]).slice(0, 10);
  topFields.forEach(([f, c]) => console.log(`     ${f.padEnd(35)} ${c}`));

  // 요약
  const totalList = rows.map(s => s.totalChanges);
  const dailyList = rows.map(s => s.totalChanges / workdays);
  console.log('\n  📊 요약');
  console.log(`     총 시스템 활동: ${rows.reduce((a, b) => a + b.totalChanges, 0)}건`);
  console.log(`     1인당 일평균 변경 중앙값: ${median(dailyList).toFixed(1)}건`);
  console.log(`     1인당 일평균 변경 평균값: ${(rows.reduce((a, b) => a + b.totalChanges / workdays, 0) / rows.length).toFixed(1)}건`);

  // 저장
  const out = {
    period: { start: startStr, end: endStr, workdays },
    rows: rows.map(s => ({
      name: s.name,
      totalChanges: s.totalChanges,
      stageChanges: s.stageChanges,
      otherChanges: s.otherChanges,
      touchedOpps: s.touchedOpps.size,
      dailyChanges: +(s.totalChanges / workdays).toFixed(1),
      changesPerOpp: s.touchedOpps.size ? +(s.totalChanges / s.touchedOpps.size).toFixed(1) : 0,
      fieldBreakdown: s.fieldBreakdown,
    })),
    topFields,
  };
  const outPath = path.join(__dirname, '../../reports', `bo-system-activity-${endStr}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n💾 ${outPath}`);
}

main().catch(e => {
  console.error('❌', e.message);
  if (e.response?.data) console.error(JSON.stringify(e.response.data, null, 2));
  process.exit(1);
});
