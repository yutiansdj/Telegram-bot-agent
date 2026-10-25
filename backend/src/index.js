import http from 'node:http';
import fs from 'node:fs';
import { readBody } from './http.js';
import { db, getSetting } from './db.js';
import path from 'node:path';
import { config } from './config.js';
import { HttpError, json, ok, clientIp } from './http.js';
import { seed, seedSettings } from './db.js';
import * as mtg from './mtg.js';
import * as R from './routes.js';
import { startCollector, stopCollector } from './collector.js';
import * as billing from './billing.js';
import * as X from './extras.js';
import * as bot from './bot.js';
import * as botmgr from './botmanager.js';
import * as ai from './ai.js';

const routes = [];
function add(method, pattern, handler, level = 'public') {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, level });
}

// ---------- 公共 ----------
add('POST', '/api/auth/login', R.login);
add('POST', '/api/auth/register', R.register);
add('GET', '/api/auth/me', R.me, 'auth');
add('POST', '/api/auth/password', R.changePassword, 'auth');
add('PUT', '/api/auth/profile', R.updateProfile, 'auth');
add('GET', '/api/public/info', R.publicInfo);

// ---------- 用户侧 ----------
add('GET', '/api/user/dashboard', R.myDashboard, 'auth');
add('GET', '/api/user/traffic', R.myTraffic, 'auth');
add('GET', '/api/nodes', R.listNodes);
add('GET', '/api/accounts', R.listMyAccounts, 'auth');
add('POST', '/api/accounts', R.createMyAccount, 'auth');
add('PUT', '/api/accounts/:id', R.updateMyAccount, 'auth');
add('POST', '/api/accounts/:id/toggle', R.toggleMyAccount, 'auth');
add('POST', '/api/accounts/:id/rotate', R.rotateSecret, 'auth');
add('DELETE', '/api/accounts/:id', R.deleteMyAccount, 'auth');
add('GET', '/api/accounts/:id/test', R.testMyAccount, 'auth');
add('GET', '/api/tickets', R.listMyTickets, 'auth');
add('POST', '/api/tickets', R.createTicket, 'auth');

// ---------- 管理端 ----------
add('GET', '/api/admin/dashboard', R.adminDashboard, 'admin');
add('GET', '/api/admin/users', R.adminListUsers, 'admin');
add('POST', '/api/admin/users', R.adminCreateUser, 'admin');
add('PUT', '/api/admin/users/:id', R.adminUpdateUser, 'admin');
add('DELETE', '/api/admin/users/:id', R.adminDeleteUser, 'admin');
add('POST', '/api/admin/users/:id/quota', R.adminGrantQuota, 'admin');
add('GET', '/api/admin/accounts', R.adminListAccounts, 'admin');
add('POST', '/api/admin/accounts', R.adminCreateAccount, 'admin');
add('PUT', '/api/admin/accounts/:id', R.adminUpdateAccount, 'admin');
add('POST', '/api/admin/accounts/:id/toggle', R.adminToggleAccount, 'admin');
add('POST', '/api/admin/accounts/:id/rotate', R.adminRotateAccount, 'admin');
add('DELETE', '/api/admin/accounts/:id', R.adminDeleteAccount, 'admin');
add('POST', '/api/admin/accounts/:id/action/:action', R.adminAccountAction, 'admin');
add('GET', '/api/admin/nodes', R.adminListNodes, 'admin');
add('POST', '/api/admin/nodes', R.adminCreateNode, 'admin');
add('PUT', '/api/admin/nodes/:id', R.adminUpdateNode, 'admin');
add('DELETE', '/api/admin/nodes/:id', R.adminDeleteNode, 'admin');
add('GET', '/api/admin/nodes/health', R.adminNodeHealth, 'admin');
add('POST', '/api/admin/nodes/sync', R.adminSyncNodes, 'admin');
add('GET', '/api/admin/tickets', R.adminListTickets, 'admin');
add('POST', '/api/admin/tickets/:id/review', R.reviewTicket, 'admin');
add('POST', '/api/admin/tickets/batch', R.adminBatchTicket, 'admin');
add('GET', '/api/admin/audit', R.adminAuditLogs, 'admin');
add('GET', '/api/admin/login-logs', R.adminLoginLogs, 'admin');
add('GET', '/api/admin/settings', R.adminGetSettings, 'admin');
add('PUT', '/api/admin/settings', R.adminSaveSettings, 'admin');
add('POST', '/api/admin/resync', R.adminResync, 'admin');
add('GET', '/api/admin/system', async (ctx) => ok(ctx.res, systemInfo()), 'admin');

