require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

// ============================================
// Salesforce 연결
// ============================================
async function getSalesforceToken() {
  const url = `${process.env.SF_LOGIN_URL}/services/oauth2/token`;
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', process.env.SF_CLIENT_ID);
  params.append('client_secret', process.env.SF_CLIENT_SECRET);
  params.append('username', process.env.SF_USERNAME);
  params.append('password', decodeURIComponent(process.env.SF_PASSWORD));
  
  const res = await axios.post(url, params);
  return { accessToken: res.data.access_token, instanceUrl: res.data.instance_url };
}

async function soqlQuery(instanceUrl, accessToken, query) {
  const url = `${instanceUrl}/services/data/v59.0/query`;
  const res = await axios.get(url, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    params: { q: query }
  });
  return res.data;
}

// ============================================
// 날짜 유틸리티
// ============================================
function kstToUTC(kstDateStr, isStart = true) {
  const [year, month, day] = kstDateStr.split('-').map(Number);
  if (isStart) {
    return new Date(Date.UTC(year, month - 1, day - 1, 15, 0, 0)).toISOString();
  } else {
    return new Date(Date.UTC(year, month - 1, day, 14, 59, 59)).toISOString();
  }
}

function getDateRange(mode) {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  let startDate, endDate, periodLabel;
  
  if (mode === 'daily') {
    const yesterday = new Date(kstNow);
    yesterday.setDate(yesterday.getDate() - 1);
    startDate = yesterday.toISOString().split('T')[0];
    endDate = startDate;
    periodLabel = startDate;
  } else if (mode === 'weekly') {
    const dayOfWeek = kstNow.getDay();
    const lastSunday = new Date(kstNow);
    lastSunday.setDate(kstNow.getDate() - dayOfWeek);
    const lastMonday = new Date(lastSunday);
    lastMonday.setDate(lastSunday.getDate() - 6);
    startDate = lastMonday.toISOString().split('T')[0];
    endDate = lastSunday.toISOString().split('T')[0];
    const weekNum = Math.ceil(lastMonday.getDate() / 7);
    periodLabel = `${lastMonday.getFullYear()}년 ${lastMonday.getMonth() + 1}월 ${weekNum}주차 (${startDate} ~ ${endDate})`;
  } else if (mode === 'monthly') {
    const lastMonth = new Date(kstNow.getFullYear(), kstNow.getMonth() - 1, 1);
    const lastDay = new Date(kstNow.getFullYear(), kstNow.getMonth(), 0).getDate();
    startDate = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}-01`;
    endDate = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}-${lastDay}`;
    periodLabel = `${lastMonth.getFullYear()}년 ${lastMonth.getMonth() + 1}월`;
  } else if (mode === 'monthly-current') {
    // 이번 달 1일 ~ 오늘
    const thisMonth = new Date(kstNow.getFullYear(), kstNow.getMonth(), 1);
    const today = kstNow.getDate();
    const totalDays = new Date(kstNow.getFullYear(), kstNow.getMonth() + 1, 0).getDate();
    startDate = `${thisMonth.getFullYear()}-${String(thisMonth.getMonth() + 1).padStart(2, '0')}-01`;
    endDate = `${kstNow.getFullYear()}-${String(kstNow.getMonth() + 1).padStart(2, '0')}-${String(today).padStart(2, '0')}`;
    periodLabel = `${thisMonth.getFullYear()}년 ${thisMonth.getMonth() + 1}월 (${today}/${totalDays}일 경과)`;
    // 페이스 계산용 정보 추가
    return { startDate, endDate, periodLabel, elapsedDays: today, totalDays, isCurrentMonth: true };
  }
  return { startDate, endDate, periodLabel, isCurrentMonth: false };
}

function parseKSTDateTime(kstDateStr) {
  const [datePart, timePart] = kstDateStr.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  return { year, month, day, hour, minute, second, dayOfWeek: new Date(year, month - 1, day).getDay(), dateStr: datePart };
}

function classifyTimeSlot(kstDateStr) {
  const { dayOfWeek, hour } = parseKSTDateTime(kstDateStr);
  if (dayOfWeek === 0 || dayOfWeek === 6) return 'WEEKEND';
  if (hour >= 10 && hour < 19) return 'BUSINESS_HOUR';
  return 'OFF_HOUR';
}

// ============================================
// Slack 전송 (일간)
// ============================================
async function sendDailySlack(data) {
  const { periodLabel, summary, timeSlotStats, frtDistribution, wrongEntryStats, dailyTaskSummary, userCount, monthlyStats } = data;
  
  // 당월 누적 CW 데이터 (monthlyStats에서 가져옴)
  const mSummary = monthlyStats ? monthlyStats.summary : summary;
  const mFieldUserStats = monthlyStats ? monthlyStats.fieldUserStats : [];
  const mBoUserStats = monthlyStats ? monthlyStats.boUserStats : [];
  const mAgeDistribution = monthlyStats ? monthlyStats.ageDistribution : null;
  const mBoSqlBacklog = monthlyStats ? monthlyStats.boSqlBacklog : [];
  
  // Field 담당자 Top 5 (당월 누적)
  const fieldTop5 = mFieldUserStats && mFieldUserStats.length > 0 
    ? mFieldUserStats.slice(0, 5).map(u => `  • ${u.userName}: ${u.cwRate}% (${u.cw}/${u.total}건)`).join('\n')
    : '  • 데이터 없음';
  
  // BO 담당자 전체 (당월 누적)
  const boList = mBoUserStats && mBoUserStats.length > 0
    ? mBoUserStats.map(u => `  • ${u.userName}: ${u.cwRate}% (${u.cw}/${u.total}건)`).join('\n')
    : '  • 데이터 없음';
  
  // BO SQL 잔량 (당월 누적)
  const boBacklogList = mBoSqlBacklog && mBoSqlBacklog.length > 0
    ? mBoSqlBacklog.map(u => `  • ${u.userName}: ${u.over7}건 (총 ${u.total}건)`).join('\n')
    : '  • 데이터 없음';
  
  // 전체 7일 초과 건수 (당월 누적)
  const totalOver7 = mAgeDistribution ? mAgeDistribution['7일 초과'] : 0;
  
  const message = `📊 인바운드 세일즈 일간 리포트 (${periodLabel})
━━━━━━━━━━━━━━━━━━━━
*📋 Lead → MQL → SQL (어제)*
• Lead: ${summary.total}건
• MQL: ${summary.mqlCount}건 (${summary.mqlRate}%)
• SQL: ${summary.sqlCount}건 | 전환율 ${summary.sqlRate}% (목표 90%)

*🚗 방문 완료 (어제)*
• 방문 완료율: ${summary.visitCompleteRate}% (${summary.visitCompleteCount}/${summary.oppCount}건)
• 방문 전 취소: ${summary.visitCancelCount}건

*⏱️ FRT 현황 (어제, MQL 기준)*
• 준수율 (20분 이내): ${summary.frtRate}%
• 20분 이내: ${summary.ok}건 / ${summary.withTask}건

*📝 Task (어제)*
• 총 Task: ${dailyTaskSummary.totalTasks}건

*시간대별 FRT 준수율 (어제)*
☀️ 영업시간: ${timeSlotStats.business.rate}% (${timeSlotStats.business.ok}/${timeSlotStats.business.total}건)
🌙 영업외시간: ${timeSlotStats.offHour.rate}% (${timeSlotStats.offHour.ok}/${timeSlotStats.offHour.total}건)
🗓️ 주말: ${timeSlotStats.weekend.rate}% (${timeSlotStats.weekend.ok}/${timeSlotStats.weekend.total}건)

━━━━━━━━━━━━━━━━━━━━
*🎯 CW 전환 (당월 누적)*
• CW 전환율: ${mSummary.cwRate}% (${mSummary.cwCount}/${mSummary.oppCount}건) (목표 60%)

*👤 Field 담당자별 CW (당월 누적, Top 5)*
${fieldTop5}

*👤 BO 담당자별 CW (당월 누적)*
${boList}

*⚠️ BO SQL 잔량 (당월 누적, 7일 초과: ${totalOver7}건)*
${boBacklogList}`;

  try {
    const response = await axios.post('https://slack.com/api/chat.postMessage', {
      channel: process.env.SLACK_CHANNEL_ID,
      text: message,
    }, {
      headers: { 'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' }
    });
    if (response.data.ok) {
      console.log('\n✅ Slack 전송 완료');
    } else {
      console.error('\n❌ Slack 전송 실패:', response.data.error);
    }
  } catch (error) {
    console.error('\n❌ Slack 전송 에러:', error.message);
  }
}

