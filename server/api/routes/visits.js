/**
 * 방문 트래킹 API
 * 데이터 소스: data/visit-tracking.json (build-visit-tracking-dataset.js 로 생성)
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const DATA_PATH = path.join(__dirname, '../../../data/visit-tracking.json');

let _cache = null;
let _cacheMtime = 0;

function loadData() {
  try {
    const stat = fs.statSync(DATA_PATH);
    if (!_cache || stat.mtimeMs !== _cacheMtime) {
      _cache = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
      _cacheMtime = stat.mtimeMs;
    }
    return _cache;
  } catch (e) {
    return null;
  }
}

const SF_BASE = 'https://torder.lightning.force.com/lightning/r/Opportunity';
const lightningUrl = id => `${SF_BASE}/${id}/view`;

/**
 * GET /api/visits/summary
 * 단계 분포 · 담당자별 요약 · 일별 추이
 */
router.get('/summary', (req, res) => {
  const d = loadData();
  if (!d) return res.status(503).json({ error: 'visit-tracking.json 미생성' });
  const recs = d.records;

  // 단계 분포
  const byStage = {};
  // 담당자별
  const byOwner = {};
  // 일별 추이 (firstVisit 기준)
  const byDate = {};

  let totalCw = 0, totalCl = 0, totalStuck = 0, totalOpen = 0;

  for (const r of recs) {
    byStage[r.stage] = (byStage[r.stage] || 0) + 1;
    if (!byOwner[r.owner]) {
      byOwner[r.owner] = { owner: r.owner, visits: 0, cw: 0, cl: 0, stuck: 0, open: 0, quoteStuckOpps: [] };
    }
    const o = byOwner[r.owner];
    o.visits++;
    if (r.stage === 'Closed Won') { o.cw++; totalCw++; }
    else if (r.stage === 'Closed Lost') { o.cl++; totalCl++; }
    else { o.open++; totalOpen++; }
    if (r.isStuck) { o.stuck++; totalStuck++; }

    if (r.firstVisit) {
      if (!byDate[r.firstVisit]) byDate[r.firstVisit] = { date: r.firstVisit, visits: 0, cw: 0 };
      byDate[r.firstVisit].visits++;
      if (r.stage === 'Closed Won') byDate[r.firstVisit].cw++;
    }
  }

  // 담당자 CW율
  const ownerList = Object.values(byOwner).map(o => ({
    ...o,
    closed: o.cw + o.cl,
    cwRate: (o.cw + o.cl) > 0 ? Math.round(o.cw / (o.cw + o.cl) * 1000) / 10 : 0,
  })).sort((a, b) => b.visits - a.visits);

  const trend = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

  res.json({
    generatedAt: d.generatedAt,
    period: { start: d.periodStart, end: d.periodEnd },
    total: {
      opps: recs.length,
      cw: totalCw,
      cl: totalCl,
      open: totalOpen,
      stuck: totalStuck,
      cwRate: (totalCw + totalCl) > 0 ? Math.round(totalCw / (totalCw + totalCl) * 1000) / 10 : 0,
    },
    byStage: Object.entries(byStage).map(([stage, count]) => ({ stage, count }))
      .sort((a, b) => b.count - a.count),
    byOwner: ownerList,
    trend,
  });
});

/**
 * GET /api/visits/stuck
 * 견적 8일+ 정체 케이스 (최대 인사이트)
 */
router.get('/stuck', (req, res) => {
  const d = loadData();
  if (!d) return res.status(503).json({ error: 'visit-tracking.json 미생성' });

  const stuck = d.records
    .filter(r => r.isStuck)
    .map(r => ({
      oppId: r.oppId,
      name: r.name,
      owner: r.owner,
      stage: r.stage,
      account: r.account,
      sido: r.sido,
      sigugun: r.sigugun,
      firstVisit: r.firstVisit,
      lastTaskDate: r.lastTaskDate,
      daysSinceLastTask: r.daysSinceLastTask,
      lastTaskSubject: r.lastTaskSubject,
      hasOpenTask: r.hasOpenTask,
      lightningUrl: lightningUrl(r.oppId),
    }))
    .sort((a, b) => b.daysSinceLastTask - a.daysSinceLastTask);

  res.json({ count: stuck.length, items: stuck });
});

/**
 * GET /api/visits/list
 * 전체 방문 Opp 목록 (필터: stage, owner, sido, stuck)
 */
