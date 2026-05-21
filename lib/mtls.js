'use strict';

// mTLS fast-path. Two ingestion modes:
//   - 'native':  read req.socket.getPeerCertificate(true) on a Node TLS server
//   - 'proxy':   trust X-Client-Cert-SHA256 / X-Client-Cert-Subject set by an
//                upstream proxy whose IP is in allowedProxyIPs

function fingerprintFromNative(req) {
  const sock = req.socket;
  if (!sock || typeof sock.getPeerCertificate !== 'function') return null;
  try {
    const cert = sock.getPeerCertificate(true);
    if (!cert || !cert.fingerprint256) return null;
    return {
      sha256: cert.fingerprint256.replace(/:/g, '').toLowerCase(),
      subject: typeof cert.subject === 'object' && cert.subject
        ? Object.entries(cert.subject).map(([k, v]) => `${k}=${v}`).join(',')
        : String(cert.subject || ''),
    };
  } catch { return null; }
}

function fingerprintFromProxy(req, allowedProxyIPs) {
  const ip = remoteIp(req);
  if (!allowedProxyIPs || !allowedProxyIPs.includes(ip)) return null;
  const sha = req.headers['x-client-cert-sha256'];
  if (!sha) return null;
  return {
    sha256: String(sha).replace(/:/g, '').toLowerCase(),
    subject: String(req.headers['x-client-cert-subject'] || ''),
  };
}

function remoteIp(req) {
  if (req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  return null;
}

function createMtls({ trustedCerts = [], mode = 'native', allowedProxyIPs = [] } = {}) {
  function verify(req) {
    let info = null;
    if (mode === 'proxy') info = fingerprintFromProxy(req, allowedProxyIPs);
    else info = fingerprintFromNative(req);
    if (!info) return null;
    for (const trusted of trustedCerts) {
      const pinMatch = trusted.sha256_pin && trusted.sha256_pin.replace(/:/g, '').toLowerCase() === info.sha256;
      const subjMatch = trusted.subject_pattern && new RegExp(trusted.subject_pattern).test(info.subject);
      if (pinMatch || subjMatch) {
        return { signer: trusted.name || trusted.sha256_pin || 'mtls-client', sha256: info.sha256, fast_path: 'mtls' };
      }
    }
    return null;
  }
  return { verify };
}

module.exports = createMtls;
module.exports.createMtls = createMtls;
