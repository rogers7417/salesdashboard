/**
 * 콘솔 리포트 출력 모듈
 */

function printConsoleReport(stats) {
  const { summary, partnerStats, franchiseStats, franchiseHQList, ownerStats,
          activePartnerThisMonth, activeHQThisMonth, mouStats, kpi } = stats;

  console.log('\n');
  console.log('═'.repeat(100));
  console.log('📊 채널세일즈 리포트');
  console.log('═'.repeat(100));

  // 전체 요약
  console.log('\n📈 전체 요약');
  console.log('─'.repeat(60));
  console.log(`
[파트너사]
  파트너사         ${summary.totalPartners}개
  소개매장         ${summary.totalPartnerStores}개

[프랜차이즈]
  본사             ${summary.totalFranchiseHQ}개
  브랜드           ${summary.totalFranchiseBrands}개
  가맹점           ${summary.totalFranchiseStores}개

채널 Opportunity ${summary.totalOpportunities}건 (Won: ${summary.wonOpportunities}건, Open: ${summary.openOpportunities}건)
`);

  // 채널 활동 지표
  console.log('\n📋 채널 활동 지표 (LeadSource 기반)');
  console.log('─'.repeat(90));
  console.log(`
[파트너사 소개 Lead]
  총 Lead       ${summary.partnerLeads.total}건
  전환          ${summary.partnerLeads.converted}건 (전환율: ${summary.partnerLeads.conversionRate}%)
  진행중        ${summary.partnerLeads.open}건
  종료/실격     ${summary.partnerLeads.closed}건

[프랜차이즈소개 Lead]
  총 Lead       ${summary.franchiseLeads.total}건
  전환          ${summary.franchiseLeads.converted}건 (전환율: ${summary.franchiseLeads.conversionRate}%)
  진행중        ${summary.franchiseLeads.open}건
  종료/실격     ${summary.franchiseLeads.closed}건
`);

  // 활동 현황
  console.log('\n🔥 활동 현황 (Lead 생성일 기준)');
  console.log('─'.repeat(90));
  console.log(`
[이번 달 (${summary.activity.thisMonth})]
  활동 파트너사      ${summary.activity.activePartnerThisMonth}개
  활동 프랜차이즈본사  ${summary.activity.activeHQThisMonth}개

[최근 3개월 (${summary.activity.threeMonthsAgo} ~ ${summary.activity.thisMonth})]
  활동 파트너사      ${summary.activity.activePartnerLast3Months}개
  활동 프랜차이즈본사  ${summary.activity.activeHQLast3Months}개
`);

  // AM 일별 캘린더 (Account Owner 기준)
  if (summary.channelLeadsByOwner?.amHeatmap?.data?.length > 0) {
    const heatmap = summary.channelLeadsByOwner.amHeatmap;
    const cal = heatmap.calendar;
    console.log(`\n📅 AM 일별 Lead 캘린더 (${cal.year}년 ${cal.month}월)`);
    console.log('─'.repeat(90));
    console.log('파트너/프랜차이즈 계정 소유자(AM)가 관리하는 곳에서 발생한 Lead');
    console.log('* 0 = 평일에 Lead 0건 (주말 제외)');
    console.log('─'.repeat(90));

    // 날짜 헤더 (1일부터 오늘까지)
    const dayHeader = 'AM'.padEnd(12) +
      Array.from({length: cal.today}, (_, i) => String(i + 1).padStart(3)).join('') +
      '  합계  0건일';
    console.log(dayHeader);
    console.log('─'.repeat(90));

    // AM별 데이터
    heatmap.data.forEach(row => {
      const cells = row.dailyData.map(d => {
        if (d.count === 0) {
          return d.isWeekend ? '  -' : '  0';  // 주말은 -, 평일 0건은 0
        }
        return String(d.count).padStart(3);
      }).join('');
      const zeroDaysStr = row.zeroDays > 0 ? String(row.zeroDays).padStart(6) : '     -';
      console.log(row.owner.substring(0, 10).padEnd(12) + cells + String(row.total).padStart(6) + zeroDaysStr);
    });
  }

  // TM 파트 - MQL/SQL 현황
  if (summary.channelLeadsByOwner && summary.channelLeadsByOwner.data.length > 0) {
    console.log(`\n📊 TM 파트 - MQL/SQL 현황 (${summary.channelLeadsByOwner.thisMonth})`);
    console.log('─'.repeat(75));
    console.log(`* 오인입/중복유입/오생성 제외 후 MQL 산정\n`);
    console.log(`  전체 Lead: ${summary.channelLeadsByOwner.total}건`);
    console.log(`  제외: ${summary.channelLeadsByOwner.totalExcluded}건 (오인입/중복/오생성)`);
    console.log(`  MQL (유효): ${summary.channelLeadsByOwner.totalMQL}건`);
    console.log(`  SQL (전환): ${summary.channelLeadsByOwner.totalSQL}건`);
    console.log(`  전환율: ${summary.channelLeadsByOwner.conversionRate}%`);
    console.log('─'.repeat(75));
    console.log('소유자'.padEnd(12) + '전체'.padStart(8) + '제외'.padStart(8) + 'MQL'.padStart(8) + 'SQL'.padStart(8) + '전환율'.padStart(10));
    console.log('─'.repeat(75));
    summary.channelLeadsByOwner.data.forEach(o => {
      console.log(
        o.owner.padEnd(12) +
        String(o.total).padStart(8) +
        String(o.excluded).padStart(8) +
        String(o.mql).padStart(8) +
        String(o.sql).padStart(8) +
        (o.conversionRate + '%').padStart(10)
      );
    });
    console.log('─'.repeat(75));
    console.log(
      '합계'.padEnd(12) +
      String(summary.channelLeadsByOwner.total).padStart(8) +
      String(summary.channelLeadsByOwner.totalExcluded).padStart(8) +
      String(summary.channelLeadsByOwner.totalMQL).padStart(8) +
      String(summary.channelLeadsByOwner.totalSQL).padStart(8) +
      (summary.channelLeadsByOwner.conversionRate + '%').padStart(10)
    );

    // 일별 히트맵
    if (summary.channelLeadsByOwner.heatmap && summary.channelLeadsByOwner.heatmap.data.length > 0) {
      const heatmap = summary.channelLeadsByOwner.heatmap;
      console.log('\n📅 일별 Lead 히트맵');
      console.log('─'.repeat(90));

      // 헤더 (날짜)
      const dayHeader = '담당자'.padEnd(10) + heatmap.days.map(d => String(parseInt(d)).padStart(3)).join('') + '  합계';
      console.log(dayHeader);
      console.log('─'.repeat(90));

      // 담당자별 데이터
      heatmap.data.forEach(row => {
        const cells = row.dailyData.map(d => {
          if (d.count === 0) return '  ·';
          return String(d.count).padStart(3);
        }).join('');
        console.log(row.owner.substring(0, 8).padEnd(10) + cells + String(row.total).padStart(6));
      });
    }

    // FRT (First Response Time)
    if (summary.channelLeadsByOwner.frt) {
      console.log('\n⏱️  First Response Time (FRT)');
      console.log('─'.repeat(50));
      console.log(`  MQL Lead: ${summary.channelLeadsByOwner.frt.totalMQL}건`);
      console.log(`  Task 있음: ${summary.channelLeadsByOwner.frt.withTask}건`);
      console.log(`  20분 초과: ${summary.channelLeadsByOwner.frt.over20}건 (목표: 0건)`);
      console.log(`  평균 FRT: ${summary.channelLeadsByOwner.frt.avgFRT}분`);
    }

    // MQL → SQL 미전환
    if (summary.channelLeadsByOwner.notConverted) {
      console.log('\n⚠️  MQL → SQL 미전환 현황');
      console.log('─'.repeat(50));
      console.log(`  미전환 건수: ${summary.channelLeadsByOwner.notConverted.total}건 (목표: 0건)`);
      if (summary.channelLeadsByOwner.notConverted.byOwner.length > 0) {
        summary.channelLeadsByOwner.notConverted.byOwner.forEach(o => {
          console.log(`    ${o.owner}: ${o.count}건`);
        });
      }
    }

    // SQL 파이프라인
    if (summary.channelLeadsByOwner.sqlPipeline) {
      const pl = summary.channelLeadsByOwner.sqlPipeline;
      console.log('\n📊 SQL 파이프라인 (이번달 전환 Opportunity)');
      console.log('─'.repeat(90));
      console.log(`  전체: ${pl.total}건 | CW: ${pl.cw}건 | CL: ${pl.cl}건 | 진행중: ${pl.open}건`);

      // Stage별 분포
      if (pl.byStageList && pl.byStageList.length > 0) {
        console.log('\n  [Stage별]');
        pl.byStageList.forEach(s => {
          console.log(`    ${s.stage.padEnd(20)} ${s.count}건`);
        });
      }

      // Aging 분포
      console.log('\n  [진행중 Aging]');
      console.log(`    3일 이내: ${pl.byAging.within3}건 | 4~7일: ${pl.byAging.day4to7}건 | 8~14일: ${pl.byAging.day8to14}건 | 14일+: ${pl.byAging.over14}건`);

      // 담당자별
      if (pl.byOwnerList && pl.byOwnerList.length > 0) {
        console.log('\n  [담당자별]');
        console.log('  ' + '담당자'.padEnd(12) + '전체'.padStart(6) + 'CW'.padStart(6) + 'CL'.padStart(6) + '진행중'.padStart(8) + 'CW율'.padStart(8));
        console.log('  ' + '─'.repeat(46));
        pl.byOwnerList.forEach(o => {
          console.log('  ' +
            o.owner.substring(0, 10).padEnd(12) +
            (o.total + '건').padStart(6) +
            (o.cw + '건').padStart(6) +
            (o.cl + '건').padStart(6) +
            (o.open + '건').padStart(8) +
            (o.cwRate + '%').padStart(8)
          );
        });
      }

      // 14일+ 경과 건
      const over14 = pl.openList?.filter(o => o.ageInDays > 14) || [];
      if (over14.length > 0) {
        console.log('\n  ⚠️  14일+ 경과 건 (액션 필요)');
        console.log('  ' + '─'.repeat(70));
        over14.slice(0, 5).forEach(o => {
          console.log(`    ${o.oppName?.substring(0, 20).padEnd(22) || '-'} | ${o.stage.padEnd(15)} | ${o.ageInDays}일 | ${o.owner}`);
        });
        if (over14.length > 5) {
          console.log(`    ... 외 ${over14.length - 5}건`);
        }
      }
    }
  }

  // MOU 체결 현황
  console.log('\n📝 MOU 체결 현황 및 초기 안착률');
  console.log('─'.repeat(90));
  console.log(`
[이번 달 MOU 체결 (${summary.mou.thisMonth})]
  파트너사          ${summary.mou.partner.thisMonth}개
  프랜차이즈본사     ${summary.mou.franchiseHQ.thisMonth}개

[최근 3개월 MOU 체결 (${summary.mou.threeMonthsAgo} ~ ${summary.mou.thisMonth})]
  파트너사          ${summary.mou.partner.last3Months}개
  프랜차이즈본사     ${summary.mou.franchiseHQ.last3Months}개

[초기 안착률 - 최근 3개월 MOU 체결 기준]
  파트너사          ${summary.mou.onboarding.partner.settled}/${summary.mou.onboarding.partner.total}개 (${summary.mou.onboarding.partner.rate}%)
  프랜차이즈본사     ${summary.mou.onboarding.franchiseHQ.settled}/${summary.mou.onboarding.franchiseHQ.total}개 (${summary.mou.onboarding.franchiseHQ.rate}%)
  프랜차이즈브랜드   ${summary.mou.onboarding.franchiseBrand.settled}/${summary.mou.onboarding.franchiseBrand.total}개 (${summary.mou.onboarding.franchiseBrand.rate}%)
`);

  // 이번 달 MOU 체결 파트너사
  if (mouStats?.partner?.thisMonthList?.length > 0) {
    console.log(`\n📝 이번 달 MOU 체결 파트너사 (${mouStats.partner.thisMonthList.length}개)`);
    console.log('─'.repeat(100));
    console.log('파트너명'.padEnd(30) + '담당자'.padStart(10) + 'MOU시작'.padStart(14) + 'Lead생산'.padStart(10) + '안착'.padStart(8));
    console.log('─'.repeat(100));
    mouStats.partner.thisMonthList.forEach(p => {
      const settled = p.isSettled !== undefined ? (p.isSettled ? '✓' : '-') : (p.sourceLeadCount > 0 ? '✓' : '-');
      console.log(
        p.name.substring(0, 28).padEnd(30) +
        p.owner.substring(0, 8).padStart(10) +
        (p.mouStart || '-').padStart(14) +
        String(p.leadCountWithinWindow || p.sourceLeadCount || 0).padStart(10) +
        settled.padStart(8)
      );
    });
  }

  // 이번 달 MOU 체결 프랜차이즈 본사
  if (mouStats?.franchiseHQ?.thisMonthList?.length > 0) {
    console.log(`\n📝 이번 달 MOU 체결 프랜차이즈 본사 (${mouStats.franchiseHQ.thisMonthList.length}개)`);
    console.log('─'.repeat(100));
    console.log('본사명'.padEnd(35) + 'MOU시작'.padStart(14) + 'Lead생산'.padStart(10) + '안착'.padStart(8));
    console.log('─'.repeat(100));
    mouStats.franchiseHQ.thisMonthList.forEach(hq => {
      const settled = hq.isSettled !== undefined ? (hq.isSettled ? '✓' : '-') : (hq.totalLeads > 0 ? '✓' : '-');
      console.log(
        hq.hqName.substring(0, 33).padEnd(35) +
        (hq.mouStart || '-').padStart(14) +
        String(hq.leadCountWithinWindow || hq.totalLeads || 0).padStart(10) +
        settled.padStart(8)
      );
    });
  }

  console.log('\n' + '═'.repeat(100));
}

module.exports = { printConsoleReport };