// ============================================
// 주간 리포트 컨플루언스 위키 생성
// ============================================
function generateWeeklyWiki(data) {
  const { periodLabel, startDate, endDate, summary, timeSlotStats, frtDistribution, frtByTimeSlot, wrongEntryByFRT, wrongEntryStats, dailyStats, dailyTaskSummary, userCount, userStats, fieldUserStats, boUserStats, ageDistribution, boSqlBacklog } = data;
  
  const dailyRows = dailyStats.map(d => {
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dayName = dayNames[new Date(d.date).getDay()];
    const isWeekend = dayName === '토' || dayName === '일';
    return `|${dayName} (${d.date})|${d.leadCount}건|${d.mqlCount}건|${d.sqlCount}건|${d.sqlRate}%|${d.frtOk}건|${d.frtRate}%|${d.taskCount}건|${isWeekend ? '주말' : ''}|`;
  }).join('\n');

  // Field 담당자별 CW 섹션
  const fieldUserSection = fieldUserStats && fieldUserStats.length > 0 ? `
----

h2. 8. Field 담당자별 CW 전환율

||담당자||배정||CW||CW 전환율||상태||
${fieldUserStats.map(u => `|${u.userName}|${u.total}건|${u.cw}건|*${u.cwRate}%*|${Number(u.cwRate) >= 60 ? '(/)' : Number(u.cwRate) >= 40 ? '(!)' : '(x)'}|`).join('\n')}

` : '';

  // BO 담당자별 CW 섹션
  const boUserSection = boUserStats && boUserStats.length > 0 ? `
----

h2. 9. BO 담당자별 CW 전환율

||담당자||배정||CW||CW 전환율||상태||
${boUserStats.map(u => `|${u.userName}|${u.total}건|${u.cw}건|*${u.cwRate}%*|${Number(u.cwRate) >= 60 ? '(/)' : Number(u.cwRate) >= 40 ? '(!)' : '(x)'}|`).join('\n')}

` : '';

  // BO SQL 잔량 섹션
  const totalOpenSql = ageDistribution ? (ageDistribution['3일 이내'] + ageDistribution['4~7일'] + ageDistribution['7일 초과']) : 0;
  const boSqlBacklogSection = ageDistribution && boSqlBacklog && boSqlBacklog.length > 0 ? `
----

h2. 10. BO SQL 잔량 (미마감 건)

{note}이번 주 Lead 전환 Opportunity 중 아직 CW/CL 처리되지 않은 건{note}

h3. 전체 AgeInDays 분포

||구간||건수||비율||상태||
|(/) 3일 이내|${ageDistribution['3일 이내']}건|${totalOpenSql > 0 ? ((ageDistribution['3일 이내'] / totalOpenSql) * 100).toFixed(1) : 0}%|(/) 정상|
|(!) 4~7일|${ageDistribution['4~7일']}건|${totalOpenSql > 0 ? ((ageDistribution['4~7일'] / totalOpenSql) * 100).toFixed(1) : 0}%|(!) 주의|
|(x) 7일 초과|${ageDistribution['7일 초과']}건|${totalOpenSql > 0 ? ((ageDistribution['7일 초과'] / totalOpenSql) * 100).toFixed(1) : 0}%|${ageDistribution['7일 초과'] <= 10 ? '(/) 목표 이내' : '(x) 목표 초과'}|

h3. BO 담당자별 SQL 잔량

||담당자||총 잔량||3일 이내||4~7일||7일 초과||상태||
${boSqlBacklog.map(u => `|${u.userName}|${u.total}건|${u.within3}건|${u.within7}건|*${u.over7}건*|${u.over7 <= 10 ? '(/)' : '(x)'}|`).join('\n')}

` : '';
  
  const wiki = `h1. 📊 인바운드 세일즈 주간 리포트

{info}
*기간*: ${periodLabel}
*작성일*: ${new Date().toISOString().split('T')[0]}
*작성자*: 박영남
*인원*: ${userCount}명
{info}

----

h2. 1. Executive Summary

||지표||이번 주||목표||상태||
|총 Lead|${summary.total}건| - | - |
|MQL|${summary.mqlCount}건 (${summary.mqlRate}%)| - | - |
|SQL 전환율 (MQL→SQL)|*${summary.sqlRate}%*|90%|${Number(summary.sqlRate) >= 90 ? '(/)' : Number(summary.sqlRate) >= 70 ? '(!)' : '(x)'}|
|FRT 준수율 (20분 이내)|*${summary.frtRate}%*|100%|${Number(summary.frtRate) >= 80 ? '(/)' : Number(summary.frtRate) >= 50 ? '(!)' : '(x)'}|
|방문 완료율|*${summary.visitCompleteRate}%* (${summary.visitCompleteCount}/${summary.oppCount}건)|90%|${Number(summary.visitCompleteRate) >= 90 ? '(/)' : Number(summary.visitCompleteRate) >= 70 ? '(!)' : '(x)'}|
|CW 전환율 (SQL→CW)|*${summary.cwRate}%* (${summary.cwCount}/${summary.oppCount}건)|60%|${Number(summary.cwRate) >= 60 ? '(/)' : Number(summary.cwRate) >= 40 ? '(!)' : '(x)'}|
|총 Task|${dailyTaskSummary.totalTasks}건| - | - |

*상태 기준*: (/) 목표 달성 / (!) 주의 / (x) 개선 필요

----

h2. 2. 시간대별 현황 (MQL 기준)

h3. 2.1 MQL 유입 분포

||시간대||건수||비율||
|☀️ 영업시간 (평일 10~19시)|${timeSlotStats.business.total}건|${((timeSlotStats.business.total / summary.mqlCount) * 100).toFixed(1)}%|
|🌙 영업외시간 (평일 19~10시)|${timeSlotStats.offHour.total}건|${((timeSlotStats.offHour.total / summary.mqlCount) * 100).toFixed(1)}%|
|🗓️ 주말 (토/일)|${timeSlotStats.weekend.total}건|${((timeSlotStats.weekend.total / summary.mqlCount) * 100).toFixed(1)}%|

h3. 2.2 FRT 준수율

||시간대||총 건수||20분 이내||준수율||상태||
|☀️ 영업시간|${timeSlotStats.business.total}건|${timeSlotStats.business.ok}건|*${timeSlotStats.business.rate}%*|${Number(timeSlotStats.business.rate) >= 80 ? '(/)' : Number(timeSlotStats.business.rate) >= 50 ? '(!)' : '(x)'}|
|🌙 영업외시간|${timeSlotStats.offHour.total}건|${timeSlotStats.offHour.ok}건|*${timeSlotStats.offHour.rate}%*|${Number(timeSlotStats.offHour.rate) >= 80 ? '(/)' : Number(timeSlotStats.offHour.rate) >= 50 ? '(!)' : '(x)'}|
|🗓️ 주말|${timeSlotStats.weekend.total}건|${timeSlotStats.weekend.ok}건|*${timeSlotStats.weekend.rate}%*|${Number(timeSlotStats.weekend.rate) >= 80 ? '(/)' : Number(timeSlotStats.weekend.rate) >= 50 ? '(!)' : '(x)'}|

----

h2. 3. FRT 분포 (MQL 기준)

||구간||건수||비율||
|(/) 10분 이내|${frtDistribution['10분 이내']}건|${((frtDistribution['10분 이내'] / summary.withTask) * 100).toFixed(1)}%|
|(/) 10~20분|${frtDistribution['10~20분']}건|${((frtDistribution['10~20분'] / summary.withTask) * 100).toFixed(1)}%|
|(!) 20~30분|${frtDistribution['20~30분']}건|${((frtDistribution['20~30분'] / summary.withTask) * 100).toFixed(1)}%|
|(!) 30~60분|${frtDistribution['30~60분']}건|${((frtDistribution['30~60분'] / summary.withTask) * 100).toFixed(1)}%|
|(x) 1시간 초과|${frtDistribution['1시간 초과']}건|${((frtDistribution['1시간 초과'] / summary.withTask) * 100).toFixed(1)}%|

----

h2. 4. 오인입 분석

h3. 4.1 FRT 구간별 오인입 비율

{tip}*가설*: 응대시간이 길어지면 오인입 비율이 높아진다{tip}

||구간||총 건수||오인입||비율||
|10분 이내|${wrongEntryByFRT['10분 이내'].total}건|${wrongEntryByFRT['10분 이내'].wrong}건|${wrongEntryByFRT['10분 이내'].rate}%|
|10~20분|${wrongEntryByFRT['10~20분'].total}건|${wrongEntryByFRT['10~20분'].wrong}건|${wrongEntryByFRT['10~20분'].rate}%|
|20~30분|${wrongEntryByFRT['20~30분'].total}건|${wrongEntryByFRT['20~30분'].wrong}건|${wrongEntryByFRT['20~30분'].rate}%|
|30~60분|${wrongEntryByFRT['30~60분'].total}건|${wrongEntryByFRT['30~60분'].wrong}건|${wrongEntryByFRT['30~60분'].rate}%|
|1시간 초과|${wrongEntryByFRT['1시간 초과'].total}건|${wrongEntryByFRT['1시간 초과'].wrong}건|${wrongEntryByFRT['1시간 초과'].rate}%|

h3. 4.2 시간대별 오인입 비율

||시간대||총 건수||오인입||비율||
|☀️ 영업시간|${wrongEntryStats.business.total}건|${wrongEntryStats.business.count}건|*${wrongEntryStats.business.rate}%*|
|🌙 영업외시간|${wrongEntryStats.offHour.total}건|${wrongEntryStats.offHour.count}건|*${wrongEntryStats.offHour.rate}%*|
|🗓️ 주말|${wrongEntryStats.weekend.total}건|${wrongEntryStats.weekend.count}건|*${wrongEntryStats.weekend.rate}%*|

----

h2. 5. 일별 트렌드

||요일||Lead||MQL||SQL||SQL 전환율||FRT 준수||FRT 준수율||Task||비고||
${dailyRows}

----

h2. 6. 인원별 현황

||이름||Lead||MQL||SQL||SQL 전환율||FRT 준수||FRT 준수율||방문완료||방문완료율||Task||
${userStats.filter(u => u.leadCount > 0).map(u => `|${u.userName}|${u.leadCount}건|${u.mqlCount}건|${u.sqlCount}건|${u.sqlRate}%|${u.frtOk}건|${u.frtRate}%|${u.visitCompleteCount}/${u.oppCount}건|${u.visitCompleteRate}%|${u.taskCount}건|`).join('\n')}
${fieldUserSection}${boUserSection}${boSqlBacklogSection}
----

h2. 11. 이슈 & 액션 아이템

h3. 11.1 주요 발견

# *SQL 전환율 ${summary.sqlRate}%* - ${Number(summary.sqlRate) >= 90 ? '(/) 양호' : '(!) 개선 필요'}
# *방문 완료율 ${summary.visitCompleteRate}%* - ${Number(summary.visitCompleteRate) >= 90 ? '(/) 양호' : '(!) 개선 필요'}
# *CW 전환율 ${summary.cwRate}%* - ${Number(summary.cwRate) >= 60 ? '(/) 양호' : Number(summary.cwRate) >= 40 ? '(!) 개선 필요' : '(x) 개선 시급'}
# *영업시간 FRT 준수율 ${timeSlotStats.business.rate}%* - ${Number(timeSlotStats.business.rate) >= 80 ? '(/) 양호' : '(!) 개선 필요'}
# *영업외시간 FRT 준수율 ${timeSlotStats.offHour.rate}%* - ${Number(timeSlotStats.offHour.rate) >= 50 ? '(/) 양호' : '(x) 개선 필요'}
# *주말 FRT 준수율 ${timeSlotStats.weekend.rate}%* - ${Number(timeSlotStats.weekend.rate) >= 50 ? '(/) 양호' : '(x) 개선 필요'}

h3. 11.2 권장 액션

||#||액션||담당자||기한||상태||
|1|영업외시간/주말 리드 응대 프로세스 검토| - | - |{status:colour=Blue|title=대기}|
|2|FRT 30분 이내 목표 설정 검토| - | - |{status:colour=Blue|title=대기}|
|3|자동 응대 시스템 도입 검토 (RCS 등)| - | - |{status:colour=Blue|title=대기}|

----

h2. 12. 참고

||용어||정의||
|Lead|전체 유입 리드|
|MQL|Marketing Qualified Lead. Status ≠ 배정대기 AND LossReason 제외 조건|
|SQL|Sales Qualified Lead. MQL 중 Status = 'Qualified'|
|SQL 전환율|SQL / MQL × 100|
|CW 전환율|CW / Opportunity × 100|
|FRT|First Response Time. Lead 생성 → 첫 Task 생성까지 소요 시간|
|FRT 준수율|20분 이내 응대한 MQL의 비율|

* 데이터 소스: Salesforce Lead, Task, User, Opportunity
* 측정 기간: ${startDate} ~ ${endDate} (KST)

----

{note}본 리포트는 자동 생성되었습니다. 문의: 박영남{note}
`;

  const filename = `Inbound_Sales_Weekly_${startDate.replace(/-/g, '')}_${endDate.replace(/-/g, '')}.wiki`;
  fs.writeFileSync(filename, wiki);
  console.log(`\n📄 주간 리포트 생성: ${filename}`);
  return filename;
}

