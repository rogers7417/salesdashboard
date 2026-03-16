#!/usr/bin/env node
/**
 * 채널세일즈 리포트 - 메인 실행 파일
 *
 * 데이터 흐름:
 * 1. salesforce.js: SF에서 데이터 수집
 * 2. stats.js: 통계 계산
 * 3. html-report.js: HTML 리포트 생성
 * 4. console-report.js: 콘솔 출력 (선택)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const { collectChannelData } = require('./salesforce');
const { calculateStats } = require('./stats');
const { generateHTML } = require('./html-report');
const { generateJSON } = require('./json-report');
const { printConsoleReport } = require('./console-report');

async function main() {
  console.log('\n📊 채널세일즈 리포트 생성 시작...\n');

  try {
    // 1. Salesforce에서 데이터 수집
    const rawData = await collectChannelData();

    // 2. 통계 계산
    const stats = calculateStats(rawData);

    // 3. 콘솔 리포트 출력
    printConsoleReport(stats);

    // 4. HTML 리포트 생성
    const htmlFile = generateHTML(stats);

    // 5. JSON 리포트 생성
    const jsonFile = generateJSON(stats);

    console.log('\n✅ 리포트 생성 완료!');
    console.log(`   HTML: ${htmlFile}`);
    console.log(`   JSON: ${jsonFile}`);

  } catch (error) {
    console.error('\n❌ 오류 발생:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 직접 실행 시
if (require.main === module) {
  main();
}

module.exports = { main };
