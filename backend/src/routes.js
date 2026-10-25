import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, getSetting, getSettingNum, getSettingBool, getSettings, setSetting, audit, defaults } from './db.js';
import { HttpError, readBody, clientIp, requireAuth, requireAdmin, getAuthUser, ok, pageParams } from './http.js';
import { hashPassword, verifyPassword, signJwt, randomToken, genSecret, secretToUrl, randInt } from './crypto.js';
import * as mtg from './mtg.js';
import * as billing from './billing.js';
import { syncGate } from './collector.js';
import * as mailer from './mailer.js';
import * as captcha from './captcha.js';
import * as emailVerify from './emailverify.js';

const publicUser = (u) => ({
  id: u.id, username: u.username, email: u.email, role: u.role, status: u.status,
  quota_mb: u.quota_mb, created_at: u.created_at, last_login_at: u.last_login_at,
});

function randomSecret() {
  // 标准 16 字节私钥（32 位 hex）；链接的三种呈现形式由 mtg.genClientLinks 负责
  return genSecret();
}

function nowIso() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }

function accRow(a) {
  const node = db.prepare('SELECT name, host FROM nodes WHERE id = ?').get(a.node_id);
  const state = mtg.accountState(a);
  const usedMb = a.used_bytes / 1024 / 1024;
  return {
    id: a.id, user_id: a.user_id, node_id: a.node_id, node_name: node?.name || '-',
    name: a.name, port: a.port, protocol: a.protocol, status: a.status, state,
    quota_mb: a.quota_mb, used_bytes: a.used_bytes, used_mb: Number(usedMb.toFixed(2)),
    usage_pct: a.quota_mb > 0 ? Math.min(100, Number(((usedMb / a.quota_mb) * 100).toFixed(1))) : 0,
    last_used_at: a.last_used_at, expires_at: a.expires_at, remark: a.remark,
    created_at: a.created_at, links: mtg.genClientLinks(a),
  };
}

function userQuotaSum(uid) {
  return db.prepare('SELECT COALESCE(SUM(quota_mb),0) AS q, COUNT(*) AS c FROM accounts WHERE user_id = ?').get(uid);
}

// ============================================================
// 认证
// ============================================================
export async function login(ctx) {
  const { req, res } = ctx;
  const body = await readBody(req);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const ip = clientIp(req);
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  if (!username || !password) throw new HttpError(400, '请输入用户名和密码');
  await captcha.verifyCaptcha(body.captcha, 'login', { ip });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const log = (okFlag, uid, msg) => db.prepare('INSERT INTO login_logs(user_id, username, success, ip, ua, message) VALUES(?,?,?,?,?,?)')
    .run(uid ?? null, username, okFlag ? 1 : 0, ip, ua, msg);
  if (!user) {
    log(false, null, '用户不存在');
    throw new HttpError(400, '用户名或密码错误');
  }
  if (user.status === 'disabled') {
    log(false, user.id, '账号已禁用');
    throw new HttpError(403, '该账号已被禁用，请联系管理员');
  }
  const pass = await verifyPassword(user.password_hash, password);
  if (!pass) {
    log(false, user.id, '密码错误');
    throw new HttpError(400, '用户名或密码错误');
  }
  db.prepare('UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?').run(nowIso(), ip, user.id);
  log(true, user.id, '登录成功');
  const token = signJwt({ uid: user.id, role: user.role }, config.jwtSecret, config.tokenTTL);
  return ok(res, { token, user: publicUser({ ...user, last_login_at: nowIso() }) }, '登录成功');
}