// ============================================
// 월간 리포트 컨플루언스 위키 생성
// ============================================
function generateMonthlyWiki(data) {
  const { periodLabel, startDate, endDate, summary, timeSlotStats, frtDistribution, wrongEntryByFRT, wrongEntryStats, dailyTaskSummary, userCount, userStats, paceData, fieldUserStats, boUserStats, ageDistribution, boSqlBacklog } = data;
  
  // 페이스 섹션 생성 (monthly-current 모드일 때만)
  const paceSection = paceData ? `
----

h2. 📈 월말 예상 (Pace)

{note}현재 ${paceData.elapsedDays}일 경과 / 총 ${paceData.totalDays}일 기준 예상치{note}

||지표||현재 실적||월말 예상||
|Lead|${summary.total}건|*${paceData.projectedLead}건*|
|MQL|${summary.mqlCount}건|*${paceData.projectedMQL}건*|
|SQL|${summary.sqlCount}건|*${paceData.projectedSQL}건*|
|Opportunity|${summary.oppCount}건|*${paceData.projectedOpp}건*|
|방문 완료|${summary.visitCompleteCount}건|*${paceData.projectedVisitComplete}건*|
|CW|${summary.cwCount}건|*${paceData.projectedCW || Math.round(summary.cwCount * paceData.totalDays / paceData.elapsedDays)}건*|
|Task|${dailyTaskSummary.totalTasks}건|*${paceData.projectedTask}건*|

` : '';

  // Field 담당자별 CW 섹션
  const fieldUserSection = fieldUserStats && fieldUserStats.length > 0 ? `
----

h2. 4. Field 담당자별 CW 전환율

||담당자||배정||CW||CW 전환율||상태||
${fieldUserStats.map(u => `|${u.userName}|${u.total}건|${u.cw}건|*${u.cwRate}%*|${Number(u.cwRate) >= 60 ? '(/)' : Number(u.cwRate) >= 40 ? '(!)' : '(x)'}|`).join('\n')}

` : '';

  // BO 담당자별 CW 섹션
  const boUserSection = boUserStats && boUserStats.length > 0 ? `
----

h2. 5. BO 담당자별 CW 전환율

||담당자||배정||CW||CW 전환율||상태||
${boUserStats.map(u => `|${u.userName}|${u.total}건|${u.cw}건|*${u.cwRate}%*|${Number(u.cwRate) >= 60 ? '(/)' : Number(u.cwRate) >= 40 ? '(!)' : '(x)'}|`).join('\n')}

` : '';

  // BO SQL 잔량 섹션
  const totalOpenSql = ageDistribution ? (ageDistribution['3일 이내'] + ageDistribution['4~7일'] + ageDistribution['7일 초과']) : 0;
  const boSqlBacklogSection = ageDistribution && boSqlBacklog && boSqlBacklog.length > 0 ? `
----

h2. 6. BO SQL 잔량 (미마감 건)

{note}이번 달 Lead 전환 Opportunity 중 아직 CW/CL 처리되지 않은 건{note}

h3. 전체 AgeInDays 분포

||구간||건수||비율||상태||
|(/) 3일 이내|${ageDistribution['3일 이내']}건|${totalOpenSql > 0 ? ((ageDistribution['3일 이내'] / totalOpenSql) * 100).toFixed(1) : 0}%|(/) 정상|
|(!) 4~7일|${ageDistribution['4~7일']}건|${totalOpenSql > 0 ? ((ageDistribution['4~7일'] / totalOpenSql) * 100).toFixed(1) : 0}%|(!) 주의|
|(x) 7일 초과|${ageDistribution['7일 초과']}건|${totalOpenSql > 0 ? ((ageDistribution['7일 초과'] / totalOpenSql) * 100).toFixed(1) : 0}%|${ageDistribution['7일 초과'] <= 10 ? '(/) 목표 이내' : '(x) 목표 초과'}|

h3. BO 담당자별 SQL 잔량

||담당자||총 잔량||3일 이내||4~7일||7일 초과||상태||
${boSqlBacklog.map(u => `|${u.userName}|${u.total}건|${u.within3}건|${u.within7}건|*${u.over7}건*|${u.over7 <= 10 ? '(/)' : '(x)'}|`).join('\n')}

` : '';
  
  const wiki = `h1. 📊 인바운드 세일즈 월간 리포트

{info}
*기간*: ${periodLabel}
*작성일*: ${new Date().toISOString().split('T')[0]}
*작성자*: 박영남
*인원*: ${userCount}명
{info}

----

h2. Executive Summary

||지표||실적||목표||달성률||상태||
|총 Lead|${summary.total}건| - | - | - |
|MQL|${summary.mqlCount}건 (${summary.mqlRate}%)| - | - | - |
|SQL 전환율 (MQL→SQL)|*${summary.sqlRate}%*|90%|${(Number(summary.sqlRate) / 90 * 100).toFixed(0)}%|${Number(summary.sqlRate) >= 90 ? '(/)' : Number(summary.sqlRate) >= 70 ? '(!)' : '(x)'}|
|FRT 준수율|*${summary.frtRate}%*|100%|${(Number(summary.frtRate) / 100 * 100).toFixed(0)}%|${Number(summary.frtRate) >= 80 ? '(/)' : Number(summary.frtRate) >= 50 ? '(!)' : '(x)'}|
|방문 완료율|*${summary.visitCompleteRate}%* (${summary.visitCompleteCount}/${summary.oppCount}건)|90%|${(Number(summary.visitCompleteRate) / 90 * 100).toFixed(0)}%|${Number(summary.visitCompleteRate) >= 90 ? '(/)' : Number(summary.visitCompleteRate) >= 70 ? '(!)' : '(x)'}|
|CW 전환율 (SQL→CW)|*${summary.cwRate}%* (${summary.cwCount}/${summary.oppCount}건)|60%|${(Number(summary.cwRate) / 60 * 100).toFixed(0)}%|${Number(summary.cwRate) >= 60 ? '(/)' : Number(summary.cwRate) >= 40 ? '(!)' : '(x)'}|
|총 Task|${dailyTaskSummary.totalTasks}건| - | - | - |

{panel:title=한 줄 요약|borderStyle=solid|borderColor=#ccc|titleBGColor=#f7f7f7|bgColor=#fff}
${Number(summary.sqlRate) >= 90 && Number(summary.frtRate) >= 80 ? '(/) 핵심 KPI 목표 달성. 현 수준 유지 필요.' : Number(summary.sqlRate) >= 70 || Number(summary.frtRate) >= 50 ? '(!) KPI 개선 중. 영업외시간/주말 응대 강화 필요.' : '(x) KPI 개선 시급. 프로세스 전면 검토 필요.'}
{panel}
${paceSection}
----

h2. 1. 시간대별 현황 (MQL 기준)

||시간대||건수||비율||준수율||
|☀️ 영업시간|${timeSlotStats.business.total}건|${((timeSlotStats.business.total / summary.mqlCount) * 100).toFixed(1)}%|*${timeSlotStats.business.rate}%*|
|🌙 영업외시간|${timeSlotStats.offHour.total}건|${((timeSlotStats.offHour.total / summary.mqlCount) * 100).toFixed(1)}%|*${timeSlotStats.offHour.rate}%*|
|🗓️ 주말|${timeSlotStats.weekend.total}건|${((timeSlotStats.weekend.total / summary.mqlCount) * 100).toFixed(1)}%|*${timeSlotStats.weekend.rate}%*|

----

h2. 2. FRT 분포 (MQL 기준)

||구간||건수||비율||
|(/) 10분 이내|${frtDistribution['10분 이내']}건|${((frtDistribution['10분 이내'] / summary.withTask) * 100).toFixed(1)}%|
|(/) 10~20분|${frtDistribution['10~20분']}건|${((frtDistribution['10~20분'] / summary.withTask) * 100).toFixed(1)}%|
|(!) 20~30분|${frtDistribution['20~30분']}건|${((frtDistribution['20~30분'] / summary.withTask) * 100).toFixed(1)}%|
|(!) 30~60분|${frtDistribution['30~60분']}건|${((frtDistribution['30~60분'] / summary.withTask) * 100).toFixed(1)}%|
|(x) 1시간 초과|${frtDistribution['1시간 초과']}건|${((frtDistribution['1시간 초과'] / summary.withTask) * 100).toFixed(1)}%|

----

h2. 3. 인원별 현황

||이름||Lead||MQL||SQL||SQL 전환율||FRT 준수||FRT 준수율||방문완료||방문완료율||Task||
${userStats.filter(u => u.leadCount > 0).map(u => `|${u.userName}|${u.leadCount}건|${u.mqlCount}건|${u.sqlCount}건|${u.sqlRate}%|${u.frtOk}건|${u.frtRate}%|${u.visitCompleteCount}/${u.oppCount}건|${u.visitCompleteRate}%|${u.taskCount}건|`).join('\n')}
${fieldUserSection}${boUserSection}${boSqlBacklogSection}
----

h2. 7. 권장 액션

||우선순위||액션||기대 효과||
|{color:red}*높음*{color}|영업외시간/주말 자동 응대 시스템 도입|FRT 준수율 +20%p|
|{color:orange}*중간*{color}|FRT 30분 이내 목표 재설정|효율성 개선|
|{color:green}*낮음*{color}|시간대별 인력 재배치 검토|효율성 개선|

----

* 데이터 소스: Salesforce Lead, Task, User
* 측정 기간: ${startDate} ~ ${endDate} (KST)

{note}본 리포트는 자동 생성되었습니다. 문의: 박영남{note}
`;

  const [year, month] = startDate.split('-');
  const filename = `FRT_Monthly_Report_${year}_${month}.wiki`;
  fs.writeFileSync(filename, wiki);
  console.log(`\n📄 월간 리포트 생성: ${filename}`);
  return filename;
}

