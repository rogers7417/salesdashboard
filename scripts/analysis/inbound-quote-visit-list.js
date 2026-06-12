// 인바운드 견적 순회 리스트 (주간) — LeadSource 인바운드 + 견적/재견적 + 영업중, 좀비 제외
// 지역(시도→시군구)별 그룹, 인쇄 친화 HTML. 매주 실행.
//   node scripts/analysis/inbound-quote-visit-list.js
require('dotenv').config();
const axios = require('axios'); axios.defaults.adapter = 'fetch';
const fs = require('fs');

const INBOUND_SOURCES = ['홈페이지', '전화', '카카오채널', '사장님 앱']; // 직접 인입(아웃바운드·파트너/프랜차이즈 제외)
const STAGES = ['견적', '재견적'];
const MAX_AGE = 90; // 좀비(2024-08 이관 잔재 등) 제외 — 담당 배정된 살아있는 건만
const LIGHT = '/lightning/r/Opportunity/';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (x) => Math.round(x || 0).toLocaleString('ko-KR');

(async () => {
  const pr = new URLSearchParams();
  pr.append('grant_type', 'password'); pr.append('client_id', process.env.SF_CLIENT_ID); pr.append('client_secret', process.env.SF_CLIENT_SECRET);
  pr.append('username', process.env.SF_USERNAME); pr.append('password', decodeURIComponent(process.env.SF_PASSWORD));
  const tk = (await axios.post(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, pr)).data;
  const inst = tk.instance_url, tok = tk.access_token;
  const q = async (s) => { let all = []; let r = (await axios.get(`${inst}/services/data/v59.0/query`, { headers: { Authorization: `Bearer ${tok}` }, params: { q: s.replace(/\s+/g, ' ').trim() } })).data; all.push(...r.records); while (r.nextRecordsUrl) { r = (await axios.get(`${inst}${r.nextRecordsUrl}`, { headers: { Authorization: `Bearer ${tok}` } })).data; all.push(...r.records); } return all; };

  const srcIn = INBOUND_SOURCES.map(s => `'${s}'`).join(',');
  const stgIn = STAGES.map(s => `'${s}'`).join(',');
  const opps = await q(`
    SELECT Id, Name, Account.Name, fm_Address__c, fm_sido__c, fm_Sigugun__c, Account.Phone,
           TotalNumberofEveryTablet__c, StageName, LeadSource, LastStageChangeInDays, AgeInDays,
           FieldUser__r.Name, BOUser__r.Name, Owner.Name
    FROM Opportunity
    WHERE IsClosed=false AND CurrencyIsoCode='KRW'
      AND (RecordType.Name='1. 테이블오더 (신규)' OR RecordType.Name='3. 테이블오더 (추가설치)')
      AND StageName IN (${stgIn}) AND fm_CompanyStatus__c='영업중'
      AND LeadSource IN (${srcIn})`);

  // 마지막 Task (최근 활동) 조회
  const ids = opps.map(o => o.Id);
  const lastTask = {};
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200).map(x => `'${x}'`).join(',');
    const tasks = await q(`SELECT WhatId, Subject, ActivityDate, CreatedDate FROM Task WHERE WhatId IN (${chunk}) ORDER BY ActivityDate DESC NULLS LAST, CreatedDate DESC`);
    tasks.forEach(t => { if (!lastTask[t.WhatId]) lastTask[t.WhatId] = { subject: t.Subject, date: t.ActivityDate || (t.CreatedDate || '').slice(0, 10) }; });
  }

  const rows = opps
    .filter(o => !/TEST/i.test(o.Account?.Name || o.Name))
    .filter(o => (o.AgeInDays ?? 999) <= MAX_AGE) // 좀비 제외
    .map(o => ({
      store: o.Account?.Name || o.Name, addr: o.fm_Address__c || '', sido: o.fm_sido__c || '(미입력)', sigungun: o.fm_Sigugun__c || '',
      phone: o.Account?.Phone || '', tablets: o.TotalNumberofEveryTablet__c || 0, stage: o.StageName, source: o.LeadSource,
      stageAge: o.LastStageChangeInDays, age: o.AgeInDays, field: o.FieldUser__r?.Name || '-', bo: o.BOUser__r?.Name || '-',
      last: lastTask[o.Id] || null, link: `https://torder.lightning.force.com${LIGHT}${o.Id}/view`,
    }));

  // 시도 → 시군구 그룹
  const byRegion = {};
  rows.forEach(r => { (byRegion[r.sido] = byRegion[r.sido] || []).push(r); });
  const SIDO_ORDER = ['서울특별시', '경기도', '인천광역시', '부산광역시', '대구광역시', '울산광역시', '경상남도', '경상북도', '대전광역시', '충청남도', '충청북도', '세종특별자치시', '광주광역시', '전라남도', '전북특별자치도', '강원특별자치도', '제주특별자치도'];
  const sidos = Object.keys(byRegion).sort((a, b) => { const ia = SIDO_ORDER.indexOf(a), ib = SIDO_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
  sidos.forEach(s => byRegion[s].sort((a, b) => (a.sigungun || '').localeCompare(b.sigungun || '', 'ko') || (b.stageAge || 0) - (a.stageAge || 0)));

  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const totTab = rows.reduce((s, r) => s + r.tablets, 0);
  const regionChips = sidos.map(s => `<span class="chip"><b>${esc(s)}</b> ${byRegion[s].length}</span>`).join('');

  const regionSections = sidos.map(s => {
    const list = byRegion[s];
    const tab = list.reduce((a, r) => a + r.tablets, 0);
    const trs = list.map(r => `<tr>
      <td class="chk">☐</td>
      <td class="store">${esc(r.store)}<div class="src">${esc(r.source)} · ${esc(r.stage)}${r.stageAge != null ? ` · 단계 ${r.stageAge}일` : ''}</div></td>
      <td class="addr">${esc(r.addr)}${r.phone ? `<div class="ph">☎ ${esc(r.phone)}</div>` : ''}</td>
      <td class="num">${r.tablets ? r.tablets + '대' : '-'}</td>
      <td>${esc(r.field)}</td>
      <td class="task">${r.last ? `${esc(r.last.subject || '')}<div class="td">${r.last.date || ''}</div>` : '<span class="muted">활동 없음</span>'}</td>
      <td class="lk"><a href="${r.link}" target="_blank">열기</a></td>
    </tr>`).join('');
    return `<section class="region"><h2>${esc(s)} <span class="rc">${list.length}건 · ${n(tab)}대</span></h2>
      <table><thead><tr><th></th><th>매장 (출처·단계)</th><th>주소 / 연락처</th><th class="num">태블릿</th><th>담당</th><th>최근 활동</th><th></th></tr></thead><tbody>${trs}</tbody></table></section>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>인바운드 견적 순회 리스트 · ${today}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Pretendard',-apple-system,'Apple SD Gothic Neo','Segoe UI',sans-serif;background:#F4F6FA;color:#1B2A3D;line-height:1.45;padding:24px}
.wrap{max-width:1100px;margin:0 auto}
.head{margin-bottom:16px}
.head h1{font-size:24px;font-weight:800}
.head .sub{color:#5C7088;font-size:13px;margin-top:6px}
.kpis{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
.kpi{background:#1E40AF;color:#fff;border-radius:8px;padding:12px 16px;min-width:120px}
.kpi .l{font-size:11.5px;opacity:.85;font-weight:600}
.kpi .v{font-size:26px;font-weight:800;line-height:1.1}
.kpi.g{background:#15803D}.kpi.a{background:#B45309}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px}
.chip{background:#E5EBF3;border-radius:14px;padding:4px 11px;font-size:12px;color:#33485F}
.chip b{color:#1B2A3D}
.region{background:#fff;border:1px solid #E0E6EF;border-radius:12px;padding:16px 18px;margin-bottom:14px;break-inside:avoid}
.region h2{font-size:16px;font-weight:800;color:#1E40AF;margin-bottom:10px;border-bottom:2px solid #EEF2F8;padding-bottom:7px}
.region h2 .rc{font-size:12px;font-weight:600;color:#5C7088;margin-left:6px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;color:#7286A0;font-weight:600;font-size:11px;padding:5px 7px;border-bottom:1px solid #E0E6EF}
td{padding:8px 7px;border-bottom:1px solid #F0F3F8;vertical-align:top}
.chk{font-size:16px;color:#9DB0C6;width:22px}
.store{font-weight:700;min-width:130px}
.src{font-size:10.5px;color:#8294A8;font-weight:400;margin-top:2px}
.addr{color:#33485F;min-width:200px}
.ph{font-size:11px;color:#5C7088;margin-top:2px}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:700}
.task{font-size:11.5px;color:#5C7088;max-width:180px}
.td{font-size:10.5px;color:#9DB0C6}
.muted{color:#A6B4C6}
.lk a{color:#2563EB;text-decoration:none;font-size:12px}
.foot{text-align:center;color:#9DB0C6;font-size:11px;margin-top:16px}
@media print{body{background:#fff;padding:0}.kpi{-webkit-print-color-adjust:exact;print-color-adjust:exact}.region{border-color:#ccc}}
</style></head><body><div class="wrap">
  <div class="head">
    <h1>📍 인바운드 견적 순회 리스트</h1>
    <div class="sub">기준일 ${today} · LeadSource: ${INBOUND_SOURCES.join('·')} · 단계: ${STAGES.join('/')} · 영업중 · 최근 ${MAX_AGE}일(좀비 제외) · 국내(KRW)</div>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="l">순회 대상</div><div class="v">${n(rows.length)}곳</div></div>
    <div class="kpi g"><div class="l">총 태블릿</div><div class="v">${n(totTab)}대</div></div>
    <div class="kpi a"><div class="l">지역(시도)</div><div class="v">${sidos.length}개</div></div>
  </div>
  <div class="chips">${regionChips}</div>
  ${regionSections}
  <div class="foot">데이터: Salesforce · 인바운드 견적 순회용 · 생성 ${today} · ☐ 체크박스는 순회 완료 표시용</div>
</div></body></html>`;

  const out = `reports/inbound-quote-visit-${today}.html`;
  fs.writeFileSync(out, html);
  console.log(`인바운드 견적 순회 대상: ${rows.length}곳 / ${n(totTab)}대 / ${sidos.length}개 시도`);
  console.log('지역별:', sidos.map(s => `${s} ${byRegion[s].length}`).join(' · '));
  console.log(`생성: ${out} (${html.length} bytes)`);
})().catch(e => { console.error('ERR', e.response?.data || e.message); process.exit(1); });
