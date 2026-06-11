function handler(event) {
  var req = event.request;
  var hdr = req.headers['user-agent'];
  var ua = (hdr && hdr.value ? hdr.value : '').toLowerCase();

  // 검색엔진/크롤러 봇 차단 (색인 방지) — 그 외 모든 IP 허용
  var bots = [
    'googlebot', 'google-extended', 'bingbot', 'bingpreview', 'slurp', 'duckduckbot',
    'baiduspider', 'yandex', 'sogou', 'exabot', 'facebot', 'facebookexternalhit',
    'ia_archiver', 'petalbot', 'yeti', 'naver', 'daum', 'semrushbot', 'ahrefsbot',
    'mj12bot', 'dotbot', 'bytespider', 'gptbot', 'ccbot', 'claudebot', 'anthropic',
    'perplexitybot', 'applebot', 'amazonbot', 'crawler', 'spider'
  ];
  for (var i = 0; i < bots.length; i++) {
    if (ua.indexOf(bots[i]) !== -1) {
      return {
        statusCode: 403,
        statusDescription: 'Forbidden',
        headers: { 'x-robots-tag': { value: 'noindex, nofollow' } },
        body: 'Access Denied'
      };
    }
  }

  return req;
}
