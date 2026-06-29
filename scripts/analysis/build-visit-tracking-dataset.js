/**
 * 방문 트래킹 통합 데이터셋 생성
 * - data/opp-geocode.json (좌표) + SF Task 상세 → data/visit-tracking.json
 * - API/페이지는 이 파일만 읽어서 SF 부담 없음
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const axios = require('axios');

const GEOCODE_PATH = path.join(__dirname, '../../data/opp-geocode.json');
const OUT_PATH = path.join(__dirname, '../../data/visit-tracking.json');

async function sfAuth() {
  if (process.env.SF_ACCESS_TOKEN && process.env.SF_INSTANCE_URL) {
    return { token: process.env.SF_ACCESS_TOKEN, url: process.env.SF_INSTANCE_URL };
  }
  const r = await axios.post(process.env.SF_LOGIN_URL + '/services/oauth2/token',
    new URLSearchParams({
      grant_type: 'password',
      client_id: process.env.SF_CLIENT_ID,
      client_secret: process.env.SF_CLIENT_SECRET,
      username: process.env.SF_USERNAME,
      password: decodeURIComponent(process.env.SF_PASSWORD),
    }));
  return { token: r.data.access_token, url: r.data.instance_url };
}

async function soql(sf, q) {
  let all = [];
  let url = sf.url + '/services/data/v59.0/query?q=' + encodeURIComponent(q);
  while (url) {
    const r = await axios.get(url, { headers: { Authorization: 'Bearer ' + sf.token } });
    all.push(...(r.data.records || []));
    url = r.data.nextRecordsUrl ? sf.url + r.data.nextRecordsUrl : null;
  }
  return all;
}

const utcToKstDateStr = utc => utc ? new Date(new Date(utc).getTime() + 9 * 3600000).toISOString().slice(0, 10) : null;
const utcToKstDateTime = utc => utc ? new Date(new Date(utc).getTime() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : null;
const daysBetween = (a, b) => (a && b) ? Math.round((new Date(b) - new Date(a)) / 86400000) : null;
const extractHref = html => {
  if (!html || typeof html !== 'string') return null;
  const m = html.match(/href=["']([^"']+)["']/i);
  return m ? m[1] : null;
};
const minutesBetween = (a, b) => (a && b) ? Math.round((new Date(b) - new Date(a)) / 60000) : null;
const cleanStr = s => {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  return (t && t !== 'null' && t !== 'NULL' && t !== 'undefined') ? t : null;
};

(async () => {
  const t0 = Date.now();
  console.log('1) 지오코딩 캐시 로드');
  const geo = JSON.parse(fs.readFileSync(GEOCODE_PATH, 'utf8'));
  const oppIds = Object.keys(geo);
  console.log(`   ${oppIds.length}건 Opp`);

  console.log('2) SF 인증');
  const sf = await sfAuth();

  console.log('3) Task 전수 조회 (Opp 매핑)');
  const allTasks = [];
  for (let i = 0; i < oppIds.length; i += 200) {
    const chunk = oppIds.slice(i, i + 200).map(x => "'" + x + "'").join(',');
    const r = await soql(sf, `SELECT Id, WhatId, Subject, Description, Status, ActivityDate, CreatedDate, CompletedDateTime, OwnerId, Owner.Name FROM Task WHERE WhatId IN (${chunk}) ORDER BY ActivityDate ASC NULLS LAST, CreatedDate ASC`);
    allTasks.push(...r);
    process.stdout.write(`\r   ${allTasks.length} tasks…`);
  }
  console.log(`\n   총 Task ${allTasks.length}건`);

  console.log('4) Opp별 Task 그룹핑 + 파생필드 계산');
  const today = new Date().toISOString().slice(0, 10);
  const byOpp = {};
  for (const t of allTasks) {
    if (!byOpp[t.WhatId]) byOpp[t.WhatId] = [];
    byOpp[t.WhatId].push({
      id: t.Id,
      subject: t.Subject || '',
      description: t.Description || '',
      status: t.Status,
      activityDate: t.ActivityDate,
      createdAt: utcToKstDateTime(t.CreatedDate),
      createdAtRaw: t.CreatedDate,
      completedAt: utcToKstDateTime(t.CompletedDateTime),
      ownerName: t.Owner?.Name,
      ownerId: t.OwnerId,
    });
  }

  // Task Owner도 부서 매핑 풀에 합치기 (Opp Owner ≠ 방문자 케이스 처리)
  const taskOwnerIds = new Set();
  for (const t of allTasks) if (t.OwnerId) taskOwnerIds.add(t.OwnerId);

  console.log('5) Opportunity 메타 + Owner 부서 보강');
  const oppMeta = {};
  const ownerIdSet = new Set();
  for (let i = 0; i < oppIds.length; i += 500) {
    const chunk = oppIds.slice(i, i + 500).map(x => "'" + x + "'").join(',');
    const r = await soql(sf, `SELECT Id, Name, StageName, CloseDate, CreatedDate, LastModifiedDate, OwnerId, Owner.Name FROM Opportunity WHERE Id IN (${chunk})`);
    for (const o of r) {
      oppMeta[o.Id] = {
        name: o.Name,
        stage: o.StageName,
        closeDate: o.CloseDate,
        createdAt: utcToKstDateStr(o.CreatedDate),
        lastModified: utcToKstDateStr(o.LastModifiedDate),
        owner: o.Owner?.Name,
        ownerId: o.OwnerId,
      };
      if (o.OwnerId) ownerIdSet.add(o.OwnerId);
    }
  }

  console.log('5b) Visit__c 조회 (정식 방문 오브젝트)');
  const visitsByOpp = {};
  const visitUserIds = new Set();
  for (let i = 0; i < oppIds.length; i += 200) {
    const chunk = oppIds.slice(i, i + 200).map(x => "'" + x + "'").join(',');
    const r = await soql(sf, `SELECT Id, Name, Opportunity__c, User__c, User__r.Name, OwnerId, Owner.Name,
      LocalInviteDate__c, ConselStart__c, ConselEnd__c, Realtime__c,
      IsVisitComplete__c, Visit_Status__c, VisitAssignmentDate__c,
      fm_CommuicationName__c, fm_CommuicationPhone__c, fm_CommuicationType__c,
      fm_PresidentName__c, fm_PresidentPhone__c, fm_MainContactPhone__c,
      fm_NaverMap__c, fm_NaverPlace__c, fm_LeadSource__c, CreatedDate
      FROM Visit__c WHERE Opportunity__c IN (${chunk}) ORDER BY LocalInviteDate__c ASC NULLS LAST`);
    for (const v of r) {
      const oid = v.Opportunity__c;
      if (!visitsByOpp[oid]) visitsByOpp[oid] = [];
      if (v.User__c) visitUserIds.add(v.User__c);
      visitsByOpp[oid].push(v);
    }
  }
  console.log(`   Visit__c ${Object.values(visitsByOpp).reduce((s, a) => s + a.length, 0)}건 / ${Object.keys(visitsByOpp).length}개 Opp`);

  // Owner Department 매핑 — Opp Owner + Task Owner + Visit__c User__c 모두
  const ownerDept = {};
  const allOwnerIds = [...new Set([...ownerIdSet, ...taskOwnerIds, ...visitUserIds])];
  for (let i = 0; i < allOwnerIds.length; i += 200) {
    const chunk = allOwnerIds.slice(i, i + 200).map(x => "'" + x + "'").join(',');
    const r = await soql(sf, `SELECT Id, Name, Department, IsActive FROM User WHERE Id IN (${chunk})`);
    for (const u of r) {
      ownerDept[u.Id] = { dept: u.Department || null, isActive: u.IsActive, name: u.Name };
    }
  }
  console.log(`   부서 매핑: ${Object.keys(ownerDept).length}명 (Opp ${ownerIdSet.size} + Task ${taskOwnerIds.size} + Visit ${visitUserIds.size})`);

  console.log('6) 통합 레코드 생성');
  const records = [];
  for (const oppId of oppIds) {
    const g = geo[oppId];
    if (g.geocodeFailed) continue;
    const tasks = (byOpp[oppId] || []).sort((a, b) => {
      const ad = a.activityDate || a.createdAtRaw?.slice(0, 10);
      const bd = b.activityDate || b.createdAtRaw?.slice(0, 10);
      return (ad || '').localeCompare(bd || '');
    });
    const meta = oppMeta[oppId] || {};
    const completed = tasks.filter(t => t.status === 'Completed');
    const open = tasks.filter(t => t.status !== 'Completed');
    const lastCompleted = completed[completed.length - 1];
    const lastTaskDate = lastCompleted?.activityDate || lastCompleted?.createdAtRaw?.slice(0, 10);
    const daysSinceLastTask = lastTaskDate ? daysBetween(lastTaskDate, today) : null;
    const nextOpen = open.sort((a, b) => (a.activityDate || '').localeCompare(b.activityDate || ''))[0];
    // ── Visit__c 정식 데이터 우선 사용 ──
    const visitRecords = (visitsByOpp[oppId] || []).map(v => ({
      visitId: v.Id,
      visitName: v.Name,
      visitorId: v.User__c,
      visitor: v.User__r?.Name,
      visitDate: v.LocalInviteDate__c ? utcToKstDateStr(v.LocalInviteDate__c) : null,
      visitDateTime: v.LocalInviteDate__c ? utcToKstDateTime(v.LocalInviteDate__c) : null,
      conselStart: v.ConselStart__c ? utcToKstDateTime(v.ConselStart__c) : null,
      conselEnd: v.ConselEnd__c ? utcToKstDateTime(v.ConselEnd__c) : null,
      durationMin: minutesBetween(v.ConselStart__c, v.ConselEnd__c),
      isComplete: !!v.IsVisitComplete__c,
      status: v.Visit_Status__c,
      communicationName: cleanStr(v.fm_CommuicationName__c),
      communicationPhone: cleanStr(v.fm_CommuicationPhone__c),
      communicationType: cleanStr(v.fm_CommuicationType__c),
      presidentName: cleanStr(v.fm_PresidentName__c),
      presidentPhone: cleanStr(v.fm_PresidentPhone__c),
      mainContactPhone: cleanStr(v.fm_MainContactPhone__c),
      naverMapUrl: extractHref(v.fm_NaverMap__c),
      naverPlaceUrl: extractHref(v.fm_NaverPlace__c),
      leadSource: v.fm_LeadSource__c,
      createdAt: utcToKstDateStr(v.CreatedDate),
    })).filter(v => v.visitDate); // 일정 없는 건 제외
    visitRecords.sort((a, b) => (a.visitDate || '').localeCompare(b.visitDate || ''));

    // 완료된 visit 중 가장 최근
    const completedVisits = visitRecords.filter(v => v.isComplete);
    const lastCompletedVisit = completedVisits[completedVisits.length - 1] || null;
    // 미래 예정 visit 중 가장 가까운 것
    const upcomingVisits = visitRecords.filter(v => !v.isComplete && v.visitDate >= today);
    const nextScheduledVisit = upcomingVisits[0] || null;
    // 정체 영업기회를 보여주는 입장에서, 컨택 정보는 최신 visit 기준
    const latestVisit = visitRecords[visitRecords.length - 1] || null;

    // ── 폴백: Task subject "방문" 기반 추정 (Visit__c 없을 때) ──
    const visitTasks = tasks.filter(t => /방문/.test(t.subject));
    const taskVisitDates = [...new Set(visitTasks.map(v => v.activityDate || v.createdAtRaw?.slice(0, 10)))].filter(Boolean);
    const sortedTaskVisits = [...visitTasks].sort((a, b) => {
      const ad = a.activityDate || a.createdAtRaw?.slice(0, 10) || '';
      const bd = b.activityDate || b.createdAtRaw?.slice(0, 10) || '';
      return bd.localeCompare(ad); // 최신순
    });

    // lastVisitor: Visit__c.lastCompleted > Visit__c.latest > Task 추정
    const primaryVisit = lastCompletedVisit || latestVisit;
    const lastVisitor = primaryVisit?.visitor || sortedTaskVisits[0]?.ownerName || null;
    const lastVisitorId = primaryVisit?.visitorId || sortedTaskVisits[0]?.ownerId || null;
    const lastVisitorDept = lastVisitorId ? (ownerDept[lastVisitorId]?.dept || null) : null;
    const lastVisitorActive = lastVisitorId ? (ownerDept[lastVisitorId]?.isActive ?? null) : null;
    const lastVisitDate = primaryVisit?.visitDate || sortedTaskVisits[0]?.activityDate || sortedTaskVisits[0]?.createdAtRaw?.slice(0, 10) || null;
    const visitDates = [...new Set([...visitRecords.map(v => v.visitDate), ...taskVisitDates])].filter(Boolean).sort();
    const firstVisit = visitDates[0];
    const visitorSet = new Set();
    for (const v of visitRecords) if (v.visitor) visitorSet.add(v.visitor);
    for (const v of visitTasks) if (v.ownerName) visitorSet.add(v.ownerName);
    const visitors = [...visitorSet];

    // 현장 컨택 정보 (최신 visit 기준)
    const contact = latestVisit ? {
      communicationName: latestVisit.communicationName,
      communicationPhone: latestVisit.communicationPhone,
      communicationType: latestVisit.communicationType,
      presidentName: latestVisit.presidentName,
      presidentPhone: latestVisit.presidentPhone,
      mainContactPhone: latestVisit.mainContactPhone,
    } : null;
    const naverMapUrl = latestVisit?.naverMapUrl || null;
    const naverPlaceUrl = latestVisit?.naverPlaceUrl || null;
    // 견적/CW 진입 일자 (단계 기반은 stage 전환 이력 별도 필요 — 일단 task subject로 근사)
    const quoteTask = completed.find(t => /견적/.test(t.subject));
    const cwTask = completed.find(t => /계약|체결|승인|CW/i.test(t.subject));
    const oppDeptInfo = meta.ownerId ? ownerDept[meta.ownerId] : null;
    records.push({
      oppId,
      name: meta.name || g.oppName,
      stage: meta.stage || g.stage,
      // Opp Owner (관리/Pipeline 책임자)
      oppOwner: meta.owner || g.owner,
      oppOwnerDept: oppDeptInfo?.dept || null,
      // 방문 담당자 (실제 현장 간 사람) — 들렀다 가기의 기준
      lastVisitor,
      lastVisitorDept,
      lastVisitorActive,
      lastVisitDate,
      visitors,
      // Visit__c 정식 데이터
      visitsCount: visitRecords.length,
      visits: visitRecords,
      lastCompletedVisit,
      nextScheduledVisit,
      hasUpcomingVisit: upcomingVisits.length > 0,
      // 현장 컨택 (최신 visit 기준)
      contact,
      naverMapUrl,
      naverPlaceUrl,
      // Task 전체 (타임라인용)
      tasks: tasks.map(t => ({
        id: t.id,
        subject: t.subject,
        description: (t.description || '').slice(0, 400), // 본문 (400자 컷)
        activityDate: t.activityDate || (t.createdAtRaw ? t.createdAtRaw.slice(0, 10) : null),
        createdAt: t.createdAt,
        completedAt: t.completedAt,
        status: t.status,
        owner: t.ownerName,
        ownerDept: t.ownerId ? (ownerDept[t.ownerId]?.dept || null) : null,
        isVisit: /방문/.test(t.subject),
      })),
      // 빠른 접근용 — 최근 완료된 Task (nearby 카드에 노출)
      lastTask: (() => {
        const recent = tasks.filter(t => t.activityDate || t.createdAtRaw).sort((a, b) => {
          const ad = a.activityDate || a.createdAtRaw?.slice(0, 10) || '';
          const bd = b.activityDate || b.createdAtRaw?.slice(0, 10) || '';
          return bd.localeCompare(ad);
        })[0];
        if (!recent) return null;
        return {
          subject: recent.subject,
          description: (recent.description || '').slice(0, 200),
          date: recent.activityDate || recent.createdAtRaw?.slice(0, 10),
          owner: recent.ownerName,
          status: recent.status,
        };
      })(),
      // 호환용: owner/dept는 lastVisitor/Dept로 매핑
      owner: lastVisitor || meta.owner || g.owner,
      dept: lastVisitorDept || oppDeptInfo?.dept || null,
      account: g.account,
      closeDate: meta.closeDate,
      createdAt: meta.createdAt,
      lastModified: meta.lastModified,
      // 위치
      lat: g.lat,
      lng: g.lng,
      sido: g.sido,
      sigugun: g.sigugun,
      rawAddress: g.rawAddress,
      roadAddress: g.roadAddress,
      // 방문
      visitDates,
      firstVisit,
      visitCount: visitDates.length,
      // 진행 상태
      lastTaskDate,
      lastTaskSubject: lastCompleted?.subject,
      daysSinceLastTask,
      hasOpenTask: open.length > 0,
      openTaskCount: open.length,
      nextOpenTaskDate: nextOpen?.activityDate,
      nextOpenTaskSubject: nextOpen?.subject,
      // lead time
      daysVisitToQuote: firstVisit && quoteTask?.activityDate ? daysBetween(firstVisit, quoteTask.activityDate) : null,
      daysVisitToCw: firstVisit && cwTask?.activityDate ? daysBetween(firstVisit, cwTask.activityDate) : null,
      // 정체 신호: 견적 단계 + 마지막 task로부터 8일 이상 + 열린 task 없음
      isStuck: (meta.stage === '견적') && (daysSinceLastTask >= 8) && open.length === 0,
      // 전체 task (페이지에서 timeline 표시용)
      tasksCount: tasks.length,
    });
  }

  console.log(`   ${records.length}건`);

  console.log('7) 저장 (legacy 통합 파일)');
  const out = {
    generatedAt: new Date().toISOString(),
    periodStart: '2026-03-01',
    periodEnd: today,
    totalOpps: records.length,
    records,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 1), 'utf8');
  console.log(`   → ${OUT_PATH} (${(fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(1)} MB)`);

  // ── 새 구조: 팀별 + summary 분리 ──
  console.log('8) 팀별/summary 분리');
  const DEPT_SLUG = {
    '아웃바운드세일즈': 'outbound',
    '인바운드세일즈': 'inbound',
    '채널매니지먼트': 'channel',
    '리텐션': 'retention',
    '마케팅': 'marketing',
    '채널세일즈': 'channel-sales',
  };
  const isClosed = r => r.stage === 'Closed Won' || r.stage === 'Closed Lost';
  const openRecords = records.filter(r => !isClosed(r));

  const splitDir = path.join(__dirname, '../../data/visits');
  if (!fs.existsSync(splitDir)) fs.mkdirSync(splitDir, { recursive: true });

  // 팀별 파일 (진행중만, 전체 detail)
  const byDept = {};
  for (const r of openRecords) {
    const dept = r.lastVisitorDept || r.dept || '미지정';
    if (!byDept[dept]) byDept[dept] = [];
    byDept[dept].push(r);
  }
  for (const [dept, recs] of Object.entries(byDept)) {
    const slug = DEPT_SLUG[dept] || dept.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const teamPath = path.join(splitDir, `team-${slug}.json`);
    const teamOut = {
      generatedAt: out.generatedAt,
      periodStart: out.periodStart,
      periodEnd: out.periodEnd,
      dept,
      slug,
      total: recs.length,
      records: recs,
    };
    fs.writeFileSync(teamPath, JSON.stringify(teamOut, null, 1), 'utf8');
    console.log(`   → team-${slug}.json (${recs.length}건 / ${(fs.statSync(teamPath).size / 1024 / 1024).toFixed(2)} MB) — ${dept}`);
  }

  // summary 파일 (전사 통계 + 정체 리스트만)
  const stageCount = {};
  const deptCount = {};
  const ownerStat = {};
  const dailyTrend = {};
  let totalCw = 0, totalCl = 0, totalOpen = 0, totalStuck = 0;

  for (const r of records) {
    stageCount[r.stage] = (stageCount[r.stage] || 0) + 1;
    const dept = r.lastVisitorDept || r.dept || '미지정';
    if (!deptCount[dept]) deptCount[dept] = { dept, open: 0, stuck: 0, cw: 0, cl: 0 };
    const dc = deptCount[dept];
    const owner = r.lastVisitor || r.owner || '(미지정)';
    if (!ownerStat[owner]) ownerStat[owner] = { owner, dept, visits: 0, cw: 0, cl: 0, open: 0, stuck: 0 };
    const os = ownerStat[owner];
    os.visits++;
    if (r.stage === 'Closed Won') { totalCw++; dc.cw++; os.cw++; }
    else if (r.stage === 'Closed Lost') { totalCl++; dc.cl++; os.cl++; }
    else { totalOpen++; dc.open++; os.open++; }
    if (r.isStuck) { totalStuck++; dc.stuck++; os.stuck++; }
    if (r.firstVisit) {
      if (!dailyTrend[r.firstVisit]) dailyTrend[r.firstVisit] = { date: r.firstVisit, visits: 0, cw: 0 };
      dailyTrend[r.firstVisit].visits++;
      if (r.stage === 'Closed Won') dailyTrend[r.firstVisit].cw++;
    }
  }

  const ownerList = Object.values(ownerStat).map(o => ({
    ...o,
    closed: o.cw + o.cl,
    cwRate: (o.cw + o.cl) > 0 ? Math.round(o.cw / (o.cw + o.cl) * 1000) / 10 : 0,
  })).sort((a, b) => b.visits - a.visits);

  const SF_BASE = 'https://torder.lightning.force.com/lightning/r/Opportunity';
  const stuckList = records.filter(r => r.isStuck).map(r => ({
    oppId: r.oppId,
    name: r.name,
    visitor: r.lastVisitor || r.owner,
    visitorDept: r.lastVisitorDept || r.dept,
    stage: r.stage,
    sido: r.sido,
    sigugun: r.sigugun,
    firstVisit: r.firstVisit,
    lastTaskDate: r.lastTaskDate,
    daysSinceLastTask: r.daysSinceLastTask,
    lastTaskSubject: r.lastTaskSubject,
    hasOpenTask: r.hasOpenTask,
    lightningUrl: `${SF_BASE}/${r.oppId}/view`,
  })).sort((a, b) => b.daysSinceLastTask - a.daysSinceLastTask);

  const summary = {
    generatedAt: out.generatedAt,
    period: { start: out.periodStart, end: out.periodEnd },
    total: {
      opps: records.length,
      cw: totalCw,
      cl: totalCl,
      open: totalOpen,
      stuck: totalStuck,
      cwRate: (totalCw + totalCl) > 0 ? Math.round(totalCw / (totalCw + totalCl) * 1000) / 10 : 0,
    },
    byStage: Object.entries(stageCount).map(([stage, count]) => ({ stage, count })).sort((a, b) => b.count - a.count),
    byDept: Object.values(deptCount).sort((a, b) => b.open - a.open),
    byOwner: ownerList,
    trend: Object.values(dailyTrend).sort((a, b) => a.date.localeCompare(b.date)),
    stuck: stuckList,
  };
  const sumPath = path.join(splitDir, 'summary.json');
  fs.writeFileSync(sumPath, JSON.stringify(summary, null, 1), 'utf8');
  console.log(`   → summary.json (${(fs.statSync(sumPath).size / 1024).toFixed(0)} KB / 정체 ${stuckList.length}건)`);

  // 요약
  const stuck = records.filter(r => r.isStuck);
  const byStage = records.reduce((m, r) => { m[r.stage] = (m[r.stage] || 0) + 1; return m; }, {});
  const byOwnerStuck = stuck.reduce((m, r) => { m[r.owner] = (m[r.owner] || 0) + 1; return m; }, {});
  console.log('\n=== 요약 ===');
  console.log('단계 분포:', Object.entries(byStage).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ':' + v).join(' | '));
  console.log('견적 8일+ 정체:', stuck.length, '건');
  console.log('정체 담당자 상위:', Object.entries(byOwnerStuck).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ':' + v).join(' | '));
  console.log(`\n총 소요: ${((Date.now() - t0) / 1000).toFixed(1)}초`);
})().catch(e => { console.error('FATAL', e.response?.data || e.message); process.exit(1); });
