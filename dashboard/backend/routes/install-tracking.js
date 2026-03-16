/**
 * 설치 트래킹 API 라우트
 * install-tracking-extract.js가 생성한 install-tracking.json에서 데이터를 읽음
 * (전체 오픈 영업기회 대상, 월별 KPI 파일 무관)
 */
const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../../data');

/**
 * GET /api/install-tracking
 */
router.get('/', async (req, res) => {
  try {
    const filePath = path.join(DATA_DIR, 'install-tracking.json');

    let content;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (e) {
      return res.status(404).json({
        error: 'Data not found',
        message: '설치 트래킹 데이터 파일이 없습니다. 추출을 먼저 실행해주세요.'
      });
    }

    const data = JSON.parse(content);
    res.json(data);

  } catch (error) {
    console.error('[API] install-tracking error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

module.exports = router;