router.get('/list', (req, res) => {
  const d = loadData();
  if (!d) return res.status(503).json({ error: 'visit-tracking.json 미생성' });

  let recs = d.records;
  if (req.query.stage) recs = recs.filter(r => r.stage === req.query.stage);
  if (req.query.owner) recs = recs.filter(r => r.owner === req.query.owner);
  if (req.query.sido) recs = recs.filter(r => r.sido === req.query.sido);
  if (req.query.stuck === 'true') recs = recs.filter(r => r.isStuck);
  if (req.query.openOnly === 'true') recs = recs.filter(r => !/Closed/.test(r.stage || ''));

  const items = recs.map(r => ({
    oppId: r.oppId,
    name: r.name,
    owner: r.owner,
    stage: r.stage,
    account: r.account,
    sido: r.sido,
    sigugun: r.sigugun,
    firstVisit: r.firstVisit,
    visitCount: r.visitCount,
    lastTaskDate: r.lastTaskDate,
    daysSinceLastTask: r.daysSinceLastTask,
    hasOpenTask: r.hasOpenTask,
    isStuck: r.isStuck,
    closeDate: r.closeDate,
    lightningUrl: lightningUrl(r.oppId),
  }));

  res.json({ total: items.length, items });
});

/**
 * GET /api/visits/route?owner=정종찬&date=2026-06-05
 * 단일 담당자·일자 동선용 (예전 페이지 B의 기본 시각화)
 */
router.get('/route', (req, res) => {
  const d = loadData();
  if (!d) return res.status(503).json({ error: 'visit-tracking.json 미생성' });

  const { owner, date } = req.query;
  if (!owner || !date) return res.status(400).json({ error: 'owner, date 필수' });

  const pins = d.records
    .filter(r => r.owner === owner && (r.visitDates || []).includes(date))
    .map(r => ({
      oppId: r.oppId,
      name: r.name,
      account: r.account,
      stage: r.stage,
      lat: r.lat,
      lng: r.lng,
      sido: r.sido,
      sigugun: r.sigugun,
      address: r.roadAddress || r.rawAddress,
      lightningUrl: lightningUrl(r.oppId),
    }));

  res.json({ owner, date, count: pins.length, pins });
});

/**
 * GET /api/visits/map-pins
 * 지도용 — 정체(주황) + 견적 진행중(회색) 전체.
 * 클라이언트는 이 풀에서 필터·근접 검색을 수행.
 */
router.get('/map-pins', (req, res) => {
  const d = loadData();
  if (!d) return res.status(503).json({ error: 'visit-tracking.json 미생성' });

  const deptFilter = req.query.dept || '';

  let pool = d.records
    .filter(r => r.lat && r.lng)
    .filter(r => r.isStuck || r.stage === '견적' || r.hasUpcomingVisit);

  if (deptFilter) pool = pool.filter(r => r.dept === deptFilter);

  const pins = pool.map(r => ({
    oppId: r.oppId,
    name: r.name,
    account: r.account,
    // 방문담당(필터·카드 기준)
    visitor: r.lastVisitor || r.owner,
    visitorDept: r.lastVisitorDept || r.dept,
    lastVisitDate: r.lastVisitDate,
    visitors: r.visitors || [],
    // Opp Owner (참고)
    oppOwner: r.oppOwner,
    oppOwnerDept: r.oppOwnerDept,
    // 단계·진행상태
    stage: r.stage,
    lat: r.lat,
    lng: r.lng,
    sido: r.sido,
    sigugun: r.sigugun,
    address: r.roadAddress || r.rawAddress,
    firstVisit: r.firstVisit,
    lastTaskDate: r.lastTaskDate,
    daysSinceLastTask: r.daysSinceLastTask,
    lastTaskSubject: r.lastTaskSubject,
    hasOpenTask: r.hasOpenTask,
    isStuck: !!r.isStuck,
    // Visit__c 정식
    contact: r.contact,
    naverMapUrl: r.naverMapUrl,
    naverPlaceUrl: r.naverPlaceUrl,
    nextScheduledVisit: r.nextScheduledVisit,
    hasUpcomingVisit: !!r.hasUpcomingVisit,
    lastCompletedVisit: r.lastCompletedVisit,
    visitsCount: r.visitsCount || 0,
    lightningUrl: lightningUrl(r.oppId),
  }));

  // 부서별 방문자 인덱스(드롭다운용) — lastVisitor 기준
  const deptMembers = {};
  for (const r of d.records.filter(r => r.isStuck || r.stage === '견적')) {
    const v = r.lastVisitor;
    const dp = r.lastVisitorDept;
    if (!v || !dp) continue;
    if (!deptMembers[dp]) deptMembers[dp] = new Set();
    deptMembers[dp].add(v);
  }
  const deptIndex = Object.entries(deptMembers).map(([dept, set]) => ({
    dept, members: [...set].sort(), count: set.size,
  })).sort((a, b) => b.count - a.count);

  const stuck = pins.filter(p => p.isStuck).length;
  res.json({ total: pins.length, stuck, activeQuote: pins.length - stuck, pins, deptIndex });
});

