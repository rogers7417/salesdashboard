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
  let channelRaw = { ae: null, am: null };
  try {
    const K = JSON.parse(fs.readFileSync(`data/kpi-extract-${D.period}.json`, 'utf8'));
    const is = K.inbound.insideSales, fsK = K.inbound.fieldSales, boK = K.inbound.backOffice;
    const am = K.channel.am, tm = K.channel.tm, ae = K.channel.ae, cbo = K.channel.backOffice;
    const frtRate = is.frt?.totalWithTask ? +(is.frt.frtOk / is.frt.totalWithTask * 100).toFixed(1) : null;
    const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
    const cd = (a) => (D.bizDaysElapsed ? +(a / D.bizDaysElapsed).toFixed(1) : 0); // 현재 일평균 계약대수
    const k = (name, cur, target, ok, unit, affects, action) => ({ name, cur, target, ok, unit: unit || '', affects, action });
    const chReq = +(D.teams.FR.requiredDaily + D.teams.PT.requiredDaily).toFixed(1);
    // 전환 실패/이탈 raw 사례
    const LEAD = (id) => id ? `https://torder.lightning.force.com/lightning/r/Lead/${id}/view` : null;
    const OPP = (id) => id ? `https://torder.lightning.force.com/lightning/r/Opportunity/${id}/view` : null;
    const distOf = (arr, key) => { const m = {}; (arr || []).forEach(r => { let v = r[key]; if (!v || v === '-') v = '미입력'; m[v] = (m[v] || 0) + 1; }); return Object.entries(m).map(([reason, c]) => `${reason} ${c}`).join(' · '); };
    const fsAvgCW = (() => { const u = fsK.cwConversionRate?.byUser || []; return u.length ? +(u.reduce((s, x) => s + (x.cwRate || 0), 0) / u.length).toFixed(1) : null; })();
    const sMQL = (is.rawData?.unconvertedMQL || []).slice(0, 5).map(r => ({ store: r.company || r.name, reason: (r.lossReasonSub && r.lossReasonSub !== '-') ? r.lossReasonSub : (r.lastTaskSubject || '미입력'), link: LEAD(r.leadId) }));
    const sNoVisit = (is.rawData?.noVisitSQL || []).slice(0, 3).map(r => ({ store: r.company || r.name, reason: (r.lossReasonSub && r.lossReasonSub !== '-') ? r.lossReasonSub : '방문 전 취소', link: LEAD(r.leadId) }));
    const sStale = (fsK.staleVisit?.opps || []).slice(0, 5).map(o => ({ store: o.name, reason: `${o.ageInDays ?? o.daysSinceVisit ?? ''}일 방치 · 마지막 ${o.lastTaskSubject || '-'}`, link: OPP(o.oppId) }));
    const sAmMiss = (am.settlementTimeline || []).filter(s => s.isSettled === false).slice(0, 5).map(s => ({ store: s.partnerName, reason: `MOU ${(s.mouContractDate || '').slice(0, 10)} 후 미안착`, link: null }));

    kpiLevers = [
      { hq: '인바운드세일즈', target: seg.IBS.target, gap: Math.round(seg.IBS.target - seg.IBS.projected), requiredDaily: D.teams.IBS.requiredDaily, currentDaily: cd(seg.IBS.actual),
        funnel: `Lead ${is.lead} → MQL ${is.mql}(${pct(is.mql, is.lead)}%) → SQL ${is.sql}(${pct(is.sql, is.mql)}%) → 방문 ${is.visitCount} → 계약`,
        parts: [
          { part: '인사이드세일즈 (IS)',
            kpis: [k('SQL 전환율', is.sqlConversionRate, 90, is.sqlConversionRate >= 90, '%', 'MQL→SQL', '자격검증 모수 양호 — 유지'), k('FRT 준수율', frtRate, 90, frtRate >= 90, '%', '인입→응대', '업무외·주말 응대 커버 보강 → 초기 이탈 차단'), k('방문 완료율', is.visitRate, 90, (is.visitRate ?? 0) >= 90, '%', 'SQL→방문', '방문 누락 최소화')],
            loss: { label: 'MQL 미전환 + 방문 전 취소', count: (is.rawData?.unconvertedMQL?.length || 0) + (is.rawData?.noVisitSQL?.length || 0), dist: '미전환 ' + distOf(is.rawData?.unconvertedMQL, 'lossReasonSub'), samples: [...sMQL, ...sNoVisit] } },
          { part: '인바운드 필드 (FS)',
            kpis: [k('SQL→CW 전환율', fsAvgCW, 60, (fsAvgCW ?? 0) >= 60, '%', '방문→계약', '견적·계약 단계 후속 가속'), k('골든타임 8일+ 정체', fsK.goldenTime?.stale8plus, 0, (fsK.goldenTime?.stale8plus ?? 9) === 0, '건', '견적 정체', '견적 8일+ 즉시 리터치'), k('방문후 14일+ 방치', fsK.staleVisit?.over14, 0, (fsK.staleVisit?.over14 ?? 9) === 0, '건', '방문후 이탈', '후속 과업 없는 방치건 일괄 재컨택')],
            loss: { label: '방문후 방치(후속 과업 없음)', count: fsK.staleVisit?.opps?.length || 0, dist: null, samples: sStale } },
          { part: '인바운드 BO (IB BO)',
            kpis: [k('SQL 7일+ 잔량', boK.sqlBacklog?.totalOver7, 10, (boK.sqlBacklog?.totalOver7 ?? 99) <= 10, '건', 'SQL→계약 처리', '7일+ 적체 우선 소진'), k('일평균 마감 인원', (boK.dailyClose?.byUser || []).length, 3, true, '명', '처리 캐파', '마감 처리량 유지')],
            loss: null },
        ] },
      { hq: '아웃바운드세일즈', target: seg.OBS.target, gap: Math.round(seg.OBS.target - seg.OBS.projected), requiredDaily: D.teams.OBS.requiredDaily, currentDaily: cd(seg.OBS.actual),
        funnel: `OBS Lead ${fsK.obsLeadCount?.total} / 목표 200 → 방문 → 계약`,
        parts: [
          { part: '아웃바운드 (OBS)',
            kpis: [k('OBS Lead 생산', fsK.obsLeadCount?.total, 200, (fsK.obsLeadCount?.total ?? 0) >= 200, '건', '발굴 모수', `필드 발굴량 확대 — 목표의 ${pct(fsK.obsLeadCount?.total, 200)}% 수준`)],
            loss: null },
        ] },
      { hq: '채널 (프랜차이즈·파트너스)', target: seg.FR.target + seg.PT.target, gap: Math.round((seg.FR.target + seg.PT.target) - (seg.FR.projected + seg.PT.projected)), requiredDaily: chReq, currentDaily: cd(seg.FR.actual + seg.PT.actual),
        funnel: `AM Lead ${am.dailyLeadCount?.total}(일 ${am.dailyLeadCount?.avgDaily}) → MOU → 안착 ${am.onboardingRate?.settled}/${am.onboardingRate?.total}(${am.onboardingRate?.rate}%) → 계약`,
        parts: [
          { part: '채널 AE',
            kpis: [k('MOU 체결', ae.mouCount?.total, 4, (ae.mouCount?.total ?? 0) >= 4, '건', '파트너 확보', '신규 MOU 견조'), k('네고 진입', ae.negoEntry?.thisMonth, 10, (ae.negoEntry?.thisMonth ?? 0) >= 10, '건', '협상 진입', '네고 진입 속도 가속'), k('미팅 일평균', ae.meetingCount?.avgDaily, 2, (ae.meetingCount?.avgDaily ?? 0) >= 2, '건', '활동량', '미팅 페이스 유지')],
            loss: null },
          { part: '채널 AM',
            kpis: [k('Lead 일평균', am.dailyLeadCount?.avgDaily, 20, (am.dailyLeadCount?.avgDaily ?? 0) >= 20, '건', '발굴 모수', `일 ${am.dailyLeadCount?.avgDaily}→20 = 모수 +${Math.round((20 / (am.dailyLeadCount?.avgDaily || 20) - 1) * 100)}%`), k('MOU 안착률', am.onboardingRate?.rate, 80, (am.onboardingRate?.rate ?? 0) >= 80, '%', 'MOU→매장전환', '저조 담당 집중관리'), k('활성 파트너', am.activePartnerCount?.total, 70, (am.activePartnerCount?.total ?? 0) >= 70, '곳', '파트너 풀', '양적 포화 — 질적 전환 과제')],
            loss: null }, // 미안착 raw는 channelRaw.am 표로 대체
          { part: '채널 TM',
            kpis: [k('FRT 20분 초과', tm.frt?.frtOver20, 0, (tm.frt?.frtOver20 ?? 9) === 0, '건', '응대 속도', '초과 최소화'), k('MQL 미전환', tm.unconvertedMQL?.count, 0, (tm.unconvertedMQL?.count ?? 9) === 0, '건', 'MQL→SQL', '미전환 사유 대응'), k('SQL 7일+ 잔량', tm.sqlBacklog?.over7, 10, (tm.sqlBacklog?.over7 ?? 99) <= 10, '건', 'SQL→계약', '입금일자 미입력 적체 해소')],
            loss: null },
          { part: '채널 BO (CH BO)',
            kpis: [k('리드타임 초과', cbo.leadTime?.overdueCount, 0, (cbo.leadTime?.overdueCount ?? 9) === 0, '건', '처리 SLA', '당일 완료율↑'), k('일일 마감 인원', (cbo.dailyClose?.byUser || []).length, 3, true, '명', '처리 캐파', '마감 처리량 유지'), k('SQL 7일+ 잔량', cbo.sqlBacklog?.totalOver7, 10, (cbo.sqlBacklog?.totalOver7 ?? 99) <= 10, '건', 'SQL→계약', '잔량 소진')],
            loss: null },
        ] },
    ];

    // ---- 채널 AE/AM raw (성격에 맞게) ----
    const asOfD = new Date(D.asOf + 'T00:00:00+09:00');
    const daysFrom = (d) => d ? Math.round((asOfD - new Date(d.slice(0, 10) + 'T00:00:00+09:00')) / 86400000) : null;
    const aeUns = ae.unsignedContracts || {};
    channelRaw = {
      // AE = 파트너 확보·협상 → 계약서 발송 후 미서명(클로징 정체)
      ae: {
        label: '계약서 발송 후 미서명', targetDays: aeUns.target_days || 7, overdue: aeUns.overdue || 0, total: aeUns.total || 0,
        list: (aeUns.list || []).slice().sort((a, b) => (b.daysSinceSent || 0) - (a.daysSinceSent || 0))
          .map(x => ({ store: x.accountName || x.oppName, owner: x.owner, sent: (x.createdDate || '').slice(0, 10), daysSinceSent: x.daysSinceSent, overdue: x.isOverdue, link: OPP(x.oppId) })),
      },
      // AM = 발굴·안착 → MOU 후 매장 미전환(안착 실패)
      am: (() => {
        const miss = (am.settlementTimeline || []).filter(s => s.isSettled === false)
          .map(s => ({ partner: s.partnerName, mou: (s.mouContractDate || '').slice(0, 10), daysSinceMou: daysFrom(s.mouContractDate), leadsAfter: s.leadsAfterMou3Months ?? 0 }))
          .sort((a, b) => (b.daysSinceMou || 0) - (a.daysSinceMou || 0));
        return { label: 'MOU 후 미안착(매장 미전환)', total: miss.length, list: miss };
      })(),
    };
    console.log(`  채널 raw: AE 미서명 ${channelRaw.ae.total}건(초과 ${channelRaw.ae.overdue}) / AM 미안착 ${channelRaw.am.total}건`);
  } catch (e) { console.log('  ⚠️ KPI 레버 스킵:', e.message); }

  // ---- 방치 견적 (인바운드·아웃바운드) + 후속조치 노트 ----
  let stalled = { inbound: [], outbound: [] };
  try {
    const SQ = JSON.parse(fs.readFileSync('data/stalled-quotes.json', 'utf8'));
    // 인바운드 방치 후속조치 노트 (Task 이력 분석 스냅샷)
    const NOTE = {
      '006TJ00000oeGCXYA2': { summary: '유오더(U오더) 사용 중·약정 1년 미만 잔여. 위약금 부담으로 약정 더 소진 후 환승 희망. 특별승인(대당1,100 할인·배터리19EA·볼륨21.4%) 확보. "6월말 재터치 예정".', next: '6월말 약정 만료 임박 시점 재컨택 + 위약금 캐시백/지원 카드로 환승 결정 유도' },
      '006TJ00000r6nE1YAI': { summary: '경쟁사(메뉴잇) 견적 대기 중. 가격이 최우선 결정요소. 특별승인(대당1,300 할인·볼륨20.5%) 확보. 7T 희망.', next: '메뉴잇 견적 나오는 즉시 가격 우위 강조하며 클로징 콜. 견적 지연 길어지면 선제 컨택' },
      '006TJ00000rFQ8YYAW': { summary: '카카오 인입→통화·금요일 방문조율 완료. 15T 희망·운영중. 방문 이후 후속 끊김.', next: '방문 결과·견적 확정 여부 확인 콜 → 미진행 시 클로징 푸시' },
      '006TJ00000niRjUYAU': { summary: '건물 증축·옆 매장 소송 이슈로 설치 지연(6월 예정). 서류 수취 완료·특별승인 받음.', next: '6월 설치 가능 일정 재확인(소송·증축 진행) → 확정 시 출고 준비, 지연 길면 일정 재합의' },
      '006TJ00000rSes1YAC': { summary: '타사 오더 2곳 대비 비싸다는 가격 저항. 도입 시기도 아직 멂. 특별승인 받았으나 보류.', next: '타사 대비 가치(기능·지원) 비교 자료 + 도입 시기 재확인 리터치, 추가 혜택 카드 검토' },
    };
    const attach = (arr) => (arr || []).map(o => { const id = o.link.split('/r/Opportunity/')[1].split('/')[0]; return { ...o, oppId: id, note: NOTE[id] || null }; });
    stalled = { inbound: attach(SQ.inbound), outbound: attach(SQ.outbound), fsQuote: SQ.fsQuote || [] };
    console.log(`  방치 견적: 인바운드 ${stalled.inbound.length}건 / 아웃바운드 ${stalled.outbound.length}건 / FS견적 ${stalled.fsQuote.length}건`);
  } catch (e) { console.log('  ⚠️ 방치 견적 스킵:', e.message); }

  const out = {
    kpiLevers, stalled, channelRaw,
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
