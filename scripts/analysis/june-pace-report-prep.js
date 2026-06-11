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

  // ---- KPI 레버: 본부 KPI 실값 → 어느 퍼널을 끌어올려야 목표 달성하나 ----
  let kpiLevers = [];
  try {
    const K = JSON.parse(fs.readFileSync(`data/kpi-extract-${D.period}.json`, 'utf8'));
    const is = K.inbound.insideSales, fsK = K.inbound.fieldSales, boK = K.inbound.backOffice;
    const am = K.channel.am, tm = K.channel.tm, ae = K.channel.ae, cbo = K.channel.backOffice;
    const frtRate = is.frt?.totalWithTask ? +(is.frt.frtOk / is.frt.totalWithTask * 100).toFixed(1) : null;
    const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
    const cd = (a) => (D.bizDaysElapsed ? +(a / D.bizDaysElapsed).toFixed(1) : 0); // 현재 일평균 계약대수
    const k = (name, cur, target, ok, unit, affects, action) => ({ name, cur, target, ok, unit: unit || '', affects, action });
    const chReq = +(D.teams.FR.requiredDaily + D.teams.PT.requiredDaily).toFixed(1);
    kpiLevers = [
      { seg: '인바운드 (IBS)', gap: seg.IBS.target - seg.IBS.projected, requiredDaily: D.teams.IBS.requiredDaily, currentDaily: cd(seg.IBS.actual),
        funnel: `Lead ${is.lead} → MQL ${is.mql}(${pct(is.mql, is.lead)}%) → SQL ${is.sql}(${pct(is.sql, is.mql)}%) → 방문 ${is.visitCount} → 계약`,
        kpis: [
          k('IS SQL전환율', is.sqlConversionRate, 90, is.sqlConversionRate >= 90, '%', 'MQL→SQL', '달성 — 자격검증 모수 양호, 현 수준 유지'),
          k('IS FRT 준수율', frtRate, 90, frtRate >= 90, '%', '인입→응대속도', `업무외·주말 응대 커버 보강 → 초기 이탈 차단, 견적 진입량 ↑ (현재 ${frtRate}%, 절반 이상이 20분 초과)`),
          k('IB BO SQL 7일+잔량', boK.sqlBacklog?.totalOver7, 10, (boK.sqlBacklog?.totalOver7 ?? 99) <= 10, '건', 'SQL→계약 처리', '7일+ 적체 우선 소진 → 마감 처리속도 회복'),
        ],
        lever: `SQL 모수(${is.sql}건)는 확보됨 → 병목은 응대(FRT)·잔량 처리. 잔여 갭 ${Math.round(seg.IBS.target - seg.IBS.projected)}대 → 일 ${D.teams.IBS.requiredDaily}대 계약 필요(현재 일 ${cd(seg.IBS.actual)}대)` },
      { seg: '아웃바운드 (OBS)', gap: seg.OBS.target - seg.OBS.projected, requiredDaily: D.teams.OBS.requiredDaily, currentDaily: cd(seg.OBS.actual),
        funnel: `OBS Lead ${fsK.obsLeadCount?.total} / 목표 200 → 방문 → 계약`,
        kpis: [
          k('OBS Lead 생산', fsK.obsLeadCount?.total, 200, (fsK.obsLeadCount?.total ?? 0) >= 200, '건', '발굴 모수', `필드 발굴 활동량 확대 — 현재 모수가 목표의 ${pct(fsK.obsLeadCount?.total, 200)}% 수준`),
        ],
        lever: `퍼널 입구(발굴)부터 부족 — Lead ${fsK.obsLeadCount?.total}/200. 잔여 갭 ${Math.round(seg.OBS.target - seg.OBS.projected)}대 → 일 ${D.teams.OBS.requiredDaily}대 계약 필요(현재 일 ${cd(seg.OBS.actual)}대)` },
      { seg: '채널 (FR·PT)', gap: (seg.FR.target + seg.PT.target) - (seg.FR.projected + seg.PT.projected), requiredDaily: chReq, currentDaily: cd(seg.FR.actual + seg.PT.actual),
        funnel: `AM Lead ${am.dailyLeadCount?.total}(일 ${am.dailyLeadCount?.avgDaily}) → MOU → 안착 ${am.onboardingRate?.settled}/${am.onboardingRate?.total}(${am.onboardingRate?.rate}%) → 계약`,
        kpis: [
          k('AM Lead 일평균', am.dailyLeadCount?.avgDaily, 20, (am.dailyLeadCount?.avgDaily ?? 0) >= 20, '건', '발굴 모수', `일 ${am.dailyLeadCount?.avgDaily}→20건 발굴 = 채널 마감 모수 +${Math.round((20 / (am.dailyLeadCount?.avgDaily || 20) - 1) * 100)}%`),
          k('MOU 안착률', am.onboardingRate?.rate, 80, (am.onboardingRate?.rate ?? 0) >= 80, '%', 'MOU→매장전환', `안착 ${am.onboardingRate?.settled}/${am.onboardingRate?.total} — 저조 담당 집중관리로 전환율 끌어올리기`),
          k('TM MQL 미전환', tm.unconvertedMQL?.count, 0, (tm.unconvertedMQL?.count ?? 9) === 0, '건', 'MQL→SQL', '미전환 사유(가격·보류) 대응 → SQL 누수 차단'),
        ],
        lever: `모수(AM Lead)와 전환(안착률 ${am.onboardingRate?.rate}%) 둘 다 미달 — 입구·중간 동시 개선. 잔여 갭 ${Math.round((seg.FR.target + seg.PT.target) - (seg.FR.projected + seg.PT.projected))}대 → 일 ${chReq}대 계약 필요(현재 일 ${cd(seg.FR.actual + seg.PT.actual)}대)` },
    ];
  } catch (e) { console.log('  ⚠️ KPI 레버 스킵:', e.message); }

  const out = {
    kpiLevers,
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
