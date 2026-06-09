/**
 * 파트너 라운드 API
 * 데이터: data/partner-tracking.json
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const DATA_PATH = path.join(__dirname, '../../../data/partner-tracking.json');
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

router.get('/all', (req, res) => {
  const d = loadData();
  if (!d) return res.status(503).json({ error: 'partner-tracking.json 미생성' });
  res.json(d);
});

module.exports = router;
