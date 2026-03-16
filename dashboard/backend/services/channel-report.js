/**
 * 채널 세일즈 리포트 서비스
 * - 기존 channel-sales-report 로직 래핑
 * - 5분 TTL 캐싱 지원
 * - targetMonth 파라미터 지원
 */
const path = require('path');

// 기존 채널 세일즈 리포트 모듈 임포트
const channelSalesforce = require('../../../channel-sales-report/salesforce');
const channelStats = require('../../../channel-sales-report/stats');

// 캐시 (월별 키)
let cache = { key: null, data: null, timestamp: 0 };
const CACHE_TTL = 30 * 60 * 1000; // 30분
let isLoading = false;
let loadingPromise = null;

/**
 * 채널 세일즈 리포트 생성 (캐싱 지원)
 * @param {string|null} targetMonth - 'YYYY-MM' 형식, null이면 현재 월
 */
async function generateReport(targetMonth = null) {
  const cacheKey = targetMonth || 'current';

  // 캐시 히트
  if (cache.data && cache.key === cacheKey && (Date.now() - cache.timestamp) < CACHE_TTL) {
    console.log(`📊 채널 세일즈 리포트 캐시 히트 (key=${cacheKey})`);
    return cache.data;
  }

  // 동시 요청 방지: 이미 로딩 중이면 대기
  if (isLoading && loadingPromise) {
    console.log('📊 채널 세일즈 리포트 로딩 대기...');
    return loadingPromise;
  }

  isLoading = true;
  loadingPromise = _fetchAndCache(targetMonth, cacheKey);

  try {
    const result = await loadingPromise;
    return result;
  } finally {
    isLoading = false;
    loadingPromise = null;
  }
}

async function _fetchAndCache(targetMonth, cacheKey) {
  console.log(`📊 채널 세일즈 리포트 생성 시작... (month=${targetMonth || 'current'})`);

  // 1. Salesforce에서 데이터 수집
  const rawData = await channelSalesforce.collectChannelData(targetMonth);

  // 2. 통계 계산
  const stats = channelStats.calculateStats(rawData, targetMonth);

  // 3. 기간 정보 추가
  let year, month;
  if (targetMonth) {
    [year, month] = targetMonth.split('-').map(Number);
  } else {
    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    year = kstNow.getUTCFullYear();
    month = kstNow.getUTCMonth() + 1;
  }

  const result = {
    period: {
      year,
      month,
      label: `${year}년 ${month}월`
    },
    ...stats,
    generatedAt: new Date().toISOString()
  };

  // 캐시 저장
  cache = { key: cacheKey, data: result, timestamp: Date.now() };
  console.log(`📊 채널 세일즈 리포트 캐시 저장 (key=${cacheKey})`);

  return result;
}

/**
 * 요약 정보만 추출
 */
function extractSummary(stats) {
  return {
    period: stats.period,
    summary: stats.summary,
    generatedAt: stats.generatedAt
  };
}

module.exports = {
  generateReport,
  extractSummary
};
