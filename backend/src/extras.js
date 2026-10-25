/**
 * 系统扩展：SMTP、站点图标、公告跑马灯、数据备份、维护模式等
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, getSettings, setSetting, getSetting, getSettingBool, audit, defaults } from './db.js';
import { HttpError, readBody, clientIp, requireAdmin, requireAuth, ok, pageParams } from './http.js';
import * as mailer from './mailer.js';
import * as captcha from './captcha.js';
import * as emailVerify from './emailverify.js';
import * as mtg from './mtg.js';

const UPLOAD_DIR = path.join(config.root, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function nowIso() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }

// ============================================================
// SMTP
// ============================================================
export async function adminTestSmtp(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const to = String(body.to || getSetting('smtp_test_to') || '').trim();
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new HttpError(400, '请填写有效的收件邮箱');
  // 允许先用临时配置测试（未保存时）
  if (body.settings && typeof body.settings === 'object') {
    for (const [k, v] of Object.entries(body.settings)) if (k.startsWith('smtp_') || k.startsWith('mail_')) setSetting(k, v);
  }
  try {
    await mailer.sendTestMail(to);
  } catch (e) {
    db.prepare('INSERT INTO mail_logs(to_addr, subject, template, status, error) VALUES(?,?,?,?,?)')
      .run(to, 'SMTP 配置测试', 'test', 'failed', String(e.message).slice(0, 500));
    throw new HttpError(400, '发送失败：' + e.message);
  }
  setSetting('smtp_test_to', to);
  audit(admin, 'SMTP 测试发送', to, '', clientIp(ctx.req));
  return ok(ctx.res, null, `测试邮件已发送至 ${to}，请查收`);
}

export async function adminMailLogs(ctx) {
  requireAdmin(ctx.req);
  const { page, size, offset } = pageParams(ctx.url);
  const total = db.prepare('SELECT COUNT(*) AS c FROM mail_logs').get().c;
  const list = db.prepare('SELECT * FROM mail_logs ORDER BY id DESC LIMIT ? OFFSET ?').all(size, offset);
  return ok(ctx.res, { list, total, page, pageSize: size, configured: mailer.mailConfigured() });
}

export async function adminClearMailLogs(ctx) {
  const admin = requireAdmin(ctx.req);
  db.prepare('DELETE FROM mail_logs').run();
  audit(admin, '清空邮件日志', 'mail_logs', '', clientIp(ctx.req));
  return ok(ctx.res, null, '邮件日志已清空');
}

// ============================================================
// 站点图标 / Logo 上传
// ============================================================
export async function adminUploadAsset(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req, 3 * 1024 * 1024);
  const kind = String(body.kind || 'logo');
  const dataUrl = String(body.data || '');
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|svg\+xml|webp|x-icon|vnd\.microsoft\.icon);base64,(.+)$/);
  if (!m) throw new HttpError(400, '仅支持 PNG / JPG / SVG / WEBP / ICO 图片');
  const extMap = { png: 'png', jpeg: 'jpg', jpg: 'jpg', 'svg+xml': 'svg', webp: 'webp', 'x-icon': 'ico', 'vnd.microsoft.icon': 'ico' };
  const ext = extMap[m[1]] || 'png';
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) throw new HttpError(400, '图片不能超过 2MB');
  const name = `${kind}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  for (const old of fs.readdirSync(UPLOAD_DIR)) {
    if (old.startsWith(kind + '-') && old !== name) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, old)); } catch { /* ignore */ }
    }
  }
  const url = `/uploads/${name}`;
  if (kind === 'logo') setSetting('site_logo', url);
  else if (kind === 'favicon') setSetting('site_favicon', url);
  else if (kind === 'loginbg') setSetting('ui_login_bg', url);
  audit(admin, '上传图片', url, kind, clientIp(ctx.req));
  return ok(ctx.res, { url }, '已更新');
}

export async function adminDeleteAsset(ctx) {
  const admin = requireAdmin(ctx.req);
  const kind = String(ctx.url.searchParams.get('kind') || 'logo');
  const key = kind === 'loginbg' ? 'ui_login_bg' : kind === 'favicon' ? 'site_favicon' : 'site_logo';
  const cur = getSetting(key);
  if (cur && cur.startsWith('/uploads/')) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(cur))); } catch { /* ignore */ }
  }
  setSetting(key, '');
  audit(admin, '删除图片', kind, '', clientIp(ctx.req));
  return ok(ctx.res, null, '已恢复默认');
}

// ============================================================
// 公告 / 跑马灯
// ============================================================
export async function adminListNotices(ctx) {
  requireAdmin(ctx.req);
  const rows = db.prepare('SELECT * FROM notifications ORDER BY pinned DESC, id DESC').all();
  const marquee = db.prepare('SELECT * FROM annc_marquee ORDER BY sort, id').all();
  return ok(ctx.res, { list: rows, marquee });
}

export async function adminSaveNotice(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const id = Number(body.id) || 0;
  const f = {
    title: String(body.title || '').slice(0, 120),
    content: String(body.content || '').slice(0, 4000),
    type: ['info', 'success', 'warning', 'error'].includes(body.type) ? body.type : 'info',
    level: ['normal', 'important', 'urgent'].includes(body.level) ? body.level : 'normal',
    target: ['all', 'new', 'admin'].includes(body.target) ? body.target : 'all',
    pinned: body.pinned ? 1 : 0,
    active: body.active === undefined ? 1 : body.active ? 1 : 0,
    starts_at: body.starts_at || null,
    ends_at: body.ends_at || null,
  };
  if (!f.title) throw new HttpError(400, '请填写公告标题');
  if (id) {
    db.prepare(`UPDATE notifications SET title=?, content=?, type=?, level=?, target=?, pinned=?, active=?, starts_at=?, ends_at=? WHERE id=?`)
      .run(f.title, f.content, f.type, f.level, f.target, f.pinned, f.active, f.starts_at, f.ends_at, id);
  } else {
    db.prepare(`INSERT INTO notifications(title, content, type, level, target, pinned, active, starts_at, ends_at, created_by)
                VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(f.title, f.content, f.type, f.level, f.target, f.pinned, f.active, f.starts_at, f.ends_at, admin.id);
  }
  audit(admin, id ? '修改公告' : '发布公告', `notice:${id || 'new'}`, f.title, clientIp(ctx.req));
  return ok(ctx.res, null, '公告已保存');
}

export async function adminDeleteNotice(ctx) {
  const admin = requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  db.prepare('DELETE FROM notifications WHERE id = ?').run(id);
  audit(admin, '删除公告', `notice:${id}`, '', clientIp(ctx.req));
  return ok(ctx.res, null, '已删除');
}

export async function adminSaveMarquee(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const id = Number(body.id) || 0;
  const text = String(body.text || '').slice(0, 300);
  if (!text) throw new HttpError(400, '请填写跑马灯文字');
  if (id) db.prepare('UPDATE annc_marquee SET text=?, active=?, sort=? WHERE id=?').run(text, body.active ? 1 : 0, Number(body.sort) || 0, id);
  else db.prepare('INSERT INTO annc_marquee(text, active, sort) VALUES(?,?,?)').run(text, body.active === false ? 0 : 1, Number(body.sort) || 0);
  audit(admin, '保存跑马灯', `marquee:${id || 'new'}`, text.slice(0, 60), clientIp(ctx.req));
  return ok(ctx.res, null, '已保存');
}

export async function adminDeleteMarquee(ctx) {
  requireAdmin(ctx.req);
  db.prepare('DELETE FROM annc_marquee WHERE id = ?').run(Number(ctx.params.id));
  return ok(ctx.res, null, '已删除');
}

/** 用户侧：获取生效中的公告与跑马灯 */
export async function listActiveNotices(ctx) {
  const now = nowIso();
  const rows = db.prepare(`SELECT id,title,content,type,level,pinned FROM notifications
      WHERE active = 1
        AND (starts_at IS NULL OR starts_at = '' OR starts_at <= ?)
        AND (ends_at IS NULL OR ends_at = '' OR ends_at >= ?)
      ORDER BY pinned DESC, id DESC LIMIT 10`).all(now, now);
  const marquee = db.prepare('SELECT id, text FROM annc_marquee WHERE active = 1 ORDER BY sort, id').all();
  return ok(ctx.res, { list: rows, marquee });
}

export async function markNoticeRead(ctx) {
  const user = requireAuth(ctx.req);
  const body = await readBody(ctx.req);
  const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
  if (!ids.length) return ok(ctx.res, null);
  // 用 settings 存已读（轻量实现，按用户）
  const key = `read_notice_${user.id}`;
  const prev = new Set(String(getSetting(key) || '').split(',').filter(Boolean));
  for (const id of ids) prev.add(String(id));
  setSetting(key, [...prev].join(','));
  return ok(ctx.res, null);
}

// ============================================================
// 数据备份 / 维护
// ============================================================
export async function adminBackups(ctx) {
  requireAdmin(ctx.req);
  const dir = path.join(config.dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const list = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const cfg = getSetting('backup_keep');
  return ok(ctx.res, { list, keep: Number(cfg) || 10 });
}

export async function adminCreateBackup(ctx) {
  const admin = requireAdmin(ctx.req);
  const dir = path.join(config.dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const name = `backup-${nowIso().replace(/[: ]/g, '-')}.db`;
  const target = path.join(dir, name);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  // 只保留最近 N 份
  const keep = Number(getSetting('backup_keep')) || 10;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
  while (files.length > keep) {
    const old = files.shift();
    try { fs.unlinkSync(path.join(dir, old)); } catch { /* ignore */ }
  }
  audit(admin, '创建备份', name, '', clientIp(ctx.req));
  return ok(ctx.res, { name }, '备份已创建');
}

export async function adminDeleteBackup(ctx) {
  const admin = requireAdmin(ctx.req);
  const name = path.basename(String(ctx.url.searchParams.get('name') || ''));
  if (!name.endsWith('.db')) throw new HttpError(400, '非法的备份文件名');
  const p = path.join(config.dataDir, 'backups', name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  audit(admin, '删除备份', name, '', clientIp(ctx.req));
  return ok(ctx.res, null, '已删除');
}

export async function adminDownloadBackup(ctx) {
  requireAdmin(ctx.req);
  const name = path.basename(String(ctx.url.searchParams.get('name') || ''));
  if (!name.endsWith('.db')) throw new HttpError(400, '非法的备份文件名');
  const p = path.join(config.dataDir, 'backups', name);
  if (!fs.existsSync(p)) throw new HttpError(404, '备份不存在');
  ctx.res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${name}"`,
  });
  fs.createReadStream(p).pipe(ctx.res);
}

