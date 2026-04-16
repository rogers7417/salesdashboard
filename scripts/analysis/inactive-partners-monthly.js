require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

async function getSalesforceToken() {
  const url = process.env.SF_LOGIN_URL + '/services/oauth2/token';
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', process.env.SF_CLIENT_ID);
  params.append('client_secret', process.env.SF_CLIENT_SECRET);
  params.append('username', process.env.SF_USERNAME);
  params.append('password', decodeURIComponent(process.env.SF_PASSWORD));
  const res = await axios.post(url, params);
  return { accessToken: res.data.access_token, instanceUrl: res.data.instance_url };
}

async function query(instanceUrl, accessToken, soql) {
  var allRecords = [];
  var url = instanceUrl + '/services/data/v59.0/query?q=' + encodeURIComponent(soql);

  while (url) {
    var res = await axios.get(url, {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    allRecords = allRecords.concat(res.data.records);
    url = res.data.nextRecordsUrl ? (instanceUrl + res.data.nextRecordsUrl) : null;
  }
  return allRecords;
}

async function main() {
  var { accessToken, instanceUrl } = await getSalesforceToken();
  console.log('✅ Salesforce 연결 성공\n');

  // 기존 파일 로드
  console.log('📋 Inactive_Partners_2025_Detail_Opp_CW.json 로드 중...');
  var partners = JSON.parse(fs.readFileSync('Inactive_Partners_2025_Detail_Opp_CW.json', 'utf8'));
  console.log('   ' + partners.length + '개 파트너사\n');

  // 조회 기간 설정 (2024년 1월 ~ 2026년 2월)
  var months = [];
  for (var year = 2024; year <= 2026; year++) {
    var maxMonth = (year === 2026) ? 2 : 12;
    for (var month = 1; month <= maxMonth; month++) {
      var monthStr = year + '-' + String(month).padStart(2, '0');
      months.push(monthStr);
    }
  }
  console.log('📅 조회 기간: ' + months[0] + ' ~ ' + months[months.length - 1] + ' (' + months.length + '개월)\n');

  // 각 파트너사별 월별 Lead 조회
  console.log('📋 파트너사별 월별 Lead 조회 중...');
  var result = [];
  var count = 0;

  for (var partner of partners) {
    count++;
    if (count % 50 === 0) {
      console.log('   진행: ' + count + '/' + partners.length);
    }

    var partnerId = partner.partnerId;

    try {
      // 해당 파트너의 모든 Lead 조회 (CreatedDate 포함)
      var leadsQuery = 'SELECT Id, CreatedDate, IsConverted FROM Lead WHERE PartnerName__c = \'' + partnerId + '\' ORDER BY CreatedDate';
      var leads = await query(instanceUrl, accessToken, leadsQuery);

      // 월별 집계
      var monthlyLeads = {};
      months.forEach(function(m) { monthlyLeads[m] = 0; });

      leads.forEach(function(lead) {
        var leadMonth = lead.CreatedDate.substring(0, 7); // "2025-01"
        if (monthlyLeads.hasOwnProperty(leadMonth)) {
          monthlyLeads[leadMonth]++;
        }
      });

      // 활동 월 / 비활동 월 계산
      var activeMonths = [];
      var inactiveMonths = [];
      months.forEach(function(m) {
        if (monthlyLeads[m] > 0) {
          activeMonths.push(m);
        } else {
          inactiveMonths.push(m);
        }
      });

      // MOU 이후 월만 필터 (mouContractDate 이후)
      var mouDate = partner.mouContractDate || partner.mouStartDate;
      var monthsAfterMou = [];
      var inactiveAfterMou = [];

      if (mouDate) {
        var mouMonth = mouDate.substring(0, 7);
        months.forEach(function(m) {
          if (m >= mouMonth) {
            monthsAfterMou.push(m);
            if (monthlyLeads[m] === 0) {
              inactiveAfterMou.push(m);
            }
          }
        });
      }

      // 연속 비활동 기간 계산 (최근부터)
      var consecutiveInactive = 0;
      for (var i = months.length - 1; i >= 0; i--) {
        if (monthlyLeads[months[i]] === 0) {
          consecutiveInactive++;
        } else {
          break;
        }
      }

      result.push({
        // 기존 정보 유지
        partnerId: partner.partnerId,
        partnerName: partner.partnerName,
        totalLeads: partner.totalLeads,
        lastLeadDate: partner.lastLeadDate,
        mouYn: partner.mouYn,
        mouStartDate: partner.mouStartDate,
        mouEndDate: partner.mouEndDate,
        mouContractDate: partner.mouContractDate,
        industry: partner.industry,
        businessType: partner.businessType,
        partnerType: partner.partnerType,
        ownerName: partner.ownerName,
        phone: partner.phone,
        convertedCount: partner.convertedCount,
        conversionRate: partner.conversionRate,
        opportunityCount: partner.opportunityCount,
        cwCount: partner.cwCount,
        cwConversionRate: partner.cwConversionRate,

        // 월별 Lead 현황 추가
        monthlyLeads: monthlyLeads,
        activeMonthCount: activeMonths.length,
        inactiveMonthCount: inactiveMonths.length,
        activeMonths: activeMonths,
        inactiveMonths: inactiveMonths,
        consecutiveInactiveMonths: consecutiveInactive,

        // MOU 이후 비활동 월
        mouMonth: mouDate ? mouDate.substring(0, 7) : null,
        monthsAfterMouCount: monthsAfterMou.length,
        inactiveAfterMouCount: inactiveAfterMou.length,
        inactiveAfterMou: inactiveAfterMou
      });
    } catch (e) {
      console.log('   - ' + partner.partnerName + ': 조회 오류 - ' + e.message);
    }
  }

  // 연속 비활동 월 기준 정렬 (많은 순)
  result.sort(function(a, b) { return b.consecutiveInactiveMonths - a.consecutiveInactiveMonths; });

  // JSON 저장
  var filename = 'Inactive_Partners_2025_Monthly.json';
  fs.writeFileSync(filename, JSON.stringify(result, null, 2));
  console.log('\n📁 파일 저장: ' + filename);
  console.log('   총 ' + result.length + '개 파트너사');

  // 통계 출력
  console.log('\n=== 연속 비활동 월 분포 ===');
  var inactiveGroups = {
    '1개월': result.filter(function(p) { return p.consecutiveInactiveMonths === 1; }).length,
    '2개월': result.filter(function(p) { return p.consecutiveInactiveMonths === 2; }).length,
    '3-6개월': result.filter(function(p) { return p.consecutiveInactiveMonths >= 3 && p.consecutiveInactiveMonths <= 6; }).length,
    '7-12개월': result.filter(function(p) { return p.consecutiveInactiveMonths >= 7 && p.consecutiveInactiveMonths <= 12; }).length,
    '13개월 이상': result.filter(function(p) { return p.consecutiveInactiveMonths >= 13; }).length,
  };
  Object.entries(inactiveGroups).forEach(function(entry) {
    console.log('   ' + entry[0] + ': ' + entry[1] + '개');
  });

  // 샘플 출력
  console.log('\n=== 연속 비활동 최다 파트너사 (상위 5개) ===');
  result.slice(0, 5).forEach(function(p, i) {
    console.log((i + 1) + '. ' + p.partnerName);
    console.log('   - 연속 비활동: ' + p.consecutiveInactiveMonths + '개월');
    console.log('   - 마지막 Lead: ' + p.lastLeadDate);
    console.log('   - MOU 이후 비활동: ' + p.inactiveAfterMouCount + '/' + p.monthsAfterMouCount + '개월');

    // 최근 6개월 현황
    var recent6 = months.slice(-6).map(function(m) {
      return m.substring(5) + ':' + p.monthlyLeads[m];
    }).join(' | ');
    console.log('   - 최근 6개월: ' + recent6);
  });

  // CSV 저장
  var csvFilename = 'Inactive_Partners_2025_Monthly.csv';
  var csvHeader = [
    'partnerId', 'partnerName', 'totalLeads', 'lastLeadDate',
    'mouContractDate', 'ownerName', 'partnerType',
    'conversionRate', 'cwConversionRate',
    'activeMonthCount', 'inactiveMonthCount', 'consecutiveInactiveMonths',
    'inactiveAfterMouCount', 'monthsAfterMouCount'
  ];

  // 월별 컬럼 추가
  months.forEach(function(m) {
    csvHeader.push(m);
  });

  var csvRows = result.map(function(p) {
    var base = [
      p.partnerId,
      '"' + (p.partnerName || '').replace(/"/g, '""') + '"',
      p.totalLeads,
      p.lastLeadDate,
      p.mouContractDate || '',
      '"' + (p.ownerName || '').replace(/"/g, '""') + '"',
      p.partnerType || '',
      p.conversionRate,
      p.cwConversionRate,
      p.activeMonthCount,
      p.inactiveMonthCount,
      p.consecutiveInactiveMonths,
      p.inactiveAfterMouCount,
      p.monthsAfterMouCount
    ];

    // 월별 Lead 수 추가
    months.forEach(function(m) {
      base.push(p.monthlyLeads[m] || 0);
    });

    return base.join(',');
  });

  fs.writeFileSync(csvFilename, csvHeader.join(',') + '\n' + csvRows.join('\n'));
  console.log('\n📁 CSV 저장: ' + csvFilename);
}

main().catch(console.error);
