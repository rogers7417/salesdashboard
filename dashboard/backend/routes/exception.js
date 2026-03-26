/**
 * Exception-Based Reporting API 라우트
 */
const express = require('express');
const router = express.Router();
const exceptionTmReport = require('../services/exception-tm-report');

// 캐시 (30분 TTL)
let cache = {};
const CACHE_TTL = 30 * 60 * 1000;

/**
 * GET /api/exception/is-tm
 *
 * Query params:
 *   - month: YYYY-MM (기본: 현재 월)
 */
router.get('/is-tm', async (req, res) => {
  try {
    const { month } = req.query;

    // month 유효성 검사
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        error: 'Invalid month format',
        message: 'month must be YYYY-MM format (e.g., 2026-03)'
      });
    }

    const cacheKey = month || 'current';
    const cached = cache[cacheKey];
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      return res.json(cached.data);
    }

    console.log(`[API] Exception TM 리포트 요청: month=${month || '현재월'}`);
    const result = await exceptionTmReport.generateExceptionReport(month);

    cache[cacheKey] = { data: result, timestamp: Date.now() };
    res.json(result);
  } catch (error) {
    console.error('[API] Exception TM 리포트 오류:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

module.exports = router;