export async function register(ctx) {
  const { req, res } = ctx;
  if (!getSettingBool('register_enabled')) throw new HttpError(403, '当前已关闭注册，请联系管理员开通账号');
  const body = await readBody(req);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const email = String(body.email || '').trim();
  await captcha.verifyCaptcha(body.captcha, 'register', { ip: clientIp(req) });
  if (getSettingBool('register_need_email') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, '请填写有效的邮箱地址');
  // 邮箱验证（强制）
  if (emailVerify.isEmailEnabled()) {
    emailVerify.requireVerified(email, body.emailTicket);
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new HttpError(400, '该邮箱已被注册');
  }
  const pwdMin = getSettingNum('password_min_len') || 6;
  void pwdMin;
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new HttpError(400, '用户名需为 3-32 位字母、数字、下划线');
  const minLen = Math.max(4, getSettingNum('password_min_len') || 6);
  if (password.length < minLen) throw new HttpError(400, `密码至少 ${minLen} 位`);
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) throw new HttpError(400, '用户名已存在');
  const ipLimit = getSettingNum('register_ip_limit');
  if (ipLimit > 0) {
    const ip = clientIp(req);
    const cnt = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE id IN
      (SELECT user_id FROM login_logs WHERE ip = ? AND success = 1)`).get(ip).c;
    const recent = db.prepare("SELECT COUNT(*) AS c FROM login_logs WHERE ip = ? AND success = 1 AND created_at >= datetime('now','-1 day')").get(ip).c;
    if (cnt >= ipLimit && recent >= ipLimit) throw new HttpError(400, '该 IP 注册账号数已达上限');
  }
  const quota = getSettingNum('register_quota_mb');
  const hash = await hashPassword(password);
  const info = db.prepare('INSERT INTO users(username, password_hash, email, role, quota_mb) VALUES(?,?,?,?,?)')
    .run(username, hash, email || null, 'user', quota);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  audit({ id: user.id, username }, '注册', `user:${user.id}`, '新用户注册', clientIp(req));
  mailer.notifyRegister(user);
  const token = signJwt({ uid: user.id, role: 'user' }, config.jwtSecret, config.tokenTTL);
  return ok(res, { token, user: publicUser(user) }, '注册成功');
}

export async function me(ctx) {
  const user = requireAuth(ctx.req);
  const q = userQuotaSum(user.id);
  const accCount = db.prepare('SELECT COUNT(*) AS c FROM accounts WHERE user_id = ?').get(user.id).c;
  return ok(ctx.res, { user: publicUser(user), stats: { accounts: accCount, quota_mb: user.quota_mb } });
}

export async function changePassword(ctx) {
  const user = requireAuth(ctx.req);
  const body = await readBody(ctx.req);
  const oldPwd = String(body.oldPassword || '');
  const newPwd = String(body.newPassword || '');
  if (newPwd.length < 6) throw new HttpError(400, '新密码至少 6 位');
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
  if (!(await verifyPassword(row.password_hash, oldPwd))) throw new HttpError(400, '原密码不正确');
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(await hashPassword(newPwd), nowIso(), user.id);
  audit(user, '修改密码', `user:${user.id}`, '', clientIp(ctx.req));
  return ok(ctx.res, null, '密码已更新');
}

export async function updateProfile(ctx) {
  const user = requireAuth(ctx.req);
  const body = await readBody(ctx.req);
  const email = String(body.email || '').trim().slice(0, 120);
  db.prepare('UPDATE users SET email = ?, updated_at = ? WHERE id = ?').run(email, nowIso(), user.id);
  return ok(ctx.res, null, '资料已保存');
}

// ============================================================
// 公开信息
// ============================================================
export async function publicInfo(ctx) {
  const s = getSettings();
  const nodeCount = db.prepare('SELECT COUNT(*) AS c FROM nodes').get().c;
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const accCount = db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
  return ok(ctx.res, {
    site_name: s.site_name,
    site_desc: s.site_desc,
    site_keywords: s.site_keywords,
    site_logo: s.site_logo,
    site_favicon: s.site_favicon,
    site_footer: s.site_footer,
    announcement: s.announcement,
    ui_theme: s.ui_theme,
    ui_primary_light: s.ui_primary_light,
    ui_primary_dark: s.ui_primary_dark,
    ui_radius: s.ui_radius,
    ui_sidebar_style: s.ui_sidebar_style,
    ui_density: s.ui_density,
    ui_login_style: s.ui_login_style,
    ui_login_bg: s.ui_login_bg,
    ui_font_size: s.ui_font_size,
    maintenance_mode: s.maintenance_mode,
    smtp_enabled: s.smtp_enabled,
    register_enabled: s.register_enabled === '1',
    ticket_enabled: s.ticket_enabled === '1',
    support_contact: s.support_contact,
    icp: s.icp,
    show_public_status: s.show_public_status === '1',
    stats: s.show_public_status === '1' ? { nodes: nodeCount, users: userCount, accounts: accCount } : null,
  });
}

// ============================================================
// 用户侧：代理账号
// ============================================================
export async function listMyAccounts(ctx) {
  const user = requireAuth(ctx.req);
  const rows = db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY id DESC').all(user.id);
  return ok(ctx.res, { list: rows.map(accRow), quota_mb: user.quota_mb });
}

export async function createMyAccount(ctx) {
  const user = requireAuth(ctx.req);
  const body = await readBody(ctx.req);
  const nodeId = Number(body.node_id) || db.prepare('SELECT id FROM nodes ORDER BY sort, id LIMIT 1').get()?.id;
  if (!nodeId) throw new HttpError(400, '暂无可用节点');
  const node = db.prepare("SELECT * FROM nodes WHERE id = ? AND status = 'online'").get(nodeId);
  if (!node) throw new HttpError(400, '节点不存在或已下线');
  const max = getSettingNum('max_accounts_per_user');
  const cnt = db.prepare('SELECT COUNT(*) AS c FROM accounts WHERE user_id = ?').get(user.id).c;
  if (cnt >= max) throw new HttpError(400, `每个账号最多创建 ${max} 个代理`);
  const q = userQuotaSum(user.id);
  const unlimited = user.id ? user.quota_mb === 0 : false; // 额度为 0 表示不限制（管理员/特殊账户）
  const remain = user.quota_mb - q.q;
  if (!unlimited && remain <= 0) throw new HttpError(400, '剩余流量额度不足，请先提交流量申请');
  const defQuota = getSettingNum('default_quota_mb');
  const quota = unlimited && defQuota === 0 ? 0 : Math.max(1, Math.min(defQuota > 0 ? defQuota : remain, unlimited ? defQuota : remain));
  const name = String(body.name || '').trim().slice(0, 60) || `代理-${cnt + 1}`;
  const port = mtg.findFreePort(nodeId);
  const secret = randomSecret();
  const info = db.prepare(`INSERT INTO accounts(user_id, node_id, name, secret, port, quota_mb, status)
                           VALUES(?,?,?,?,?,?, 'active')`).run(user.id, nodeId, name, secret, port, quota);
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid);
  await mtg.startAccount(acc);
  audit(user, '创建代理', `account:${acc.id}`, `端口 ${port}`, clientIp(ctx.req));
  return ok(ctx.res, accRow(acc), '代理创建成功，已自动启动');
}

function ownAccount(user, id) {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(id));
  if (!acc) throw new HttpError(404, '代理不存在');
  if (acc.user_id !== user.id) throw new HttpError(403, '无权操作该代理');
  return acc;
}

export async function updateMyAccount(ctx) {
  const user = requireAuth(ctx.req);
  const acc = ownAccount(user, ctx.params.id);
  const body = await readBody(ctx.req);
  const name = body.name !== undefined ? String(body.name).trim().slice(0, 60) : acc.name;
  const remark = body.remark !== undefined ? String(body.remark).slice(0, 200) : acc.remark;
  db.prepare('UPDATE accounts SET name = ?, remark = ?, updated_at = ? WHERE id = ?').run(name || acc.name, remark, nowIso(), acc.id);
  audit(user, '修改代理', `account:${acc.id}`, name, clientIp(ctx.req));
  return ok(ctx.res, accRow(db.prepare('SELECT * FROM accounts WHERE id = ?').get(acc.id)), '已保存');
}

async function setAccountStatus(actor, acc) {
  const status = acc.status === 'active' ? 'disabled' : 'active';
  db.prepare('UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), acc.id);
  const fresh = db.prepare('SELECT * FROM accounts WHERE id = ?').get(acc.id);
  await mtg.reloadAccount(fresh);
  await syncGate(fresh, status === 'active' && mtg.isAccountEnabled(fresh)).catch(() => {});
  audit(actor, status === 'active' ? '启用代理' : '停用代理', `account:${acc.id}`, '', '');
  return { fresh, status };
}

export async function toggleMyAccount(ctx) {
  const user = requireAuth(ctx.req);
  const acc = ownAccount(user, ctx.params.id);
  const { fresh, status } = await setAccountStatus(user, acc);
  return ok(ctx.res, fresh ? accRow(fresh) : null, status === 'active' ? '已启用' : '已停用');
}

export async function rotateSecret(ctx) {
  const user = requireAuth(ctx.req);
  const acc = ownAccount(user, ctx.params.id);
  db.prepare('UPDATE accounts SET secret = ?, updated_at = ? WHERE id = ?').run(randomSecret(), nowIso(), acc.id);
  const fresh = db.prepare('SELECT * FROM accounts WHERE id = ?').get(acc.id);
  await mtg.reloadAccount(fresh);
  audit(user, '重置密钥', `account:${acc.id}`, '', clientIp(ctx.req));
  return ok(ctx.res, accRow(fresh), '密钥已重置，请重新导入代理链接');
}

export async function deleteMyAccount(ctx) {
  const user = requireAuth(ctx.req);
  const acc = ownAccount(user, ctx.params.id);
  mtg.stopAccount(acc.id);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(acc.id);
  await billing.removeRules(acc).catch(() => {});
  try { fs.rmSync(path.join(config.instanceDir, String(acc.id)), { recursive: true, force: true }); } catch { /* ignore */ }
  audit(user, '删除代理', `account:${acc.id}`, `端口 ${acc.port}`, clientIp(ctx.req));
  return ok(ctx.res, null, '代理已删除');
}

export async function testMyAccount(ctx) {
  const user = requireAuth(ctx.req);
  const acc = ownAccount(user, ctx.params.id);
  const r = await mtg.loadBalanceCheck(acc);
  return ok(ctx.res, r);
}

// ============================================================
// 用户侧：流量申请
// ============================================================
export async function listMyTickets(ctx) {
  const user = requireAuth(ctx.req);
  const { page, size, offset } = pageParams(ctx.url);
  const total = db.prepare('SELECT COUNT(*) AS c FROM tickets WHERE user_id = ?').get(user.id).c;
  const rows = db.prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?').all(user.id, size, offset);
  return ok(ctx.res, { list: rows, total, page, pageSize: size });
}

export async function createTicket(ctx) {
  const user = requireAuth(ctx.req);
  if (!getSettingBool('ticket_enabled')) throw new HttpError(403, '当前暂未开放流量申请');
  const body = await readBody(ctx.req);
  const cap = getSettingNum('ticket_max_amount_mb') || 1048576;
  await captcha.verifyCaptcha(body.captcha, 'ticket', { ip: clientIp(ctx.req) });
  const amount = Math.max(1, Math.min(cap, Number(body.amount_mb) || 0));
  const reason = String(body.reason || '').slice(0, 500);
  const nodeId = body.node_id ? Number(body.node_id) : null;
  const accountId = body.account_id ? Number(body.account_id) : null;
  if (accountId) ownAccount(user, accountId);
  const nodeName = nodeId ? db.prepare('SELECT name FROM nodes WHERE id = ?').get(nodeId)?.name : null;
  const maxPending = getSettingNum('ticket_max_pending') || 3;
  const pending = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE user_id = ? AND status = 'pending'").get(user.id).c;
  if (pending >= maxPending) throw new HttpError(400, `你有 ${maxPending} 个待审核的申请，请等待处理`);
  const info = db.prepare(`INSERT INTO tickets(user_id, node_id, account_id, node_name, amount_mb, reason)
                           VALUES(?,?,?,?,?,?)`).run(user.id, nodeId, accountId, nodeName, amount, reason);
  audit(user, '提交流量申请', `ticket:${info.lastInsertRowid}`, `${amount} MB`, clientIp(ctx.req));
  if (getSettingBool('ticket_auto_approve')) {
    if (accountId) {
      db.prepare('UPDATE accounts SET quota_mb = quota_mb + ? WHERE id = ?').run(amount, accountId);
      const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
      if (a) await mtg.reloadAccount(a);
    } else {
      db.prepare('UPDATE users SET quota_mb = quota_mb + ? WHERE id = ?').run(amount, user.id);
    }
    db.prepare("UPDATE tickets SET status='approved', admin_note='系统自动审核通过', reviewed_at=? WHERE id=?").run(nowIso(), info.lastInsertRowid);
    return ok(ctx.res, { id: info.lastInsertRowid, auto: true }, '已自动审核通过，额度已到账');
  }
  return ok(ctx.res, { id: info.lastInsertRowid }, '申请已提交，等待管理员审核');
}

// ============================================================
// 用户侧：统计 / 节点
// ============================================================
export async function myDashboard(ctx) {
  const user = requireAuth(ctx.req);
  const accs = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(user.id);
  const used = accs.reduce((s, a) => s + a.used_bytes, 0);
  const days = 14;
  const start = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT d.day, SUM(d.up_bytes) AS up, SUM(d.down_bytes) AS down
                           FROM traffic_daily d JOIN accounts a ON a.id = d.account_id
                           WHERE a.user_id = ? AND d.day >= ? GROUP BY d.day ORDER BY d.day`).all(user.id, start);
  const map = new Map(rows.map((r) => [r.day, r]));
  const series = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10);
    const r = map.get(d);
    series.push({ date: d, up: r?.up || 0, down: r?.down || 0, total: (r?.up || 0) + (r?.down || 0) });
  }
  const today = series[series.length - 1]?.total || 0;
  const runningCount = accs.filter((a) => mtg.accountState(a) === 'running').length;
  return ok(ctx.res, {
    quota_mb: user.quota_mb, used_bytes: used,
    remaining_mb: Math.max(0, user.quota_mb - used / 1024 / 1024),
    accounts: accs.length, running: runningCount, today_bytes: today,
    series, recent: accs.slice(0, 5).map(accRow),
    pending_tickets: db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE user_id = ? AND status = 'pending'").get(user.id).c,
  });
}

