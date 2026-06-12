// 인바운드 견적 순회 — 카카오 지도 + 마커 클러스터링
// 좌표: data/opp-geocode.json 캐시 우선, 없으면 fm_Address__c 카카오 REST 지오코딩(캐시 갱신)
//   node scripts/analysis/inbound-quote-visit-map.js
require('dotenv').config();
const axios = require('axios'); axios.defaults.adapter = 'fetch';
const fs = require('fs');

const INBOUND_SOURCES = ['홈페이지', '전화', '카카오채널', '사장님 앱'];
const CHANNEL_SOURCES = ['파트너사 소개', '프랜차이즈소개']; // 채널세일즈 — 파트너사 인입·프랜차이즈 제휴
const STAGES = ['견적', '재견적'];
const VISIT_MIN = 3;   // 인바운드: 실제 방문 후 N일+ 경과
const CH_STAGE_MIN = 3; // 채널: 견적 단계 N일+ 체류
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
    .then(rs => rs.filter(o => !/TEST/i.test(o.Account?.Name || o.Name)));

  const ids = opps.map(o => o.Id);
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
  const cnt = { fromCache: 0, geocoded: 0, failed: 0, newCache: 0 };
  const coordOf = async (o) => {
    const c = cache[o.Id];
    if (c && c.lat && c.lng) { cnt.fromCache++; return { lat: c.lat, lng: c.lng }; }
    if (o.fm_Address__c?.trim()) {
      const g = await geocode(o.fm_Address__c.trim()); await sleep(60);
      if (g) { cnt.geocoded++; cache[o.Id] = { ...(cache[o.Id] || {}), lat: g.lat, lng: g.lng, addressName: o.fm_Address__c, account: o.Account?.Name }; cnt.newCache++; return g; }
    }
    cnt.failed++; return null;
  };
  const ptBase = (o, g) => ({
    lat: g.lat, lng: g.lng, store: o.Account?.Name || o.Name, addr: o.fm_Address__c || '', phone: o.Account?.Phone || '',
    tablets: o.TotalNumberofEveryTablet__c || 0, stage: o.StageName, stageAge: o.LastStageChangeInDays,
    status: storeOf(o.fm_CompanyStatus__c), field: o.FieldUser__r?.Name || '-', daysInStage: o.LastStageChangeInDays,
    link: `https://torder.lightning.force.com/lightning/r/Opportunity/${o.Id}/view`,
  });
  const pts = [];

  // ① 인바운드: 실제 방문 후 3일+ 경과
  for (const o of opps) {
    const v = lastVisit[o.Id] || null;
    const dsv = v ? Math.round((today - new Date(v.date + 'T00:00:00+09:00')) / 86400000) : null;
    if (!v || dsv < VISIT_MIN) continue;
    const g = await coordOf(o); if (!g) continue;
    pts.push({ category: '인바운드', channelType: null, ...ptBase(o, g), visit: v.date, visitStatus: v.status, daysSinceVisit: dsv });
  }

  // ② 채널(파트너사/프랜차이즈): 견적 단계 3일+ 체류
  const chSrc = CHANNEL_SOURCES.map(s => `'${s}'`).join(',');
  const chOpps = (await q(`
    SELECT Id, Name, Account.Name, fm_Address__c, fm_sido__c, fm_Sigugun__c, Account.Phone,
           TotalNumberofEveryTablet__c, StageName, LeadSource, fm_CompanyStatus__c,
           LastStageChangeInDays, AgeInDays, FieldUser__r.Name
    FROM Opportunity
    WHERE IsClosed=false AND CurrencyIsoCode='KRW'
      AND (RecordType.Name='1. 테이블오더 (신규)' OR RecordType.Name='3. 테이블오더 (추가설치)')
      AND StageName IN (${stgIn}) AND fm_CompanyStatus__c='영업중'
      AND LeadSource IN (${chSrc})`)).filter(o => !/TEST/i.test(o.Account?.Name || o.Name) && (o.LastStageChangeInDays ?? 0) >= CH_STAGE_MIN);
  for (const o of chOpps) {
    const g = await coordOf(o); if (!g) continue;
    pts.push({ category: '채널', channelType: o.LeadSource === '프랜차이즈소개' ? '프랜차이즈' : '파트너사', ...ptBase(o, g), visit: null, visitStatus: '', daysSinceVisit: null });
  }

  const metricOf = (p) => p.category === '채널' ? (p.daysInStage || 0) : (p.daysSinceVisit || 0);
  pts.sort((a, b) => metricOf(b) - metricOf(a));
  const fromCache = cnt.fromCache, geocoded = cnt.geocoded, failed = cnt.failed, newCache = cnt.newCache;
  if (newCache) { fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2)); }

  const inb = pts.filter(p => p.category === '인바운드'), chn = pts.filter(p => p.category === '채널');
  const cOper = pts.filter(p => p.status === '운영중').length, cPre = pts.filter(p => p.status === '오픈전').length;
  const avgDsv = inb.length ? Math.round(inb.reduce((s, p) => s + p.daysSinceVisit, 0) / inb.length) : 0;
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
  <h1>📍 견적 순회 지도</h1>
  <div class="sub">${today10} · <b>인바운드</b>(방문후 ${VISIT_MIN}일+) + <b>채널</b>(견적 ${CH_STAGE_MIN}일+ 체류·파트너사/프랜차이즈)</div>
  <div class="stat">
    <div class="s"><b>${n(pts.length)}</b>순회</div>
    <div class="s g"><b>${n(inb.length)}</b>인바운드</div>
    <div class="s" style="background:#2563EB"><b>${n(chn.length)}</b>채널</div>
    <div class="s a"><b>${avgDsv}</b>인바 평균방문경과(일)</div>
    <div class="s"><b>${n(totTab)}</b>태블릿</div>
  </div>
  <div class="leg"><span class="dot" style="background:#15803D"></span>인바운드 운영중 · <span class="dot" style="background:#F59E0B"></span>인바운드 오픈전 · <span class="dot" style="background:#2563EB"></span>채널 파트너사 · <span class="dot" style="background:#7C3AED"></span>채널 프랜차이즈<br>마커 클릭 = 상세 · 묶음 클릭 = 확대</div>
