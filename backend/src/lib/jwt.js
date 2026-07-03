const crypto = require('crypto');

function b64url(value) {
  const data = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.from(data).toString('base64url');
}

function signToken(payload, secret, ttlSeconds = 86400) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const segments = `${b64url(header)}.${b64url(body)}`;
  const sig = crypto.createHmac('sha256', secret).update(segments).digest('base64url');
  return `${segments}.${sig}`;
}

function verifyToken(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw Object.assign(new Error('Invalid token'), { status: 401 });
  }

  const [header, body, signature] = parts;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw Object.assign(new Error('Invalid token'), { status: 401 });
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw Object.assign(new Error('Token expired'), { status: 401 });
  }

  return payload;
}

module.exports = { signToken, verifyToken };