// ============================================
// 데이터 수집
// ============================================
async function collectData(startDate, endDate) {
  const { accessToken, instanceUrl } = await getSalesforceToken();
  console.log('✅ Salesforce 연결 성공');
  
  const startUTC = kstToUTC(startDate, true);
  const endUTC = kstToUTC(endDate, false);
  console.log(`📅 조회 기간: ${startDate} ~ ${endDate} (KST)`);
  
  // 1. 인바운드세일즈 User 조회
  const userQuery = `SELECT Id, Name FROM User WHERE Department = '인바운드세일즈' AND IsActive = true`;
  const usersResult = await soqlQuery(instanceUrl, accessToken, userQuery);
  const insideUsers = usersResult.records;
  const insideUserIds = insideUsers.map(u => u.Id);
  const userIdList = insideUserIds.map(id => `'${id}'`).join(',');
  console.log(`👥 인바운드세일즈 인원: ${insideUsers.length}명 (${insideUsers.map(u => u.Name).join(', ')})`);
  
  if (insideUserIds.length === 0) {
    console.log('⚠️ 인바운드세일즈 인원이 없습니다.');
    return null;
  }
  
  // 2. Lead 조회 (대시보드 인바운드 기준)
  // - ServiceType: 테이블오더 OR 티오더 웨이팅
  // - 오생성 제외 (LossReason__c)
  // - 아웃바운드 제외 (LeadSource)
  // - 파트너사 제외 (PartnerName__c)
  // - 프랜차이즈제휴 제외 (StoreType__c)
  // - test 제외 (Company) - JS에서 필터링
  const leadQuery = `
    SELECT Id, CreatedDate, CreatedTime__c, OwnerId, Name, Status, LossReason__c, ConvertedOpportunityId, Company
    FROM Lead
    WHERE CreatedDate >= ${startUTC}
      AND CreatedDate < ${endUTC}
      AND (ServiceType__c = '테이블오더' OR ServiceType__c = '티오더 웨이팅')
      AND (LossReason__c = NULL OR LossReason__c != '오생성')
      AND (LeadSource = NULL OR LeadSource != '아웃바운드')
      AND PartnerName__c = NULL
      AND (StoreType__c = NULL OR StoreType__c != '프랜차이즈제휴')
  `.replace(/\s+/g, ' ').trim();

  const leadsResult = await soqlQuery(instanceUrl, accessToken, leadQuery);
  // Company에 'test' 포함된 건 제외 (대소문자 무시)
  const leads = leadsResult.records.filter(l => !l.Company || !l.Company.toLowerCase().includes('test'));
  console.log(`📋 조회된 Lead: ${leads.length}건 (test 제외: ${leadsResult.records.length - leads.length}건)`);
  
  // 3. Opportunity 조회 (방문 완료율 + CW 전환율 + SQL 잔량 계산용)
  const convertedOppIds = leads.filter(l => l.ConvertedOpportunityId).map(l => l.ConvertedOpportunityId);
  let opportunities = [];
  if (convertedOppIds.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < convertedOppIds.length; i += chunkSize) {
      const chunk = convertedOppIds.slice(i, i + chunkSize);
      const oppIds = chunk.map(id => `'${id}'`).join(',');
      const oppQuery = `SELECT Id, Loss_Reason__c, StageName, FieldUser__c, BOUser__c, AgeInDays FROM Opportunity WHERE Id IN (${oppIds})`.replace(/\s+/g, ' ').trim();
      const oppResult = await soqlQuery(instanceUrl, accessToken, oppQuery);
      opportunities = opportunities.concat(oppResult.records);
    }
  }
  console.log(`📊 조회된 Opportunity: ${opportunities.length}건`);
  
  // Opportunity 데이터 매핑
  const oppDataMap = {};
  opportunities.forEach(opp => {
    const isOpen = opp.StageName !== 'Closed Won' && opp.StageName !== 'Closed Lost';
    oppDataMap[opp.Id] = {
      lossReason: opp.Loss_Reason__c || null,
      stageName: opp.StageName || null,
      isCW: opp.StageName === 'Closed Won',
      isCL: opp.StageName === 'Closed Lost',
      isOpen,
      fieldUserId: opp.FieldUser__c || null,
      boUserId: opp.BOUser__c || null,
      ageInDays: opp.AgeInDays || 0
    };
  });
  
  // 기존 호환성 유지
  const oppLossReasonMap = {};
  opportunities.forEach(opp => {
    oppLossReasonMap[opp.Id] = opp.Loss_Reason__c || null;
  });
  
  // 4. Lead별 첫 Task 조회 (FRT용)
  let leadTasks = [];
  if (leads.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < leads.length; i += chunkSize) {
      const chunk = leads.slice(i, i + chunkSize);
      const leadIds = chunk.map(l => `'${l.Id}'`).join(',');
      const taskQuery = `SELECT Id, Lead__c, CreatedDate, OwnerId FROM Task WHERE Lead__c IN (${leadIds}) AND OwnerId != '005IR00000FgbZtYAJ' ORDER BY Lead__c, CreatedDate ASC`.replace(/\s+/g, ' ').trim();
      const tasksResult = await soqlQuery(instanceUrl, accessToken, taskQuery);
      leadTasks = leadTasks.concat(tasksResult.records);
    }
  }
  console.log(`📞 Lead 관련 Task: ${leadTasks.length}건`);
  
  // 4. 인바운드세일즈 팀 전체 Task 조회 (Daily Task용)
  let dailyTasks = [];
  const dailyTaskQuery = `SELECT Id, OwnerId, CreatedDate FROM Task WHERE OwnerId IN (${userIdList}) AND CreatedDate >= ${startUTC} AND CreatedDate < ${endUTC}`.replace(/\s+/g, ' ').trim();
  const dailyTasksResult = await soqlQuery(instanceUrl, accessToken, dailyTaskQuery);
  dailyTasks = dailyTasksResult.records;
  console.log(`📝 인바운드세일즈 Task: ${dailyTasks.length}건`);
  
  // Lead별 첫 Task 매핑
  const firstTaskByLead = {};
  leadTasks.forEach(task => {
    if (!firstTaskByLead[task.Lead__c]) firstTaskByLead[task.Lead__c] = task;
  });
  
  // MQL 판정 함수
  const MQL_EXCLUDE_LOSS_REASONS = [
    '오생성', '오인입', '중복유입', '추가설치',
    '마케팅 전달', '전략실 전달', '파트너스 전달',
    '프랜차이즈본사문의', '기고객상담', '부서이관'
  ];
  
  const isMQL = (lead) => {
    // Status가 '배정대기'가 아니어야 함
    if (lead.Status === '배정대기') return false;
    // LossReason이 없거나, 제외 목록에 없어야 함
    if (!lead.LossReason__c) return true;
    return !MQL_EXCLUDE_LOSS_REASONS.some(reason => lead.LossReason__c.includes(reason));
  };
  
  // 방문 완료 판정 함수
  const isVisitComplete = (lead) => {
    // ConvertedOpportunityId가 없으면 방문 완료 대상 아님
    if (!lead.ConvertedOpportunityId) return null;
    const oppLossReason = oppLossReasonMap[lead.ConvertedOpportunityId];
    // Loss_Reason__c가 '방문 전 취소'이면 방문 미완료
    return oppLossReason !== '방문 전 취소';
  };
  
  // Opportunity 데이터 가져오기
  const getOppData = (lead) => {
    if (!lead.ConvertedOpportunityId) return null;
    return oppDataMap[lead.ConvertedOpportunityId] || null;
  };
  
  // FRT 결과 계산 (OwnerId, isMQL, 방문완료, oppData 포함)
  const frtResults = leads.map(lead => {
    const firstTask = firstTaskByLead[lead.Id];
    const timeSlot = classifyTimeSlot(lead.CreatedTime__c);
    const lossReason = lead.LossReason__c || null;
    const leadStatus = lead.Status || null;
    const ownerId = lead.OwnerId;
    const mql = isMQL(lead);
    const visitComplete = isVisitComplete(lead);
    const hasOpportunity = !!lead.ConvertedOpportunityId;
    const oppData = getOppData(lead);
    const { dateStr } = parseKSTDateTime(lead.CreatedTime__c);
    
    if (!firstTask) {
      return { leadId: lead.Id, leadName: lead.Name, leadCreated: lead.CreatedTime__c, dateStr, frtMinutes: null, status: 'NO_TASK', timeSlot, lossReason, leadStatus, ownerId, isMQL: mql, hasOpportunity, visitComplete, oppData };
    }
    
    const frtMinutes = (new Date(firstTask.CreatedDate) - new Date(lead.CreatedDate)) / 1000 / 60;
    return { leadId: lead.Id, leadName: lead.Name, leadCreated: lead.CreatedTime__c, dateStr, frtMinutes: Math.round(frtMinutes * 10) / 10, status: frtMinutes > 20 ? 'OVER_20MIN' : 'OK', timeSlot, lossReason, leadStatus, ownerId, isMQL: mql, hasOpportunity, visitComplete, oppData };
  });
  
  // Daily Task 일별 집계
  const dailyTaskStats = {};
  dailyTasks.forEach(task => {
    const taskDate = task.CreatedDate.split('T')[0];
    if (!dailyTaskStats[taskDate]) {
      dailyTaskStats[taskDate] = { total: 0, byUser: {} };
    }
    dailyTaskStats[taskDate].total++;
    if (!dailyTaskStats[taskDate].byUser[task.OwnerId]) {
      dailyTaskStats[taskDate].byUser[task.OwnerId] = 0;
    }
    dailyTaskStats[taskDate].byUser[task.OwnerId]++;
  });
  
  // 인원별 Task 총합 계산
  const taskByUser = {};
  dailyTasks.forEach(task => {
    if (!taskByUser[task.OwnerId]) taskByUser[task.OwnerId] = 0;
    taskByUser[task.OwnerId]++;
  });
  
  // 6. Field/BO 담당자 User 조회
  const fieldBoUserIds = new Set();
  opportunities.forEach(opp => {
    if (opp.FieldUser__c) fieldBoUserIds.add(opp.FieldUser__c);
    if (opp.BOUser__c) fieldBoUserIds.add(opp.BOUser__c);
  });
  
  let fieldBoUsers = [];
  if (fieldBoUserIds.size > 0) {
    const userIds = [...fieldBoUserIds].map(id => `'${id}'`).join(',');
    const userQuery = `SELECT Id, Name FROM User WHERE Id IN (${userIds})`;
    const usersResult = await soqlQuery(instanceUrl, accessToken, userQuery);
    fieldBoUsers = usersResult.records;
  }
  
  // User ID -> Name 매핑
  const userNameMap = {};
  insideUsers.forEach(u => { userNameMap[u.Id] = u.Name; });
  fieldBoUsers.forEach(u => { userNameMap[u.Id] = u.Name; });
  
  return {
    frtResults,
    insideUsers,
    dailyTaskStats,
    taskByUser,
    userNameMap
  };
}

