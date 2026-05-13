/**
 * HTML 리포트 생성 모듈 (Metro UI 스타일)
 */
const fs = require('fs');

function generateHTML(stats) {
  const { summary, partnerStats, franchiseHQList, ownerStats,
          activePartnerThisMonth, activeHQThisMonth, mouStats, kpi, pipeline } = stats;
  const { conversionStats, oppStageStats, ownerPipelineStats } = pipeline;
  const now = new Date().toISOString().split('T')[0];

  // MOU 관련 헬퍼 함수들
  const renderMOUPartnerRow = (p) => {
    const settled = p.isSettled !== undefined ? p.isSettled : (p.sourceLeadCount > 0);
    return `
    <tr style="${settled ? 'background:#e8f5e9;' : 'background:#ffebee;'}">
      <td><strong style="font-weight:500;">${p.name}</strong></td>
      <td>${p.owner}</td>
      <td class="text-center">${p.mouStart || '-'}</td>
      <td class="text-center">${p.leadCountWithinWindow || p.sourceLeadCount || 0}</td>
      <td class="text-center">${settled ? '<span style="color:#107c10;">✓</span>' : '<span style="color:#ff8c00;">-</span>'}</td>
    </tr>`;
  };

  const renderMOUHQRow = (hq) => {
    const settled = hq.isSettled !== undefined ? hq.isSettled : (hq.totalLeads > 0);
    return `
    <tr style="${settled ? 'background:#e8f5e9;' : 'background:#ffebee;'}">
      <td><strong style="font-weight:500;">${hq.hqName}</strong></td>
      <td>${hq.owner}</td>
      <td class="text-center">${hq.mouStart || '-'}</td>
      <td class="text-center">${hq.leadCountWithinWindow || hq.totalLeads || 0}</td>
      <td class="text-center">${settled ? '<span style="color:#107c10;">✓</span>' : '<span style="color:#ff8c00;">-</span>'}</td>
    </tr>`;
  };

  // 헬퍼 함수들
  const renderActivePartnerRow = (p) => `
    <tr>
      <td>${p.name}</td>
      <td class="text-center"><strong style="font-weight:500; color:#e81123;">${p.thisMonthLeadCount}</strong></td>
      <td class="text-center" style="color:#00b7c3;">${p.last3MonthLeadCount}</td>
      <td class="text-center" style="font-size:0.85em; color:#666;">${p.lastLeadDate || '-'}</td>
    </tr>`;

  const renderActiveHQRow = (hq) => `
    <tr>
      <td>${hq.hqName}</td>
      <td class="text-center"><strong style="font-weight:500; color:#e81123;">${hq.thisMonthLeadCount}</strong></td>
      <td class="text-center" style="color:#00b7c3;">${hq.last3MonthLeadCount}</td>
      <td class="text-center" style="font-size:0.85em; color:#666;">${hq.lastLeadDate || '-'}</td>
    </tr>`;

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>채널세일즈 리포트 - ${now}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', 'Roboto', -apple-system, sans-serif; background: #f5f5f5; color: #333; line-height: 1.5; }
    .container { width: 100%; padding: 30px 40px; }
    h1 { text-align: left; margin-bottom: 40px; color: #333; font-size: 2.5em; font-weight: 300; letter-spacing: -1px; }
    h2 { margin: 40px 0 20px; padding-bottom: 10px; border-bottom: 3px solid #0078d4; color: #333; font-size: 1.6em; font-weight: 400; }
    h3 { font-weight: 400; font-size: 1.2em; }
    h4 { font-weight: 500; font-size: 1.1em; color: #333; }
    .card { background: #fff; padding: 25px; margin-bottom: 25px; border-left: 4px solid #0078d4; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px; }
    .stat-box { text-align: center; padding: 25px; background: #0078d4; color: white; }
    .stat-box.green { background: #107c10; }
    .stat-box.orange { background: #ff8c00; }
    .stat-box.blue { background: #00b7c3; }
    .stat-box.purple { background: #8661c5; }
    .stat-box.red { background: #e81123; }
    .stat-number { font-size: 3em; font-weight: 300; }
    .stat-label { font-size: 0.95em; opacity: 0.9; margin-top: 8px; text-transform: uppercase; letter-spacing: 1px; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; background: #fff; }
    th, td { padding: 14px 18px; text-align: left; border-bottom: 1px solid #e0e0e0; }
    th { background: #f0f0f0; font-weight: 500; color: #333; text-transform: uppercase; font-size: 0.85em; letter-spacing: 0.5px; }
    tr:hover { background: #f8f8f8; }
    .badge { display: inline-block; padding: 4px 10px; font-size: 0.8em; font-weight: 500; }
    .badge-partner { background: #0078d4; color: #fff; }
    .badge-franchise { background: #ff8c00; color: #fff; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .tile { padding: 25px; color: #fff; }
    .tile-blue { background: #0078d4; }
    .tile-orange { background: #ff8c00; }
    .tile-green { background: #107c10; }
    .tile-purple { background: #8661c5; }
    .tile-red { background: #e81123; }
    .tile-teal { background: #00b7c3; }
    .tile-dark { background: #555; }
    .tile-grid { display: grid; gap: 15px; }
    p { color: #666; }
    details { background: #fff; }
    details summary { color: #333; }
  </style>
</head>
<body>
  <div class="container">
    <h1>채널세일즈 리포트</h1>
    <p style="text-align:left; color:#666; margin-bottom:40px; font-size:1.1em;">생성일: ${now}</p>

    <!-- KPI 대시보드 -->
    ${kpi ? `
    <div class="card" style="border-left-color:#e81123;">
      <h2 style="border-bottom-color:#e81123;">KPI 대시보드</h2>
      <p style="color:#666; margin-bottom:20px;">기준일: ${kpi.date} | 이번달 경과일: ${kpi.thisMonthDays}일</p>

      <!-- BD 파트 -->
      <h4 style="margin-bottom:15px; color:#0078d4;">BD 파트 — 신규 MOU 확보</h4>
      <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:15px; margin-bottom:30px;">
        <div class="tile" style="background:${kpi.bd.mouNewThisMonth.value >= kpi.bd.mouNewThisMonth.target ? '#107c10' : '#e81123'};">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">신규 MOU 체결 (월)</div>
          <div style="display:flex; align-items:baseline; gap:10px;">
            <div style="font-size:3em; font-weight:300;">${kpi.bd.mouNewThisMonth.value}</div>
            <div style="font-size:1.2em; opacity:0.7;">/ ${kpi.bd.mouNewThisMonth.target}건</div>
          </div>
        </div>
        <div class="tile" style="background:${kpi.bd.negoEntryThisMonth.value >= kpi.bd.negoEntryThisMonth.target ? '#107c10' : '#e81123'};">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">네고 단계 진입 (월)</div>
          <div style="display:flex; align-items:baseline; gap:10px;">
            <div style="font-size:3em; font-weight:300;">${kpi.bd.negoEntryThisMonth.value}</div>
            <div style="font-size:1.2em; opacity:0.7;">/ ${kpi.bd.negoEntryThisMonth.target}건</div>
          </div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">현재 네고중: ${kpi.bd.negoEntryThisMonth.total}건</div>
        </div>
        <div class="tile" style="background:${kpi.bd.meetingsIncompleteToday.value >= kpi.bd.meetingsIncompleteToday.target ? '#107c10' : '#e81123'};">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">MOU 미완료 곳 미팅 (일)</div>
          <div style="display:flex; align-items:baseline; gap:10px;">
            <div style="font-size:3em; font-weight:300;">${kpi.bd.meetingsIncompleteToday.value}</div>
            <div style="font-size:1.2em; opacity:0.7;">/ ${kpi.bd.meetingsIncompleteToday.target}건+</div>
          </div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">일평균 ${kpi.bd.meetingsIncompleteAvg.value}건 | 이번달 ${kpi.bd.meetingsIncompleteThisMonth.value}건</div>
        </div>
      </div>

      <!-- AM 파트 -->
      <h4 style="margin-bottom:15px; color:#ff8c00;">AM 파트 — 파트너 활성화 · 리드 안정화</h4>
      <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:15px; margin-bottom:25px;">
        <div class="tile" style="background:${kpi.am.leadsToday.value >= 20 ? '#107c10' : '#e81123'};">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">채널 리드 확보 (일)</div>
          <div style="display:flex; align-items:baseline; gap:10px;">
            <div style="font-size:3em; font-weight:300;">${kpi.am.leadsToday.value}</div>
            <div style="font-size:1.2em; opacity:0.7;">/ ${kpi.am.leadsToday.target}건</div>
          </div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">일평균 ${kpi.am.leadsDailyAvg.value}건 | 이번달 ${kpi.am.leadsThisMonth.value}건</div>
        </div>
        <div class="tile" style="background:${kpi.am.meetingsCompleteToday.value >= kpi.am.meetingsCompleteToday.target ? '#107c10' : '#e81123'};">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">MOU 완료 곳 미팅 (일)</div>
          <div style="display:flex; align-items:baseline; gap:10px;">
            <div style="font-size:3em; font-weight:300;">${kpi.am.meetingsCompleteToday.value}</div>
            <div style="font-size:1.2em; opacity:0.7;">/ ${kpi.am.meetingsCompleteToday.target}건+</div>
          </div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">일평균 ${kpi.am.meetingsCompleteAvg.value}건 | 이번달 ${kpi.am.meetingsCompleteThisMonth.value}건</div>
        </div>
        <div class="tile" style="background:${kpi.am.onboardingRate.value >= kpi.am.onboardingRate.target ? '#107c10' : '#e81123'};">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">신규 파트너 안착률</div>
          <div style="display:flex; align-items:baseline; gap:10px;">
            <div style="font-size:3em; font-weight:300;">${kpi.am.onboardingRate.value}%</div>
            <div style="font-size:1.2em; opacity:0.7;">/ ${kpi.am.onboardingRate.target}%+</div>
          </div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">${kpi.am.onboardingRate.settled}/${kpi.am.onboardingRate.total}개사</div>
        </div>
        <div class="tile" style="background:${kpi.am.activeChannels90d.value >= kpi.am.activeChannels90d.target ? '#107c10' : '#e81123'};">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">활성 파트너 (90일)</div>
          <div style="display:flex; align-items:baseline; gap:10px;">
            <div style="font-size:3em; font-weight:300;">${kpi.am.activeChannels90d.value}</div>
            <div style="font-size:1.2em; opacity:0.7;">/ ${kpi.am.activeChannels90d.target}개+</div>
          </div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">파트너 ${kpi.am.activeChannels90d.partners}개 + 본사 ${kpi.am.activeChannels90d.hq}개</div>
        </div>
      </div>

      <!-- 미팅 캘린더 -->
      ${kpi.calendarMeta ? (() => {
        const cm = kpi.calendarMeta;
        const cal = kpi.meetingCalendar || {};
        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
        const pad2 = n => String(n).padStart(2, '0');

        // 캘린더 셀 생성
        let cells = '';
        // 빈 셀 (1일 이전)
        for (let i = 0; i < cm.firstDay; i++) {
          cells += '<div style="background:#e0e0e0; min-height:120px;"></div>';
        }
        // 날짜 셀
        for (let d = 1; d <= cm.totalDays; d++) {
          const dateStr = `${cm.year}-${pad2(cm.month)}-${pad2(d)}`;
          const dayMeetings = cal[dateStr] || [];
          const isToday = d === cm.today;
          const isPast = dateStr < kpi.date;
          const dayOfWeek = (cm.firstDay + d - 1) % 7;
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

          let bg = '#fff';
          if (isToday) bg = '#e3f2fd';
          if (isWeekend) bg = '#f5f5f5';

          const meetingHtml = dayMeetings.slice(0, 4).map(m => {
            const statusColor = isPast ? '#107c10' : isToday ? '#0078d4' : '#ff8c00';
            const mouColor = m.isMouComplete ? '#00b7c3' : '#e81123';
            return `<div style="font-size:0.75em; padding:3px 5px; margin:2px 0; border-left:3px solid ${statusColor}; background:#f8f8f8; display:flex; justify-content:space-between; align-items:center;">
              <div style="overflow:hidden; white-space:nowrap; text-overflow:ellipsis; flex:1;">
                <span style="color:${mouColor}; font-size:0.9em;">●</span>
                <span style="color:#333;">${m.startTime !== '-' ? m.startTime + ' ' : ''}${m.accountName.substring(0, 15)}</span>
              </div>
              <div style="color:#666; font-size:0.9em; margin-left:5px; white-space:nowrap;">${m.owner.substring(0, 4)}</div>
            </div>`;
          }).join('');

          const moreCount = dayMeetings.length > 4 ? `<div style="font-size:0.7em; color:#666; text-align:center;">+${dayMeetings.length - 4}건 더</div>` : '';

          cells += `<div style="background:${bg}; min-height:120px; padding:5px; border:1px solid ${isToday ? '#0078d4' : '#e0e0e0'}; ${isToday ? 'box-shadow:0 0 0 2px #0078d4;' : ''}">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <span style="font-size:0.9em; font-weight:${isToday ? '500' : '400'}; color:${isToday ? '#0078d4' : isWeekend ? '#999' : '#333'};">${d}</span>
              ${dayMeetings.length > 0 ? '<span style="font-size:0.7em; background:#0078d4; color:#fff; padding:1px 6px; border-radius:2px;">' + dayMeetings.length + '</span>' : ''}
            </div>
            ${meetingHtml}${moreCount}
          </div>`;
        }

        return `
      <h4 style="margin:30px 0 15px;">미팅 캘린더 (${cm.monthLabel})</h4>
      <div style="margin-bottom:10px; display:flex; gap:20px; font-size:0.85em; color:#666;">
        <span><span style="color:#107c10;">●</span> 완료</span>
        <span><span style="color:#0078d4;">●</span> 오늘</span>
        <span><span style="color:#ff8c00;">●</span> 예정</span>
        <span style="margin-left:20px;"><span style="color:#00b7c3;">●</span> MOU완료</span>
        <span><span style="color:#e81123;">●</span> MOU미완료</span>
      </div>
      <div style="display:grid; grid-template-columns: repeat(7, 1fr); gap:2px;">
        ${dayNames.map(d => '<div style="text-align:center; padding:8px; background:#f5f5f5; font-size:0.85em; font-weight:500; color:#666; text-transform:uppercase;">' + d + '</div>').join('')}
        ${cells}
      </div>`;
      })() : ''}

      <!-- 담당자별 미팅 요약 -->
      ${kpi.meetingsByOwner && kpi.meetingsByOwner.length > 0 ? `
      <h4 style="margin:30px 0 15px;">담당자별 미팅 요약 (이번달)</h4>
      <table>
        <thead>
          <tr><th>담당자</th><th class="text-center">합계</th><th class="text-center">MOU완료</th><th class="text-center">MOU미완료</th></tr>
        </thead>
        <tbody>
          ${kpi.meetingsByOwner.slice(0, 10).map(o => `
          <tr>
            <td>${o.name}</td>
            <td class="text-center">${o.total}</td>
            <td class="text-center">${o.mouComplete}</td>
            <td class="text-center">${o.mouIncomplete}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}
    </div>
    ` : ''}

    <!-- 활동 현황 (Lead 생성일 기준) -->
    <div class="card">
      <h2>활동 현황 (Lead 생성일 기준)</h2>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:25px;">
        <!-- 이번 달 -->
        <div class="tile tile-red">
          <h3 style="margin-bottom:20px;">이번 달 (${summary.activity.thisMonth})</h3>
          <div style="display:flex; gap:40px;">
            <div style="text-align:center;">
              <div style="font-size:3em; font-weight:300;">${summary.activity.activePartnerThisMonth}</div>
              <div style="font-size:0.9em; opacity:0.85; text-transform:uppercase;">활동 파트너사</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:3em; font-weight:300;">${summary.activity.activeHQThisMonth}</div>
              <div style="font-size:0.9em; opacity:0.85; text-transform:uppercase;">활동 프랜차이즈본사</div>
            </div>
          </div>
        </div>
        <!-- 최근 3개월 -->
        <div class="tile tile-teal">
          <h3 style="margin-bottom:20px;">최근 3개월 (${summary.activity.threeMonthsAgo} ~ ${summary.activity.thisMonth})</h3>
          <div style="display:flex; gap:40px;">
            <div style="text-align:center;">
              <div style="font-size:3em; font-weight:300;">${summary.activity.activePartnerLast3Months}</div>
              <div style="font-size:0.9em; opacity:0.85; text-transform:uppercase;">활동 파트너사</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:3em; font-weight:300;">${summary.activity.activeHQLast3Months}</div>
              <div style="font-size:0.9em; opacity:0.85; text-transform:uppercase;">활동 프랜차이즈본사</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 이번 달 활동 상세 -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
        <!-- 이번 달 활동 파트너사 -->
        <div>
          <h4 style="margin-bottom:15px;">이번 달 활동 파트너사 (${activePartnerThisMonth?.length || 0}개)</h4>
          <table>
            <thead>
              <tr><th>파트너명</th><th class="text-center">이번달</th><th class="text-center">3개월</th><th class="text-center">최근Lead</th></tr>
            </thead>
            <tbody>
              ${(activePartnerThisMonth || []).sort((a, b) => b.thisMonthLeadCount - a.thisMonthLeadCount).slice(0, 15).map(renderActivePartnerRow).join('')}
            </tbody>
          </table>
        </div>
        <!-- 이번 달 활동 프랜차이즈 본사 -->
        <div>
          <h4 style="margin-bottom:15px;">이번 달 활동 프랜차이즈 본사 (${activeHQThisMonth?.length || 0}개)</h4>
          <table>
            <thead>
              <tr><th>본사명</th><th class="text-center">이번달</th><th class="text-center">3개월</th><th class="text-center">최근Lead</th></tr>
            </thead>
            <tbody>
              ${(activeHQThisMonth || []).sort((a, b) => b.thisMonthLeadCount - a.thisMonthLeadCount).slice(0, 15).map(renderActiveHQRow).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- MOU 체결 현황 및 초기 안착률 -->
    <div class="card">
      <h2>MOU 체결 현황 및 초기 안착률</h2>
      <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:15px; margin-bottom:25px;">
        <!-- 이번 달 MOU 체결 -->
        <div class="tile tile-green">
          <h3 style="margin-bottom:20px;">이번 달 MOU 체결</h3>
          <div style="display:flex; gap:30px;">
            <div style="text-align:center;">
              <div style="font-size:2.5em; font-weight:300;">${summary.mou?.partner?.thisMonth || 0}</div>
              <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase;">파트너사</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:2.5em; font-weight:300;">${summary.mou?.franchiseHQ?.thisMonth || 0}</div>
              <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase;">본사</div>
            </div>
          </div>
        </div>
        <!-- 최근 3개월 MOU 체결 -->
        <div class="tile tile-purple">
          <h3 style="margin-bottom:20px;">최근 3개월 MOU</h3>
          <div style="display:flex; gap:30px;">
            <div style="text-align:center;">
              <div style="font-size:2.5em; font-weight:300;">${summary.mou?.partner?.last3Months || 0}</div>
              <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase;">파트너사</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:2.5em; font-weight:300;">${summary.mou?.franchiseHQ?.last3Months || 0}</div>
              <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase;">본사</div>
            </div>
          </div>
        </div>
        <!-- 초기 안착률 -->
        <div class="tile tile-red">
          <h3 style="margin-bottom:20px;">초기 안착률 (3개월)</h3>
          <div style="display:flex; gap:25px; flex-wrap:wrap;">
            <div style="text-align:center;">
              <div style="font-size:2.2em; font-weight:300;">${summary.mou?.onboarding?.partner?.rate || 0}%</div>
              <div style="font-size:0.8em; opacity:0.85; text-transform:uppercase;">파트너사 (${summary.mou?.onboarding?.partner?.settled || 0}/${summary.mou?.onboarding?.partner?.total || 0})</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:2.2em; font-weight:300;">${summary.mou?.onboarding?.franchiseBrand?.rate || 0}%</div>
              <div style="font-size:0.8em; opacity:0.85; text-transform:uppercase;">브랜드 (${summary.mou?.onboarding?.franchiseBrand?.settled || 0}/${summary.mou?.onboarding?.franchiseBrand?.total || 0})</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 이번 달 MOU 체결 상세 -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
        <!-- 이번 달 MOU 체결 파트너사 -->
        <div>
          <h4 style="margin-bottom:15px;">이번 달 MOU 체결 파트너사 (${mouStats?.partner?.thisMonthList?.length || 0}개)</h4>
          <table>
            <thead>
              <tr><th>파트너명</th><th>담당자</th><th class="text-center">MOU시작</th><th class="text-center">Lead</th><th class="text-center">안착</th></tr>
            </thead>
            <tbody>
              ${(mouStats?.partner?.thisMonthList || []).map(renderMOUPartnerRow).join('') || '<tr><td colspan="5" class="text-center">-</td></tr>'}
            </tbody>
          </table>
        </div>
        <!-- 이번 달 MOU 체결 프랜차이즈 본사 -->
        <div>
          <h4 style="margin-bottom:15px;">이번 달 MOU 체결 프랜차이즈 본사 (${mouStats?.franchiseHQ?.thisMonthList?.length || 0}개)</h4>
          <table>
            <thead>
              <tr><th>본사명</th><th>담당자</th><th class="text-center">MOU시작</th><th class="text-center">Lead</th><th class="text-center">안착</th></tr>
            </thead>
            <tbody>
              ${(mouStats?.franchiseHQ?.thisMonthList || []).map(renderMOUHQRow).join('') || '<tr><td colspan="5" class="text-center">-</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <!-- 미안착 파트너사/브랜드 -->
      ${(() => {
        const unsettledPartners = mouStats?.onboarding?.partner?.list?.filter(p => !p.isSettled) || [];
        const unsettledBrands = mouStats?.onboarding?.franchiseBrand?.list?.filter(b => !b.isSettled) || [];
        if (unsettledPartners.length === 0 && unsettledBrands.length === 0) return '';
        return `
      <div style="margin-top:25px;">
        <h4 style="margin-bottom:15px; color:#e81123;">미안착 현황 - MOU 체결 후 Lead 미생산</h4>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
          <div>
            <p style="color:#666; font-size:0.9em; margin-bottom:10px;">파트너사 (${unsettledPartners.length}개)</p>
            <table>
              <thead>
                <tr><th>파트너명</th><th>담당자</th><th class="text-center">MOU시작</th><th class="text-center">안착기한</th></tr>
              </thead>
              <tbody>
                ${unsettledPartners.map(p => `
                <tr style="background:#ffebee;">
                  <td>${p.name}</td>
                  <td>${p.owner}</td>
                  <td class="text-center">${p.mouStart || '-'}</td>
                  <td class="text-center">${p.mouEndWindow || '-'}</td>
                </tr>`).join('') || '<tr><td colspan="4" class="text-center">-</td></tr>'}
              </tbody>
            </table>
          </div>
          <div>
            <p style="color:#666; font-size:0.9em; margin-bottom:10px;">프랜차이즈 브랜드 (${unsettledBrands.length}개)</p>
            <table>
              <thead>
                <tr><th>브랜드명</th><th>본사명</th><th class="text-center">MOU시작</th><th class="text-center">안착기한</th></tr>
              </thead>
              <tbody>
                ${unsettledBrands.slice(0, 15).map(b => `
                <tr style="background:#ffebee;">
                  <td>${b.brandName}</td>
                  <td style="font-size:0.85em;">${b.hqName}</td>
                  <td class="text-center">${b.mouStart || '-'}</td>
                  <td class="text-center">${b.mouEndWindow || '-'}</td>
                </tr>`).join('') || '<tr><td colspan="4" class="text-center">-</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
      })()}
    </div>

    <!-- 담당자별 Lead 현황 -->
    <div class="card">
      <h2>담당자별 Lead 현황 (${stats.kpi.thisMonth})</h2>
      <table>
        <thead>
          <tr>
            <th>담당자</th>
            <th class="text-center">파트너사</th>
            <th class="text-center">파트너 Lead</th>
            <th class="text-center">프랜차이즈</th>
            <th class="text-center">프랜차이즈 Lead</th>
            <th class="text-center">합계 Lead</th>
            <th class="text-center">전환</th>
            <th class="text-center">전환율</th>
          </tr>
        </thead>
        <tbody>
          ${ownerStats.map(o => {
            const convRate = o.totalLeads > 0 ? ((o.totalConverted / o.totalLeads) * 100).toFixed(1) : '0.0';
            return `
          <tr>
            <td>${o.name}</td>
            <td class="text-center">${o.partnerCount}</td>
            <td class="text-center">${o.partnerLeads}</td>
            <td class="text-center">${o.franchiseCount}</td>
            <td class="text-center">${o.franchiseLeads}</td>
            <td class="text-center" style="font-weight:600; color:#4fc3f7;">${o.totalLeads}</td>
            <td class="text-center">${o.totalConverted}</td>
            <td class="text-center" style="color:${parseFloat(convRate) >= 30 ? '#66bb6a' : '#ef5350'};">${convRate}%</td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>

      <!-- AM 일별 Lead 캘린더 -->
      ${summary.channelLeadsByOwner?.amHeatmap?.data?.length > 0 ? (() => {
        const heatmap = summary.channelLeadsByOwner.amHeatmap;
        const cal = heatmap.calendar;
        const maxVal = heatmap.maxValue;
        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

        // AM별 캘린더 카드 생성
        const amCalendars = heatmap.data.map(row => {
          // 캘린더 그리드 생성 (7열)
          let calendarHtml = '<div style="display:grid; grid-template-columns:repeat(7,1fr); gap:2px; text-align:center;">';

          // 요일 헤더
          dayNames.forEach((name, i) => {
            const color = i === 0 ? '#e81123' : (i === 6 ? '#0078d4' : '#888');
            calendarHtml += '<div style="font-size:0.75em; color:' + color + '; padding:4px;">' + name + '</div>';
          });

          // 첫 주 빈 칸
          for (let i = 0; i < cal.firstDayOfWeek; i++) {
            calendarHtml += '<div></div>';
          }

          // 날짜 셀
          row.dailyData.forEach(d => {
            const intensity = d.count > 0 ? Math.min(0.3 + (d.count / maxVal) * 0.7, 1) : 0;
            const bgColor = d.count > 0 ? 'rgba(255, 140, 0, ' + intensity.toFixed(2) + ')' : (d.isWeekend ? '#e0e0e0' : '#f0f0f0');
            const textColor = d.count > 0 ? (intensity > 0.5 ? '#fff' : '#ff8c00') : (d.isWeekend ? '#555' : '#888');
            const border = d.count === 0 && !d.isWeekend ? '1px solid #e81123' : 'none';
            calendarHtml += '<div style="background:' + bgColor + '; color:' + textColor + '; padding:6px 2px; border-radius:4px; border:' + border + ';">';
            calendarHtml += '<div style="font-size:0.7em; opacity:0.7;">' + d.day + '</div>';
            calendarHtml += '<div style="font-size:1.1em; font-weight:500;">' + (d.count || '-') + '</div>';
            calendarHtml += '</div>';
          });

          calendarHtml += '</div>';

          return '<div style="background:#fff; padding:15px; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.1);">' +
            '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">' +
            '<span style="font-weight:600; color:#ff8c00;">' + row.owner + '</span>' +
            '<span style="font-size:0.85em;"><span style="color:#ff8c00; font-weight:600;">' + row.total + '</span>건' +
            (row.zeroDays > 0 ? ' <span style="color:#e81123; margin-left:8px;">0건: ' + row.zeroDays + '일</span>' : '') +
            '</span></div>' + calendarHtml + '</div>';
        }).join('');

        return `
      <h4 style="margin:25px 0 15px;">AM 일별 Lead 캘린더 (${cal.year}년 ${cal.month}월)</h4>
      <p style="color:#666; font-size:0.85em; margin-bottom:15px;">AM이 관리하는 파트너사/프랜차이즈에서 발생한 Lead 현황 | <span style="color:#e81123;">빨간 테두리 = 평일 0건</span></p>
      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:15px;">
        ${amCalendars}
      </div>`;
      })() : ''}
    </div>

    <!-- TM 파트 - MQL/SQL 현황 -->
    ${summary.channelLeadsByOwner && summary.channelLeadsByOwner.data.length > 0 ? `
    <div class="card" style="border-left-color:#8661c5;">
      <h2 style="border-bottom-color:#8661c5;">TM 파트 - MQL/SQL 현황 (${summary.channelLeadsByOwner.thisMonth})</h2>
      <p style="color:#666; margin-bottom:20px; font-size:0.9em;">* 오인입/중복유입/오생성 제외 후 MQL 산정</p>

      <!-- 요약 타일 -->
      <div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:15px; margin-bottom:25px;">
        <div class="tile tile-dark">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">전체 Lead</div>
          <div style="font-size:2.5em; font-weight:300;">${summary.channelLeadsByOwner.total}</div>
        </div>
        <div class="tile" style="background:#e81123;">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">제외</div>
          <div style="font-size:2.5em; font-weight:300;">${summary.channelLeadsByOwner.totalExcluded}</div>
          <div style="font-size:0.8em; opacity:0.7;">오인입/중복/오생성</div>
        </div>
        <div class="tile tile-blue">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">MQL (유효)</div>
          <div style="font-size:2.5em; font-weight:300;">${summary.channelLeadsByOwner.totalMQL}</div>
        </div>
        <div class="tile tile-green">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">SQL (전환)</div>
          <div style="font-size:2.5em; font-weight:300;">${summary.channelLeadsByOwner.totalSQL}</div>
        </div>
        <div class="tile tile-purple">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">전환율</div>
          <div style="font-size:2.5em; font-weight:300;">${summary.channelLeadsByOwner.conversionRate}%</div>
        </div>
      </div>

      <!-- 소유자별 상세 -->
      <table>
        <thead>
          <tr>
            <th>소유자</th>
            <th class="text-center">전체</th>
            <th class="text-center">제외</th>
            <th class="text-center">MQL</th>
            <th class="text-center">SQL</th>
            <th class="text-center">전환율</th>
          </tr>
        </thead>
        <tbody>
          ${summary.channelLeadsByOwner.data.map(o => `
          <tr>
            <td><strong style="font-weight:500;">${o.owner}</strong></td>
            <td class="text-center" style="color:#666;">${o.total}</td>
            <td class="text-center" style="color:#e81123;">${o.excluded}</td>
            <td class="text-center" style="color:#0078d4;"><strong>${o.mql}</strong></td>
            <td class="text-center" style="color:#107c10;"><strong>${o.sql}</strong></td>
            <td class="text-center" style="color:#8661c5;">${o.conversionRate}%</td>
          </tr>`).join('')}
          <tr style="background:#f5f5f5; font-weight:500;">
            <td>합계</td>
            <td class="text-center" style="color:#666;">${summary.channelLeadsByOwner.total}</td>
            <td class="text-center" style="color:#e81123;">${summary.channelLeadsByOwner.totalExcluded}</td>
            <td class="text-center" style="color:#0078d4;">${summary.channelLeadsByOwner.totalMQL}</td>
            <td class="text-center" style="color:#107c10;">${summary.channelLeadsByOwner.totalSQL}</td>
            <td class="text-center" style="color:#8661c5;">${summary.channelLeadsByOwner.conversionRate}%</td>
          </tr>
        </tbody>
      </table>

      <!-- LeadSource별 상세 -->
      <h4 style="margin:25px 0 15px;">LeadSource별 상세</h4>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
        <div style="background:#fff; padding:20px;">
          <h4 style="color:#0078d4; margin-bottom:15px;">파트너사 소개</h4>
          <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; text-align:center;">
            <div>
              <div style="color:#666; font-size:0.85em;">MQL</div>
              <div style="font-size:2em; font-weight:300; color:#0078d4;">${summary.channelLeadsByOwner.partnerMQL}</div>
            </div>
            <div>
              <div style="color:#666; font-size:0.85em;">SQL</div>
              <div style="font-size:2em; font-weight:300; color:#107c10;">${summary.channelLeadsByOwner.partnerSQL}</div>
            </div>
            <div>
              <div style="color:#666; font-size:0.85em;">전환율</div>
              <div style="font-size:2em; font-weight:300; color:#8661c5;">${summary.channelLeadsByOwner.partnerMQL > 0 ? ((summary.channelLeadsByOwner.partnerSQL / summary.channelLeadsByOwner.partnerMQL) * 100).toFixed(1) : '0.0'}%</div>
            </div>
          </div>
        </div>
        <div style="background:#fff; padding:20px;">
          <h4 style="color:#ff8c00; margin-bottom:15px;">프랜차이즈소개</h4>
          <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; text-align:center;">
            <div>
              <div style="color:#666; font-size:0.85em;">MQL</div>
              <div style="font-size:2em; font-weight:300; color:#0078d4;">${summary.channelLeadsByOwner.franchiseMQL}</div>
            </div>
            <div>
              <div style="color:#666; font-size:0.85em;">SQL</div>
              <div style="font-size:2em; font-weight:300; color:#107c10;">${summary.channelLeadsByOwner.franchiseSQL}</div>
            </div>
            <div>
              <div style="color:#666; font-size:0.85em;">전환율</div>
              <div style="font-size:2em; font-weight:300; color:#8661c5;">${summary.channelLeadsByOwner.franchiseMQL > 0 ? ((summary.channelLeadsByOwner.franchiseSQL / summary.channelLeadsByOwner.franchiseMQL) * 100).toFixed(1) : '0.0'}%</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 일별 Lead 히트맵 -->
      ${summary.channelLeadsByOwner.heatmap && summary.channelLeadsByOwner.heatmap.data.length > 0 ? (() => {
        const heatmap = summary.channelLeadsByOwner.heatmap;
        const maxVal = heatmap.maxValue;
        const daysHeader = heatmap.days.map(d => '<th class="text-center" style="min-width:28px; padding:4px 2px;">' + parseInt(d) + '</th>').join('');
        const rows = heatmap.data.map(row => {
          const cells = row.dailyData.map(d => {
            const intensity = d.count > 0 ? Math.min(0.2 + (d.count / maxVal) * 0.8, 1) : 0;
            const bgColor = d.count > 0 ? 'rgba(0, 120, 212, ' + intensity.toFixed(2) + ')' : 'transparent';
            const textColor = intensity > 0.5 ? '#fff' : (d.count > 0 ? '#0078d4' : '#555');
            return '<td class="text-center" style="background:' + bgColor + '; color:' + textColor + '; padding:4px 2px;">' + (d.count || '-') + '</td>';
          }).join('');
          return '<tr><td style="white-space:nowrap;">' + row.owner + '</td>' + cells + '<td class="text-center" style="font-weight:600; color:#4fc3f7;">' + row.total + '</td></tr>';
        }).join('');
        return `
      <h4 style="margin:25px 0 15px;">일별 Lead 히트맵</h4>
      <p style="color:#666; font-size:0.85em; margin-bottom:15px;">담당자별 일별 Lead 생성 현황 (색상이 진할수록 많음)</p>
      <div style="overflow-x:auto;">
        <table style="font-size:0.85em;">
          <thead>
            <tr>
              <th style="min-width:80px;">담당자</th>
              ${daysHeader}
              <th class="text-center" style="min-width:40px;">합계</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>`;
      })() : ''}

      <!-- FRT (First Response Time) -->
      ${summary.channelLeadsByOwner.frt ? `
      <h4 style="margin:25px 0 15px;">First Response Time (FRT)</h4>
      <p style="color:#666; font-size:0.85em; margin-bottom:15px;">Lead 생성 → 첫 Task 생성까지 소요 시간 (목표: 20분 이내)</p>
      <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:15px; margin-bottom:20px;">
        <div class="tile tile-dark">
          <div style="font-size:0.85em; opacity:0.85; margin-bottom:10px;">MQL Lead</div>
          <div style="font-size:2.5em; font-weight:300;">${summary.channelLeadsByOwner.frt.totalMQL}</div>
        </div>
        <div class="tile" style="background:#00b7c3;">
          <div style="font-size:0.85em; opacity:0.85; margin-bottom:10px;">Task 있음</div>
          <div style="font-size:2.5em; font-weight:300;">${summary.channelLeadsByOwner.frt.withTask}</div>
        </div>
        <div class="tile" style="background:${summary.channelLeadsByOwner.frt.over20 === 0 ? '#107c10' : '#e81123'};">
          <div style="font-size:0.85em; opacity:0.85; margin-bottom:10px;">20분 초과</div>
          <div style="font-size:2.5em; font-weight:300;">${summary.channelLeadsByOwner.frt.over20}</div>
          <div style="font-size:0.8em; opacity:0.7;">목표: 0건</div>
        </div>
        <div class="tile tile-blue">
          <div style="font-size:0.85em; opacity:0.85; margin-bottom:10px;">평균 FRT</div>
          <div style="font-size:2.5em; font-weight:300;">${summary.channelLeadsByOwner.frt.avgFRT}분</div>
        </div>
      </div>
      ${summary.channelLeadsByOwner.frt.over20 > 0 ? `
      <details style="background:#ffebee; padding:15px; margin-bottom:15px;">
        <summary style="cursor:pointer; color:#ff8c00;">20분 초과 Lead 목록 (${summary.channelLeadsByOwner.frt.over20}건)</summary>
        <table style="margin-top:10px;">
          <thead>
            <tr><th>Lead</th><th>담당자</th><th>FRT</th></tr>
          </thead>
          <tbody>
            ${summary.channelLeadsByOwner.frt.over20List.map(f => `
            <tr>
              <td>${f.leadName || '-'}</td>
              <td>${f.owner}</td>
              <td style="color:#e81123;">${f.frt}분</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </details>
      ` : ''}
      ` : ''}

      <!-- 담당자별 FRT & Task 상세 -->
      ${summary.channelLeadsByOwner.frt?.byOwner?.length > 0 ? `
      <h4 style="margin:25px 0 15px;">⏱️ 담당자별 FRT & Task</h4>
      <table>
        <thead>
          <tr>
            <th>담당자</th>
            <th class="text-center">MQL Lead</th>
            <th class="text-center">Task 있음</th>
            <th class="text-center">20분 이내</th>
            <th class="text-center">20분 초과</th>
            <th class="text-center">FRT 준수율</th>
            <th class="text-center">평균 FRT</th>
          </tr>
        </thead>
        <tbody>
          ${summary.channelLeadsByOwner.frt.byOwner.map(o => `
          <tr>
            <td>${o.name}</td>
            <td class="text-center">${o.total}</td>
            <td class="text-center">${o.withTask}</td>
            <td class="text-center" style="color:#107c10;">${o.frtOk}</td>
            <td class="text-center" style="color:${o.over20 > 0 ? '#e81123' : '#107c10'};">${o.over20}</td>
            <td class="text-center" style="color:${parseFloat(o.frtRate) >= 80 ? '#107c10' : '#e81123'}; font-weight:600;">${o.frtRate}%</td>
            <td class="text-center">${o.avgFrt !== null ? o.avgFrt + '분' : '-'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ` : ''}

      <!-- 담당자별 시간대별 분석 -->
      ${summary.channelLeadsByOwner.timeSlotByOwner?.length > 0 ? `
      <h4 style="margin:25px 0 15px;">🕐 담당자별 시간대별 분석</h4>
      <table>
        <thead>
          <tr>
            <th rowspan="2">담당자</th>
            <th colspan="2" class="text-center" style="background:#e8f0fe;">영업시간</th>
            <th colspan="2" class="text-center" style="background:#fff3e0;">영업외</th>
            <th colspan="2" class="text-center" style="background:#f3e5f5;">주말</th>
            <th rowspan="2" class="text-center">합계</th>
          </tr>
          <tr>
            <th class="text-center" style="background:#e8f0fe;">Lead</th>
            <th class="text-center" style="background:#e8f0fe;">전환</th>
            <th class="text-center" style="background:#fff3e0;">Lead</th>
            <th class="text-center" style="background:#fff3e0;">전환</th>
            <th class="text-center" style="background:#f3e5f5;">Lead</th>
            <th class="text-center" style="background:#f3e5f5;">전환</th>
          </tr>
        </thead>
        <tbody>
          ${summary.channelLeadsByOwner.timeSlotByOwner.map(o => `
          <tr>
            <td>${o.name}</td>
            <td class="text-center">${o.BUSINESS_HOUR.total}</td>
            <td class="text-center" style="color:#107c10;">${o.BUSINESS_HOUR.converted}</td>
            <td class="text-center">${o.OFF_HOUR.total}</td>
            <td class="text-center" style="color:#107c10;">${o.OFF_HOUR.converted}</td>
            <td class="text-center">${o.WEEKEND.total}</td>
            <td class="text-center" style="color:#107c10;">${o.WEEKEND.converted}</td>
            <td class="text-center" style="font-weight:600; color:#4fc3f7;">${o.total}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ` : ''}

      <!-- FRT 구간별 오인입/전환 분석 -->
      ${summary.channelLeadsByOwner.frt?.byBucket?.length > 0 ? `
      <h4 style="margin:25px 0 15px;">📈 FRT 구간별 오인입/전환 분석</h4>
      <table>
        <thead>
          <tr>
            <th>FRT 구간</th>
            <th class="text-center">건수</th>
            <th class="text-center">전환</th>
            <th class="text-center">전환율</th>
            <th class="text-center">오인입</th>
            <th class="text-center">오인입율</th>
          </tr>
        </thead>
        <tbody>
          ${summary.channelLeadsByOwner.frt.byBucket.map(b => `
          <tr>
            <td>${b.bucket}</td>
            <td class="text-center">${b.total}</td>
            <td class="text-center" style="color:#107c10;">${b.converted}</td>
            <td class="text-center">${b.convRate}%</td>
            <td class="text-center" style="color:${b.wrongEntry > 0 ? '#e81123' : '#666'};">${b.wrongEntry}</td>
            <td class="text-center" style="color:${parseFloat(b.wrongRate) > 0 ? '#e81123' : '#666'};">${b.wrongRate}%</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ` : ''}

      <!-- 시간대별 FRT 상세 -->
      ${summary.channelLeadsByOwner.frt?.byTimeSlot ? `
      <h4 style="margin:25px 0 15px;">🕰️ 시간대별 FRT 상세</h4>
      <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:15px;">
        ${['BUSINESS_HOUR', 'OFF_HOUR', 'WEEKEND'].map(slot => {
          const s = summary.channelLeadsByOwner.frt.byTimeSlot[slot];
          if (!s) return '';
          const icons = { BUSINESS_HOUR: '☀️', OFF_HOUR: '🌙', WEEKEND: '🗓️' };
          return `
        <div style="background:#fff; padding:20px; border-radius:8px;">
          <h4 style="margin-bottom:15px;">${icons[slot]} ${s.label}</h4>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; text-align:center;">
            <div>
              <div style="color:#666; font-size:0.85em;">Lead</div>
              <div style="font-size:1.8em; font-weight:300;">${s.total}</div>
            </div>
            <div>
              <div style="color:#666; font-size:0.85em;">Task 있음</div>
              <div style="font-size:1.8em; font-weight:300;">${s.withTask}</div>
            </div>
            <div>
              <div style="color:#666; font-size:0.85em;">평균 FRT</div>
              <div style="font-size:1.8em; font-weight:300; color:#0078d4;">${s.avgFrt !== null ? s.avgFrt + '분' : '-'}</div>
            </div>
            <div>
              <div style="color:#666; font-size:0.85em;">FRT 준수율</div>
              <div style="font-size:1.8em; font-weight:300; color:${parseFloat(s.frtRate) >= 80 ? '#107c10' : '#e81123'};">${s.frtRate}%</div>
            </div>
            <div>
              <div style="color:#666; font-size:0.85em;">전환</div>
              <div style="font-size:1.8em; font-weight:300; color:#107c10;">${s.converted}</div>
            </div>
            <div>
              <div style="color:#666; font-size:0.85em;">전환율</div>
              <div style="font-size:1.8em; font-weight:300; color:#8661c5;">${s.convRate}%</div>
            </div>
          </div>
        </div>`;
        }).join('')}
      </div>
      ` : ''}

      <!-- 오인입 사유 분석 -->
      ${summary.channelLeadsByOwner.wrongEntry?.total > 0 ? `
      <h4 style="margin:25px 0 15px;">📋 오인입 사유 분석</h4>
      <div style="display:grid; grid-template-columns: 1fr 3fr; gap:15px;">
        <div class="tile" style="background:#e81123;">
          <div style="font-size:0.85em; opacity:0.85; margin-bottom:10px;">오인입</div>
          <div style="font-size:3em; font-weight:300;">${summary.channelLeadsByOwner.wrongEntry.total}건</div>
          <div style="font-size:0.9em; opacity:0.7;">전체의 ${summary.channelLeadsByOwner.wrongEntry.rate}%</div>
        </div>
        <div style="background:#fff; padding:20px;">
          <table>
            <thead>
              <tr>
                <th>사유</th>
                <th class="text-center">건수</th>
                <th class="text-center">비율</th>
              </tr>
            </thead>
            <tbody>
              ${summary.channelLeadsByOwner.wrongEntry.byReason.map(r => `
              <tr>
                <td>${r.reason}</td>
                <td class="text-center" style="color:#e81123; font-weight:600;">${r.count}</td>
                <td class="text-center">${r.rate}%</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      ` : ''}

      <!-- MQL → SQL 미전환 -->
      ${summary.channelLeadsByOwner.notConverted ? `
      <h4 style="margin:25px 0 15px;">MQL → SQL 미전환 현황</h4>
      <p style="color:#666; font-size:0.85em; margin-bottom:15px;">MQL 중 아직 전환되지 않은 Lead (목표: 0건)</p>
      <div style="display:grid; grid-template-columns: 1fr 3fr; gap:15px;">
        <div class="tile" style="background:${summary.channelLeadsByOwner.notConverted.total === 0 ? '#107c10' : '#e81123'};">
          <div style="font-size:0.85em; opacity:0.85; margin-bottom:10px;">미전환 건수</div>
          <div style="font-size:3em; font-weight:300;">${summary.channelLeadsByOwner.notConverted.total}</div>
          <div style="font-size:0.8em; opacity:0.7;">목표: 0건</div>
        </div>
        <div style="background:#fff; padding:20px;">
          <h4 style="margin-bottom:15px;">담당자별 미전환</h4>
          ${summary.channelLeadsByOwner.notConverted.byOwner.length > 0 ? `
          <table>
            <thead>
              <tr><th>담당자</th><th class="text-center">미전환</th></tr>
            </thead>
            <tbody>
              ${summary.channelLeadsByOwner.notConverted.byOwner.map(o => `
              <tr>
                <td>${o.owner}</td>
                <td class="text-center" style="color:#e81123;"><strong>${o.count}</strong></td>
              </tr>`).join('')}
            </tbody>
          </table>
          ` : '<p style="color:#666;">미전환 건 없음</p>'}
        </div>
      </div>
      ` : ''}

      <!-- SQL 파이프라인 -->
      ${summary.channelLeadsByOwner.sqlPipeline ? `
      <h4 style="margin:25px 0 15px;">SQL 파이프라인 (이번달 전환 Opportunity)</h4>
      <p style="color:#666; font-size:0.85em; margin-bottom:15px;">이번달 MQL → SQL 전환된 Lead의 Opportunity 현황</p>

      <div class="tile-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom:20px;">
        <div class="tile" style="background:#0078d4;">
          <div style="font-size:0.85em; opacity:0.85;">전체</div>
          <div style="font-size:2.5em; font-weight:300;">${summary.channelLeadsByOwner.sqlPipeline.total}</div>
        </div>
        <div class="tile" style="background:#107c10;">
          <div style="font-size:0.85em; opacity:0.85;">CW (Closed Won)</div>
          <div style="font-size:2.5em; font-weight:300;">${summary.channelLeadsByOwner.sqlPipeline.cw}</div>
        </div>
        <div class="tile" style="background:#e81123;">
          <div style="font-size:0.85em; opacity:0.85;">CL (Closed Lost)</div>
          <div style="font-size:2.5em; font-weight:300;">${summary.channelLeadsByOwner.sqlPipeline.cl}</div>
        </div>
        <div class="tile" style="background:#ff8c00;">
          <div style="font-size:0.85em; opacity:0.85;">진행중</div>
          <div style="font-size:2.5em; font-weight:300;">${summary.channelLeadsByOwner.sqlPipeline.open}</div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-bottom:20px;">
        <!-- Stage별 분포 -->
        <div style="background:#fff; padding:20px;">
          <h4 style="margin-bottom:15px;">Stage별 분포</h4>
          ${summary.channelLeadsByOwner.sqlPipeline.byStageList.length > 0 ? `
          <table>
            <thead><tr><th>Stage</th><th class="text-center">건수</th></tr></thead>
            <tbody>
              ${summary.channelLeadsByOwner.sqlPipeline.byStageList.map(s => `
              <tr>
                <td>${s.stage}</td>
                <td class="text-center"><strong>${s.count}</strong></td>
              </tr>`).join('')}
            </tbody>
          </table>
          ` : '<p style="color:#666;">데이터 없음</p>'}
        </div>

        <!-- 진행중 Aging -->
        <div style="background:#fff; padding:20px;">
          <h4 style="margin-bottom:15px;">진행중 Aging</h4>
          <table>
            <thead><tr><th>기간</th><th class="text-center">건수</th></tr></thead>
            <tbody>
              <tr><td>3일 이내</td><td class="text-center" style="color:#107c10;"><strong>${summary.channelLeadsByOwner.sqlPipeline.byAging.within3}</strong></td></tr>
              <tr><td>4~7일</td><td class="text-center" style="color:#0078d4;"><strong>${summary.channelLeadsByOwner.sqlPipeline.byAging.day4to7}</strong></td></tr>
              <tr><td>8~14일</td><td class="text-center" style="color:#ff8c00;"><strong>${summary.channelLeadsByOwner.sqlPipeline.byAging.day8to14}</strong></td></tr>
              <tr><td style="color:#e81123;">14일 초과</td><td class="text-center" style="color:#e81123;"><strong>${summary.channelLeadsByOwner.sqlPipeline.byAging.over14}</strong></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 담당자별 현황 -->
      ${summary.channelLeadsByOwner.sqlPipeline.byOwnerList.length > 0 ? `
      <div style="background:#fff; padding:20px; margin-bottom:20px;">
        <h4 style="margin-bottom:15px;">담당자별 현황</h4>
        <table>
          <thead>
            <tr>
              <th>담당자</th>
              <th class="text-center">전체</th>
              <th class="text-center">CW</th>
              <th class="text-center">CL</th>
              <th class="text-center">진행중</th>
              <th class="text-center">CW율</th>
              <th class="text-center">3일내</th>
              <th class="text-center">4~7일</th>
              <th class="text-center">8~14일</th>
              <th class="text-center" style="color:#e81123;">14일+</th>
            </tr>
          </thead>
          <tbody>
            ${summary.channelLeadsByOwner.sqlPipeline.byOwnerList.map(o => `
            <tr>
              <td>${o.owner}</td>
              <td class="text-center">${o.total}</td>
              <td class="text-center" style="color:#107c10;">${o.cw}</td>
              <td class="text-center" style="color:#e81123;">${o.cl}</td>
              <td class="text-center" style="color:#ff8c00;">${o.open}</td>
              <td class="text-center">${o.cwRate}%</td>
              <td class="text-center">${o.openByAge.within3}</td>
              <td class="text-center">${o.openByAge.day4to7}</td>
              <td class="text-center">${o.openByAge.day8to14}</td>
              <td class="text-center" style="color:#e81123;">${o.openByAge.over14}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ` : ''}

      <!-- 14일+ 경과 건 상세 -->
      ${summary.channelLeadsByOwner.sqlPipeline.openList?.filter(o => o.ageInDays > 14).length > 0 ? `
      <details style="background:#fff; padding:15px; cursor:pointer;">
        <summary style="font-weight:bold; color:#e81123;">⚠️ 14일+ 경과 건 (액션 필요) - ${summary.channelLeadsByOwner.sqlPipeline.openList.filter(o => o.ageInDays > 14).length}건</summary>
        <table style="margin-top:15px;">
          <thead>
            <tr><th>Opportunity</th><th>Stage</th><th class="text-center">경과일</th><th>담당자</th><th>생성일</th></tr>
          </thead>
          <tbody>
            ${summary.channelLeadsByOwner.sqlPipeline.openList.filter(o => o.ageInDays > 14).map(o => `
            <tr>
              <td><a href="https://torderkorea.lightning.force.com/lightning/r/Opportunity/${o.oppId}/view" target="_blank" style="color:#0078d4;">${o.oppName || o.leadName}</a></td>
              <td>${o.stage}</td>
              <td class="text-center" style="color:#e81123;"><strong>${o.ageInDays}일</strong></td>
              <td>${o.owner}</td>
              <td>${o.createdDate || '-'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </details>
      ` : ''}
      ` : ''}
    </div>
    ` : ''}

  </div>
</body>
</html>`;

  const path = require('path');
  const filename = `ChannelSales_Report_${now.replace(/-/g, '')}.html`;
  const filepath = path.join(__dirname, '..', filename);
  fs.writeFileSync(filepath, html);
  console.log(`\n📄 HTML 리포트 생성: ${filename}`);
  return filename;
}


module.exports = { generateHTML };
