// 6월 페이스 분석 HTML 리포트 생성 (navy 인포그래픽)
const fs = require('fs');
const A = JSON.parse(fs.readFileSync('data/june-pace-analysis.json', 'utf8'));
const SEGS = ['IBS', 'OBS', 'FR', 'PT'];
const SEGC = { IBS: '#3B82F6', OBS: '#A78BFA', FR: '#22D3EE', PT: '#34D399' };
const n = (x) => Math.round(x).toLocaleString('ko-KR');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const t = A.total;
const overall = t.attainment;
// 세그먼트 진행 바
const segBars = SEGS.map(k => {
  const s = A.segments[k]; const pct = Math.min(100, s.actual / s.target * 100); const projPct = Math.min(115, s.projected / s.target * 100);
  const projAtt = Math.round(s.projected / s.target * 100);
  const ok = projAtt >= 100;
  return `<div class="seg">
    <div class="seg-h"><span class="dot" style="background:${SEGC[k]}"></span><b>${s.name}</b>
      <span class="seg-num">${n(s.actual)} / ${n(s.target)}대 <span class="muted">· CW ${n(s.projected)} (${projAtt}%)</span></span></div>
    <div class="bar"><div class="fill" style="width:${pct}%;background:${SEGC[k]}"></div>
      <div class="proj" style="left:${Math.min(100, projPct)}%" title="예상CW"></div></div>
    <div class="seg-sub"><span class="${ok ? 'good' : 'bad'}">${ok ? '▲ 페이스 충족' : '▼ 미달'} ${projAtt}%</span>
      · 필요 일일 ${s.requiredDaily}대 · 파이프라인 ${n(s.pipelineTab)}대(커버 ${s.coverage ?? '-'}%) · 리드타임 ${s.leadTimeMedian}일</div>
  </div>`;
}).join('');

// 퍼널 단계 비교
const funnel = A.stageCompare.filter(s => s.openCnt > 0 || s.cwMed > 0).map(s => {
  const hot = s.stage === '견적';
  const max = Math.max(...A.stageCompare.map(x => Math.max(x.cwMed, x.clMed, x.openMed)), 1);
  const bar = (v, c) => `<div class="fbar"><div style="width:${Math.max(v / max * 100, v > 0 ? 3 : 0)}%;background:${c}"></div></div><span class="fv">${v}일</span>`;
  return `<tr class="${hot ? 'hot' : ''}">
    <td class="st">${s.stage}${hot ? ' <span class="tag">병목</span>' : ''}</td>
    <td>${bar(s.cwMed, '#34D399')}</td>
    <td>${bar(s.openMed, '#F59E0B')}</td>
    <td>${bar(s.clMed, '#F0556C')}</td></tr>`;
}).join('');

// KANBAN 위험 영업기회
const risk = A.atRisk.slice(0, 20).map(o => {
  const stale = (o.daysSinceTask ?? 99) >= 14;
  return `<tr>
    <td><a href="${o.link}" target="_blank">${esc(o.store)}</a></td>
    <td><span class="seg-pill" style="background:${SEGC[o.team]}22;color:${SEGC[o.team]}">${o.seg}</span></td>
    <td>${o.stage}</td>
    <td class="num">${o.tablets}대</td>
    <td class="num ${o.stageAge >= 30 ? 'r' : o.stageAge >= 14 ? 'o' : ''}">${o.stageAge}일</td>
    <td class="num ${stale ? 'r' : ''}">${o.daysSinceTask != null ? o.daysSinceTask + '일전' : '없음'}</td>
    <td class="task">${o.lastTaskSubject ? `${esc(o.lastTaskSubject)}: ${esc(o.lastTaskDesc)}` : '<span class="muted">활동 없음</span>'}</td></tr>`;
}).join('');