// ============================================
// 통계 계산
// ============================================
function calculateStats(data) {
  const { frtResults, insideUsers, dailyTaskStats, taskByUser, userNameMap } = data;
  const results = frtResults;
  
  // MQL 필터링
  const mqlResults = results.filter(r => r.isMQL);
  
  // 방문 완료 통계 (Opportunity가 있는 건만)
  const oppResults = results.filter(r => r.hasOpportunity);
  const visitCompleteCount = oppResults.filter(r => r.visitComplete === true).length;
  const visitCancelCount = oppResults.filter(r => r.visitComplete === false).length;
  
  // CW 전환 통계
  const cwResults = oppResults.filter(r => r.oppData && r.oppData.isCW);
  const cwCount = cwResults.length;
  const cwRate = oppResults.length > 0 ? ((cwCount / oppResults.length) * 100).toFixed(1) : 0;
  
  // Field 담당자별 CW 통계
  const fieldUserStatsRaw = {};
  oppResults.forEach(r => {
    if (r.oppData && r.oppData.fieldUserId) {
      const uid = r.oppData.fieldUserId;
      if (!fieldUserStatsRaw[uid]) {
        fieldUserStatsRaw[uid] = { total: 0, cw: 0 };
      }
      fieldUserStatsRaw[uid].total++;
      if (r.oppData.isCW) fieldUserStatsRaw[uid].cw++;
    }
  });
  
  // Field 담당자 배열로 변환 (이름 포함)
  const fieldUserStats = Object.entries(fieldUserStatsRaw).map(([uid, stats]) => ({
    userId: uid,
    userName: userNameMap[uid] || uid,
    total: stats.total,
    cw: stats.cw,
    cwRate: stats.total > 0 ? ((stats.cw / stats.total) * 100).toFixed(1) : 0
  })).sort((a, b) => b.total - a.total);
  
  // BO 담당자별 CW 통계
  const boUserStatsRaw = {};
  oppResults.forEach(r => {
    if (r.oppData && r.oppData.boUserId) {
      const uid = r.oppData.boUserId;
      if (!boUserStatsRaw[uid]) {
        boUserStatsRaw[uid] = { total: 0, cw: 0 };
      }
      boUserStatsRaw[uid].total++;
      if (r.oppData.isCW) boUserStatsRaw[uid].cw++;
    }
  });
  
  // BO 담당자 배열로 변환 (이름 포함)
  const boUserStats = Object.entries(boUserStatsRaw).map(([uid, stats]) => ({
    userId: uid,
    userName: userNameMap[uid] || uid,
    total: stats.total,
    cw: stats.cw,
    cwRate: stats.total > 0 ? ((stats.cw / stats.total) * 100).toFixed(1) : 0
  })).sort((a, b) => b.total - a.total);
  
  // BO 담당자별 SQL 잔량 (열린 Opp의 AgeInDays 분포)
  const openOppResults = oppResults.filter(r => r.oppData && r.oppData.isOpen);
  
  // 전체 AgeInDays 분포
  const ageDistribution = {
    '3일 이내': openOppResults.filter(r => r.oppData.ageInDays <= 3).length,
    '4~7일': openOppResults.filter(r => r.oppData.ageInDays > 3 && r.oppData.ageInDays <= 7).length,
    '7일 초과': openOppResults.filter(r => r.oppData.ageInDays > 7).length
  };
  
  // BO 담당자별 SQL 잔량
  const boSqlBacklogRaw = {};
  openOppResults.forEach(r => {
    if (r.oppData && r.oppData.boUserId) {
      const uid = r.oppData.boUserId;
      if (!boSqlBacklogRaw[uid]) {
        boSqlBacklogRaw[uid] = { total: 0, within3: 0, within7: 0, over7: 0 };
      }
      boSqlBacklogRaw[uid].total++;
      if (r.oppData.ageInDays <= 3) {
        boSqlBacklogRaw[uid].within3++;
      } else if (r.oppData.ageInDays <= 7) {
        boSqlBacklogRaw[uid].within7++;
      } else {
        boSqlBacklogRaw[uid].over7++;
      }
    }
  });
  
  // BO SQL 잔량 배열로 변환
  const boSqlBacklog = Object.entries(boSqlBacklogRaw).map(([uid, stats]) => ({
    userId: uid,
    userName: userNameMap[uid] || uid,
    total: stats.total,
    within3: stats.within3,
    within7: stats.within7,
    over7: stats.over7
  })).sort((a, b) => b.over7 - a.over7);  // 7일 초과 많은 순
  
  // 기본 통계
  const summary = {
    // Lead 전체
    total: results.length,
    // MQL
    mqlCount: mqlResults.length,
    mqlRate: results.length > 0 ? ((mqlResults.length / results.length) * 100).toFixed(1) : 0,
    // SQL (MQL 중 Qualified)
    sqlCount: mqlResults.filter(r => r.leadStatus === 'Qualified').length,
    sqlRate: 0,
    // FRT (MQL 기준)
    noTask: mqlResults.filter(r => r.status === 'NO_TASK').length,
    withTask: mqlResults.filter(r => r.status !== 'NO_TASK').length,
    ok: mqlResults.filter(r => r.status === 'OK').length,
    frtRate: 0,
    // 방문 완료율
    oppCount: oppResults.length,
    visitCompleteCount,
    visitCancelCount,
    visitCompleteRate: oppResults.length > 0 ? ((visitCompleteCount / oppResults.length) * 100).toFixed(1) : 0,
    // CW 전환율
    cwCount,
    cwRate
  };
  // SQL 전환율 = SQL / MQL
  summary.sqlRate = summary.mqlCount > 0 ? ((summary.sqlCount / summary.mqlCount) * 100).toFixed(1) : 0;
  // FRT 준수율 (MQL 기준)
  summary.frtRate = summary.withTask > 0 ? ((summary.ok / summary.withTask) * 100).toFixed(1) : 0;
  
  // Daily Task 통계 (평균 제거, 총합만)
  const userCount = insideUsers.length || 1;
  const dailyTaskSummary = {
    totalTasks: Object.values(dailyTaskStats).reduce((sum, d) => sum + d.total, 0),
    days: Object.keys(dailyTaskStats).length || 1
  };
  
  // 시간대별 통계 (MQL 기준, 평균 FRT 제거)
  const calcTimeSlotStats = (slot) => {
    const slotResults = mqlResults.filter(r => r.timeSlot === slot);
    const total = slotResults.length;
    const noTask = slotResults.filter(r => r.status === 'NO_TASK').length;
    const withTask = total - noTask;
    const ok = slotResults.filter(r => r.status === 'OK').length;
    return { total, noTask, withTask, ok, rate: withTask > 0 ? ((ok / withTask) * 100).toFixed(1) : 0 };
  };
  const timeSlotStats = { business: calcTimeSlotStats('BUSINESS_HOUR'), offHour: calcTimeSlotStats('OFF_HOUR'), weekend: calcTimeSlotStats('WEEKEND') };
  
  // FRT 분포 (MQL 기준)
  const frtDistribution = {
    '10분 이내': mqlResults.filter(r => r.frtMinutes !== null && r.frtMinutes <= 10).length,
    '10~20분': mqlResults.filter(r => r.frtMinutes > 10 && r.frtMinutes <= 20).length,
    '20~30분': mqlResults.filter(r => r.frtMinutes > 20 && r.frtMinutes <= 30).length,
    '30~60분': mqlResults.filter(r => r.frtMinutes > 30 && r.frtMinutes <= 60).length,
    '1시간 초과': mqlResults.filter(r => r.frtMinutes > 60).length
  };
  
  // 시간대별 FRT 분포 (MQL 기준)
  const calcFrtByTimeSlot = (slot) => {
    const slotResults = mqlResults.filter(r => r.timeSlot === slot && r.frtMinutes !== null);
    const total = slotResults.length;
    return {
      '10분 이내': slotResults.filter(r => r.frtMinutes <= 10).length,
      '10~20분': slotResults.filter(r => r.frtMinutes > 10 && r.frtMinutes <= 20).length,
      '20~30분': slotResults.filter(r => r.frtMinutes > 20 && r.frtMinutes <= 30).length,
      '30~60분': slotResults.filter(r => r.frtMinutes > 30 && r.frtMinutes <= 60).length,
      '1시간 초과': slotResults.filter(r => r.frtMinutes > 60).length
    };
  };
  const frtByTimeSlot = { business: calcFrtByTimeSlot('BUSINESS_HOUR'), offHour: calcFrtByTimeSlot('OFF_HOUR'), weekend: calcFrtByTimeSlot('WEEKEND') };
  
  // 오인입 통계 (MQL 기준)
  const calcWrongEntryByFRT = (filterFn) => {
    const rangeResults = mqlResults.filter(filterFn);
    const total = rangeResults.length;
    const wrong = rangeResults.filter(r => r.lossReason === '오인입').length;
    return { total, wrong, rate: total > 0 ? ((wrong / total) * 100).toFixed(1) : 0 };
  };
  const wrongEntryByFRT = {
    '10분 이내': calcWrongEntryByFRT(r => r.frtMinutes !== null && r.frtMinutes <= 10),
    '10~20분': calcWrongEntryByFRT(r => r.frtMinutes > 10 && r.frtMinutes <= 20),
    '20~30분': calcWrongEntryByFRT(r => r.frtMinutes > 20 && r.frtMinutes <= 30),
    '30~60분': calcWrongEntryByFRT(r => r.frtMinutes > 30 && r.frtMinutes <= 60),
    '1시간 초과': calcWrongEntryByFRT(r => r.frtMinutes > 60)
  };
  
  const calcWrongEntryBySlot = (slot) => {
    const slotResults = results.filter(r => r.timeSlot === slot);
    const total = slotResults.length;
    const count = slotResults.filter(r => r.lossReason === '오인입').length;
    return { total, count, rate: total > 0 ? ((count / total) * 100).toFixed(1) : 0 };
  };
  const totalWrong = results.filter(r => r.lossReason === '오인입').length;
  const wrongEntryStats = {
    business: calcWrongEntryBySlot('BUSINESS_HOUR'),
    offHour: calcWrongEntryBySlot('OFF_HOUR'),
    weekend: calcWrongEntryBySlot('WEEKEND'),
    total: { total: results.length, count: totalWrong, rate: results.length > 0 ? ((totalWrong / results.length) * 100).toFixed(1) : 0 }
  };
  
  // 일별 통계 (평균 제거)
  const dateSet = [...new Set(results.map(r => r.dateStr))].sort();
  const dailyStats = dateSet.map(date => {
    const dayLeads = results.filter(r => r.dateStr === date);
    const dayMQL = dayLeads.filter(r => r.isMQL);
    const total = dayLeads.length;
    const mqlCount = dayMQL.length;
    const withTask = dayMQL.filter(r => r.status !== 'NO_TASK').length;
    const ok = dayMQL.filter(r => r.status === 'OK').length;
    const sqlCount = dayMQL.filter(r => r.leadStatus === 'Qualified').length;
    // 해당 일의 Task 수
    const taskData = dailyTaskStats[date] || { total: 0 };
    return {
      date,
      leadCount: total,
      mqlCount,
      sqlCount,
      sqlRate: mqlCount > 0 ? ((sqlCount / mqlCount) * 100).toFixed(1) : 0,
      frtOk: ok,
      frtRate: withTask > 0 ? ((ok / withTask) * 100).toFixed(1) : 0,
      taskCount: taskData.total
    };
  });
  
  // 인원별 통계 (방문 완료율 추가)
  const userStats = insideUsers.map(user => {
    const userLeads = results.filter(r => r.ownerId === user.Id);
    const userMQL = userLeads.filter(r => r.isMQL);
    const userOpp = userLeads.filter(r => r.hasOpportunity);
    const leadCount = userLeads.length;
    const mqlCount = userMQL.length;
    const withTask = userMQL.filter(r => r.status !== 'NO_TASK').length;
    const ok = userMQL.filter(r => r.status === 'OK').length;
    const sqlCount = userMQL.filter(r => r.leadStatus === 'Qualified').length;
    const taskCount = taskByUser[user.Id] || 0;
    const oppCount = userOpp.length;
    const visitCompleteCount = userOpp.filter(r => r.visitComplete === true).length;
    
    return {
      userId: user.Id,
      userName: user.Name,
      leadCount,
      mqlCount,
      sqlCount,
      sqlRate: mqlCount > 0 ? ((sqlCount / mqlCount) * 100).toFixed(1) : 0,
      frtOk: ok,
      frtRate: withTask > 0 ? ((ok / withTask) * 100).toFixed(1) : 0,
      taskCount,
      oppCount,
      visitCompleteCount,
      visitCompleteRate: oppCount > 0 ? ((visitCompleteCount / oppCount) * 100).toFixed(1) : 0
    };
  });
  
  return { summary, timeSlotStats, frtDistribution, frtByTimeSlot, wrongEntryByFRT, wrongEntryStats, dailyStats, dailyTaskSummary, userCount, userStats, fieldUserStats, boUserStats, ageDistribution, boSqlBacklog };
}

