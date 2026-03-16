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
} = require('../../../lib/kpi-aggregation');

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

module.exports = router;