export async function myTraffic(ctx) {
  const user = requireAuth(ctx.req);
  const days = Math.min(90, Math.max(1, Number(ctx.url.searchParams.get('days') || 7)));
  const byAccount = db.prepare(`SELECT a.id, a.name, a.port, a.used_bytes, a.quota_mb
                                 FROM accounts a WHERE a.user_id = ? ORDER BY a.used_bytes DESC`).all(user.id);
  const start = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT d.account_id, d.day, d.up_bytes, d.down_bytes FROM traffic_daily d
                           JOIN accounts a ON a.id = d.account_id
                           WHERE a.user_id = ? AND d.day >= ?`).all(user.id, start);
  const dates = [];
  for (let i = 0; i < days; i++) dates.push(new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10));
  const series = dates.map((d) => {
    let up = 0, down = 0;
    for (const r of rows) if (r.day === d) { up += r.up_bytes; down += r.down_bytes; }
    return { date: d, up, down, total: up + down };
  });
  return ok(ctx.res, { series, byAccount });
}

export async function listNodes(ctx) {
  const user = getAuthUser(ctx.req);
  const rows = db.prepare('SELECT * FROM nodes ORDER BY sort, id').all();
  const list = [];
  for (const n of rows) {
    if (!user || user.role !== 'admin') {
      if (n.status !== 'online') continue;
      list.push({ id: n.id, name: n.name, status: n.status, ip: mtg.resolvePublicIp(n), ip_version: n.ip_version, note: n.note });
    } else {
      list.push({ ...n, ip: mtg.resolvePublicIp(n) });
    }
  }
  return ok(ctx.res, { list });
}

// ============================================================
// 管理端：用户
// ============================================================
export async function adminListUsers(ctx) {
  requireAdmin(ctx.req);
  const { page, size, offset } = pageParams(ctx.url);
  const q = String(ctx.url.searchParams.get('q') || '').trim();
  const where = q ? "WHERE u.username LIKE ? OR u.email LIKE ?" : '';
  const args = q ? [`%${q}%`, `%${q}%`] : [];
  const total = db.prepare(`SELECT COUNT(*) AS c FROM users u ${where}`).get(...args).c;
  const rows = db.prepare(`SELECT u.*,
      (SELECT COUNT(*) FROM accounts a WHERE a.user_id = u.id) AS account_count,
      (SELECT COALESCE(SUM(a.used_bytes),0) FROM accounts a WHERE a.user_id = u.id) AS used_bytes
    FROM users u ${where} ORDER BY u.id DESC LIMIT ? OFFSET ?`).all(...args, size, offset);
  return ok(ctx.res, { list: rows.map((u) => ({ ...publicUser(u), account_count: u.account_count, used_bytes: u.used_bytes })), total, page, pageSize: size });
}

export async function adminCreateUser(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new HttpError(400, '用户名需为 3-32 位字母、数字、下划线');
  const minLen = Math.max(4, getSettingNum('password_min_len') || 6);
  if (password.length < minLen) throw new HttpError(400, `密码至少 ${minLen} 位`);
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) throw new HttpError(400, '用户名已存在');
  const ipLimit = getSettingNum('register_ip_limit');
  if (ipLimit > 0) {
    const ip = clientIp(req);
    const cnt = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE id IN
      (SELECT user_id FROM login_logs WHERE ip = ? AND success = 1)`).get(ip).c;
    const recent = db.prepare("SELECT COUNT(*) AS c FROM login_logs WHERE ip = ? AND success = 1 AND created_at >= datetime('now','-1 day')").get(ip).c;
    if (cnt >= ipLimit && recent >= ipLimit) throw new HttpError(400, '该 IP 注册账号数已达上限');
  }
  const quota = Number(body.quota_mb) || getSettingNum('default_quota_mb');
  const info = db.prepare('INSERT INTO users(username, password_hash, email, role, status, quota_mb, note) VALUES(?,?,?,?,?,?,?)')
    .run(username, await hashPassword(password), body.email || null, body.role === 'admin' ? 'admin' : 'user', 'active', quota, String(body.note || ''));
  audit(admin, '创建用户', `user:${info.lastInsertRowid}`, username, clientIp(ctx.req));
  return ok(ctx.res, { id: info.lastInsertRowid }, '用户已创建');
}

