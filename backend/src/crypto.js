import crypto from 'node:crypto';
import argon2 from 'argon2';

const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export async function hashPassword(pwd) {
  return argon2.hash(pwd, ARGON_OPTS);
}

export async function verifyPassword(hash, pwd) {
  try { return await argon2.verify(hash, pwd); } catch { return false; }
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function randInt(min, max) {
  return crypto.randomInt(min, max + 1);
}

/**
 * 生成代理私钥：32 位 hex = 16 字节随机密钥（标准 MTProxy secret 格式）
 * 客户端三种用法：明文 hex / dd+hex / ee+hex+hex(域名)
 */
export function genSecret() {
  return crypto.randomBytes(16).toString('hex');
}

export function secretToUrl(secret) {
  return '7' + Buffer.from(hexToBytes(secret)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hexToBytes(hex) {
  const out = Buffer.alloc(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// ---------- 轻量 JWT (HS256) ----------
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function signJwt(payload, secret, ttlSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const p1 = b64url(JSON.stringify(header));
  const p2 = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(`${p1}.${p2}`).digest();
  return `${p1}.${p2}.${b64url(sig)}`;
}

export function verifyJwt(token, secret) {
  if (typeof token !== 'string' || token.split('.').length !== 3) return null;
  const [p1, p2, p3] = token.split('.');
  const expect = b64url(crypto.createHmac('sha256', secret).update(`${p1}.${p2}`).digest());
  const a = Buffer.from(expect);
  const b = Buffer.from(p3);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(unb64url(p2).toString('utf8'));
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch { return null; }
}