const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>6월 태블릿 페이스 분석 — 목표 5,500대</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Pretendard',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;background:#0A1626;color:#E6EDF5;line-height:1.5;padding:32px 20px}
.wrap{max-width:1040px;margin:0 auto}
.hero{background:linear-gradient(135deg,#13294B,#0E1D38);border:1px solid #1E3A5F;border-radius:20px;padding:30px 32px;margin-bottom:22px}
.hero h1{font-size:24px;font-weight:800;letter-spacing:-.5px}
.hero .sub{color:#8FA8C8;font-size:13.5px;margin-top:6px}
.kpibig{display:flex;gap:28px;flex-wrap:wrap;margin-top:22px;align-items:flex-end}
.kpibig .big{font-size:46px;font-weight:800;line-height:1}
.kpibig .unit{font-size:16px;color:#8FA8C8;font-weight:600}
.kpibig .lbl{font-size:12.5px;color:#8FA8C8;margin-bottom:4px}
.att{font-size:30px;font-weight:800}
.warn{color:#F59E0B}.bad{color:#F0556C}.good{color:#34D399}.muted{color:#7E96B5}
section{background:#0E1D34;border:1px solid #1A3052;border-radius:18px;padding:24px 26px;margin-bottom:18px}
section h2{font-size:17px;font-weight:800;margin-bottom:4px}
section .desc{color:#8FA8C8;font-size:13px;margin-bottom:18px}
.seg{margin-bottom:16px}
.seg-h{display:flex;align-items:baseline;gap:8px;font-size:14px}
.seg-h .seg-num{margin-left:auto;font-size:13px;color:#C5D5E8}
.dot{width:9px;height:9px;border-radius:5px;display:inline-block}
.bar{position:relative;height:13px;background:#13243F;border-radius:7px;margin:7px 0 5px;overflow:visible}
.bar .fill{height:100%;border-radius:7px}
.bar .proj{position:absolute;top:-3px;bottom:-3px;width:3px;background:#fff;border-radius:2px}
.seg-sub{font-size:11.5px;color:#8FA8C8}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;color:#7E96B5;font-weight:600;font-size:11.5px;padding:6px 8px;border-bottom:1px solid #1A3052}
td{padding:8px;border-bottom:1px solid #14253F;vertical-align:middle}
td a{color:#5FB0FF;text-decoration:none}
.num{text-align:right;font-variant-numeric:tabular-nums}
.num.r{color:#F0556C;font-weight:700}.num.o{color:#F59E0B;font-weight:700}
.fbar{display:inline-block;width:120px;height:11px;background:#13243F;border-radius:5px;overflow:hidden;vertical-align:middle}
.fbar>div{height:100%;border-radius:5px}
.fv{font-size:11.5px;margin-left:6px;color:#C5D5E8;vertical-align:middle}
tr.hot td{background:#2A1420}tr.hot .st{color:#F0556C;font-weight:700}
.tag{font-size:10px;background:#F0556C;color:#fff;border-radius:5px;padding:1px 6px;font-weight:700}
.st{font-weight:600}
.seg-pill{font-size:11px;padding:2px 8px;border-radius:6px;font-weight:700}
.task{font-size:11.5px;color:#A8BDD8;max-width:300px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.col h3{font-size:13.5px;font-weight:700;margin-bottom:10px}
.col.gd h3{color:#34D399}.col.bd h3{color:#F0556C}
.col li{font-size:12.5px;color:#C5D5E8;margin-bottom:8px;list-style:none;padding-left:16px;position:relative}
.col li:before{content:'';position:absolute;left:0;top:7px;width:6px;height:6px;border-radius:3px}
.col.gd li:before{background:#34D399}.col.bd li:before{background:#F0556C}
.legend{font-size:11px;color:#7E96B5;margin-top:10px}
.foot{text-align:center;color:#5A7193;font-size:11.5px;margin-top:14px}
@media(max-width:720px){.two{grid-template-columns:1fr}.task{display:none}}
</style></head><body><div class="wrap">

<div class="hero">
  <h1>6월 태블릿 페이스 분석 <span class="muted" style="font-size:15px">· 신규 목표 5,500대</span></h1>
  <div class="sub">기준일 ${A.asOf} · 영업일 ${A.bizElapsed}/${A.bizTotal}일 경과 · 대상: 테이블오더 신규+추가설치 · 국내(KRW) · 재계약·양도양수·해외 제외</div>
  <div class="sub" style="margin-top:3px">CW = 당월 <b>계약시작일(ContractDateStart)</b> + 영업기회 <b>Closed Won</b> 의 태블릿 대수 합 (사내 /contracts API와 동일 · 신규+추가설치·KRW)</div>
  <div class="kpibig">
    <div><div class="lbl">예상 CW (현재 페이스)</div><span class="big ${overall < 90 ? 'warn' : 'good'}">${n(t.projected)}</span><span class="unit"> / ${n(t.target)}대</span></div>
    <div><div class="lbl">목표 달성률 (CW)</div><span class="att ${overall < 90 ? 'warn' : 'good'}">${overall}%</span></div>
    <div><div class="lbl">예상 갭</div><span class="att bad">${t.gap >= 0 ? '+' : ''}${n(t.gap)}대</span></div>
    <div><div class="lbl">현재 누적 실적</div><span class="att">${n(t.actual)}대</span></div>
  </div>
</div>

<section>
  <h2>① 6월말 예상 CW — 세그먼트별</h2>
  <div class="desc">현재 CW(계약시작일 기준) 페이스를 월말까지 단순 투영. 흰 선 = 예상 CW 위치.</div>
  ${segBars}
  <div class="legend">막대 = 현재 실적 / 흰 선 = 예상 CW(목표 대비). 현 페이스론 <b>전 세그먼트 목표 미달</b> — 프랜차이즈 ${Math.round(A.segments.FR.projected / A.segments.FR.target * 100)}%가 상대 최선, 인바운드·파트너스 30%대 최저.</div>
</section>

<section>
  <h2>② KPI 잘되는 부분 / 안되는 부분</h2>
  <div class="desc">CW 기준 진단.</div>
  <div class="two">
    <div class="col gd"><h3>잘되고 있음</h3><ul>
      <li><b>프랜차이즈 ${Math.round(A.segments.FR.projected / A.segments.FR.target * 100)}% CW</b> — 4세그먼트 중 상대적으로 가장 앞선 페이스. fm_FRHQ 연결 신규 회수 견조</li>
      <li><b>파트너스 파이프라인 ${n(A.segments.PT.pipelineTab)}대(커버 ${A.segments.PT.coverage}%)</b> — 잔여목표 대비 후보 충분, 전환만 되면 회복 가능</li>
      <li>리드타임 중앙값 ${A.segments.FR.leadTimeMedian}~${A.segments.IBS.leadTimeMedian}일 — 마감되는 건은 빠르게 통과(생성→CW)</li>
    </ul></div>
    <div class="col bd"><h3>안되고 있음</h3><ul>
      <li><b>아웃바운드 ${Math.round(A.segments.OBS.projected / A.segments.OBS.target * 100)}% CW</b> — 목표 480 중 ${n(A.segments.OBS.projected)}대 예상, 절대량·전환 모두 부족</li>
      <li><b>인바운드 ${Math.round(A.segments.IBS.projected / A.segments.IBS.target * 100)}% CW</b> — 최대 목표(2,410)인데 페이스 미달, 갭 절대값 최대</li>
      <li><b>전사 ${overall}% CW 전망</b> — 이대로면 ${n(-t.gap)}대 미달. 잔여 영업일 ${A.bizTotal - A.bizElapsed}일 내 일일 페이스 대폭 상향 필요</li>
    </ul></div>
  </div>
</section>

<section>
  <h2>③ 퍼널 개선 — 견적 단계가 생사를 가른다</h2>
  <div class="desc">단계별 체류기간 중앙값: 마감(CW) vs 현재 계류 vs 이탈(CL). 견적에서 갈립니다.</div>
  <table><thead><tr><th>단계</th><th>CW(마감) 통과</th><th>계류(현재) 정체</th><th>CL(이탈) 정체</th></tr></thead><tbody>${funnel}</tbody></table>
  <div class="legend">🟢 마감되는 건은 견적을 1~2일에 통과 · 🟠 지금 계류건은 견적에서 10~28일 정체 · 🔴 이탈건은 견적에서 평균 15일 묶이다 죽음(전체 CL의 70~86%가 견적 이탈). <b>→ 견적 단계 후속 속도(견적 N일+ 자동 에스컬레이션·재견적 차단)가 목표 달성의 최대 레버.</b></div>
</section>

<section>
  <h2>④ KANBAN — 지금 안 챙기면 새는 영업기회 <span class="muted" style="font-size:13px">(Task까지 확인)</span></h2>
  <div class="desc">마감 단계(견적·계약진행 등) · 태블릿 보유 · 최근 생성(좀비 제외) 중 정체+Task 방치 상위. 총 ${n(A.atRiskSummary.total)}건 · ${n(A.atRiskSummary.tabletsAtRisk)}대 위험 (Task 14일+ 방치 ${A.atRiskSummary.stale14}건).</div>
  <table><thead><tr><th>매장</th><th>세그먼트</th><th>단계</th><th>태블릿</th><th>단계경과</th><th>마지막 Task</th><th>최근 활동 내용</th></tr></thead><tbody>${risk}</tbody></table>
  <div class="legend">단계경과·Task 방치일이 클수록 CL 위험. 빨강 = 14일+ 방치. 견적 단계 고가치건의 즉시 재컨택이 CW율 방어의 핵심.</div>
</section>

<div class="foot">데이터: Salesforce · 실적=계약-CW(계약시작일) 기준 · 퍼널=단계변경 기준 · 생성 ${A.asOf} · 태블릿 페이스 파이프라인 연동</div>
</div></body></html>`;

fs.writeFileSync('reports/2026-06-pace-analysis.html', html);
console.log('생성: reports/2026-06-pace-analysis.html (' + html.length + ' bytes)');
