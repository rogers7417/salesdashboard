function handler(event) {
  var clientIP = event.viewer.ip;

  // 대역대 허용: 165.225.x.x, 165.255.x.x, 147.161.x.x, 121.140.x.x
  if (clientIP.startsWith('165.225.') || clientIP.startsWith('165.255.') ||
      clientIP.startsWith('147.161.') || clientIP.startsWith('121.140.')) {
    return event.request;
  }

  // 개별 IP 허용
  if (clientIP === '72.14.201.132') {
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
