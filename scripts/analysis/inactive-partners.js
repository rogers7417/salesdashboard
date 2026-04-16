require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

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

async function query(instanceUrl, accessToken, soql) {
  let allRecords = [];
  let url = `${instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`;

  while (url) {
    const res = await axios.get(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    allRecords = allRecords.concat(res.data.records);
    url = res.data.nextRecordsUrl ? `${instanceUrl}${res.data.nextRecordsUrl}` : null;
  }
  return allRecords;
}

async function main() {
  const { accessToken, instanceUrl } = await getSalesforceToken();
  console.log('✅ Salesforce 연결 성공\n');

  // 1. 전체 파트너사 목록
  console.log('📋 전체 파트너사 조회 중...');
  const allPartnersQuery = `
    SELECT PartnerName__c, COUNT(Id) cnt
    FROM Lead
    WHERE PartnerName__c != NULL
    GROUP BY PartnerName__c
  `;
  const allPartners = await query(instanceUrl, accessToken, allPartnersQuery);
  console.log(`   전체 파트너사: ${allPartners.length}개\n`);

  // 2. 2026년 1월 이후 Lead가 있는 파트너사
  console.log('📋 2026년 1월 이후 활동 파트너사 조회 중...');
  const activePartnersQuery = `
    SELECT PartnerName__c, COUNT(Id) cnt
    FROM Lead
    WHERE PartnerName__c != NULL
      AND CreatedDate >= 2026-01-01T00:00:00Z
    GROUP BY PartnerName__c
  `;
  const activePartners = await query(instanceUrl, accessToken, activePartnersQuery);
  const activePartnerSet = new Set(activePartners.map(p => p.PartnerName__c));
  console.log(`   1월 이후 활동 파트너사: ${activePartners.length}개\n`);

  // 3. 1월 이후 Lead 생산이 없는 파트너사
  const inactivePartners = allPartners.filter(p => !activePartnerSet.has(p.PartnerName__c));
  console.log(`🔴 1월 이후 Lead 생산 없는 파트너사: ${inactivePartners.length}개\n`);

  // 4. 파트너사 ID로 Account 정보 조회 (이름, MOU, 업종, 업태 포함)
  console.log('📋 파트너사 상세 정보 조회 중...');
  const partnerIds = inactivePartners.map(p => p.PartnerName__c);
  const accountInfoMap = {};

  const chunkSize = 200;
  for (let i = 0; i < partnerIds.length; i += chunkSize) {
    const chunk = partnerIds.slice(i, i + chunkSize);
    const ids = chunk.map(id => `'${id}'`).join(',');
    const accountQuery = `
      SELECT Id, Name, MOU_YN__c, MOUstartdate__c, MOUenddate__c, MOU_ContractDate__c,
             Industry__c, TypeofB__c, PartnerType__c, Owner.Name, Phone
      FROM Account WHERE Id IN (${ids})
    `;
    const accounts = await query(instanceUrl, accessToken, accountQuery);
    accounts.forEach(a => {
      accountInfoMap[a.Id] = {
        name: a.Name,
        mouYn: a.MOU_YN__c || null,
        mouStartDate: a.MOUstartdate__c || null,
        mouEndDate: a.MOUenddate__c || null,
        mouContractDate: a.MOU_ContractDate__c || null,
        industry: a.Industry__c || null,
        businessType: a.TypeofB__c || null,
        partnerType: a.PartnerType__c || null,
        ownerName: a.Owner?.Name || null,
        phone: a.Phone || null
      };
    });
  }

  // 5. 비활성 파트너사의 마지막 Lead 날짜 조회
  console.log('📋 마지막 활동일 조회 중...');
  const result = [];

  for (const partner of inactivePartners) {
    const partnerId = partner.PartnerName__c;
    const accountInfo = accountInfoMap[partnerId] || {};
    const partnerName = accountInfo.name || partnerId;

    const lastLeadQuery = `
      SELECT PartnerName__c, CreatedDate, Name, Status
      FROM Lead
      WHERE PartnerName__c = '${partnerId}'
      ORDER BY CreatedDate DESC
      LIMIT 1
    `;
    try {
      const lastLead = await query(instanceUrl, accessToken, lastLeadQuery);
      if (lastLead.length > 0) {
        result.push({
          partnerId: partnerId,
          partnerName: partnerName,
          totalLeads: partner.cnt,
          lastLeadDate: lastLead[0].CreatedDate.split('T')[0],
          lastLeadName: lastLead[0].Name,
          lastLeadStatus: lastLead[0].Status,
          // MOU 정보
          mouYn: accountInfo.mouYn,
          mouStartDate: accountInfo.mouStartDate,
          mouEndDate: accountInfo.mouEndDate,
          mouContractDate: accountInfo.mouContractDate,
          // 업종/업태
          industry: accountInfo.industry,
          businessType: accountInfo.businessType,
          // 파트너 정보
          partnerType: accountInfo.partnerType,
          ownerName: accountInfo.ownerName,
          phone: accountInfo.phone
        });
      }
    } catch (e) {
      console.log(`   - ${partnerName}: 조회 오류`);
    }
  }

  // 마지막 활동일 기준 정렬 (최근 순)
  result.sort((a, b) => b.lastLeadDate.localeCompare(a.lastLeadDate));

  // JSON 저장
  const filename = 'Inactive_Partners_Since_Jan2026.json';
  fs.writeFileSync(filename, JSON.stringify(result, null, 2));
  console.log(`\n📁 파일 저장: ${filename}`);
  console.log(`   총 ${result.length}개 파트너사`);

  // 샘플 출력
  console.log('\n=== 샘플 데이터 (상위 3개) ===');
  result.slice(0, 3).forEach((p, i) => {
    console.log(`${i + 1}. ${p.partnerName}`);
    console.log(`   - 총 Lead: ${p.totalLeads}건, 마지막: ${p.lastLeadDate}`);
    console.log(`   - MOU 제휴일: ${p.mouContractDate || '-'}`);
    console.log(`   - 업종: ${p.industry || '-'}, 업태: ${p.businessType || '-'}`);
  });
}

main().catch(console.error);
