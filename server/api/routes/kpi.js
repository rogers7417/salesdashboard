/**
 * KPI API 라우트
 * data/kpi-extract-{YYYY-MM}.json (월간), kpi-extract-{YYYY-MM-DD}.json (일별),
 * 주간(weekly) 집계 지원
 *
 * 집계 로직은 lib/kpi-aggregation.js 공유 모듈 사용
 */
const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../../data');

const {
  aggregateWeeklyData,
  annotateCurrentStatus: _annotateCurrentStatus,
} = require('../../../server/shared/kpi-aggregation');

// DATA_DIR을 바인딩한 래퍼
async function annotateCurrentStatus(data, requestedPeriod) {
  return _annotateCurrentStatus(data, requestedPeriod, DATA_DIR);
}

// ============================================================
// 라우트
// ============================================================

/**
 * GET /api/kpi
 * Query params:
 *   - month: YYYY-MM (월간 데이터)
 *   - date: YYYY-MM-DD (일별 데이터, month보다 우선)
 *   - weekStart: YYYY-MM-DD + weekEnd: YYYY-MM-DD (주간 집계)
 */
router.get('/', async (req, res) => {
  try {
    let { month, date, weekStart, weekEnd } = req.query;

    // weekStart & weekEnd → 주간 집계
    if (weekStart && weekEnd) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !/^\d{4}-\d{2}-\d{2}$/.test(weekEnd)) {
        return res.status(400).json({
          error: 'Invalid week range',
          message: 'weekStart and weekEnd must be YYYY-MM-DD format'
        });
      }
      // weekStart~weekEnd 범위의 일별 파일 읽기
      const files = await fs.readdir(DATA_DIR);
      const dailyFiles = files
        .filter(f => {
          const m = f.match(/^kpi-extract-(\d{4}-\d{2}-\d{2})\.json$/);
          return m && m[1] >= weekStart && m[1] <= weekEnd;
        })
        .sort();

      if (dailyFiles.length === 0) {
        return res.status(404).json({
          error: 'Not found',
          message: `No daily data found for week ${weekStart} ~ ${weekEnd}`
        });
      }

      const dailyDataArray = [];
      for (const f of dailyFiles) {
        const content = await fs.readFile(path.join(DATA_DIR, f), 'utf-8');
        dailyDataArray.push(JSON.parse(content));
      }

      const aggregated = aggregateWeeklyData(dailyDataArray, weekStart, weekEnd);
      await annotateCurrentStatus(aggregated, weekStart.substring(0, 7));
      return res.json(aggregated);
    }

    // date 파라미터가 있으면 일별 파일 서빙
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          error: 'Invalid date',
          message: 'date must be YYYY-MM-DD format'
        });
      }
      const filePath = path.join(DATA_DIR, `kpi-extract-${date}.json`);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const dailyData = JSON.parse(content);
        await annotateCurrentStatus(dailyData, date.substring(0, 7));
        return res.json(dailyData);
      } catch (err) {
        if (err.code === 'ENOENT') {
          return res.status(404).json({
            error: 'Not found',
            message: `KPI data for ${date} not found. Run: node kpi-extract.js ${date.substring(0, 7)} --daily`
          });
        }
        throw err;
      }
    }

    // 기존 월간 로직
    if (!month) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        error: 'Invalid month',
        message: 'month must be YYYY-MM format'
      });
    }

    const filePath = path.join(DATA_DIR, `kpi-extract-${month}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      await annotateCurrentStatus(data, month);
      res.json(data);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({
          error: 'Not found',
          message: `KPI data for ${month} not found. Run: node kpi-extract.js ${month}`
        });
      }
      throw err;
    }
  } catch (error) {
    console.error('[API] KPI 데이터 오류:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/kpi/months
 * 사용 가능한 월 목록 반환
 */
router.get('/months', async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const months = files
      .filter(f => /^kpi-extract-\d{4}-\d{2}\.json$/.test(f))
      .map(f => f.match(/kpi-extract-(\d{4}-\d{2})\.json/)[1])
      .sort()
      .reverse();

    res.json({ months });
  } catch (error) {
    console.error('[API] KPI 월 목록 오류:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/kpi/dates
 * 특정 월의 사용 가능한 일별 파일 목록 반환
 * Query params:
 *   - month: YYYY-MM (필수)
 */
router.get('/dates', async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        error: 'Invalid month',
        message: 'month query param required in YYYY-MM format'
      });
    }

    const files = await fs.readdir(DATA_DIR);
    const dates = files
      .filter(f => {
        const match = f.match(/^kpi-extract-(\d{4}-\d{2}-\d{2})\.json$/);
        return match && match[1].startsWith(month);
      })
      .map(f => f.match(/kpi-extract-(\d{4}-\d{2}-\d{2})\.json/)[1])
      .sort();

    res.json({ month, dates });
  } catch (error) {
    console.error('[API] KPI 날짜 목록 오류:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/kpi/weeks
 * 특정 월의 주 목록 반환 (월요일 시작)
 * Query params:
 *   - month: YYYY-MM (필수)
 */
router.get('/weeks', async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        error: 'Invalid month',
        message: 'month query param required in YYYY-MM format'
      });
    }

    // 해당 월의 available dates 조회
    const files = await fs.readdir(DATA_DIR);
    const availableDates = files
      .filter(f => {
        const m = f.match(/^kpi-extract-(\d{4}-\d{2}-\d{2})\.json$/);
        return m && m[1].startsWith(month);
      })
      .map(f => f.match(/kpi-extract-(\d{4}-\d{2}-\d{2})\.json/)[1])
      .sort();

    if (availableDates.length === 0) {
      return res.json({ month, weeks: [] });
    }

    // 월요일 기준 주 그룹 생성
    const [year, mon] = month.split('-').map(Number);
    const firstDay = new Date(year, mon - 1, 1);
    const lastDay = new Date(year, mon, 0); // 해당 월 마지막 날
    const lastDate = lastDay.getDate();

    const weeks = [];
    let weekStart = 1; // 날짜 (day of month)

    while (weekStart <= lastDate) {
      const startDate = new Date(year, mon - 1, weekStart);
      const dayOfWeek = startDate.getDay(); // 0=일, 1=월, ...

      // 주의 끝: 다음 일요일 또는 월말
      let weekEndDay;
      if (dayOfWeek === 0) {
        // 일요일이면 그날만
        weekEndDay = weekStart;
      } else {
        // 이번주 일요일까지 남은 일수
        const daysUntilSunday = 7 - dayOfWeek;
        weekEndDay = Math.min(weekStart + daysUntilSunday, lastDate);
      }

      const start = `${month}-${String(weekStart).padStart(2, '0')}`;
      const end = `${month}-${String(weekEndDay).padStart(2, '0')}`;
      const dates = availableDates.filter(d => d >= start && d <= end);

      if (dates.length > 0) {
        weeks.push({
          weekNum: weeks.length + 1,
          start,
          end,
          dates,
        });
      }

      weekStart = weekEndDay + 1;
    }

    res.json({ month, weeks });
  } catch (error) {
    console.error('[API] KPI 주 목록 오류:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// ============================================================
// GET /api/kpi/weekly-trend
// 주차별 핵심 KPI 추이 (월간 아카이브 파일 기반)
// Query: month=YYYY-MM
// ============================================================
router.get('/weekly-trend', async (req, res) => {
  try {
    let { month } = req.query;
    if (!month) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month', message: 'month must be YYYY-MM format' });
    }

    const [year, mon] = month.split('-').map(Number);
    const lastDayOfMonth = new Date(year, mon, 0).getDate();

    // 주차 경계일: 7, 14, 21, 월말
    const boundaries = [7, 14, 21, lastDayOfMonth];

    // 해당 월의 일별 파일 목록
    const fsSync = require('fs');
    const allFiles = fsSync.readdirSync(path.join(__dirname, '../../../data'));
    const dailyDates = allFiles
      .map(f => {
        const m = f.match(/^kpi-extract-(\d{4}-\d{2}-\d{2})\.json$/);
        return m && m[1].startsWith(month) ? m[1] : null;
      })
      .filter(Boolean)
      .sort();

    if (dailyDates.length === 0) {
      return res.json({ month, weeks: [], comparison: null });
    }

    // 각 주차별로 월초~경계일 범위의 모든 파일을 읽어 누적 집계
    // 일별 파일은 당일 하루치 스냅샷이므로, 건수 지표는 합산, 비율은 재계산
    const monthStart = `${month}-01`;
    const weeks = [];
    for (let i = 0; i < boundaries.length; i++) {
      const boundaryDate = `${month}-${String(boundaries[i]).padStart(2, '0')}`;
      const filesInRange = dailyDates.filter(d => d >= monthStart && d <= boundaryDate);
      if (filesInRange.length === 0) continue;

      // 이전 주차와 파일 범위가 동일하면 스킵
      if (weeks.length > 0) {
        const prevFiles = weeks[weeks.length - 1]._filesInRange;
        if (prevFiles && prevFiles.length === filesInRange.length &&
            prevFiles[prevFiles.length - 1] === filesInRange[filesInRange.length - 1]) continue;
      }

      // 모든 파일 로드
      const dataArray = [];
      for (const date of filesInRange) {
        try {
          const content = await fs.readFile(
            path.join(__dirname, '../../../data', `kpi-extract-${date}.json`), 'utf-8');
          dataArray.push(JSON.parse(content));
        } catch (readErr) {
          if (readErr.code !== 'ENOENT') throw readErr;
        }
      }
      if (dataArray.length === 0) continue;

      const kpis = aggregateWeeklyKPIs(dataArray);
      weeks.push({
        weekNum: i + 1,
        endDate: boundaryDate,
        sourceFiles: filesInRange.length,
        sourceRange: `${filesInRange[0]} ~ ${filesInRange[filesInRange.length - 1]}`,
        _filesInRange: filesInRange, // 내부 비교용 (응답에서 제거)
        ...kpis,
      });
    }

    // _filesInRange 제거
    weeks.forEach(w => delete w._filesInRange);

    // comparison: 마지막 주차 vs 이전 주차
    let comparison = null;
    if (weeks.length >= 2) {
      const current = weeks[weeks.length - 1];
      const previous = weeks[weeks.length - 2];
      comparison = buildComparison(current, previous);
    }

    res.json({ month, weeks, comparison });
  } catch (error) {
    console.error('[API] KPI weekly-trend 오류:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * 여러 일별 아카이브에서 주차 누적 KPI 집계
 *
 * 지표 유형별 집계 방식:
 * - 일별 활동 건수 (SUM): visitCount, meetingCount, frtOk, totalWithTask, frtOver20, mql, sql
 * - 비율 지표 (원시 합산 후 재계산): frtComplianceRate, sqlConversionRate
 * - 시점 스냅샷 (마지막 파일 값): mouSigned, settlementRate, activePartners,
 *   goldenTimeStalled, sqlBacklog, mqlUnconverted, depositDateMissing7d, boLeadTime,
 *   cwConversionRate, taskCreationAvg, dailyAvgClose, leadCreationPerDay, mouMeetingPerDay
 */
function aggregateWeeklyKPIs(dataArray) {
  const safe = (obj, ...keys) => {
    let val = obj;
    for (const k of keys) {
      if (val == null) return null;
      val = val[k];
    }
    return val != null ? val : null;
  };

  // monthToDate가 있으면 누적 데이터 사용, 없으면 fallback
  const last = dataArray[dataArray.length - 1];
  const lastIb = last.monthToDate?.inbound || last.inbound || {};
  const lastCh = last.monthToDate?.channel || last.channel || {};

  // monthToDate가 있으면 이미 누적값이므로 마지막 파일에서 직접 읽기
  // 없으면 기존 SUM 집계 방식 사용
  const hasMtd = !!last.monthToDate;

  let sumFrtOk, sumFrtTotal, sumMql, sumSql, sumVisitCount;
  let sumAeMeeting, sumAmMeeting, amMeetingDaysWithData, sumTmFrtOver20;
  let taskCreationAvg;

  if (hasMtd) {
    // monthToDate에서 직접 읽기 (이미 월초~당일 누적)
    const isFrt = safe(lastIb, 'insideSales', 'frt');
    sumFrtOk = isFrt?.frtOk || 0;
    sumFrtTotal = isFrt?.totalWithTask || 0;
    sumMql = safe(lastIb, 'insideSales', 'mql') || 0;
    sumSql = safe(lastIb, 'insideSales', 'sql') || 0;
    sumVisitCount = safe(lastIb, 'insideSales', 'visitCount') || 0;
    sumAeMeeting = safe(lastCh, 'ae', 'meetingCount', 'total') || 0;
    sumAmMeeting = safe(lastCh, 'am', 'meetingCount', 'total') || 0;
    // mtd 누적 미팅을 일평균으로 변환: workdays 또는 파일 수 사용
    const amWorkdays = safe(lastCh, 'am', 'workdays');
    amMeetingDaysWithData = (amWorkdays && amWorkdays > 0) ? amWorkdays : dataArray.length;
    sumTmFrtOver20 = safe(lastCh, 'tm', 'frt', 'frtOver20') || 0;

    // taskCreationAvg: IS 멤버만 필터 (byOwner 이름 기준)
    const isDailyTask = safe(lastIb, 'insideSales', 'dailyTask', 'byOwner');
    const isOwnerNames = new Set((safe(lastIb, 'insideSales', 'byOwner') || []).map(u => u.name));
    taskCreationAvg = null;
    if (Array.isArray(isDailyTask) && isOwnerNames.size > 0) {
      const isTaskMembers = isDailyTask.filter(u => isOwnerNames.has(u.name));
      if (isTaskMembers.length > 0) {
        const avgVals = isTaskMembers.map(u => u.avgDaily || 0);
        taskCreationAvg = Math.round(avgVals.reduce((s, v) => s + v, 0) / isTaskMembers.length * 10) / 10;
      }
    }
  } else {
    // fallback: 기존 SUM 집계
    sumFrtOk = 0; sumFrtTotal = 0; sumMql = 0; sumSql = 0;
    sumVisitCount = 0; sumAeMeeting = 0; sumAmMeeting = 0;
    amMeetingDaysWithData = 0; sumTmFrtOver20 = 0;
    let sumTotalTasks = 0, taskMemberCount = 0, taskDaysWithData = 0;

    for (const data of dataArray) {
      const ib = data.inbound || {};
      const ch = data.channel || {};

      sumFrtOk += safe(ib, 'insideSales', 'frt', 'frtOk') || 0;
      sumFrtTotal += safe(ib, 'insideSales', 'frt', 'totalWithTask') || 0;
      sumMql += safe(ib, 'insideSales', 'mql') || 0;
      sumSql += safe(ib, 'insideSales', 'sql') || 0;
      sumVisitCount += safe(ib, 'insideSales', 'visitCount') || 0;
      sumAeMeeting += safe(ch, 'ae', 'meetingCount', 'total') || 0;
      const amMtg = safe(ch, 'am', 'meetingCount', 'total') || 0;
      sumAmMeeting += amMtg;
      if (amMtg > 0) amMeetingDaysWithData++;
      sumTmFrtOver20 += safe(ch, 'tm', 'frt', 'frtOver20') || 0;

      // IS 멤버만 필터 (byOwner 이름 기준)
      const isNames = new Set((safe(ib, 'insideSales', 'byOwner') || []).map(u => u.name));
      const byOwner = safe(ib, 'insideSales', 'dailyTask', 'byOwner');
      if (Array.isArray(byOwner) && isNames.size > 0) {
        const isMembers = byOwner.filter(u => isNames.has(u.name));
        const dayTotal = isMembers.reduce((s, u) => s + (u.totalTasks || 0), 0);
        if (dayTotal > 0) {
          sumTotalTasks += dayTotal;
          taskDaysWithData++;
          taskMemberCount = isMembers.length;
        }
      }
    }

    taskCreationAvg = (taskMemberCount > 0 && taskDaysWithData > 0)
      ? Math.round(sumTotalTasks / taskMemberCount / taskDaysWithData * 10) / 10
      : null;
  }

  // ── 비율 계산 ──
  const frtComplianceRate = sumFrtTotal > 0
    ? Math.round((sumFrtOk / sumFrtTotal) * 1000) / 10
    : null;
  const sqlConversionRate = sumMql > 0
    ? Math.round((sumSql / sumMql) * 1000) / 10
    : null;

  // FS
  const fsGolden = safe(lastIb, 'fieldSales', 'goldenTime');
  const goldenTimeStalled = fsGolden
    ? (fsGolden.stale8plus || 0) + (fsGolden.stale4to7 || 0)
    : null;
  const fsCwByUser = safe(lastIb, 'fieldSales', 'cwConversionRate', 'byUser');
  let fsCwConversionRate = null;
  if (Array.isArray(fsCwByUser) && fsCwByUser.length > 0) {
    const totalCw = fsCwByUser.reduce((s, u) => s + (u.cw || 0), 0);
    const totalAll = fsCwByUser.reduce((s, u) => s + (u.total || 0), 0);
    fsCwConversionRate = totalAll > 0 ? Math.round((totalCw / totalAll) * 1000) / 10 : 0;
  }
  const staleVisitCount = safe(lastIb, 'fieldSales', 'staleVisit', 'total');
  const obsLeadCount = safe(lastIb, 'fieldSales', 'obsLeadCount', 'total');

  // IB BO
  const ibBoDailyClose = safe(lastIb, 'backOffice', 'dailyClose');
  let dailyAvgClose = null;
  if (ibBoDailyClose && Array.isArray(ibBoDailyClose.byUser)) {
    const vals = ibBoDailyClose.byUser
      .filter(u => u.name !== '(미배정)')
      .map(u => u.avgDailyClose || 0);
    dailyAvgClose = vals.length > 0
      ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 10) / 10
      : 0;
  }
  const ibBoSqlBacklog = safe(lastIb, 'backOffice', 'sqlBacklog', 'totalOver7');
  // IB BO cwConversionRate
  const ibBoCwByUser = safe(lastIb, 'backOffice', 'cwConversionRate', 'byUser');
  let ibBoCwConversionRate = null;
  let ibBoCarryoverRate = null;
  if (Array.isArray(ibBoCwByUser) && ibBoCwByUser.length > 0) {
    const filtered = ibBoCwByUser.filter(u => u.name !== '(미배정)');
    const totalCw = filtered.reduce((s, u) => s + (u.cw || 0), 0);
    const totalAll = filtered.reduce((s, u) => s + (u.total || 0), 0);
    ibBoCwConversionRate = totalAll > 0 ? Math.round((totalCw / totalAll) * 1000) / 10 : 0;
    const carryoverTotal = filtered.reduce((s, u) => s + (u.carryoverTotal || 0), 0);
    ibBoCarryoverRate = totalAll > 0 ? Math.round((carryoverTotal / totalAll) * 1000) / 10 : 0;
  }

  // AE
  const aeMouSigned = safe(lastCh, 'ae', 'mouCount', 'total');
  const aeNegoEntry = safe(lastCh, 'ae', 'negoEntry', 'thisMonth');

  // AM
  const settlementRate = safe(lastCh, 'am', 'onboardingRate', 'rate');
  const activePartners = safe(lastCh, 'am', 'activePartnerCount', 'total');
  const leadCreationPerDay = safe(lastCh, 'am', 'dailyLeadCount', 'avgDaily');

  // TM
  const mqlUnconverted = safe(lastCh, 'tm', 'unconvertedMQL', 'count');
  const depositDateMissing7d = safe(lastCh, 'tm', 'sqlBacklog', 'over7');

  // CH BO
  const boLeadTime = safe(lastCh, 'backOffice', 'leadTime', 'overdueCount');
  const chBoSqlBacklog = safe(lastCh, 'backOffice', 'sqlBacklog', 'totalOver7');
  const chBoCwByUser = safe(lastCh, 'backOffice', 'cwConversionRate', 'byUser');
  let chBoCwConversionRate = null;
  if (Array.isArray(chBoCwByUser) && chBoCwByUser.length > 0) {
    const totalCw = chBoCwByUser.reduce((s, u) => s + (u.cw || 0), 0);
    const totalAll = chBoCwByUser.reduce((s, u) => s + (u.total || 0), 0);
    chBoCwConversionRate = totalAll > 0 ? Math.round((totalCw / totalAll) * 1000) / 10 : 0;
  }
  const chBoDailyCloseData = safe(lastCh, 'backOffice', 'dailyClose');
  let chBoDailyClose = null;
  if (chBoDailyCloseData && Array.isArray(chBoDailyCloseData.byUser)) {
    const vals = chBoDailyCloseData.byUser
      .filter(u => u.name !== '(미배정)')
      .map(u => u.avgDailyClose || 0);
    chBoDailyClose = vals.length > 0
      ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 10) / 10
      : 0;
  }

  return {
    inbound: {
      is: { frtComplianceRate, sqlConversionRate, taskCreationAvg, visitCount: sumVisitCount },
      fs: { goldenTimeStalled, cwConversionRate: fsCwConversionRate, staleVisitCount, obsLeadCount },
      bo: { dailyAvgClose, sqlBacklog: ibBoSqlBacklog, cwConversionRate: ibBoCwConversionRate, carryoverRate: ibBoCarryoverRate },
    },
    channel: {
      ae: { meetingCount: sumAeMeeting, mouSigned: aeMouSigned, negoEntry: aeNegoEntry },
      am: {
        mouMeetingPerDay: amMeetingDaysWithData > 0
          ? Math.round(sumAmMeeting / amMeetingDaysWithData * 10) / 10
          : null,
        settlementRate,
        activePartners,
        leadCreationPerDay,
      },
      tm: { frtOverCount: sumTmFrtOver20, mqlUnconverted, depositDateMissing7d },
      bo: { boLeadTime, sqlBacklog: chBoSqlBacklog, cwConversionRate: chBoCwConversionRate, dailyClose: chBoDailyClose },
    },
  };
}

/**
 * 최근 2주차 간 비교 (delta 계산)
 */
function buildComparison(current, previous) {
  const result = { inbound: {}, channel: {} };

  const compareSections = [
    ['inbound', 'is'], ['inbound', 'fs'], ['inbound', 'bo'],
    ['channel', 'ae'], ['channel', 'am'], ['channel', 'tm'], ['channel', 'bo'],
  ];

  for (const [group, section] of compareSections) {
    const cur = current[group]?.[section] || {};
    const prev = previous[group]?.[section] || {};
    const diff = {};

    const allKeys = new Set([...Object.keys(cur), ...Object.keys(prev)]);
    for (const key of allKeys) {
      const cVal = cur[key];
      const pVal = prev[key];
      if (cVal == null && pVal == null) continue;
      diff[key] = {
        current: cVal,
        previous: pVal,
        delta: (cVal != null && pVal != null) ? Math.round((cVal - pVal) * 10) / 10 : null,
      };
    }

    if (!result[group]) result[group] = {};
    result[group][section] = diff;
  }

  return result;
}

module.exports = router;
