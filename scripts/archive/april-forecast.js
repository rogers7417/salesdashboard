/**
 * 4월 마감 실적 예측 (Forecast)
 * 방법 1: 선형 추세 연장 (일별 CW 누적 기반)
 * 방법 2: 파이프라인 기반 예측 (Open Opp Stage별 전환 확률)
 * 방법 3: 교차 검증
 *
 * 실행: node scripts/analysis/april-forecast.js
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const TARGET_MONTH = '2026-04';
const MONTH_END = new Date('2026-04-30');
const LAST_DATA_DATE = '2026-04-21';
const TOTAL_DAYS = 30; // 4월
const DATA_DAYS = 21;
const REMAINING_DAYS = 9; // 4/22 ~ 4/30

// ──────────────────────────────────────────────
// 유틸리티
// ──────────────────────────────────────────────

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function percentile(arr, p) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function isWeekday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

function countWeekdays(startDate, endDate) {
  let count = 0;
  const curr = new Date(startDate + 'T00:00:00+09:00');
  const end = new Date(endDate + 'T00:00:00+09:00');
  while (curr <= end) {
    const day = curr.getDay();
    if (day !== 0 && day !== 6) count++;
    curr.setDate(curr.getDate() + 1);
  }
  return count;
}

// ──────────────────────────────────────────────
// 방법 1: 선형 추세 연장
// ──────────────────────────────────────────────

function extractDailyCW() {
  const dailyData = [];

  for (let day = 1; day <= 21; day++) {
    const dateStr = `2026-04-${String(day).padStart(2, '0')}`;
    const fn = path.join(DATA_DIR, `kpi-extract-${dateStr}.json`);
    if (!fs.existsSync(fn)) continue;

    const d = JSON.parse(fs.readFileSync(fn, 'utf-8'));
    const mtd = d.monthToDate || d;
    const inb = mtd.inbound;
    const ch = mtd.channel;

    // Inbound CW: IS byOwner + FS cwByChangeDate + BO cwWithCarryover
    const isCW = (inb.insideSales.byOwner || []).reduce((s, o) => s + (o.cw || 0), 0);
    const fsCW = (inb.fieldSales.cwByChangeDate?.byUser || []).reduce((s, u) => s + (u.cw || 0), 0);
    const boCW = (inb.backOffice.cwWithCarryover?.byUser || []).reduce((s, u) => s + (u.cw || 0), 0);

    // Channel CW: ChBO cwWithCarryover + TM byOwner
    const chBoCW = (ch.backOffice.cwWithCarryover?.byUser || []).reduce((s, u) => s + (u.cw || 0), 0);
    const tmCW = (ch.tm.byOwner || []).reduce((s, o) => s + (o.cw || 0), 0);

    const inbTotal = isCW + fsCW + boCW;
    const chTotal = chBoCW + tmCW;

    dailyData.push({
      date: dateStr,
      day,
      weekday: isWeekday(dateStr),
      inbound: inbTotal,
      channel: chTotal,
      total: inbTotal + chTotal,
    });
  }

  return dailyData;
}

function linearForecast(dailyData) {
  // 일별 증분(delta) 계산 - 영업일만
  const deltas = [];
  const inbDeltas = [];
  const chDeltas = [];

  for (let i = 1; i < dailyData.length; i++) {
    const prev = dailyData[i - 1];
    const curr = dailyData[i];
    const inbDelta = curr.inbound - prev.inbound;
    const chDelta = curr.channel - prev.channel;

    // 영업일 여부 기록
    deltas.push({
      date: curr.date,
      weekday: curr.weekday,
      inbDelta,
      chDelta,
      totalDelta: inbDelta + chDelta,
    });

    if (curr.weekday) {
      inbDeltas.push(inbDelta);
      chDeltas.push(chDelta);
    }
  }

  // 영업일 일별 증분의 중앙값 사용 (평균 금지)
  const inbMedianDaily = median(inbDeltas);
  const chMedianDaily = median(chDeltas);

  // 주말 증분도 별도 계산
  const weekendInbDeltas = deltas.filter(d => !d.weekday).map(d => d.inbDelta);
  const weekendChDeltas = deltas.filter(d => !d.weekday).map(d => d.chDelta);
  const inbMedianWeekend = median(weekendInbDeltas);
  const chMedianWeekend = median(weekendChDeltas);

  // 잔여일(4/22~4/30) 영업일/주말 카운트
  const remainingDays = [];
  for (let day = 22; day <= 30; day++) {
    const dateStr = `2026-04-${String(day).padStart(2, '0')}`;
    remainingDays.push({
      date: dateStr,
      weekday: isWeekday(dateStr),
    });
  }

  const remainWeekdays = remainingDays.filter(d => d.weekday).length;
  const remainWeekends = remainingDays.filter(d => !d.weekday).length;

  // 현재 누적
  const lastDay = dailyData[dailyData.length - 1];
  const currentInb = lastDay.inbound;
  const currentCh = lastDay.channel;

  // 예측: 현재 + 잔여 영업일 * 영업일 중앙값 증분 + 잔여 주말 * 주말 중앙값 증분
  const forecastInb = currentInb
    + remainWeekdays * inbMedianDaily
    + remainWeekends * (inbMedianWeekend || 0);
  const forecastCh = currentCh
    + remainWeekdays * chMedianDaily
    + remainWeekends * (chMedianWeekend || 0);

  return {
    currentInb,
    currentCh,
    currentTotal: currentInb + currentCh,
    inbMedianDaily,
    chMedianDaily,
    inbMedianWeekend,
    chMedianWeekend,
    remainWeekdays,
    remainWeekends,
    forecastInb: Math.round(forecastInb),
    forecastCh: Math.round(forecastCh),
    forecastTotal: Math.round(forecastInb + forecastCh),
    inbDeltas,
    chDeltas,
    weekendInbDeltas,
    weekendChDeltas,
    // P25/P75 for confidence interval
    inbP25Daily: percentile(inbDeltas, 25),
    inbP75Daily: percentile(inbDeltas, 75),
    chP25Daily: percentile(chDeltas, 25),
    chP75Daily: percentile(chDeltas, 75),
  };
}

// ──────────────────────────────────────────────
// 방법 2: 파이프라인 기반 예측
// ──────────────────────────────────────────────

function pipelineForecast() {
  // Stage-to-CW 소요일 (Won 경로 중앙값 기반, 누적)
  const dwellData = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'stage-dwell-inbound-q1-2026.json'), 'utf-8')
  );

  const wonLookup = {};
  for (const s of dwellData.wonPath) {
    wonLookup[s.stage] = s;
  }

  // 프로세스 순서: 방문배정 -> 견적 -> 계약진행 -> 선납금 -> 출고진행 -> 설치진행 -> CW
  const flow = ['방문배정', '견적', '계약진행', '선납금', '출고진행', '설치진행'];

  // 누적 잔여일 계산 (각 Stage에서 CW까지)
  const stageToCW = {};
  let cumulative = 0;
  for (const stage of [...flow].reverse()) {
    if (wonLookup[stage]) {
      cumulative += wonLookup[stage].median;
      stageToCW[stage] = cumulative;
    }
  }
  // 파생 Stage
  stageToCW['재견적'] = (stageToCW['견적'] || 0) + (wonLookup['재견적']?.median || 0);
  stageToCW['방문상담'] = (stageToCW['견적'] || 0) + (wonLookup['방문상담']?.median || 0);

  // P75 기준도 계산 (보수적 추정)
  const stageToCW_p75 = {};
  let cum75 = 0;
  for (const stage of [...flow].reverse()) {
    if (wonLookup[stage]) {
      cum75 += wonLookup[stage].p75;
      stageToCW_p75[stage] = cum75;
    }
  }
  stageToCW_p75['재견적'] = (stageToCW_p75['견적'] || 0) + (wonLookup['재견적']?.p75 || 0);
  stageToCW_p75['방문상담'] = (stageToCW_p75['견적'] || 0) + (wonLookup['방문상담']?.p75 || 0);

  // 잔여 calendar days (4/22~4/30)
  const remainCalDays = 9;

  // Open Opp 로드
  const kpi = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, `kpi-extract-${TARGET_MONTH}.json`), 'utf-8')
  );

  // 인바운드 Open Opps
  const fsOpen = kpi.inbound.fieldSales.rawData?.rawOpenOpps || [];
  const boOpen = kpi.inbound.backOffice.rawData?.rawOpenOpps || [];
  const inbOpen = [...fsOpen, ...boOpen];

  // 채널 Open Opps
  const chBoOpen = kpi.channel.backOffice.rawData?.rawOpenOpps || [];
  const tmOpen = kpi.channel.tm.rawData?.rawOpenOpps || [];
  const chOpen = [...chBoOpen, ...tmOpen];

  function calcConversion(opps, label) {
    const stageResults = {};
    let totalExpected = 0;

    for (const opp of opps) {
      const stage = opp.stageName;
      if (!stageResults[stage]) {
        stageResults[stage] = {
          stage,
          count: 0,
          medianDaysToCW: stageToCW[stage] || null,
          p75DaysToCW: stageToCW_p75[stage] || null,
          expectedConversions: 0,
        };
      }
      stageResults[stage].count++;

      const daysToCW = stageToCW[stage];
      if (daysToCW == null) {
        // Unknown stage - skip
        continue;
      }

      // P(전환) = min(1, 잔여일 / Stage->CW 소요일 중앙값)
      // 잔여일이 충분하면 확률 1에 가까움
      // 추가: Q1 Win rate 반영 (Won / (Won+Lost) per stage)
      const prob = daysToCW === 0 ? 1 : Math.min(1, remainCalDays / daysToCW);
      stageResults[stage].expectedConversions += prob;
      totalExpected += prob;
    }

    return { stageResults: Object.values(stageResults), totalExpected };
  }

  const inbResult = calcConversion(inbOpen, '인바운드');
  const chResult = calcConversion(chOpen, '채널');

  // 현재 CW
  const kpiMonthly = kpi;
  const currentInbCW =
    (kpiMonthly.inbound.insideSales.byOwner || []).reduce((s, o) => s + (o.cw || 0), 0)
    + (kpiMonthly.inbound.fieldSales.cwByChangeDate?.byUser || []).reduce((s, u) => s + (u.cw || 0), 0)
    + (kpiMonthly.inbound.backOffice.cwWithCarryover?.byUser || []).reduce((s, u) => s + (u.cw || 0), 0);

  const currentChCW =
    (kpiMonthly.channel.backOffice.cwWithCarryover?.byUser || []).reduce((s, u) => s + (u.cw || 0), 0)
    + (kpiMonthly.channel.tm.byOwner || []).reduce((s, o) => s + (o.cw || 0), 0);

  // 파이프라인 전환 확률에 Win Rate 보정 적용
  // Q1 인바운드: Won 2159 / (Won 2159 + Lost 2860) = 43%
  const q1WinRate = dwellData.counts.wonTargetOpps / (dwellData.counts.wonTargetOpps + dwellData.counts.lostTargetOpps);

  const inbPipelineCW = Math.round(inbResult.totalExpected * q1WinRate);
  const chPipelineCW = Math.round(chResult.totalExpected * 0.5); // 채널은 별도 비율 (보수적 50%)

  return {
    currentInbCW,
    currentChCW,
    currentTotal: currentInbCW + currentChCW,
    inbOpenCount: inbOpen.length,
    chOpenCount: chOpen.length,
    inbStages: inbResult.stageResults,
    chStages: chResult.stageResults,
    inbRawExpected: inbResult.totalExpected,
    chRawExpected: chResult.totalExpected,
    q1WinRate,
    inbPipelineCW,
    chPipelineCW,
    forecastInb: currentInbCW + inbPipelineCW,
    forecastCh: currentChCW + chPipelineCW,
    forecastTotal: currentInbCW + inbPipelineCW + currentChCW + chPipelineCW,
    stageToCW,
    remainCalDays,
  };
}

// ──────────────────────────────────────────────
// 실행 & 출력
// ──────────────────────────────────────────────

function main() {
  console.log('='.repeat(80));
  console.log('  4월 마감 실적 예측 (Forecast)');
  console.log('  기준일: 2026-04-21 (21일치 데이터)');
  console.log('  잔여일: 4/22~4/30 (9일)');
  console.log('='.repeat(80));

  // 데이터 추출
  const dailyData = extractDailyCW();

  // ── 표 1: 일별 CW 누적 추이 ──
  console.log('\n### 표 1: 일별 CW 누적 추이 (4/1~4/21)');
  console.log('  날짜  | 요일 | 인바운드 CW | 채널 CW | 합계 | 일 증분');
  console.log('  ' + '-'.repeat(58));

  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  let prevTotal = 0;
  for (const d of dailyData) {
    const dt = new Date(d.date + 'T00:00:00+09:00');
    const dayName = dayNames[dt.getDay()];
    const marker = d.weekday ? '' : ' *';
    const delta = d.total - prevTotal;
    console.log(
      `${d.date.slice(5)} | ${dayName}${marker} | ${String(d.inbound).padStart(11)} | ${String(d.channel).padStart(8)} | ${String(d.total).padStart(5)} | ${delta > 0 ? '+' : ''}${String(delta).padStart(6)}`
    );
    prevTotal = d.total;
  }

  // ── 방법 1: 선형 추세 ──
  const linear = linearForecast(dailyData);

  console.log('\n### 방법 1: 선형 추세 연장');
  console.log(`  현재 누적 (4/21): 인바운드 ${linear.currentInb} / 채널 ${linear.currentCh} / 합계 ${linear.currentTotal}`);
  console.log(`  영업일 일별 증분 중앙값: 인바운드 ${linear.inbMedianDaily} / 채널 ${linear.chMedianDaily}`);
  console.log(`  영업일 일별 증분 P25: 인바운드 ${linear.inbP25Daily} / 채널 ${linear.chP25Daily}`);
  console.log(`  영업일 일별 증분 P75: 인바운드 ${linear.inbP75Daily} / 채널 ${linear.chP75Daily}`);
  console.log(`  주말 일별 증분 중앙값: 인바운드 ${linear.inbMedianWeekend} / 채널 ${linear.chMedianWeekend}`);
  console.log(`  잔여 영업일: ${linear.remainWeekdays}일, 잔여 주말: ${linear.remainWeekends}일`);
  console.log(`  ▶ 예측: 인바운드 ${linear.forecastInb} / 채널 ${linear.forecastCh} / 합계 ${linear.forecastTotal}`);

  // P25/P75 confidence interval
  const forecastInbLow = Math.round(linear.currentInb + linear.remainWeekdays * linear.inbP25Daily + linear.remainWeekends * (linear.inbMedianWeekend || 0));
  const forecastInbHigh = Math.round(linear.currentInb + linear.remainWeekdays * linear.inbP75Daily + linear.remainWeekends * (linear.inbMedianWeekend || 0));
  const forecastChLow = Math.round(linear.currentCh + linear.remainWeekdays * linear.chP25Daily + linear.remainWeekends * (linear.chMedianWeekend || 0));
  const forecastChHigh = Math.round(linear.currentCh + linear.remainWeekdays * linear.chP75Daily + linear.remainWeekends * (linear.chMedianWeekend || 0));
  console.log(`  신뢰구간 (P25~P75): 인바운드 ${forecastInbLow}~${forecastInbHigh} / 채널 ${forecastChLow}~${forecastChHigh} / 합계 ${forecastInbLow + forecastChLow}~${forecastInbHigh + forecastChHigh}`);

  // ── 방법 2: 파이프라인 기반 ──
  const pipeline = pipelineForecast();

  console.log('\n### 표 2: 현재 파이프라인 Stage 분포 (인바운드)');
  console.log('  Stage           | Open 건수 | CW까지 중앙값(일) | 잔여일 | 전환 예상');
  console.log('  ' + '-'.repeat(68));

  for (const s of pipeline.inbStages.sort((a, b) => (b.medianDaysToCW || 999) - (a.medianDaysToCW || 999))) {
    const daysStr = s.medianDaysToCW != null ? s.medianDaysToCW.toFixed(1) : 'N/A';
    const convStr = s.expectedConversions.toFixed(1);
    console.log(
      `  ${s.stage.padEnd(15)} | ${String(s.count).padStart(8)} | ${daysStr.padStart(17)} | ${String(pipeline.remainCalDays).padStart(6)} | ${convStr.padStart(8)}`
    );
  }
  const inbOpenTotal = pipeline.inbStages.reduce((s, x) => s + x.count, 0);
  const inbExpTotal = pipeline.inbStages.reduce((s, x) => s + x.expectedConversions, 0);
  console.log('  ' + '-'.repeat(68));
  console.log(
    `  ${'합계'.padEnd(15)} | ${String(inbOpenTotal).padStart(8)} |                   |        | ${inbExpTotal.toFixed(1).padStart(8)}`
  );
  console.log(`  Q1 인바운드 Win Rate: ${(pipeline.q1WinRate * 100).toFixed(1)}%`);
  console.log(`  Win Rate 보정 후 전환 예상: ${pipeline.inbPipelineCW}건`);

  console.log('\n### 표 2-2: 현재 파이프라인 Stage 분포 (채널)');
  console.log('  Stage           | Open 건수 | CW까지 중앙값(일) | 잔여일 | 전환 예상');
  console.log('  ' + '-'.repeat(68));

  for (const s of pipeline.chStages.sort((a, b) => (b.medianDaysToCW || 999) - (a.medianDaysToCW || 999))) {
    const daysStr = s.medianDaysToCW != null ? s.medianDaysToCW.toFixed(1) : 'N/A';
    const convStr = s.expectedConversions.toFixed(1);
    console.log(
      `  ${s.stage.padEnd(15)} | ${String(s.count).padStart(8)} | ${daysStr.padStart(17)} | ${String(pipeline.remainCalDays).padStart(6)} | ${convStr.padStart(8)}`
    );
  }
  const chOpenTotal = pipeline.chStages.reduce((s, x) => s + x.count, 0);
  const chExpTotal = pipeline.chStages.reduce((s, x) => s + x.expectedConversions, 0);
  console.log('  ' + '-'.repeat(68));
  console.log(
    `  ${'합계'.padEnd(15)} | ${String(chOpenTotal).padStart(8)} |                   |        | ${chExpTotal.toFixed(1).padStart(8)}`
  );
  console.log(`  채널 Win Rate (보수적 추정): 50%`);
  console.log(`  Win Rate 보정 후 전환 예상: ${pipeline.chPipelineCW}건`);

  console.log('\n### 방법 2: 파이프라인 기반 예측');
  console.log(`  현재 CW: 인바운드 ${pipeline.currentInbCW} / 채널 ${pipeline.currentChCW} / 합계 ${pipeline.currentTotal}`);
  console.log(`  파이프라인 추가 예상: 인바운드 +${pipeline.inbPipelineCW} / 채널 +${pipeline.chPipelineCW}`);
  console.log(`  ▶ 예측: 인바운드 ${pipeline.forecastInb} / 채널 ${pipeline.forecastCh} / 합계 ${pipeline.forecastTotal}`);

  // ── 방법 3: 교차 검증 ──
  // 가중: 추세 60%, 파이프라인 40% (추세가 실적 기반이라 더 신뢰)
  const weightedInb = Math.round(linear.forecastInb * 0.6 + pipeline.forecastInb * 0.4);
  const weightedCh = Math.round(linear.forecastCh * 0.6 + pipeline.forecastCh * 0.4);
  const weightedTotal = weightedInb + weightedCh;

  console.log('\n### 표 3: 4월 마감 예측 요약');
  const pad = (s, n) => String(s).padStart(n);
  console.log('  방법               | 인바운드 |   채널 |   합계 | 비고');
  console.log('  ' + '-'.repeat(68));
  console.log(`  현재 실적 (4/21)   | ${pad(linear.currentInb, 7)} | ${pad(linear.currentCh, 6)} | ${pad(linear.currentTotal, 6)} | 70% 경과 (21/30일)`);
  console.log(`  선형 추세 연장     | ${pad(linear.forecastInb, 7)} | ${pad(linear.forecastCh, 6)} | ${pad(linear.forecastTotal, 6)} | 영업일 중앙값 기반`);
  console.log(`  파이프라인 기반     | ${pad(pipeline.forecastInb, 7)} | ${pad(pipeline.forecastCh, 6)} | ${pad(pipeline.forecastTotal, 6)} | Q1 Win Rate 보정`);
  console.log(`  가중 예측 (6:4)    | ${pad(weightedInb, 7)} | ${pad(weightedCh, 6)} | ${pad(weightedTotal, 6)} | 최종 예측`);

  // 추세 vs 파이프라인 차이 분석
  const inbGap = linear.forecastInb - pipeline.forecastInb;
  const chGap = linear.forecastCh - pipeline.forecastCh;

  console.log('\n### 교차 검증 분석');
  console.log(`  추세 vs 파이프라인 차이: 인바운드 ${inbGap > 0 ? '+' : ''}${inbGap} / 채널 ${chGap > 0 ? '+' : ''}${chGap}`);

  if (inbGap > 0) {
    console.log('  [인바운드] 추세 > 파이프라인: 현재 파이프라인이 얇아 추세만큼의 전환이 어려울 수 있음.');
    console.log('            이월건 소진 후 감속 가능성 있어 파이프라인 기반이 더 현실적일 수 있음.');
  } else if (inbGap < 0) {
    console.log('  [인바운드] 파이프라인 > 추세: 후반부 전환 가속 가능성. 파이프라인이 두터움.');
  }

  if (chGap > 0) {
    console.log('  [채널] 추세 > 파이프라인: 채널 Win Rate를 보수적(50%)으로 잡아 차이 발생.');
  } else if (chGap < 0) {
    console.log('  [채널] 파이프라인 > 추세: 채널 파이프라인 후기 Stage에 집중되어 전환 확률 높음.');
  }

  // 진척률 분석
  console.log('\n### 해석');
  const progressRate = (DATA_DAYS / TOTAL_DAYS * 100).toFixed(0);
  console.log(`  1. 현재 진척률: 기간 ${progressRate}% 경과 시점에서 합계 ${linear.currentTotal}건 달성.`);
  console.log(`     단순 비례 시 월말 예상 ${Math.round(linear.currentTotal / DATA_DAYS * TOTAL_DAYS)}건이나,`);
  console.log(`     주말 효과 및 영업일 가중치를 반영하면 ${linear.forecastTotal}건 (추세 기반).`);

  const weekdaysPassed = countWeekdays('2026-04-01', '2026-04-21');
  const weekdaysRemain = countWeekdays('2026-04-22', '2026-04-30');
  console.log(`  2. 영업일 기준: 경과 ${weekdaysPassed}일 / 잔여 ${weekdaysRemain}일.`);
  console.log(`     후반 9일 중 주말 ${linear.remainWeekends}일 포함. 실질 영업일 ${linear.remainWeekdays}일.`);
  console.log(`     주말 CW 증분 중앙값이 ${linear.inbMedianWeekend + linear.chMedianWeekend}건으로 영업일 대비 낮아 후반 감속 구조.`);

  console.log(`  3. 이월건 효과: 4/1~4/3에 대량 이월건 처리(일 증분 30건 이상)가 관측됨.`);
  console.log(`     이월건 소진 후 4월 중후반 일별 증분이 안정화되었으므로, 선형 추세가 이를 반영.`);
  console.log(`  4. 리스크: 파이프라인의 견적 Stage 비중이 높아(인바운드 ${pipeline.inbStages.find(s => s.stage === '견적')?.count || 0}건) CW 전환까지 시간 부족 가능.`);
  console.log(`     잔여 9일 < 견적→CW 중앙값 ${pipeline.stageToCW['견적']?.toFixed(1)}일이므로 견적 Stage 건은 대부분 5월 이월 예상.`);

  // JSON 출력
  const output = {
    generatedAt: new Date().toISOString(),
    period: TARGET_MONTH,
    dataAsOf: LAST_DATA_DATE,
    currentCW: {
      inbound: linear.currentInb,
      channel: linear.currentCh,
      total: linear.currentTotal,
    },
    method1_linear: {
      forecastInbound: linear.forecastInb,
      forecastChannel: linear.forecastCh,
      forecastTotal: linear.forecastTotal,
      confidenceInterval: {
        inbound: { p25: forecastInbLow, p75: forecastInbHigh },
        channel: { p25: forecastChLow, p75: forecastChHigh },
        total: { p25: forecastInbLow + forecastChLow, p75: forecastInbHigh + forecastChHigh },
      },
      params: {
        inbMedianDailyDelta: linear.inbMedianDaily,
        chMedianDailyDelta: linear.chMedianDaily,
        inbMedianWeekendDelta: linear.inbMedianWeekend,
        chMedianWeekendDelta: linear.chMedianWeekend,
        remainWeekdays: linear.remainWeekdays,
        remainWeekends: linear.remainWeekends,
      },
    },
    method2_pipeline: {
      forecastInbound: pipeline.forecastInb,
      forecastChannel: pipeline.forecastCh,
      forecastTotal: pipeline.forecastTotal,
      inboundPipeline: {
        openCount: pipeline.inbOpenCount,
        rawExpected: Math.round(pipeline.inbRawExpected * 10) / 10,
        winRateApplied: Math.round(pipeline.q1WinRate * 1000) / 10,
        additionalCW: pipeline.inbPipelineCW,
        stageBreakdown: pipeline.inbStages,
      },
      channelPipeline: {
        openCount: pipeline.chOpenCount,
        rawExpected: Math.round(pipeline.chRawExpected * 10) / 10,
        winRateApplied: 50,
        additionalCW: pipeline.chPipelineCW,
        stageBreakdown: pipeline.chStages,
      },
    },
    method3_weighted: {
      forecastInbound: weightedInb,
      forecastChannel: weightedCh,
      forecastTotal: weightedTotal,
      weights: { linear: 0.6, pipeline: 0.4 },
    },
    dailyCumulativeCW: dailyData.map(d => ({
      date: d.date,
      inbound: d.inbound,
      channel: d.channel,
      total: d.total,
    })),
  };

  const outPath = path.join(DATA_DIR, 'april-forecast-2026.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n[저장] ${outPath}`);
}

main();
