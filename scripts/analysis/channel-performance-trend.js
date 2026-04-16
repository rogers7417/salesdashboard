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

async function soqlQueryAll(instanceUrl, accessToken, query) {
  let allRecords = [];
  let result = await soqlQuery(instanceUrl, accessToken, query);
  allRecords.push(...(result.records || []));

  while (result.nextRecordsUrl) {
    const nextUrl = `${instanceUrl}${result.nextRecordsUrl}`;
    const res = await axios.get(nextUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    result = res.data;
    allRecords.push(...(result.records || []));
  }

  return allRecords;
}

// ============================================
// 메인
// ============================================
async function main() {
  const startMonth = process.argv[2] || '2025-08';
  const endMonth = process.argv[3] || new Date().toISOString().substring(0, 7);

  console.log(`📊 채널세일즈 담당자별 성과 추이`);
  console.log(`📅 기간: ${startMonth} ~ ${endMonth}\n`);

  const { accessToken, instanceUrl } = await getSalesforceToken();
  console.log('✅ Salesforce 연결 성공\n');

  // 1. 채널세일즈팀 조회
  const userQuery = `SELECT Id, Name FROM User WHERE Department = '채널세일즈팀' AND IsActive = true ORDER BY Name`;
  const userResult = await soqlQuery(instanceUrl, accessToken, userQuery);
  const users = userResult.records || [];
  console.log(`👥 채널세일즈팀: ${users.length}명`);

  const userMap = {};
  users.forEach(u => { userMap[u.Id] = u.Name; });

  // 2. 파트너사 + 프랜차이즈 브랜드 조회 (Owner 정보 포함)
  const partnerQuery = `
    SELECT Id, Name, OwnerId, Owner.Name, MOUstartdate__c, fm_AccountType__c
    FROM Account
    WHERE fm_AccountType__c IN ('파트너사', '프랜차이즈(브랜드)')
  `;
  const partners = await soqlQueryAll(instanceUrl, accessToken, partnerQuery);
  console.log(`📦 파트너사/프랜차이즈: ${partners.length}건`);

  // Account ID → Owner 매핑
  const accountOwnerMap = {};
  partners.forEach(p => {
    accountOwnerMap[p.Id] = { ownerId: p.OwnerId, ownerName: p.Owner?.Name || '미배정' };
  });

  // 3. 전체 기간 Lead 조회 (파트너사 소개 + 프랜차이즈소개)
  const leadQuery = `
    SELECT Id, CreatedDate, OwnerId, Owner.Name, PartnerName__c, LeadSource, IsConverted
    FROM Lead
    WHERE LeadSource IN ('파트너사 소개', '프랜차이즈소개')
    AND CreatedDate >= ${startMonth}-01T00:00:00Z
    ORDER BY CreatedDate
  `;
  const leads = await soqlQueryAll(instanceUrl, accessToken, leadQuery);
  console.log(`📋 채널 Lead: ${leads.length}건`);

  // 4. 전체 기간 Opportunity CW 조회 (계약 시작일 기준으로 하려면 contracts API 사용)
  // 일단 CloseDate 기준으로 조회, 필요시 contracts API로 변경 가능
  const channelUserIds = users.map(u => "'" + u.Id + "'").join(',');
  const oppQuery = `
    SELECT Id, Name, StageName, CloseDate, OwnerId, Owner.Name, Amount
    FROM Opportunity
    WHERE OwnerId IN (${channelUserIds})
    AND StageName = 'Closed Won'
    AND CloseDate >= ${startMonth}-01
    ORDER BY CloseDate
  `;
  const cwOpps = await soqlQueryAll(instanceUrl, accessToken, oppQuery);
  console.log(`🏆 CW Opportunity: ${cwOpps.length}건`);

  // 5. MOU 신규 체결 (MOUstartdate__c 기준)
  const mouAccounts = partners.filter(p => p.MOUstartdate__c && p.MOUstartdate__c >= `${startMonth}-01`);
  console.log(`📝 MOU 신규 체결: ${mouAccounts.length}건\n`);

  // ============================================
  // 월별 집계
  // ============================================
  const months = [];
  let current = new Date(startMonth + '-01');
  const end = new Date(endMonth + '-01');
  while (current <= end) {
    months.push(current.toISOString().substring(0, 7));
    current.setMonth(current.getMonth() + 1);
  }

  // 담당자별 월별 데이터 구조 초기화
  const performanceData = {};
  users.forEach(u => {
    performanceData[u.Name] = {
      id: u.Id,
      months: {}
    };
    months.forEach(m => {
      performanceData[u.Name].months[m] = {
        leads: 0,        // 파트너사에서 생산된 Lead (파트너 소유자 기준)
        mou: 0,          // MOU 신규 체결
        cw: 0,           // CW 건수
        cwAmount: 0      // CW 금액
      };
    });
  });

  // Lead 집계 (파트너사 소유자 기준)
  leads.forEach(l => {
    const month = l.CreatedDate?.substring(0, 7);
    if (!month || !months.includes(month)) return;

    // 파트너사의 소유자 찾기
    const partnerOwner = accountOwnerMap[l.PartnerName__c];
    if (partnerOwner && performanceData[partnerOwner.ownerName]) {
      performanceData[partnerOwner.ownerName].months[month].leads++;
    }
  });

  // MOU 집계
  mouAccounts.forEach(a => {
    const month = a.MOUstartdate__c?.substring(0, 7);
    if (!month || !months.includes(month)) return;

    const ownerName = a.Owner?.Name;
    if (ownerName && performanceData[ownerName]) {
      performanceData[ownerName].months[month].mou++;
    }
  });

  // CW 집계
  cwOpps.forEach(o => {
    const month = o.CloseDate?.substring(0, 7);
    if (!month || !months.includes(month)) return;

    const ownerName = o.Owner?.Name;
    if (ownerName && performanceData[ownerName]) {
      performanceData[ownerName].months[month].cw++;
      performanceData[ownerName].months[month].cwAmount += (o.Amount || 0);
    }
  });

  // ============================================
  // 결과 출력
  // ============================================
  console.log('═'.repeat(100));
  console.log('📈 담당자별 월별 성과 추이');
  console.log('═'.repeat(100));

  // 각 지표별 테이블 출력
  const metrics = [
    { key: 'leads', label: '🎯 Lead 생산량 (파트너사 소유자 기준)' },
    { key: 'mou', label: '📝 MOU 신규 체결' },
    { key: 'cw', label: '🏆 CW 건수' }
  ];

  metrics.forEach(metric => {
    console.log(`\n${metric.label}`);
    console.log('─'.repeat(100));

    // 헤더
    let header = '담당자'.padEnd(12);
    months.forEach(m => { header += m.substring(2).padStart(10); });
    header += '합계'.padStart(10);
    console.log(header);
    console.log('─'.repeat(100));

    // 데이터
    const sortedUsers = Object.keys(performanceData).sort((a, b) => {
      const totalA = months.reduce((sum, m) => sum + performanceData[a].months[m][metric.key], 0);
      const totalB = months.reduce((sum, m) => sum + performanceData[b].months[m][metric.key], 0);
      return totalB - totalA;
    });

    sortedUsers.forEach(name => {
      let row = name.padEnd(12);
      let total = 0;
      months.forEach(m => {
        const val = performanceData[name].months[m][metric.key];
        total += val;
        row += String(val || '-').padStart(10);
      });
      row += String(total).padStart(10);
      console.log(row);
    });

    // 월별 합계
    console.log('─'.repeat(100));
    let totalRow = '월합계'.padEnd(12);
    let grandTotal = 0;
    months.forEach(m => {
      const monthTotal = Object.values(performanceData).reduce((sum, p) => sum + p.months[m][metric.key], 0);
      grandTotal += monthTotal;
      totalRow += String(monthTotal).padStart(10);
    });
    totalRow += String(grandTotal).padStart(10);
    console.log(totalRow);
  });

  // ============================================
  // HTML 리포트 생성
  // ============================================
  const html = generateHtml(performanceData, months, metrics);
  const filename = `ChannelPerformance_${startMonth}_${endMonth}.html`;
  fs.writeFileSync(filename, html);
  console.log(`\n📄 HTML 리포트 생성: ${filename}`);
  console.log(`🌐 브라우저에서 열기: open ${filename}`);

  // JSON 저장
  const jsonFilename = `ChannelPerformance_${startMonth}_${endMonth}.json`;
  fs.writeFileSync(jsonFilename, JSON.stringify({ months, performanceData }, null, 2));
  console.log(`📋 JSON 저장: ${jsonFilename}`);
}

function generateHtml(performanceData, months, metrics) {
  const sortedUsers = Object.keys(performanceData).sort();

  // 각 지표별 총합 계산
  const userTotals = {};
  sortedUsers.forEach(name => {
    userTotals[name] = {
      leads: months.reduce((sum, m) => sum + performanceData[name].months[m].leads, 0),
      mou: months.reduce((sum, m) => sum + performanceData[name].months[m].mou, 0),
      cw: months.reduce((sum, m) => sum + performanceData[name].months[m].cw, 0)
    };
  });

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>채널세일즈 성과 추이 (${months[0]} ~ ${months[months.length-1]})</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #e6edf3; padding: 30px; }
    h1 { font-size: 1.8em; margin-bottom: 10px; }
    h2 { font-size: 1.3em; margin: 30px 0 15px; color: #58a6ff; }
    .subtitle { color: #8b949e; margin-bottom: 30px; }
    .card { background: #161b22; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
    th, td { padding: 10px 8px; text-align: center; border-bottom: 1px solid #30363d; }
    th { background: #21262d; color: #8b949e; font-weight: 500; }
    th:first-child, td:first-child { text-align: left; }
    tr:hover { background: #1f2428; }
    .total-row { background: #21262d; font-weight: 600; }
    .highlight { color: #58a6ff; font-weight: 600; }
    .top1 { background: linear-gradient(90deg, #ffd70033, transparent); }
    .top2 { background: linear-gradient(90deg, #c0c0c033, transparent); }
    .top3 { background: linear-gradient(90deg, #cd7f3233, transparent); }
    .medal { font-size: 1.2em; margin-right: 5px; }
    .chart-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; margin-top: 20px; }
    .mini-chart { background: #21262d; border-radius: 8px; padding: 15px; }
    .mini-chart h4 { margin-bottom: 10px; font-size: 0.95em; }
    .bar-container { display: flex; align-items: center; margin: 5px 0; }
    .bar-label { width: 60px; font-size: 0.8em; color: #8b949e; }
    .bar { height: 20px; background: #238636; border-radius: 3px; margin-right: 8px; min-width: 2px; }
    .bar-value { font-size: 0.85em; color: #e6edf3; }
  </style>
</head>
<body>
  <h1>📊 채널세일즈 담당자별 성과 추이</h1>
  <p class="subtitle">기간: ${months[0]} ~ ${months[months.length-1]} (${months.length}개월)</p>

  ${metrics.map(metric => {
    // 총합 기준 정렬
    const ranked = sortedUsers.slice().sort((a, b) => userTotals[b][metric.key] - userTotals[a][metric.key]);

    return `
  <div class="card">
    <h2>${metric.label}</h2>
    <table>
      <thead>
        <tr>
          <th style="width:120px;">담당자</th>
          ${months.map(m => `<th>${m.substring(2)}</th>`).join('')}
          <th style="background:#2d333b;">합계</th>
        </tr>
      </thead>
      <tbody>
        ${ranked.map((name, idx) => {
          const data = performanceData[name];
          const total = userTotals[name][metric.key];
          const rankClass = idx === 0 ? 'top1' : idx === 1 ? 'top2' : idx === 2 ? 'top3' : '';
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '';
          return `
        <tr class="${rankClass}">
          <td><span class="medal">${medal}</span>${name}</td>
          ${months.map(m => {
            const val = data.months[m][metric.key];
            return `<td${val > 0 ? ' class="highlight"' : ''}>${val || '-'}</td>`;
          }).join('')}
          <td style="background:#2d333b; font-weight:600; color:#58a6ff;">${total}</td>
        </tr>`;
        }).join('')}
        <tr class="total-row">
          <td>월합계</td>
          ${months.map(m => {
            const monthTotal = Object.values(performanceData).reduce((sum, p) => sum + p.months[m][metric.key], 0);
            return `<td>${monthTotal}</td>`;
          }).join('')}
          <td style="background:#2d333b;">${Object.values(userTotals).reduce((sum, t) => sum + t[metric.key], 0)}</td>
        </tr>
      </tbody>
    </table>
  </div>`;
  }).join('')}

  <div class="card">
    <h2>📈 담당자별 총합 비교</h2>
    <div class="chart-container">
      ${metrics.map(metric => {
        const maxVal = Math.max(...sortedUsers.map(n => userTotals[n][metric.key]));
        const ranked = sortedUsers.slice().sort((a, b) => userTotals[b][metric.key] - userTotals[a][metric.key]);
        return `
      <div class="mini-chart">
        <h4>${metric.label}</h4>
        ${ranked.slice(0, 10).map(name => {
          const val = userTotals[name][metric.key];
          const width = maxVal > 0 ? (val / maxVal * 100) : 0;
          return `
        <div class="bar-container">
          <span class="bar-label">${name.substring(0, 4)}</span>
          <div class="bar" style="width:${width}%;"></div>
          <span class="bar-value">${val}</span>
        </div>`;
        }).join('')}
      </div>`;
      }).join('')}
    </div>
  </div>

</body>
</html>`;
}

main().catch(console.error);
