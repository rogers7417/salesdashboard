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
  let allRecords = [];
  let url = instanceUrl + '/services/data/v59.0/query?q=' + encodeURIComponent(soql);

  while (url) {
    const res = await axios.get(url, {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    allRecords = allRecords.concat(res.data.records);
    url = res.data.nextRecordsUrl ? (instanceUrl + res.data.nextRecordsUrl) : null;
  }
  return allRecords;
}

async function main() {
  const { accessToken, instanceUrl } = await getSalesforceToken();
  console.log('✅ Salesforce 연결 성공\n');

  // 기존 Inactive_Partners_2025.json 로드
  console.log('📋 Inactive_Partners_2025.json 로드 중...');
  const inactivePartners = JSON.parse(fs.readFileSync('Inactive_Partners_2025.json', 'utf8'));
  console.log('   ' + inactivePartners.length + '개 파트너사\n');

  // 각 파트너사별 전체 전환율 + 최근 5개 Lead 조회
  console.log('📋 파트너사별 전체 전환율 및 최근 5개 Lead 조회 중...');
  const result = [];
  let count = 0;

  for (const partner of inactivePartners) {
    count++;
    if (count % 50 === 0) {
      console.log('   진행: ' + count + '/' + inactivePartners.length);
    }

    const partnerId = partner.partnerId;

    try {
      // 1. 전체 Lead에서 전환율 계산 (ConvertedOpportunityId 포함)
      const allLeadsQuery = 'SELECT Id, IsConverted, Status, ConvertedOpportunityId FROM Lead WHERE PartnerName__c = \'' + partnerId + '\'';
      const allLeads = await query(instanceUrl, accessToken, allLeadsQuery);

      const totalLeadCount = allLeads.length;
      const totalConvertedCount = allLeads.filter(function(l) { return l.IsConverted; }).length;
      const totalConversionRate = totalLeadCount > 0 ? Math.round((totalConvertedCount / totalLeadCount) * 100) : 0;

      // 2. 전환된 Lead의 Opportunity CW 전환율 계산
      const convertedOppIds = allLeads
        .filter(function(l) { return l.ConvertedOpportunityId; })
        .map(function(l) { return l.ConvertedOpportunityId; });

      let cwCount = 0;
      let oppCount = convertedOppIds.length;
      let oppStageCounts = {};

      if (convertedOppIds.length > 0) {
        // Opportunity 조회 (200개씩 chunk)
        for (var i = 0; i < convertedOppIds.length; i += 200) {
          var chunk = convertedOppIds.slice(i, i + 200);
          var ids = chunk.map(function(id) { return "'" + id + "'"; }).join(',');
          var oppQuery = 'SELECT Id, StageName FROM Opportunity WHERE Id IN (' + ids + ')';
          var opps = await query(instanceUrl, accessToken, oppQuery);

          opps.forEach(function(opp) {
            oppStageCounts[opp.StageName] = (oppStageCounts[opp.StageName] || 0) + 1;
            if (opp.StageName === 'Closed Won') {
              cwCount++;
            }
          });
        }
      }

      const cwConversionRate = oppCount > 0 ? Math.round((cwCount / oppCount) * 100) : 0;

      // 전체 Status별 집계
      const totalStatusCounts = {};
      allLeads.forEach(function(l) {
        totalStatusCounts[l.Status] = (totalStatusCounts[l.Status] || 0) + 1;
      });

      // 3. 최근 5개 Lead 상세 조회
      const recentLeadsQuery = 'SELECT Id, Name, Status, CreatedDate, Company, IsConverted, ConvertedDate, ConvertedOpportunityId FROM Lead WHERE PartnerName__c = \'' + partnerId + '\' ORDER BY CreatedDate DESC LIMIT 5';
      const recentLeads = await query(instanceUrl, accessToken, recentLeadsQuery);

      result.push({
        // 파트너사 기본 정보
        partnerId: partner.partnerId,
        partnerName: partner.partnerName,
        totalLeads: totalLeadCount,
        lastLeadDate: partner.lastLeadDate,

        // MOU 정보
        mouYn: partner.mouYn,
        mouStartDate: partner.mouStartDate,
        mouEndDate: partner.mouEndDate,
        mouContractDate: partner.mouContractDate,

        // 업종/업태
        industry: partner.industry,
        businessType: partner.businessType,

        // 파트너 정보
        partnerType: partner.partnerType,
        ownerName: partner.ownerName,
        phone: partner.phone,

        // 전환율 통계 (전체 Lead 기준)
        convertedCount: totalConvertedCount,
        conversionRate: totalConversionRate,
        statusSummary: totalStatusCounts,

        // 영업기회 CW 전환율
        opportunityCount: oppCount,
        cwCount: cwCount,
        cwConversionRate: cwConversionRate,
        oppStageSummary: oppStageCounts,

        // 최근 5개 Lead 상세
        recentLeads: recentLeads.map(function(l) {
          return {
            id: l.Id,
            name: l.Name,
            status: l.Status,
            createdDate: l.CreatedDate.split('T')[0],
            company: l.Company,
            isConverted: l.IsConverted,
            convertedDate: l.ConvertedDate ? l.ConvertedDate.split('T')[0] : null,
            hasOpportunity: !!l.ConvertedOpportunityId
          };
        })
      });
    } catch (e) {
      console.log('   - ' + partner.partnerName + ': 조회 오류 - ' + e.message);
    }
  }

  // 전환율 기준 정렬 (낮은 순)
  result.sort(function(a, b) { return a.conversionRate - b.conversionRate; });

  // JSON 저장
  const filename = 'Inactive_Partners_2025_Detail.json';
  fs.writeFileSync(filename, JSON.stringify(result, null, 2));
  console.log('\n📁 파일 저장: ' + filename);
  console.log('   총 ' + result.length + '개 파트너사');

  // 전환율 분포 통계
  console.log('\n=== 전환율 분포 (전체 Lead 기준) ===');
  const rateGroups = {
    '0%': result.filter(function(p) { return p.conversionRate === 0; }).length,
    '1-20%': result.filter(function(p) { return p.conversionRate > 0 && p.conversionRate <= 20; }).length,
    '21-40%': result.filter(function(p) { return p.conversionRate > 20 && p.conversionRate <= 40; }).length,
    '41-60%': result.filter(function(p) { return p.conversionRate > 40 && p.conversionRate <= 60; }).length,
    '61-80%': result.filter(function(p) { return p.conversionRate > 60 && p.conversionRate <= 80; }).length,
    '81-100%': result.filter(function(p) { return p.conversionRate > 80; }).length,
  };
  Object.entries(rateGroups).forEach(function(entry) {
    console.log('   ' + entry[0] + ': ' + entry[1] + '개');
  });

  // 총 Lead 및 전환 통계
  const totalAllLeads = result.reduce(function(sum, p) { return sum + p.totalLeads; }, 0);
  const totalAllConverted = result.reduce(function(sum, p) { return sum + p.convertedCount; }, 0);
  console.log('\n   총 Lead: ' + totalAllLeads + '건, 전환: ' + totalAllConverted + '건 (' + Math.round(totalAllConverted/totalAllLeads*100) + '%)');

  // CW 전환율 분포 통계
  console.log('\n=== 영업기회 CW 전환율 분포 ===');
  const cwRateGroups = {
    '0%': result.filter(function(p) { return p.cwConversionRate === 0; }).length,
    '1-20%': result.filter(function(p) { return p.cwConversionRate > 0 && p.cwConversionRate <= 20; }).length,
    '21-40%': result.filter(function(p) { return p.cwConversionRate > 20 && p.cwConversionRate <= 40; }).length,
    '41-60%': result.filter(function(p) { return p.cwConversionRate > 40 && p.cwConversionRate <= 60; }).length,
    '61-80%': result.filter(function(p) { return p.cwConversionRate > 60 && p.cwConversionRate <= 80; }).length,
    '81-100%': result.filter(function(p) { return p.cwConversionRate > 80; }).length,
  };
  Object.entries(cwRateGroups).forEach(function(entry) {
    console.log('   ' + entry[0] + ': ' + entry[1] + '개');
  });

  // 총 Opportunity 및 CW 통계
  const totalAllOpps = result.reduce(function(sum, p) { return sum + p.opportunityCount; }, 0);
  const totalAllCW = result.reduce(function(sum, p) { return sum + p.cwCount; }, 0);
  console.log('\n   총 Opportunity: ' + totalAllOpps + '건, CW: ' + totalAllCW + '건 (' + Math.round(totalAllCW/totalAllOpps*100) + '%)');

  // Opportunity Stage 분포
  console.log('\n=== Opportunity Stage 분포 ===');
  const allOppStageCounts = {};
  result.forEach(function(p) {
    Object.entries(p.oppStageSummary).forEach(function(entry) {
      allOppStageCounts[entry[0]] = (allOppStageCounts[entry[0]] || 0) + entry[1];
    });
  });
  Object.entries(allOppStageCounts)
    .sort(function(a, b) { return b[1] - a[1]; })
    .forEach(function(entry) {
      console.log('   ' + entry[0] + ': ' + entry[1] + '건');
    });

  // Status 분포 통계
  console.log('\n=== 전체 Status 분포 ===');
  const allStatusCounts = {};
  result.forEach(function(p) {
    Object.entries(p.statusSummary).forEach(function(entry) {
      allStatusCounts[entry[0]] = (allStatusCounts[entry[0]] || 0) + entry[1];
    });
  });
  Object.entries(allStatusCounts)
    .sort(function(a, b) { return b[1] - a[1]; })
    .forEach(function(entry) {
      console.log('   ' + entry[0] + ': ' + entry[1] + '건');
    });

  // 샘플 출력 (전환율 0% 파트너사)
  console.log('\n=== 전환율 0% 파트너사 샘플 (상위 3개) ===');
  result.filter(function(p) { return p.conversionRate === 0; }).slice(0, 3).forEach(function(p, i) {
    console.log((i + 1) + '. ' + p.partnerName);
    console.log('   - 총 Lead: ' + p.totalLeads + '건, Status: ' + JSON.stringify(p.statusSummary));
    console.log('   - 최근 Lead:');
    p.recentLeads.forEach(function(l) {
      console.log('     · ' + l.createdDate + ' | ' + l.name + ' | ' + l.status);
    });
  });

  // CSV 저장 (요약 정보)
  const csvFilename = 'Inactive_Partners_2025_Detail.csv';
  const csvHeader = [
    'partnerId', 'partnerName', 'totalLeads', 'lastLeadDate',
    'mouYn', 'mouContractDate', 'industry', 'businessType',
    'partnerType', 'ownerName', 'phone',
    'convertedCount', 'conversionRate',
    'opportunityCount', 'cwCount', 'cwConversionRate',
    'lead1_date', 'lead1_name', 'lead1_status', 'lead1_converted',
    'lead2_date', 'lead2_name', 'lead2_status', 'lead2_converted',
    'lead3_date', 'lead3_name', 'lead3_status', 'lead3_converted',
    'lead4_date', 'lead4_name', 'lead4_status', 'lead4_converted',
    'lead5_date', 'lead5_name', 'lead5_status', 'lead5_converted'
  ].join(',');

  const csvRows = result.map(function(p) {
    const base = [
      p.partnerId,
      '"' + (p.partnerName || '').replace(/"/g, '""') + '"',
      p.totalLeads,
      p.lastLeadDate,
      p.mouYn || '',
      p.mouContractDate || '',
      '"' + (p.industry || '').replace(/"/g, '""') + '"',
      '"' + (p.businessType || '').replace(/"/g, '""') + '"',
      p.partnerType || '',
      '"' + (p.ownerName || '').replace(/"/g, '""') + '"',
      p.phone || '',
      p.convertedCount,
      p.conversionRate,
      p.opportunityCount,
      p.cwCount,
      p.cwConversionRate
    ];

    // 5개 Lead 정보 추가
    for (var i = 0; i < 5; i++) {
      var lead = p.recentLeads[i];
      if (lead) {
        base.push(lead.createdDate);
        base.push('"' + (lead.name || '').replace(/"/g, '""') + '"');
        base.push(lead.status || '');
        base.push(lead.isConverted ? 'Y' : 'N');
      } else {
        base.push('', '', '', '');
      }
    }

    return base.join(',');
  });

  fs.writeFileSync(csvFilename, csvHeader + '\n' + csvRows.join('\n'));
  console.log('\n📁 CSV 저장: ' + csvFilename);
}

main().catch(console.error);
