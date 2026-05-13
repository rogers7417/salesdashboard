/**
 * 월간 KPI 보고서 — 운영 중인 KPI 대시보드 JSON을 input으로 단일 HTML 보고서 생성
 *
 * 입력:
 *   - https://dffqkvzh0w37t.cloudfront.net/dashboard/kpi/monthly/{month}.json (인바운드)
 *   - https://dffqkvzh0w37t.cloudfront.net/dashboard/channel/kpi-v2/{month}.json (채널)
 *
 * 사용:
 *   node scripts/analysis/render-monthly-kpi.js 2026-04
 *   node scripts/analysis/render-monthly-kpi.js   # 자동: 직전 월
 *
 * 출력: reports/{month}-kpi-monthly-report.html
 */

const path = require('path');
const fs = require('fs');
const https = require('https');

const BASE_URL = 'https://dffqkvzh0w37t.cloudfront.net';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function getMonthArg() {
  const arg = process.argv[2];
  if (arg && /^\d{4}-\d{2}$/.test(arg)) return arg;
  // default: 직전 월
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function prevMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

(async () => {
  const month = getMonthArg();
  const trendMonths = prevMonths(month, 4); // 직전 4개월 (이번달 포함)
  console.log(`[1/4] 인바운드 KPI fetch — ${month}`);
  const inbound = await fetchJson(`${BASE_URL}/dashboard/kpi/monthly/${month}.json`);
  console.log(`[2/4] 채널 KPI v2 fetch — ${month}`);
  const channel = await fetchJson(`${BASE_URL}/dashboard/channel/kpi-v2/${month}.json`);

  console.log(`[3/4] 트렌드용 ${trendMonths.length}개월 fetch (${trendMonths.join(', ')})...`);
  const trendData = await Promise.all(trendMonths.map(async (m) => {
    try {
      return { month: m, json: await fetchJson(`${BASE_URL}/dashboard/kpi/monthly/${m}.json`) };
    } catch (e) {
      console.log(`     ${m}: ${e.message}`);
      return { month: m, json: null };
    }
  }));

  console.log(`[4/4] HTML 렌더...`);
  const html = renderHtml({ month, inbound, channel, trendMonths, trendData });
  const outDir = path.join(__dirname, '..', '..', 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${month}-kpi-monthly-report.html`);
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`\n✓ 저장: ${outPath}`);
})().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });

// ============================================================
function extractKpis(json) {
  if (!json) return null;
  const ib = json.inbound || {};
  const ch = json.channel || {};
  const sumClosed = (users) => {
    const t = (users || []).reduce((acc, u) => ({
      cw: acc.cw + (u.cw ?? 0), cl: acc.cl + (u.cl ?? 0),
    }), { cw: 0, cl: 0 });
    return (t.cw + t.cl) ? Math.round(t.cw / (t.cw + t.cl) * 100) : 0;
  };
  const tmFrt = ch.tm?.frt || {};
  const frtTotal = (tmFrt.frtOk || 0) + (tmFrt.frtOver20 || 0);

  // 인사이드 FRT (byOwner의 frtOk/frtOver20 합산)
  const isOwners = ib.insideSales?.byOwner || [];
  const isFrtOk = isOwners.reduce((s, o) => s + (o.frtOk || 0), 0);
  const isFrtOver = isOwners.reduce((s, o) => s + (o.frtOver20 || 0), 0);
  const isFrtPassRate = (isFrtOk + isFrtOver) ? Math.round(isFrtOk / (isFrtOk + isFrtOver) * 100) : 0;
  const isAvgFrtMin = isOwners.length ?
    Math.round(isOwners.reduce((s, o) => s + (o.avgFrt || 0) * ((o.frtOk || 0) + (o.frtOver20 || 0)), 0) / Math.max(1, isFrtOk + isFrtOver)) : 0;

  // TM FRT 10분 이내 비율
  const tmWithin10 = tmFrt.buckets?.['10분 이내'] || 0;
  const tmWithin10Pct = frtTotal ? Math.round(tmWithin10 / frtTotal * 100) : 0;

  return {
    // 1차 핵심 KPI
    insideSqlConv:    ib.insideSales?.sqlConversionRate ?? 0,
    fieldCwRate:      sumClosed(ib.fieldSales?.cwConversionRate?.byUser),
    inboundBoCwRate:  sumClosed(ib.backOffice?.cwConversionRate?.byUser),
    tmSqlBacklogOver7: ch.tm?.sqlBacklog?.over7 ?? 0,
    tmFrtPassRate:    frtTotal ? Math.round((tmFrt.frtOk || 0) / frtTotal * 100) : 0,
    aeMou:            ch.ae?.mouCount?.total ?? 0,
    amActive:         ch.am?.activePartnerCount?.total ?? 0,
    channelBoCwRate:  sumClosed(ch.backOffice?.cwConversionRate?.byUser),

    // 보조 지표 — 인바운드
    insideLead:           ib.insideSales?.lead ?? 0,
    insideMql:            ib.insideSales?.mql ?? 0,
    insideSql:            ib.insideSales?.sql ?? 0,
    insideMqlNotConverted: (ib.insideSales?.mql ?? 0) - (ib.insideSales?.sql ?? 0),
    insideFrtPassRate20:  isFrtPassRate,
    insideAvgFrtMin:      isAvgFrtMin,

    // 필드
    fieldStaleTotal:    ib.fieldSales?.staleVisit?.total ?? 0,
    fieldStaleOver14:   ib.fieldSales?.staleVisit?.over14 ?? 0,
    fieldGolden8plus:   ib.fieldSales?.goldenTime?.stale8plus ?? 0,

    // 인바운드 BO
    inboundBoOver14:    ib.backOffice?.agingSummary?.over14 ?? 0,
    inboundBoSqlBacklog: ib.backOffice?.sqlBacklog?.list?.length ?? ib.backOffice?.sqlBacklog?.count ?? 0,

    // 채널 TM
    tmAvgFrtMin:        Math.round(tmFrt.avgFrtMinutes ?? 0),
    tmWithin10Pct:      tmWithin10Pct,
    tmUnconvertedMql:   ch.tm?.unconvertedMQL?.count ?? 0,
    // SQL 백로그 매장상태 분해
    tmOpenPreOpenPct:   (() => {
      const opps = ch.tm?.rawData?.rawOpenOpps || [];
      if (!opps.length) return 0;
      const preopen = opps.filter((o) => (o.companyStatus || '').includes('오픈전')).length;
      return Math.round(preopen / opps.length * 100);
    })(),
    tmOver7PreOpenCount: (() => {
      const opps = ch.tm?.rawData?.rawOpenOpps || [];
      return opps.filter((o) => (o.ageInDays || 0) >= 7 && (o.companyStatus || '').includes('오픈전')).length;
    })(),

    // 채널 AE — 미팅은 byOwner의 team='AE' 만 합산
    aeMeetingCount:     (ch.ae?.meetingCount?.byOwner || []).filter((o) => o.team === 'AE').reduce((s, o) => s + (o.count || 0), 0),
    aeNegoEntry:        ch.ae?.negoEntry?.thisMonth ?? 0,
    aeUnsigned:         ch.ae?.unsignedContracts?.total ?? 0,

    // 채널 AM — 미팅은 byOwner의 team='AM' 만 합산
    amDailyLeadAvg:     ch.am?.dailyLeadCount?.avgDaily ?? 0,
    amMeetingCount:     (ch.am?.meetingCount?.byOwner || []).filter((o) => o.team === 'AM').reduce((s, o) => s + (o.count || 0), 0),
    amOnboardingRate:   ch.am?.onboardingRate?.rate ?? 0,

    // 채널 BO
    channelBoOver14:    ch.backOffice?.agingSummary?.over14 ?? 0,
    channelBoSqlBacklog: ch.backOffice?.sqlBacklog?.list?.length ?? ch.backOffice?.sqlBacklog?.count ?? 0,

    // sub-team 활동 담당자 수 (실제 그 월에 영업기회/Lead를 가진 사람)
    insideHC:    (ib.insideSales?.byOwner || []).length,
    fieldHC:     (ib.fieldSales?.cwConversionRate?.byUser || []).length,
    inboundBoHC: (ib.backOffice?.cwConversionRate?.byUser || []).length,
    tmHC:        (ch.tm?.byOwner || []).length,
    aeHC:        (ch.ae?.mouCount?.byOwner || []).length,
    amHC:        (ch.am?.dailyLeadCount?.byOwner || []).length,
    channelBoHC: (ch.backOffice?.cwConversionRate?.byUser || []).length,
  };
}

function renderHtml({ month, inbound, channel, trendMonths, trendData }) {
  const ib = inbound;
  const ch = channel;

  // 인바운드 sub-team
  const is = ib.inbound.insideSales;
  const fs = ib.inbound.fieldSales;
  const bo = ib.inbound.backOffice;

  // 채널 sub-team — 모두 인바운드 JSON의 ib.channel 안에 있음
  const ae = ib.channel?.ae || {};
  const am = ib.channel?.am || {};
  const tm = ib.channel?.tm || {};
  const cbo = ib.channel?.backOffice || {};

  // scores
  const scores = ib.scores || {};

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ib.periodLabel || month} 월간 KPI 보고서</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Pretendard:wght@400;500;600;700;800&display=swap');
  :root{--bg:#f5f6f8;--card:#fff;--border:#e8ebed;--text-primary:#191f28;--text-secondary:#6b7684;--text-tertiary:#8b95a1;--blue:#3182f6;--blue-light:#e8f3ff;--red:#f04452;--red-light:#fff0f0;--green:#00b386;--green-light:#e8fff4;--orange:#f59f00;--orange-light:#fff8e6;--purple:#8b5cf6;--purple-light:#f3f0ff;--shadow:0 2px 8px rgba(0,0,0,.04);--radius:16px}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Pretendard',sans-serif;background:var(--bg);color:var(--text-primary);padding:32px;line-height:1.5}
  .container{max-width:1280px;margin:0 auto}
  header{margin-bottom:32px}
  h1{font-size:28px;font-weight:800;margin-bottom:6px}
  .meta{color:var(--text-tertiary);font-size:13px}
  .toc{display:flex;gap:12px;margin-bottom:28px;flex-wrap:wrap}
  .toc a{padding:10px 18px;background:#fff;border-radius:10px;text-decoration:none;box-shadow:var(--shadow);border:1px solid var(--border);color:var(--text-primary);font-weight:700;font-size:13px}
  section{margin-bottom:32px}
  h2{font-size:22px;font-weight:800;margin-bottom:16px;display:flex;align-items:center;gap:10px}
  h2 .dot{width:10px;height:10px;border-radius:50%}
  h3{font-size:16px;font-weight:700;margin-bottom:12px}

  .subteam{background:#fff;border-radius:var(--radius);padding:24px;box-shadow:var(--shadow);border:1px solid var(--border);margin-bottom:16px}
  .st-head{display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)}
  .st-bar{width:6px;height:24px;border-radius:3px}
  .st-name{font-size:18px;font-weight:800}
  .st-meta{margin-left:auto;font-size:12px;color:var(--text-tertiary)}

  .kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}
  .tile{background:var(--bg);border-radius:12px;padding:14px}
  .tile .lbl{font-size:11px;color:var(--text-secondary);margin-bottom:4px;font-weight:600}
  .tile .val{font-size:22px;font-weight:800;line-height:1.1}
  .tile .sub{font-size:11px;color:var(--text-tertiary);margin-top:4px}
  .tile.target-met{background:var(--green-light);border-left:3px solid var(--green)}
  .tile.target-low{background:var(--red-light);border-left:3px solid var(--red)}

  table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
  th,td{padding:8px 10px;text-align:right;border-bottom:1px solid var(--border)}
  th:first-child,td:first-child{text-align:left;font-weight:600}
  th{color:var(--text-secondary);background:var(--bg);font-weight:600;font-size:11px}
  tbody tr:hover{background:#fafbfc}

  .grade{display:inline-block;padding:1px 7px;border-radius:6px;font-size:11px;font-weight:800}
  .grade-S{background:#fff0f0;color:#c92535}
  .grade-A{background:#e8fff4;color:#00966f}
  .grade-B{background:#e8f3ff;color:var(--blue)}
  .grade-C{background:#fff8e6;color:#b76b00}
  .grade-D{background:#f3f0ff;color:var(--purple)}

  .bar-bg{position:relative;height:8px;background:#eef0f2;border-radius:4px;overflow:hidden;margin-top:6px}
  .bar-fill{height:100%;background:var(--blue);border-radius:4px}
  .bar-fill.green{background:var(--green)}
  .bar-fill.orange{background:var(--orange)}
  .bar-fill.red{background:var(--red)}

  /* 핵심 KPI 헤로 */
  .hero-kpi{display:flex;align-items:center;gap:20px;background:linear-gradient(135deg,#fafbfc 0%,#fff 100%);border:1px solid var(--border);border-left:6px solid var(--blue);border-radius:12px;padding:18px 22px;margin-bottom:14px}
  .hero-kpi.met{border-left-color:var(--green);background:linear-gradient(135deg,#f0fff8 0%,#fff 100%)}
  .hero-kpi.poor{border-left-color:var(--red);background:linear-gradient(135deg,#fff5f5 0%,#fff 100%)}
  .hero-kpi-tag{font-size:11px;font-weight:700;background:var(--blue-light);color:var(--blue);padding:3px 10px;border-radius:6px;margin-bottom:6px;display:inline-block}
  .hero-kpi.met .hero-kpi-tag{background:var(--green-light);color:var(--green)}
  .hero-kpi.poor .hero-kpi-tag{background:var(--red-light);color:var(--red)}
  .hero-kpi-name{font-size:13px;color:var(--text-secondary);font-weight:600}
  .hero-kpi-val{font-size:48px;font-weight:800;line-height:1;margin:4px 0}
  .hero-kpi.met .hero-kpi-val{color:var(--green)}
  .hero-kpi.poor .hero-kpi-val{color:var(--red)}
  .hero-kpi-target{font-size:12px;color:var(--text-tertiary);margin-top:2px}
  .hero-kpi-bar{flex:1;display:flex;flex-direction:column;gap:6px;min-width:180px}
  .hero-bar-track{height:10px;background:#eef0f2;border-radius:5px;overflow:hidden}
  .hero-bar-fill{height:100%;background:var(--blue);border-radius:5px;transition:width .4s}
  .hero-kpi.met .hero-bar-fill{background:var(--green)}
  .hero-kpi.poor .hero-bar-fill{background:var(--red)}
  .hero-bar-info{font-size:11px;color:var(--text-tertiary);display:flex;justify-content:space-between}

  /* 트렌드 표 */
  .trend-table{font-size:14px}
  .trend-table th{padding:12px;font-weight:700;color:var(--text-primary);background:#f5f6f8;font-size:13px}
  .trend-table td{padding:12px}
  .trend-table tbody tr:hover{background:#fafbfc}
  .trend-tag{display:inline-block;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;white-space:nowrap}
  .tag-up-strong{background:#e8fff4;color:#00966f}
  .tag-up{background:#f0fff8;color:#00b386}
  .tag-flat{background:#eef0f2;color:var(--text-secondary)}
  .tag-down{background:#fff5f5;color:#e35454}
  .tag-down-strong{background:#fff0f0;color:#c92535}

  /* 파트별 리뷰 카드 */
  .review-card{background:#fafbfc;border:1px solid var(--border);border-left:5px solid var(--blue);border-radius:12px;padding:18px 22px;margin-bottom:14px}
  .review-card.review-strong-up{border-left-color:#00966f;background:linear-gradient(135deg,#f0fff8 0%,#fafbfc 100%)}
  .review-card.review-up{border-left-color:#00b386}
  .review-card.review-flat{border-left-color:var(--text-tertiary)}
  .review-card.review-down{border-left-color:#e35454}
  .review-card.review-strong-down{border-left-color:#c92535;background:linear-gradient(135deg,#fff5f5 0%,#fafbfc 100%)}
  .review-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .review-bar{display:inline-block;width:6px;height:20px;border-radius:3px}
  .review-title{font-size:15px;font-weight:800;flex:1}
  .review-tag{font-size:11px;font-weight:700;padding:3px 10px;border-radius:6px;background:#fff;border:1px solid var(--border);color:var(--text-secondary)}
  .review-headline{font-size:15px;font-weight:700;line-height:1.5;margin-bottom:8px;color:var(--text-primary)}
  .review-body{font-size:13.5px;line-height:1.7;color:var(--text-secondary);margin-bottom:10px}
  .review-action{font-size:13px;color:var(--text-primary);background:#fff;border-left:3px solid var(--blue);padding:8px 12px;border-radius:4px;line-height:1.6}
  .review-action strong{color:var(--blue)}
  .review-improve{font-size:13px;color:var(--text-primary);background:#f0fff8;border-left:3px solid #00b386;padding:10px 14px;border-radius:4px;line-height:1.7;margin-bottom:10px}
  .review-improve strong{color:#00966f;display:inline-block;margin-bottom:4px}

  /* 헤더 대시보드 strip */
  .dashboard{display:grid;grid-template-columns:repeat(7,1fr);gap:10px;margin-bottom:24px}
  .dash-tile{background:#fff;border:1px solid var(--border);border-top:4px solid var(--blue);border-radius:10px;padding:14px;text-align:center;box-shadow:var(--shadow);position:relative}
  .dash-tile.met{border-top-color:var(--green)}
  .dash-tile.poor{border-top-color:var(--red)}
  .dash-tile-name{font-size:11px;color:var(--text-secondary);font-weight:600;margin-bottom:6px}
  .dash-tile-val{font-size:22px;font-weight:800;line-height:1}
  .dash-tile-delta{font-size:11px;font-weight:700;margin-top:4px}
  .dash-tile-delta.up{color:var(--green)}
  .dash-tile-delta.down{color:var(--red)}
  .dash-tile-delta.flat{color:var(--text-tertiary)}
  @media (max-width:1024px){.dashboard{grid-template-columns:repeat(4,1fr)}}
  @media (max-width:640px){.dashboard{grid-template-columns:repeat(2,1fr)}}

  .funnel{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;align-items:center;margin:10px 0}
  .funnel-stage{text-align:center;background:var(--bg);border-radius:10px;padding:10px}
  .funnel-stage .nm{font-size:11px;color:var(--text-secondary);margin-bottom:4px}
  .funnel-stage .v{font-size:18px;font-weight:800}
  .funnel-stage .conv{font-size:10px;color:var(--text-tertiary);margin-top:2px}

  @media (max-width:768px){.kpi-row{grid-template-columns:repeat(2,1fr)}.funnel{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<div class="container">

<header>
  <h1>${ib.periodLabel || month} 월간 KPI 보고서</h1>
  <p style="color:var(--text-secondary);font-size:14px;margin-bottom:8px">운영 중인 KPI 시스템 (S3+CloudFront) 데이터 기반</p>
  <p class="meta">기간: ${ib.dateRange?.startDate} ~ ${ib.dateRange?.endDate} · 데이터 추출: ${ib.extractedAt ? new Date(ib.extractedAt).toLocaleString('ko-KR') : '-'}</p>
</header>

${renderDashboard(trendData)}

<div class="toc">
  <a href="#trend" style="color:#06b6d4">📈 4개월 트렌드</a>
  <a href="#inbound" style="color:#3182f6">📥 인바운드</a>
  <a href="#channel" style="color:#8b5cf6">📤 채널</a>
  <a href="#scores" style="color:#f59f00">⭐ 스코어카드</a>
</div>

${renderTrend(trendMonths, trendData)}

<section id="inbound">
  <h2><span class="dot" style="background:#3182f6"></span>인바운드</h2>
  ${renderInside(is)}
  ${renderField(fs)}
  ${renderInboundBO(bo)}
  ${renderTM(tm)}
</section>

<section id="channel">
  <h2><span class="dot" style="background:#8b5cf6"></span>채널</h2>
  ${renderAE(ae, ch)}
  ${renderAM(am, ch)}
  ${renderChannelBO(cbo)}
  ${renderMouStats(ch.mouStats)}
</section>

<section id="scores">
  <h2><span class="dot" style="background:#f59f00"></span>스코어카드 — 사람별 등급</h2>
  ${renderScores(scores)}
</section>

<div style="padding:16px 20px;background:#f9fafb;border-radius:12px;font-size:12px;color:var(--text-secondary);margin-top:24px">
  <strong>데이터 출처:</strong> S3+CloudFront (kpi-extract.js, scripts/channel-extract.js 산출물)<br>
  <strong>매월 자동 갱신:</strong> <code>node scripts/analysis/render-monthly-kpi.js YYYY-MM</code><br>
  <strong>주의:</strong> CW 태블릿/매출은 모든 sub-team의 후행 지표 — 1차 평가는 sub-team 핵심 KPI 사용
</div>

</div></body></html>`;
}

// ============================================================
// 파트별 자동 서술 리뷰
function generateReviews(kpiList, series, labels, trendData) {
  const currentJson = trendData[trendData.length - 1]?.json;
  return kpiList.map((kpi) => {
    const values = series.map((s) => s ? s[kpi.key] : null);
    const validValues = values.filter((v) => v != null);
    if (validValues.length < 2) return '';
    const first = validValues[0];
    const last = validValues[validValues.length - 1];
    const delta = last - first;
    const max = Math.max(...validValues);
    const min = Math.min(...validValues);
    const maxIdx = values.indexOf(max);
    const minIdx = values.indexOf(min);
    const deltaPct = first ? Math.round(delta / first * 100) : 0;
    const isMonotonicUp = validValues.every((x, i) => i === 0 || x >= validValues[i - 1]);
    const isMonotonicDn = validValues.every((x, i) => i === 0 || x <= validValues[i - 1]);
    const fmt = (v) => v + kpi.unit;
    // 보조 지표 추이를 위해 series 전체 전달
    const ctx = REVIEW_CONTEXT[kpi.key]({ first, last, delta, deltaPct, max, min, maxIdx, minIdx, isMonotonicUp, isMonotonicDn, values, labels, fmt, raw: currentJson, series });

    let cls = 'review-flat';
    if (delta > 0 && isMonotonicUp) cls = 'review-strong-up';
    else if (delta > 0) cls = 'review-up';
    else if (delta < 0 && isMonotonicDn) cls = 'review-strong-down';
    else if (delta < 0) cls = 'review-down';

    // 이번달 개선 포인트 자동 생성 (3월→4월 비교)
    const improvements = ctx.improvements || generateImprovements(kpi.key, series);

    return `
    <div class="review-card ${cls}">
      <div class="review-head">
        <span class="review-bar" style="background:${kpi.color}"></span>
        <div class="review-title">${kpi.name}</div>
        <div class="review-tag">${ctx.tag}</div>
      </div>
      <div class="review-headline">${ctx.headline}</div>
      <div class="review-body">${ctx.body}</div>
      ${improvements ? `<div class="review-improve"><strong>✅ 이번달 개선 포인트</strong><br>${improvements}</div>` : ''}
      <div class="review-action"><strong>다음 단계 →</strong> ${ctx.action}</div>
    </div>`;
  }).join('');
}

// 3월→4월 비교 기반 개선 포인트 자동 추출
function generateImprovements(key, series) {
  if (!series || series.length < 2) return '';
  const cur = series[series.length - 1];
  const prev = series[series.length - 2];
  if (!cur || !prev) return '';

  const checks = {
    insideSqlConv: [
      { lbl: '인사이드 FRT 준수율(20분)', a: prev.insideFrtPassRate20, b: cur.insideFrtPassRate20, unit: '%', good: 'up' },
      { lbl: '인사이드 평균 FRT', a: prev.insideAvgFrtMin, b: cur.insideAvgFrtMin, unit: '분', good: 'down' },
      { lbl: '미전환 MQL 잔여', a: prev.insideMqlNotConverted, b: cur.insideMqlNotConverted, unit: '건', good: 'down' },
    ],
    fieldCwRate: [
      { lbl: 'stale 방문 총', a: prev.fieldStaleTotal, b: cur.fieldStaleTotal, unit: '건', good: 'down' },
      { lbl: '14일 초과 정체', a: prev.fieldStaleOver14, b: cur.fieldStaleOver14, unit: '건', good: 'down' },
      { lbl: '골든타임 위반(8일+)', a: prev.fieldGolden8plus, b: cur.fieldGolden8plus, unit: '건', good: 'down' },
    ],
    inboundBoCwRate: [
      { lbl: '14일 초과 정체 매장', a: prev.inboundBoOver14, b: cur.inboundBoOver14, unit: '건', good: 'down' },
      { lbl: 'SQL 백로그', a: prev.inboundBoSqlBacklog, b: cur.inboundBoSqlBacklog, unit: '건', good: 'down' },
    ],
    tmSqlBacklogOver7: [
      { lbl: 'SQL 백로그(7일+)', a: prev.tmSqlBacklogOver7, b: cur.tmSqlBacklogOver7, unit: '건', good: 'down' },
      { lbl: 'Open SQL 중 오픈전 비중', a: prev.tmOpenPreOpenPct, b: cur.tmOpenPreOpenPct, unit: '%', good: 'down' },
      { lbl: 'FRT 준수율(20분)', a: prev.tmFrtPassRate, b: cur.tmFrtPassRate, unit: '%', good: 'up' },
      { lbl: '평균 FRT', a: prev.tmAvgFrtMin, b: cur.tmAvgFrtMin, unit: '분', good: 'down' },
      { lbl: '미전환 MQL 누적', a: prev.tmUnconvertedMql, b: cur.tmUnconvertedMql, unit: '건', good: 'down' },
    ],
    aeMou: [
      { lbl: '신규 MOU', a: prev.aeMou, b: cur.aeMou, unit: '건', good: 'up' },
      { lbl: '미팅 수', a: prev.aeMeetingCount, b: cur.aeMeetingCount, unit: '건', good: 'up' },
      { lbl: '협상 진입', a: prev.aeNegoEntry, b: cur.aeNegoEntry, unit: '건', good: 'up' },
    ],
    amActive: [
      { lbl: '활성 파트너', a: prev.amActive, b: cur.amActive, unit: '개', good: 'up' },
      { lbl: '일평균 Lead 확보', a: prev.amDailyLeadAvg, b: cur.amDailyLeadAvg, unit: '건', good: 'up' },
      { lbl: '미팅 수', a: prev.amMeetingCount, b: cur.amMeetingCount, unit: '건', good: 'up' },
      { lbl: '온보딩률', a: prev.amOnboardingRate, b: cur.amOnboardingRate, unit: '%', good: 'up' },
    ],
    channelBoCwRate: [
      { lbl: '14일 초과 정체 매장', a: prev.channelBoOver14, b: cur.channelBoOver14, unit: '건', good: 'down' },
      { lbl: 'SQL 백로그', a: prev.channelBoSqlBacklog, b: cur.channelBoSqlBacklog, unit: '건', good: 'down' },
    ],
  };

  const improved = [];
  (checks[key] || []).forEach((c) => {
    if (c.a == null || c.b == null) return;
    const diff = c.b - c.a;
    const isImproved = (c.good === 'up' && diff > 0) || (c.good === 'down' && diff < 0);
    if (isImproved) {
      const sign = diff > 0 ? '+' : '';
      improved.push(`<strong>${c.lbl}</strong>: ${c.a}${c.unit} → ${c.b}${c.unit} (${sign}${Math.round(diff*10)/10}${c.unit})`);
    }
  });

  if (!improved.length) return '특별한 단월 개선 포인트는 없으며, 추세 유지 또는 점검이 필요한 구간입니다.';
  return improved.map((i) => '· ' + i).join('<br>');
}

// 보조 지표 트렌드 포맷터: "1월→4월: 33→89 (+56)"
function trendStr(series, key, unit = '', labels) {
  const arr = series.map((s) => s ? s[key] : null);
  const first = arr[0], last = arr[arr.length - 1];
  if (first == null || last == null) return '데이터 없음';
  const diff = last - first;
  const sign = diff > 0 ? '+' : '';
  const all = arr.map((v) => v == null ? '-' : v + unit).join(' → ');
  return `${all} <strong>(${sign}${diff}${unit})</strong>`;
}

const REVIEW_CONTEXT = {
  insideSqlConv: ({ first, last, delta, max, maxIdx, min, minIdx, fmt, labels, raw, series }) => {
    const target = 90;
    const onTarget = last >= target;
    const is = raw?.inbound?.insideSales || {};
    const lead = is.lead || 0, mql = is.mql || 0, sql = is.sql || 0;
    const unconvertedMql = mql - sql;
    const frtNow  = series[series.length - 1].insideFrtPassRate20;
    const frtBase = series[0].insideFrtPassRate20;
    const frtDiff = frtNow - frtBase;
    const avgFrtNow = series[series.length - 1].insideAvgFrtMin;
    return {
      tag: onTarget ? '🟢 목표 달성 영역' : '🟡 목표 근접',
      headline: onTarget
        ? `4월 SQL 전환율 ${fmt(last)}로 목표 90% 달성 영역에 위치`
        : `4월 SQL 전환율 ${fmt(last)}로 목표 90%에 ${(target - last).toFixed(1)}%p 부족`,
      body: `인사이드 세일즈의 핵심 지표인 SQL 전환율은 1월 ${fmt(first)}에서 4월 ${fmt(last)}로, ${labels[maxIdx]}이 정점(${fmt(max)})이었으며 분기 동안 90% 안팎의 안정적인 수준을 유지했습니다. 4월 한 달 동안 ${lead.toLocaleString()}건의 Lead가 인입되어 MQL ${mql.toLocaleString()}건, 최종 SQL ${sql.toLocaleString()}건으로 이어졌으며, MQL 단계까지는 도달했으나 SQL 자격 검증을 통과하지 못한 잔여가 ${unconvertedMql}건 발생했습니다.<br><br>
세부 운영 지표를 보면, 인사이드 자체 FRT 준수율(20분 이내)은 1월 ${frtBase}%에서 4월 ${frtNow}%로 ${frtDiff >= 0 ? '+' : ''}${frtDiff}%p 변동했으며, 평균 응답 시간은 4월 기준 ${avgFrtNow}분으로 측정되었습니다. SQL 전환율은 안정적이지만 응답 속도 분포는 여전히 개선 여지가 남아있는 상황입니다.`,
      action: 'SQL 미전환 MQL ' + unconvertedMql + '건의 사유 분포(가격·타이밍·오인입)를 분석하여 응대 표준화에 반영하고, 인사이드 FRT 분포가 길어지는 구간이 SQL 전환율 변동과 어떻게 연동되는지 추적할 필요가 있습니다.',
    };
  },
  fieldCwRate: ({ first, last, delta, max, maxIdx, fmt, labels, raw, series }) => {
    const declined = delta < 0;
    const fs = raw?.inbound?.fieldSales || {};
    const stale = fs.staleVisit || {};
    const lossR = fs.lossReasonSummary || {};
    const lossList = Object.entries(lossR).filter(([k]) => k !== '-').sort((a, b) => b[1] - a[1]).slice(0, 2);
    const lossStr = lossList.length ? lossList.map(([k, v]) => `${k} ${v}건`).join(', ') : '주요 사유 미기록';
    const staleNow = series[series.length - 1].fieldStaleTotal;
    const staleBase = series[0].fieldStaleTotal;
    const stale14Now = series[series.length - 1].fieldStaleOver14;
    const stale14Base = series[0].fieldStaleOver14;
    const goldenNow = series[series.length - 1].fieldGolden8plus;
    return {
      tag: declined ? '🟡 정점 후 둔화' : '🟢 개선',
      headline: declined
        ? `필드 CW 전환율은 ${labels[maxIdx]} ${fmt(max)} 정점 이후 4월 ${fmt(last)}로 ${(max-last).toFixed(0)}%p 둔화`
        : `필드 CW 전환율은 1월 ${fmt(first)}에서 4월 ${fmt(last)}로 ${delta}%p 개선`,
      body: `필드 세일즈의 CW 전환율은 1월 ${fmt(first)}에서 시작해 ${labels[maxIdx]} ${fmt(max)}로 정점을 찍은 후 4월 ${fmt(last)}로 ${declined ? '소폭 조정' : '개선'}되었습니다. 4월 마감의 상당 부분이 이월 매장 처리분이라는 점, 그리고 일부 매장의 일정 취소가 영향을 미친 것으로 보입니다. 4월 기준 마감 사유를 보면 ${lossStr} 등이 주요 패턴입니다.<br><br>
세부 운영 지표 측면에서 stale 방문(정체 매장) 총 건수는 1월 ${staleBase}건에서 4월 ${staleNow}건으로 변동했으며, 그 중 14일 이상 정체 매장은 1월 ${stale14Base}건에서 4월 ${stale14Now}건으로 ${stale14Now - stale14Base >= 0 ? '+' : ''}${stale14Now - stale14Base}건 변화했습니다. 골든타임을 8일 이상 초과한 매장도 4월 기준 ${goldenNow}건 누적되어 있어, 정체 매장 관리가 다음 달 CW 전환율에 영향을 줄 수 있는 상황입니다.`,
      action: '14일 이상 정체 ' + stale14Now + '건 매장에 대해 강제 push 또는 담당 재배정을 검토해야 하며, CL 사유 상위 패턴을 매월 모니터링하여 패배 원인의 변화를 추적할 필요가 있습니다.',
    };
  },
  inboundBoCwRate: ({ first, last, delta, isMonotonicUp, fmt, labels, raw, series }) => {
    const bo = raw?.inbound?.backOffice || {};
    const aging = bo.agingSummary || {};
    const lossR = bo.lossReasonSummary || {};
    const lossList = Object.entries(lossR).filter(([k]) => k !== '-').sort((a, b) => b[1] - a[1]).slice(0, 2);
    const lossStr = lossList.length ? lossList.map(([k, v]) => `${k} ${v}건`).join(', ') : '주요 사유 미기록';
    const over14Base = series[0].inboundBoOver14;
    const over14Now  = series[series.length - 1].inboundBoOver14;
    const sqlBackBase = series[0].inboundBoSqlBacklog;
    const sqlBackNow  = series[series.length - 1].inboundBoSqlBacklog;
    return {
      tag: isMonotonicUp ? '🟢🟢 꾸준히 개선' : '🟢 개선',
      headline: `인바운드 백오피스 CW 전환율은 1월 ${fmt(first)}에서 4월 ${fmt(last)}로 ${delta}%p 개선되어 분기 동안 ${Math.round(delta/first*100)}% 증가`,
      body: `인바운드 백오피스의 CW 전환율은 1월 ${fmt(first)}에서 4월 ${fmt(last)}까지 ${isMonotonicUp ? '매월 연속' : '대체로'} 상승하여, 견적·계약·출고·설치로 이어지는 처리 단계의 효율이 분기 동안 꾸준히 개선되었음을 보여줍니다. 4월 마감 사유 분포에서는 ${lossStr} 등이 상위에 나타났습니다.<br><br>
다만 진행 중 매장의 정체 상황은 함께 봐야 합니다. 4월 기준 진행 매장의 노화도는 3일 이내 ${aging.within3 ?? '-'}건, 4~7일 ${aging.day4to7 ?? '-'}건, 7일 초과 ${aging.over7 ?? '-'}건, 14일 초과가 ${aging.over14 ?? '-'}건으로, 14일 이상 정체된 매장이 가장 큰 비중을 차지하고 있습니다. 14일 초과 정체 매장은 1월 ${over14Base}건에서 4월 ${over14Now}건으로 ${over14Now - over14Base >= 0 ? '+' : ''}${over14Now - over14Base}건 변화했으며, SQL 백로그는 1월 ${sqlBackBase}건에서 4월 ${sqlBackNow}건으로 ${sqlBackNow - sqlBackBase >= 0 ? '증가' : '감소'}하여 다음 달 처리 부담으로 작용할 가능성이 있습니다.`,
      action: '14일 초과 ' + over14Now + '건 매장의 stage별 분포를 확인하여 견적 정체인지 계약 정체인지 식별하고, 백로그 누적 추세가 지속되면 CW 전환율 개선 효과가 한계에 부딪힐 수 있으므로 견적 1차 통과율 보강을 우선 검토할 필요가 있습니다.',
    };
  },
  tmSqlBacklogOver7: ({ first, last, delta, isMonotonicDn, fmt, labels, raw, series }) => {
    const tm = raw?.channel?.tm || {};
    const sb = tm.sqlBacklog || {};
    const target = sb.target ?? 10;
    const onTarget = last <= target;
    const frtBase = series[0].tmFrtPassRate;
    const frtNow  = series[series.length - 1].tmFrtPassRate;
    // 매장상태 분해 (4월)
    const opps = tm.rawData?.rawOpenOpps || [];
    const preopenOver7 = opps.filter((o) => (o.ageInDays || 0) >= 7 && (o.companyStatus || '').includes('오픈전')).length;
    const operatingOver7 = opps.filter((o) => (o.ageInDays || 0) >= 7 && !(o.companyStatus || '').includes('오픈전')).length;
    const preopenLong = opps.filter((o) => (o.companyStatus || '').includes('2달 이상')).length;
    // 오픈전 비중 추이
    const preBase = series[0].tmOpenPreOpenPct;
    const preNow  = series[series.length - 1].tmOpenPreOpenPct;
    return {
      tag: onTarget ? '🟢 목표 달성' : (delta < 0 ? '🟡 개선 추세' : '🔴 누적 과부하'),
      headline: onTarget
        ? `채널 TM의 SQL 백로그(7일 초과 미처리)는 4월 ${fmt(last)}로 목표 ${target}건 이내`
        : `채널 TM의 SQL 백로그(7일 초과 미처리)는 4월 ${fmt(last)}로 목표 ${target}건 대비 ${last - target}건 초과`,
      body: `채널 TM의 핵심 지표인 SQL 백로그(견적 발송 후 입금일자가 7일 이상 미입력된 매장 수)는 1월 ${fmt(first)}에서 4월 ${fmt(last)}로 ${delta > 0 ? '+' : ''}${delta}건 누적 증가하여 목표(${target}건) 대비 ${last - target}건 초과 상태입니다. 견적 처리 속도가 입금일자 입력의 병목으로 작용하고 있습니다.<br><br>
누적의 핵심 원인은 <strong>오픈전 매장 비중의 지속적 증가</strong>로 분석됩니다. Open SQL 매장 중 오픈전 비중이 1월 ${preBase}%에서 4월 ${preNow}%로 약 ${Math.round(preNow/Math.max(preBase,1)*10)/10}배 늘어났으며, 4월 기준 7일 초과 정체 매장 ${last}건 중 <strong>${preopenOver7}건(${Math.round(preopenOver7/last*100)}%)이 오픈전 매장</strong>입니다. 특히 "오픈전 2개월+" 장기 정체가 ${preopenLong}건 존재해, 매장 오픈 일정이 미확정·연기되며 입금 의사결정이 동결되는 패턴이 보입니다. FRT 준수율(${frtBase}%→${frtNow}%) 등 응대 속도 지표는 안정 영역인 만큼, 첫 응답이 아니라 견적 발송 후 입금 단계가 진짜 정체 구간입니다.`,
      action: '오픈전 매장 전용 SLA(예: 오픈일 N주 전 입금 안내, 오픈일 미정 시 N주 후 push)를 정의하고, "오픈전 2개월+" ' + preopenLong + '건은 1:1 사유 점검을 통해 폐기/유지 의사결정이 필요합니다. 운영중 매장의 7일+ 정체 ' + operatingOver7 + '건은 별도 push 프로세스로 분리 관리.',
    };
  },
  aeMou: ({ first, last, delta, isMonotonicUp, fmt, labels, values, raw, series }) => {
    const monthlyAvg = Math.round(delta / (values.length - 1));
    const ae = raw?.channel?.ae || {};
    const mou = ae.mouCount || {};
    const meetBase = series[0].aeMeetingCount;
    const meetNow  = series[series.length - 1].aeMeetingCount;
    const negoBase = series[0].aeNegoEntry;
    const negoNow  = series[series.length - 1].aeNegoEntry;
    const unsigBase = series[0].aeUnsigned;
    const unsigNow  = series[series.length - 1].aeUnsigned;
    return {
      tag: '🟢🟢 꾸준히 개선',
      headline: `채널 AE의 신규 MOU는 1월 ${fmt(first)}에서 4월 ${fmt(last)}로 분기 동안 ${Math.round(last/first*10)/10}배 증가`,
      body: `채널 AE의 핵심 지표인 신규 MOU 체결 수는 1월 ${fmt(first)}에서 4월 ${fmt(last)}로 분기 동안 매월 평균 ${monthlyAvg}건 페이스로 증가했으며, 4월 목표(${mou.target ?? 4}건) 대비 ${Math.round(last/(mou.target || 4))}배를 초과 달성했습니다. AE 1명이 운영하는 조직임을 감안하면 발굴 모멘텀이 분기 동안 강하게 형성되었음을 의미합니다. 4월 신규 MOU의 구성을 보면 파트너 ${mou.partners ?? 0}건, FC HQ ${mou.franchiseHQ ?? 0}건, 브랜드 ${mou.franchiseBrands ?? 0}건으로 카테고리 간 균형이 잡혀 있습니다.<br><br>
세부 운영 지표를 함께 보면, 영업 활동량을 나타내는 미팅 수는 1월 ${meetBase}건에서 4월 ${meetNow}건으로 ${meetNow - meetBase >= 0 ? '+' : ''}${meetNow - meetBase}건 변화했고, 후속 단계인 협상 진입은 1월 ${negoBase}건에서 4월 ${negoNow}건으로 변동했습니다. 미서명 계약은 1월 ${unsigBase}건에서 4월 ${unsigNow}건으로 누적되고 있어, MOU 발굴이 늘어난 만큼 다음 단계로의 전환·서명 처리가 함께 따라가는지가 다음 분석 포인트입니다.`,
      action: '발굴량 자체는 충분히 확보되었으므로, 협상 진입과 미서명 계약 비율을 모니터링하여 후속 전환 단계의 병목을 식별하고, 미서명 계약 중 overdue 케이스의 중단 사유를 분석할 필요가 있습니다.',
    };
  },
  amActive: ({ first, last, delta, max, maxIdx, fmt, labels, values, raw, series }) => {
    const recovered = values[values.length - 1] > values[values.length - 2];
    const am = raw?.channel?.am || {};
    const ap = am.activePartnerCount || {};
    const onb = am.onboardingRate || {};
    const dl = am.dailyLeadCount || {};
    const dlBase = series[0].amDailyLeadAvg;
    const dlNow  = series[series.length - 1].amDailyLeadAvg;
    const onbBase = series[0].amOnboardingRate;
    const onbNow  = series[series.length - 1].amOnboardingRate;
    const meetBase = series[0].amMeetingCount;
    const meetNow  = series[series.length - 1].amMeetingCount;
    return {
      tag: recovered ? '🟡 하락 후 회복' : '🔴 하락 추세',
      headline: `채널 AM 활성 파트너는 ${labels[maxIdx]} ${fmt(max)} 정점 이후 4월 ${fmt(last)}로 ${Math.abs(delta)}개 감소${recovered ? ' (4월 소폭 반등)' : ''}`,
      body: `채널 AM의 핵심 지표인 활성 파트너 수는 ${labels[maxIdx]} ${fmt(max)} 정점 이후 4월 ${fmt(last)}로 분기 동안 ${Math.abs(delta)}개 감소했습니다. 4월에는 ${recovered ? '소폭 반등하여 ' + (values[values.length-1]-values[values.length-2]) + '개 회복했지만 1월 수준에는 미달' : '추가 하락이 발생'}했습니다. 4월 활성 파트너의 구성은 파트너 ${ap.partners ?? 0}개, 브랜드 ${ap.brands ?? 0}개로 합계 ${ap.total ?? 0}개이며, 절대 수치는 목표(${ap.target ?? 70}개)를 4배 이상 초과하고 있습니다.<br><br>
다만 세부 운영 지표를 보면 우려스러운 신호가 함께 나타납니다. 일평균 Lead 확보는 1월 ${dlBase}건에서 4월 ${dlNow}건으로 ${(dlNow - dlBase).toFixed(1)}건 ${dlNow >= dlBase ? '증가' : '감소'}했지만 여전히 목표(${dl.target_daily ?? '-'})에 미달하고 있고, 미팅 수는 1월 ${meetBase}건에서 4월 ${meetNow}건으로 ${meetNow - meetBase >= 0 ? '+' : ''}${meetNow - meetBase}건 변동했습니다. 가장 주목할 점은 온보딩률로, 1월 ${onbBase}%에서 4월 ${onbNow}%로 ${(onbNow - onbBase).toFixed(1)}%p ${onbNow >= onbBase ? '상승' : '하락'}했으며 목표(${onb.target ?? 80}%) 대비 ${(onb.target ?? 80) - onbNow}%p 미달 상태입니다. AE의 신규 MOU 발굴(분기 ${last - first}건 증가)이 활성 단계로 충분히 이어지지 못하고 있다는 구조적 신호로 해석됩니다.`,
      action: '신규 MOU ' + (raw?.channel?.ae?.mouCount?.total ?? 0) + '건이 다음 달 활성 파트너로 실제 추가되는지 추적이 필요하며, 온보딩률을 끌어올리지 못하면 AE의 발굴 효과가 활성 단계로 이어지지 않으므로 온보딩 단계별 정체 지점을 분해 분석할 필요가 있습니다.',
    };
  },
  channelBoCwRate: ({ first, last, delta, max, maxIdx, min, minIdx, fmt, labels, raw, series }) => {
    const cbo = raw?.channel?.backOffice || {};
    const aging = cbo.agingSummary || {};
    const over14Base = series[0].channelBoOver14;
    const over14Now  = series[series.length - 1].channelBoOver14;
    const sqlBackBase = series[0].channelBoSqlBacklog;
    const sqlBackNow  = series[series.length - 1].channelBoSqlBacklog;
    return {
      tag: '🟡 변동 후 회복',
      headline: `채널 백오피스 CW 전환율은 ${labels[maxIdx]} ${fmt(max)} 정점 이후 ${labels[minIdx]} ${fmt(min)} 저점을 거쳐 4월 ${fmt(last)}로 회복 중`,
      body: `채널 백오피스의 CW 전환율은 1월 ${fmt(first)}로 분기 초 정점을 기록한 후 ${labels[minIdx]} ${fmt(min)} 저점까지 떨어졌다가 4월 ${fmt(last)}로 회복 추세에 들어섰습니다. 4월 마감 매장 중 이월 처리 비중이 약 66%를 차지하여 후행 처리가 우세한 패턴은 인바운드 백오피스와 유사하지만, 동일한 분기 동안 인바운드 백오피스가 24%에서 45%로 매월 +5~7%p 페이스로 꾸준히 개선된 것과 비교하면 채널 백오피스의 회복 속도는 다소 느린 편입니다. 채널 BO 특유의 처리 단계(MOU 체결 후 가맹점 등록 행정 등)가 병목일 가능성을 시사합니다.<br><br>
세부 지표 측면에서, 14일 이상 정체된 진행 매장은 1월 ${over14Base}건에서 4월 ${over14Now}건으로 ${over14Now - over14Base >= 0 ? '+' : ''}${over14Now - over14Base}건 변동했고, SQL 백로그는 1월 ${sqlBackBase}건에서 4월 ${sqlBackNow}건으로 ${sqlBackNow >= sqlBackBase ? '증가' : '감소'}했습니다. 4월에는 ${aging.over14 ?? '-'}건이 14일 이상 정체된 상태로, 회복 속도를 더 끌어올리려면 정체 매장의 stage 분해 식별이 우선 과제입니다.`,
      action: '인바운드 백오피스의 매월 +5~7%p 개선 패턴을 채널 백오피스에 이식할 수 있는지 검토하고, 14일 초과 ' + over14Now + '건의 stage별 분포를 분석하여 채널 BO 고유의 병목(MOU 후 행정 처리 등) 단계를 식별할 필요가 있습니다.',
    };
  },
};

// ============================================================
// 4개월 트렌드 섹션
function renderTrend(months, trendData) {
  const labels = months.map((m) => m.slice(5) + '월');
  const series = trendData.map((d) => extractKpis(d.json));

  const get = (key) => series.map((s) => s ? s[key] : null);

  // 4개의 차트로 분류:
  // (a) 전환율류 (%): inside SQL Conv, field/inboundBO/channelBO CW Rate, TM FRT Pass
  // (b) 카운트류 (건/개): AE MOU, AM Active Partner

  const charts = [
    {
      id: 'tr-rates', title: '전환율 / 준수율 (%)',
      desc: '인사이드·필드·BO·TM의 핵심 비율 KPI 추이',
      datasets: [
        { label: '인사이드 SQL 전환율', color: '#00b386', data: get('insideSqlConv') },
        { label: '필드 CW 전환율', color: '#f59f00', data: get('fieldCwRate') },
        { label: '인바운드 BO CW 전환율', color: '#8b5cf6', data: get('inboundBoCwRate') },
        { label: '채널 BO CW 전환율', color: '#a855f7', data: get('channelBoCwRate') },
        { label: '채널 TM FRT 준수율', color: '#0ea5e9', data: get('tmFrtPassRate') },
      ],
      yMax: 100, yLabel: '%',
    },
    {
      id: 'tr-counts', title: '발굴/관리 카운트',
      desc: 'AE 신규 MOU, AM 활성 파트너 수 추이',
      datasets: [
        { label: '채널 AE 신규 MOU', color: '#8b5cf6', data: get('aeMou') },
        { label: '채널 AM 활성 파트너', color: '#06b6d4', data: get('amActive') },
      ],
      yMax: null, yLabel: '건/개',
    },
  ];

  // 비교 표 + 패턴 라벨
  const kpiList = [
    { name: '인사이드 — SQL 전환율',                  key: 'insideSqlConv',     unit: '%', color: '#00b386' },
    { name: '필드 — CW 전환율 (마감 중)',              key: 'fieldCwRate',       unit: '%', color: '#f59f00' },
    { name: '인바운드 BO — CW 전환율',                 key: 'inboundBoCwRate',   unit: '%', color: '#8b5cf6' },
    { name: '채널 TM — SQL 백로그 (7일 초과 미처리)',  key: 'tmSqlBacklogOver7', unit: '건', color: '#0ea5e9', goalDown: true, target: 10 },
    { name: '채널 AE — 신규 MOU',                     key: 'aeMou',             unit: '건', color: '#8b5cf6' },
    { name: '채널 AM — 활성 파트너',                  key: 'amActive',          unit: '개', color: '#06b6d4' },
    { name: '채널 BO — CW 전환율',                    key: 'channelBoCwRate',   unit: '%', color: '#a855f7' },
  ];

  function classifyTrend(values, goalDown = false) {
    const v = values.filter((x) => x != null);
    if (v.length < 2) return { tag: '데이터 부족', cls: 'flat' };
    const first = v[0], last = v[v.length - 1];
    const max = Math.max(...v), min = Math.min(...v);
    const range = max - min;
    const mid = (max + min) / 2 || 1;
    const isMonotonicUp = v.every((x, i) => i === 0 || x >= v[i - 1]);
    const isMonotonicDn = v.every((x, i) => i === 0 || x <= v[i - 1]);
    if (range / mid < 0.05) return { tag: '안정', cls: 'flat' };
    // goalDown: 작을수록 좋음 → 증가가 악화
    const isImproving = goalDown ? last < first : last > first;
    const isMono = goalDown ? isMonotonicDn : isMonotonicUp;
    const isWorseningMono = goalDown ? isMonotonicUp : isMonotonicDn;
    if (isImproving && isMono) return { tag: '꾸준히 개선', cls: 'up-strong' };
    if (isImproving) return { tag: '개선 추세', cls: 'up' };
    if (!isImproving && isWorseningMono) return { tag: '꾸준히 악화', cls: 'down-strong' };
    if (!isImproving) return { tag: '악화 추세', cls: 'down' };
    return { tag: '변동', cls: 'flat' };
  }

  // 핵심 KPI별 추정 원인 — 긍정 톤 메시지로 자동 생성
  const causalMap = {
    insideSqlConv:    { drivers: ['insideFrtPassRate20', 'insideAvgFrtMin'], msg: (vals) => `FRT 준수율 ${vals.insideFrtPassRate20.diffStr} 개선이 SQL 전환율 안정의 기반으로 작용 중` },
    fieldCwRate:      { drivers: ['fieldStaleOver14'], msg: (vals) => `전환율 개선 흐름 속에서 14일+ 정체 매장(${vals.fieldStaleOver14.last}건) 관리도 함께 점검 필요` },
    inboundBoCwRate:  { drivers: ['inboundBoOver14'], msg: (vals) => `처리 효율 가속에 따라 정체 매장 누적(${vals.inboundBoOver14.last}건) 동반 — 다음 달 stage별 분해 분석 권장` },
    tmSqlBacklogOver7: { drivers: ['tmOpenPreOpenPct', 'tmFrtPassRate'], msg: (vals) => `Open SQL 중 오픈전 매장 비중이 ${vals.tmOpenPreOpenPct.first}% → ${vals.tmOpenPreOpenPct.last}%로 누적 ${vals.tmOpenPreOpenPct.diffStr}%p 증가 — 오픈일 미확정 매장의 입금 의사결정 지연이 백로그 가속의 직접 원인` },
    aeMou:            { drivers: ['aeMeetingCount', 'aeNegoEntry'], msg: (vals) => `미팅 활동 ${vals.aeMeetingCount.diffStr}, 협상 진입 ${vals.aeNegoEntry.diffStr} 모두 동반 증가 — 발굴 모멘텀의 직접 원인` },
    amActive:         { drivers: ['amDailyLeadAvg', 'amOnboardingRate'], msg: (vals) => `일평균 Lead ${vals.amDailyLeadAvg.diffStr} 증가에도 온보딩률 ${vals.amOnboardingRate.diffStr} 추세 — 활성화 단계 보강이 다음 과제` },
    channelBoCwRate:  { drivers: ['channelBoOver14'], msg: (vals) => `회복 흐름 속에서 정체 매장(${vals.channelBoOver14.last}건) 관리가 회복 속도의 핵심 변수` },
  };

  function trendVal(key) {
    const a = series[0][key], b = series[series.length - 1][key];
    if (a == null || b == null) return { first: null, last: null, diff: null, diffStr: '-' };
    const diff = Math.round((b - a) * 10) / 10;
    const sign = diff > 0 ? '+' : '';
    return { first: a, last: b, diff, diffStr: `${sign}${diff}` };
  }

  function buildCausal(kpiKey) {
    const map = causalMap[kpiKey];
    if (!map) return null;
    const vals = {};
    map.drivers.forEach((k) => { vals[k] = trendVal(k); });
    return { msg: map.msg(vals), drivers: map.drivers, vals };
  }

  const tableRows = kpiList.map((r) => {
    const cells = series.map((s) => s ? s[r.key] : null);
    const last = cells[cells.length - 1];
    const first = cells[0];
    const totalDiff = (last != null && first != null) ? last - first : null;
    const totalDiffStr = totalDiff == null ? '-' :
      totalDiff > 0 ? `+${Math.round(totalDiff * 10) / 10}${r.unit}` :
      totalDiff < 0 ? `${Math.round(totalDiff * 10) / 10}${r.unit}` : '0';
    const trend = classifyTrend(cells, !!r.goalDown);
    const validCells = cells.filter((x) => x != null);
    const bestVal = r.goalDown ? Math.min(...validCells) : Math.max(...validCells);
    const cellHtml = cells.map((v) => {
      const isBest = v != null && v === bestVal;
      const style = isBest ? 'background:#e8fff4;font-weight:800;color:#00966f' : '';
      return `<td style="${style}">${v != null ? v + r.unit : '-'}</td>`;
    }).join('');
    const causal = buildCausal(r.key);
    return `<tr>
      <td><span style="display:inline-block;width:6px;height:24px;background:${r.color};border-radius:3px;vertical-align:middle;margin-right:8px"></span>${r.name}</td>
      ${cellHtml}
      <td><strong>${totalDiffStr}</strong></td>
      <td><span class="trend-tag tag-${trend.cls}">${trend.tag}</span></td>
    </tr>
    <tr class="causal-row">
      <td colspan="${labels.length + 3}" style="padding:6px 12px 12px 26px;background:#fafbfc;border-bottom:1px solid var(--border);font-size:12.5px;color:var(--text-secondary);line-height:1.6">
        <span style="color:var(--blue);font-weight:700">↳ 인과 해석:</span> ${causal ? causal.msg : '관련 지표 미정'}
      </td>
    </tr>`;
  }).join('');

  // 파트별 리뷰 자동 생성 (현재월 raw 데이터 활용)
  const reviews = generateReviews(kpiList, series, labels, trendData);

  return `
<section id="trend">
  <h2><span class="dot" style="background:#06b6d4"></span>1~4월 핵심 KPI 트렌드</h2>

  <div class="subteam">
    <div class="st-head">
      <div class="st-bar" style="background:#06b6d4"></div>
      <div class="st-name">월별 핵심 KPI</div>
      <div class="st-meta">최댓값은 초록색 강조 · 1월→4월 전체 변화 표시</div>
    </div>
    <table class="trend-table">
      <thead>
        <tr>
          <th>지표</th>
          ${labels.map((l) => `<th>${l}</th>`).join('')}
          <th>1월→4월</th>
          <th>패턴</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>

  <div class="subteam">
    <div class="st-head">
      <div class="st-bar" style="background:#06b6d4"></div>
      <div class="st-name">파트별 리뷰</div>
      <div class="st-meta">각 sub-team의 1~4월 변화 해석 · 이번달 개선 포인트 · 다음 액션</div>
    </div>
    ${reviews}
  </div>
</section>

<script>
(function(){
  if (!window.Chart) return;
  Chart.defaults.font.family = "'Pretendard', sans-serif";
  Chart.defaults.color = '#6b7684';
  const labels = ${JSON.stringify(labels)};
  ${charts.map((c) => `
  new Chart(document.getElementById('${c.id}'), {
    type: 'line',
    data: { labels, datasets: ${JSON.stringify(c.datasets)}.map(d => ({
      label: d.label, data: d.data, borderColor: d.color, backgroundColor: d.color,
      tension: 0.3, borderWidth: 3, pointRadius: 4, pointHoverRadius: 6, fill: false
    })) },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y + '${c.yLabel}' } }
      },
      scales: { y: { beginAtZero: true${c.yMax ? ', max: ' + c.yMax : ''}, title: { display: true, text: '${c.yLabel}' } } }
    }
  });
  `).join('\n')}
})();
</script>`;
}

