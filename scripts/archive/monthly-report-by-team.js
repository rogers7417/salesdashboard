/**
 * 4월 월간 보고서 — KPI 명세(team-kpi-spec.md) 기반
 *   인바운드: 속도 (FRT, SLA, Stage Dwell)
 *   채널:    Lead Gen (LeadSource·Account 분리, 가맹점, 전환율)
 *   아웃바운드: TBD + 단순 카운트
 *
 * 출력: reports/2026-04-monthly-report.html
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const sf = require('../../server/api/services/salesforce');

function kstStartUtcIso(y, m, d = 1) { return new Date(Date.UTC(y, m - 1, d - 1, 15, 0, 0)).toISOString(); }
const APR_START = kstStartUtcIso(2026, 4, 1);
const APR_END   = kstStartUtcIso(2026, 5, 1);
const PRV_START = kstStartUtcIso(2026, 3, 1);
const PRV_END   = kstStartUtcIso(2026, 4, 1);

const SLA_MINUTES = 30;            // 인바운드 SLA 임계값 (잠정)
const NO_RESP_HOURS = 24;          // 24h 미응답 기준

const TEAMS = [
  { key: 'inbound',  label: '인바운드',  depts: ['인바운드세일즈'],         kpi: '속도 (FRT, Stage Dwell)',         color: '#3182f6' },
  { key: 'channel',  label: '채널',      depts: ['채널세일즈팀', '채널매니지먼트'], kpi: 'Lead Gen (신규 Lead·Opp 창출)',    color: '#8b5cf6' },
  { key: 'outbound', label: '아웃바운드', depts: ['아웃바운드세일즈'],        kpi: 'TBD (팀장 확인 필요)',              color: '#f59f00' },
];

// 채널 LeadSource (Lead Gen 1차 KPI)
const CHANNEL_LEAD_SOURCES = ['파트너사 소개', '프랜차이즈소개'];
// 채널 Account 카테고리 (Lead Gen 1차 KPI)
const CHANNEL_ACCOUNT_TYPES = ['파트너사', '프랜차이즈본사', '브랜드'];

function diffMinutes(a, b) { if (!a || !b) return null; return (new Date(b) - new Date(a)) / 60000; }
function diffDays(a, b) { if (!a || !b) return null; return (new Date(b) - new Date(a)) / 86400000; }
function median(s) { if (!s.length) return null; const i = Math.floor(s.length / 2); return Math.round((s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2) * 10) / 10; }
function pct(s, p) { if (!s.length) return null; if (s.length === 1) return Math.round(s[0] * 10) / 10; const idx = (s.length - 1) * p; const lo = Math.floor(idx), hi = Math.ceil(idx); return Math.round((lo === hi ? s[lo] : s[lo] * (1 - (idx - lo)) + s[hi] * (idx - lo)) * 10) / 10; }
function statsOf(arr) {
  if (!arr.length) return { n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  return { n: s.length, median: median(s), p25: pct(s, 0.25), p75: pct(s, 0.75), p90: pct(s, 0.9) };
}

(async () => {
  // ---- 부서/사람 ----
  const allDepts = TEAMS.flatMap((t) => t.depts);
  const inDepts = allDepts.map((d) => `'${d}'`).join(',');
  console.log('[1/8] User...');
  const users = await sf.queryAll(`
    SELECT Id, Department FROM User WHERE Department IN (${inDepts})
  `.replace(/\s+/g, ' ').trim());
  const userTeam = new Map();
  const teamMembers = new Map(TEAMS.map((t) => [t.key, 0]));
  users.forEach((u) => {
    const t = TEAMS.find((tm) => tm.depts.includes(u.Department));
    if (!t) return;
    userTeam.set(u.Id, t.key);
    teamMembers.set(t.key, (teamMembers.get(t.key) || 0) + 1);
  });
  const allUserIds = users.map((u) => `'${u.Id}'`).join(',');

  // ---- Lead 4월/3월 ----
  console.log('[2/8] Lead...');
  const [leadsApr, leadsPrv] = await Promise.all([
    sf.queryAll(`
      SELECT Id, OwnerId, CreatedDate, ConvertedDate, ConvertedOpportunityId,
             LeadSource, LossReason__c, Company
      FROM Lead WHERE OwnerId IN (${allUserIds})
        AND CreatedDate >= ${APR_START} AND CreatedDate < ${APR_END}
    `.replace(/\s+/g, ' ').trim()),
    sf.queryAll(`
      SELECT Id, OwnerId, CreatedDate, ConvertedOpportunityId, LeadSource
      FROM Lead WHERE OwnerId IN (${allUserIds})
        AND CreatedDate >= ${PRV_START} AND CreatedDate < ${PRV_END}
    `.replace(/\s+/g, ' ').trim()),
  ]);
  const filterNoise = (l) =>
    l.LossReason__c !== '오생성' &&
    l.LeadSource !== '아웃바운드' &&
    !(l.Company && l.Company.toLowerCase().includes('test'));

  // ---- Opp 4월/3월 ----
  console.log('[3/8] Opp...');
  const [oppsApr, oppsPrv, cwApr] = await Promise.all([
    sf.queryAll(`
      SELECT Id, OwnerId, BOUser__c, FieldUser__c, CreatedDate, LastStageChangeDate, StageName,
             IsWon, IsClosed, RecordType.Name, Owner_Department__c, fm_CompanyStatus__c, LeadSource
      FROM Opportunity
      WHERE Owner_Department__c IN (${inDepts})
        AND CreatedDate >= ${APR_START} AND CreatedDate < ${APR_END}
    `.replace(/\s+/g, ' ').trim()),
    sf.queryAll(`
      SELECT Id, OwnerId, IsWon FROM Opportunity
      WHERE Owner_Department__c IN (${inDepts})
        AND CreatedDate >= ${PRV_START} AND CreatedDate < ${PRV_END}
    `.replace(/\s+/g, ' ').trim()),
    sf.queryAll(`
      SELECT Id, OwnerId, BOUser__c, FieldUser__c, CreatedDate, LastStageChangeDate,
             RecordType.Name, fm_CompanyStatus__c
      FROM Opportunity
      WHERE Owner_Department__c IN (${inDepts}) AND IsWon = true
        AND LastStageChangeDate >= ${APR_START} AND LastStageChangeDate < ${APR_END}
        AND RecordType.Name = '1. 테이블오더 (신규)'
    `.replace(/\s+/g, ' ').trim()),
  ]);

  // ---- Account 4월 (채널 KPI) ----
  console.log('[4/8] Account...');
  const accountsApr = await sf.queryAll(`
    SELECT Id, fm_AccountType__c, FRBrand__c, OwnerId, CreatedDate
    FROM Account
    WHERE OwnerId IN (${allUserIds})
      AND CreatedDate >= ${APR_START} AND CreatedDate < ${APR_END}
  `.replace(/\s+/g, ' ').trim());

  // ---- Visit (방문배정 dwell 보조) ----
  console.log('[5/8] Visit...');
  const allOppIds = [...new Set([...oppsApr.map((o) => o.Id), ...cwApr.map((o) => o.Id)])];
  const visits = [];
  for (let i = 0; i < allOppIds.length; i += 200) {
    const inList = allOppIds.slice(i, i + 200).map((id) => `'${id}'`).join(',');
    if (!inList) continue;
    const res = await sf.queryAll(`
      SELECT Opportunity__c, ConselStart__c, ConselEnd__c
      FROM Visit__c WHERE Opportunity__c IN (${inList}) AND IsVisitComplete__c = true
    `.replace(/\s+/g, ' ').trim());
    visits.push(...res);
  }
  const firstVisitByOpp = new Map();
  visits.forEach((v) => {
    const ts = v.ConselEnd__c || v.ConselStart__c;
    if (!ts) return;
    const prev = firstVisitByOpp.get(v.Opportunity__c);
    if (!prev || new Date(ts) < new Date(prev)) firstVisitByOpp.set(v.Opportunity__c, ts);
  });

  // ---- Task (FRT 계산용) ----
  // 인바운드 4월 Lead의 첫 Task (WhoId=Lead.Id)
  console.log('[6/8] Task (FRT)...');
  const inboundLeadIds = leadsApr.filter((l) => userTeam.get(l.OwnerId) === 'inbound' && filterNoise(l)).map((l) => l.Id);
  const tasksByLead = new Map();
  for (let i = 0; i < inboundLeadIds.length; i += 200) {
    const inList = inboundLeadIds.slice(i, i + 200).map((id) => `'${id}'`).join(',');
    if (!inList) continue;
    const res = await sf.queryAll(`
      SELECT Id, WhoId, CreatedDate, OwnerId
      FROM Task
      WHERE WhoId IN (${inList})
        AND CreatedDate >= ${APR_START}
        AND OwnerId != '005IR00000FgbZtYAJ'
      ORDER BY WhoId, CreatedDate ASC
    `.replace(/\s+/g, ' ').trim());
    res.forEach((t) => {
      if (!tasksByLead.has(t.WhoId)) tasksByLead.set(t.WhoId, t);
    });
  }

  // ---- OpportunityFieldHistory (Stage Dwell) ----
  console.log('[7/8] OpportunityFieldHistory...');
  // CW Opp의 Stage 전환 이력
  const cwOppIds = cwApr.map((o) => o.Id);
  const stageHist = [];
  for (let i = 0; i < cwOppIds.length; i += 200) {
    const inList = cwOppIds.slice(i, i + 200).map((id) => `'${id}'`).join(',');
    if (!inList) continue;
    const res = await sf.queryAll(`
      SELECT OpportunityId, CreatedDate, NewValue, OldValue
      FROM OpportunityFieldHistory
      WHERE Field = 'StageName' AND OpportunityId IN (${inList})
      ORDER BY OpportunityId, CreatedDate
    `.replace(/\s+/g, ' ').trim());
    stageHist.push(...res);
  }
  const histByOpp = new Map();
  stageHist.forEach((h) => {
    const arr = histByOpp.get(h.OpportunityId) || [];
    arr.push(h);
    histByOpp.set(h.OpportunityId, arr);
  });

  // ---- 집계: 인바운드 FRT/SLA ----
  console.log('[8/8] 집계...');
  const inboundFrtMins = [];
  let inboundSlaPass = 0;
  let inbound24hNoResp = 0;
  let inboundLeadEligible = 0;
  const aprilStartMs = new Date(APR_START).getTime();
  const noRespCutoffMs = new Date(APR_END).getTime() - NO_RESP_HOURS * 3600 * 1000; // 24h 전 까지 생성된 Lead만 평가

  leadsApr.forEach((l) => {
    if (userTeam.get(l.OwnerId) !== 'inbound') return;
    if (!filterNoise(l)) return;
    inboundLeadEligible++;
    const t = tasksByLead.get(l.Id);
    const frtMin = t ? diffMinutes(l.CreatedDate, t.CreatedDate) : null;
    if (frtMin != null && frtMin >= 0) {
      inboundFrtMins.push(frtMin);
      if (frtMin <= SLA_MINUTES) inboundSlaPass++;
    }
    // 24h 미응답: Lead 생성 후 24h 지났는데 Task 없음
    if (new Date(l.CreatedDate).getTime() <= noRespCutoffMs && !t) inbound24hNoResp++;
  });

  // ---- 인바운드 Stage Dwell (CW Opp 기준) ----
  // 구간별 dwell 일수
  const stageDwell = {
    '방문배정→견적': [],
    '견적→계약진행': [],
    '계약진행→선납금': [],
    '선납금→출고진행': [],
    '출고진행→설치진행': [],
    '설치진행→Closed Won': [],
  };
  cwApr.forEach((o) => {
    if (userTeam.get(o.OwnerId) !== 'inbound') return;
    const trans = histByOpp.get(o.Id) || [];
    if (!trans.length) return;
    // 시간순 정렬됨. 각 NewValue로 진입한 시점 기록
    const enterTime = {};
    if (trans[0].oldValue) enterTime[trans[0].oldValue] = new Date(o.CreatedDate).getTime();
    trans.forEach((t) => {
      const ms = new Date(t.CreatedDate).getTime();
      if (t.newValue && enterTime[t.newValue] == null) enterTime[t.newValue] = ms;
      // 전이마다 거리 추적
    });
    // 각 구간 dwell = 다음 stage 진입 - 현재 stage 진입
    const seq = ['방문배정', '견적', '계약진행', '선납금', '출고진행', '설치진행', 'Closed Won'];
    for (let i = 0; i < seq.length - 1; i++) {
      const cur = seq[i], next = seq[i + 1];
      if (enterTime[cur] != null && enterTime[next] != null && enterTime[next] >= enterTime[cur]) {
        const days = (enterTime[next] - enterTime[cur]) / 86400000;
        stageDwell[`${cur}→${next}`].push(days);
      }
    }
  });

  // ---- 채널 KPI ----
  const channelLeadsApr = leadsApr.filter((l) => userTeam.get(l.OwnerId) === 'channel' && filterNoise(l));
  const channelLeadByType = {};
  CHANNEL_LEAD_SOURCES.forEach((s) => (channelLeadByType[s] = 0));
  let channelLeadOther = 0;
  channelLeadsApr.forEach((l) => {
    if (CHANNEL_LEAD_SOURCES.includes(l.LeadSource)) channelLeadByType[l.LeadSource]++;
    else channelLeadOther++;
  });

  const channelAccountsApr = accountsApr.filter((a) => userTeam.get(a.OwnerId) === 'channel');
  const channelAccountByType = {};
  CHANNEL_ACCOUNT_TYPES.forEach((t) => (channelAccountByType[t] = 0));
  let channelAccountOther = 0;
  channelAccountsApr.forEach((a) => {
    if (CHANNEL_ACCOUNT_TYPES.includes(a.fm_AccountType__c)) channelAccountByType[a.fm_AccountType__c]++;
    else channelAccountOther++;
  });
  const channelFranchise = channelAccountsApr.filter((a) => a.FRBrand__c).length;

  const channelOppsApr = oppsApr.filter((o) => userTeam.get(o.OwnerId) === 'channel');
  // 채널 신규 Opp의 LeadSource 분리
  const channelOppByLeadSource = {};
  channelOppsApr.forEach((o) => {
    const k = o.LeadSource || '(없음)';
    channelOppByLeadSource[k] = (channelOppByLeadSource[k] || 0) + 1;
  });

  // 채널 Lead → Opp 30일 코호트 전환율
  const channelLeadIds = new Set(channelLeadsApr.map((l) => l.Id));
  let channelLeadConverted = 0;
  channelLeadsApr.forEach((l) => {
    if (l.ConvertedOpportunityId) channelLeadConverted++;
  });
  const channelConversionRate = channelLeadsApr.length ? Math.round(channelLeadConverted / channelLeadsApr.length * 100) : 0;

  // ---- 팀별 공통 카운트 ----
  const teamCounts = {};
  TEAMS.forEach((t) => (teamCounts[t.key] = {
    leadAprAll: 0, leadAprNoise: 0, leadConverted: 0, leadPrv: 0,
    oppApr: 0, oppPrv: 0, cwApr: 0,
    preOpenCw: 0, operatingCw: 0,
  }));
  leadsApr.forEach((l) => {
    const team = userTeam.get(l.OwnerId);
    if (!team) return;
    teamCounts[team].leadAprAll++;
    if (filterNoise(l)) {
      teamCounts[team].leadAprNoise++;
      if (l.ConvertedOpportunityId) teamCounts[team].leadConverted++;
    }
  });
  leadsPrv.forEach((l) => { const team = userTeam.get(l.OwnerId); if (team) teamCounts[team].leadPrv++; });
  oppsApr.forEach((o) => { const team = userTeam.get(o.OwnerId); if (team) teamCounts[team].oppApr++; });
  oppsPrv.forEach((o) => { const team = userTeam.get(o.OwnerId); if (team) teamCounts[team].oppPrv++; });
  cwApr.forEach((o) => {
    const team = userTeam.get(o.OwnerId);
    if (!team) return;
    teamCounts[team].cwApr++;
    if (o.fm_CompanyStatus__c === '오픈전') teamCounts[team].preOpenCw++;
    else teamCounts[team].operatingCw++;
  });

  // ---- HTML 렌더 ----
  const html = renderHtml({
    generatedAt: new Date().toISOString(),
    teamMembers: Object.fromEntries(teamMembers),
    teamCounts,
    inbound: {
      frt: statsOf(inboundFrtMins),
      slaPassRate: inboundFrtMins.length ? Math.round(inboundSlaPass / inboundFrtMins.length * 100) : 0,
      slaPassCount: inboundSlaPass,
      noRespond24h: inbound24hNoResp,
      eligibleLeads: inboundLeadEligible,
      stageDwell: Object.fromEntries(Object.entries(stageDwell).map(([k, v]) => [k, statsOf(v)])),
    },
    channel: {
      leadByType: channelLeadByType,
      leadOther: channelLeadOther,
      leadTotal: channelLeadsApr.length,
      accountByType: channelAccountByType,
      accountOther: channelAccountOther,
      accountTotal: channelAccountsApr.length,
      franchise: channelFranchise,
      oppTotal: channelOppsApr.length,
      oppByLeadSource: channelOppByLeadSource,
      conversionRate: channelConversionRate,
      convertedCount: channelLeadConverted,
    },
  });

  const outDir = path.join(__dirname, '..', '..', 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, '2026-04-monthly-report.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`\n✓ HTML 저장: ${outPath}`);
})().catch((e) => { console.error('실패:', e?.message || e); if (e?.response?.data) console.error(JSON.stringify(e.response.data, null, 2)); process.exit(1); });

// =============================================================
function pctChange(cur, prev) { return prev ? Math.round((cur - prev) / prev * 100) : null; }
function badge(pc) {
  if (pc == null) return '';
  if (pc > 0) return `<span class="b-up">▲ +${pc}%</span>`;
  if (pc < 0) return `<span class="b-down">▼ ${pc}%</span>`;
  return `<span class="b-flat">— 동일</span>`;
}
function slaLevel(pct) { return pct >= 80 ? 'good' : pct >= 65 ? 'mid' : 'poor'; }

function renderHtml(d) {
  const inbound  = renderInbound(d);
  const channel  = renderChannel(d);
  const outbound = renderOutbound(d);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>2026년 4월 세일즈 월간 보고서</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Pretendard:wght@400;500;600;700;800&display=swap');
  :root {
    --bg:#f5f6f8; --card:#fff; --border:#e8ebed;
    --text-primary:#191f28; --text-secondary:#6b7684; --text-tertiary:#8b95a1;
    --blue:#3182f6; --blue-light:#e8f3ff;
    --red:#f04452; --red-light:#fff0f0;
    --green:#00b386; --green-light:#e8fff4;
    --orange:#f59f00; --orange-light:#fff8e6;
    --purple:#8b5cf6; --purple-light:#f3f0ff;
    --shadow:0 2px 8px rgba(0,0,0,0.04); --radius:16px;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Pretendard',sans-serif;background:var(--bg);color:var(--text-primary);padding:32px;line-height:1.5}
  .container{max-width:1200px;margin:0 auto}
  header{margin-bottom:32px}
  h1{font-size:28px;font-weight:800;margin-bottom:6px}
  .meta{color:var(--text-tertiary);font-size:13px}
  .toc{display:flex;gap:12px;margin-bottom:32px}
  .toc a{flex:1;text-align:center;padding:14px;background:#fff;border-radius:12px;text-decoration:none;box-shadow:var(--shadow);border:1px solid var(--border);color:var(--text-primary);font-weight:700;transition:transform .2s}
  .toc a:hover{transform:translateY(-2px)}

  .team-section{background:#fff;border-radius:var(--radius);padding:32px;margin-bottom:24px;box-shadow:var(--shadow);border:1px solid var(--border)}
  .team-header{display:flex;align-items:center;gap:16px;margin-bottom:8px;padding-bottom:16px;border-bottom:2px solid var(--border)}
  .team-bar{width:8px;height:32px;border-radius:4px}
  .team-name{font-size:24px;font-weight:800}
  .team-members{color:var(--text-tertiary);font-size:14px;margin-left:auto}
  .team-kpi-line{font-size:13px;color:var(--text-secondary);margin-bottom:24px;padding:12px 16px;background:var(--bg);border-radius:8px}
  .team-kpi-line strong{color:var(--text-primary)}

  .kpi-block{margin-bottom:20px}
  .kpi-block-title{font-size:15px;font-weight:700;margin-bottom:10px;padding-bottom:6px;border-bottom:1px dashed var(--border)}
  .kpi-block-tag{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;margin-right:8px}
  .tag-1차{background:var(--blue-light);color:var(--blue)}
  .tag-2차{background:var(--purple-light);color:var(--purple)}
  .tag-후행{background:#eef0f2;color:var(--text-secondary)}

  .kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px}
  .kpi-tile{background:var(--bg);border-radius:12px;padding:16px}
  .kpi-tile .lbl{font-size:12px;color:var(--text-secondary);margin-bottom:6px}
  .kpi-tile .val{font-size:24px;font-weight:800;line-height:1.1}
  .kpi-tile .sub{font-size:11px;color:var(--text-tertiary);margin-top:4px}
  .kpi-tile.good{border:2px solid var(--green);background:var(--green-light)}
  .kpi-tile.mid{border:2px solid var(--orange);background:var(--orange-light)}
  .kpi-tile.poor{border:2px solid var(--red);background:var(--red-light)}

  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:10px 12px;text-align:right;border-bottom:1px solid var(--border)}
  th:first-child,td:first-child{text-align:left;font-weight:600}
  th{color:var(--text-secondary);background:var(--bg);font-weight:600}

  .b-up{color:var(--green);font-weight:700;font-size:12px}
  .b-down{color:var(--red);font-weight:700;font-size:12px}
  .b-flat{color:var(--text-secondary);font-size:12px}

  .insight-box{background:var(--blue-light);border-left:4px solid var(--blue);padding:14px 18px;border-radius:8px;margin-top:12px;font-size:13px;color:var(--text-secondary)}
  .insight-box.warn{background:var(--orange-light);border-left-color:var(--orange)}
  .insight-box strong{color:var(--text-primary)}

  .footer-note{padding:16px 20px;background:#f9fafb;border-radius:12px;font-size:12px;color:var(--text-secondary);margin-top:24px}
  .footer-note strong{color:var(--text-primary)}

  @media (max-width:768px){.kpi-row{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
<div class="container">
<header>
  <h1>2026년 4월 세일즈 월간 보고서</h1>
  <p style="color:var(--text-secondary);font-size:15px;margin-bottom:8px">팀별 KPI 명세(team-kpi-spec.md) 기반</p>
  <p class="meta">기간: 2026-04-01 ~ 2026-04-30 KST · 생성: ${new Date(d.generatedAt).toLocaleString('ko-KR')}</p>
</header>

<div class="toc">
  <a href="#inbound" style="color:#3182f6">인바운드 (속도)</a>
  <a href="#channel" style="color:#8b5cf6">채널 (Lead Gen)</a>
  <a href="#outbound" style="color:#f59f00">아웃바운드 (TBD)</a>
</div>

${inbound}
${channel}
${outbound}

<div class="footer-note">
  <strong>본 보고서는 team-kpi-spec.md v1.0 draft 명세를 따릅니다.</strong><br>
  · 모든 KPI는 평균 금지, 중앙값 + P25/P75/P90 으로 표기<br>
  · CW 태블릿/매출은 모든 팀의 후행 지표 — 1차 평가는 팀별 선행 KPI 사용<br>
  · 아웃바운드/리텐션 KPI 정의 확정 후 추가 보강 예정<br>
  · SLA 임계값(30분)은 잠정 — 사용자 확정 필요
</div>

</div>
</body>
</html>`;
}

function renderInbound(d) {
  const tc = d.teamCounts.inbound;
  const fb = d.inbound;
  const slaCls = slaLevel(fb.slaPassRate);
  const dwellRows = Object.entries(fb.stageDwell).map(([name, s]) => {
    if (!s.n) return `<tr><td>${name}</td><td colspan="3" style="text-align:center;color:#999">데이터 없음</td></tr>`;
    return `<tr><td>${name}</td><td>${s.n}건</td><td><strong>${s.median}일</strong></td><td>${s.p75}일</td></tr>`;
  }).join('');

  return `
<section id="inbound" class="team-section">
  <div class="team-header">
    <div class="team-bar" style="background:#3182f6"></div>
    <div class="team-name">인바운드</div>
    <div class="team-members">${d.teamMembers.inbound}명 (인바운드세일즈)</div>
  </div>
  <div class="team-kpi-line"><strong>평가축 (속도):</strong> 인입된 Lead를 빠르게 응답·처리해 전환 기회를 놓치지 않는 것</div>

  <div class="kpi-block">
    <div class="kpi-block-title"><span class="kpi-block-tag tag-1차">1차 KPI</span>FRT (First Response Time)</div>
    <div class="kpi-row">
      <div class="kpi-tile"><div class="lbl">중앙값</div><div class="val">${fb.frt.n ? fb.frt.median + '분' : '-'}</div><div class="sub">n=${fb.frt.n}</div></div>
      <div class="kpi-tile"><div class="lbl">P25 (빠른 25%)</div><div class="val">${fb.frt.n ? fb.frt.p25 + '분' : '-'}</div></div>
      <div class="kpi-tile"><div class="lbl">P75 (느린 25%)</div><div class="val">${fb.frt.n ? fb.frt.p75 + '분' : '-'}</div></div>
      <div class="kpi-tile"><div class="lbl">P90</div><div class="val">${fb.frt.n ? fb.frt.p90 + '분' : '-'}</div></div>
    </div>
  </div>

  <div class="kpi-block">
    <div class="kpi-block-title"><span class="kpi-block-tag tag-1차">1차 KPI</span>SLA 준수율 (30분 이내 첫 응답)</div>
    <div class="kpi-row">
      <div class="kpi-tile ${slaCls}"><div class="lbl">SLA 준수율</div><div class="val">${fb.slaPassRate}%</div><div class="sub">${fb.slaPassCount}/${fb.frt.n}건 · 정상 ≥80%</div></div>
      <div class="kpi-tile"><div class="lbl">평가 가능 Lead</div><div class="val">${fb.eligibleLeads}건</div><div class="sub">노이즈 제외</div></div>
      <div class="kpi-tile"><div class="lbl">FRT 측정 Lead</div><div class="val">${fb.frt.n}건</div><div class="sub">Task 매칭 성공</div></div>
      <div class="kpi-tile"><div class="lbl">SLA 임계값</div><div class="val" style="font-size:18px">30분</div><div class="sub">잠정 (확정 필요)</div></div>
    </div>
  </div>

  <div class="kpi-block">
    <div class="kpi-block-title"><span class="kpi-block-tag tag-1차">1차 KPI</span>Stage Dwell (4월 마감 매장 기준, 일)</div>
    <table>
      <thead><tr><th>구간</th><th>n</th><th>중앙값</th><th>P75</th></tr></thead>
      <tbody>${dwellRows}</tbody>
    </table>
  </div>

  <div class="kpi-block">
    <div class="kpi-block-title"><span class="kpi-block-tag tag-2차">2차 KPI</span>미응답·지연 Lead</div>
    <div class="kpi-row">
      <div class="kpi-tile"><div class="lbl">24h 미응답 Lead</div><div class="val">${fb.noRespond24h}건</div><div class="sub">생성 후 24h 경과 + Task 없음</div></div>
      <div class="kpi-tile"><div class="lbl">Lead 처리율</div><div class="val">${tc.leadAprNoise ? Math.round(tc.leadConverted / tc.leadAprNoise * 100) : 0}%</div><div class="sub">${tc.leadConverted}/${tc.leadAprNoise} Convert</div></div>
      <div class="kpi-tile"><div class="lbl">Lead 인입 (4월)</div><div class="val">${tc.leadAprNoise.toLocaleString()}건</div><div class="sub">3월 ${tc.leadPrv} ${badge(pctChange(tc.leadAprNoise, tc.leadPrv))}</div></div>
      <div class="kpi-tile"><div class="lbl">신규 Opp</div><div class="val">${tc.oppApr.toLocaleString()}건</div><div class="sub">3월 ${tc.oppPrv} ${badge(pctChange(tc.oppApr, tc.oppPrv))}</div></div>
    </div>
  </div>

  <div class="kpi-block">
    <div class="kpi-block-title"><span class="kpi-block-tag tag-후행">후행</span>CW 태블릿 (참고)</div>
    <div class="kpi-row">
      <div class="kpi-tile"><div class="lbl">CW 마감</div><div class="val">${tc.cwApr.toLocaleString()}건</div><div class="sub">신규 테이블오더만</div></div>
      <div class="kpi-tile"><div class="lbl">오픈전 / 운영중</div><div class="val" style="font-size:18px">${tc.preOpenCw} / ${tc.operatingCw}</div></div>
    </div>
    <div class="insight-box">속도가 좋아야 따라오는 후행 지표. 1차 평가에 사용 금지.</div>
  </div>

  <div class="insight-box warn">
    <strong>예외 탐지 룰 (참고):</strong> INB-01 FRT 중앙값 &gt; 60분 / INB-02 SLA &lt; 65% (3일 연속) / INB-03 24h 미응답 ≥ 10건 / INB-04 견적→계약 dwell P75 &gt; Q1 baseline × 1.5
  </div>
</section>`;
}

function renderChannel(d) {
  const tc = d.teamCounts.channel;
  const c = d.channel;
  const partnerLead = c.leadByType['파트너사 소개'] || 0;
  const franchiseLead = c.leadByType['프랜차이즈소개'] || 0;
  const partnerAcc = c.accountByType['파트너사'] || 0;
  const franchiseHQ = c.accountByType['프랜차이즈본사'] || 0;
  const brandAcc = c.accountByType['브랜드'] || 0;
  const oppRows = Object.entries(c.oppByLeadSource).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `<tr><td>${k}</td><td>${v}건 (${Math.round(v/c.oppTotal*100)}%)</td></tr>`).join('');

  return `
<section id="channel" class="team-section">
  <div class="team-header">
    <div class="team-bar" style="background:#8b5cf6"></div>
    <div class="team-name">채널</div>
    <div class="team-members">${d.teamMembers.channel}명 (채널세일즈팀, 채널매니지먼트)</div>
  </div>
  <div class="team-kpi-line"><strong>평가축 (Lead Gen):</strong> 파트너사·프랜차이즈 본사·가맹점 발굴을 통해 신규 영업 기회를 창출하는 것</div>

  <div class="kpi-block">
    <div class="kpi-block-title"><span class="kpi-block-tag tag-1차">1차 KPI</span>신규 Lead 창출 (LeadSource 분리)</div>
    <div class="kpi-row">
      <div class="kpi-tile"><div class="lbl">파트너사 소개</div><div class="val">${partnerLead}건</div></div>
      <div class="kpi-tile"><div class="lbl">프랜차이즈소개</div><div class="val">${franchiseLead}건</div></div>
      <div class="kpi-tile"><div class="lbl">기타 LeadSource</div><div class="val">${c.leadOther}건</div><div class="sub">홈페이지·전화 등</div></div>
      <div class="kpi-tile"><div class="lbl">총 Lead</div><div class="val">${c.leadTotal}건</div><div class="sub">3월 ${tc.leadPrv} ${badge(pctChange(c.leadTotal, tc.leadPrv))}</div></div>
    </div>
  </div>

  <div class="kpi-block">
    <div class="kpi-block-title"><span class="kpi-block-tag tag-1차">1차 KPI</span>신규 채널 Account 등록</div>
    <div class="kpi-row">
      <div class="kpi-tile"><div class="lbl">파트너사</div><div class="val">${partnerAcc}건</div></div>
      <div class="kpi-tile"><div class="lbl">프랜차이즈본사</div><div class="val">${franchiseHQ}건</div></div>
      <div class="kpi-tile"><div class="lbl">브랜드</div><div class="val">${brandAcc}건</div></div>
      <div class="kpi-tile"><div class="lbl">기타 Type</div><div class="val">${c.accountOther}건</div></div>
    </div>
  </div>

  <div class="kpi-block">
    <div class="kpi-block-title"><span class="kpi-block-tag tag-1차">1차 KPI</span>가맹점 신규 연결 + Opp 창출</div>
    <div class="kpi-row">
      <div class="kpi-tile"><div class="lbl">신규 가맹점 연결</div><div class="val">${c.franchise}건</div><div class="sub">FRBrand 채워진 Account</div></div>
      <div class="kpi-tile"><div class="lbl">신규 Opp 창출</div><div class="val">${c.oppTotal}건</div><div class="sub">3월 ${tc.oppPrv} ${badge(pctChange(c.oppTotal, tc.oppPrv))}</div></div>
      <div class="kpi-tile"><div class="lbl">Lead → Opp 전환율</div><div class="val">${c.conversionRate}%</div><div class="sub">${c.convertedCount}/${c.leadTotal}건 (즉시 코호트)</div></div>
      <div class="kpi-tile"><div class="lbl">평균 1인당 Lead</div><div class="val">${d.teamMembers.channel ? Math.round(c.leadTotal / d.teamMembers.channel * 10) / 10 : 0}건</div></div>
    </div>
    <table style="margin-top:12px">
      <thead><tr><th>채널 신규 Opp LeadSource</th><th>건수</th></tr></thead>
      <tbody>${oppRows}</tbody>
    </table>
  </div>

  <div class="kpi-block">
    <div class="kpi-block-title"><span class="kpi-block-tag tag-2차">2차 KPI</span>Lead → Opp 전환율 (코호트)</div>
    <div class="insight-box">즉시 코호트 ${c.conversionRate}% — 명세상 30/60/90일 코호트로 측정 권장. 4월 인입 Lead의 30일 후 시점 측정 시 정확도 향상.</div>
  </div>

  <div class="kpi-block">
    <div class="kpi-block-title"><span class="kpi-block-tag tag-후행">후행</span>CW 태블릿 (참고)</div>
    <div class="kpi-row">
      <div class="kpi-tile"><div class="lbl">CW 마감</div><div class="val">${tc.cwApr.toLocaleString()}건</div></div>
      <div class="kpi-tile"><div class="lbl">오픈전 / 운영중</div><div class="val" style="font-size:18px">${tc.preOpenCw} / ${tc.operatingCw}</div></div>
    </div>
    <div class="insight-box">Lead Gen이 잘되면 시차 두고 따라오는 후행 지표. 1차 평가에 사용 금지.</div>
  </div>

  <div class="insight-box warn">
    <strong>예외 탐지 룰 (참고):</strong> CHN-01 신규 파트너사+프랜차이즈본사 = 0건 / CHN-02 주간 Lead 중앙값 &lt; 전월 × 0.7 / CHN-03 30일 전환율 &lt; 전월 × 0.7 / CHN-04 특정 LeadSource 7일 연속 0건 / CHN-05 가맹점 신규 연결 &lt; Q1 중앙값 × 0.5
  </div>
</section>`;
}

function renderOutbound(d) {
  const tc = d.teamCounts.outbound;
  return `
<section id="outbound" class="team-section">
  <div class="team-header">
    <div class="team-bar" style="background:#f59f00"></div>
    <div class="team-name">아웃바운드</div>
    <div class="team-members">${d.teamMembers.outbound}명 (아웃바운드세일즈)</div>
  </div>
  <div class="team-kpi-line"><strong>평가축:</strong> <span style="color:var(--orange);font-weight:700">TBD (팀장 확인 필요)</span> · KPI 후보: 콜 시도 수, 접촉 성공률, 데모 예약 수, Opp 생성률</div>

  <div class="kpi-block">
    <div class="kpi-block-title"><span class="kpi-block-tag tag-후행">참고 카운트</span>활동 규모 (KPI 미정)</div>
    <div class="kpi-row">
      <div class="kpi-tile"><div class="lbl">Lead 인입</div><div class="val">${tc.leadAprNoise.toLocaleString()}건</div><div class="sub">3월 ${tc.leadPrv} ${badge(pctChange(tc.leadAprNoise, tc.leadPrv))}</div></div>
      <div class="kpi-tile"><div class="lbl">신규 Opp</div><div class="val">${tc.oppApr.toLocaleString()}건</div><div class="sub">3월 ${tc.oppPrv} ${badge(pctChange(tc.oppApr, tc.oppPrv))}</div></div>
      <div class="kpi-tile"><div class="lbl">Lead → Opp 전환율</div><div class="val">${tc.leadAprNoise ? Math.round(tc.leadConverted / tc.leadAprNoise * 100) : 0}%</div><div class="sub">${tc.leadConverted}/${tc.leadAprNoise}</div></div>
      <div class="kpi-tile"><div class="lbl">CW 마감 (후행)</div><div class="val">${tc.cwApr.toLocaleString()}건</div></div>
    </div>
  </div>

  <div class="insight-box warn">
    <strong>주의:</strong> 아웃바운드 KPI가 아직 확정되지 않아 카운트 위주의 단순 표시. 평가축이 정해진 후 본격 분석 가능.
    명세에 따른 후보: 콜 시도 수, 접촉 성공률, 데모 예약 수, Opp 생성률.
  </div>
</section>`;
}