</div>
<script>const PTS=${JSON.stringify(pts)};</script>
<script src="//dapi.kakao.com/v2/maps/sdk.js?appkey=${MAP_KEY}&libraries=clusterer&autoload=false"></script>
<script>
kakao.maps.load(function(){
  var map=new kakao.maps.Map(document.getElementById('map'),{center:new kakao.maps.LatLng(36.5,127.8),level:13});
  function pin(p){
    var fill=p.category==='채널'?(p.channelType==='프랜차이즈'?'#7C3AED':'#2563EB'):(p.status==='운영중'?'#15803D':(p.status==='오픈전'?'#F59E0B':'#64748B'));
    var svg='<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 26 34">'
      +'<path d="M13 0C6 0 .5 5.4 .5 12.2.5 21 13 34 13 34s12.5-13 12.5-21.8C25.5 5.4 20 0 13 0z" fill="'+fill+'" stroke="#ffffff" stroke-width="1.5"/>'
      +'<circle cx="13" cy="12" r="4.5" fill="#fff"/></svg>';
    return new kakao.maps.MarkerImage('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),new kakao.maps.Size(26,34),{offset:new kakao.maps.Point(13,34)});
  }
  var bounds=new kakao.maps.LatLngBounds(), markers=[], iw=new kakao.maps.InfoWindow({removable:true});
  PTS.forEach(function(p){
    var pos=new kakao.maps.LatLng(p.lat,p.lng); bounds.extend(pos);
    var mk=new kakao.maps.Marker({position:pos,image:pin(p),title:p.store});
    kakao.maps.event.addListener(mk,'click',function(){
      var sb=p.status==='운영중'?'<span class="badge oper">운영중</span>':(p.status==='오픈전'?'<span class="badge pre">오픈전</span>':'');
      var html='<div class="iw"><b>'+p.store+'</b>'+sb
        +'<div class="row">'+p.stage+(p.stageAge!=null?' · 단계 '+p.stageAge+'일':'')+' · '+(p.tablets||0)+'대 · 담당 '+p.field+'</div>'
        +'<div class="row">📍 '+(p.addr||'-')+(p.phone?'<br>☎ '+p.phone:'')+'</div>'
        +(p.category==='채널'?'<div class="row fire">📋 견적 '+p.daysInStage+'일 체류 · '+p.channelType+'</div>':'<div class="row fire">🚶 방문 '+p.daysSinceVisit+'일 경과 ('+p.visit+(p.visitStatus?' · '+p.visitStatus:'')+')</div>')
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

  // 대시보드(Next.js)용 데이터셋 — web/public 에서 정적 서빙
  const dataset = {
    generatedAt: new Date().toISOString(), asOf: today10,
    criteria: { sources: INBOUND_SOURCES, stages: STAGES, visitMinDays: VISIT_MIN },
    stats: { total: pts.length, inbound: inb.length, channel: chn.length, partner: chn.filter(p => p.channelType === '파트너사').length, franchise: chn.filter(p => p.channelType === '프랜차이즈').length, oper: cOper, pre: cPre, avgDaysSinceVisit: avgDsv, tablets: totTab, failedGeocode: failed },
    points: pts,
  };
  try { fs.mkdirSync('web/public', { recursive: true }); fs.writeFileSync('web/public/inbound-quote-round.json', JSON.stringify(dataset)); console.log('대시보드 데이터: web/public/inbound-quote-round.json'); } catch (e) { console.log('  ⚠️ 대시보드 데이터 쓰기 실패:', e.message); }

  console.log(`지도 마커: ${pts.length}곳 (캐시 ${fromCache} · 신규지오코딩 ${geocoded} · 실패 ${failed})`);
  console.log(`인바운드 ${inb.length}(방문${VISIT_MIN}일+) · 채널 ${chn.length}(견적${CH_STAGE_MIN}일+: 파트너사 ${chn.filter(p => p.channelType === '파트너사').length}·프랜차이즈 ${chn.filter(p => p.channelType === '프랜차이즈').length}) · 태블릿 ${n(totTab)}`);
  console.log(`생성: ${out} (${html.length} bytes)`);
})().catch(e => { console.error('ERR', e.response?.data || e.message); process.exit(1); });