export async function adminUpdateUser(ctx) {
  const admin = requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw new HttpError(404, '用户不存在');
  const body = await readBody(ctx.req);
  const fields = [];
  const args = [];
  if (body.email !== undefined) { fields.push('email = ?'); args.push(String(body.email).slice(0, 120)); }
  if (body.quota_mb !== undefined) { fields.push('quota_mb = ?'); args.push(Math.max(0, Number(body.quota_mb) || 0)); }
  if (body.status !== undefined) {
    const st = body.status === 'disabled' ? 'disabled' : 'active';
    fields.push('status = ?'); args.push(st);
    if (st === 'disabled' && u.id === admin.id) throw new HttpError(400, '不能禁用自己');
  }
  if (body.note !== undefined) { fields.push('note = ?'); args.push(String(body.note).slice(0, 200)); }
  if (body.role !== undefined) {
    if (u.id === admin.id && body.role !== 'admin') throw new HttpError(400, '不能取消自己的管理员身份');
    fields.push('role = ?'); args.push(body.role === 'admin' ? 'admin' : 'user');
  }
  if (body.password) {
    if (String(body.password).length < 6) throw new HttpError(400, '密码至少 6 位');
    fields.push('password_hash = ?'); args.push(await hashPassword(String(body.password)));
  }
  if (!fields.length) return ok(ctx.res, null, '无变动');
  fields.push('updated_at = ?'); args.push(nowIso());
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...args, id);
  audit(admin, '修改用户', `user:${id}`, Object.keys(body).join(','), clientIp(ctx.req));
  return ok(ctx.res, null, '已保存');
}