// ---------- 扩展：SMTP / 资源 / 公告 / 备份 / 维护 ----------
add('POST', '/api/admin/smtp/test', X.adminTestSmtp, 'admin');
add('GET', '/api/admin/mail-logs', X.adminMailLogs, 'admin');
add('DELETE', '/api/admin/mail-logs', X.adminClearMailLogs, 'admin');
add('POST', '/api/admin/assets', X.adminUploadAsset, 'admin');
add('DELETE', '/api/admin/assets', X.adminDeleteAsset, 'admin');
add('GET', '/api/admin/notices', X.adminListNotices, 'admin');
add('POST', '/api/admin/notices', X.adminSaveNotice, 'admin');
add('DELETE', '/api/admin/notices/:id', X.adminDeleteNotice, 'admin');
add('POST', '/api/admin/marquee', X.adminSaveMarquee, 'admin');
add('DELETE', '/api/admin/marquee/:id', X.adminDeleteMarquee, 'admin');
add('GET', '/api/notices', X.listActiveNotices);
add('POST', '/api/notices/read', X.markNoticeRead, 'auth');
add('GET', '/api/admin/backups', X.adminBackups, 'admin');
add('POST', '/api/admin/backups', X.adminCreateBackup, 'admin');
add('DELETE', '/api/admin/backups', X.adminDeleteBackup, 'admin');
add('GET', '/api/admin/backups/download', X.adminDownloadBackup, 'admin');
add('POST', '/api/admin/maintenance', X.adminToggleMaintenance, 'admin');
add('POST', '/api/admin/cleanup', X.adminCleanup, 'admin');
add('GET', '/api/admin/site-info', X.adminSiteInfo, 'admin');
add('GET', '/api/admin/mail/presets', X.adminMailPresets, 'admin');
add('POST', '/api/admin/mail/check', X.adminMailCheck, 'admin');
add('GET', '/api/admin/mail/templates', X.adminMailTemplates, 'admin');
add('POST', '/api/admin/mail/templates', X.adminSaveTemplate, 'admin');
add('POST', '/api/admin/mail/templates/reset', X.adminResetTemplate, 'admin');
add('POST', '/api/admin/mail/preview', X.adminPreviewMail, 'admin');
add('GET', '/api/captcha/config', X.publicCaptchaConfig);
add('GET', '/api/email/status', X.publicEmailStatus);
add('POST', '/api/email/send', X.publicSendEmailCode);
add('POST', '/api/email/verify', X.publicVerifyEmailCode);
add('GET', '/api/admin/email-logs', X.adminEmailLogs, 'admin');
add('POST', '/api/admin/email/preview', X.adminPreviewEmailTpl, 'admin');
add('GET', '/api/captcha/challenge', X.publicCaptchaChallenge);
add('GET', '/api/admin/captcha/status', X.adminCaptchaStatus, 'admin');
// ---------- Telegram 机器人 ----------
// ---------- 多机器人 ----------
add('GET', '/api/admin/bots', X.botsList, 'admin');
add('POST', '/api/admin/bots', X.botsCreate, 'admin');
add('PUT', '/api/admin/bots/:id', X.botsUpdate, 'admin');
add('DELETE', '/api/admin/bots/:id', X.botsDelete, 'admin');
add('POST', '/api/admin/bots/:id/start', X.botsStart, 'admin');
add('POST', '/api/admin/bots/:id/stop', X.botsStop, 'admin');
add('POST', '/api/admin/bots/:id/restart', X.botsRestart, 'admin');
add('POST', '/api/admin/bots/:id/broadcast', X.botsBroadcast, 'admin');
add('POST', '/api/admin/bots/verify', X.botsVerifyToken, 'admin');
// ---------- WorkBuddy ----------
add('POST', '/api/admin/wb/login/start', X.wbLoginStart, 'admin');
add('GET', '/api/admin/wb/login/poll', X.wbLoginPoll, 'admin');
add('GET', '/api/admin/wb/accounts', X.wbAccounts, 'admin');
add('DELETE', '/api/admin/wb/accounts/:id', X.wbDeleteAccount, 'admin');
add('POST', '/api/admin/wb/accounts/:id/models', X.wbModels, 'admin');
add('GET', '/api/admin/wb/accounts/:id/balance', X.wbBalance, 'admin');
add('POST', '/api/admin/wb/accounts/:id/checkin', X.wbCheckin, 'admin');
add('POST', '/api/admin/wb/test', X.wbTest, 'admin');
add('POST', '/api/admin/wb/sync-ai', X.wbSyncToAi, 'admin');
add('GET', '/api/admin/wb/model-options', X.wbModelOptions, 'admin');

