require('dotenv').config({ path: __dirname + '/.env' });
const axios = require('axios');

async function main() {
  // Salesforce 인증
  const url = process.env.SF_LOGIN_URL + '/services/oauth2/token';
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', process.env.SF_CLIENT_ID);
  params.append('client_secret', process.env.SF_CLIENT_SECRET);
  params.append('username', process.env.SF_USERNAME);
  params.append('password', decodeURIComponent(process.env.SF_PASSWORD));

  const auth = await axios.post(url, params);
  const accessToken = auth.data.access_token;
  const instanceUrl = auth.data.instance_url;
  console.log('Salesforce 연결 성공\n');

  // 11월~2월 영업기회 조회
  const startDate = '2025-11-01T00:00:00Z';
  const endDate = '2026-03-01T00:00:00Z';

  const query = `
    SELECT
      Id, Name, StageName, Amount, CloseDate,
      AccountId, Account.Name,
      Account.ShippingAddress__c, Account.RoadAddress__c, Account.JibunAddress__c,
      Account.Industry__c, Account.PLIndustry_First__c, Account.PLIndustry_Second__c, Account.PLIndustry_Third__c,
      Account.StoreType__c, Account.fm_AccountType__c,
      Account.Phone, Account.BillingCity, Account.BillingState,
      Account.LastActivityDate,
      OwnerId, Owner.Name,
      CreatedDate, IsClosed, IsWon,
      LeadSource, Loss_Reason__c,
      RecordType.Name,
      LastActivityDate, LastModifiedDate,
      (SELECT ContactId, Contact.Name, Contact.Phone, Contact.MobilePhone, Contact.Email
       FROM OpportunityContactRoles
       WHERE IsPrimary = true LIMIT 1)
    FROM Opportunity
    WHERE CreatedDate >= ${startDate}
      AND CreatedDate < ${endDate}
    ORDER BY CreatedDate DESC
  `;

  // 페이징 처리
  let allRecords = [];
  let nextUrl = `${instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(query)}`;

  while (nextUrl) {
    const res = await axios.get(nextUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    allRecords.push(...res.data.records);
    nextUrl = res.data.nextRecordsUrl ? `${instanceUrl}${res.data.nextRecordsUrl}` : null;
  }

  console.log(`총 ${allRecords.length}건의 영업기회 조회됨\n`);

  // 월별 집계
  const byMonth = {};
  allRecords.forEach(opp => {
    const month = opp.CreatedDate.substring(0, 7);
    if (!byMonth[month]) byMonth[month] = { total: 0, won: 0, lost: 0, open: 0, amount: 0 };
    byMonth[month].total++;
    if (opp.IsWon) byMonth[month].won++;
    else if (opp.IsClosed) byMonth[month].lost++;
    else byMonth[month].open++;
    byMonth[month].amount += (opp.Amount || 0);
  });

  console.log('=== 월별 집계 ===');
  console.log('월'.padEnd(10) + '전체'.padStart(8) + 'Won'.padStart(8) + 'Lost'.padStart(8) + 'Open'.padStart(8));
  console.log('─'.repeat(42));
  Object.entries(byMonth).sort().forEach(([month, data]) => {
    console.log(
      month.padEnd(10) +
      String(data.total).padStart(8) +
      String(data.won).padStart(8) +
      String(data.lost).padStart(8) +
      String(data.open).padStart(8)
    );
  });

  // Stage별 집계
  console.log('\n=== Stage별 집계 ===');
  const byStage = {};
  allRecords.forEach(opp => {
    const stage = opp.StageName || '(없음)';
    byStage[stage] = (byStage[stage] || 0) + 1;
  });
  Object.entries(byStage)
    .sort((a, b) => b[1] - a[1])
    .forEach(([stage, count]) => {
      console.log(`  ${stage.padEnd(25)} ${count}건`);
    });

  // 상세 리스트 (최근 20건)
  console.log('\n=== 최근 생성 영업기회 (20건) ===');
  console.log('─'.repeat(120));
  console.log(
    '생성일'.padEnd(12) +
    '영업기회명'.padEnd(35) +
    'Stage'.padEnd(15) +
    '담당자'.padEnd(10) +
    'Account'.padEnd(25) +
    'Won/Lost'
  );
  console.log('─'.repeat(120));

  allRecords.slice(0, 20).forEach(opp => {
    const status = opp.IsWon ? 'Won' : (opp.IsClosed ? 'Lost' : '-');
    console.log(
      (opp.CreatedDate?.substring(0, 10) || '-').padEnd(12) +
      (opp.Name?.substring(0, 33) || '-').padEnd(35) +
      (opp.StageName?.substring(0, 13) || '-').padEnd(15) +
      (opp.Owner?.Name?.substring(0, 8) || '-').padEnd(10) +
      (opp.Account?.Name?.substring(0, 23) || '-').padEnd(25) +
      status
    );
  });

  // JSON 파일로 저장
  const fs = require('fs');
  const jsonData = allRecords.map(opp => {
    // Primary Contact 추출
    const primaryContact = opp.OpportunityContactRoles?.records?.[0];

    return {
      id: opp.Id,
      name: opp.Name,
      stageName: opp.StageName,
      amount: opp.Amount,
      closeDate: opp.CloseDate,
      createdDate: opp.CreatedDate?.substring(0, 10),
      lastActivityDate: opp.LastActivityDate,
      lastModifiedDate: opp.LastModifiedDate?.substring(0, 10),
      isClosed: opp.IsClosed,
      isWon: opp.IsWon,
      leadSource: opp.LeadSource,
      lossReason: opp.Loss_Reason__c,
      recordType: opp.RecordType?.Name,
      owner: {
        id: opp.OwnerId,
        name: opp.Owner?.Name
      },
      account: {
        id: opp.AccountId,
        name: opp.Account?.Name,
        accountType: opp.Account?.fm_AccountType__c,
        phone: opp.Account?.Phone,
        billingCity: opp.Account?.BillingCity,
        billingState: opp.Account?.BillingState,
        lastActivityDate: opp.Account?.LastActivityDate,
        // 주소
        shippingAddress: opp.Account?.ShippingAddress__c,
        roadAddress: opp.Account?.RoadAddress__c,
        jibunAddress: opp.Account?.JibunAddress__c,
        // 업종
        industry: opp.Account?.Industry__c,
        plIndustryFirst: opp.Account?.PLIndustry_First__c,
        plIndustrySecond: opp.Account?.PLIndustry_Second__c,
        plIndustryThird: opp.Account?.PLIndustry_Third__c,
        storeType: opp.Account?.StoreType__c
      },
      // 연락처 정보
      contact: primaryContact ? {
        id: primaryContact.ContactId,
        name: primaryContact.Contact?.Name,
        phone: primaryContact.Contact?.Phone,
        mobile: primaryContact.Contact?.MobilePhone,
        email: primaryContact.Contact?.Email
      } : null
    };
  });

  const filename = `Opportunities_2025-11_to_2026-02.json`;
  fs.writeFileSync(__dirname + '/' + filename, JSON.stringify(jsonData, null, 2));
  console.log(`\n📄 JSON 파일 저장: ${filename}`);
}

main().catch(err => {
  console.error('오류:', err.message);
  if (err.response) console.error(err.response.data);
});
