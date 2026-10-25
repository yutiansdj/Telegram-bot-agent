/**
 * 人机验证（Captcha）
 *
 * 支持四种自建验证（不依赖第三方、离线可用）：
 *   math  — 算术题（服务端生成，前端渲染）
 *   slider— 拖动滑块到指定位置
 *   image — 干扰线 + 噪点文字验证码（服务端生成 SVG/PNG 数据）
 * 以及三种第三方验证（需填写密钥）：
 *   hcaptcha / turnstile / recaptcha
 *
 * 所有挑战均在服务端生成并校验，一次性使用、带过期时间。
 */
import crypto from 'node:crypto';
import { db, getSettings, getSetting } from './db.js';
import { HttpError } from './http.js';

const TTL = 180 * 1000; // 挑战有效期 3 分钟

// ---------------------------------------------------------------
// 验证码图片生成（纯 SVG，无需第三方库）
// ---------------------------------------------------------------
const FONT_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function randChars(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += FONT_CHARS[crypto.randomInt(0, FONT_CHARS.length)];
  return s;
}

function buildImageSvg(code, size = 1) {
  const W = 132, H = 44;
  const colors = ['#2450eb', '#0f9d58', '#7c3aed', '#d97706', '#e11d48', '#0e7490'];
  const pick = () => colors[crypto.randomInt(0, colors.length)];
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  out += `<rect width="${W}" height="${H}" fill="#f4f6fa"/>`;
  // 干扰线
  for (let i = 0; i < 4 + size; i++) {
    out += `<path d="M${crypto.randomInt(0, 30)} ${crypto.randomInt(0, H)} Q ${crypto.randomInt(20, 90)} ${crypto.randomInt(0, H)}, ${crypto.randomInt(80, W)} ${crypto.randomInt(0, H)}" stroke="${pick()}" stroke-width="1" fill="none" opacity="0.35"/>`;
  }
  // 噪点
  for (let i = 0; i < 30 + size * 8; i++) {
    out += `<circle cx="${crypto.randomInt(0, W)}" cy="${crypto.randomInt(0, H)}" r="1" fill="${pick()}" opacity="0.45"/>`;
  }
  // 文字
  const step = (W - 20) / code.length;
  for (let i = 0; i < code.length; i++) {
    const x = 12 + i * step + crypto.randomInt(0, 4);
    const y = 30 + crypto.randomInt(-5, 6);
    const rot = crypto.randomInt(-18, 19);
    const fs = 22 + crypto.randomInt(0, 5);
    out += `<text x="${x}" y="${y}" font-family="Georgia,'Times New Roman',serif" font-size="${fs}" font-weight="700" fill="${pick()}" transform="rotate(${rot} ${x} ${y})">${code[i]}</text>`;
  }
  out += '</svg>';
  return `data:image/svg+xml;base64,${Buffer.from(out).toString('base64')}`;
}

// ---------------------------------------------------------------
// 挑战生成
// ---------------------------------------------------------------
export function captchaConfig() {
  const s = getSettings();
  return {
    enabled: s.captcha_enabled === '1',
    provider: s.captcha_provider || 'math',
    difficulty: Number(s.captcha_difficulty) || 2,
    points: {
      login: s.captcha_login === '1',
      register: s.captcha_register === '1',
      ticket: s.captcha_ticket === '1',
    },
    siteKeys: {
      hcaptcha: s.captcha_hcaptcha_site || '',
      turnstile: s.captcha_turnstile_site || '',
      recaptcha: s.captcha_recaptcha_site || '',
    },
  };
}

/** 该场景是否需要验证码 */
export function needCaptcha(scene) {
  const cfg = captchaConfig();
  if (!cfg.enabled) return false;
  return !!cfg.points[scene];
}

function store(kind, answer, meta, req) {
  const id = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO captcha_challenges(id, kind, answer, meta, ip, expires_at) VALUES(?,?,?,?,?,?)')
    .run(id, kind, String(answer).toLowerCase(), JSON.stringify(meta || {}), req?.ip || null, Date.now() + TTL);
  // 顺手清理过期
  db.prepare('DELETE FROM captcha_challenges WHERE expires_at < ?').run(Date.now());
  return id;
}

