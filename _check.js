const d = require('./data/kpi-extract-2026-02.json');
console.log('=== 일별 BO CW/CL (History 기준) ===');
(d.dailyTrends || []).forEach(t => {
  const bo = t.inboundBO;
  if (bo == null) return;
  console.log(t.date + '(' + t.dayName + ') SQL:' + bo.sqlTotal + ' CW:' + bo.cw + ' CL:' + bo.cl + ' 마감합계:' + bo.totalClosed);
});
