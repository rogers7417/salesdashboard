#!/usr/bin/env node

/**
 * Salesforce Closed-Lost Grid 데이터 추출 도구
 *
 * 사용법:
 *   node index.js daily [YYYY-MM-DD]
 *   node index.js weekly [YYYY-MM-DD]
 *   node index.js monthly [YYYY-MM-DD]
 *   node index.js all [YYYY-MM-DD]
 *
 * NPM 스크립트:
 *   npm run fetch:daily [YYYY-MM-DD]
 *   npm run fetch:weekly [YYYY-MM-DD]
 *   npm run fetch:monthly [YYYY-MM-DD]
 *   npm run fetch:all [YYYY-MM-DD]
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { fetchClosedLostGrid } = require('./lib/closedLostGrid');

// 설정
const OUTPUT_DIR = process.env.OUTPUT_DIR || './data';
const SF_LOGIN_URL = process.env.SF_LOGIN_URL || 'https://login.salesforce.com';
const SF_CLIENT_ID = process.env.SF_CLIENT_ID;
const SF_CLIENT_SECRET = process.env.SF_CLIENT_SECRET;
const SF_USERNAME = process.env.SF_USERNAME;
const SF_PASSWORD = process.env.SF_PASSWORD;

// Salesforce 토큰 캐시
let cachedToken = null;

/**
 * Salesforce OAuth 토큰 가져오기 (Username-Password Flow)
 */
async function getSalesforceToken() {
  if (cachedToken) {
    console.log('🔑 캐시된 토큰 사용');
    return cachedToken;
  }

  console.log('🔑 Salesforce 토큰 요청 중...');

  const url = `${SF_LOGIN_URL}/services/oauth2/token`;
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', SF_CLIENT_ID);
  params.append('client_secret', SF_CLIENT_SECRET);
  params.append('username', SF_USERNAME);
  params.append('password', decodeURIComponent(SF_PASSWORD));

  try {
    const res = await axios.post(url, params);
    cachedToken = {
      access_token: res.data.access_token,
      instance_url: res.data.instance_url
    };
    console.log('✅ 토큰 발급 완료');
    return cachedToken;
  } catch (error) {
    console.error('❌ 토큰 발급 실패:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Closed-Lost Grid 데이터 가져오기
 */
async function fetchClosedLostData(startDate, endDate) {
  const token = await getSalesforceToken();

  console.log(`📡 Salesforce API 직접 호출: ${startDate} ~ ${endDate}`);

  const data = await fetchClosedLostGrid({
    token,
    startDate,
    endDate,
    options: {
      caseLimit: 10,
      concurrency: 6,
      taskLimit: 10
    }
  });

  return data;
}

/**
 * 날짜 포맷팅
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 날짜 범위 계산
 */
function getDateRange(type, baseDate) {
  const date = new Date(baseDate);

  switch (type) {
    case 'daily': {
      const dateStr = baseDate;
      return { start: dateStr, end: dateStr };
    }

    case 'weekly': {
      // 월요일부터 일요일까지
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1); // 월요일로 조정
      const monday = new Date(date.setDate(diff));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      return {
        start: formatDate(monday),
        end: formatDate(sunday)
      };
    }

    case 'monthly': {
      const year = date.getFullYear();
      const month = date.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);

      return {
        start: formatDate(firstDay),
        end: formatDate(lastDay)
      };
    }

    default:
      throw new Error(`❌ 알 수 없는 타입: ${type}`);
  }
}

/**
 * 파일 저장
 */
function saveToFile(data, filename) {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const filePath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

  return filePath;
}

/**
 * 메인 실행 함수
 */
async function main() {
  const args = process.argv.slice(2);
  const type = args[0] || 'daily';
  const baseDate = args[1] || formatDate(new Date());

  // 환경 변수 검증
  if (!SF_CLIENT_ID || !SF_CLIENT_SECRET || !SF_USERNAME || !SF_PASSWORD) {
    console.error('❌ 환경 변수가 설정되지 않았습니다.');
    console.error('   .env 파일에 SF_CLIENT_ID, SF_CLIENT_SECRET, SF_USERNAME, SF_PASSWORD를 설정하세요.');
    process.exit(1);
  }

  console.log('');
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║   Salesforce Closed-Lost Grid 데이터 추출 도구    ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`📊 타입: ${type.toUpperCase()}`);
  console.log(`📅 기준일: ${baseDate}`);
  console.log(`📁 출력 경로: ${OUTPUT_DIR}`);
  console.log('');
  console.log('─────────────────────────────────────────────────────');
  console.log('');

  const types = type === 'all' ? ['daily', 'weekly', 'monthly'] : [type];

  try {
    for (const t of types) {
      const { start, end } = getDateRange(t, baseDate);

      console.log(`📅 ${t.toUpperCase()} 데이터 추출: ${start} ~ ${end}`);

      const data = await fetchClosedLostData(start, end);

      let filename;
      switch (t) {
        case 'daily':
          filename = `daily_${start}.json`;
          break;
        case 'weekly':
          filename = `weekly_${start}_to_${end}.json`;
          break;
        case 'monthly':
          const yearMonth = start.substring(0, 7);
          filename = `monthly_${yearMonth}.json`;
          break;
      }

      const filePath = saveToFile(data, filename);
      const count = data.summary?.closedLostCount || 0;
      const fileSize = (fs.statSync(filePath).size / 1024).toFixed(2);

      console.log(`✅ 저장 완료: ${path.basename(filePath)}`);
      console.log(`   📊 건수: ${count}건`);
      console.log(`   💾 크기: ${fileSize} KB`);
      console.log('');
    }

    console.log('─────────────────────────────────────────────────────');
    console.log('');
    console.log('✨ 모든 데이터 추출 완료!');
    console.log(`📁 저장 위치: ${path.resolve(OUTPUT_DIR)}`);
    console.log('');

  } catch (error) {
    console.error('');
    console.log('─────────────────────────────────────────────────────');
    console.error('');
    console.error('❌ 오류 발생:', error.message);
    console.error('');

    if (error.response) {
      console.error('📡 응답 상태:', error.response.status);
      console.error('📡 응답 데이터:', JSON.stringify(error.response.data, null, 2));
    }

    if (error.stack) {
      console.error('');
      console.error('📋 상세 스택:');
      console.error(error.stack);
    }

    console.error('');
    process.exit(1);
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  main();
}

module.exports = {
  getSalesforceToken,
  getDateRange
};
