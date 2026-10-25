/**
 * 邮箱验证码模块
 *
 * 用于注册时的邮箱真实性校验：
 *   1. 用户输入邮箱 → 后端生成 6 位验证码并发送
 *   2. 用户回填验证码 → 后端校验（限制次数、有效期、一次性）
 *   3. 验证通过后签发 ticket，注册时校验 ticket，防止绕过
 *
 * 安全控制：发送冷却、单邮箱/单 IP 每日上限、错误次数上限、验证码用后即焚。
 */
import crypto from 'node:crypto';
import { db, getSettings, getSetting, getSettingNum, getSettingBool } from './db.js';
import { HttpError } from './http.js';
import * as mailer from './mailer.js';

function nowMs() { return Date.now(); }

function randomCode(len) {
  const n = Math.max(4, Math.min(10, Number(len) || 6));
  let s = '';
  const bytes = crypto.randomBytes(n);
  for (let i = 0; i < n; i++) s += String(bytes[i] % 10);
  return s;
}

export function isEmailEnabled() {
  return getSettingBool('register_email_verify') && mailer.mailConfigured();
}

/** 邮件服务是否可用（与开关无关） */
export function isMailReady() {
  return mailer.mailConfigured();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || ''));
}

function mask(email) {
  const [name, domain] = String(email).split('@');
  if (!domain) return email;
  const keep = Math.min(2, Math.floor(name.length / 2));
  return `${name.slice(0, keep)}${'*'.repeat(Math.max(1, name.length - keep))}@${domain}`;
}

/** 发送验证码 */
export async function sendCode(email, ip, scene = 'register') {
  const s = getSettings();
  email = String(email || '').trim().toLowerCase();
  if (!isValidEmail(email)) throw new HttpError(400, '请输入有效的邮箱地址');
  if (!mailer.mailConfigured()) throw new HttpError(400, '邮件服务未配置，无法发送验证码');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new HttpError(400, '该邮箱已被注册');

  const cooldown = getSettingNum('verify_code_cooldown') || 60;
  const last = db.prepare('SELECT * FROM email_codes WHERE email = ? AND scene = ? ORDER BY id DESC LIMIT 1').get(email, scene);
  if (last) {
    const ageSec = (nowMs() - new Date(last.created_at.replace(' ', 'T') + 'Z').getTime()) / 1000;
    if (ageSec < cooldown) {
      throw new HttpError(429, `发送过于频繁，请 ${Math.ceil(cooldown - ageSec)} 秒后再试`);
    }
  }

  const daily = getSettingNum('verify_code_daily_limit') || 5;
  const todayCnt = db.prepare(`SELECT COUNT(*) AS c FROM email_codes WHERE email = ? AND scene = ? AND created_at >= date('now')`).get(email, scene).c;
  if (todayCnt >= daily) throw new HttpError(429, '该邮箱今日发送次数已用尽，请明天再试');

  const ipLimit = getSettingNum('verify_code_ip_limit') || 20;
  const ipCnt = db.prepare(`SELECT COUNT(*) AS c FROM email_codes WHERE ip = ? AND created_at >= date('now')`).get(ip).c;
  if (ipCnt >= ipLimit) throw new HttpError(429, '当前网络发送次数过多，请稍后再试');

  const code = randomCode(getSettingNum('verify_code_len'));
  const ttl = getSettingNum('verify_code_ttl') || 10;
  db.prepare('INSERT INTO email_codes(email, code, scene, ip, expires_at) VALUES(?,?,?,?,?)')
    .run(email, code, scene, ip || '', nowMs() + ttl * 60000);

  // 使用可编辑模板发送
  const tplSubject = s.verify_template_subject || '【{{site}}】邮箱验证码 {{code}}';
  const tplBody = s.verify_template_body || `
    <p>你好！</p>
    <p>你正在注册 <b>{{site}}</b> 账号，本次的邮箱验证码为：</p>
    <div style="margin:18px 0;padding:14px;background:#f5f6f8;border-radius:8px;text-align:center;">
      <span style="font-size:28px;font-weight:700;letter-spacing:8px;color:{{color}};">{{code}}</span>
    </div>
    <p style="color:#8b919e;font-size:13px;">验证码 {{ttl}} 分钟内有效，请勿泄露给他人。若非本人操作请忽略本邮件。</p>`;
  const vars = { site: s.site_name, code, ttl, color: s.mail_tpl_theme_color || '#2450eb', email: mask(email), time: new Date().toLocaleString('zh-CN') };
  const subject = mailer.renderVars(tplSubject, vars);
  const html = mailer.buildMailHtml(mailer.renderVars(tplBody, vars), vars);

  try {
    await mailer.sendMail({ to: email, subject, html });
  } catch (e) {
    db.prepare('DELETE FROM email_codes WHERE email = ? AND code = ?').run(email, code);
    throw new HttpError(400, '邮件发送失败：' + e.message);
  }
  return { ok: true, masked: mask(email), ttl };
}

/** 校验验证码，返回一次性 ticket */
export function verifyCode(email, code, scene = 'register') {
  email = String(email || '').trim().toLowerCase();
  code = String(code || '').trim();
  const maxAttempts = getSettingNum('verify_code_max_attempts') || 5;
  const row = db.prepare('SELECT * FROM email_codes WHERE email = ? AND scene = ? AND used = 0 ORDER BY id DESC LIMIT 1').get(email, scene);
  if (!row) throw new HttpError(400, '请先获取邮箱验证码');
  if (row.expires_at < nowMs()) throw new HttpError(400, '验证码已过期，请重新获取');
  if (row.attempts >= maxAttempts) throw new HttpError(429, '错误次数过多，请重新获取验证码');
  if (row.code !== code) {
    db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    const left = maxAttempts - row.attempts - 1;
    throw new HttpError(400, left > 0 ? `验证码不正确，还可尝试 ${left} 次` : '验证码错误次数过多，请重新获取');
  }
  db.prepare('UPDATE email_codes SET used = 1 WHERE id = ?').run(row.id);
  // 签发 ticket：邮箱 + 时间 + 签名
  const ticket = makeTicket(email);
  return { ok: true, ticket };
}

function secret() {
  return getSetting('jwt_secret_verify') || 'tgproxy-email-verify';
}

export function makeTicket(email) {
  const exp = nowMs() + 30 * 60 * 1000;
  const payload = `${email}|${exp}`;
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex').slice(0, 32);
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

export function checkTicket(ticket, email) {
  if (!ticket) return false;
  try {
    const raw = Buffer.from(String(ticket), 'base64url').toString('utf8');
    const [em, exp, sig] = raw.split('|');
    if (!em || !exp || !sig) return false;
    if (em.toLowerCase() !== String(email || '').trim().toLowerCase()) return false;
    if (Number(exp) < nowMs()) return false;
    const expect = crypto.createHmac('sha256', secret()).update(`${em}|${exp}`).digest('hex').slice(0, 32);
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
  } catch {
    return false;
  }
}

/** 注册前的强校验 */
export function requireVerified(email, ticket) {
  if (!isEmailEnabled()) return;
  if (!isValidEmail(email)) throw new HttpError(400, '请填写有效的邮箱地址');
  if (!ticket) throw new HttpError(400, '请先完成邮箱验证');
  if (!checkTicket(ticket, email)) throw new HttpError(400, '邮箱验证已失效，请重新验证');
}
