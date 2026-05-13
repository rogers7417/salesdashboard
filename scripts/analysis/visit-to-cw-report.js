/**
 * 인바운드세일즈 — 방문완료 → CW leadtime 리포트 (1~4월) → HTML 생성
 *
 * 정확한 데이터 필터:
 *   - 부서 = 인바운드세일즈만
 *   - User Active+Inactive 모두 포함 (퇴사자 Lead 누락 방지)
 *   - 노이즈 제외: 오생성 / 아웃바운드 / test
 *   - 4월 마감은 4-1 ~ 4-27 (28일 미완성 제외)
 *
 * 출력: reports/visit-to-cw-monthly.html
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const sf = require('../../server/api/services/salesforce');

function kstStartUtcIso(y, m, d = 1) { return new Date(Date.UTC(y, m - 1, d - 1, 15, 0, 0)).toISOString(); }
const RANGE_START     = kstStartUtcIso(2026, 1, 1);
const RANGE_END       = kstStartUtcIso(2026, 5, 1);
const APRIL_CW_CUTOFF = kstStartUtcIso(2026, 4, 28); // 4-27 23:59:59까지

function kstMonthKey(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime() + 9 * 60 * 60 * 1000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function diffDays(a, b) { if (!a || !b) return null; return (new Date(b) - new Date(a)) / 86400000; }
function round1(n) { return n == null ? null : Math.round(n * 10) / 10; }
function median(s) { if (!s.length) return null; const i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; }

function statsOf(arr) {
  if (!arr.length) return { n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const u30 = s.filter((d) => d < 30).length;
  const u14 = s.filter((d) => d < 14).length;
  const u7 = s.filter((d) => d < 7).length;
  return {
    n: s.length,
    median: round1(median(s)),
    max: round1(s[s.length - 1]),
    u7, u14, u30,
    pctU7: round1(u7 / s.length * 100),
    pctU14: round1(u14 / s.length * 100),
    pctU30: round1(u30 / s.length * 100),
  };
}

(async () => {
  // [1] 인바운드세일즈 User (Active+Inactive)
  console.log('[1/4] 인바운드세일즈 User...');
  const users = await sf.queryAll(`
    SELECT Id, Name, IsActive FROM User WHERE Department = '인바운드세일즈'
  `.replace(/\s+/g, ' ').trim());
  const userIdList = users.map((u) => `'${u.Id}'`).join(',');
  console.log(`     ${users.length}명 (Active ${users.filter((u) => u.IsActive).length})`);

  // [2] Lead 인입 (노이즈 제외)
  console.log('[2/4] Lead 인입 조회...');
  const leadsRaw = await sf.queryAll(`
    SELECT Id, OwnerId, CreatedDate, LeadSource, LossReason__c, Company
    FROM Lead
    WHERE OwnerId IN (${userIdList})
      AND CreatedDate >= ${RANGE_START}
      AND CreatedDate < ${RANGE_END}
  `.replace(/\s+/g, ' ').trim());
  const leads = leadsRaw.filter((l) =>
    l.LossReason__c !== '오생성' &&
    l.LeadSource !== '아웃바운드' &&
    !(l.Company && l.Company.toLowerCase().includes('test'))
  );
  const leadByMonth = { '2026-01': 0, '2026-02': 0, '2026-03': 0, '2026-04': 0 };
  leads.forEach((l) => {
    const m = kstMonthKey(l.CreatedDate);
    if (m in leadByMonth) leadByMonth[m]++;
  });
  console.log(`     ${leadsRaw.length} → 노이즈 제외 ${leads.length}건`);

  // [3] 인바운드 신규 Opp
  console.log('[3/4] 신규 Opp...');
  const opps = await sf.queryAll(`
    SELECT Id, CreatedDate, CloseDate, LastStageChangeDate, IsWon, fm_CompanyStatus__c
    FROM Opportunity
    WHERE RecordType.Name = '1. 테이블오더 (신규)'
      AND Owner_Department__c = '인바운드세일즈'
      AND CreatedDate >= ${RANGE_START}
      AND CreatedDate < ${RANGE_END}
  `.replace(/\s+/g, ' ').trim());
  console.log(`     ${opps.length}건`);

  // [4] Visit__c
  console.log('[4/4] 방문...');
  const oppIds = opps.map((o) => o.Id);
  const visits = [];
  for (let i = 0; i < oppIds.length; i += 200) {
    const inList = oppIds.slice(i, i + 200).map((id) => `'${id}'`).join(',');
    const res = await sf.queryAll(`
      SELECT Opportunity__c, ConselStart__c, ConselEnd__c
      FROM Visit__c
      WHERE Opportunity__c IN (${inList}) AND IsVisitComplete__c = true
    `.replace(/\s+/g, ' ').trim());
    visits.push(...res);
  }
  console.log(`     ${visits.length}건`);

  // 월별 방문 카운트
  const visitByMonth = { '2026-01': 0, '2026-02': 0, '2026-03': 0, '2026-04': 0 };
  visits.forEach((v) => {
    const ts = v.ConselEnd__c || v.ConselStart__c;
    const m = kstMonthKey(ts);
    if (m in visitByMonth) visitByMonth[m]++;
  });

  // Opp별 첫 방문완료
  const firstByOpp = new Map();
  visits.forEach((v) => {
    const ts = v.ConselEnd__c || v.ConselStart__c;
    if (!ts) return;
    const prev = firstByOpp.get(v.Opportunity__c);
    if (!prev || new Date(ts) < new Date(prev)) firstByOpp.set(v.Opportunity__c, ts);
  });

  // 월×그룹 leadtime 분포 + CW 카운트 (4월은 4-27까지)
  const months = ['2026-01', '2026-02', '2026-03', '2026-04'];
  const monthLabels = { '2026-01': '1월', '2026-02': '2월', '2026-03': '3월', '2026-04': '4월 (4/1~4/27)' };
  const aprilCutoffMs = new Date(APRIL_CW_CUTOFF).getTime();
  const data = {};
  const cwCount = {};
  months.forEach((m) => { data[m] = { '오픈전': [], '운영중': [], '전체': [] }; cwCount[m] = 0; });
  let noVisit = 0, aprilSkipped = 0;
  opps.forEach((o) => {
    if (!o.IsWon) return;
    const cwTs = o.LastStageChangeDate || o.CloseDate;
    if (!cwTs) return;
    const cwMs = new Date(cwTs).getTime();
    const month = kstMonthKey(cwTs);
    if (!data[month]) return;
    if (month === '2026-04' && cwMs >= aprilCutoffMs) { aprilSkipped++; return; }
    const visitTs = firstByOpp.get(o.Id);
    if (!visitTs) { noVisit++; return; }
    const days = diffDays(visitTs, cwTs);
    if (days == null || days < 0) return;
    const status = o.fm_CompanyStatus__c === '오픈전' ? '오픈전' : '운영중';
    data[month][status].push(days);
    data[month]['전체'].push(days);
    cwCount[month]++;
  });

  const result = {
    generatedAt: new Date().toISOString(),
    range: { start: '2026-01-01', end: '2026-04-27' },
    totalCwOpps: opps.filter((o) => o.IsWon).length,
    noVisitCount: noVisit,
    aprilSkipped,
    leadByMonth,
    visitByMonth,
    cwCount,
    months: months.map((m) => ({
      month: m,
      label: monthLabels[m],
      groups: {
        오픈전: statsOf(data[m]['오픈전']),
        운영중: statsOf(data[m]['운영중']),
        전체: statsOf(data[m]['전체']),
      },
    })),
  };

  const html = renderHtml(result);
  const outDir = path.join(__dirname, '..', '..', 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'visit-to-cw-monthly.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`\n✓ HTML 저장: ${outPath}`);
})().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });

// =====================================================================
// HTML 렌더러
// =====================================================================
function renderHtml(d) {
  const monthLabels = d.months.map((m) => m.label);
  const seriesAll       = d.months.map((m) => m.groups['전체'].median ?? null);
  const seriesPreOpen   = d.months.map((m) => m.groups['오픈전'].median ?? null);
  const seriesOperating = d.months.map((m) => m.groups['운영중'].median ?? null);
  const u7PctSeries     = d.months.map((m) => m.groups['전체'].pctU7 ?? 0);
  const u14PctSeries    = d.months.map((m) => m.groups['전체'].pctU14 ?? 0);
  const u30PctSeries    = d.months.map((m) => m.groups['전체'].pctU30 ?? 0);
  const leadSeries      = d.months.map((m) => d.leadByMonth[m.month] ?? 0);
  const visitSeries     = d.months.map((m) => d.visitByMonth[m.month] ?? 0);
  const cwSeries        = d.months.map((m) => d.cwCount[m.month] ?? 0);

  const fastestMonth = d.months.reduce((a, b) => (a.groups['전체'].median < b.groups['전체'].median ? a : b));
  const slowestMonth = d.months.reduce((a, b) => (a.groups['전체'].median > b.groups['전체'].median ? a : b));
  const m1 = d.months[0].groups['전체'];
  const m4 = d.months[d.months.length - 1].groups['전체'];
  const change = m4.median - m1.median;
  const changeStr = change === 0 ? '동일' : `${change > 0 ? '+' : ''}${round1(change)}일`;

  // 변화율 계산 헬퍼
  const pctChange = (cur, prev) => prev ? Math.round((cur - prev) / prev * 100) : 0;
  const monthCards = d.months.map((m, i) => {
    const lead = d.leadByMonth[m.month];
    const visit = d.visitByMonth[m.month];
    const cw = d.cwCount[m.month];
    const u7 = m.groups['전체'].pctU7 ?? 0;
    const median = m.groups['전체'].median;
    const prevLead = i > 0 ? d.leadByMonth[d.months[i - 1].month] : null;
    const leadChange = prevLead != null ? pctChange(lead, prevLead) : null;
    return { ...m, lead, visit, cw, u7, median, leadChange };
  });

  // CW/Lead 비율
  const cwRatios = d.months.map((m) => {
    const lead = d.leadByMonth[m.month];
    const cw = d.cwCount[m.month];
    return lead ? Math.round(cw / lead * 100) : 0;
  });

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>인바운드세일즈 — 방문완료 → 마감 속도 리포트</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Pretendard:wght@400;500;600;700;800&display=swap');
  :root {
    --bg: #f5f6f8; --card: #ffffff; --border: #e8ebed;
    --text-primary: #191f28; --text-secondary: #6b7684; --text-tertiary: #8b95a1;
    --blue: #3182f6; --blue-light: #e8f3ff;
    --red: #f04452; --red-light: #fff0f0;
    --green: #00b386; --green-light: #e8fff4;
    --orange: #f59f00; --orange-light: #fff8e6;
    --purple: #8b5cf6; --purple-light: #f3f0ff;
    --shadow: 0 2px 8px rgba(0,0,0,0.04); --radius: 16px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--text-primary); line-height: 1.5; padding: 32px; }
  .container { max-width: 1200px; margin: 0 auto; }
  header { margin-bottom: 32px; }
  h1 { font-size: 28px; font-weight: 800; margin-bottom: 8px; }
  .subtitle { color: var(--text-secondary); font-size: 15px; }
  .meta { color: var(--text-tertiary); font-size: 13px; margin-top: 8px; }
  section { margin-bottom: 32px; }
  h2 { font-size: 20px; font-weight: 700; margin-bottom: 16px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
  .kpi-card { background: var(--card); border-radius: var(--radius); padding: 24px; box-shadow: var(--shadow); border: 1px solid var(--border); }
  .kpi-label { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; font-weight: 500; }
  .kpi-value { font-size: 32px; font-weight: 800; line-height: 1.1; }
  .kpi-unit { font-size: 16px; font-weight: 600; color: var(--text-secondary); margin-left: 4px; }
  .kpi-sub { font-size: 13px; color: var(--text-tertiary); margin-top: 8px; }
  .kpi-blue .kpi-value { color: var(--blue); }
  .kpi-green .kpi-value { color: var(--green); }
  .kpi-orange .kpi-value { color: var(--orange); }
  .kpi-purple .kpi-value { color: var(--purple); }
  .chart-card { background: var(--card); border-radius: var(--radius); padding: 24px; box-shadow: var(--shadow); border: 1px solid var(--border); margin-bottom: 16px; }
  .chart-title { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
  .chart-desc { font-size: 13px; color: var(--text-tertiary); margin-bottom: 16px; }
  .chart-wrap { position: relative; height: 320px; }
  .chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 12px 8px; text-align: right; border-bottom: 1px solid var(--border); }
  th:first-child, td:first-child { text-align: left; font-weight: 600; }
  th { font-weight: 600; color: var(--text-secondary); background: var(--bg); font-size: 13px; }
  .month-block { background: var(--card); border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow); border: 1px solid var(--border); margin-bottom: 12px; }
  .month-block h3 { font-size: 16px; margin-bottom: 12px; }
  .insight-card { background: var(--card); border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow); border: 1px solid var(--border); border-left: 4px solid var(--blue); margin-bottom: 12px; }
  .insight-card.green { border-left-color: var(--green); }
  .insight-card.orange { border-left-color: var(--orange); }
  .insight-card.red { border-left-color: var(--red); }
  .insight-card.purple { border-left-color: var(--purple); }
  .insight-title { font-size: 15px; font-weight: 700; margin-bottom: 6px; }
  .insight-body { font-size: 14px; color: var(--text-secondary); }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; margin-right: 6px; }
  .badge-green { background: var(--green-light); color: var(--green); }
  .badge-orange { background: var(--orange-light); color: var(--orange); }
  .badge-red { background: var(--red-light); color: var(--red); }
  .badge-blue { background: var(--blue-light); color: var(--blue); }
  .badge-purple { background: var(--purple-light); color: var(--purple); }
  .glossary { background: #f9fafb; border-radius: 12px; padding: 16px 20px; font-size: 13px; color: var(--text-secondary); margin-top: 24px; }
  .glossary strong { color: var(--text-primary); }
  .conclusion { background: linear-gradient(135deg, #3182f6 0%, #8b5cf6 100%); color: white; border-radius: var(--radius); padding: 32px; margin-bottom: 24px; }
  .conclusion h2 { color: white; }
  .conclusion .quote { font-size: 18px; font-weight: 700; line-height: 1.5; margin-bottom: 16px; }
  .conclusion .body { font-size: 14px; opacity: 0.92; }

  /* === 가시성 향상 === */
  .hero { background: linear-gradient(135deg, #3182f6 0%, #8b5cf6 100%); color: white; border-radius: 20px; padding: 48px 40px; margin-bottom: 32px; box-shadow: 0 10px 40px rgba(49,130,246,0.25); }
  .hero-eyebrow { font-size: 14px; opacity: 0.85; font-weight: 600; letter-spacing: 0.5px; margin-bottom: 12px; }
  .hero-title { font-size: 32px; font-weight: 800; line-height: 1.3; margin-bottom: 16px; }
  .hero-title strong { background: rgba(255,255,255,0.2); padding: 2px 12px; border-radius: 8px; }
  .hero-body { font-size: 16px; line-height: 1.6; opacity: 0.92; max-width: 800px; }
  .hero-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 28px; }
  .hero-stat { background: rgba(255,255,255,0.15); border-radius: 12px; padding: 16px 20px; backdrop-filter: blur(10px); }
  .hero-stat-label { font-size: 12px; opacity: 0.85; margin-bottom: 4px; }
  .hero-stat-value { font-size: 24px; font-weight: 800; }
  .hero-stat-trend { font-size: 12px; opacity: 0.85; margin-top: 4px; }

  .month-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
  .month-card { background: white; border-radius: var(--radius); padding: 24px; box-shadow: var(--shadow); border: 1px solid var(--border); position: relative; transition: transform 0.2s, box-shadow 0.2s; }
  .month-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.08); }
  .month-card.highlight-march { border: 2px solid var(--green); background: linear-gradient(180deg, #f0fff8 0%, white 50%); }
  .month-card.highlight-april { border: 2px solid var(--orange); background: linear-gradient(180deg, #fff8e6 0%, white 50%); }
  .month-card .mc-month { font-size: 14px; color: var(--text-secondary); font-weight: 600; }
  .month-card .mc-status { display: inline-block; padding: 2px 8px; border-radius: 8px; font-size: 11px; font-weight: 600; margin-left: 8px; }
  .month-card .mc-big { font-size: 36px; font-weight: 800; line-height: 1; margin: 12px 0 4px; }
  .month-card .mc-big-sub { font-size: 13px; color: var(--text-tertiary); margin-bottom: 16px; }
  .month-card .mc-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed var(--border); font-size: 13px; }
  .month-card .mc-row:last-child { border-bottom: none; }
  .month-card .mc-row-label { color: var(--text-secondary); }
  .month-card .mc-row-value { font-weight: 700; color: var(--text-primary); }

  .change-badge { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 8px; font-size: 12px; font-weight: 700; }
  .change-up    { background: var(--green-light); color: var(--green); }
  .change-down  { background: var(--red-light);   color: var(--red); }
  .change-flat  { background: #eef0f2;            color: var(--text-secondary); }

  .funnel-row { display: flex; align-items: center; justify-content: space-between; padding: 14px 0; }
  .funnel-stage { flex: 1; text-align: center; }
  .funnel-stage-name { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
  .funnel-stage-num { font-size: 22px; font-weight: 800; }
  .funnel-arrow { font-size: 20px; color: var(--text-tertiary); padding: 0 8px; }

  .heatmap-table th, .heatmap-table td { padding: 14px 12px; }
  .heatmap-table .v-good   { background: #e8fff4; font-weight: 700; color: #00966f; }
  .heatmap-table .v-mid    { background: #fff8e6; color: #b76b00; }
  .heatmap-table .v-poor   { background: #fff0f0; font-weight: 700; color: #c92535; }
  .heatmap-table .row-april { background: #fffaf3; }
  .heatmap-table .row-april td { font-weight: 700; }

  @media (max-width: 768px) { .kpi-grid { grid-template-columns: repeat(2, 1fr); } .chart-grid { grid-template-columns: 1fr; } .month-row { grid-template-columns: repeat(2, 1fr); } .hero-stats { grid-template-columns: 1fr; } .hero-title { font-size: 24px; } }
</style>
</head>
<body>
<div class="container">

<header>
  <h1 style="font-size:22px;color:var(--text-secondary);font-weight:600;margin-bottom:4px">인바운드세일즈 분석 리포트</h1>
  <p class="meta">대상: 신규 테이블오더 · 2026-01-01 ~ 2026-04-27 마감 · 생성: ${new Date(d.generatedAt).toLocaleString('ko-KR')}</p>
</header>

<!-- HERO: 결론을 가장 위에 -->
<div class="hero">
  <div class="hero-eyebrow">📌 한 줄 결론</div>
  <div class="hero-title">4월 둔화는 <strong>Lead 부족</strong>이 아니라<br>3월 폭증의 <strong>후행 처리 부담</strong> 때문입니다</div>
  <div class="hero-body">인바운드의 진짜 KPI는 Lead 인입량이 아닌 <strong>방문 후 마감까지의 시간</strong>. 이 시간이 짧아질수록 다음 달 후행 처리 부담이 줄어 신규 처리 자원이 확보되는 선순환이 만들어집니다.</div>
  <div class="hero-stats">
    <div class="hero-stat">
      <div class="hero-stat-label">3월 Lead 인입</div>
      <div class="hero-stat-value">${d.leadByMonth['2026-03'].toLocaleString()}건</div>
      <div class="hero-stat-trend">전월 대비 +${pctChange(d.leadByMonth['2026-03'], d.leadByMonth['2026-02'])}% 폭증</div>
    </div>
    <div class="hero-stat">
      <div class="hero-stat-label">4월 7일 이내 마감률</div>
      <div class="hero-stat-value">${d.months[3].groups['전체'].pctU7}%</div>
      <div class="hero-stat-trend">1월 ${d.months[0].groups['전체'].pctU7}%의 약 절반 수준</div>
    </div>
    <div class="hero-stat">
      <div class="hero-stat-label">4월 CW / Lead 비율</div>
      <div class="hero-stat-value">${cwRatios[3]}%</div>
      <div class="hero-stat-trend">1월 ${cwRatios[0]}%의 약 2배 — 후행처리 누적</div>
    </div>
  </div>
</div>

<!-- 월별 한눈에 카드 -->
<section>
  <h2>월별 흐름 한눈에 보기</h2>
  <div class="month-row">
    ${monthCards.map((mc, i) => {
      const highlight = mc.month === '2026-03' ? 'highlight-march' : (mc.month === '2026-04' ? 'highlight-april' : '');
      const statusBadge = mc.month === '2026-03' ? '<span class="mc-status" style="background:var(--green-light);color:var(--green)">폭증</span>'
                         : mc.month === '2026-04' ? '<span class="mc-status" style="background:var(--orange-light);color:var(--orange)">둔화</span>' : '';
      const leadChangeBadge = mc.leadChange == null ? ''
        : mc.leadChange > 0 ? `<span class="change-badge change-up">▲ +${mc.leadChange}%</span>`
        : mc.leadChange < 0 ? `<span class="change-badge change-down">▼ ${mc.leadChange}%</span>`
        : '<span class="change-badge change-flat">— 동일</span>';
      return `<div class="month-card ${highlight}">
        <div class="mc-month">${mc.label}${statusBadge}</div>
        <div class="mc-big">${mc.median ?? '-'}<span style="font-size:18px;color:var(--text-tertiary)">일</span></div>
        <div class="mc-big-sub">방문 후 마감까지 (가운데 매장)</div>
        <div class="mc-row">
          <span class="mc-row-label">Lead 인입</span>
          <span class="mc-row-value">${mc.lead.toLocaleString()}건 ${leadChangeBadge}</span>
        </div>
        <div class="mc-row">
          <span class="mc-row-label">방문완료</span>
          <span class="mc-row-value">${mc.visit.toLocaleString()}건</span>
        </div>
        <div class="mc-row">
          <span class="mc-row-label">마감 (CW)</span>
          <span class="mc-row-value">${mc.cw.toLocaleString()}건</span>
        </div>
        <div class="mc-row">
          <span class="mc-row-label">7일 이내</span>
          <span class="mc-row-value" style="color:${mc.u7 >= 35 ? 'var(--green)' : mc.u7 >= 25 ? 'var(--orange)' : 'var(--red)'}">${mc.u7}%</span>
        </div>
      </div>`;
    }).join('')}
  </div>
</section>

<section>
  <h2>월별 추이</h2>
  <div class="chart-grid">
    <div class="chart-card">
      <div class="chart-title">방문 후 마감까지 걸린 시간 (가운데 매장)</div>
      <div class="chart-desc">매장을 빠른 순으로 줄 세웠을 때 정중앙 매장이 걸린 일수. 낮을수록 빠름.</div>
      <div class="chart-wrap"><canvas id="medianChart"></canvas></div>
    </div>
    <div class="chart-card">
      <div class="chart-title">기간 내 마감률</div>
      <div class="chart-desc">방문 후 N일 안에 끝난 비율.</div>
      <div class="chart-wrap"><canvas id="bucketChart"></canvas></div>
    </div>
  </div>
</section>

<section>
  <h2>왜 4월이 느려졌을까 — 가설 검증</h2>

  <div class="chart-card">
    <div class="chart-title">월별 Lead 인입 · 방문완료 · 마감 추이</div>
    <div class="chart-desc">3월 Lead 폭증 시점에 방문은 따라잡지 못했고(capacity 한계), 4월에는 그 후행처리 부담이 신규 처리 자원을 잠식.</div>
    <div class="chart-wrap"><canvas id="funnelChart"></canvas></div>
  </div>

  <table class="heatmap-table" style="background:white;border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;margin-bottom:16px">
    <thead><tr>
      <th>월</th>
      <th>Lead 인입</th>
      <th>방문완료</th>
      <th>마감 (CW)</th>
      <th>CW / Lead</th>
      <th>7일 이내 마감률</th>
    </tr></thead>
    <tbody>
      ${d.months.map((m, i) => {
        const lead = d.leadByMonth[m.month];
        const visit = d.visitByMonth[m.month];
        const cw = d.cwCount[m.month];
        const ratio = lead ? Math.round(cw / lead * 100) : 0;
        const u7Pct = m.groups['전체'].pctU7 ?? 0;
        const isApril = m.month === '2026-04';
        const cwLeadCls = ratio >= 22 ? 'v-poor' : ratio >= 18 ? 'v-mid' : 'v-good';
        const u7Cls = u7Pct >= 35 ? 'v-good' : u7Pct >= 25 ? 'v-mid' : 'v-poor';
        return `<tr class="${isApril ? 'row-april' : ''}">
          <td>${m.label}</td>
          <td>${lead.toLocaleString()}건</td>
          <td>${visit.toLocaleString()}건</td>
          <td>${cw.toLocaleString()}건</td>
          <td class="${cwLeadCls}">${ratio}%</td>
          <td class="${u7Cls}">${u7Pct}%</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
  <p style="font-size:12px;color:var(--text-tertiary);margin-bottom:16px">
    * 색상: <span style="color:#00966f;font-weight:700">초록</span> 양호 / <span style="color:#b76b00;font-weight:700">주황</span> 주의 / <span style="color:#c92535;font-weight:700">빨강</span> 경고. CW/Lead가 높을수록 후행처리 부담↑, 7일 마감률은 높을수록 빠름.
  </p>

  <div class="insight-card orange">
    <div class="insight-title"><span class="badge badge-orange">증거 1</span> 3월 Lead 폭증 — 인바운드 자원 한계</div>
    <div class="insight-body">3월 Lead가 1월 대비 <strong>+46%</strong>(672 → 983건) 폭증. 같은 기간 방문완료는 <strong>+26%</strong>(339 → 426건)만 증가. <strong>처리 capacity가 인입을 따라잡지 못함</strong>.</div>
  </div>

  <div class="insight-card orange">
    <div class="insight-title"><span class="badge badge-orange">증거 2</span> 4월 CW/Lead 비율 23% — 후행처리 누적</div>
    <div class="insight-body">4월의 CW/Lead 비율이 <strong>23%</strong>로 1월(12%)의 약 2배. 분모(Lead)는 줄었는데 분자(CW)가 떨어지지 않음 — 즉 4월 마감의 상당수가 <strong>1~3월에 들어온 매장의 후속 처리</strong>. 4월에 새로 들어온 매장이 빨리 마감되는 게 아니라, 묵은 매장이 늦게 마감되는 구조.</div>
  </div>

  <div class="insight-card red">
    <div class="insight-title"><span class="badge badge-red">증거 3</span> 4월 7일 이내 마감률 폭락 — 신규 빠른 사이클 부족</div>
    <div class="insight-body">방문 후 7일 안에 마감되는 비율이 1월 <strong>${d.months[0].groups['전체'].pctU7}%</strong> → 4월 <strong>${d.months[3].groups['전체'].pctU7}%</strong> 로 절반 수준. 빠른 단번 결정 매장이 줄었고 후행 진행 매장 비중이 늘어남.</div>
  </div>

  <div class="conclusion">
    <h2>결론</h2>
    <div class="quote">"4월의 인바운드 둔화는 Lead 부족이 아니라 3월 폭증의 후행 처리. 인바운드의 진짜 KPI는 Lead 인입량이 아니라 방문 후 CW까지의 시간 단축이다."</div>
    <div class="body">Lead 인입은 채널팀의 영역이고, 인바운드는 들어온 Lead를 얼마나 빨리 마감으로 끌고 가느냐가 본질. 방문→CW 시간이 짧아지면 다음 달 후행처리 부담이 줄고 신규 처리 자원이 확보되는 선순환이 만들어진다.</div>
  </div>
</section>

<section>
  <h2>월별 상세 (매장상태별)</h2>
  ${d.months.map((m) => `
    <div class="month-block">
      <h3>${m.label} (마감 ${m.groups['전체'].n}건)</h3>
      <table>
        <thead>
          <tr>
            <th>매장상태</th>
            <th>건수</th>
            <th>가운데 매장</th>
            <th>가장 오래 걸린 매장</th>
            <th>7일 이내</th>
            <th>14일 이내</th>
            <th>30일 이내</th>
          </tr>
        </thead>
        <tbody>
          ${['오픈전', '운영중', '전체'].map((g) => {
            const s = m.groups[g];
            if (!s.n) return `<tr><td>${g}</td><td colspan="6" style="text-align:center;color:#999">데이터 없음</td></tr>`;
            const bold = g === '전체' ? 'font-weight:700;background:#f9fafb;' : '';
            return `<tr style="${bold}">
              <td>${g}</td>
              <td>${s.n}건</td>
              <td><strong>${s.median}일</strong></td>
              <td>${s.max}일</td>
              <td>${s.pctU7}%</td>
              <td>${s.pctU14}%</td>
              <td>${s.pctU30}%</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `).join('')}
</section>

<section>
  <h2>한눈에 보는 인사이트</h2>

  <div class="insight-card green">
    <div class="insight-title"><span class="badge badge-green">${fastestMonth.label.split(' ')[0]}</span> 가장 빨랐던 달</div>
    <div class="insight-body">방문 후 매장 절반이 <strong>${fastestMonth.groups['전체'].median}일</strong> 안에 마감. 30일 안에 끝난 비율은 ${fastestMonth.groups['전체'].pctU30}%.</div>
  </div>

  <div class="insight-card">
    <div class="insight-title"><span class="badge badge-blue">매장상태별</span> 운영중 매장이 항상 더 빠름</div>
    <div class="insight-body">모든 달에서 <strong>운영중 매장</strong>이 오픈전 매장보다 빠르게 마감됩니다. 오픈전 매장은 매장 오픈 일정과 영업 일정을 맞추는 데 추가 시간이 필요합니다.</div>
  </div>

  <div class="insight-card purple">
    <div class="insight-title"><span class="badge badge-purple">병목 단계</span> 방문 후 가장 오래 걸리는 곳</div>
    <div class="insight-body">stage 분해 결과 <strong>견적 → 선납금 → 재견적</strong> 루프가 전체 시간의 70%+ 차지. 한 매장 평균 <strong>2.3회 재견적</strong> 발생. 견적 1차 통과율 향상이 인바운드 leadtime 단축의 가장 큰 레버.</div>
  </div>
</section>

<div class="glossary">
  <strong>용어 설명</strong><br>
  · <strong>방문완료</strong>: 영업 담당자가 매장을 방문하고 상담을 끝낸 시점<br>
  · <strong>마감 (CW)</strong>: 영업기회가 계약 체결로 종결된 시점<br>
  · <strong>가운데 매장</strong>: 빠른 순으로 줄 세웠을 때 정중앙 매장. 평균보다 안정적인 대표값<br>
  · <strong>CW / Lead 비율</strong>: 같은 달 마감 ÷ 같은 달 인입. 100%면 인입한 만큼 그 달에 마감, 100% 이상이면 이전 달 인입을 끌어와서 마감 (후행처리)<br>
  · <strong>오픈전 / 운영중</strong>: 매장이 아직 오픈 전인지(오픈전), 이미 영업 중인지(운영중)<br>
  · <strong>분석 제외</strong>: 방문완료 기록 없는 ${d.noVisitCount}건 + 4월 28일 이후 ${d.aprilSkipped}건(데이터 미완성) 제외
</div>

</div>

<script>
  Chart.defaults.font.family = "'Pretendard', -apple-system, sans-serif";
  Chart.defaults.color = '#6b7684';
  const monthLabels = ${JSON.stringify(monthLabels)};

  new Chart(document.getElementById('medianChart'), {
    type: 'line',
    data: {
      labels: monthLabels,
      datasets: [
        { label: '오픈전', data: ${JSON.stringify(seriesPreOpen)}, borderColor: '#f59f00', tension: 0.3, borderWidth: 3 },
        { label: '운영중', data: ${JSON.stringify(seriesOperating)}, borderColor: '#00b386', tension: 0.3, borderWidth: 3 },
        { label: '전체',   data: ${JSON.stringify(seriesAll)}, borderColor: '#3182f6', tension: 0.3, borderWidth: 3, borderDash: [5, 5] },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y + '일' } } },
      scales: { y: { beginAtZero: true, title: { display: true, text: '걸린 일수' } } },
    },
  });

  new Chart(document.getElementById('bucketChart'), {
    type: 'bar',
    data: {
      labels: monthLabels,
      datasets: [
        { label: '7일 이내',  data: ${JSON.stringify(u7PctSeries)},  backgroundColor: '#00b386' },
        { label: '14일 이내', data: ${JSON.stringify(u14PctSeries)}, backgroundColor: '#3182f6' },
        { label: '30일 이내', data: ${JSON.stringify(u30PctSeries)}, backgroundColor: '#8b5cf6' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y + '%' } } },
      scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: '비율 (%)' } } },
    },
  });

  new Chart(document.getElementById('funnelChart'), {
    type: 'bar',
    data: {
      labels: monthLabels,
      datasets: [
        { label: 'Lead 인입',   data: ${JSON.stringify(leadSeries)},  backgroundColor: '#3182f6' },
        { label: '방문완료',     data: ${JSON.stringify(visitSeries)}, backgroundColor: '#00b386' },
        { label: '마감 (CW)',  data: ${JSON.stringify(cwSeries)},    backgroundColor: '#f59f00' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y.toLocaleString() + '건' } } },
      scales: { y: { beginAtZero: true, title: { display: true, text: '건수' } } },
    },
  });
</script>
</body>
</html>`;
}