export function createChallenge(req) {
  const cfg = captchaConfig();
  const diff = cfg.difficulty;
  const id = crypto.randomBytes(16).toString('hex');

  if (cfg.provider === 'math') {
    const max = diff === 1 ? 10 : diff === 2 ? 20 : 50;
    const a = crypto.randomInt(1, max), b = crypto.randomInt(1, max);
    const ops = diff === 1 ? ['+'] : ['+', '-', '×'];
    const op = ops[crypto.randomInt(0, ops.length)];
    let ans;
    if (op === '+') ans = a + b;
    else if (op === '-') ans = Math.abs(a - b);
    else ans = a * b;
    const text = op === '-' ? `${Math.max(a, b)} - ${Math.min(a, b)}` : `${a} ${op} ${b}`;
    const cid = store('math', ans, { text }, req);
    return { id: cid, kind: 'math', question: `${text} = ?`, expires_in: TTL / 1000 };
  }

  if (cfg.provider === 'slider') {
    const width = 280;
    let target;
    let gaps;
    if (diff === 1) { target = crypto.randomInt(150, 210); gaps = 46; }
    else if (diff === 2) { target = crypto.randomInt(120, 240); gaps = 36; }
    else { target = crypto.randomInt(100, 250); gaps = 26; }
    const cid = store('slider', target, { target, width, gaps, checkWidth: gaps + 12 }, req);
    return { id: cid, kind: 'slider', width, target, gaps, expires_in: TTL / 1000 };
  }

  if (cfg.provider === 'image') {
    const len = diff === 1 ? 4 : diff === 2 ? 5 : 6;
    const code = randChars(len);
    const cid = store('image', code, {}, req);
    return { id: cid, kind: 'image', image: buildImageSvg(code, diff), length: len, expires_in: TTL / 1000 };
  }

  // 第三方验证：前端负责渲染，服务端负责校验
  void id;
  return { kind: cfg.provider, siteKey: cfg.siteKeys[cfg.provider] || '', expires_in: TTL / 1000 };
}

// ---------------------------------------------------------------
// 校验
// ---------------------------------------------------------------
async function verifyThirdParty(provider, token) {
  const s = getSettings();
  const map = {
    hcaptcha: { url: 'https://hcaptcha.com/siteverify', secret: s.captcha_hcaptcha_secret, field: 'response' },
    turnstile: { url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify', secret: s.captcha_turnstile_secret, field: 'response' },
    recaptcha: { url: 'https://www.google.com/recaptcha/api/siteverify', secret: s.captcha_recaptcha_secret, field: 'response' },
  };
  const cfg = map[provider];
  if (!cfg || !cfg.secret) throw new HttpError(400, '未配置该验证服务的密钥');
  if (!token) throw new HttpError(400, '请完成人机验证');
  const body = new URLSearchParams({ secret: cfg.secret, [cfg.field]: token });
  const res = await fetch(cfg.url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw new HttpError(400, '人机验证未通过，请重试');
  return true;
}

/**
 * 校验验证码
 * @param {object} payload { id, answer } / { id, sliderX } / { token }
 */
export async function verifyCaptcha(payload, scene, req) {
  if (!needCaptcha(scene)) return true;
  const cfg = captchaConfig();
  if (['hcaptcha', 'turnstile', 'recaptcha'].includes(cfg.provider)) {
    return verifyThirdParty(cfg.provider, payload?.token);
  }
  if (!payload || !payload.id) throw new HttpError(400, '缺少人机验证信息');

  const row = db.prepare('SELECT * FROM captcha_challenges WHERE id = ?').get(String(payload.id));
  if (!row) throw new HttpError(400, '验证已失效，请刷新页面重试');
  if (row.used) throw new HttpError(400, '验证码已使用，请重新获取');
  if (row.expires_at < Date.now()) throw new HttpError(400, '验证码已过期，请重新获取');
  db.prepare('UPDATE captcha_challenges SET used = 1 WHERE id = ?').run(row.id);

  if (row.kind === 'math') {
    const ans = String(payload.answer ?? '').trim();
    if (ans !== row.answer) throw new HttpError(400, '计算结果不正确');
    return true;
  }
  if (row.kind === 'slider') {
    const target = Number(row.answer);
    const x = Number(payload.sliderX);
    const meta = JSON.parse(row.meta || '{}');
    const tol = meta.gaps >= 46 ? 14 : meta.gaps >= 36 ? 10 : 7;
    if (!Number.isFinite(x) || Math.abs(x - target) > tol) throw new HttpError(400, '滑块位置不正确，请重试');
    return true;
  }
  if (row.kind === 'image') {
    const ans = String(payload.answer ?? '').trim().toLowerCase();
    if (ans !== row.answer) throw new HttpError(400, '验证码错误');
    return true;
  }
  throw new HttpError(400, '未知的验证码类型');
}

export function isSelfHosted() {
  return ['math', 'slider', 'image'].includes(getSetting('captcha_provider') || 'math');
}