export async function adminDeleteUser(ctx) {
  const admin = requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  if (id === admin.id) throw new HttpError(400, '不能删除自己');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw new HttpError(404, '用户不存在');
  for (const a of db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(id)) {
    mtg.stopAccount(a.id);
    await billing.removeRules(a).catch(() => {});
    try { fs.rmSync(path.join(config.instanceDir, String(a.id)), { recursive: true, force: true }); } catch { /* ignore */ }
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  audit(admin, '删除用户', `user:${id}`, u.username, clientIp(ctx.req));
  return ok(ctx.res, null, '用户已删除');
}

/** 管理员为用户「分配流量」：直接增加总额度 */
export async function adminGrantQuota(ctx) {
  const admin = requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const body = await readBody(ctx.req);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw new HttpError(404, '用户不存在');
  const mb = Number(body.mb);
  if (!Number.isFinite(mb) || mb === 0) throw new HttpError(400, '请填写有效流量（MB，可为负数扣减）');
  const next = Math.max(0, u.quota_mb + mb);
  db.prepare('UPDATE users SET quota_mb = ?, updated_at = ? WHERE id = ?').run(next, nowIso(), id);
  audit(admin, '分配流量', `user:${id}`, `${mb > 0 ? '+' : ''}${mb} MB → 总额度 ${next} MB`, clientIp(ctx.req));
  return ok(ctx.res, { quota_mb: next }, `已${mb > 0 ? '分配' : '扣减'} ${Math.abs(mb)} MB`);
}

// ============================================================
// 管理端：代理账号
// ============================================================
export async function adminListAccounts(ctx) {
  requireAdmin(ctx.req);
  const { page, size, offset } = pageParams(ctx.url, 20);
  const q = String(ctx.url.searchParams.get('q') || '').trim();
  const status = ctx.url.searchParams.get('status') || '';
  const nodeId = Number(ctx.url.searchParams.get('node_id') || 0);
  const cond = [];
  const args = [];
  if (q) { cond.push('(a.name LIKE ? OR u.username LIKE ? OR CAST(a.port AS TEXT) LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (status === 'running' || status === 'active') cond.push("a.status = 'active'");
  if (status === 'disabled') cond.push("a.status = 'disabled'");
  if (nodeId) { cond.push('a.node_id = ?'); args.push(nodeId); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM accounts a JOIN users u ON u.id = a.user_id ${where}`).get(...args).c;
  const rows = db.prepare(`SELECT a.*, u.username AS owner FROM accounts a JOIN users u ON u.id = a.user_id
                           ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...args, size, offset);
  let list = rows.map((a) => ({ ...accRow(a), owner: a.owner }));
  if (status === 'running') list = db.prepare('SELECT 1').get() ? list.filter((a) => a.state === 'running') : list;
  return ok(ctx.res, { list, total, page, pageSize: size });
}

export async function adminCreateAccount(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const uid = Number(body.user_id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (!user) throw new HttpError(400, '请选择有效用户');
  const nodeId = Number(body.node_id) || db.prepare('SELECT id FROM nodes ORDER BY sort, id LIMIT 1').get()?.id;
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId);
  if (!node) throw new HttpError(400, '请选择有效节点');
  const port = Number(body.port) || mtg.findFreePort(nodeId);
  if (db.prepare('SELECT id FROM accounts WHERE node_id = ? AND port = ?').get(nodeId, port)) throw new HttpError(400, '该端口已被占用');
  const quota = Number(body.quota_mb) || getSettingNum('default_quota_mb');
  const secret = randomSecret();
  const name = String(body.name || '').trim().slice(0, 60) || `代理-${port}`;
  const expires = body.expires_days ? new Date(Date.now() + Number(body.expires_days) * 86400000).toISOString().replace('T', ' ').slice(0, 19) : null;
  const info = db.prepare(`INSERT INTO accounts(user_id, node_id, name, secret, port, quota_mb, status, expires_at, remark)
                           VALUES(?,?,?,?,?,?, 'active', ?, ?)`).run(uid, nodeId, name, secret, port, quota, expires, String(body.remark || ''));
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid);
  await mtg.startAccount(acc);
  audit(admin, '创建代理', `account:${acc.id}`, `用户 ${user.username} 端口 ${port}`, clientIp(ctx.req));
  return ok(ctx.res, accRow(acc), '代理已创建并启动');
}

export async function adminUpdateAccount(ctx) {
  const admin = requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!acc) throw new HttpError(404, '代理不存在');
  const body = await readBody(ctx.req);
  const sets = [];
  const args = [];
  if (body.name !== undefined) { sets.push('name = ?'); args.push(String(body.name).slice(0, 60)); }
  if (body.port !== undefined && Number(body.port) !== acc.port) {
    const p = Number(body.port);
    if (!(p > 0 && p < 65536)) throw new HttpError(400, '端口不合法');
    if (db.prepare('SELECT id FROM accounts WHERE node_id = ? AND port = ?').get(acc.node_id, p)) throw new HttpError(400, '端口已被占用');
    sets.push('port = ?'); args.push(p);
  }
  if (body.node_id !== undefined && Number(body.node_id) !== acc.node_id) {
    const nid = Number(body.node_id);
    if (!db.prepare('SELECT id FROM nodes WHERE id = ?').get(nid)) throw new HttpError(400, '节点不存在');
    sets.push('node_id = ?'); args.push(nid);
  }
  if (body.quota_mb !== undefined) { sets.push('quota_mb = ?'); args.push(Math.max(0, Number(body.quota_mb) || 0)); }
  if (body.status !== undefined) { sets.push('status = ?'); args.push(body.status === 'disabled' ? 'disabled' : 'active'); }
  if (body.expires_at !== undefined) { sets.push('expires_at = ?'); args.push(body.expires_at || null); }
  if (body.remark !== undefined) { sets.push('remark = ?'); args.push(String(body.remark).slice(0, 200)); }
  if (body.used_bytes !== undefined) { sets.push('used_bytes = ?'); args.push(Math.max(0, Number(body.used_bytes) || 0)); }
  if (body.reset_usage) { sets.push('used_bytes = 0'); }
  if (!sets.length) return ok(ctx.res, null, '无变动');
  sets.push('updated_at = ?'); args.push(nowIso());
  db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  const fresh = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (body.reset_usage) db.prepare('DELETE FROM traffic_daily WHERE account_id = ?').run(id);
  await mtg.reloadAccount(fresh);
  audit(admin, '修改代理', `account:${id}`, Object.keys(body).join(','), clientIp(ctx.req));
  return ok(ctx.res, accRow(fresh), '已保存并生效');
}

export async function adminToggleAccount(ctx) {
  const admin = requireAdmin(ctx.req);
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(ctx.params.id));
  if (!acc) throw new HttpError(404, '代理不存在');
  const { fresh, status } = await setAccountStatus(admin, acc);
  return ok(ctx.res, accRow(fresh), status === 'active' ? '已启用' : '已停用');
}

