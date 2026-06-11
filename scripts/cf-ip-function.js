function handler(event) {
  var clientIP = event.viewer.ip;

  // 대역대 허용: 165.225.x.x, 165.255.x.x
  if (clientIP.startsWith('165.225.') || clientIP.startsWith('165.255.')) {
    return event.request;
  }

  // 개별 IP 허용
  if (clientIP === '72.14.201.132' || clientIP === '121.140.92.55' || clientIP === '147.161.193.7') {
    return event.request;
  }

  return {
    statusCode: 403,
    statusDescription: 'Forbidden',
    headers: {
      'content-type': { value: 'text/html' }
    },
    body: 'Access Denied'
  };
}
