/**
 * 방문 Task가 달린 Opportunity 주소 → 카카오 지오코딩 배치
 * - 5/1~오늘 방문 Task의 distinct Opp 추출
 * - fm_Address__c → 좌표 변환, data/opp-geocode.json에 캐싱
 * - 기존 캐시는 보존, 신규 Opp만 처리 (증분 가능)
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const axios = require('axios');

const CACHE_PATH = path.join(__dirname, '../../data/opp-geocode.json');
const KAKAO_KEY = process.env.KAKAO_REST_KEY || process.env.KAKAO_REST_API_KEY;
const THROTTLE_MS = 250;
const START_DATE = '2026-05-01';

if (!KAKAO_KEY) { console.error('KAKAO_REST_KEY 없음'); process.exit(1); }

async function sfAuth() {
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

async function geocode(addr) {
  const r = await axios.get('https://dapi.kakao.com/v2/local/search/address.json', {
    params: { query: addr },
    headers: { Authorization: 'KakaoAK ' + KAKAO_KEY },
    timeout: 10000,
  });
  const d = r.data.documents?.[0];
  if (!d) return null;
  return {
    lat: parseFloat(d.y),
    lng: parseFloat(d.x),
    addressName: d.address_name,
    roadAddress: d.road_address?.address_name || null,
    region1: d.address?.region_1depth_name || null,
    region2: d.address?.region_2depth_name || null,
    region3: d.address?.region_3depth_name || null,
  };
}

(async () => {
  const t0 = Date.now();
  console.log('1) SF 인증');
  const sf = await sfAuth();

  console.log('2) 방문 Task → distinct Opp 추출 (5/1~오늘)');
  const tasks = await soql(sf, `SELECT WhatId FROM Task WHERE Subject LIKE '%방문%' AND ActivityDate >= ${START_DATE} AND ActivityDate <= TODAY AND WhatId != null`);
  const oppIdSet = new Set();
  for (const t of tasks) if (t.WhatId?.startsWith('006')) oppIdSet.add(t.WhatId);
  const oppIds = [...oppIdSet];
  console.log(`   방문 Task ${tasks.length}건 → distinct Opp ${oppIds.length}건`);

  console.log('3) Opp 상세 조회');
  const opps = [];
  for (let i = 0; i < oppIds.length; i += 500) {
    const chunk = oppIds.slice(i, i + 500).map(x => "'" + x + "'").join(',');
    const r = await soql(sf, `SELECT Id, Name, StageName, CloseDate, CreatedDate, fm_Address__c, fm_sido__c, fm_Sigugun__c, OwnerId, Owner.Name, AccountId, Account.Name FROM Opportunity WHERE Id IN (${chunk})`);
    opps.push(...r);
  }
  console.log(`   ${opps.length}건`);

  console.log('4) 기존 캐시 로드');
  let cache = {};
  if (fs.existsSync(CACHE_PATH)) {
    cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  }
  const before = Object.keys(cache).length;
  console.log(`   기존: ${before}건`);

  console.log('5) 지오코딩 (신규만)');
  let geocoded = 0, failed = 0, skipped = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < opps.length; i++) {
    const o = opps[i];
    if (cache[o.Id]?.lat) { skipped++; continue; }
    if (!o.fm_Address__c?.trim()) { failed++; continue; }
    try {
      const g = await geocode(o.fm_Address__c.trim());
      if (g) {
        cache[o.Id] = {
          ...g,
          oppName: o.Name,
          stage: o.StageName,
          closeDate: o.CloseDate,
          owner: o.Owner?.Name,
          ownerId: o.OwnerId,
          account: o.Account?.Name,
          rawAddress: o.fm_Address__c.trim(),
          sido: o.fm_sido__c,
          sigugun: o.fm_Sigugun__c,
          geocodedAt: today,
        };
        geocoded++;
      } else {
        cache[o.Id] = { rawAddress: o.fm_Address__c.trim(), geocodeFailed: true, geocodedAt: today };
        failed++;
      }
    } catch (e) {
      console.log(`   ERR ${o.Id}: ${e.response?.status} ${e.response?.data?.message || e.message}`);
      failed++;
      if (e.response?.status === 401 || e.response?.status === 403) break;
    }
    if ((geocoded + failed) % 50 === 0) {
      process.stdout.write(`\r   진행: ${geocoded} 성공 / ${failed} 실패 / ${skipped} 캐시`);
    }
    await new Promise(r => setTimeout(r, THROTTLE_MS));
  }
  console.log(`\n   결과: ${geocoded} 성공 / ${failed} 실패 / ${skipped} 캐시히트`);

  console.log('6) 캐시 저장');
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1), 'utf8');
  console.log(`   총 ${Object.keys(cache).length}건 → ${CACHE_PATH}`);

  console.log(`\n총 소요: ${((Date.now() - t0) / 1000).toFixed(1)}초`);
})().catch(e => { console.error('FATAL', e.response?.data || e.message); process.exit(1); });
