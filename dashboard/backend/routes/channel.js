/**
 * 채널 세일즈 API 라우트
 */
const express = require('express');
const router = express.Router();
const channelReport = require('../services/channel-report');

/**
 * GET /api/channel
 * 채널 세일즈 전체 리포트
 *
 * Query params:
 *   - section: summary | partner | franchise | mou | all (기본값: all)
 *   - month: YYYY-MM (기본값: 현재 월)
 */
router.get('/', async (req, res) => {
  try {
    const { section = 'all', month } = req.query;

    console.log(`[API] 채널 세일즈 리포트 요청: section=${section}, month=${month || 'current'}`);

    const stats = await channelReport.generateReport(month || null);

    // rawData에서 프론트엔드가 필요한 필드만 추출 (15MB → ~500KB)
    const { rawData, ...statsWithoutRaw } = stats;
    const rawDataSlim = rawData ? {
      channelEvents: (rawData.channelEvents || []).map(e => ({
        Id: e.Id, WhatId: e.WhatId, Subject: e.Subject, Description: e.Description,
        CreatedDate: e.CreatedDate, ActivityDate: e.ActivityDate,
        Owner: e.Owner ? { Name: e.Owner.Name } : null,
      })),
      partners: (rawData.partners || []).map(a => ({
        Id: a.Id, Name: a.Name, Progress__c: a.Progress__c, MOUstartdate__c: a.MOUstartdate__c, MOU_ContractDate__c: a.MOU_ContractDate__c,
        Owner: a.Owner ? { Name: a.Owner.Name } : null,
        fm_AccountType__c: a.fm_AccountType__c, CreatedDate: a.CreatedDate,
      })),
      franchiseHQAccounts: (rawData.franchiseHQAccounts || []).map(a => ({
        Id: a.Id, Name: a.Name, Progress__c: a.Progress__c, MOUstartdate__c: a.MOUstartdate__c, MOU_ContractDate__c: a.MOU_ContractDate__c,
        Owner: a.Owner ? { Name: a.Owner.Name } : null,
        fm_AccountType__c: a.fm_AccountType__c, CreatedDate: a.CreatedDate,
      })),
      channelTasks: (rawData.channelTasks || []).map(t => ({
        WhatId: t.WhatId, CreatedDate: t.CreatedDate, Subject: t.Subject,
      })),
    } : null;

    // 섹션별 필터링
    if (section === 'summary') {
      return res.json({
        period: stats.period,
        summary: stats.summary,
        generatedAt: stats.generatedAt
      });
    }

    if (section === 'partner') {
      return res.json({
        period: stats.period,
        partnerStats: stats.partnerStats,
        generatedAt: stats.generatedAt
      });
    }

    if (section === 'franchise') {
      return res.json({
        period: stats.period,
        franchiseStats: stats.franchiseStats,
        franchiseHQList: stats.franchiseHQList,
        generatedAt: stats.generatedAt
      });
    }

    if (section === 'mou') {
      return res.json({
        period: stats.period,
        mouStats: stats.mouStats,
        generatedAt: stats.generatedAt
      });
    }

    // kpi-v2: KPI 대시보드에 필요한 필드만 반환
    if (section === 'kpi-v2') {
      // 히트맵 데이터: 활동 있는 날만 전송 (sparse)
      const sparseDailyActivity = (arr) =>
        (arr || []).filter(d => d.leads > 0 || d.meetings > 0 || d.count > 0);

      // amHeatmap sparse 변환
      const channelLeadsByOwner = stats.summary?.channelLeadsByOwner;
      const sparseChannelLeadsByOwner = channelLeadsByOwner ? {
        ...channelLeadsByOwner,
        amHeatmap: channelLeadsByOwner.amHeatmap ? {
          ...channelLeadsByOwner.amHeatmap,
          data: (channelLeadsByOwner.amHeatmap.data || []).map(d => ({
            ...d,
            dailyData: (d.dailyData || []).filter(dd => dd.count > 0)
          }))
        } : null
      } : null;

      return res.json({
        period: stats.period,
        kpi: stats.kpi,
        summary: stats.summary ? {
          partnerLeads: stats.summary.partnerLeads,
          franchiseLeads: stats.summary.franchiseLeads,
          channelLeadsByOwner: sparseChannelLeadsByOwner,
        } : null,
        mouStats: stats.mouStats,
        partnerStats: (stats.partnerStats || []).map(({ leads, referredStores, dailyLeads, ...rest }) => ({
          ...rest,
          dailyActivity: sparseDailyActivity(rest.dailyActivity)
        })),
        franchiseHQList: (stats.franchiseHQList || []).map(hq => ({
          ...hq,
          dailyActivity: sparseDailyActivity(hq.dailyActivity)
        })),
        rawData: rawDataSlim,
        generatedAt: stats.generatedAt,
      });
    }

    // all: 전체 반환 (rawData slim 포함)
    res.json({ ...statsWithoutRaw, rawData: rawDataSlim });

  } catch (error) {
    console.error('[API] 채널 세일즈 리포트 오류:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/channel/summary
 * 채널 세일즈 요약 (빠른 조회)
 */
router.get('/summary', async (req, res) => {
  try {
    const { month } = req.query;
    console.log(`[API] 채널 세일즈 요약 요청: month=${month || 'current'}`);

    const stats = await channelReport.generateReport(month || null);
    const summary = channelReport.extractSummary(stats);

    res.json(summary);

  } catch (error) {
    console.error('[API] 채널 세일즈 요약 오류:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/channel/tm
 * TM 파트 현황 (MQL/SQL, FRT, 파이프라인)
 */
router.get('/tm', async (req, res) => {
  try {
    const { month } = req.query;
    console.log(`[API] 채널 세일즈 TM 현황 요청: month=${month || 'current'}`);

    const stats = await channelReport.generateReport(month || null);

    res.json({
      period: stats.period,
      channelLeadsByOwner: stats.summary?.channelLeadsByOwner,
      generatedAt: stats.generatedAt
    });

  } catch (error) {
    console.error('[API] 채널 세일즈 TM 오류:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/channel/am
 * AM 파트 현황 (일별 Lead 캘린더)
 */
router.get('/am', async (req, res) => {
  try {
    const { month } = req.query;
    console.log(`[API] 채널 세일즈 AM 현황 요청: month=${month || 'current'}`);

    const stats = await channelReport.generateReport(month || null);

    // 파트너 안착 타임라인 (onboarding partner list에서 구성)
    const onboardingPartnerList = stats.mouStats?.onboarding?.partner?.list || [];
    const settlementTimeline = onboardingPartnerList.map(p => ({
      partnerName: p.name,
      absoluteFirstLeadDate: p.absoluteFirstLeadDate || null,
      mouStart: p.mouStart || null,
      mouContractDate: p.mouContractDate || null,
      leadToMouDays: (p.mouContractDate && p.absoluteFirstLeadDate)
        ? Math.round((new Date(p.mouContractDate) - new Date(p.absoluteFirstLeadDate)) / (1000 * 60 * 60 * 24))
        : null,
      preMouLeadCount: p.preMouLeadCount || 0,
      leadsAfterMou3Months: p.leadCountWithinWindow || 0,
      isSettled: p.isSettled || false
    }));

    res.json({
      period: stats.period,
      amHeatmap: stats.summary?.channelLeadsByOwner?.amHeatmap,
      settlementTimeline,
      generatedAt: stats.generatedAt
    });

  } catch (error) {
    console.error('[API] 채널 세일즈 AM 오류:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

module.exports = router;