export async function adminRotateAccount(ctx) {
  const admin = requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!acc) throw new HttpError(404, '代理不存在');
  db.prepare('UPDATE accounts SET secret = ?, updated_at = ? WHERE id = ?').run(randomSecret(), nowIso(), id);
  const fresh = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  await mtg.reloadAccount(fresh);
  audit(admin, '重置密钥', `account:${id}`, '', clientIp(ctx.req));
  return ok(ctx.res, accRow(fresh), '密钥已重置');
}

export async function adminDeleteAccount(ctx) {
  const admin = requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!acc) throw new HttpError(404, '代理不存在');
  mtg.stopAccount(id);
  await billing.removeRules(acc).catch(() => {});
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  try { fs.rmSync(path.join(config.instanceDir, String(id)), { recursive: true, force: true }); } catch { /* ignore */ }
  audit(admin, '删除代理', `account:${id}`, `端口 ${acc.port}`, clientIp(ctx.req));
  return ok(ctx.res, null, '已删除');
}

export async function adminAccountAction(ctx) {
  const admin = requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const action = ctx.params.action;
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!acc) throw new HttpError(404, '代理不存在');
  if (action === 'start') {
    const r = await mtg.startAccount(acc);
    return ok(ctx.res, r, r.ok ? '已启动' : '启动失败（账号不可用）');
  }
  if (action === 'stop') { mtg.stopAccount(id); return ok(ctx.res, null, '已停止'); }
  if (action === 'restart') { await mtg.reloadAccount(acc); return ok(ctx.res, null, '已重启'); }
  if (action === 'test') { return ok(ctx.res, await mtg.loadBalanceCheck(acc)); }
  throw new HttpError(400, '未知操作');
}

// ============================================================
// 管理端：节点
// ============================================================
export async function adminListNodes(ctx) {
  requireAdmin(ctx.req);
  const rows = db.prepare(`SELECT n.*,
      (SELECT COUNT(*) FROM accounts a WHERE a.node_id = n.id) AS account_count,
      (SELECT COUNT(*) FROM accounts a WHERE a.node_id = n.id AND a.status = 'active') AS active_count,
      (SELECT COALESCE(SUM(a.used_bytes),0) FROM accounts a WHERE a.node_id = n.id) AS used_bytes
    FROM nodes n ORDER BY n.sort, n.id`).all();
  const running = mtg.runningAccounts();
  const byNode = new Map();
  for (const r of running) {
    const a = db.prepare('SELECT node_id FROM accounts WHERE id = ?').get(r.id);
    if (!a) continue;
    byNode.set(a.node_id, (byNode.get(a.node_id) || 0) + 1);
  }
  return ok(ctx.res, { list: rows.map((n) => ({ ...n, running: byNode.get(n.id) || 0, ip: mtg.resolvePublicIp(n) })) });
}

