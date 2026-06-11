// 6월 페이스 분석 HTML 리포트 생성 (navy 인포그래픽)
const fs = require('fs');
const A = JSON.parse(fs.readFileSync('data/june-pace-analysis.json', 'utf8'));
const SEGS = ['IBS', 'OBS', 'FR', 'PT'];
const SEGC = { IBS: '#3B82F6', OBS: '#A78BFA', FR: '#22D3EE', PT: '#34D399' };
const n = (x) => Math.round(x).toLocaleString('ko-KR');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const t = A.total;
const overall = t.attainment;
// 세그먼트 진단(데이터 기반 — 하드코딩 금지)
const segArr = SEGS.map(k => ({ k, name: A.segments[k].name, att: Math.round(A.segments[k].projected / A.segments[k].target * 100), cov: A.segments[k].coverage ?? 0, pipe: A.segments[k].pipelineTab, lead: A.segments[k].leadTimeMedian }));
const best = [...segArr].sort((a, b) => b.att - a.att)[0];
const worst = [...segArr].sort((a, b) => a.att - b.att)[0];
const bestCov = [...segArr].sort((a, b) => b.cov - a.cov)[0];
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

// KPI → 퍼널 레버
const kpiSec = (A.kpiLevers || []).map(hq => {
  const partsHtml = (hq.parts || []).map(p => {
    const rows = p.kpis.map(kp => `<div class="kpirow2">
      <div class="kpi-top"><span class="kpi-sig ${kp.ok ? 'g' : 'b'}"></span><span class="kpi-name">${kp.name}</span><span class="kpi-val ${kp.ok ? 'good' : 'bad'}">${kp.cur ?? '-'}${kp.unit}</span><span class="kpi-tgt">/ 목표 ${kp.target}${kp.unit}</span>${kp.affects ? `<span class="kpi-aff">${kp.affects}</span>` : ''}</div>
      ${kp.action ? `<div class="kpi-act">↳ ${kp.action}</div>` : ''}
    </div>`).join('');
    const samp = (p.loss?.samples || []).filter(s => s.store);
    const lossHtml = (p.loss && p.loss.count) ? `<div class="loss">
      <div class="loss-h">⚠️ 전환 실패/이탈 ${n(p.loss.count)}건${p.loss.dist ? ` <span class="muted">· ${esc(p.loss.dist)}</span>` : ''}</div>
      ${samp.map(s => `<div class="loss-item">${s.link ? `<a href="${s.link}" target="_blank">${esc(s.store)}</a>` : esc(s.store)} <span class="muted">— ${esc(s.reason)}</span></div>`).join('')}
    </div>` : '';
    return `<div class="part"><div class="part-h">${p.part}</div>${rows}${lossHtml}</div>`;
  }).join('');
  return `<div class="lever">
    <div class="lever-h"><b>${hq.hq}</b> <span class="muted">· 목표 ${n(hq.target)} · 잔여 갭 ${n(hq.gap)}대 · 필요 일 ${hq.requiredDaily}대 <span class="bad">(현재 ${hq.currentDaily}대)</span></span></div>
    ${hq.funnel ? `<div class="funnel-line">📊 ${hq.funnel}</div>` : ''}
    ${partsHtml}
  </div>`;
}).join('');

