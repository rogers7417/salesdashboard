// 인바운드 견적 순회 — 카카오 지도 + 마커 클러스터링
// 좌표: data/opp-geocode.json 캐시 우선, 없으면 fm_Address__c 카카오 REST 지오코딩(캐시 갱신)
//   node scripts/analysis/inbound-quote-visit-map.js
require('dotenv').config();
const axios = require('axios'); axios.defaults.adapter = 'fetch';
const fs = require('fs');

const INBOUND_SOURCES = ['홈페이지', '전화', '카카오채널', '사장님 앱'];
const STAGES = ['견적', '재견적'];
const MAX_AGE = 60;
const STALE_DAYS = 4;
const MAP_KEY = process.env.KAKAO_MAP_KEY;
const REST_KEY = process.env.KAKAO_REST_KEY || process.env.KAKAO_REST_API_KEY;
const CACHE = 'data/opp-geocode.json';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
const n = (x) => Math.round(x || 0).toLocaleString('ko-KR');
const storeOf = (s) => s === '영업중' ? '운영중' : (/오픈전/.test(s || '') ? '오픈전' : '미입력');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!MAP_KEY) throw new Error('KAKAO_MAP_KEY 없음 (.env)');
  if (!REST_KEY) throw new Error('KAKAO_REST_KEY 없음 (.env)');
  const pr = new URLSearchParams();
  pr.append('grant_type', 'password'); pr.append('client_id', process.env.SF_CLIENT_ID); pr.append('client_secret', process.env.SF_CLIENT_SECRET);
  pr.append('username', process.env.SF_USERNAME); pr.append('password', decodeURIComponent(process.env.SF_PASSWORD));
  const tkn = (await axios.post(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, pr)).data;
  const inst = tkn.instance_url, tok = tkn.access_token;
  const q = async (s) => { let all = []; let r = (await axios.get(`${inst}/services/data/v59.0/query`, { headers: { Authorization: `Bearer ${tok}` }, params: { q: s.replace(/\s+/g, ' ').trim() } })).data; all.push(...r.records); while (r.nextRecordsUrl) { r = (await axios.get(`${inst}${r.nextRecordsUrl}`, { headers: { Authorization: `Bearer ${tok}` } })).data; all.push(...r.records); } return all; };

  const srcIn = INBOUND_SOURCES.map(s => `'${s}'`).join(',');
  const stgIn = STAGES.map(s => `'${s}'`).join(',');
  const opps = await q(`
    SELECT Id, Name, Account.Name, fm_Address__c, fm_sido__c, fm_Sigugun__c, Account.Phone,
           TotalNumberofEveryTablet__c, StageName, LeadSource, fm_CompanyStatus__c,
           LastStageChangeInDays, AgeInDays, FieldUser__r.Name
    FROM Opportunity
    WHERE IsClosed=false AND CurrencyIsoCode='KRW'
      AND (RecordType.Name='1. 테이블오더 (신규)' OR RecordType.Name='3. 테이블오더 (추가설치)')
      AND StageName IN (${stgIn}) AND LeadSource IN (${srcIn})`)
    .then(rs => rs.filter(o => !/TEST/i.test(o.Account?.Name || o.Name)).filter(o => (o.AgeInDays ?? 999) <= MAX_AGE));

  const ids = opps.map(o => o.Id);
  // Task: 오픈 과업 + 마지막 활동
  const lastTask = {}, openCnt = {};
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200).map(x => `'${x}'`).join(',');
    const tasks = await q(`SELECT WhatId, Status, Subject, ActivityDate, CreatedDate FROM Task WHERE WhatId IN (${chunk}) ORDER BY ActivityDate DESC NULLS LAST, CreatedDate DESC`);
    tasks.forEach(t => { if (!lastTask[t.WhatId]) lastTask[t.WhatId] = { subject: t.Subject, date: t.ActivityDate || (t.CreatedDate || '').slice(0, 10) }; if (t.Status !== 'Completed' && t.Status !== 'Closed') openCnt[t.WhatId] = (openCnt[t.WhatId] || 0) + 1; });
  }
  // 실제 방문일
  const lastVisit = {};
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200).map(x => `'${x}'`).join(',');
    const vs = await q(`SELECT Opportunity__c, ConselStart__c, Visit_Status__c FROM Visit__c WHERE Opportunity__c IN (${chunk}) ORDER BY ConselStart__c DESC NULLS LAST`);
    vs.forEach(v => { const cs = (v.ConselStart__c || '').slice(0, 10); if (cs && (!lastVisit[v.Opportunity__c] || cs > lastVisit[v.Opportunity__c].date)) lastVisit[v.Opportunity__c] = { date: cs, status: v.Visit_Status__c || '' }; });
  }

  // 좌표: 캐시 우선, 없으면 REST 지오코딩
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { }
  const geocode = async (addr) => {
    try { const r = await axios.get('https://dapi.kakao.com/v2/local/search/address.json', { params: { query: addr }, headers: { Authorization: 'KakaoAK ' + REST_KEY } }); const d = r.data.documents?.[0]; return d ? { lat: +d.y, lng: +d.x } : null; }
    catch { return null; }
  };
  const today10 = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const today = new Date(today10 + 'T00:00:00+09:00');
  let fromCache = 0, geocoded = 0, failed = 0, newCache = 0;
  const pts = [];
  for (const o of opps) {
    let lat = null, lng = null;
    const c = cache[o.Id];
    if (c && c.lat && c.lng) { lat = c.lat; lng = c.lng; fromCache++; }
    else if (o.fm_Address__c?.trim()) {
      const g = await geocode(o.fm_Address__c.trim());
      await sleep(60);
      if (g) { lat = g.lat; lng = g.lng; geocoded++; cache[o.Id] = { ...(cache[o.Id] || {}), lat: g.lat, lng: g.lng, addressName: o.fm_Address__c, account: o.Account?.Name }; newCache++; }
      else { failed++; continue; }
    } else { failed++; continue; }

    const last = lastTask[o.Id] || null;
    const dsl = last?.date ? Math.round((today - new Date(last.date + 'T00:00:00+09:00')) / 86400000) : null;
    const noOpen = !openCnt[o.Id]; const stale = dsl != null && dsl >= STALE_DAYS; const absent = /부재|미응답|연락안/.test(last?.subject || '');
    const v = lastVisit[o.Id] || null;
    const reasons = [noOpen ? '오픈과업 없음' : null, stale ? `마지막 Task ${dsl}일 경과` : null, absent ? '부재중' : null].filter(Boolean);
    pts.push({
      lat, lng, store: o.Account?.Name || o.Name, addr: o.fm_Address__c || '', phone: o.Account?.Phone || '',
      tablets: o.TotalNumberofEveryTablet__c || 0, stage: o.StageName, stageAge: o.LastStageChangeInDays,
      status: storeOf(o.fm_CompanyStatus__c), field: o.FieldUser__r?.Name || '-', visit: v ? v.date : null, visitStatus: v ? v.status : '',
      priority: noOpen || stale || absent, reasons, link: `https://torder.lightning.force.com/lightning/r/Opportunity/${o.Id}/view`,
    });
  }
  if (newCache) { fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2)); }

  const cOper = pts.filter(p => p.status === '운영중').length, cPre = pts.filter(p => p.status === '오픈전').length, cPri = pts.filter(p => p.priority).length;
  const totTab = pts.reduce((s, p) => s + p.tablets, 0);

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>인바운드 견적 순회 지도 · ${today10}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;font-family:'Pretendard',-apple-system,'Apple SD Gothic Neo','Segoe UI',sans-serif}
#map{width:100%;height:100%}
.panel{position:absolute;top:14px;left:14px;z-index:5;background:rgba(255,255,255,.96);border:1px solid #E0E6EF;border-radius:12px;padding:14px 16px;box-shadow:0 4px 16px rgba(0,0,0,.12);max-width:300px}
.panel h1{font-size:16px;font-weight:800;color:#1B2A3D}
.panel .sub{font-size:11px;color:#5C7088;margin-top:4px;line-height:1.5}
.stat{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.stat .s{background:#1E40AF;color:#fff;border-radius:7px;padding:6px 10px;font-size:11px;font-weight:600}
.stat .s b{font-size:15px;display:block;font-weight:800}
.stat .s.r{background:#B91C1C}.stat .s.g{background:#15803D}.stat .s.a{background:#B45309}
.leg{margin-top:10px;font-size:11px;color:#33485F;line-height:1.7}
.dot{display:inline-block;width:10px;height:10px;border-radius:5px;vertical-align:middle;margin-right:3px}
.iw{padding:10px 12px;font-size:12px;line-height:1.5;min-width:190px;max-width:260px}
.iw b{font-size:13px}
.iw .badge{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;margin-left:4px}
.iw .oper{background:#DCFCE7;color:#15803D}.iw .pre{background:#FEF3C7;color:#B45309}
.iw .fire{color:#B91C1C;font-weight:700}
.iw .row{color:#5C7088;margin-top:3px}
.iw a{color:#2563EB;text-decoration:none;font-weight:600}
</style></head><body>
<div id="map"></div>
<div class="panel">
  <h1>📍 인바운드 견적 순회 지도</h1>
  <div class="sub">${today10} · ${INBOUND_SOURCES.join('·')} · 견적/재견적 · 최근 ${MAX_AGE}일 · 운영중+오픈전</div>
  <div class="stat">
    <div class="s"><b>${n(pts.length)}</b>순회</div>
    <div class="s r"><b>${n(cPri)}</b>🔥돌방</div>
    <div class="s g"><b>${n(cOper)}</b>운영중</div>
    <div class="s a"><b>${n(cPre)}</b>오픈전</div>
    <div class="s"><b>${n(totTab)}</b>태블릿</div>
  </div>
  <div class="leg"><span class="dot" style="background:#15803D"></span>운영중 · <span class="dot" style="background:#F59E0B"></span>오픈전 · <span class="dot" style="background:#B91C1C"></span>🔥돌방우선(외곽 빨강)<br>마커 클릭 = 상세 · 묶음 클릭 = 확대</div>
</div>
<script>const PTS=${JSON.stringify(pts)};</script>
<script src="//dapi.kakao.com/v2/maps/sdk.js?appkey=${MAP_KEY}&libraries=clusterer&autoload=false"></script>
<script>
kakao.maps.load(function(){
  var map=new kakao.maps.Map(document.getElementById('map'),{center:new kakao.maps.LatLng(36.5,127.8),level:13});
  function pin(p){
    var fill=p.status==='운영중'?'#15803D':(p.status==='오픈전'?'#F59E0B':'#64748B');
    var ring=p.priority?'#B91C1C':'#ffffff';
    var svg='<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 26 34">'
      +'<path d="M13 0C6 0 .5 5.4 .5 12.2.5 21 13 34 13 34s12.5-13 12.5-21.8C25.5 5.4 20 0 13 0z" fill="'+fill+'" stroke="'+ring+'" stroke-width="'+(p.priority?3:1.5)+'"/>'
      +'<circle cx="13" cy="12" r="4.5" fill="#fff"/></svg>';
    return new kakao.maps.MarkerImage('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),new kakao.maps.Size(26,34),{offset:new kakao.maps.Point(13,34)});
  }
  var bounds=new kakao.maps.LatLngBounds(), markers=[], iw=new kakao.maps.InfoWindow({removable:true});
  PTS.forEach(function(p){
    var pos=new kakao.maps.LatLng(p.lat,p.lng); bounds.extend(pos);
    var mk=new kakao.maps.Marker({position:pos,image:pin(p),title:p.store});
    kakao.maps.event.addListener(mk,'click',function(){
      var sb=p.status==='운영중'?'<span class="badge oper">운영중</span>':(p.status==='오픈전'?'<span class="badge pre">오픈전</span>':'');
      var html='<div class="iw"><b>'+(p.priority?'🔥 ':'')+p.store+'</b>'+sb
        +'<div class="row">'+p.stage+(p.stageAge!=null?' · 단계 '+p.stageAge+'일':'')+' · '+(p.tablets||0)+'대 · 담당 '+p.field+'</div>'
        +'<div class="row">📍 '+(p.addr||'-')+(p.phone?'<br>☎ '+p.phone:'')+'</div>'
        +'<div class="row">🚶 실제 방문일: '+(p.visit?p.visit+(p.visitStatus?' ('+p.visitStatus+')':''):'기록 없음')+'</div>'
        +(p.reasons&&p.reasons.length?'<div class="row fire">▶ '+p.reasons.join(' · ')+'</div>':'')
        +'<div class="row"><a href="'+p.link+'" target="_blank">Salesforce 열기 ›</a></div></div>';
      iw.setContent(html); iw.open(map,mk);
    });
    markers.push(mk);
  });
  var clusterer=new kakao.maps.MarkerClusterer({map:map,averageCenter:true,minLevel:6,gridSize:70,markers:markers});
  if(PTS.length) map.setBounds(bounds);
});
</script>
</body></html>`;

  const out = `reports/inbound-quote-visit-map-${today10}.html`;
  fs.writeFileSync(out, html);
  console.log(`지도 마커: ${pts.length}곳 (캐시 ${fromCache} · 신규지오코딩 ${geocoded} · 실패 ${failed})`);
  console.log(`돌방우선 ${cPri} · 운영중 ${cOper} · 오픈전 ${cPre} · 태블릿 ${n(totTab)}`);
  console.log(`생성: ${out} (${html.length} bytes)`);
})().catch(e => { console.error('ERR', e.response?.data || e.message); process.exit(1); });
