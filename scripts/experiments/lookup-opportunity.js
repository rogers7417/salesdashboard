const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sf = require('../server/api/services/salesforce');

async function lookupOpportunity(oppId) {
  console.log(`\n=== 영업기회 조회: ${oppId} ===\n`);

  // 1. Opportunity 기본 정보 + 광고 필드
  const opp = await sf.query(`
    SELECT Id, Name, StageName, CreatedDate, CloseDate, LastStageChangeDate,
           Owner.Name, Owner_Department__c, Account.Name,
           Amount, LeadSource, IsWon, IsClosed,
           IsADBanner__c, IsADDrink__c,
           AdType__c, AdTypeDetailed__c, AdContract_Amount__c, AdContract_FinalAmount__c,
           Advertiser__r.Name, AdAgency__r.Name,
           AdDisplayQtyExpected__c, AdDisplayRevenueExpected__c,
           fm_AdDiscount_Amount__c, fm_AdDiscount_Rate__c
    FROM Opportunity
    WHERE Id = '${oppId}'
  `);

  if (!opp.records || opp.records.length === 0) {
    console.log('영업기회를 찾을 수 없습니다.');
    return;
  }

  const o = opp.records[0];
  console.log('--- 기본 정보 ---');
  console.log(`  이름: ${o.Name}`);
  console.log(`  상호: ${o.Account?.Name}`);
  console.log(`  단계: ${o.StageName}`);
  console.log(`  담당자: ${o.Owner?.Name} (${o.Owner_Department__c})`);
  console.log(`  생성일: ${o.CreatedDate}`);
  console.log(`  마감일: ${o.CloseDate}`);
  console.log(`  단계변경일: ${o.LastStageChangeDate}`);
  console.log(`  금액: ${o.Amount}`);
  console.log(`  유입경로: ${o.LeadSource}`);
  console.log(`  수주: ${o.IsWon} / 마감: ${o.IsClosed}`);

  console.log('\n--- 광고 필드 (Opportunity) ---');
  console.log(`  롤링광고 (IsADBanner__c): ${o.IsADBanner__c}`);
  console.log(`  상품광고 (IsADDrink__c): ${o.IsADDrink__c}`);
  console.log(`  광고 유형: ${o.AdType__c || '(없음)'}`);
  console.log(`  광고 유형(세부): ${o.AdTypeDetailed__c || '(없음)'}`);
  console.log(`  광고 계약금액: ${o.AdContract_Amount__c}`);
  console.log(`  광고 최종금액: ${o.AdContract_FinalAmount__c}`);
  console.log(`  광고주: ${o.Advertiser__r?.Name || '(없음)'}`);
  console.log(`  대행사: ${o.AdAgency__r?.Name || '(없음)'}`);
  console.log(`  예상 송출 대수: ${o.AdDisplayQtyExpected__c}`);
  console.log(`  예상 광고 매출: ${o.AdDisplayRevenueExpected__c}`);

  // 2. Contract__c 전체 조회
  const contracts = await sf.queryAll(`
    SELECT Id, Name, CreatedDate, ContractCreateDate__c, ContractSignedDate__c,
           ContractStatus__c, ContractType__c, ContractDateStart__c, ContractDateEnd__c,
           ContractTerms__c, PaymentType__c, ProductPaymentType__c,
           IsADBanner__c, IsADDrink__c,
           BannerAdAgree__c, ProductAdAgree__c, fm_AdAgree__c, AdAgreementCheck__c,
           fm_AdContract_Amount__c, fm_AdDiscount_Amount__c, fm_AdDiscount_Rate__c,
           fm_FinalTotalAmount__c, TotalAmount__c,
           OwnerId, Owner_Department__c
    FROM Contract__c
    WHERE Opportunity__c = '${oppId}'
    ORDER BY CreatedDate ASC
  `);

  console.log(`\n--- Contract__c (${contracts.length}건) ---`);
  contracts.forEach((c, i) => {
    console.log(`\n  [${i + 1}] ${c.Name}`);
    console.log(`    상태: ${c.ContractStatus__c}`);
    console.log(`    유형: ${c.ContractType__c}`);
    console.log(`    생성일: ${c.CreatedDate?.substring(0, 10)}`);
    console.log(`    계약서작성일: ${c.ContractCreateDate__c}`);
    console.log(`    계약서명일: ${c.ContractSignedDate__c}`);
    console.log(`    계약시작일: ${c.ContractDateStart__c}`);
    console.log(`    계약만료일: ${c.ContractDateEnd__c}`);
    console.log(`    계약조건: ${c.ContractTerms__c}`);
    console.log(`    납부방법: ${c.PaymentType__c}`);
    console.log(`    결제방법: ${c.ProductPaymentType__c}`);
    console.log(`    (최종)총금액: ${c.fm_FinalTotalAmount__c}`);
    console.log(`    --- 광고 필드 ---`);
    console.log(`    롤링광고 (IsADBanner__c): ${c.IsADBanner__c}`);
    console.log(`    상품광고 (IsADDrink__c): ${c.IsADDrink__c}`);
    console.log(`    롤링광고 동의: ${c.BannerAdAgree__c}`);
    console.log(`    상품광고 동의: ${c.ProductAdAgree__c}`);
    console.log(`    전체 광고 동의: ${c.fm_AdAgree__c}`);
    console.log(`    광고동의여부: ${c.AdAgreementCheck__c}`);
    console.log(`    광고 계약금액: ${c.fm_AdContract_Amount__c}`);
    console.log(`    광고 할인금액: ${c.fm_AdDiscount_Amount__c}`);
    console.log(`    광고 할인율: ${c.fm_AdDiscount_Rate__c}`);
  });

  if (contracts.length === 0) {
    console.log('  (계약서 없음)');
  }

  // 3. OpportunityLineItem (영업기회 상품)
  const oli = await sf.queryAll(`
    SELECT Id, Name, Product2.Name, Product2.ProductCode, Quantity, UnitPrice, TotalPrice,
           ListPrice, Discount, Description, SortOrder
    FROM OpportunityLineItem
    WHERE OpportunityId = '${oppId}'
    ORDER BY SortOrder ASC
  `);

  console.log(`\n--- 영업기회 상품 (OpportunityLineItem: ${oli.length}건) ---`);
  oli.forEach((r, i) => {
    const name = r.Product2?.Name || r.Name;
    const code = r.Product2?.ProductCode || '';
    const isAd = name.includes('광고') ? ' ★광고' : '';
    console.log(`  [${i + 1}] ${name}${isAd}`);
    console.log(`      코드: ${code} | 수량: ${r.Quantity} | 단가: ${r.UnitPrice?.toLocaleString()} | 합계: ${r.TotalPrice?.toLocaleString()}`);
    if (r.Discount) console.log(`      할인: ${r.Discount}%`);
    if (r.Description) console.log(`      설명: ${r.Description}`);
  });

  // 4. OrderItem (출고 상품)
  const orders = await sf.queryAll(`
    SELECT Id, Name, CreatedDate, Status, OutputDate__c
    FROM Order
    WHERE OpportunityId = '${oppId}'
    ORDER BY CreatedDate ASC
  `);

  if (orders.length > 0) {
    const orderIds = orders.map(o => `'${o.Id}'`).join(',');
    const orderItems = await sf.queryAll(`
      SELECT Id, OrderId, Product2.Name, Product2.ProductCode, Quantity, UnitPrice, TotalPrice,
             ListPrice, Description
      FROM OrderItem
      WHERE OrderId IN (${orderIds})
    `);

    console.log(`\n--- 출고 상품 (OrderItem: ${orderItems.length}건, Order ${orders.length}건) ---`);
    orders.forEach(o => {
      console.log(`  Order: ${o.Name || o.Id} | 상태: ${o.Status} | 생성: ${o.CreatedDate?.substring(0, 10)} | 출고일: ${o.OutputDate__c || '(미출고)'}`);
    });
    orderItems.forEach((r, i) => {
      const name = r.Product2?.Name || 'unknown';
      const code = r.Product2?.ProductCode || '';
      console.log(`  [${i + 1}] ${name} | 코드: ${code} | 수량: ${r.Quantity}`);
    });
  }
}

// Standalone execution
const oppId = process.argv[2] || '006TJ00000fy61JYAQ';
lookupOpportunity(oppId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err.message || err);
    process.exit(1);
  });