export async function adminCreateNode(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const name = String(body.name || '').trim();
  if (!name) throw new HttpError(400, '请填写节点名称');
  const host = String(body.host || '').trim();
  if (!host) throw new HttpError(400, '请填写节点地址');
  const info = db.prepare(`INSERT INTO nodes(name, host, public_ip, ip_version, port_base, port_range, status, domain, note, sort)
                           VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    name, host, String(body.public_ip || host).trim(), body.ip_version === 'ipv6' ? 'ipv6' : 'ipv4',
    Number(body.port_base) || 20000, Number(body.port_range) || 1000, body.status === 'offline' ? 'offline' : 'online',
    String(body.domain || ''), String(body.note || ''), Number(body.sort) || 0,
  );
  audit(admin, '创建节点', `node:${info.lastInsertRowid}`, name, clientIp(ctx.req));
  return ok(ctx.res, { id: info.lastInsertRowid }, '节点已创建');
}

export async function adminUpdateNode(ctx) {
  const admin = requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const n = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
  if (!n) throw new HttpError(404, '节点不存在');
  const b = await readBody(ctx.req);
  const sets = []; const args = [];
  for (const k of ['name', 'host', 'public_ip', 'domain', 'note']) {
    if (b[k] !== undefined) { sets.push(`${k} = ?`); args.push(String(b[k]).slice(0, 200)); }
  }
  if (b.ip_version !== undefined) { sets.push('ip_version = ?'); args.push(b.ip_version === 'ipv6' ? 'ipv6' : 'ipv4'); }
  if (b.port_base !== undefined) { sets.push('port_base = ?'); args.push(Number(b.port_base) || 20000); }
  if (b.port_range !== undefined) { sets.push('port_range = ?'); args.push(Number(b.port_range) || 1000); }
  if (b.status !== undefined) { sets.push('status = ?'); args.push(b.status === 'offline' ? 'offline' : 'online'); }
  if (b.sort !== undefined) { sets.push('sort = ?'); args.push(Number(b.sort) || 0); }
  if (!sets.length) return ok(ctx.res, null, '无变动');
  sets.push('updated_at = ?'); args.push(nowIso());
  db.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  audit(admin, '修改节点', `node:${id}`, Object.keys(b).join(','), clientIp(ctx.req));
  return ok(ctx.res, null, '已保存');
}

export async function adminDeleteNode(ctx) {
  const admin = requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const c = db.prepare('SELECT COUNT(*) AS c FROM accounts WHERE node_id = ?').get(id).c;
  if (c > 0) throw new HttpError(400, `该节点下还有 ${c} 个代理，请先迁移或删除`);
  db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
  audit(admin, '删除节点', `node:${id}`, '', clientIp(ctx.req));
  return ok(ctx.res, null, '节点已删除');
}

export async function adminNodeHealth(ctx) {
  requireAdmin(ctx.req);
  const nodes = db.prepare('SELECT * FROM nodes ORDER BY sort, id').all();
  const results = await Promise.all(nodes.map(async (n) => ({
    id: n.id, name: n.name, status: n.status, ip: mtg.resolvePublicIp(n),
    health: await mtg.checkNodeHealth(n).catch((e) => ({ online: false, error: e.message })),
  })));
  return ok(ctx.res, { list: results, core: { port: 'mtg 2.2.8', runtime: 'nobody', dcs: 3 } });
}

/** 一键批量同步节点状态（在线/离线） */
export async function adminSyncNodes(ctx) {
  requireAdmin(ctx.req);
  const nodes = db.prepare('SELECT * FROM nodes').all();
  const out = [];
  for (const n of nodes) {
    const h = await mtg.checkNodeHealth(n).catch(() => ({ online: false }));
    db.prepare('UPDATE nodes SET status = ?, updated_at = ? WHERE id = ?').run(h.online ? 'online' : 'offline', nowIso(), n.id);
    out.push({ id: n.id, online: h.online });
  }
  return ok(ctx.res, { list: out }, '节点状态已同步');
}

// ============================================================
// 管理端：流量申请审核
// ============================================================
export async function adminListTickets(ctx) {
  requireAdmin(ctx.req);
  const { page, size, offset } = pageParams(ctx.url);
  const status = ctx.url.searchParams.get('status') || '';
  const where = status ? 'WHERE t.status = ?' : '';
  const args = status ? [status] : [];
  const total = db.prepare(`SELECT COUNT(*) AS c FROM tickets t ${where}`).get(...args).c;
  const rows = db.prepare(`SELECT t.*, u.username FROM tickets t JOIN users u ON u.id = t.user_id
                           ${where} ORDER BY CASE t.status WHEN 'pending' THEN 0 ELSE 1 END, t.id DESC LIMIT ? OFFSET ?`)
    .all(...args, size, offset);
  const pending = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE status = 'pending'").get().c;
  return ok(ctx.res, { list: rows, total, pending, page, pageSize: size });
}

export async function reviewTicket(ctx) {
  const admin = requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  if (!t) throw new HttpError(404, '申请不存在');
  if (t.status !== 'pending') throw new HttpError(400, '该申请已处理');
  const body = await readBody(ctx.req);
  const action = body.action === 'reject' ? 'reject' : 'approve';
  const note = String(body.admin_note || '').slice(0, 300);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(t.user_id);
  if (action === 'approve') {
    let amount = Number(body.amount_mb) > 0 ? Number(body.amount_mb) : t.amount_mb;
    if (t.account_id) {
      const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(t.account_id);
      if (acc) {
        db.prepare('UPDATE accounts SET quota_mb = quota_mb + ?, updated_at = ? WHERE id = ?').run(amount, nowIso(), acc.id);
        const fresh = db.prepare('SELECT * FROM accounts WHERE id = ?').get(acc.id);
        await mtg.reloadAccount(fresh);
      }
    } else {
      db.prepare('UPDATE users SET quota_mb = quota_mb + ?, updated_at = ? WHERE id = ?').run(amount, nowIso(), user.id);
    }
    db.prepare("UPDATE tickets SET status = 'approved', admin_note = ?, reviewed_by = ?, reviewed_at = ?, amount_mb = ? WHERE id = ?")
      .run(note, admin.id, nowIso(), amount, id);
    audit(admin, '通过流量申请', `ticket:${id}`, `用户 ${user.username} +${amount} MB`, clientIp(ctx.req));
    mailer.notifyTicket(user, { ...t, amount_mb: amount, admin_note: note }, true);
    return ok(ctx.res, { status: 'approved' }, `已通过，为用户增加 ${amount} MB`);
  }
  db.prepare("UPDATE tickets SET status = 'rejected', admin_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?")
    .run(note, admin.id, nowIso(), id);
  audit(admin, '拒绝流量申请', `ticket:${id}`, note, clientIp(ctx.req));
  mailer.notifyTicket(user, { ...t, admin_note: note }, false);
  return ok(ctx.res, { status: 'rejected' }, '已拒绝');
}

export async function adminBatchTicket(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => n > 0) : [];
  if (!ids.length) throw new HttpError(400, '请选择申请');
  const action = body.action === 'reject' ? 'reject' : 'approve';
  let done = 0;
  for (const id of ids) {
    const t = db.prepare("SELECT * FROM tickets WHERE id = ? AND status = 'pending'").get(id);
    if (!t) continue;
    if (action === 'approve') {
      if (t.account_id) {
        db.prepare('UPDATE accounts SET quota_mb = quota_mb + ? WHERE id = ?').run(t.amount_mb, t.account_id);
        const fresh = db.prepare('SELECT * FROM accounts WHERE id = ?').get(t.account_id);
        if (fresh) await mtg.reloadAccount(fresh);
      } else {
        db.prepare('UPDATE users SET quota_mb = quota_mb + ? WHERE id = ?').run(t.amount_mb, t.user_id);
      }
    }
    db.prepare('UPDATE tickets SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?')
      .run(action === 'approve' ? 'approved' : 'rejected', admin.id, nowIso(), id);
    done++;
  }
  audit(admin, action === 'approve' ? '批量通过申请' : '批量拒绝申请', `tickets:${ids.join(',')}`, `${done} 条`, clientIp(ctx.req));
  return ok(ctx.res, { done }, `已处理 ${done} 条申请`);
}

// ============================================================
// 管理端：仪表盘 / 审计 / 设置
// ============================================================
export async function adminDashboard(ctx) {
  requireAdmin(ctx.req);
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const activeUsers = db.prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'active'").get().c;
  const newUsers7 = db.prepare("SELECT COUNT(*) AS c FROM users WHERE created_at >= datetime('now', '-7 day')").get().c;
  const accCount = db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
  const runningCount = mtg.runningAccounts().length;
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const todayRow = db.prepare('SELECT COALESCE(SUM(up_bytes+down_bytes),0) AS t FROM traffic_daily WHERE day = ?').get(today);
  const totalBytes = db.prepare('SELECT COALESCE(SUM(used_bytes),0) AS t FROM accounts').get().t;
  const pendingTickets = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE status = 'pending'").get().c;
  const nodes = db.prepare('SELECT * FROM nodes ORDER BY sort, id').all();
  const days = 14;
  const start = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare('SELECT day, SUM(up_bytes) AS up, SUM(down_bytes) AS down FROM traffic_daily WHERE day >= ? GROUP BY day').all(start);
  const map = new Map(rows.map((r) => [r.day, r]));
  const series = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10);
    const r = map.get(d);
    series.push({ date: d, up: r?.up || 0, down: r?.down || 0, total: (r?.up || 0) + (r?.down || 0) });
  }
  const topUsers = db.prepare(`SELECT u.id, u.username, COALESCE(SUM(a.used_bytes),0) AS used
                               FROM users u LEFT JOIN accounts a ON a.user_id = u.id
                               GROUP BY u.id ORDER BY used DESC LIMIT 6`).all();
  const recentLogins = db.prepare('SELECT * FROM login_logs ORDER BY id DESC LIMIT 8').all();
  const recentAudit = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 8').all();
  const health = await mtg.checkTelegramDC().catch(() => ({ ok: false }));
  return ok(ctx.res, {
    users: { total: userCount, active: activeUsers, new7: newUsers7 },
    accounts: { total: accCount, running: runningCount },
    traffic: { today: todayRow.t, total: totalBytes },
    pendingTickets,
    nodes: nodes.map((n) => ({ id: n.id, name: n.name, status: n.status, ip: mtg.resolvePublicIp(n) })),
    series, topUsers, recentLogins, recentAudit,
    core: { telegram: health.ok, latency: health.latency || 0, mtgVersion: '2.2.8', running: runningCount },
  });
}

export async function adminAuditLogs(ctx) {
  requireAdmin(ctx.req);
  const { page, size, offset } = pageParams(ctx.url, 20);
  const q = String(ctx.url.searchParams.get('q') || '').trim();
  const where = q ? 'WHERE action LIKE ? OR username LIKE ? OR detail LIKE ?' : '';
  const args = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs ${where}`).get(...args).c;
  const list = db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, size, offset);
  return ok(ctx.res, { list, total, page, pageSize: size });
}