// 인바운드 방치 견적 — Task 요약 + 후속조치 (상세)
const stalledRich = (A.stalled?.inbound || []).map(o => {
  const tks = (o.tasks || []).slice(0, 5).map(t => `<div class="tk"><span class="tk-d">${t.date || ''}</span> <b>${esc(t.subject)}</b>${t.desc ? ` — ${esc(t.desc)}` : ''}</div>`).join('');
  return `<div class="stall">
    <div class="stall-h"><a href="${o.link}" target="_blank">${esc(o.store)}${o.branch ? ' ' + esc(o.branch) : ''}</a> <span class="muted">· ${o.stage} · <span class="bad">${o.daysSinceTask}일 방치</span> · 단계 ${o.stageAge}일 · 담당 ${o.field}</span></div>
    ${o.note ? `<div class="stall-sum">📋 ${esc(o.note.summary)}</div><div class="stall-next">▶ 후속조치: <b>${esc(o.note.next)}</b></div>` : ''}
    <details class="tk-wrap"><summary>Task 이력 ${(o.tasks || []).length}건 펼치기</summary>${tks}</details>
  </div>`;
}).join('');
// KANBAN 방치 견적 표 (인바운드/아웃바운드)
const stallTbl = (arr, limit) => `<table><thead><tr><th>매장</th><th>단계</th><th>방치</th><th>담당</th><th>최근 활동</th></tr></thead><tbody>${(arr || []).slice(0, limit).map(o => `<tr><td><a href="${o.link}" target="_blank">${esc(o.store)}${o.branch ? ' ' + esc(o.branch) : ''}</a></td><td>${o.stage}</td><td class="num ${o.daysSinceTask >= 14 ? 'r' : 'o'}">${o.daysSinceTask}일</td><td>${o.field}</td><td class="task">${o.tasks?.[0] ? `${esc(o.tasks[0].subject)}: ${esc((o.tasks[0].desc || '').slice(0, 45))}` : '-'}</td></tr>`).join('')}</tbody></table>`;

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
.lever{background:#0B1A30;border:1px solid #1A3052;border-radius:12px;padding:14px 16px;margin-bottom:12px}
.lever-h{font-size:14px;margin-bottom:8px}
.kpirow{display:flex;align-items:center;gap:8px;font-size:12.5px;padding:3px 0}
.kpi-sig{width:8px;height:8px;border-radius:4px;flex-shrink:0}.kpi-sig.g{background:#34D399}.kpi-sig.b{background:#F0556C}
.kpi-name{color:#C5D5E8;min-width:130px}.kpi-val{font-weight:700}.kpi-tgt{color:#7E96B5;font-size:11.5px}
.funnel-line{font-size:12px;color:#9FD0E8;background:#0A2030;border-radius:8px;padding:7px 10px;margin-bottom:10px;font-variant-numeric:tabular-nums}
.kpirow2{padding:6px 0;border-bottom:1px solid #112038}.kpirow2:last-of-type{border-bottom:0}
.kpi-top{display:flex;align-items:center;gap:8px;font-size:12.5px;flex-wrap:wrap}
.kpi-aff{margin-left:auto;font-size:10.5px;color:#7E96B5;background:#13243F;border-radius:5px;padding:1px 7px}
.kpi-act{font-size:11.5px;color:#A8BDD8;margin:3px 0 0 16px}
.lever-txt{font-size:12px;color:#CDE0F0;margin-top:10px;padding-top:9px;border-top:1px solid #1A3052;font-weight:500}
.part{background:#0D2138;border:1px solid #16304E;border-radius:10px;padding:11px 13px;margin:9px 0}
.part-h{font-size:13px;font-weight:700;color:#9FC4E8;margin-bottom:6px}
.loss{margin-top:8px;padding-top:7px;border-top:1px dashed #2A3F5C}
.loss-h{font-size:11.5px;color:#F0A0AC;margin-bottom:4px}
.loss-item{font-size:11.5px;color:#C5D5E8;padding:1px 0 1px 12px}
.loss-item a{color:#5FB0FF;text-decoration:none}
.stall{background:#0B1A30;border:1px solid #1A3052;border-radius:10px;padding:12px 14px;margin:9px 0}
.stall-h{font-size:13px;font-weight:600}.stall-h a{color:#5FB0FF;text-decoration:none}
.stall-sum{font-size:12px;color:#C5D5E8;margin-top:7px;background:#0E2236;border-radius:7px;padding:7px 9px}
.stall-next{font-size:12px;color:#9FE0C0;margin-top:6px}
.tk-wrap{margin-top:7px}.tk-wrap summary{font-size:11px;color:#7E96B5;cursor:pointer}
.tk{font-size:11px;color:#A8BDD8;padding:3px 0 3px 10px;border-left:2px solid #1A3052;margin-top:4px}
.tk-d{color:#6E86A5;font-variant-numeric:tabular-nums}
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
  <div class="legend">막대 = 현재 실적 / 흰 선 = 예상 CW(목표 대비). 현 페이스론 <b>전 세그먼트 목표 미달</b> — ${best.name} ${best.att}%가 상대 최선, ${worst.name} ${worst.att}% 최저.</div>
</section>

<section>
  <h2>② KPI 잘되는 부분 / 안되는 부분</h2>
  <div class="desc">CW 기준 진단.</div>
  <div class="two">
    <div class="col gd"><h3>상대적으로 나은 부분</h3><ul>
      <li><b>${best.name} ${best.att}% CW</b> — 4세그먼트 중 페이스 가장 앞섬(그래도 목표 미달)</li>
      <li><b>${bestCov.name} 파이프라인 ${n(bestCov.pipe)}대(커버 ${bestCov.cov}%)</b> — 잔여목표 대비 후보 충분, 전환만 되면 회복 여지</li>
      <li>마감(CW)건 리드타임 중앙값 ${Math.min(...segArr.map(s => s.lead))}~${Math.max(...segArr.map(s => s.lead))}일 — 닫히는 건은 빠르게 통과(생성→CW)</li>
    </ul></div>
    <div class="col bd"><h3>안되고 있음</h3><ul>
      <li><b>${worst.name} ${worst.att}% CW</b> — 페이스 최저, 절대량·전환 모두 부족</li>
      <li><b>인바운드 ${Math.round(A.segments.IBS.projected / A.segments.IBS.target * 100)}% CW</b> — 최대 목표(2,410)인데 미달, 갭 절대값 최대</li>
      <li><b>전사 ${overall}% CW 전망</b> — 이대로면 ${n(-t.gap)}대 미달. 잔여 영업일 ${A.bizTotal - A.bizElapsed}일 내 일일 페이스 대폭 상향 필요</li>
    </ul></div>
  </div>
</section>

<section>
  <h2>③ 파트별 KPI → 퍼널 레버 + 전환 실패 — 무엇을 끌어올려야 5,500에 닿나</h2>
  <div class="desc">본부 KPI 실값(6월 누적)을 <b>파트별</b>로. 신호등 <span class="good">●</span>달성/<span class="bad">●</span>미달. 각 파트의 <span class="bad">⚠️ 전환 실패/이탈건</span>은 실제 업체·사유까지 표기(클릭 시 Salesforce).</div>
  ${kpiSec}
  <div class="legend"><b>공통 병목</b>: 견적 단계 정체(CL의 70~86%가 견적 이탈)가 전 세그먼트 마감을 막음 — <b>KPI 개선 + 견적 후속 가속</b>이 5,500 달성의 두 축.</div>
  ${stalledRich ? `<div style="margin-top:16px"><div class="part-h" style="font-size:14px;margin-bottom:8px">📌 인바운드 BO — 견적 방치 계류건 (후속 끊김 · Task 요약·후속조치)</div>${stalledRich}<div class="legend">기준: FieldUser=인바운드 · 견적/재견적 · 영업중 · 후속과업 없음 · 7일+ 방치. 후속조치는 Task 이력 분석 스냅샷.</div></div>` : ''}
</section>

<section>
  <h2>④ 퍼널 개선 — 견적 단계가 생사를 가른다</h2>
  <div class="desc">단계별 체류기간 중앙값: 마감(CW) vs 현재 계류 vs 이탈(CL). 견적에서 갈립니다.</div>
  <table><thead><tr><th>단계</th><th>CW(마감) 통과</th><th>계류(현재) 정체</th><th>CL(이탈) 정체</th></tr></thead><tbody>${funnel}</tbody></table>
  <div class="legend">🟢 마감되는 건은 견적을 1~2일에 통과 · 🟠 지금 계류건은 견적에서 10~28일 정체 · 🔴 이탈건은 견적에서 평균 15일 묶이다 죽음(전체 CL의 70~86%가 견적 이탈). <b>→ 견적 단계 후속 속도(견적 N일+ 자동 에스컬레이션·재견적 차단)가 목표 달성의 최대 레버.</b></div>
</section>

<section>
  <h2>⑤ KANBAN — 지금 안 챙기면 새는 영업기회 <span class="muted" style="font-size:13px">(Task까지 확인)</span></h2>
  <div class="desc">마감 단계(견적·계약진행 등) · 태블릿 보유 · 최근 생성(좀비 제외) 중 정체+Task 방치 상위. 총 ${n(A.atRiskSummary.total)}건 · ${n(A.atRiskSummary.tabletsAtRisk)}대 위험 (Task 14일+ 방치 ${A.atRiskSummary.stale14}건).</div>
  <table><thead><tr><th>매장</th><th>세그먼트</th><th>단계</th><th>태블릿</th><th>단계경과</th><th>마지막 Task</th><th>최근 활동 내용</th></tr></thead><tbody>${risk}</tbody></table>
  <div class="legend">단계경과·Task 방치일이 클수록 CL 위험. 빨강 = 14일+ 방치. 견적 단계 고가치건의 즉시 재컨택이 CW율 방어의 핵심.</div>

  <div style="margin-top:18px"><div class="part-h" style="font-size:14px;margin-bottom:8px">🔻 견적 방치 (후속 끊김) — 상시 모니터링</div>
    <div class="desc">견적/재견적 · 영업중 · 후속과업 없음 · 7일+ 방치 (FieldUser 부서 기준 · TEST 제외). 빨강=14일+.</div>
    <div style="font-size:12.5px;font-weight:700;color:#3B82F6;margin:6px 0 4px">인바운드 ${n((A.stalled?.inbound || []).length)}건</div>
    ${stallTbl(A.stalled?.inbound, 15)}
    <div style="font-size:12.5px;font-weight:700;color:#A78BFA;margin:14px 0 4px">아웃바운드 ${n((A.stalled?.outbound || []).length)}건 <span class="muted" style="font-weight:400">(상위 15)</span></div>
    ${stallTbl(A.stalled?.outbound, 15)}
  </div>
</section>

<div class="foot">데이터: Salesforce · 실적=계약-CW(계약시작일) 기준 · 퍼널=단계변경 기준 · 생성 ${A.asOf} · 태블릿 페이스 파이프라인 연동</div>
</div></body></html>`;

fs.writeFileSync('reports/2026-06-pace-analysis.html', html);
console.log('생성: reports/2026-06-pace-analysis.html (' + html.length + ' bytes)');