/** 维护模式开关 */
export async function adminToggleMaintenance(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  setSetting('maintenance_mode', body.on ? '1' : '0');
  audit(admin, body.on ? '开启维护模式' : '关闭维护模式', 'settings', '', clientIp(ctx.req));
  return ok(ctx.res, null, body.on ? '维护模式已开启' : '维护模式已关闭');
}

/** 清理过期数据 */
export async function adminCleanup(ctx) {
  const admin = requireAdmin(ctx.req);
  const days = Number(getSetting('audit_retention_days')) || 90;
  const r1 = db.prepare(`DELETE FROM audit_logs WHERE created_at < datetime('now', ?)`).run(`-${days} day`);
  const r2 = db.prepare(`DELETE FROM login_logs WHERE created_at < datetime('now', ?)`).run(`-${days} day`);
  const r3 = db.prepare(`DELETE FROM traffic_daily WHERE day < date('now', '-365 day')`).run();
  audit(admin, '清理过期数据', 'db', `审计${r1.changes} 登录${r2.changes} 流量明细${r3.changes}`, clientIp(ctx.req));
  return ok(ctx.res, { audit: r1.changes, login: r2.changes, traffic: r3.changes }, '清理完成');
}

/** 站点资源信息（系统页展示） */
export async function adminSiteInfo(ctx) {
  requireAdmin(ctx.req);
  const s = getSettings();
  const sizes = {
    db: 0, uploads: 0,
  };
  try { sizes.db = fs.statSync(config.dbFile).size; } catch { /* ignore */ }
  for (const f of fs.readdirSync(UPLOAD_DIR)) {
    try { sizes.uploads += fs.statSync(path.join(UPLOAD_DIR, f)).size; } catch { /* ignore */ }
  }
  const backupDir = path.join(config.dataDir, 'backups');
  let backups = 0;
  try { backups = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db')).length; } catch { /* ignore */ }
  return ok(ctx.res, {
    site: { logo: s.site_logo, favicon: s.site_favicon, login_bg: s.ui_login_bg, theme: s.ui_theme },
    sizes, backups, mail: { configured: mailer.mailConfigured(), host: s.smtp_host, enabled: s.smtp_enabled === '1' },
    maintenance: s.maintenance_mode === '1',
    running: mtg.runningAccounts().length,
  });
}

export function isMaintenance() {
  return getSettingBool('maintenance_mode');
}

// ============================================================
// 邮件：预设、连通性诊断、模板
// ============================================================
export async function adminMailPresets(ctx) {
  requireAdmin(ctx.req);
  const s = getSettings();
  const cfg = mailer.resolveSmtpConfig(s);
  return ok(ctx.res, {
    presets: mailer.mailPresetList(),
    current: { preset: s.smtp_preset, host: cfg.host, port: cfg.port, secure: cfg.secure, mode: cfg.mode },
    configured: mailer.mailConfigured(),
    mta: fs.existsSync('/usr/sbin/postfix') || fs.existsSync('/usr/bin/postfix'),
  });
}

/** 只检测连通性，不真正发信 */
export async function adminMailCheck(ctx) {
  requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const s = body.settings ? { ...getSettings(), ...body.settings } : getSettings();
  const cfg = mailer.resolveSmtpConfig(s);
  if (!cfg.host) throw new HttpError(400, '未配置发信服务器');
  const net = await import('node:net');
  const tls = await import('node:tls');
  const started = Date.now();
  const latency = await new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => finish(-1), 8000);
    const onErr = () => { clearTimeout(timer); finish(-1); };
    if (cfg.secure === 'ssl') {
      const sk = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, rejectUnauthorized: false });
      sk.once('secureConnect', () => { clearTimeout(timer); sk.destroy(); finish(Date.now() - started); });
      sk.once('error', onErr);
    } else {
      const sk = net.connect({ host: cfg.host, port: cfg.port });
      sk.once('connect', () => { clearTimeout(timer); sk.destroy(); finish(Date.now() - started); });
      sk.once('error', onErr);
    }
  });
  return ok(ctx.res, {
    host: cfg.host, port: cfg.port, secure: cfg.secure, mode: cfg.mode,
    reachable: latency >= 0, latency,
  });
}

export async function adminMailTemplates(ctx) {
  requireAdmin(ctx.req);
  const s = getSettings();
  const list = Object.entries(mailer.TEMPLATE_DEFS).map(([key, def]) => ({
    key, name: def.name,
    subject: s[def.subject_key] || def.defaultSubject,
    body: s[def.body_key] || def.defaultBody,
    defaultSubject: def.defaultSubject,
    defaultBody: def.defaultBody,
    vars: def.vars,
    customized: !!(s[def.body_key] || s[def.subject_key]),
  }));
  return ok(ctx.res, { list, themeColor: s.mail_tpl_theme_color || '#2450eb' });
}

export async function adminSaveTemplate(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const key = String(body.key || '');
  const def = mailer.TEMPLATE_DEFS[key];
  if (!def) throw new HttpError(400, '未知的模板');
  if (body.subject !== undefined) setSetting(def.subject_key, String(body.subject).slice(0, 200));
  if (body.body !== undefined) setSetting(def.body_key, String(body.body).slice(0, 20000));
  audit(admin, '保存邮件模板', `template:${key}`, '', clientIp(ctx.req));
  return ok(ctx.res, null, '模板已保存');
}