// ============================================
// 메인 실행
// ============================================
async function main() {
  const mode = process.argv[2] || 'daily';
  
  if (!['daily', 'weekly', 'monthly', 'monthly-current'].includes(mode)) {
    console.error('❌ 사용법: node frt-report.js [daily|weekly|monthly|monthly-current]');
    process.exit(1);
  }
  
  console.log(`\n📊 인바운드 세일즈 ${mode.toUpperCase()} 리포트 생성 시작...\n`);
  
  const dateRange = getDateRange(mode);
  const { startDate, endDate, periodLabel, elapsedDays, totalDays, isCurrentMonth } = dateRange;
  const data = await collectData(startDate, endDate);
  
  if (!data || !data.frtResults || data.frtResults.length === 0) {
    console.log('⚠️ 조회된 데이터가 없습니다.');
    return;
  }
  
  const stats = calculateStats(data);
  
  // Daily 모드일 때 CW 관련 지표는 당월 누적으로 별도 조회
  let monthlyStats = null;
  if (mode === 'daily') {
    console.log('\n📅 당월 누적 CW 데이터 조회 중...');
    const monthlyDateRange = getDateRange('monthly-current');
    const monthlyData = await collectData(monthlyDateRange.startDate, monthlyDateRange.endDate);
    if (monthlyData && monthlyData.frtResults && monthlyData.frtResults.length > 0) {
      monthlyStats = calculateStats(monthlyData);
      console.log(`✅ 당월 누적 데이터 조회 완료 (${monthlyDateRange.startDate} ~ ${monthlyDateRange.endDate})`);
    }
  }
  
  // 페이스 계산 (monthly-current 모드)
  let paceData = null;
  if (isCurrentMonth && elapsedDays && totalDays) {
    const paceMultiplier = totalDays / elapsedDays;
    paceData = {
      elapsedDays,
      totalDays,
      projectedLead: Math.round(stats.summary.total * paceMultiplier),
      projectedMQL: Math.round(stats.summary.mqlCount * paceMultiplier),
      projectedSQL: Math.round(stats.summary.sqlCount * paceMultiplier),
      projectedOpp: Math.round(stats.summary.oppCount * paceMultiplier),
      projectedVisitComplete: Math.round(stats.summary.visitCompleteCount * paceMultiplier),
      projectedTask: Math.round(stats.dailyTaskSummary.totalTasks * paceMultiplier)
    };
  }
  
  const reportData = { periodLabel, startDate, endDate, ...stats, paceData, monthlyStats };
  
  if (mode === 'daily') {
    await sendDailySlack(reportData);
    console.log('\n✅ 일간 리포트 완료 (Slack 전송)');
  } else if (mode === 'weekly') {
    generateWeeklyWiki(reportData);
    console.log('\n✅ 주간 리포트 완료 (위키 파일 생성)');
  } else if (mode === 'monthly' || mode === 'monthly-current') {
    generateMonthlyWiki(reportData);
    console.log('\n✅ 월간 리포트 완료 (위키 파일 생성)');
  }
}

main().catch(err => {
  console.error('❌ 에러:', err.message);
  if (err.response) console.error('   상세:', err.response.data);
});