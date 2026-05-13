/**
 * JSON 리포트 생성 모듈
 */
const fs = require('fs');

// JSON 생성
// ============================================
function generateJSON(stats) {
  const now = new Date().toISOString().split('T')[0];

  const jsonData = {
    generatedAt: new Date().toISOString(),
    summary: {
      ...stats.summary,
      // LeadSource 기반 통계 간소화
      partnerLeads: {
        total: stats.summary.partnerLeads.total,
        converted: stats.summary.partnerLeads.converted,
        conversionRate: stats.summary.partnerLeads.conversionRate
      },
      franchiseLeads: {
        total: stats.summary.franchiseLeads.total,
        converted: stats.summary.franchiseLeads.converted,
        conversionRate: stats.summary.franchiseLeads.conversionRate
      },
      // 활동 현황
      activity: stats.summary.activity,
      // 이번 달 소유자별 채널 Lead
      channelLeadsByOwner: stats.summary.channelLeadsByOwner
    },
    // 파트너사 현황
    partners: stats.partnerStats.map(p => ({
      id: p.id,
      name: p.name,
      owner: p.owner,
      progress: p.progress,
      mouStart: p.mouStart,
      mouEnd: p.mouEnd,
      mouContractDate: p.mouContractDate || null,
      absoluteFirstLeadDate: p.absoluteFirstLeadDate || null,
      // Lead 정보
      leads: {
        partnerLead: p.partnerLeadCount,
        partnerLeadConverted: p.partnerLeadConverted,
        franchiseLead: p.franchiseLeadCount,
        franchiseLeadConverted: p.franchiseLeadConverted,
        total: p.sourceLeadCount,
        converted: p.sourceLeadConverted,
        conversionRate: p.sourceLeadConversionRate
      },
      // 활동 정보
      activity: {
        thisMonthLeadCount: p.thisMonthLeadCount,
        last3MonthLeadCount: p.last3MonthLeadCount,
        lastLeadDate: p.lastLeadDate,
        isActiveThisMonth: p.isActiveThisMonth,
        isActiveLast3Months: p.isActiveLast3Months
      },
      referredStoreCount: p.referredStoreCount,
      oppCount: p.oppCount,
      oppWon: p.oppWon
    })),
    // 프랜차이즈 본사 → 브랜드 현황
    franchiseHQ: stats.franchiseHQList.map(hq => ({
      hqId: hq.hqId,
      hqName: hq.hqName,
      owner: hq.owner,
      progress: hq.progress,
      mouStart: hq.mouStart,
      mouEnd: hq.mouEnd,
      totalStores: hq.totalStores,
      // 본사 Lead 합계
      leads: {
        total: hq.totalLeads,
        converted: hq.totalConverted,
        conversionRate: hq.conversionRate
      },
      // 활동 정보
      activity: {
        thisMonthLeadCount: hq.thisMonthLeadCount,
        last3MonthLeadCount: hq.last3MonthLeadCount,
        lastLeadDate: hq.lastLeadDate,
        isActiveThisMonth: hq.isActiveThisMonth,
        isActiveLast3Months: hq.isActiveLast3Months
      },
      brandCount: hq.brands.length,
      brands: hq.brands.map(b => ({
        id: b.id,
        brandName: b.brandName,
        owner: b.owner,
        storeCount: b.storeCount,
        // 브랜드 Lead 정보
        leads: {
          total: b.leadCount,
          converted: b.leadConverted,
          open: b.leadOpen,
          conversionRate: b.conversionRate
        },
        // 활동 정보
        activity: {
          thisMonthLeadCount: b.thisMonthLeadCount,
          last3MonthLeadCount: b.last3MonthLeadCount,
          lastLeadDate: b.lastLeadDate
        }
      }))
    })),
    // 활동 중인 파트너사/본사 목록
    activePartners: {
      thisMonth: (stats.activePartnerThisMonth || []).map(p => ({
        id: p.id,
        name: p.name,
        owner: p.owner,
        thisMonthLeadCount: p.thisMonthLeadCount,
        last3MonthLeadCount: p.last3MonthLeadCount,
        lastLeadDate: p.lastLeadDate
      })),
      last3Months: (stats.activePartnerLast3Months || []).map(p => ({
        id: p.id,
        name: p.name,
        owner: p.owner,
        thisMonthLeadCount: p.thisMonthLeadCount,
        last3MonthLeadCount: p.last3MonthLeadCount,
        lastLeadDate: p.lastLeadDate
      }))
    },
    activeFranchiseHQ: {
      thisMonth: (stats.activeHQThisMonth || []).map(hq => ({
        hqId: hq.hqId,
        hqName: hq.hqName,
        owner: hq.owner,
        thisMonthLeadCount: hq.thisMonthLeadCount,
        last3MonthLeadCount: hq.last3MonthLeadCount,
        lastLeadDate: hq.lastLeadDate
      })),
      last3Months: (stats.activeHQLast3Months || []).map(hq => ({
        hqId: hq.hqId,
        hqName: hq.hqName,
        owner: hq.owner,
        thisMonthLeadCount: hq.thisMonthLeadCount,
        last3MonthLeadCount: hq.last3MonthLeadCount,
        lastLeadDate: hq.lastLeadDate
      }))
    },
    // MOU 체결 현황 및 초기 안착률
    mou: {
      thisMonth: stats.mouStats?.thisMonth,
      threeMonthsAgo: stats.mouStats?.threeMonthsAgo,
      partner: {
        thisMonth: stats.mouStats?.partner?.thisMonth || 0,
        last3Months: stats.mouStats?.partner?.last3Months || 0,
        thisMonthList: (stats.mouStats?.partner?.thisMonthList || []).map(p => ({
          id: p.id,
          name: p.name,
          owner: p.owner,
          mouStart: p.mouStart,
          leadCount: p.sourceLeadCount || 0,
          isSettled: p.isSettled !== undefined ? p.isSettled : (p.sourceLeadCount > 0)
        }))
      },
      franchiseHQ: {
        thisMonth: stats.mouStats?.franchiseHQ?.thisMonth || 0,
        last3Months: stats.mouStats?.franchiseHQ?.last3Months || 0,
        thisMonthList: (stats.mouStats?.franchiseHQ?.thisMonthList || []).map(hq => ({
          hqId: hq.hqId,
          hqName: hq.hqName,
          owner: hq.owner,
          mouStart: hq.mouStart,
          leadCount: hq.totalLeads || 0,
          isSettled: hq.isSettled !== undefined ? hq.isSettled : (hq.totalLeads > 0)
        }))
      },
      onboarding: {
        partner: {
          total: stats.mouStats?.onboarding?.partner?.total || 0,
          settled: stats.mouStats?.onboarding?.partner?.settled || 0,
          rate: stats.mouStats?.onboarding?.partner?.rate || 0,
          unsettledList: (stats.mouStats?.onboarding?.partner?.list || []).filter(p => !p.isSettled).map(p => ({
            id: p.id,
            name: p.name,
            owner: p.owner,
            mouStart: p.mouStart,
            mouContractDate: p.mouContractDate || null,
            absoluteFirstLeadDate: p.absoluteFirstLeadDate || null,
            mouEndWindow: p.mouEndWindow
          }))
        },
        franchiseHQ: {
          total: stats.mouStats?.onboarding?.franchiseHQ?.total || 0,
          settled: stats.mouStats?.onboarding?.franchiseHQ?.settled || 0,
          rate: stats.mouStats?.onboarding?.franchiseHQ?.rate || 0,
          unsettledList: (stats.mouStats?.onboarding?.franchiseHQ?.list || []).filter(hq => !hq.isSettled).map(hq => ({
            hqId: hq.hqId,
            hqName: hq.hqName,
            owner: hq.owner,
            mouStart: hq.mouStart,
            mouEndWindow: hq.mouEndWindow
          }))
        },
        // 브랜드 단위 안착률
        franchiseBrand: {
          total: stats.mouStats?.onboarding?.franchiseBrand?.total || 0,
          settled: stats.mouStats?.onboarding?.franchiseBrand?.settled || 0,
          rate: stats.mouStats?.onboarding?.franchiseBrand?.rate || 0,
          settledList: (stats.mouStats?.onboarding?.franchiseBrand?.list || []).filter(b => b.isSettled).map(b => ({
            id: b.id,
            brandName: b.brandName,
            hqId: b.hqId,
            hqName: b.hqName,
            owner: b.owner,
            mouStart: b.mouStart,
            leadCountWithinWindow: b.leadCountWithinWindow,
            firstLeadDate: b.firstLeadDate
          })),
          unsettledList: (stats.mouStats?.onboarding?.franchiseBrand?.list || []).filter(b => !b.isSettled).map(b => ({
            id: b.id,
            brandName: b.brandName,
            hqId: b.hqId,
            hqName: b.hqName,
            owner: b.owner,
            mouStart: b.mouStart,
            mouEndWindow: b.mouEndWindow
          }))
        }
      }
    },
    // KPI
    kpi: stats.kpi ? {
      date: stats.kpi.date,
      thisMonth: stats.kpi.thisMonth,
      thisMonthDays: stats.kpi.thisMonthDays,
      bd: {
        mouNewThisMonth: stats.kpi.bd.mouNewThisMonth.value,
        mouNewTarget: stats.kpi.bd.mouNewThisMonth.target,
        negoEntryThisMonth: stats.kpi.bd.negoEntryThisMonth.value,
        negoTotal: stats.kpi.bd.negoEntryThisMonth.total,
        negoTarget: stats.kpi.bd.negoEntryThisMonth.target,
        meetingsIncompleteToday: stats.kpi.bd.meetingsIncompleteToday.value,
        meetingsIncompleteDailyAvg: parseFloat(stats.kpi.bd.meetingsIncompleteAvg.value),
        meetingsIncompleteThisMonth: stats.kpi.bd.meetingsIncompleteThisMonth.value,
        meetingsIncompleteTarget: stats.kpi.bd.meetingsIncompleteToday.target
      },
      am: {
        leadsToday: stats.kpi.am.leadsToday.value,
        leadsDailyAvg: stats.kpi.am.leadsDailyAvg.value,
        leadsThisMonth: stats.kpi.am.leadsThisMonth.value,
        leadsTarget: stats.kpi.am.leadsToday.target,
        meetingsCompleteToday: stats.kpi.am.meetingsCompleteToday.value,
        meetingsCompleteDailyAvg: parseFloat(stats.kpi.am.meetingsCompleteAvg.value),
        meetingsCompleteThisMonth: stats.kpi.am.meetingsCompleteThisMonth.value,
        meetingsCompleteTarget: stats.kpi.am.meetingsCompleteToday.target,
        onboardingRate: stats.kpi.am.onboardingRate.value,
        onboardingSettled: stats.kpi.am.onboardingRate.settled,
        onboardingTotal: stats.kpi.am.onboardingRate.total,
        onboardingTarget: stats.kpi.am.onboardingRate.target,
        activeChannels90d: stats.kpi.am.activeChannels90d.value,
        activePartners90d: stats.kpi.am.activeChannels90d.partners,
        activeHQ90d: stats.kpi.am.activeChannels90d.hq,
        activeTarget: stats.kpi.am.activeChannels90d.target
      },
      meetingsByOwner: stats.kpi.meetingsByOwner
    } : null
  };

  const path = require('path');
  const filename = `ChannelSales_Report_${now.replace(/-/g, '')}.json`;
  const filepath = path.join(__dirname, '..', filename);
  fs.writeFileSync(filepath, JSON.stringify(jsonData, null, 2));
  console.log(`\n📄 JSON 데이터 생성: ${filename}`);
  return filename;
}


module.exports = { generateJSON };