export async function adminLoginLogs(ctx) {
  requireAdmin(ctx.req);
  const { page, size, offset } = pageParams(ctx.url, 20);
  const total = db.prepare('SELECT COUNT(*) AS c FROM login_logs').get().c;
  const list = db.prepare('SELECT * FROM login_logs ORDER BY id DESC LIMIT ? OFFSET ?').all(size, offset);
  return ok(ctx.res, { list, total, page, pageSize: size });
}

export async function adminGetSettings(ctx) {
  requireAdmin(ctx.req);
  const s = getSettings();
  return ok(ctx.res, { settings: s, defaults });
}

export async function adminSaveSettings(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const allowed = Object.keys(defaults);
  const changed = [];
  for (const k of allowed) {
    if (body[k] === undefined) continue;
    const val = String(body[k]);
    if (['register_quota_mb', 'default_quota_mb', 'max_accounts_per_user', 'daily_transfer_limit_mb'].includes(k) && !Number.isFinite(Number(val))) {
      throw new HttpError(400, `${k} 需为数字`);
    }
    setSetting(k, val);
    changed.push(k);
  }
  audit(admin, '保存系统设置', 'settings', changed.join(','), clientIp(ctx.req));
  return ok(ctx.res, { settings: getSettings() }, '设置已保存');
}

/** 管理端手动调度：让所有代理重新服从额度/到期规则 */
export async function adminResync(ctx) {
  const admin = requireAdmin(ctx.req);
  const accs = db.prepare('SELECT * FROM accounts').all();
  let started = 0, stopped = 0;
  for (const acc of accs) {
    if (mtg.isAccountEnabled(acc)) {
      if (!mtg.getRunningEntry(acc.id)) { await mtg.startAccount(acc); started++; }
    } else if (mtg.getRunningEntry(acc.id)) { mtg.stopAccount(acc.id); stopped++; }
  }
  audit(admin, '同步代理状态', 'accounts', `启动 ${started} 停止 ${stopped}`, clientIp(ctx.req));
  return ok(ctx.res, { started, stopped }, `已同步：启动 ${started}，停止 ${stopped}`);
}