export async function adminResetTemplate(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const def = mailer.TEMPLATE_DEFS[String(body.key || '')];
  if (!def) throw new HttpError(400, '未知的模板');
  setSetting(def.subject_key, '');
  setSetting(def.body_key, '');
  return ok(ctx.res, { subject: def.defaultSubject, body: def.defaultBody }, '已恢复默认模板');
}

/** 预览邮件（渲染完整 HTML，不发送） */
export async function adminPreviewMail(ctx) {
  requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const key = String(body.key || '');
  const def = mailer.TEMPLATE_DEFS[key];
  if (!def) throw new HttpError(400, '未知的模板');
  const sample = {
    username: 'demo_user', site: getSetting('site_name'), quota: '10', login_url: 'http://' + getSetting('node_public_ip'),
    status: '通过', amount: '10.0 GB', note: '请注意合理使用', pct: '85', account: '手机代理',
    used: '8.5 GB', time: new Date().toLocaleString('zh-CN'),
    host: mailer.resolveSmtpConfig().host || 'smtp.qq.com', mode: '内置中继',
    ...(body.vars || {}),
  };
  const subject = mailer.renderVars(body.subject ?? getSetting(def.subject_key) ?? def.defaultSubject, sample);
  const bodyHtml = mailer.renderVars(body.body ?? getSetting(def.body_key) ?? def.defaultBody, sample);
  return ok(ctx.res, {
    subject,
    html: mailer.buildMailHtml(bodyHtml, sample),
    vars: sample,
  });
}

// ============================================================
// 人机验证
// ============================================================
export async function publicCaptchaConfig(ctx) {
  return ok(ctx.res, captcha.captchaConfig());
}

export async function publicCaptchaChallenge(ctx) {
  const url = ctx.url;
  const scene = String(url.searchParams.get('scene') || 'login');
  if (!captcha.needCaptcha(scene)) return ok(ctx.res, { required: false });
  const ch = captcha.createChallenge({ ip: clientIp(ctx.req) });
  return ok(ctx.res, { required: true, ...ch });
}

export async function adminCaptchaStatus(ctx) {
  requireAdmin(ctx.req);
  const s = getSettings();
  const today = db.prepare("SELECT COUNT(*) AS c FROM captcha_challenges WHERE created_at >= date('now')").get().c;
  return ok(ctx.res, {
    config: captcha.captchaConfig(),
    provider: s.captcha_provider,
    selfHosted: captcha.isSelfHosted(),
    today,
  });
}

export { defaults };


// ============================================================
// Telegram 机器人管理
// ============================================================
import * as bot from './bot.js';

export async function botStatus(ctx) {
  requireAdmin(ctx.req);
  const st = getSettings();
  const mailReady = st.smtp_enabled === '1' && !!String(st.smtp_user || '').trim() && !!String(st.smtp_pass || '').trim();
  let stats = { total: 0, today: 0, active7: 0, signinToday: 0 };
  try { stats = bot.botStats(); } catch { /* ignore */ }
  const base = { mailReady, stats, bot: { username: st.bot_username, name: st.bot_name, link: st.bot_link } };

  const primary = db.prepare('SELECT * FROM bots WHERE is_primary = 1 LIMIT 1').get();
  const inst = primary ? botmgr.getInstance(primary.id) : null;
  if (inst) {
    return ok(ctx.res, {
      ...base,
      running: !!inst.running,
      mode: inst.mode,
      me: inst.me,
      startedAt: inst.startedAt,
      lastError: inst.lastError || '',
      lastUpdateAt: inst.lastUpdateAt,
      counters: { ...inst.counters },
      stats,
    });
  }
  return ok(ctx.res, { ...base, ...bot.botState() });
}

export async function botStart(ctx) {
  const admin = requireAdmin(ctx.req);
  try {
    // 统一由多机器人管理器托管，避免与其他实例争抢 getUpdates
    const primary = db.prepare('SELECT id FROM bots WHERE is_primary = 1 LIMIT 1').get();
    let st;
    if (primary) {
      const r = await botmgr.startBot(primary.id);
      st = { running: true, mode: r.me ? 'polling' : 'polling', me: r.me };
    } else {
      st = await bot.startBot();
    }
    audit(admin, '启动机器人', 'bot', st.mode, clientIp(ctx.req));
    return ok(ctx.res, st, `机器人已启动（${st.mode}）@${st.me?.username || ''}`);
  } catch (e) {
    throw new HttpError(400, '启动失败：' + e.message);
  }
}

export async function botStop(ctx) {
  const admin = requireAdmin(ctx.req);
  const primary = db.prepare('SELECT id FROM bots WHERE is_primary = 1 LIMIT 1').get();
  if (primary) await botmgr.stopBot(primary.id);
  const st = await bot.stopBot();
  audit(admin, '停止机器人', 'bot', '', clientIp(ctx.req));
  return ok(ctx.res, st, '机器人已停止');
}

export async function botRestart(ctx) {
  const admin = requireAdmin(ctx.req);
  try {
    const st = await bot.restartBot();
    audit(admin, '重启机器人', 'bot', st.mode, clientIp(ctx.req));
    return ok(ctx.res, st, '机器人已重启');
  } catch (e) {
    throw new HttpError(400, '重启失败：' + e.message);
  }
}

/** 校验 Token 并返回机器人信息（不用启动） */
export async function botTestToken(ctx) {
  requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  if (body.token) setSetting('bot_token', String(body.token).trim());
  try {
    const me = await bot.getMe();
    setSetting('bot_username', me.username || '');
    setSetting('bot_name', me.first_name || '');
    if (me.username) setSetting('bot_link', `https://t.me/${me.username}`);
    return ok(ctx.res, { username: me.username, name: me.first_name, id: me.id, link: `https://t.me/${me.username}` }, `Token 有效：@${me.username}`);
  } catch (e) {
    throw new HttpError(400, 'Token 无效：' + e.message);
  }
}

export async function botBroadcast(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const text = String(body.text || '').trim();
  if (!text) throw new HttpError(400, '请填写广播内容');
  const target = ['all', 'one', 'groups', 'mixed'].includes(body.target) ? body.target : 'all';
  if (target === 'one' && !String(body.tgId || '').trim()) throw new HttpError(400, '请填写要通知的 Telegram 用户 ID');
  try {
    const r = await bot.broadcast({
      text, target,
      tgId: body.tgId,
      chatIds: Array.isArray(body.chatIds) ? body.chatIds : [],
      withMenu: body.withMenu !== false,
      parseMode: body.parseMode,
    });
    audit(admin, '机器人广播', `bot:${target}`, `成功 ${r.ok}/${r.total}`, clientIp(ctx.req));
    const label = { all: '全部用户', one: '指定用户', groups: '群组/频道', mixed: '全部（用户+群组）' }[target];
    return ok(ctx.res, r, `已发送【${label}】：成功 ${r.ok}，失败 ${r.fail}`);
  } catch (e) {
    throw new HttpError(400, '发送失败：' + e.message);
  }
}

/** 广播可用目标列表 */
export async function botBroadcastTargets(ctx) {
  requireAdmin(ctx.req);
  const t = bot.broadcastTargets();
  return ok(ctx.res, {
    users: t.users,
    groups: t.groups.map((g) => ({ chat_id: g.chat_id, title: g.title || g.chat_id, type: g.type })),
    recentUsers: db.prepare('SELECT tg_id, tg_username, tg_first_name FROM bot_users ORDER BY last_active DESC LIMIT 30').all(),
  });
}