// ---------- AI ----------
add('GET', '/api/admin/ai', X.aiList, 'admin');
add('GET', '/api/admin/ai/presets', X.aiPresets, 'admin');
add('POST', '/api/admin/ai', X.aiSave, 'admin');
add('DELETE', '/api/admin/ai/:id', X.aiDelete, 'admin');
add('POST', '/api/admin/ai/test', X.aiTest, 'admin');
add('GET', '/api/admin/ai/logs', X.aiLogs, 'admin');
add('DELETE', '/api/admin/ai/logs', X.aiClearLogs, 'admin');

add('GET', '/api/admin/bot/status', X.botStatus, 'admin');
add('POST', '/api/admin/bot/start', X.botStart, 'admin');
add('POST', '/api/admin/bot/stop', X.botStop, 'admin');
add('POST', '/api/admin/bot/restart', X.botRestart, 'admin');
add('POST', '/api/admin/bot/test', X.botTestToken, 'admin');
add('POST', '/api/admin/bot/broadcast', X.botBroadcast, 'admin');
add('GET', '/api/admin/bot/broadcast/targets', X.botBroadcastTargets, 'admin');
add('POST', '/api/admin/bot/broadcast/test', X.botTestChat, 'admin');
add('GET', '/api/admin/bot/users', X.botUsers, 'admin');
add('PUT', '/api/admin/bot/users/:id', X.botUpdateUser, 'admin');
add('GET', '/api/admin/bot/commands', X.botCommands, 'admin');
add('GET', '/api/admin/bot/buttons', X.botButtons, 'admin');
add('POST', '/api/admin/bot/buttons', X.botSaveButton, 'admin');
add('DELETE', '/api/admin/bot/buttons/:id', X.botDeleteButton, 'admin');
add('POST', '/api/admin/bot/setmenu', X.botSetCommands, 'admin');
add('GET', '/api/admin/bot/commands/menu', X.botGetCommands, 'admin');
add('POST', '/api/admin/bot/chats/sync', X.botSyncChats, 'admin');
add('GET', '/api/admin/bot/chats/perms', X.botChatPerms, 'admin');
// ---------- 群组管理 ----------
add('GET', '/api/admin/groups', X.adminGroups, 'admin');
add('POST', '/api/admin/groups', X.adminSaveGroup, 'admin');
add('DELETE', '/api/admin/groups', X.adminDeleteGroup, 'admin');
add('GET', '/api/admin/groups/admins', X.adminGroupAdmins, 'admin');
add('POST', '/api/admin/groups/admins/toggle', X.adminToggleGroupAdmin, 'admin');
add('GET', '/api/admin/groups/words', X.adminBannedWords, 'admin');
add('POST', '/api/admin/groups/words', X.adminSaveWord, 'admin');
add('DELETE', '/api/admin/groups/words/:id', X.adminDeleteWord, 'admin');
add('POST', '/api/admin/groups/words/import', X.adminImportWords, 'admin');
add('GET', '/api/admin/groups/verify', X.adminVerifySessions, 'admin');
add('GET', '/api/admin/groups/modlogs', X.adminModLogs, 'admin');
add('POST', '/api/admin/groups/test', X.adminGroupTest, 'admin');
add('GET', '/api/admin/groups/settings', X.adminGuardSettings, 'admin');
add('GET', '/api/admin/groups/members', X.adminGroupMembers, 'admin');
add('GET', '/api/admin/invites', X.adminInviteOverview, 'admin');
add('GET', '/api/admin/invites/records', X.adminInviteRecords, 'admin');
add('POST', '/api/admin/invites/confirm', X.adminInviteConfirm, 'admin');

