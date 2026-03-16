/**
 * 인바운드 세일즈 API 라우트
 */
const express = require('express');
const router = express.Router();
const inboundReport = require('../services/inbound-report');

/**
 * GET /api/inbound
 *
 * Query params:
 *   - mode: daily | weekly | monthly | monthly-current | custom
 *   - start: YYYY-MM-DD (custom 모드일 때)
 *   - end: YYYY-MM-DD (custom 모드일 때)
 *   - detail: true | false (상세 Lead 데이터 포함 여부)
 */
router.get('/', async (req, res) => {
  try {
    const { mode = 'monthly-current', start, end, detail } = req.query;

    // 유효성 검사
    const validModes = ['daily', 'weekly', 'monthly', 'monthly-current', 'custom'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({
        error: 'Invalid mode',
        message: `mode must be one of: ${validModes.join(', ')}`
      });
    }

    if (mode === 'custom' && (!start || !end)) {
      return res.status(400).json({
        error: 'Missing parameters',
        message: 'custom mode requires start and end parameters (YYYY-MM-DD)'
      });
    }

    console.log(`[API] 인바운드 리포트 요청: mode=${mode}, start=${start}, end=${end}`);

    const stats = await inboundReport.generateReport(mode, start, end);

    // detail=false면 leads 배열 제외 (응답 크기 줄이기)
    if (detail !== 'true') {
      delete stats.leads;
    }

    res.json(stats);

  } catch (error) {
    console.error('[API] 인바운드 리포트 오류:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/inbound/summary
 * 요약 정보만 반환 (빠른 조회용)
 */
router.get('/summary', async (req, res) => {
  try {
    const { mode = 'monthly-current', start, end } = req.query;

    const stats = await inboundReport.generateReport(mode, start, end);

    // 요약 정보만 반환
    res.json({
      period: stats.period,
      periodLabel: stats.periodLabel,
      summary: stats.summary,
      frt: {
        avgFRT: stats.frt.avgFRT,
        frtRate: stats.frt.frtRate
      },
      generatedAt: stats.generatedAt
    });

  } catch (error) {
    console.error('[API] 인바운드 요약 오류:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

module.exports = router;