/** 测试机器人能否向某个群组/频道发消息 */
export async function botTestChat(ctx) {
  requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const chatId = String(body.chatId || '').trim();
  if (!chatId) throw new HttpError(400, '请填写群组/频道 ID');
  try {
    const chat = await bot.getChat(chatId);
    return ok(ctx.res, { ok: true, title: chat.title || chat.username || chatId, type: chat.type, id: chat.id }, `可以发送消息：${chat.title || chatId}`);
  } catch (e) {
    throw new HttpError(400, '无法访问该群组：' + e.message + '（请先把机器人拉进群/频道并设为管理员）');
  }
}

export async function botUsers(ctx) {
  requireAdmin(ctx.req);
  const { page, size, offset } = pageParams(ctx.url);
  const q = String(ctx.url.searchParams.get('q') || '').trim();
  const where = q ? 'WHERE b.tg_id LIKE ? OR b.tg_username LIKE ?' : '';
  const args = q ? [`%${q}%`, `%${q}%`] : [];
  const total = db.prepare(`SELECT COUNT(*) AS c FROM bot_users b ${where}`).get(...args).c;
  const list = db.prepare(`SELECT b.*, u.username AS platform_username,
      (SELECT COUNT(*) FROM accounts a WHERE a.user_id = b.user_id) AS account_count
    FROM bot_users b LEFT JOIN users u ON u.id = b.user_id ${where}
    ORDER BY b.id DESC LIMIT ? OFFSET ?`).all(...args, size, offset);
  return ok(ctx.res, { list, total, page, pageSize: size });
}