function systemInfo() {
  const mem = fs.readFileSync('/proc/meminfo', 'utf8');
  const g = (k) => Number((mem.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')) || [])[1] || 0) * 1024;
  const load = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(' ');
  const stat = fs.statfsSync('/');
  return {
    version: config.version,
    node: process.version,
    uptime: Math.floor(process.uptime()),
    cpu: { load1: Number(load[0]), load5: Number(load[1]), cores: Number(process.env.CORES || 4) },
    memory: { total: g('MemTotal'), free: g('MemAvailable') },
    disk: { total: stat.bsize * stat.blocks, free: stat.bsize * stat.bavail },
    running: mtg.runningAccounts().length,
    core: { dcs: mtg.CORE },
    time: new Date().toISOString(),
  };
}

// ---------- 静态资源 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
};

function serveUploads(req, res, pathname) {
  const dir = path.join(config.root, 'uploads');
  const file = path.join(dir, path.basename(pathname));
  if (!file.startsWith(dir) || !fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not Found'); return;
  }
  const ext = path.extname(file).toLowerCase();
  const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
  fs.createReadStream(file).pipe(res);
}

function serveStatic(req, res, pathname) {
  const dist = config.frontendDist;
  let file = path.join(dist, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(dist)) { res.writeHead(403); res.end('forbidden'); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(pathname)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not Found'); return; }
    file = path.join(dist, 'index.html');
  }
  if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('frontend not built'); return; }
  const ext = path.extname(file);
  const isAsset = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Robots-Tag', 'noindex');

  if (pathname === '/api/health') return json(res, 200, { ok: true, ts: Date.now() });

  // 多机器人 Webhook: /api/bot/webhook/<botId>
  const whMatch = pathname.match(/^\/api\/bot\/webhook(?:\/(\d+))?$/);
  if (whMatch && req.method === 'POST') {
    try {
      const body = await readBody(req);
      if (whMatch[1]) {
        await botmgr.handleWebhook(whMatch[1], req, body);
      } else {
        await bot.handleWebhookUpdate(req, body);
      }
    } catch (e) { console.error('[bot webhook]', e.message); }
    return json(res, 200, { ok: true });
  }

  if (pathname.startsWith('/api/')) {
    const route = routes.find((r) => r.method === req.method && r.re.test(pathname));
    if (!route) return json(res, 404, { code: 404, message: '接口不存在' });
    const m = pathname.match(route.re);
    const params = {};
    route.keys.forEach((k, i) => { params[k] = m[i + 1]; });
    try {
      if (X.isMaintenance() && pathname === '/api/auth/login') {
        const body = await readBody(req);
        const u = db.prepare('SELECT role FROM users WHERE username = ?').get(String(body.username || '').trim());
        if (u && u.role !== 'admin') {
          return json(res, 503, { code: 503, message: getSetting('maintenance_notice') || '平台维护中，请稍后再试' });
        }
        req._body = body;
      }
      const out = await route.handler({ req, res, url, params });
      if (out === undefined && !res.writableEnded) json(res, 200, { code: 0, message: 'ok', data: null });
    } catch (e) {
      if (e instanceof HttpError) return json(res, e.status, { code: e.status, message: e.message, error: e.code });
      console.error(`[api] ${req.method} ${pathname}`, e);
      return json(res, 500, { code: 500, message: '服务器内部错误：' + e.message });
    } finally {
      if (process.env.LOG_REQUESTS) console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms ${clientIp(req)}`);
    }
    return;
  }

  if (pathname.startsWith('/uploads/') && (req.method === 'GET' || req.method === 'HEAD')) return serveUploads(req, res, pathname);
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
  res.writeHead(405); res.end('Method Not Allowed');
});

async function main() {
  const s = await seed();
  if (s.adminCreated) {
    console.log(`[init] 已创建管理员账号，初始密码: ${s.adminPassword}`);
    fs.writeFileSync(path.join(config.dataDir, 'INIT_ADMIN_PASSWORD'), `admin / ${s.adminPassword}\n`);
  }
  mtg.ensureNodeDefaults();
  const added = seedSettings();
  if (added) console.log(`[init] 已补全 ${added} 项默认设置`);
  const billingOk = await billing.ensureAccounting();
  console.log(`[tgproxy] 内核级流量计费：${billingOk ? '已启用（iptables owner 计数）' : '不可用，降级为仅统计'}`);
  server.listen(config.port, config.host, () => {
    console.log(`[tgproxy] API listening on http://${config.host}:${config.port}`);
  });
  await mtg.startAll();
  startCollector(30000);
  botmgr.migrateLegacy().then((r) => {
    if (r.migrated) console.log(`[bot] 已迁移旧 Token 为主机器人 @${r.username}`);
  }).catch(() => {}).finally(() => {
    botmgr.startAll().then((rs) => {
      const ok = rs.filter((x) => x.ok).length;
      if (rs.length) console.log(`[bot] 多机器人启动：成功 ${ok}/${rs.length}`);
    }).catch(() => {});
  });
  
}

function shutdown() {
  try { bot.stopBot().catch(() => {}); } catch { /* ignore */ }
  console.log('[tgproxy] shutting down...');
  stopCollector();
  mtg.stopAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch((e) => { console.error(e); process.exit(1); });