// ============================================================
// 헤더 대시보드 strip — 7 sub-team 핵심 KPI 한눈에
function renderDashboard(trendData) {
  const cur = extractKpis(trendData[trendData.length - 1]?.json);
  const prev = extractKpis(trendData[trendData.length - 2]?.json);
  if (!cur) return '';
  const items = [
    { name: '인사이드 SQL 전환율', key: 'insideSqlConv', unit: '%', target: 90, color: '#00b386' },
    { name: '필드 CW 전환율',      key: 'fieldCwRate', unit: '%', color: '#f59f00' },
    { name: '인바운드 BO CW 전환율', key: 'inboundBoCwRate', unit: '%', color: '#8b5cf6' },
    { name: '채널 TM SQL 백로그 (7일+)',  key: 'tmSqlBacklogOver7', unit: '건', target: 10, color: '#0ea5e9', goalDown: true },
    { name: '채널 AE 신규 MOU',    key: 'aeMou', unit: '건', target: 4, color: '#8b5cf6' },
    { name: '채널 AM 활성 파트너',  key: 'amActive', unit: '개', target: 70, color: '#06b6d4' },
    { name: '채널 BO CW 전환율',   key: 'channelBoCwRate', unit: '%', color: '#a855f7' },
  ];
  const tiles = items.map((it) => {
    const v = cur[it.key];
    const p = prev ? prev[it.key] : null;
    const diff = (v != null && p != null) ? Math.round((v - p) * 10) / 10 : null;
    // goalDown인 KPI는 v <= target이 met
    const cls = it.target != null
      ? (it.goalDown ? (v <= it.target ? 'met' : 'poor') : (v >= it.target ? 'met' : 'poor'))
      : '';
    const dStr = diff == null ? '' : diff > 0 ? `▲ +${diff}${it.unit}` : diff < 0 ? `▼ ${diff}${it.unit}` : '— 동일';
    // goalDown이면 down이 좋은 신호
    const dCls = diff == null ? '' : (
      it.goalDown
        ? (diff < 0 ? 'up' : diff > 0 ? 'down' : 'flat')
        : (diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat')
    );
    return `<div class="dash-tile ${cls}" style="border-top-color:${cls === 'met' ? 'var(--green)' : cls === 'poor' ? 'var(--red)' : it.color}">
      <div class="dash-tile-name">${it.name}</div>
      <div class="dash-tile-val">${v}${it.unit}</div>
      <div class="dash-tile-delta ${dCls}">${dStr}${it.target != null ? ` · 목표 ${it.target}${it.unit}` : ''}</div>
    </div>`;
  }).join('');
  return `<div class="dashboard">${tiles}</div>`;
}

// ============================================================
// 핵심 KPI 헤로 카드
function heroKpi({ name, value, unit, target, ratio, status, sub }) {
  const cls = status === 'met' ? 'met' : status === 'poor' ? 'poor' : '';
  const pct = ratio != null ? Math.min(Math.round(ratio * 100), 200) : null;
  const barWidth = pct != null ? Math.min(pct, 100) : 0;
  return `
    <div class="hero-kpi ${cls}">
      <div style="min-width:200px">
        <div class="hero-kpi-tag">1차 핵심 KPI</div>
        <div class="hero-kpi-name">${name}</div>
        <div class="hero-kpi-val">${value}<span style="font-size:22px;font-weight:600;color:var(--text-secondary)">${unit||''}</span></div>
        ${target != null ? `<div class="hero-kpi-target">목표 ${target}${unit||''} ${ratio != null ? `· 달성률 ${pct}%` : ''}</div>` : ''}
      </div>
      <div class="hero-kpi-bar">
        ${ratio != null ? `<div class="hero-bar-track"><div class="hero-bar-fill" style="width:${barWidth}%"></div></div>
        <div class="hero-bar-info"><span>0</span><span>목표 ${target}${unit||''}</span></div>` : ''}
        ${sub ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px">${sub}</div>` : ''}
      </div>
    </div>`;
}

// ============================================================
// 인사이드 세일즈
function renderInside(is) {
  if (!is) return '';
  const conv = is.sqlConversionRate ?? 0;
  const target = is.target_sqlConversionRate ?? 90;

  // 팀 합계 FRT 통계
  const owners = is.byOwner || [];
  const totFrtOk    = owners.reduce((s, o) => s + (o.frtOk || 0), 0);
  const totFrtOver  = owners.reduce((s, o) => s + (o.frtOver20 || 0), 0);
  const frtPassRate = (totFrtOk + totFrtOver) ? Math.round(totFrtOk / (totFrtOk + totFrtOver) * 100) : 0;
  const totVisit    = owners.reduce((s, o) => s + (o.visitConverted || 0), 0);
  const totCw       = owners.reduce((s, o) => s + (o.cw || 0), 0);

  return `
  <div class="subteam">
    <div class="st-head">
      <div class="st-bar" style="background:var(--green)"></div>
      <div class="st-name">인사이드 세일즈</div>
      <div class="st-meta">${(is.members || []).length}명 — Lead 응대·MQL/SQL 자격검증</div>
    </div>
    ${heroKpi({
      name: 'SQL 전환율 (Lead → SQL)',
      value: conv,
      unit: '%',
      target,
      ratio: target ? conv / target : null,
      status: conv >= target ? 'met' : 'poor',
      sub: `Lead ${is.lead || 0} → MQL ${is.mql || 0} → SQL ${is.sql || 0}`,
    })}
    <h3 style="font-size:13px;margin:16px 0 8px;color:var(--text-secondary)">단계별 깔때기</h3>
    <div class="funnel">
      <div class="funnel-stage"><div class="nm">Lead</div><div class="v">${is.lead || 0}</div></div>
      <div class="funnel-stage"><div class="nm">MQL</div><div class="v">${is.mql || 0}</div><div class="conv">${is.lead ? Math.round(is.mql/is.lead*100):0}%</div></div>
      <div class="funnel-stage"><div class="nm">SQL</div><div class="v">${is.sql || 0}</div><div class="conv">${is.mql ? Math.round(is.sql/is.mql*100):0}%</div></div>
      <div class="funnel-stage"><div class="nm">방문</div><div class="v">${totVisit}</div></div>
      <div class="funnel-stage"><div class="nm">CW</div><div class="v">${totCw}</div></div>
    </div>
    <div class="kpi-row" style="margin-top:14px">
      <div class="tile ${frtPassRate>=80?'target-met':'target-low'}"><div class="lbl">FRT 준수율 (20분 이내)</div><div class="val">${frtPassRate}%</div><div class="sub">${totFrtOk}/${totFrtOk+totFrtOver}건</div></div>
      <div class="tile"><div class="lbl">FRT 초과 (20분+)</div><div class="val">${totFrtOver}건</div></div>
      <div class="tile"><div class="lbl">방문 전환</div><div class="val">${totVisit}건</div></div>
      <div class="tile"><div class="lbl">CW</div><div class="val">${totCw}건</div></div>
    </div>
  </div>`;
}

function renderField(fs) {
  if (!fs) return '';
  // cwConversionRate.byUser가 정확한 합계 (이월 포함된 전체 활동 매장 + 모든 CW/CL)
  const users = fs.cwConversionRate?.byUser || [];
  const t = users.reduce((acc, u) => ({
    total: acc.total + (u.total ?? 0),
    cw: acc.cw + (u.cw ?? 0),
    cl: acc.cl + (u.cl ?? 0),
    open: acc.open + (u.open ?? 0),
    thisMonthCW: acc.thisMonthCW + (u.thisMonthCW ?? 0),
    carryoverCW: acc.carryoverCW + (u.carryoverCW ?? 0),
    thisMonthTotal: acc.thisMonthTotal + (u.thisMonthTotal ?? 0),
    carryoverTotal: acc.carryoverTotal + (u.carryoverTotal ?? 0),
  }), { total: 0, cw: 0, cl: 0, open: 0, thisMonthCW: 0, carryoverCW: 0, thisMonthTotal: 0, carryoverTotal: 0 });

  const cwRateClosed = (t.cw + t.cl) ? Math.round(t.cw / (t.cw + t.cl) * 100) : 0;  // 마감 매장 중 CW 비율
  const cwRateAll    = t.total ? Math.round(t.cw / t.total * 100) : 0;               // 활동 매장 중 CW 비율
  const staleN = fs.staleVisit?.list?.length ?? '-';
  return `
  <div class="subteam">
    <div class="st-head">
      <div class="st-bar" style="background:var(--orange)"></div>
      <div class="st-name">필드 세일즈</div>
      <div class="st-meta">${(fs.members || []).length}명 — 매장 방문·상담</div>
    </div>
    ${heroKpi({
      name: 'CW 전환율 (이월 포함, 마감 매장 중 Win 비율)',
      value: cwRateClosed,
      unit: '%',
      sub: `마감 ${t.cw + t.cl}건 (CW ${t.cw} / CL ${t.cl}) · CW 내역: 이번달 ${t.thisMonthCW} + 이월 ${t.carryoverCW}`,
    })}
    <div class="kpi-row" style="margin-top:14px">
      <div class="tile"><div class="lbl">활동 대상 (전체)</div><div class="val">${t.total}건</div><div class="sub">이번달 ${t.thisMonthTotal} + 이월 ${t.carryoverTotal}</div></div>
      <div class="tile"><div class="lbl">CW (이월 포함)</div><div class="val">${t.cw}건</div><div class="sub">이번달 ${t.thisMonthCW} + 이월 ${t.carryoverCW}</div></div>
      <div class="tile"><div class="lbl">담당 중 CW 비율</div><div class="val">${cwRateAll}%</div><div class="sub">${t.cw}/${t.total} · 진행 중 ${t.open}</div></div>
      <div class="tile"><div class="lbl">stale 방문</div><div class="val">${staleN}건</div><div class="sub">정체 매장</div></div>
    </div>
  </div>`;
}

function renderInboundBO(bo) {
  if (!bo) return '';
  const users = bo.cwConversionRate?.byUser || [];
  const t = users.reduce((acc, u) => ({
    total: acc.total + (u.total ?? 0),
    cw: acc.cw + (u.cw ?? 0),
    cl: acc.cl + (u.cl ?? 0),
    open: acc.open + (u.open ?? 0),
    thisMonthCW: acc.thisMonthCW + (u.thisMonthCW ?? 0),
    carryoverCW: acc.carryoverCW + (u.carryoverCW ?? 0),
    thisMonthTotal: acc.thisMonthTotal + (u.thisMonthTotal ?? 0),
    carryoverTotal: acc.carryoverTotal + (u.carryoverTotal ?? 0),
  }), { total: 0, cw: 0, cl: 0, open: 0, thisMonthCW: 0, carryoverCW: 0, thisMonthTotal: 0, carryoverTotal: 0 });

  const cwRateClosed = (t.cw + t.cl) ? Math.round(t.cw / (t.cw + t.cl) * 100) : 0;
  const cwRateAll    = t.total ? Math.round(t.cw / t.total * 100) : 0;
  const sqlBacklog = bo.sqlBacklog?.list?.length ?? bo.sqlBacklog?.count ?? '-';
  return `
  <div class="subteam">
    <div class="st-head">
      <div class="st-bar" style="background:var(--purple)"></div>
      <div class="st-name">백오피스 (인바운드)</div>
      <div class="st-meta">${(bo.members || []).length}명 — 견적·계약·출고·설치</div>
    </div>
    ${heroKpi({
      name: 'CW 전환율 (이월 포함, 마감 매장 중 Win 비율)',
      value: cwRateClosed,
      unit: '%',
      sub: `마감 ${t.cw + t.cl}건 (CW ${t.cw} / CL ${t.cl}) · CW 내역: 이번달 ${t.thisMonthCW} + 이월 ${t.carryoverCW}`,
    })}
    <div class="kpi-row" style="margin-top:14px">
      <div class="tile"><div class="lbl">활동 대상 (전체)</div><div class="val">${t.total}건</div><div class="sub">이번달 ${t.thisMonthTotal} + 이월 ${t.carryoverTotal}</div></div>
      <div class="tile"><div class="lbl">CW (이월 포함)</div><div class="val">${t.cw}건</div><div class="sub">이번달 ${t.thisMonthCW} + 이월 ${t.carryoverCW}</div></div>
      <div class="tile"><div class="lbl">담당 중 CW 비율</div><div class="val">${cwRateAll}%</div><div class="sub">${t.cw}/${t.total} · 진행 중 ${t.open}</div></div>
      <div class="tile"><div class="lbl">SQL 백로그</div><div class="val">${sqlBacklog}건</div></div>
    </div>
  </div>`;
}

// 채널 sub-team
function renderTM(tm) {
  if (!tm || !tm.members) return '';
  const frt = tm.frt || {};
  const sb = tm.sqlBacklog || {};
  const target = sb.target ?? 10;
  const over7 = sb.over7 ?? 0;
  const onTarget = over7 <= target;
  const frtPassRate = (frt.frtOk != null && frt.frtOver20 != null && (frt.frtOk + frt.frtOver20)) ? Math.round(frt.frtOk/(frt.frtOk+frt.frtOver20)*100) : 0;
  return `
  <div class="subteam">
    <div class="st-head">
      <div class="st-bar" style="background:#0ea5e9"></div>
      <div class="st-name">채널 TM (텔레마케팅)</div>
      <div class="st-meta">${(tm.members || []).length}명 — Lead 1차 응대 + 견적 처리</div>
    </div>
    ${heroKpi({
      name: 'SQL 백로그 (견적 후 입금일자 7일+ 미입력)',
      value: over7,
      unit: '건',
      target,
      ratio: over7 ? target / over7 : 1,
      status: onTarget ? 'met' : 'poor',
      sub: `Open SQL ${sb.openTotal ?? '-'}건 중 ${over7}건 7일+ 정체 · 목표 ${target}건 이내`,
    })}
    <div class="kpi-row" style="margin-top:14px">
      <div class="tile ${frtPassRate>=80?'target-met':'target-low'}"><div class="lbl">FRT 준수율 (20분)</div><div class="val">${frtPassRate}%</div><div class="sub">${frt.frtOk ?? '-'}/${(frt.frtOk||0)+(frt.frtOver20||0)}건</div></div>
      <div class="tile"><div class="lbl">평균 FRT</div><div class="val">${frt.avgFrtMinutes != null ? Math.round(frt.avgFrtMinutes) + '분' : '-'}</div></div>
      <div class="tile"><div class="lbl">미전환 MQL</div><div class="val">${tm.unconvertedMQL?.count ?? '-'}건</div></div>
      <div class="tile"><div class="lbl">견적 발송</div><div class="val">${tm.quoteSent?.total ?? '-'}건</div></div>
    </div>
  </div>`;
}

function renderAE(ae, ch) {
  if (!ae || !ae.members) return '';
  const mou = ae.mouCount || {};
  const nego = ae.negoEntry || {};
  const unsig = ae.unsignedContracts || {};
  const mtgRaw = ae.meetingCount || {};
  // AE 본인 미팅만 분리
  const aeMeet = (mtgRaw.byOwner || []).filter((o) => o.team === 'AE').reduce((s, o) => s + (o.count || 0), 0);
  const mtg = { total: aeMeet, avgDaily: ae.workdays ? Math.round(aeMeet / ae.workdays * 10) / 10 : '-', target_daily: mtgRaw.target_daily };
  const mouCls = mou.total >= mou.target ? 'target-met' : 'target-low';
  const negoCls = nego.thisMonth >= nego.target ? 'target-met' : 'target-low';
  return `
  <div class="subteam">
    <div class="st-head">
      <div class="st-bar" style="background:var(--purple)"></div>
      <div class="st-name">채널 AE (Account Executive)</div>
      <div class="st-meta">${(ae.members || []).length}명 · 영업일 ${ae.workdays}일 — MOU 체결·협상 진입</div>
    </div>
    ${heroKpi({
      name: '신규 MOU 체결 수',
      value: mou.total ?? 0,
      unit: '건',
      target: mou.target ?? null,
      ratio: mou.target ? (mou.total ?? 0) / mou.target : null,
      status: (mou.total ?? 0) >= (mou.target ?? Infinity) ? 'met' : 'poor',
      sub: `파트너 ${mou.partners ?? 0} · FC HQ ${mou.franchiseHQ ?? 0} · 브랜드 ${mou.franchiseBrands ?? 0}`,
    })}
    <div class="kpi-row" style="margin-top:14px">
      <div class="tile ${negoCls}"><div class="lbl">협상 진입 (이번달)</div><div class="val">${nego.thisMonth ?? '-'}건</div><div class="sub">목표 ${nego.target ?? '-'}건 · 누적 ${nego.total ?? 0}</div></div>
      <div class="tile"><div class="lbl">미서명 계약</div><div class="val">${unsig.total ?? '-'}건</div><div class="sub">overdue ${unsig.overdue ?? 0}건 (${unsig.target_days}일 기준)</div></div>
      <div class="tile"><div class="lbl">미팅 (이번달)</div><div class="val">${mtg.total ?? '-'}건</div><div class="sub">일평균 ${mtg.avgDaily ?? '-'}건</div></div>
      <div class="tile"><div class="lbl">미팅 목표/일</div><div class="val">${mtg.target_daily ?? '-'}</div></div>
    </div>
  </div>`;
}

function renderAM(am, ch) {
  if (!am || !am.members) return '';
  const dl = am.dailyLeadCount || {};
  const mtgRaw = am.meetingCount || {};
  const amMeet = (mtgRaw.byOwner || []).filter((o) => o.team === 'AM').reduce((s, o) => s + (o.count || 0), 0);
  const mtg = { total: amMeet, avgDaily: am.workdays ? Math.round(amMeet / am.workdays * 10) / 10 : '-' };
  const onb = am.onboardingRate || {};
  const ap = am.activePartnerCount || {};
  const onbCls = onb.rate >= onb.target ? 'target-met' : 'target-low';
  const apCls  = ap.total >= ap.target ? 'target-met' : 'target-low';
  return `
  <div class="subteam">
    <div class="st-head">
      <div class="st-bar" style="background:#06b6d4"></div>
      <div class="st-name">채널 AM (Account Manager)</div>
      <div class="st-meta">${(am.members || []).length}명 · 영업일 ${am.workdays}일 — Lead 확보·미팅·온보딩</div>
    </div>
    ${heroKpi({
      name: '활성 파트너 수',
      value: ap.total ?? 0,
      unit: '개',
      target: ap.target ?? null,
      ratio: ap.target ? (ap.total ?? 0) / ap.target : null,
      status: (ap.total ?? 0) >= (ap.target ?? Infinity) ? 'met' : 'poor',
      sub: `파트너 ${ap.partners ?? 0} · 브랜드 ${ap.brands ?? 0}`,
    })}
    <div class="kpi-row" style="margin-top:14px">
      <div class="tile"><div class="lbl">채널 Lead (이번달)</div><div class="val">${dl.total ?? '-'}건</div><div class="sub">파트너 ${dl.partner ?? 0} / 프랜차이즈 ${dl.franchise ?? 0}</div></div>
      <div class="tile"><div class="lbl">일평균 Lead</div><div class="val">${dl.avgDaily ?? '-'}건</div><div class="sub">목표 ${dl.target_daily ?? '-'}</div></div>
      <div class="tile ${onbCls}"><div class="lbl">온보딩률</div><div class="val">${onb.rate ?? '-'}%</div><div class="sub">${onb.settled ?? 0}/${onb.total ?? 0} · 목표 ${onb.target ?? '-'}%</div></div>
      <div class="tile"><div class="lbl">미팅 (이번달)</div><div class="val">${mtg.total ?? '-'}건</div><div class="sub">일평균 ${mtg.avgDaily ?? '-'}건</div></div>
    </div>
  </div>`;
}

function renderChannelBO(cbo) {
  if (!cbo || !cbo.members) return '';
  const users = cbo.cwConversionRate?.byUser || [];
  const t = users.reduce((acc, u) => ({
    total: acc.total + (u.total ?? 0),
    cw: acc.cw + (u.cw ?? 0),
    cl: acc.cl + (u.cl ?? 0),
    open: acc.open + (u.open ?? 0),
    thisMonthCW: acc.thisMonthCW + (u.thisMonthCW ?? 0),
    carryoverCW: acc.carryoverCW + (u.carryoverCW ?? 0),
    thisMonthTotal: acc.thisMonthTotal + (u.thisMonthTotal ?? 0),
    carryoverTotal: acc.carryoverTotal + (u.carryoverTotal ?? 0),
  }), { total: 0, cw: 0, cl: 0, open: 0, thisMonthCW: 0, carryoverCW: 0, thisMonthTotal: 0, carryoverTotal: 0 });

  const cwRateClosed = (t.cw + t.cl) ? Math.round(t.cw / (t.cw + t.cl) * 100) : 0;
  const cwRateAll    = t.total ? Math.round(t.cw / t.total * 100) : 0;
  return `
  <div class="subteam">
    <div class="st-head">
      <div class="st-bar" style="background:#a855f7"></div>
      <div class="st-name">백오피스 (채널)</div>
      <div class="st-meta">${(cbo.members || []).length}명 — 채널 견적·계약</div>
    </div>
    ${heroKpi({
      name: 'CW 전환율 (이월 포함, 마감 매장 중 Win 비율)',
      value: cwRateClosed,
      unit: '%',
      sub: `마감 ${t.cw + t.cl}건 (CW ${t.cw} / CL ${t.cl}) · CW 내역: 이번달 ${t.thisMonthCW} + 이월 ${t.carryoverCW}`,
    })}
    <div class="kpi-row" style="margin-top:14px">
      <div class="tile"><div class="lbl">활동 대상 (전체)</div><div class="val">${t.total}건</div><div class="sub">이번달 ${t.thisMonthTotal} + 이월 ${t.carryoverTotal}</div></div>
      <div class="tile"><div class="lbl">CW (이월 포함)</div><div class="val">${t.cw}건</div><div class="sub">이번달 ${t.thisMonthCW} + 이월 ${t.carryoverCW}</div></div>
      <div class="tile"><div class="lbl">담당 중 CW 비율</div><div class="val">${cwRateAll}%</div><div class="sub">${t.cw}/${t.total} · 진행 중 ${t.open}</div></div>
      <div class="tile"><div class="lbl">SQL 백로그</div><div class="val">${cbo.sqlBacklog?.count ?? '-'}건</div></div>
    </div>
  </div>`;
}

function renderMouStats(m) {
  if (!m) return '';
  return `
  <div class="subteam">
    <div class="st-head">
      <div class="st-bar" style="background:var(--orange)"></div>
      <div class="st-name">MOU 발굴 현황 (채널 1차 KPI 보조)</div>
    </div>
    <div class="kpi-row">
      <div class="tile"><div class="lbl">파트너 (이번달)</div><div class="val">${m.partner?.thisMonth ?? '-'}건</div><div class="sub">최근 3개월 ${m.partner?.last3Months ?? '-'}</div></div>
      <div class="tile"><div class="lbl">프랜차이즈본사 (이번달)</div><div class="val">${m.franchiseHQ?.thisMonth ?? '-'}건</div><div class="sub">최근 3개월 ${m.franchiseHQ?.last3Months ?? '-'}</div></div>
      <div class="tile"><div class="lbl">파트너 온보딩</div><div class="val">${m.onboarding?.partner?.completed ?? '-'}건</div><div class="sub">/ ${m.onboarding?.partner?.total ?? '-'}</div></div>
      <div class="tile"><div class="lbl">FC HQ 온보딩</div><div class="val">${m.onboarding?.franchiseHQ?.completed ?? '-'}건</div><div class="sub">/ ${m.onboarding?.franchiseHQ?.total ?? '-'}</div></div>
    </div>
  </div>`;
}

// 스코어카드 — 등급 분포 요약 (사람 이름 제외)
function renderScores(scores) {
  if (!scores || !Object.keys(scores).length) return '<p style="color:var(--text-tertiary)">스코어 데이터 없음</p>';
  const groupNames = { is: '인사이드', fs: '필드', bo: '인바운드 BO', tm: '채널 TM', csbo: '채널 BO', ae: '채널 AE', am: '채널 AM' };
  const groupColors = { is: '#00b386', fs: '#f59f00', bo: '#8b5cf6', tm: '#0ea5e9', csbo: '#a855f7', ae: '#8b5cf6', am: '#06b6d4' };
  const grades = ['S', 'A', 'B', 'C', 'D'];

  const rows = Object.entries(scores).map(([key, list]) => {
    if (!Array.isArray(list) || !list.length) return null;
    const dist = grades.reduce((m, g) => ({ ...m, [g]: 0 }), {});
    let total = 0, count = 0;
    list.forEach((s) => {
      if (s.grade && dist[s.grade] != null) dist[s.grade]++;
      if (typeof s.total === 'number') { total += s.total; count++; }
    });
    const avg = count ? Math.round(total / count) : 0;
    const cells = grades.map((g) => `<td><span class="grade grade-${g}">${g}</span> ${dist[g]}명</td>`).join('');
    return `<tr>
      <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${groupColors[key] || 'var(--blue)'};margin-right:6px"></span>${groupNames[key] || key}</td>
      <td><strong>${list.length}명</strong></td>
      <td>${avg}점</td>
      ${cells}
    </tr>`;
  }).filter(Boolean).join('');

  return `
    <div class="subteam">
      <div class="st-head">
        <div class="st-bar" style="background:#f59f00"></div>
        <div class="st-name">팀별 등급 분포</div>
        <div class="st-meta">사람별 점수가 자동 평가된 등급(S~D) 분포 — 사람 이름 비공개</div>
      </div>
      <table>
        <thead><tr><th>팀</th><th>인원</th><th>평균 점수</th><th>S</th><th>A</th><th>B</th><th>C</th><th>D</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
