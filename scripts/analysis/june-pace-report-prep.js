// 6월 페이스 분석 리포트 데이터 준비: 투영 + 위험 영업기회 Task
require('dotenv').config();
const axios = require('axios'); axios.defaults.adapter = 'fetch';
const fs = require('fs');
const D = JSON.parse(fs.readFileSync('data/tablet-pace-2026-06.json', 'utf8'));
const TEAMS = ['IBS', 'OBS', 'FR', 'PT'];
const SEG = { IBS: '인바운드', OBS: '아웃바운드', FR: '프랜차이즈', PT: '파트너스' };
const CLOSEABLE = ['견적', '재견적', '선납금', '계약진행']; // 마감 임박 단계
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

(async () => {
  // 1) 투영
  const seg = {}; let totTarget = 0, totActual = 0, totProj = 0;
  for (const t of TEAMS) {
    const x = D.teams[t];
    seg[t] = { name: SEG[t], target: x.target, actual: x.actualMTD, count: x.actualCount, cumTarget: x.cumTargetToday, paceAtt: x.paceAttainment, projected: x.projected, remaining: x.remaining, requiredDaily: x.requiredDaily, pipelineTab: x.pipeline.tablets, coverage: x.pipeline.coverage, leadTimeMedian: median((x.cwDwellOpps || []).map(o => Object.values(o.dwell || {}).reduce((s, v) => s + v, 0)).filter(v => v > 0)) };
    totTarget += x.target; totActual += x.actualMTD; totProj += x.projected;
  }

  // 2) 단계별 CW/CL/계류 체류 (전사) — 견적 누수 근거
  const stageCompare = ['방문배정', '견적', '재견적', '선납금', '계약진행', '출고진행'].map(st => {
    const cw = [], cl = [], op = [];
    for (const t of TEAMS) {
      (D.teams[t].cwDwellOpps || []).forEach(o => { if (o.dwell?.[st] != null) cw.push(o.dwell[st]); });
      (D.teams[t].clDwellOpps || []).forEach(o => { if (o.dwell?.[st] != null) cl.push(o.dwell[st]); });
      (D.teams[t].pipeline.stages.find(s => s.stage === st)?.opps || []).forEach(o => { if (o.stageAge != null) op.push(o.stageAge); });
    }
    return { stage: st, cwMed: +median(cw).toFixed(1), clMed: +median(cl).toFixed(1), openMed: +median(op).toFixed(1), openCnt: op.length };
  });

  // 3) 위험 영업기회 후보 — 마감단계 + 태블릿 보유, 정체순
  const atRisk = [];
  for (const t of TEAMS) {
    for (const s of D.teams[t].pipeline.stages) {
      if (!CLOSEABLE.includes(s.stage)) continue;
      for (const o of s.opps) {
        if (!(o.tablets > 0)) continue;
        if ((o.age ?? 0) > 90) continue; // 좀비 레거시 제외 (생성 90일 이내 = 살아있는 코호트)
        atRisk.push({ team: t, seg: SEG[t], oppId: o.id, store: o.account, stage: s.stage, tablets: o.tablets, stageAge: o.stageAge, age: o.age, owner: o.fieldUser || o.ownerName, link: o.link });
      }
    }
  }
  // Task 조회 (마지막 활동)
  const pr = new URLSearchParams(); pr.append('grant_type', 'password'); pr.append('client_id', process.env.SF_CLIENT_ID); pr.append('client_secret', process.env.SF_CLIENT_SECRET); pr.append('username', process.env.SF_USERNAME); pr.append('password', decodeURIComponent(process.env.SF_PASSWORD));
  const tk = (await axios.post(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, pr)).data;
  const inst = tk.instance_url, tok = tk.access_token;
  const q = async (s) => { let all = []; let r = (await axios.get(`${inst}/services/data/v59.0/query`, { headers: { Authorization: `Bearer ${tok}` }, params: { q: s.replace(/\s+/g, ' ').trim() } })).data; all.push(...r.records); while (r.nextRecordsUrl) { r = (await axios.get(`${inst}${r.nextRecordsUrl}`, { headers: { Authorization: `Bearer ${tok}` } })).data; all.push(...r.records); } return all; };
  const ids = atRisk.map(o => o.oppId);
  const lastByOpp = {};
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200).map(x => `'${x}'`).join(',');
    const tasks = await q(`SELECT WhatId, Subject, Description, ActivityDate, CreatedDate, Owner.Name FROM Task WHERE WhatId IN (${chunk}) ORDER BY ActivityDate DESC NULLS LAST, CreatedDate DESC`);
    tasks.forEach(t => { if (!lastByOpp[t.WhatId]) lastByOpp[t.WhatId] = t; });
  }
  const today = new Date(D.asOf + 'T00:00:00+09:00');
  atRisk.forEach(o => {
    const lt = lastByOpp[o.oppId];
    const dt = lt ? (lt.ActivityDate || (lt.CreatedDate || '').slice(0, 10)) : null;
    o.lastTaskDate = dt; o.lastTaskSubject = lt?.Subject || null;
    o.lastTaskDesc = (lt?.Description || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    o.daysSinceTask = dt ? Math.round((today - new Date(dt + 'T00:00:00+09:00')) / 86400000) : null;
  });
  // 위험 점수: 단계경과 + Task 방치 + 태블릿 가중
  atRisk.forEach(o => { o.risk = (o.stageAge || 0) + (o.daysSinceTask != null ? o.daysSinceTask : 30) * 0.5 + Math.min(o.tablets, 30) * 0.3; });
  atRisk.sort((a, b) => b.risk - a.risk);

  const out = {
    period: D.period, asOf: D.asOf, bizElapsed: D.bizDaysElapsed, bizTotal: D.bizDaysTotal,
    total: { target: totTarget, actual: totActual, projected: totProj, gap: totProj - totTarget, attainment: +(totProj / totTarget * 100).toFixed(1), paceNow: +(totActual / D.teams.IBS.cumTargetToday).toFixed(2) },
    segments: seg, stageCompare,
    atRisk: atRisk.slice(0, 30),
    atRiskSummary: { total: atRisk.length, stale14: atRisk.filter(o => (o.daysSinceTask ?? 0) >= 14).length, tabletsAtRisk: atRisk.reduce((s, o) => s + o.tablets, 0) },
  };
  fs.writeFileSync('data/june-pace-analysis.json', JSON.stringify(out, null, 2));
  console.log('투영: 전사 목표', totTarget, '실적', totActual, '예상착지', totProj, `(${out.total.attainment}%)`);
  console.log('세그먼트:', TEAMS.map(t => `${t} ${seg[t].actual}/${seg[t].target}(착지 ${seg[t].projected})`).join(' | '));
  console.log('위험 영업기회:', atRisk.length, '건 / 태블릿', out.atRiskSummary.tabletsAtRisk, '/ Task 14일+ 방치', out.atRiskSummary.stale14);
  console.log('\nTOP 위험 5:');
  atRisk.slice(0, 5).forEach(o => console.log(`  ${o.store} | ${o.seg}·${o.stage} | ${o.tablets}대 | 단계${o.stageAge}일 | Task ${o.daysSinceTask}일전(${o.lastTaskSubject})`));
  console.log('\n저장: data/june-pace-analysis.json');
})().catch(e => { console.error('ERR', e.response?.data || e.message); process.exit(1); });
