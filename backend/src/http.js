import { config } from './config.js';
import { verifyJwt } from './crypto.js';
import { db } from './db.js';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, '请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, '请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (real) return String(real);
  return (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

export function getAuthUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const payload = verifyJwt(token, config.jwtSecret);
  if (!payload) return null;
  const user = db.prepare('SELECT id, username, email, role, status, quota_mb, created_at, last_login_at FROM users WHERE id = ?')
    .get(payload.uid);
  if (!user || user.status === 'disabled') return null;
  return user;
}

export function requireAuth(req) {
  const user = getAuthUser(req);
  if (!user) throw new HttpError(401, '登录状态已失效，请重新登录', 'UNAUTHORIZED');
  return user;
}

export function requireAdmin(req) {
  const user = requireAuth(req);
  if (user.role !== 'admin') throw new HttpError(403, '需要管理员权限', 'FORBIDDEN');
  return user;
}

export function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function ok(res, data = null, message = 'ok') {
  json(res, 200, { code: 0, message, data });
}

export function pageParams(url, defSize = 20, maxSize = 200) {
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const size = Math.min(maxSize, Math.max(1, Number(url.searchParams.get('pageSize') || defSize)));
  return { page, size, offset: (page - 1) * size };
}

export function fmtBytes(n) {
  n = Number(n) || 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 2 : 0)} ${units[i]}`;
}
