/**
 * 파트너 라운드 데이터셋 빌드
 * - Account (RecordType=Partner) 1084건
 * - 최근 미팅(Event WhatId 기반) 3개월
 * - 시그널: 정체 / 잠재 / 활성 / 다매장
 * - data/partner-tracking.json
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const axios = require('axios');

const OUT_PATH = path.join(__dirname, '../../data/partner-tracking.json');
const GEOCODE_PATH = path.join(__dirname, '../../data/partner-geocode.json');
const SF_BASE = 'https://torder.lightning.force.com/lightning/r/Account';
const KAKAO_KEY = process.env.KAKAO_REST_KEY || process.env.KAKAO_REST_API_KEY;
const THROTTLE_MS = 250;

const STUCK_DAYS = 60;       // 활동(미팅+Lead) 60일+ 없음
const LATENT_DAYS = 90;      // 신규 등록 90일 이내 + 활동 0
const ACTIVE_WINDOW = 90;    // 최근 90일 활동
const MULTI_STORE_TH = 5;    // 5매장+
const LEAD_TOP = 10;         // 90일 Lead 10+ = Top
const LEAD_MID = 3;          // 3~9 = Mid (1~2 = Low, 0 = Zero)

const utcToKstDate = utc => utc ? new Date(new Date(utc).getTime() + 9 * 3600000).toISOString().slice(0, 10) : null;
const daysBetween = (a, b) => (a && b) ? Math.round((new Date(b) - new Date(a)) / 86400000) : null;
const cleanStr = s => { if (s == null) return null; const t = String(s).trim(); return (t && t !== 'null') ? t : null; };

async function geocode(addr) {
  if (!KAKAO_KEY) return null;
  try {
    const r = await axios.get('https://dapi.kakao.com/v2/local/search/address.json', {
      params: { query: addr },
      headers: { Authorization: 'KakaoAK ' + KAKAO_KEY },
      timeout: 10000,
    });
    const d = r.data.documents?.[0];
    if (!d) return null;
    return { lat: parseFloat(d.y), lng: parseFloat(d.x), addressName: d.address_name };
  } catch (e) {
    return null;
  }
}

async function sfAuth() {
  if (process.env.SF_ACCESS_TOKEN && process.env.SF_INSTANCE_URL) {
    return { token: process.env.SF_ACCESS_TOKEN, url: process.env.SF_INSTANCE_URL };
  }
  const r = await axios.post(process.env.SF_LOGIN_URL + '/services/oauth2/token', new URLSearchParams({
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

(async () => {
  const t0 = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  console.log('1) SF 인증');
  const sf = await sfAuth();

  console.log('2) 파트너 계정 전수 조회');
  const partners = await soql(sf, `
    SELECT Id, Name, Phone, PartnerPhone__c, PartnerAddress__c,
           CRNAddress__c, CRNBasicAddress__c, CRNDetailAddress__c,
           RoadAddress__c, JibunAddress__c, LeadAddress__c,
           PartnerType__c, PartnerOrder__c, PartnerPOS__c, PartnerTorderStoreQty__c,
           ChannelProgramName, ChannelProgramLevelName, BaseCenterOrPartner__c,
           HQ_Partner__c, AccountPartner__c,
           OwnerId, Owner.Name, Owner.Department,
           CreatedDate, LastActivityDate
    FROM Account
    WHERE RecordType.DeveloperName = 'Partner'
  `.replace(/\s+/g, ' '));
  console.log(`   ${partners.length}건`);

  console.log('3) 최근 미팅 Event 조회 (3개월)');
  const events = await soql(sf, `
    SELECT Id, Subject, WhatId, ActivityDate, StartDateTime, EndDateTime, OwnerId, Owner.Name
    FROM Event
    WHERE WhatId IN (SELECT Id FROM Account WHERE RecordType.DeveloperName='Partner')
      AND ActivityDate >= 2026-03-01
    ORDER BY ActivityDate DESC
  `.replace(/\s+/g, ' '));
  console.log(`   ${events.length}건`);

  console.log('3b) 최근 Lead 조회 (3개월)');
  const leads = await soql(sf, `
    SELECT Id, PartnerName__c, CreatedDate, LeadSource, Status
    FROM Lead
    WHERE PartnerName__c != null AND CreatedDate >= 2026-03-01T00:00:00Z
  `.replace(/\s+/g, ' '));
  console.log(`   ${leads.length}건`);

  const leadsByPartner = {};
  for (const l of leads) {
    if (!leadsByPartner[l.PartnerName__c]) leadsByPartner[l.PartnerName__c] = [];
    leadsByPartner[l.PartnerName__c].push({
      id: l.Id,
      createdAt: utcToKstDate(l.CreatedDate),
      leadSource: l.LeadSource,
      status: l.Status,
    });
  }

  console.log('4) 파트너별 미팅 집계');
  const meetingsByAcc = {};
  for (const e of events) {
    if (!meetingsByAcc[e.WhatId]) meetingsByAcc[e.WhatId] = [];
    meetingsByAcc[e.WhatId].push({
      id: e.Id,
      subject: e.Subject || '',
      date: e.ActivityDate,
      owner: e.Owner?.Name,
    });
  }

  // 주소 폴백 — Partner → CRN(사업자등록증) → 도로명 → 지번 → Lead
  const pickAddress = a => cleanStr(a.PartnerAddress__c)
    || cleanStr(a.CRNAddress__c)
    || cleanStr(a.CRNBasicAddress__c)
    || cleanStr(a.RoadAddress__c)
    || cleanStr(a.JibunAddress__c)
    || cleanStr(a.LeadAddress__c)
    || null;

  console.log('5) 지오코딩 (신규만, 캐시 히트 스킵)');
  let geocodeCache = {};
  if (fs.existsSync(GEOCODE_PATH)) {
    geocodeCache = JSON.parse(fs.readFileSync(GEOCODE_PATH, 'utf8'));
  }
  let geocoded = 0, geoCached = 0, geoFailed = 0;
  for (const a of partners) {
    const addr = pickAddress(a);
    if (!addr) continue;
    if (geocodeCache[a.Id]?.lat) { geoCached++; continue; }
    if (geocodeCache[a.Id]?.failed) { geoFailed++; continue; }
    const g = await geocode(addr);
    if (g) { geocodeCache[a.Id] = { ...g, addr, geocodedAt: today }; geocoded++; }
    else { geocodeCache[a.Id] = { failed: true, addr, geocodedAt: today }; geoFailed++; }
    await new Promise(r => setTimeout(r, THROTTLE_MS));
  }
  fs.writeFileSync(GEOCODE_PATH, JSON.stringify(geocodeCache, null, 1), 'utf8');
  console.log(`   ${geocoded} 신규 / ${geoCached} 캐시 / ${geoFailed} 실패`);

  console.log('6) 시그널 + 산출 등급 계산');
  const records = partners.map(a => {
    const meetings = meetingsByAcc[a.Id] || [];
    meetings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const lastMeetingDate = meetings[0]?.date || null;
    const daysSinceLastMeeting = lastMeetingDate ? daysBetween(lastMeetingDate, today) : null;
    const meetingCount90d = meetings.filter(m => m.date && daysBetween(m.date, today) <= ACTIVE_WINDOW).length;

    // Lead 집계
    const partnerLeads = leadsByPartner[a.Id] || [];
    partnerLeads.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const lastLeadDate = partnerLeads[0]?.createdAt || null;
    const daysSinceLastLead = lastLeadDate ? daysBetween(lastLeadDate, today) : null;
    const leadCount90d = partnerLeads.filter(l => l.createdAt && daysBetween(l.createdAt, today) <= 90).length;
    const leadCount30d = partnerLeads.filter(l => l.createdAt && daysBetween(l.createdAt, today) <= 30).length;
    const leadTotal = partnerLeads.length;

    // 산출 등급 (90일 Lead 기준)
    let leadTier = 'zero';
    if (leadCount90d >= LEAD_TOP) leadTier = 'top';
    else if (leadCount90d >= LEAD_MID) leadTier = 'mid';
    else if (leadCount90d >= 1) leadTier = 'low';

    const createdAt = utcToKstDate(a.CreatedDate);
    const ageInDays = createdAt ? daysBetween(createdAt, today) : null;
    const storeQty = a.PartnerTorderStoreQty__c || 0;
    const hasActivity = meetings.length > 0 || partnerLeads.length > 0;

    // 마지막 활동 (미팅 vs Lead 중 더 최근)
    const lastActivityDate = [lastMeetingDate, lastLeadDate].filter(Boolean).sort().pop() || null;
    const daysSinceLastActivity = lastActivityDate ? daysBetween(lastActivityDate, today) : null;

    const isMultiStore = storeQty >= MULTI_STORE_TH;
    const isActive = meetingCount90d > 0 || leadCount90d > 0;
    const isLatent = !hasActivity && ageInDays != null && ageInDays <= LATENT_DAYS;
    const isStuck = hasActivity && daysSinceLastActivity != null && daysSinceLastActivity >= STUCK_DAYS && !isActive;

    let signal = 'idle';
    if (isActive) signal = 'active';
    else if (isStuck) signal = 'stuck';
    else if (isLatent) signal = 'latent';
    else if (!hasActivity && ageInDays > LATENT_DAYS) signal = 'cold';

    const g = geocodeCache[a.Id];
    return {
      accountId: a.Id,
      name: a.Name,
      owner: a.Owner?.Name,
      ownerDept: a.Owner?.Department || null,
      phone: cleanStr(a.PartnerPhone__c) || cleanStr(a.Phone),
      address: pickAddress(a),
      lat: g?.lat || null,
      lng: g?.lng || null,
      partnerType: a.PartnerType__c,
      partnerOrder: a.PartnerOrder__c,
      partnerPos: a.PartnerPOS__c,
      torderStoreQty: storeQty,
      channelProgramName: a.ChannelProgramName,
      channelProgramLevel: a.ChannelProgramLevelName,
      hqPartnerId: a.HQ_Partner__c,
      baseOrPartner: a.BaseCenterOrPartner__c,
      createdAt,
      ageInDays,
      lastMeetingDate,
      daysSinceLastMeeting,
      meetingCount90d,
      meetings: meetings.slice(0, 5),
      // Lead 산출
      leadCount30d,
      leadCount90d,
      leadTotal,
      lastLeadDate,
      daysSinceLastLead,
      leadTier,
      lastActivityDate,
      daysSinceLastActivity,
      isStuck,
      isLatent,
      isActive,
      isMultiStore,
      signal,
      lightningUrl: `${SF_BASE}/${a.Id}/view`,
    };
  });

  // 통계
  const summary = {
    total: records.length,
    bySignal: records.reduce((m, r) => { m[r.signal] = (m[r.signal] || 0) + 1; return m; }, {}),
    byType: records.reduce((m, r) => { const k = r.partnerType || '(미입력)'; m[k] = (m[k] || 0) + 1; return m; }, {}),
    byOwner: Object.entries(records.reduce((m, r) => {
      const k = r.owner || '(미지정)';
      if (!m[k]) m[k] = { owner: k, total: 0, stuck: 0, latent: 0, active: 0, multiStore: 0 };
      m[k].total++;
      if (r.isStuck) m[k].stuck++;
      if (r.isLatent) m[k].latent++;
      if (r.isActive) m[k].active++;
      if (r.isMultiStore) m[k].multiStore++;
      return m;
    }, {})).map(([, v]) => v).sort((a, b) => b.total - a.total),
    multiStore: records.filter(r => r.isMultiStore).length,
    withPhone: records.filter(r => r.phone).length,
    withAddress: records.filter(r => r.address).length,
    byTier: records.reduce((m, r) => { m[r.leadTier] = (m[r.leadTier] || 0) + 1; return m; }, {}),
    totalLeads90d: records.reduce((s, r) => s + (r.leadCount90d || 0), 0),
    totalLeads30d: records.reduce((s, r) => s + (r.leadCount30d || 0), 0),
  };

  const out = {
    generatedAt: new Date().toISOString(),
    periodStart: '2026-03-01',
    periodEnd: today,
    summary,
    records,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 1), 'utf8');
  console.log('\n=== 요약 ===');
  console.log('총:', summary.total, '/ 시그널:', JSON.stringify(summary.bySignal));
  console.log('다매장(5+):', summary.multiStore, '/ 전화 있음:', summary.withPhone, '/ 주소 있음:', summary.withAddress);
  console.log(`\n→ ${OUT_PATH} (${(fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`총 소요: ${((Date.now() - t0) / 1000).toFixed(1)}초`);
})().catch(e => { console.error('FATAL', e.response?.data || e.message); process.exit(1); });