export async function botUpdateUser(ctx) {
  const admin = requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const body = await readBody(ctx.req);
  const bu = db.prepare('SELECT * FROM bot_users WHERE id = ?').get(id);
  if (!bu) throw new HttpError(404, '机器人用户不存在');
  const sets = []; const args = [];
  if (body.balance_mb !== undefined) { sets.push('balance_mb = ?'); args.push(Number(body.balance_mb) || 0); }
  if (body.banned !== undefined) { sets.push('banned = ?'); args.push(body.banned ? 1 : 0); }
  if (body.reset_signin) { sets.push("last_signin = NULL"); sets.push('signin_streak = 0'); }
  if (!sets.length) return ok(ctx.res, null, '无变动');
  db.prepare(`UPDATE bot_users SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  audit(admin, '修改机器人用户', `botuser:${id}`, Object.keys(body).join(','), clientIp(ctx.req));
  return ok(ctx.res, null, '已保存');
}

export async function botCommands(ctx) {
  requireAdmin(ctx.req);
  const { page, size, offset } = pageParams(ctx.url, 30);
  const total = db.prepare('SELECT COUNT(*) AS c FROM bot_commands').get().c;
  const list = db.prepare(`SELECT c.*, b.tg_username FROM bot_commands c
    LEFT JOIN bot_users b ON b.tg_id = c.tg_id ORDER BY c.id DESC LIMIT ? OFFSET ?`).all(size, offset);
  // 命令统计
  const stat = db.prepare(`SELECT command, COUNT(*) AS c FROM bot_commands
    WHERE created_at >= datetime('now','-7 day') GROUP BY command ORDER BY c DESC LIMIT 10`).all();
  return ok(ctx.res, { list, total, page, pageSize: size, stat });
}

export async function botButtons(ctx) {
  requireAdmin(ctx.req);
  const rows = db.prepare('SELECT * FROM bot_buttons ORDER BY parent, sort, id').all();
  return ok(ctx.res, {
    list: rows,
    actions: [
      { value: 'create', label: '创建代理' }, { value: 'my', label: '我的代理' },
      { value: 'usage', label: '我的流量' }, { value: 'signin', label: '每日签到' },
      { value: 'help', label: '帮助' }, { value: 'menu', label: '返回主菜单' },
      { value: 'url', label: '打开链接（payload 填 URL）' },
    ],
  });
}

export async function botSaveButton(ctx) {
  const admin = requireAdmin(ctx.req);
  const b = await readBody(ctx.req);
  const label = String(b.label || '').trim().slice(0, 32);
  const action = String(b.action || '').trim();
  if (!label || !action) throw new HttpError(400, '按钮文字与动作都不能为空');
  if (b.id) {
    db.prepare('UPDATE bot_buttons SET label=?, action=?, payload=?, sort=?, active=?, admin_only=? WHERE id=?')
      .run(label, action, String(b.payload || ''), Number(b.sort) || 0, b.active === false ? 0 : 1, b.admin_only ? 1 : 0, Number(b.id));
  } else {
    db.prepare('INSERT INTO bot_buttons(parent, label, action, payload, sort, active, admin_only) VALUES(?,?,?,?,?,?,?)')
      .run('main', label, action, String(b.payload || ''), Number(b.sort) || 0, b.active === false ? 0 : 1, b.admin_only ? 1 : 0);
  }
  audit(admin, '保存机器人按钮', `button:${b.id || 'new'}`, label, clientIp(ctx.req));
  return ok(ctx.res, null, '按钮已保存');
}

export async function botDeleteButton(ctx) {
  requireAdmin(ctx.req);
  db.prepare('DELETE FROM bot_buttons WHERE id = ?').run(Number(ctx.params.id));
  return ok(ctx.res, null, '已删除');
}

/** 向 Telegram 设置命令菜单（BotFather 同一效果） */
export async function botSetCommands(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);

  const defaults = {
    private: [
      { command: 'start', description: '开始使用' },
      { command: 'create', description: '创建代理' },
      { command: 'my', description: '我的代理' },
      { command: 'usage', description: '查看流量' },
      { command: 'signin', description: '每日签到' },
      { command: 'invite', description: '邀请赚流量' },
      { command: 'id', description: '查看我的 ID' },
      { command: 'help', description: '使用帮助' },
    ],
    group: [
      { command: 'id', description: '查看我的 ID 与本群 ID' },
      { command: 'userid', description: '回复某人查看其 ID' },
      { command: 'rules', description: '查看群规则' },
      { command: 'help', description: '群内可用命令' },
      { command: 'mute', description: '回复某人后禁言 (/mute 30m)' },
      { command: 'unmute', description: '回复某人后解除禁言' },
      { command: 'kick', description: '回复某人后移出' },
      { command: 'ban', description: '回复某人后封禁' },
    ],
    admins: [
      { command: 'mute', description: '回复某人后禁言（如 /mute 30m）' },
      { command: 'unmute', description: '回复某人后解除禁言' },
      { command: 'kick', description: '回复某人后移出群组' },
      { command: 'ban', description: '回复某人后封禁' },
      { command: 'id', description: '查看本群 ID' },
    ],
  };
  try {
    const r = await bot.setCommands({
      private: Array.isArray(body.private) ? body.private : defaults.private,
      group: Array.isArray(body.group) ? body.group : defaults.group,
      admins: Array.isArray(body.admins) ? body.admins : defaults.admins,
    });
    audit(admin, '设置机器人命令菜单', 'bot', `私聊${r.private?.length || 0}条/群组${r.group?.length || 0}条`, clientIp(ctx.req));
    return ok(ctx.res, r, `命令菜单已同步：私聊 ${r.private?.length || 0} 条，群组 ${r.group?.length || 0} 条`);
  } catch (e) {
    throw new HttpError(400, '设置失败：' + e.message);
  }
}

/** 读取当前命令配置 */
export async function botGetCommands(ctx) {
  requireAdmin(ctx.req);
  try {
    const r = await bot.getCommands();
    return ok(ctx.res, r);
  } catch (e) {
    throw new HttpError(400, '读取失败：' + e.message);
  }
}

// ============================================================
// 群组管理与守卫
// ============================================================
import * as guard from './groupguard.js';

export async function adminGroups(ctx) {
  requireAdmin(ctx.req);
  const list = db.prepare(`SELECT g.*,
      (SELECT COUNT(*) FROM group_admins a WHERE a.chat_id = g.chat_id) AS admin_count,
      (SELECT COUNT(*) FROM group_admins a WHERE a.chat_id = g.chat_id AND a.blocked = 1) AS blocked_count,
      (SELECT COUNT(*) FROM verify_sessions v WHERE v.chat_id = g.chat_id) AS verify_count
    FROM tg_groups g ORDER BY g.id DESC`).all();
  const todayVerify = db.prepare("SELECT COUNT(*) AS c FROM verify_sessions WHERE created_at >= date('now')").get().c;
  const passRate = (() => {
    const total = db.prepare("SELECT COUNT(*) AS c FROM verify_sessions WHERE status != 'pending'").get().c;
    const passed = db.prepare("SELECT COUNT(*) AS c FROM verify_sessions WHERE status = 'passed'").get().c;
    return total ? Math.round((passed / total) * 100) : 0;
  })();
  return ok(ctx.res, { list, stats: { todayVerify, passRate, groups: list.length } });
}

export async function adminSaveGroup(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const chatId = String(body.chat_id || '').trim();
  if (!chatId) throw new HttpError(400, '请填写群组 ID');
  const exist = db.prepare('SELECT * FROM tg_groups WHERE chat_id = ?').get(chatId);
  if (exist) {
    db.prepare('UPDATE tg_groups SET title=?, verify_enabled=?, captcha_type=?, captcha_options=?, captcha_attempts=?, captcha_timeout=?, welcome_text=? WHERE chat_id=?')
      .run(String(body.title || exist.title || ''), body.verify_enabled ? 1 : 0, body.captcha_type || 'choice',
        Number(body.captcha_options) || 4, Number(body.captcha_attempts) || 3, Number(body.captcha_timeout) || 120,
        String(body.welcome_text || ''), chatId);
  } else {
    db.prepare('INSERT INTO tg_groups(chat_id, title, verify_enabled, captcha_type, captcha_options, captcha_attempts, captcha_timeout, welcome_text) VALUES(?,?,?,?,?,?,?,?)')
      .run(chatId, String(body.title || ''), body.verify_enabled ? 1 : 0, body.captcha_type || 'choice',
        Number(body.captcha_options) || 4, Number(body.captcha_attempts) || 3, Number(body.captcha_timeout) || 120, String(body.welcome_text || ''));
  }
  audit(admin, '保存群组设置', `group:${chatId}`, '', clientIp(ctx.req));
  return ok(ctx.res, null, '群组已保存');
}

export async function adminDeleteGroup(ctx) {
  const admin = requireAdmin(ctx.req);
  const chatId = String(ctx.url.searchParams.get('chat_id') || '');
  db.prepare('DELETE FROM tg_groups WHERE chat_id = ?').run(chatId);
  db.prepare('DELETE FROM group_admins WHERE chat_id = ?').run(chatId);
  audit(admin, '删除群组', `group:${chatId}`, '', clientIp(ctx.req));
  return ok(ctx.res, null, '已删除');
}

export async function adminGroupAdmins(ctx) {
  requireAdmin(ctx.req);
  const chatId = String(ctx.url.searchParams.get('chat_id') || '');
  const where = chatId ? 'WHERE chat_id = ?' : '';
  const args = chatId ? [chatId] : [];
  const list = db.prepare(`SELECT * FROM group_admins ${where} ORDER BY blocked, chat_id, id`).all(...args);
  const groups = db.prepare('SELECT chat_id, title FROM tg_groups').all();
  return ok(ctx.res, {
    list, groups,
    allowAll: getSettingBool('grp_admin_allow_all'),
    whitelist: String(getSetting('grp_admin_whitelist') || '').split(/[,\s]+/).filter(Boolean),
  });
}

export async function adminToggleGroupAdmin(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const id = Number(body.id);
  const row = db.prepare('SELECT * FROM group_admins WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, '管理员记录不存在');
  db.prepare('UPDATE group_admins SET blocked = ? WHERE id = ?').run(row.blocked ? 0 : 1, id);
  audit(admin, row.blocked ? '恢复群管理员权限' : '禁用群管理员权限', `groupadmin:${id}`, row.tg_id, clientIp(ctx.req));
  return ok(ctx.res, { blocked: !row.blocked }, row.blocked ? '已恢复该管理员的放行权限' : '已禁用该管理员的放行权限');
}

export async function adminBannedWords(ctx) {
  requireAdmin(ctx.req);
  const list = db.prepare('SELECT * FROM banned_words ORDER BY category, id').all();
  return ok(ctx.res, { list });
}

export async function adminSaveWord(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const word = String(body.word || '').trim().slice(0, 200);
  if (!word) throw new HttpError(400, '请填写内容');
  const category = ['word', 'regex', 'link'].includes(body.category) ? body.category : 'word';
  const action = ['delete', 'mute', 'delete_mute', 'kick'].includes(body.action) ? body.action : 'delete_mute';
  if (body.id) {
    db.prepare('UPDATE banned_words SET word=?, category=?, action=?, mute_minutes=?, enabled=? WHERE id=?')
      .run(word, category, action, Number(body.mute_minutes) || 5, body.enabled === false ? 0 : 1, Number(body.id));
  } else {
    db.prepare('INSERT INTO banned_words(word, category, action, mute_minutes, enabled) VALUES(?,?,?,?,?)')
      .run(word, category, action, Number(body.mute_minutes) || 5, body.enabled === false ? 0 : 1);
  }
  audit(admin, '保存违禁词', `word:${body.id || 'new'}`, word.slice(0, 40), clientIp(ctx.req));
  return ok(ctx.res, null, '已保存');
}

export async function adminDeleteWord(ctx) {
  requireAdmin(ctx.req);
  db.prepare('DELETE FROM banned_words WHERE id = ?').run(Number(ctx.params.id));
  return ok(ctx.res, null, '已删除');
}

/** 批量导入违禁词（换行分隔） */
export async function adminImportWords(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const lines = String(body.words || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean).slice(0, 2000);
  const ins = db.prepare('INSERT INTO banned_words(word, category, action, mute_minutes) VALUES(?,?,?,?)');
  let n = 0;
  for (const w of lines) { ins.run(w, 'word', 'delete_mute', Number(body.mute_minutes) || 5); n++; }
  audit(admin, '导入违禁词', 'words', `${n} 条`, clientIp(ctx.req));
  return ok(ctx.res, { count: n }, `已导入 ${n} 条`);
}

export async function adminVerifySessions(ctx) {
  requireAdmin(ctx.req);
  const { page, size, offset } = pageParams(ctx.url, 20);
  const total = db.prepare('SELECT COUNT(*) AS c FROM verify_sessions').get().c;
  const list = db.prepare('SELECT * FROM verify_sessions ORDER BY created_at DESC LIMIT ? OFFSET ?').all(size, offset);
  return ok(ctx.res, { list, total, page, pageSize: size });
}

export async function adminModLogs(ctx) {
  requireAdmin(ctx.req);
  const { page, size, offset } = pageParams(ctx.url, 20);
  const total = db.prepare('SELECT COUNT(*) AS c FROM mod_logs').get().c;
  const list = db.prepare('SELECT * FROM mod_logs ORDER BY id DESC LIMIT ? OFFSET ?').all(size, offset);
  return ok(ctx.res, { list, total, page, pageSize: size });
}

/** 群组守卫测试：生成一道验证题（后台预览用） */
export async function adminGroupTest(ctx) {
  requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const type = body.type || getSetting('grp_captcha_type') || 'choice';
  const opts = Number(body.options) || getSettingNum('grp_captcha_options') || 4;
  let question; let answer; let options;
  if (type === 'math') {
    const a = 1 + Math.floor(Math.random() * 9);
    const b = 1 + Math.floor(Math.random() * 9);
    question = `${a} + ${b} = ?`; answer = String(a + b);
    const set = new Set([answer]);
    while (set.size < opts) set.add(String(Number(answer) + (Math.floor(Math.random() * 9) - 4)));
    options = [...set].filter((x) => x !== '0' || answer === '0').sort(() => Math.random() - 0.5).slice(0, opts);
  } else {
    const pool = [['🍎 苹果', '香蕉', '橙子', '葡萄'], ['🌙 月亮', '太阳', '星星', '云朵'], ['🐱 猫', '狗', '兔', '鸟']];
    const p = pool[Math.floor(Math.random() * pool.length)];
    question = `请选出：${p[0]}`;
    answer = p[0];
    options = [...p].sort(() => Math.random() - 0.5).slice(0, Math.max(2, opts));
  }
  return ok(ctx.res, { question, answer, options: options.slice(0, opts) });
}

export async function adminGuardSettings(ctx) {
  requireAdmin(ctx.req);
  const s = getSettings();
  return ok(ctx.res, {
    settings: s,
    bots: db.prepare('SELECT COUNT(*) AS c FROM bot_users').get().c,
    words: db.prepare('SELECT COUNT(*) AS c FROM banned_words WHERE enabled = 1').get().c,
    modLogs: db.prepare("SELECT COUNT(*) AS c FROM mod_logs WHERE created_at >= date('now')").get().c,
  });
}

// ============================================================
// 邀请与群成员
// ============================================================
import * as inviteSys from './invite.js';

export async function adminInviteOverview(ctx) {
  requireAdmin(ctx.req);
  const s = getSettings();
  const total = db.prepare('SELECT COUNT(*) AS c FROM invite_records').get().c;
  const rewarded = db.prepare("SELECT COUNT(*) AS c FROM invite_records WHERE status = 'rewarded'").get().c;
  const pending = db.prepare("SELECT COUNT(*) AS c FROM invite_records WHERE status = 'pending'").get().c;
  const grantedMb = db.prepare("SELECT COALESCE(SUM(reward_mb),0) AS s FROM invite_records WHERE status = 'rewarded'").get().s;
  const top = db.prepare(`SELECT r.inviter_tg_id, b.tg_username, COUNT(*) AS cnt, COALESCE(SUM(r.reward_mb),0) AS mb
    FROM invite_records r LEFT JOIN bot_users b ON b.tg_id = r.inviter_tg_id
    WHERE r.status = 'rewarded' GROUP BY r.inviter_tg_id ORDER BY cnt DESC LIMIT 10`).all();
  return ok(ctx.res, {
    config: {
      enabled: s.bot_ref_enabled === '1',
      bonus_mb: s.bot_ref_bonus_mb,
      invitee_mb: s.bot_ref_invitee_mb,
      per_invite: s.bot_ref_per_invite,
      max_reward: s.bot_ref_max_reward,
      daily_limit: s.bot_ref_daily_limit,
      need_verify: s.bot_ref_need_verify,
    },
    stats: { total, rewarded, pending, grantedMb: Number(grantedMb) },
    top,
    records: inviteSys.allInviteRecords(100),
    links: db.prepare('SELECT * FROM invite_links ORDER BY use_count DESC LIMIT 20').all(),
  });
}

export async function adminInviteRecords(ctx) {
  requireAdmin(ctx.req);
  const { page, size, offset } = pageParams(ctx.url);
  const total = db.prepare('SELECT COUNT(*) AS c FROM invite_records').get().c;
  const list = db.prepare(`SELECT r.*, b.tg_username AS inviter_name FROM invite_records r
    LEFT JOIN bot_users b ON b.tg_id = r.inviter_tg_id ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(size, offset);
  return ok(ctx.res, { list, total, page, pageSize: size });
}

/** 手动确认某条邀请（发放奖励） */
export async function adminInviteConfirm(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const rec = db.prepare('SELECT * FROM invite_records WHERE id = ?').get(Number(body.id));
  if (!rec) throw new HttpError(404, '记录不存在');
  const r = inviteSys.grantReward(rec.id);
  audit(admin, '手动确认邀请', `invite:${rec.id}`, `${r?.reward || 0} MB`, clientIp(ctx.req));
  return ok(ctx.res, r, '已发放邀请奖励');
}

export async function adminGroupMembers(ctx) {
  requireAdmin(ctx.req);
  const chatId = String(ctx.url.searchParams.get('chat_id') || '');
  const { page, size, offset } = pageParams(ctx.url, 50);
  const where = chatId ? 'WHERE chat_id = ?' : '';
  const args = chatId ? [chatId] : [];
  const total = db.prepare(`SELECT COUNT(*) AS c FROM group_members ${where}`).get(...args).c;
  const list = db.prepare(`SELECT * FROM group_members ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, size, offset);
  return ok(ctx.res, { list, total, page, pageSize: size });
}

// ============================================================
// 邮箱验证
// ============================================================
export async function publicEmailStatus(ctx) {
  const s = getSettings();
  return ok(ctx.res, {
    required: emailVerify.isEmailEnabled(),
    enabled: s.register_email_verify === '1',
    mailReady: mailer.mailConfigured(),
    needEmail: s.register_need_email === '1',
    maskedHint: '',
  });
}

export async function publicSendEmailCode(ctx) {
  const body = await readBody(ctx.req);
  const r = await emailVerify.sendCode(String(body.email || ''), clientIp(ctx.req), String(body.scene || 'register'));
  return ok(ctx.res, r, `验证码已发送至 ${r.masked}，${r.ttl} 分钟内有效`);
}

export async function publicVerifyEmailCode(ctx) {
  const body = await readBody(ctx.req);
  const r = emailVerify.verifyCode(String(body.email || ''), String(body.code || ''), String(body.scene || 'register'));
  return ok(ctx.res, r, '邮箱验证成功');
}

export async function adminEmailLogs(ctx) {
  requireAdmin(ctx.req);
  const { page, size, offset } = pageParams(ctx.url);
  const total = db.prepare('SELECT COUNT(*) AS c FROM email_codes').get().c;
  const list = db.prepare('SELECT id,email,scene,attempts,used,ip,created_at FROM email_codes ORDER BY id DESC LIMIT ? OFFSET ?').all(size, offset);
  return ok(ctx.res, { list, total, page, pageSize: size, mailReady: mailer.mailConfigured(), required: emailVerify.isEmailEnabled() });
}

/** 邮箱模板预览 */
export async function adminPreviewEmailTpl(ctx) {
  requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const s = getSettings();
  const vars = { site: s.site_name, code: '123456', ttl: String(getSettingNum('verify_code_ttl') || 10), color: s.mail_tpl_theme_color || '#2450eb', time: new Date().toLocaleString('zh-CN') };
  const subject = mailer.renderVars(body.subject ?? s.verify_template_subject, vars);
  const bodyHtml = mailer.renderVars(body.body ?? s.verify_template_body ?? '', vars)
    || mailer.renderVars(`<p>你好！</p><p>你正在注册 <b>{{site}}</b> 账号，本次的邮箱验证码为：</p>
      <div style="margin:18px 0;padding:14px;background:#f5f6f8;border-radius:8px;text-align:center;">
      <span style="font-size:28px;font-weight:700;letter-spacing:8px;color:{{color}};">{{code}}</span></div>
      <p style="color:#8b919e;font-size:13px;">验证码 {{ttl}} 分钟内有效，请勿泄露给他人。</p>`, vars);
  return ok(ctx.res, { subject, html: mailer.buildMailHtml(bodyHtml, vars) });
}


/** 同步机器人所在的群组/频道 */
export async function botSyncChats(ctx) {
  const admin = requireAdmin(ctx.req);
  try {
    const known = db.prepare('SELECT chat_id FROM tg_groups').all().map((r) => r.chat_id);
    const saved = await bot.syncChats(known);
    audit(admin, '同步机器人会话', 'bot', `发现 ${saved.length} 个`, clientIp(ctx.req));
    return ok(ctx.res, { list: saved }, `同步完成，共 ${saved.length} 个群组/频道`);
  } catch (e) {
    throw new HttpError(400, '同步失败：' + e.message);
  }
}

/** 检查每个群组/频道的机器人权限 */
export async function botChatPerms(ctx) {
  requireAdmin(ctx.req);
  const list = db.prepare('SELECT chat_id, title, type FROM tg_groups').all();
  const results = [];
  for (const g of list) {
    const p = await bot.chatPermissions(g.chat_id);
    results.push({ ...g, ...p });
  }
  return ok(ctx.res, { list: results });
}

// ============================================================
// 多机器人管理
// ============================================================
import * as botmgr from './botmanager.js';
import * as aiMod from './ai.js';

export async function botsList(ctx) {
  requireAdmin(ctx.req);
  return ok(ctx.res, { list: botmgr.listBots() });
}

export async function botsCreate(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  try {
    const b = await botmgr.createBot({ name: body.name, token: String(body.token || '').trim() });
    audit(admin, '添加机器人', `bot:${b.id}`, b.username, clientIp(ctx.req));
    return ok(ctx.res, { id: b.id, username: b.username }, `机器人 @${b.username} 已添加`);
  } catch (e) {
    throw new HttpError(400, '添加失败：' + e.message);
  }
}

export async function botsUpdate(ctx) {
  const admin = requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const body = await readBody(ctx.req);
  try {
    await botmgr.updateBot(id, body);
    audit(admin, '修改机器人', `bot:${id}`, Object.keys(body).join(','), clientIp(ctx.req));
    return ok(ctx.res, null, '已保存');
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}

export async function botsDelete(ctx) {
  const admin = requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  try {
    await botmgr.deleteBot(id);
    audit(admin, '删除机器人', `bot:${id}`, '', clientIp(ctx.req));
    return ok(ctx.res, null, '已删除');
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}

export async function botsStart(ctx) {
  const admin = requireAdmin(ctx.req);
  try {
    const r = await botmgr.startBot(Number(ctx.params.id));
    audit(admin, '启动机器人', `bot:${ctx.params.id}`, '', clientIp(ctx.req));
    return ok(ctx.res, r, `机器人 @${r.me?.username || ''} 已启动`);
  } catch (e) {
    throw new HttpError(400, '启动失败：' + e.message);
  }
}

export async function botsStop(ctx) {
  const admin = requireAdmin(ctx.req);
  await botmgr.stopBot(Number(ctx.params.id));
  return ok(ctx.res, null, '已停止');
}

export async function botsRestart(ctx) {
  const admin = requireAdmin(ctx.req);
  try {
    const r = await botmgr.restartBot(Number(ctx.params.id));
    return ok(ctx.res, r, '已重启');
  } catch (e) {
    throw new HttpError(400, '重启失败：' + e.message);
  }
}

export async function botsVerifyToken(ctx) {
  requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  try {
    const me = await botmgr.verifyToken(String(body.token || '').trim());
    return ok(ctx.res, { username: me.username, name: me.first_name, id: me.id, link: `https://t.me/${me.username}` }, `Token 有效：@${me.username}`);
  } catch (e) {
    throw new HttpError(400, 'Token 无效：' + e.message);
  }
}

/** 指定机器人广播 */
export async function botsBroadcast(ctx) {
  const admin = requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const body = await readBody(ctx.req);
  if (!String(body.text || '').trim()) throw new HttpError(400, '请填写广播内容');
  try {
    const r = await botmgr.broadcastWith(id, {
      text: String(body.text).trim(),
      target: body.target || 'all',
      tgId: body.tgId,
      chatIds: body.chatIds,
      withMenu: body.withMenu !== false,
    });
    return ok(ctx.res, r, `已发送：成功 ${r.ok}，失败 ${r.fail}`);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}

// ============================================================
// AI 配置
// ============================================================
export async function aiPresets(ctx) {
  requireAdmin(ctx.req);
  return ok(ctx.res, { presets: aiMod.aiPresetList(), stats: aiMod.aiStats() });
}

export async function aiList(ctx) {
  requireAdmin(ctx.req);
  const list = aiMod.listAiConfigs().map(aiMod.publicAiConfig);
  return ok(ctx.res, { list, stats: aiMod.aiStats(), presets: aiMod.aiPresetList() });
}

export async function aiSave(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const id = Number(body.id) || 0;
  const name = String(body.name || '').trim().slice(0, 64);
  if (!name) throw new HttpError(400, '请填写配置名称');
  const provider = String(body.provider || 'openai');
  const fields = {
    name,
    provider,
    base_url: String(body.base_url || '').trim(),
    model: String(body.model || '').trim(),
    temperature: Number(body.temperature ?? 0.7),
    max_tokens: Number(body.max_tokens ?? 1024),
    system_prompt: String(body.system_prompt || '').slice(0, 4000),
    enabled: body.enabled === false ? 0 : 1,
  };
  // API Key：留空表示不修改
  const apiKey = String(body.api_key || '').trim();
  if (id) {
    if (apiKey && !apiKey.includes('****')) {
      db.prepare(`UPDATE ai_configs SET name=?, provider=?, base_url=?, api_key=?, model=?, temperature=?, max_tokens=?, system_prompt=?, enabled=? WHERE id=?`)
        .run(fields.name, fields.provider, fields.base_url, apiKey, fields.model, fields.temperature, fields.max_tokens, fields.system_prompt, fields.enabled, id);
    } else {
      db.prepare(`UPDATE ai_configs SET name=?, provider=?, base_url=?, model=?, temperature=?, max_tokens=?, system_prompt=?, enabled=? WHERE id=?`)
        .run(fields.name, fields.provider, fields.base_url, fields.model, fields.temperature, fields.max_tokens, fields.system_prompt, fields.enabled, id);
    }
  } else {
    if (!apiKey) throw new HttpError(400, '请填写 API Key');
    const cnt = db.prepare('SELECT COUNT(*) AS c FROM ai_configs').get().c;
    db.prepare(`INSERT INTO ai_configs(name, provider, base_url, api_key, model, temperature, max_tokens, system_prompt, enabled, is_default)
                VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(fields.name, fields.provider, fields.base_url, apiKey, fields.model, fields.temperature, fields.max_tokens, fields.system_prompt, fields.enabled, cnt === 0 ? 1 : 0);
  }
  if (body.is_default) {
    db.prepare('UPDATE ai_configs SET is_default = 0').run();
    const tid = id || db.prepare('SELECT MAX(id) AS m FROM ai_configs').get().m;
    db.prepare('UPDATE ai_configs SET is_default = 1 WHERE id = ?').run(tid);
  }
  audit(admin, id ? '修改 AI 配置' : '添加 AI 配置', `ai:${id || 'new'}`, name, clientIp(ctx.req));
  return ok(ctx.res, null, '已保存');
}

export async function aiDelete(ctx) {
  const admin = requireAdmin(ctx.req);
  db.prepare('DELETE FROM ai_configs WHERE id = ?').run(Number(ctx.params.id));
  return ok(ctx.res, null, '已删除');
}

export async function aiTest(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  let cfg;
  if (body.id) {
    cfg = db.prepare('SELECT * FROM ai_configs WHERE id = ?').get(Number(body.id));
    if (!cfg) throw new HttpError(404, '配置不存在');
    // 允许用表单里未保存的值测试
    if (body.api_key && !String(body.api_key).includes('****')) cfg.api_key = body.api_key;
    if (body.base_url) cfg.base_url = body.base_url;
    if (body.model) cfg.model = body.model;
    if (body.provider) cfg.provider = body.provider;
  } else {
    cfg = {
      provider: body.provider || 'openai',
      base_url: body.base_url || '',
      api_key: body.api_key || '',
      model: body.model || '',
      temperature: 0.7,
      max_tokens: 64,
    };
  }
  try {
    const r = await aiMod.testAiConfig(cfg);
    return ok(ctx.res, r, `测试成功（${r.totalLatency}ms）：${r.text}`);
  } catch (e) {
    throw new HttpError(400, '测试失败：' + e.message);
  }
}

export async function aiLogs(ctx) {
  requireAdmin(ctx.req);
  const { page, size, offset } = pageParams(ctx.url);
  const total = db.prepare('SELECT COUNT(*) AS c FROM ai_logs').get().c;
  const list = db.prepare('SELECT * FROM ai_logs ORDER BY id DESC LIMIT ? OFFSET ?').all(size, offset);
  return ok(ctx.res, { list, total, page, pageSize: size, stats: aiMod.aiStats() });
}

export async function aiClearLogs(ctx) {
  const admin = requireAdmin(ctx.req);
  db.prepare('DELETE FROM ai_logs').run();
  return ok(ctx.res, null, '已清空');
}

// ============================================================
// WorkBuddy 集成
// ============================================================
import * as wb from './workbuddy.js';

/** 发起登录：返回授权链接 */
export async function wbLoginStart(ctx) {
  requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const region = body.region === 'global' ? 'global' : 'cn';
  try {
    const r = await wb.loginStart(region);
    return ok(ctx.res, r, '请打开链接完成授权');
  } catch (e) {
    throw new HttpError(400, '发起登录失败：' + e.message);
  }
}

/** 轮询登录结果 */
export async function wbLoginPoll(ctx) {
  requireAdmin(ctx.req);
  const state = String(ctx.url?.searchParams?.get('state') || '');
  const region = ctx.url?.searchParams?.get('region') === 'global' ? 'global' : 'cn';
  if (!state) throw new HttpError(400, '缺少 state');
  try {
    const r = await wb.loginPoll(state, region);
    if (r.code === 'done') {
      const id = wb.saveAccount(r.credential);
      return ok(ctx.res, { done: true, id, nickname: r.credential.nickname, uid: r.credential.uid }, '登录成功');
    }
    if (r.code === 'error') return ok(ctx.res, { done: false, error: r.message });
    return ok(ctx.res, { done: false, pending: true });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}

/** 账号列表 */
export async function wbAccounts(ctx) {
  requireAdmin(ctx.req);
  const list = wb.listAccounts().map((a) => ({
    id: a.id,
    uid: a.uid,
    nickname: a.nickname,
    region: a.region,
    domain: a.domain,
    token: a.access_token ? a.access_token.slice(0, 8) + '****' + a.access_token.slice(-6) : '',
    last_balance: a.last_balance,
    last_checkin: a.last_checkin,
    created_at: a.created_at,
  }));
  return ok(ctx.res, { list });
}

export async function wbDeleteAccount(ctx) {
  const admin = requireAdmin(ctx.req);
  wb.deleteAccount(ctx.params.id);
  return ok(ctx.res, null, '已删除');
}

/** 拉取模型 */
export async function wbModels(ctx) {
  requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const acc = wb.getAccount(id);
  if (!acc) throw new HttpError(404, '账号不存在');
  try {
    const models = await wb.fetchModels({ ...acc, access_token: acc.access_token });
    wb.saveModels(id, models);
    return ok(ctx.res, { list: models }, `获取到 ${models.length} 个模型`);
  } catch (e) {
    throw new HttpError(400, '拉取失败：' + e.message);
  }
}

/** 查询余额 */
export async function wbBalance(ctx) {
  requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const acc = wb.getAccount(id);
  if (!acc) throw new HttpError(404, '账号不存在');
  try {
    const b = await wb.fetchBalance({ ...acc, access_token: acc.access_token });
    db.prepare('UPDATE wb_accounts SET last_balance = ? WHERE id = ?').run(b.total, id);
    return ok(ctx.res, b);
  } catch (e) {
    throw new HttpError(400, '查询失败：' + e.message);
  }
}

/** 签到 */
export async function wbCheckin(ctx) {
  requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const acc = wb.getAccount(id);
  if (!acc) throw new HttpError(404, '账号不存在');
  try {
    const r = await wb.dailyCheckin({ ...acc, access_token: acc.access_token });
    if (r.ok) {
      db.prepare("UPDATE wb_accounts SET last_checkin = date('now'), checkin_streak = checkin_streak + 1 WHERE id = ?").run(id);
    }
    return ok(ctx.res, r, r.message);
  } catch (e) {
    throw new HttpError(400, '签到失败：' + e.message);
  }
}

/** 测试对话 */
export async function wbTest(ctx) {
  requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const acc = wb.getAccount(Number(body.id));
  if (!acc) throw new HttpError(404, '账号不存在');
  try {
    const r = await wb.chatCompletion(
      { ...acc, access_token: acc.access_token },
      { model: body.model || '', messages: [{ role: 'user', content: body.prompt || '你好，请回复"可用"两个字' }] },
    );
    return ok(ctx.res, r, `测试成功：${r.text.slice(0, 60)}`);
  } catch (e) {
    throw new HttpError(400, '测试失败：' + e.message);
  }
}

/** 同步到 AI 配置（让 Bot 能用 WorkBuddy 模型） */
export async function wbSyncToAi(ctx) {
  const admin = requireAdmin(ctx.req);
  const body = await readBody(ctx.req);
  const acc = wb.getAccount(Number(body.id));
  if (!acc) throw new HttpError(404, '账号不存在');
  try {
    const models = await wb.fetchModels({ ...acc, access_token: acc.access_token });
    if (!models.length) throw new Error('该账号没有可用模型');
    // 写入 AI 配置表（provider 标记为 workbuddy）
    const exists = db.prepare("SELECT id FROM ai_configs WHERE provider = 'workbuddy' LIMIT 1").get();
    const name = `WorkBuddy·${acc.nickname || acc.uid || acc.id}`;
    if (exists) {
      db.prepare("UPDATE ai_configs SET name=?, api_key=?, model=?, base_url=?, enabled=1 WHERE id=?")
        .run(name, acc.access_token, models[0].id, 'workbuddy://' + acc.id, exists.id);
    } else {
      const cnt = db.prepare('SELECT COUNT(*) AS c FROM ai_configs').get().c;
      db.prepare(`INSERT INTO ai_configs(name, provider, base_url, api_key, model, temperature, max_tokens, system_prompt, enabled, is_default)
                  VALUES(?,?,?,?,?,0.7,2048,'',1,?)`)
        .run(name, 'workbuddy', 'workbuddy://' + acc.id, acc.access_token, models[0].id, cnt === 0 ? 1 : 0);
    }
    return ok(ctx.res, { models: models.length }, `已同步 ${models.length} 个模型到 AI 助手`);
  } catch (e) {
    throw new HttpError(400, '同步失败：' + e.message);
  }
}


/** 供 AI 配置页选择 WorkBuddy 模型 */
export async function wbModelOptions(ctx) {
  requireAdmin(ctx.req);
  const accounts = wb.listAccounts();
  if (!accounts.length) return ok(ctx.res, { options: [], accounts: [] });

  // 支持按账号 ID 查询
  const wantId = ctx.url?.searchParams?.get('account_id');
  const acc = wantId
    ? (accounts.find((a) => String(a.id) === String(wantId)) || accounts[0])
    : accounts[0];

  let models = db.prepare('SELECT model_id, name, vendor FROM wb_models WHERE account_id = ? ORDER BY id').all(acc.id);
  // 缓存为空则实时拉取
  if (!models.length) {
    try {
      const fetched = await wb.fetchModels({ ...acc });
      wb.saveModels(acc.id, fetched);
      models = fetched.map((m) => ({ model_id: m.id, name: m.name, vendor: m.vendor }));
    } catch { /* ignore */ }
  }
  const options = models.map((m) => ({
    label: m.name && m.name !== m.model_id ? `${m.name} (${m.model_id})` : m.model_id,
    value: m.model_id,
    vendor: m.vendor || '',
  }));
  return ok(ctx.res, {
    options,
    accounts: accounts.map((a) => ({
      id: a.id,
      label: `${a.nickname || '未命名'}（${a.region === 'global' ? '国际版' : '国内版'}）`,
      region: a.region,
      last_balance: a.last_balance,
    })),
    account: { id: acc.id, nickname: acc.nickname },
  });
}