/**
 * GET /api/visits/nearby?lat=37.5&lng=127.0&radius=5
 * 좌표 기준 반경 N km 내 정체·견적 매장 (거리순)
 */
router.get('/nearby', (req, res) => {
  const d = loadData();
  if (!d) return res.status(503).json({ error: 'visit-tracking.json 미생성' });

  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radius = parseFloat(req.query.radius || '5');
  if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: 'lat, lng 필수' });

  // Haversine 거리 (km)
  const R = 6371;
  const toRad = x => x * Math.PI / 180;
  const haversine = (lat1, lng1, lat2, lng2) => {
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const visitorFilter = req.query.visitor || req.query.owner;
  const deptFilter = req.query.dept;
  let items = d.records
    .filter(r => r.lat && r.lng)
    .filter(r => r.isStuck || r.stage === '견적' || r.hasUpcomingVisit)
    .filter(r => !visitorFilter || (r.lastVisitor || r.owner) === visitorFilter)
    .filter(r => !deptFilter || (r.lastVisitorDept || r.dept) === deptFilter)
    .map(r => ({
      oppId: r.oppId,
      name: r.name,
      visitor: r.lastVisitor || r.owner,
      visitorDept: r.lastVisitorDept || r.dept,
      lastVisitDate: r.lastVisitDate,
      oppOwner: r.oppOwner,
      stage: r.stage,
      lat: r.lat,
      lng: r.lng,
      sido: r.sido,
      sigugun: r.sigugun,
      address: r.roadAddress || r.rawAddress,
      daysSinceLastTask: r.daysSinceLastTask,
      lastTaskSubject: r.lastTaskSubject,
      isStuck: !!r.isStuck,
      contact: r.contact,
      naverMapUrl: r.naverMapUrl,
      nextScheduledVisit: r.nextScheduledVisit,
      hasUpcomingVisit: !!r.hasUpcomingVisit,
      lastTask: r.lastTask,
      lightningUrl: lightningUrl(r.oppId),
      distanceKm: Math.round(haversine(lat, lng, r.lat, r.lng) * 10) / 10,
    }))
    .filter(p => p.distanceKm <= radius)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  res.json({
    center: { lat, lng },
    radius,
    count: items.length,
    stuck: items.filter(i => i.isStuck).length,
    items,
  });
});

/**
 * GET /api/visits/detail/:oppId
 * 단일 Opp 전체 이력 (visits + tasks 타임라인용)
 */
router.get('/detail/:oppId', (req, res) => {
  const d = loadData();
  if (!d) return res.status(503).json({ error: 'visit-tracking.json 미생성' });
  const r = d.records.find(x => x.oppId === req.params.oppId);
  if (!r) return res.status(404).json({ error: 'opp not found' });

  res.json({
    oppId: r.oppId,
    name: r.name,
    account: r.account,
    stage: r.stage,
    visitor: r.lastVisitor || r.owner,
    visitorDept: r.lastVisitorDept || r.dept,
    oppOwner: r.oppOwner,
    sido: r.sido,
    sigugun: r.sigugun,
    address: r.roadAddress || r.rawAddress,
    isStuck: !!r.isStuck,
    daysSinceLastTask: r.daysSinceLastTask,
    contact: r.contact,
    naverMapUrl: r.naverMapUrl,
    nextScheduledVisit: r.nextScheduledVisit,
    hasUpcomingVisit: !!r.hasUpcomingVisit,
    visits: r.visits || [],
    tasks: r.tasks || [],
    lightningUrl: lightningUrl(r.oppId),
  });
});

/**
 * GET /api/visits/all
 * 전체 visit-tracking.json 그대로 반환 (S3 정적 패턴과 동일 응답 형태)
 * 페이지가 단일 fetch 후 클라이언트 사이드에서 필터/거리계산 수행
 */
router.get('/all', (req, res) => {
  const d = loadData();
  if (!d) return res.status(503).json({ error: 'visit-tracking.json 미생성' });
  res.json(d);
});

module.exports = router;
