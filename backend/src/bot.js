/**
 * Telegram 机器人
 *
 * 特性：
 *   - 长轮询 / Webhook 双模式（无需任何依赖，纯 HTTP 调用 Telegram Bot API）
 *   - /start 自动注册并绑定平台账号，发放初始额度
 *   - 一键创建代理、查看链接与二维码、查看流量、每日签到领流量、邀请奖励
 *   - 所有文案、按钮、配额规则均可在后台配置
 */
import { db, getSettings, getSetting, getSettingNum, getSettingBool, setSetting, audit } from './db.js';
import { hashPassword, genSecret } from './crypto.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as mtg from './mtg.js';
import * as billing from './billing.js';
import * as guard from './groupguard.js';
import * as invite from './invite.js';
import * as ai from './ai.js';
import * as emailVerify from './emailverify.js';

const API = 'https://api.telegram.org';

/**
 * 多机器人支持：用 AsyncLocalStorage 传递当前实例上下文
 * 业务代码里的 call()/token() 会自动读取当前实例的 token 与状态，
 * 无需改动任何业务逻辑。
 */
export const botCtx = new AsyncLocalStorage();
export function currentBot() { return botCtx.getStore() || null; }

function ctxState() {
  const c = botCtx.getStore();
  return c?.state || state;
}

const state = {
  running: false,
  mode: null, // polling | webhook
  me: null,
  offset: 0,
  startedAt: null,
  lastError: '',
  lastUpdateAt: null,
  counters: { updates: 0, messages: 0, commands: 0, errors: 0 },
  timer: null,
  abort: null,
};

export function botState() {
  // 统计信息实时从数据库计算（不分机器人实例，全平台口径）
  let stats = { total: 0, today: 0, active7: 0, signinToday: 0 };
  try {
    const q = (sql) => {
      const r = db.prepare(sql).get();
      return r ? Number(Object.values(r)[0]) || 0 : 0;
    };
    stats = {
      total: q('SELECT COUNT(*) AS c FROM bot_users'),
      today: q("SELECT COUNT(*) AS c FROM bot_users WHERE date(created_at) = date('now')"),
      active7: q("SELECT COUNT(DISTINCT tg_id) AS c FROM bot_users WHERE date(created_at) >= date('now','-7 days')"),
      signinToday: 0,
    };
  } catch { /* 表不存在时忽略 */ }
  return {
    running: state.running,
    mode: state.mode,
    me: state.me,
    startedAt: state.startedAt,
    lastError: state.lastError,
    lastUpdateAt: state.lastUpdateAt,
    counters: { ...state.counters },
    stats,
  };
}

/** 统计数据（供多机器人管理器复用） */
export function botStats() {
  return botState().stats;
}

function token() {
  const c = botCtx.getStore();
  if (c?.token) return String(c.token).trim();
  return getSetting('bot_token').trim();
}

/**
 * 生成可用模型列表文本
 */
function buildModelListText(tgId) {
  const models = ai.listAvailableModels();
  if (!models.length) {
    return '⚠️ 管理员还没有配置任何 AI 模型。\n请联系管理员在后台「AI 助手 → 模型配置」添加。';
  }
  const cur = ai.getUserModel(tgId);
  const lines = ['🤖 <b>可用模型</b>', ''];

  models.forEach((m, i) => {
    const isCur = cur ? (cur.configId === m.configId) : m.isDefault;
    const badge = isCur ? ' ✅' : '';
    const dflt = m.isDefault ? ' <i>(默认)</i>' : '';
    // 只显示配置名和模型名，绝不显示账号
    lines.push(`${i + 1}. <code>${esc(m.model)}</code>${badge}${dflt}`);
  });

  lines.push('');
  if (cur) {
    lines.push(`当前使用：<code>${esc(cur.model)}</code>`);
  } else {
    const d = models.find((m) => m.isDefault);
    lines.push(`当前使用：<code>${esc(d ? d.model : models[0].model)}</code>（系统默认）`);
  }
  lines.push('');
  lines.push('切换：<code>@机器人 切换模型 模型名称</code>');
  lines.push('恢复默认：<code>@机器人 切换模型 默认</code>');
  return lines.join('\n');
}

/**
 * 为用户切换模型
 */
function switchModelForUser(tgId, want) {
  if (!want) {
    return { ok: false, text: '请指定模型名称，例如：切换模型 deepseek-v4.1-flash' };
  }
  // 恢复默认
  if (/^(默认|default|reset|自动)$/i.test(want)) {
    ai.resetUserModel(tgId);
    const dflt = ai.getDefaultAiConfig();
    return { ok: true, text: `✅ 已恢复使用系统默认模型${dflt ? `：<code>${esc(dflt.model)}</code>` : ''}` };
  }

  const models = ai.listAvailableModels();
  if (!models.length) {
    return { ok: false, text: '⚠️ 管理员还没有配置任何 AI 模型。' };
  }

  // 精确匹配 → 忽略大小写 → 模糊包含
  let hit = models.find((m) => m.model === want);
  if (!hit) hit = models.find((m) => m.model.toLowerCase() === want.toLowerCase());
  if (!hit) {
    const fuzzy = models.filter((m) => m.model.toLowerCase().includes(want.toLowerCase()) || m.label.toLowerCase().includes(want.toLowerCase()));
    if (fuzzy.length === 1) hit = fuzzy[0];
    else if (fuzzy.length > 1) {
      const names = fuzzy.slice(0, 8).map((m) => `<code>${esc(m.model)}</code>`).join('、');
      return { ok: false, text: `找到多个匹配的模型：\n${names}\n\n请写完整名称。` };
    }
  }

  if (!hit) {
    const top = models.slice(0, 6).map((m) => `<code>${esc(m.model)}</code>`).join('、');
    return { ok: false, text: `❌ 没有找到模型「${esc(want)}」\n\n可用模型（部分）：${top}\n\n发送「所有模型」查看完整列表。` };
  }

  ai.setUserModel(tgId, hit.model, hit.configId);
  // 切换模型后清空上下文，避免格式冲突
  const inst = currentBot();
  ai.clearHistory(inst?.botId || 1, null, tgId);
  return {
    ok: true,
    text: `✅ 已切换到 <code>${esc(hit.model)}</code>\n\n现在开始，你的提问会由该模型回答。\n（对话上下文已重置）`,
  };
}

/** 发送图片（multipart/form-data） */
async function sendPhoto(chatId, photo, replyTo) {
  const t = token();
  if (!t) throw new Error('未配置机器人 Token');
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('photo', new Blob([photo.buffer], { type: 'image/jpeg' }), photo.filename || 'shot.jpg');
  if (replyTo) {
    form.append('reply_to_message_id', String(replyTo));
    form.append('allow_sending_without_reply', 'true');
  }
  const res = await fetch(`${API}/bot${t}/sendPhoto`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error('sendPhoto: ' + (data.description || res.status));
  return data.result;
}

async function call(method, payload = {}) {
  const t = token();
  if (!t) throw new Error('未配置机器人 Token');
  const res = await fetch(`${API}/bot${t}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(35000),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const desc = data.description || `HTTP ${res.status}`;
    throw new Error(`${method}: ${desc}`);
  }
  return data.result;
}

export async function getChat(chatId) {
  return call('getChat', { chat_id: chatId });
}

export async function getMe() {
  return call('getMe');
}

/** 设置命令菜单（等效于在 BotFather 中 /setcommands） */
function normalizeCmds(cmds) {
  return (cmds || [])
    .filter((c) => c && c.command && c.description)
    .map((c) => ({
      command: String(c.command).replace(/^\//, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32),
      description: String(c.description).slice(0, 256),
    }))
    .filter((c) => c.command)
    .slice(0, 100);
}

/**
 * 设置命令菜单（分作用域，群内输入 / 才会弹出）
 *   private — 私聊
 *   group   — 所有群组与频道
 *   admins  — 群管理员专属（可选）
 */
export async function setCommands({ private: priv, group, admins } = {}) {
  const result = {};
  if (Array.isArray(priv)) {
    const commands = normalizeCmds(priv);
    await call('setMyCommands', { commands, scope: { type: 'all_private_chats' } });
    result.private = commands;
  }
  if (Array.isArray(group)) {
    const commands = normalizeCmds(group);
    await call('setMyCommands', { commands, scope: { type: 'all_group_chats' } });
    result.group = commands;
  }
  if (Array.isArray(admins)) {
    const commands = normalizeCmds(admins);
    if (commands.length) await call('setMyCommands', { commands, scope: { type: 'all_chat_administrators' } });
    else await call('deleteMyCommands', { scope: { type: 'all_chat_administrators' } }).catch(() => {});
    result.admins = commands;
  }
  return result;
}

/** 读取当前各作用域的命令 */
export async function getCommands() {
  const out = {};
  try { out.private = await call('getMyCommands', { scope: { type: 'all_private_chats' } }); } catch { out.private = []; }
  try { out.group = await call('getMyCommands', { scope: { type: 'all_group_chats' } }); } catch { out.group = []; }
  try { out.admins = await call('getMyCommands', { scope: { type: 'all_chat_administrators' } }); } catch { out.admins = []; }
  try { out.default = await call('getMyCommands'); } catch { out.default = []; }
  return out;
}

// ---------------------------------------------------------------
// 数据
// ---------------------------------------------------------------
function today() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }

export function getBotUser(tgId) {
  return db.prepare('SELECT * FROM bot_users WHERE tg_id = ?').get(String(tgId));
}

/** 确保平台账号 + 机器人用户存在 */
export async function ensureBotUser(msg) {
  const from = msg.from || {};
  const tgId = String(from.id);
  let bu = getBotUser(tgId);

  if (!bu) {
    const baseQuota = getSettingNum('bot_default_quota_mb') || 1024;
    // 需要邮箱验证时，先不发放额度，验证通过后再发
    const grantNow = !needsEmailVerify();
    let platformUser = db.prepare("SELECT * FROM users WHERE note = ?").get(`telegram:${tgId}`);
    if (!platformUser && getSettingBool('bot_auto_register')) {
      let username = `tg_${tgId}`;
      if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) username = `tg_${tgId}_${Date.now() % 10000}`;
      const pwd = await hashPassword(`tg_${tgId}_${Math.random().toString(36).slice(2)}`);
      const info = db.prepare(`INSERT INTO users(username, password_hash, role, quota_mb, note, email)
                                VALUES(?, ?, 'user', ?, ?, NULL)`)
        .run(username, pwd, grantNow ? baseQuota : 0, `telegram:${tgId}`);
      platformUser = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
      audit({ id: platformUser.id, username }, '机器人注册', `user:${platformUser.id}`, `Telegram ${tgId}`, 'bot');
    }
    const info = db.prepare(`INSERT INTO bot_users(tg_id, tg_username, tg_first_name, user_id, balance_mb, last_active)
                              VALUES(?,?,?,?,?,datetime('now'))`)
      .run(tgId, from.username || null, from.first_name || null, platformUser?.id || null, grantNow ? baseQuota : 0);
    bu = db.prepare('SELECT * FROM bot_users WHERE id = ?').get(info.lastInsertRowid);
    // 需要邮箱验证时，先进入待验证状态
    if (needsEmailVerify()) {
      db.prepare("UPDATE bot_users SET state = 'await_email' WHERE id = ?").run(bu.id);
      bu = db.prepare('SELECT * FROM bot_users WHERE id = ?').get(bu.id);
    }
  } else {
    db.prepare(`UPDATE bot_users SET tg_username = ?, tg_first_name = ?, last_active = datetime('now') WHERE id = ?`)
      .run(from.username || bu.tg_username, from.first_name || bu.tg_first_name, bu.id);
    bu = getBotUser(tgId);
  }
  return bu;
}

/** 为机器人用户创建平台账号（幂等） */
async function createPlatformUser(bu_or_tgId, from = {}) {
  const tgId = typeof bu_or_tgId === 'object' ? String(bu_or_tgId.tg_id) : String(bu_or_tgId);
  const note = `telegram:${tgId}`;
  const exist = db.prepare('SELECT * FROM users WHERE note = ?').get(note);
  if (exist) return exist;
  // 需要邮箱验证时，额度在验证通过后再发，这里按当前验证状态决定
  const bu = getBotUser(tgId);
  const verified = bu && isEmailVerified(bu);
  const quota = (needsEmailVerify() && !verified) ? 0 : (getSettingNum('bot_default_quota_mb') || 1024);
  let username = `tg_${tgId}`;
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) username = `tg_${tgId}_${Date.now() % 100000}`;
  const pwd = await hashPassword(`tg_${tgId}_${Math.random().toString(36).slice(2)}`);
  const info = db.prepare(`INSERT INTO users(username, password_hash, role, quota_mb, note, email)
                            VALUES(?, ?, 'user', ?, ?, ?)`)
    .run(username, pwd, quota, note, bu?.email && bu.email_verified ? bu.email : null);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  if (bu) db.prepare('UPDATE bot_users SET user_id = ? WHERE tg_id = ?').run(user.id, tgId);
  audit({ id: user.id, username }, '机器人注册', `user:${user.id}`, `Telegram ${tgId}`, 'bot');
  return user;
}

/** 机器人注册是否需要邮箱验证（需同时满足：开关开启 + 邮件服务可用） */
function needsEmailVerify() {
  return getSettingBool('bot_require_email') && emailVerify.isMailReady();
}

/** 邮箱是否已验证通过 */
function isEmailVerified(bu) {
  if (!needsEmailVerify()) return true;
  return bu.state !== 'await_email' && bu.state !== 'await_code' && !!bu.email;
}

function platformUserOf(bu) {
  return bu?.user_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(bu.user_id) : null;
}

// ---------------------------------------------------------------
// 文案
// ---------------------------------------------------------------
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderTpl(text, vars = {}) {
  const site = { site: getSetting('site_name'), ...vars };
  return String(text || '').replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_, k) => esc(site[k] ?? ''));
}

function fmtMb(mb) {
  mb = Number(mb) || 0;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
}

const BOT_RESET = '\\/';

// ---------------------------------------------------------------
// 菜单
// ---------------------------------------------------------------
function mainMenu(bu) {
  const s = getSettings();
  const style = s.bot_button_style === 'reply' ? 'reply' : 'inline';
  const rows = [];
  if (style === 'inline') {
    if (bu && !isEmailVerified(bu)) {
      rows.push([{ text: '📝 注册 / 验证邮箱', callback_data: 'email:start' }]);
    }
    const buttons = db.prepare("SELECT * FROM bot_buttons WHERE parent = 'main' AND active = 1 ORDER BY sort, id").all();
    let row = [];
    for (const b of buttons) {
      row.push({ text: b.label, callback_data: `${b.action}:${b.payload || ''}` });
      if (row.length === 2) { rows.push(row); row = []; }
    }
    if (row.length) rows.push(row);
    return { inline_keyboard: rows };
  }
  const needReg = bu && !isEmailVerified(bu);
  return {
    keyboard: [
      ...(needReg ? [[{ text: '📝 注册 / 验证邮箱' }]] : []),
      [{ text: '🚀 创建代理' }, { text: '📋 我的代理' }],
      [{ text: '📊 我的流量' }, { text: '🎁 每日签到' }],
      [{ text: '🎉 邀请赚流量' }, { text: '❓ 帮助' }],
    ],
    resize_keyboard: true,
  };
}

function accountMenu(accId) {
  return {
    inline_keyboard: [
      [{ text: '🔗 获取链接', callback_data: `acc:link:${accId}` }, { text: '🔄 重置密钥', callback_data: `acc:rotate:${accId}` }],
      [{ text: '⏸ 停用', callback_data: `acc:off:${accId}` }, { text: '▶️ 启用', callback_data: `acc:on:${accId}` }],
      [{ text: '🗑 删除代理', callback_data: `acc:del:${accId}` }],
      [{ text: '« 返回主菜单', callback_data: 'menu' }],
    ],
  };
}

// ---------------------------------------------------------------
// 处理
// ---------------------------------------------------------------
async function send(chatId, text, keyboard, extra = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: getSetting('bot_parse_mode') || 'HTML',
    reply_markup: keyboard,
    disable_web_page_preview: true,
    ...extra,
  });
}

async function answerCallback(id, text = '') {
  return call('answerCallbackQuery', { callback_query_id: id, text }).catch(() => {});
}

async function editOrSend(chatId, messageId, text, keyboard) {
  if (messageId) {
    try {
      await call('editMessageText', {
        chat_id: chatId, message_id: messageId, text,
        parse_mode: getSetting('bot_parse_mode') || 'HTML', reply_markup: keyboard,
      });
      return;
    } catch { /* 退回发送新消息 */ }
  }
  await send(chatId, text, keyboard);
}

function recordCommand(tgId, command, payload) {
  if (!getSettingBool('bot_log_commands')) return;
  try {
    db.prepare('INSERT INTO bot_commands(tg_id, command, payload) VALUES(?,?,?)').run(String(tgId), command, payload || '');
  } catch { /* ignore */ }
}

function isAdminTg(tgId) {
  const ids = String(getSetting('bot_admin_ids') || '').split(/[,\s]+/).filter(Boolean);
  return ids.includes(String(tgId));
}

/** 给机器人用户开通一个代理 */
async function createAccount(bu) {
  let pu = platformUserOf(bu);
  // 未绑定平台账号 -> 若允许注册则补建
  if (!pu && getSettingBool('bot_auto_register')) {
    pu = await createPlatformUser(bu, {});
    bu = getBotUser(bu.tg_id) || bu;
  }
  if (!pu) {
    const needReg = needsEmailVerify() && !isEmailVerified(bu);
    return {
      ok: false,
      msg: needReg
        ? '请先完成注册：点击菜单中的「📝 注册 / 验证邮箱」'
        : '账号尚未开通：请先点击菜单中的「📝 注册 / 验证邮箱」完成注册',
    };
  }
  const max = getSettingNum('bot_max_accounts') || 3;
  const cnt = db.prepare('SELECT COUNT(*) AS c FROM accounts WHERE user_id = ?').get(pu.id).c;
  if (max > 0 && cnt >= max) return { ok: false, msg: `每人最多创建 ${max} 个代理` };

  // 额度来源：独立余额 或 平台账户额度
  const usePool = (getSetting('bot_quota_mode') || 'pool') === 'pool';
  let quota = getSettingNum('bot_default_quota_mb') || 1024;
  if (usePool) {
    const used = db.prepare('SELECT COALESCE(SUM(quota_mb),0) AS q FROM accounts WHERE user_id = ?').get(pu.id).q;
    const remain = pu.quota_mb - used;
    if (remain <= 0) return { ok: false, msg: '剩余额度不足，先去签到或联系管理员充值' };
    quota = Math.min(quota, remain);
  } else {
    const bal = Number(bu.balance_mb) || 0;
    if (bal < 1) return { ok: false, msg: '余额不足，先签到领流量吧～' };
    quota = Math.min(quota, bal);
  }

  const node = db.prepare("SELECT * FROM nodes WHERE status = 'online' ORDER BY sort, id LIMIT 1").get();
  if (!node) return { ok: false, msg: '暂无可用节点' };

  const port = mtg.findFreePort(node.id);
  const secret = genSecret();
  const days = getSettingNum('bot_account_days');
  const expires = days > 0 ? new Date(Date.now() + days * 86400000).toISOString().replace('T', ' ').slice(0, 19) : null;
  // 名称带序号，方便区分（如：代理1、代理2）
  const seq = cnt + 1;
  const base = bu.tg_username || `用户${bu.tg_id}`;
  const name = `代理${seq}·${base}`.slice(0, 60);
  const info = db.prepare(`INSERT INTO accounts(user_id, node_id, name, secret, port, quota_mb, status, expires_at, remark)
                            VALUES(?,?,?,?,?,?, 'active', ?, ?)`)
    .run(pu.id, node.id, name, secret, port, quota, expires, 'telegram-bot');
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid);
  await mtg.startAccount(acc);

  if (!usePool) {
    db.prepare('UPDATE bot_users SET balance_mb = balance_mb - ? WHERE id = ?').run(quota, bu.id);
  }
  audit({ id: pu.id, username: pu.username }, '机器人创建代理', `account:${acc.id}`, `端口 ${port}`, 'bot');
  return { ok: true, acc };
}

async function handleStart(msg) {
  const bu = await ensureBotUser(msg);
  const chatId = msg.chat.id;
  const pu = platformUserOf(bu);
  recordCommand(bu.tg_id, '/start', '');

  const welcome = renderTpl(getSetting('bot_welcome'), {
    name: bu.tg_first_name || bu.tg_username || '朋友',
    quota: fmtMb(pu?.quota_mb ?? bu.balance_mb),
    id: bu.tg_id,
  });
  const needReg = !isEmailVerified(bu);
  await send(chatId, needReg
    ? `${welcome}\n\n📝 <i>你还未完成注册，请点击下方「注册 / 验证邮箱」完成邮箱验证，即可领取初始额度。</i>`
    : welcome, mainMenu(bu));

  // 邀请码绑定（/start <code>）
  const parts = String(msg.text || '').trim().split(/\s+/);
  const invCode = parts[1] || '';
  if (invCode && getSettingBool('bot_ref_enabled')) {
    const r = invite.bindInvite(bu, invCode);
    if (r.ok) {
      if (r.reason === 'confirmed') {
        const g = invite.grantReward(r.recordId);
        if (g) {
          try {
            await send(chatId, '🎁 感谢通过好友邀请加入！已为你绑定邀请关系。');
            const inviterBu = getBotUser(g.inviterTg);
            await send(g.inviterTg, `🎉 <b>邀请奖励到账</b>\n\n好友 <b>${esc(bu.tg_first_name || bu.tg_username || '新用户')}</b> 已通过你的链接加入，你获得 <b>${fmtMb(g.reward)}</b> 流量！`, mainMenu(inviterBu));
          } catch { /* ignore */ }
        }
      } else if (r.reason === 'pending') {
        try { await send(chatId, '🎁 已绑定邀请关系！完成每日签到后，你的好友将获得奖励。'); } catch { /* ignore */ }
      }
    }
  }
}

async function handleSignin(chatId, bu) {
  if (!getSettingBool('bot_signin_enabled')) {
    await send(chatId, '签到功能暂未开放', mainMenu(bu));
    return;
  }
  const t = today();
  if (bu.last_signin === t) {
    await send(chatId, `今天已经签到过啦 ✅\n连续签到 <b>${bu.signin_streak}</b> 天\n明天再来吧～`, mainMenu(bu));
    return;
  }
  const base = getSettingNum('bot_signin_quota_mb') || 512;
  const bonusOn = getSettingBool('bot_signin_streak_bonus');
  const maxStreak = getSettingNum('bot_signin_streak_max') || 7;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let streak = 1;
  if (bu.last_signin === yesterday) streak = Math.min(maxStreak, (bu.signin_streak || 0) + 1);
  const gain = bonusOn ? base * Math.min(streak, maxStreak) : base;

  db.prepare('UPDATE bot_users SET balance_mb = balance_mb + ?, last_signin = ?, total_signin = total_signin + 1, signin_streak = ? WHERE id = ?')
    .run(gain, t, streak, bu.id);
  // 同步到平台额度（共享池模式）
  const pu = platformUserOf(bu);
  if (pu && (getSetting('bot_quota_mode') || 'pool') === 'pool') {
    db.prepare('UPDATE users SET quota_mb = quota_mb + ? WHERE id = ?').run(gain, pu.id);
  }
  recordCommand(bu.tg_id, '/signin', '');
  // 被邀请人首次活跃 -> 确认邀请奖励
  try {
    const conf = invite.tryConfirmInvite(bu.tg_id);
    if (conf) {
      const inviterBu = getBotUser(conf.inviterTg);
      await send(conf.inviterTg, `🎉 <b>邀请奖励到账</b>\n\n你邀请的用户已完成验证，获得 <b>${fmtMb(conf.reward)}</b> 流量！`, mainMenu(inviterBu)).catch(() => {});
    }
  } catch { /* ignore */ }
  await send(chatId, [
    '🎁 <b>签到成功</b>',
    '',
    `获得流量：<b>+${fmtMb(gain)}</b>`,
    `连续签到：<b>${streak}</b> 天${bonusOn ? `（最高 ${maxStreak} 倍奖励）` : ''}`,
    `累计签到：<b>${bu.total_signin + 1}</b> 次`,
  ].join('\n'), mainMenu(bu));
}

async function showUsage(chatId, bu) {
  let pu = platformUserOf(bu);
  if (!pu && getSettingBool('bot_auto_register')) { pu = await createPlatformUser(bu, {}); }
  if (!pu) {
    await send(chatId, '账号尚未开通，请点击菜单中的「📝 注册 / 验证邮箱」完成注册', mainMenu(getBotUser(bu.tg_id) || bu));
    return;
  }
  const accs = db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY id DESC').all(pu.id);
  const used = accs.reduce((s, a) => s + a.used_bytes, 0);
  const totalQuota = accs.reduce((s, a) => s + a.quota_mb, 0);
  const lines = [
    '📊 <b>我的流量</b>',
    '',
    `平台额度：<b>${fmtMb(pu.quota_mb)}</b>`,
    `余额：<b>${fmtMb(bu.balance_mb)}</b>`,
    `已分配：<b>${fmtMb(totalQuota)}</b>`,
    `已使用：<b>${fmtMb(used / 1024 / 1024)}</b>`,
    `代理数量：<b>${accs.length}</b>`,
    `连续签到：<b>${bu.signin_streak}</b> 天`,
  ];
  await send(chatId, lines.join('\n'), mainMenu(bu));
}

async function listAccounts(chatId, bu) {
  const pu = platformUserOf(bu);
  const accs = pu ? db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY id DESC').all(pu.id) : [];
  if (!accs.length) {
    await send(chatId, '你还没有代理，点击下方按钮创建 👇', mainMenu(bu));
    return;
  }
  const lines = ['📋 <b>我的代理</b>', ''];
  for (const a of accs) {
    const st = mtg.accountState(a);
    const label = { running: '🟢 运行中', stopped: '⚪️ 已停止', disabled: '⏸ 已停用', expired: '🔴 已到期', exhausted: '🔴 流量用尽' }[st] || st;
    lines.push(`<b>${esc(a.name)}</b> · ${label}`);
    lines.push(`端口 <code>${a.port}</code> · 已用 ${fmtMb(a.used_bytes / 1024 / 1024)} / ${fmtMb(a.quota_mb)}`);
    lines.push('');
  }
  const kb = { inline_keyboard: accs.slice(0, 5).map((a) => [{ text: `⚙️ ${a.name}（端口 ${a.port}）`.slice(0, 44), callback_data: `acc:view:${a.id}` }]) };
  kb.inline_keyboard.push([{ text: '« 返回主菜单', callback_data: 'menu' }]);
  await send(chatId, lines.join('\n'), kb);
}

async function showAccount(chatId, bu, accId, messageId) {
  const pu = platformUserOf(bu);
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(accId));
  if (!acc || acc.user_id !== pu?.id) {
    await editOrSend(chatId, messageId, '代理不存在或无权访问', mainMenu(bu));
    return;
  }
  const st = mtg.accountState(acc);
  const label = { running: '🟢 运行中', stopped: '⚪️ 已停止', disabled: '⏸ 已停用', expired: '🔴 已到期', exhausted: '🔴 流量用尽' }[st] || st;
  const text = [
    `🔧 <b>${esc(acc.name)}</b>`,
    '',
    `状态：${label}`,
    `端口：<code>${acc.port}</code>`,
    `流量：${fmtMb(acc.used_bytes / 1024 / 1024)} / ${fmtMb(acc.quota_mb)}`,
    acc.expires_at ? `到期：${acc.expires_at}` : '到期：长期有效',
  ].join('\n');
  await editOrSend(chatId, messageId, text, accountMenu(acc.id));
}

async function sendLink(chatId, bu, accId, messageId) {
  if (!getSettingBool('bot_show_link')) {
    await editOrSend(chatId, messageId, getSetting('bot_disable_link_msg'), mainMenu(bu));
    return;
  }
  const pu = platformUserOf(bu);
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(accId));
  if (!acc || acc.user_id !== pu?.id) { await editOrSend(chatId, messageId, '代理不存在', mainMenu(bu)); return; }
  const links = mtg.genClientLinks(acc);
  const std = links.variants.standard;
  const text = [
    '🔗 <b>代理链接</b>',
    '',
    `服务器：<code>${links.ip}</code>`,
    `端口：<code>${links.port}</code>`,
    `密钥：<code>${links.secret}</code>`,
    '',
    '点击下方按钮即可导入 Telegram 👇',
  ].join('\n');
  const kb = { inline_keyboard: [[{ text: '✈️ 一键导入 Telegram', url: std.tme }]] };
  if (getSettingBool('bot_show_qrcode')) {
    kb.inline_keyboard.push([{ text: '📷 查看二维码', callback_data: `acc:qr:${acc.id}` }]);
  }
  kb.inline_keyboard.push([{ text: '« 返回', callback_data: `acc:view:${acc.id}` }]);
  await editOrSend(chatId, messageId, text, kb);
}

async function sendQr(chatId, bu, accId) {
  const pu = platformUserOf(bu);
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(accId));
  if (!acc || acc.user_id !== pu?.id) return;
  const links = mtg.genClientLinks(acc);
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(links.variants.standard.tme)}`;
  try {
    await call('sendPhoto', { chat_id: chatId, photo: url, caption: `📷 ${esc(acc.name)} 的代理二维码\n用 Telegram 扫一扫即可连接` });
  } catch {
    await send(chatId, '二维码生成失败，请直接使用链接导入', mainMenu(bu));
  }
}

async function handleInvite(chatId, bu) {
  if (!getSettingBool('bot_ref_enabled')) {
    await send(chatId, '邀请活动暂未开放', mainMenu(bu));
    return;
  }
  // 未完成注册时先引导注册
  if (!isEmailVerified(bu)) {
    await send(chatId, '📝 请先完成注册（邮箱验证），开通账号后即可邀请好友赚流量。\n点击下方「注册 / 验证邮箱」开始。', {
      inline_keyboard: [[{ text: '📝 注册 / 验证邮箱', callback_data: 'email:start' }], [{ text: '« 返回菜单', callback_data: 'menu' }]],
    });
    return;
  }
  const card = invite.inviteCard(bu);
  const kb = { inline_keyboard: [] };
  if (card.url) {
    kb.inline_keyboard.push([{ text: '📤 分享邀请链接', url: `https://t.me/share/url?url=${encodeURIComponent(card.url)}&text=${encodeURIComponent('一起来用 Telegram 代理，免费送流量！')}` }]);
  }
  kb.inline_keyboard.push([{ text: '📋 复制邀请码', callback_data: `ref:code:${card.code}` }]);
  kb.inline_keyboard.push([{ text: '📊 邀请记录', callback_data: 'ref:stats' }, { text: '« 主菜单', callback_data: 'menu' }]);
  recordCommand(bu.tg_id, '/invite', '');
  await send(chatId, `${card.text}\n\n🔗 <code>${card.url || card.code}</code>`, kb);
}

async function handleInviteStats(chatId, bu) {
  const st = invite.inviteStats(bu.tg_id);
  if (!st.list.length) {
    await send(chatId, '📊 你还没有邀请记录，快去分享链接吧～', { inline_keyboard: [[{ text: '🎉 获取邀请链接', callback_data: 'ref:invite' }], [{ text: '« 主菜单', callback_data: 'menu' }]] });
    return;
  }
  const lines = ['📊 <b>邀请记录</b>', '', `已成功：<b>${st.rewarded}</b> 人 · 累计 <b>${fmtMb(st.totalMb)}</b>`, ''];
  for (const r of st.list) {
    const label = r.status === 'rewarded' ? '✅ 已奖励' : r.status === 'pending' ? '⏳ 待确认' : '❌ 未达标';
    lines.push(`${label} · ${esc(r.invitee_name || r.invitee_tg_id)} · ${(r.created_at || '').slice(0, 10)}`);
  }
  await send(chatId, lines.join('\n'), { inline_keyboard: [[{ text: '« 返回', callback_data: 'ref:invite' }]] });
}

/** 邮箱验证对话（状态机） */
async function handleEmailFlow(chatId, bu, text) {
  const t = (text || '').trim();

  // /start 打断邮箱流程 -> 回到菜单
  if (t === '/start') return false;

  // 等待输入邮箱
  if (bu.state === 'await_email') {
    if (!emailVerify.isValidEmail(t)) {
      await send(chatId, '📧 邮箱格式不正确，请重新输入，例如 name@example.com');
      return true;
    }
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(t.toLowerCase())) {
      await send(chatId, '该邮箱已被其他账号绑定，请换一个邮箱');
      return true;
    }
    try {
      const r = await emailVerify.sendCode(t, `tg_${bu.tg_id}`, 'bot');
      db.prepare("UPDATE bot_users SET state = 'await_code', email = ? WHERE id = ?").run(t.toLowerCase(), bu.id);
      await send(chatId, [
        `✅ 验证码已发送至 <b>${r.masked}</b>`,
        '',
        `请直接发送 <b>${r.ttl} 分钟内</b>收到的验证码给我。`,
        '（验证码为纯数字，直接发送即可）',
      ].join('\n'), { inline_keyboard: [[{ text: '🔁 重新发送', callback_data: 'email:resend' }], [{ text: '✏️ 换个邮箱', callback_data: 'email:change' }]] });
    } catch (e) {
      await send(chatId, `❌ ${e.message}\n\n请稍后重试，或点击下方「✏️ 换个邮箱」。`, {
        inline_keyboard: [[{ text: '🔁 重新发送', callback_data: 'email:resend' }], [{ text: '✏️ 换个邮箱', callback_data: 'email:change' }]],
      });
    }
    return true;
  }

  // 等待输入验证码
  if (bu.state === 'await_code') {
    if (!/^\d{4,10}$/.test(t)) {
      await send(chatId, '请输入收到的纯数字验证码，或点击下方按钮重新发送', {
        inline_keyboard: [[{ text: '🔁 重新发送', callback_data: 'email:resend' }], [{ text: '✏️ 换个邮箱', callback_data: 'email:change' }]],
      });
      return true;
    }
    try {
      emailVerify.verifyCode(bu.email, t, 'bot');
      db.prepare("UPDATE bot_users SET state = NULL, email_verified = 1 WHERE id = ?").run(bu.id);
      // 绑定邮箱到平台账号
      if (bu.user_id) {
        try { db.prepare('UPDATE users SET email = ? WHERE id = ? AND (email IS NULL OR email = ?)').run(bu.email, bu.user_id, ''); } catch { /* ignore */ }
      }
      // 验证通过 -> 若还没有平台账号则创建（此时才真正注册）
      let user = bu.user_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(bu.user_id) : null;
      if (!user) {
        user = await createPlatformUser(bu, {});
        db.prepare('UPDATE bot_users SET user_id = ? WHERE id = ?').run(user.id, bu.id);
      }
      // 发放注册额度
      const baseQuota = getSettingNum('bot_default_quota_mb') || 1024;
      db.prepare('UPDATE bot_users SET balance_mb = balance_mb + ? WHERE id = ?').run(baseQuota, bu.id);
      if ((getSetting('bot_quota_mode') || 'pool') === 'pool') {
        db.prepare('UPDATE users SET quota_mb = quota_mb + ? WHERE id = ?').run(baseQuota, user.id);
      }
      const fresh = getBotUser(bu.tg_id);
      const pu = platformUserOf(fresh);
      await send(chatId, [
        '🎉 <b>邮箱验证成功！</b>',
        '',
        `邮箱：<b>${esc(bu.email)}</b>`,
        `初始额度：<b>${fmtMb(pu?.quota_mb ?? fresh.balance_mb)}</b>`,
        '',
        '现在可以使用全部功能啦 👇',
      ].join('\n'), mainMenu(bu));
      recordCommand(bu.tg_id, 'email_verified', bu.email);
    } catch (e) {
      await send(chatId, `❌ ${e.message}`, {
        inline_keyboard: [[{ text: '🔁 重新发送', callback_data: 'email:resend' }], [{ text: '✏️ 换个邮箱', callback_data: 'email:change' }]],
      });
    }
    return true;
  }
  return false;
}

/** /id：显示用户 ID、本群 ID（如为群聊）与权限提示 */
async function handleId(msg, chatId, bu) {
  const lines = [
    '🆔 <b>你的 Telegram ID</b>',
    '',
    `<code>${bu.tg_id}</code>`,
    '',
    bu.tg_username ? `用户名：@${esc(bu.tg_username)}` : '',
  ].filter(Boolean);
  if (['group', 'supergroup', 'channel'].includes(msg.chat?.type)) {
    lines.push('', '👥 <b>当前群组 ID</b>', `<code>${msg.chat.id}</code>`);
    if (msg.chat.title) lines.push(`群名：${esc(msg.chat.title)}`);
    lines.push('', '<i>把群组 ID 复制到后台「群组管理 → 群组列表」即可手动添加</i>');
  }
  lines.push('', '<i>点击上方 ID 即可复制</i>');
  await send(chatId, lines.join('\n'));
}

/**
 * 群管理命令：/ban /mute /unmute
 * 用法：回复某人消息后发送，或 /mute @username 30m
 * 时长：30m（分钟，默认）/ 2h / 1d / forever
 */
async function handleModCommand(msg, chatId, cmd, raw) {
  const reply = async (text) => {
    try { await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_to_message_id: msg.message_id }); } catch { /* ignore */ }
  };

  // 1) 权限校验：后台白名单优先，其次才是群内管理员身份
  let allowed = false;
  let right = { ok: false };
  if (isAdminTg(msg.from.id)) {
    allowed = true; // 后台配置的机器人管理员，任何群都能用
  } else {
    right = await guard.checkManageRight(call, chatId, msg.from.id);
    allowed = right.ok;
  }
  if (!allowed) {
    await reply([
      '❌ <b>只有群主或管理员可以使用该命令</b>',
      '',
      `你的 ID：<code>${msg.from.id}</code>`,
      '如果你是机器人管理员，可在后台「机器人配置 → 运营配置 → 管理员 Telegram ID」中添加你的 ID。',
    ].join('\n'));
    recordCommand(msg.from.id, cmd, 'denied');
    return;
  }

  // 2) 确定目标用户
  let target = msg.reply_to_message?.from;
  const args = raw.split(/\s+/).slice(1);
  const usernameArg = args.find((a) => a.startsWith('@') && a.length > 1);
  const durationArg = args.find((a) => /^(\d+\s*(s|m|h|d|秒|分|时|天)|forever|permanent|永久|∞)$/i.test(a));

  if (!target && usernameArg) {
    // 通过 @username 查不到 ID（Bot API 不支持），只能查缓存
    const uname = usernameArg.slice(1).toLowerCase();
    const cached = db.prepare('SELECT * FROM group_members WHERE chat_id = ? AND lower(name) = ?').get(String(chatId), uname);
    if (cached) target = { id: Number(cached.tg_id), username: cached.name, first_name: cached.name };
  }
  if (!target) {
    await reply([
      '❓ <b>请指定要处理的用户</b>',
      '',
      '用法：<b>回复某人的消息</b>，然后发送该命令',
      '',
      ...(cmd === '/mute' ? [
        '<code>/mute 30m</code> — 禁言 30 分钟',
        '<code>/mute 2h</code> — 禁言 2 小时',
        '<code>/mute 1d</code> — 禁言 1 天',
        '<code>/mute forever</code> — 永久禁言',
      ] : cmd === '/unmute' ? [
        '<code>/unmute</code> — 解除禁言（无需时长参数）',
      ] : cmd === '/kick' ? [
        '<code>/kick</code> — 移出群组（可再次加入）',
      ] : [
        '<code>/ban</code> — 封禁（无法再加入）',
      ]),
      '',
      '（Telegram 机器人无法通过 @用户名 直接查到 ID，回复消息最可靠）',
    ].join('\n'));
    return;
  }

  // 3) 越权校验（后台管理员视为最高权限）
  const mod = await guard.canModerate(call, chatId, msg.from.id, target.id, isAdminTg(msg.from.id));
  if (!mod.ok) { await reply(`❌ ${mod.reason}`); return; }

  const name = esc(target.username ? '@' + target.username : (target.first_name || target.id));

  // 4) 执行
  if (cmd === '/ban' || cmd === '/kick') {
    try {
      await call('banChatMember', { chat_id: chatId, user_id: target.id });
      if (cmd === '/kick') await call('unbanChatMember', { chat_id: chatId, user_id: target.id, only_if_banned: true });
      // 清理其消息（可选：删除本条命令）
      try { await call('deleteMessage', { chat_id: chatId, message_id: msg.message_id }); } catch { /* ignore */ }
      await call('sendMessage', {
        chat_id: chatId,
        text: `🚫 <b>${name}</b> 已被${cmd === '/kick' ? '移出群组' : '封禁'}\n操作人：${esc(msg.from.username ? '@' + msg.from.username : msg.from.first_name || '')}`,
        parse_mode: 'HTML',
      });
      guard.logMod(chatId, target.id, target.username, cmd === '/kick' ? 'man_kick' : 'man_ban',
        `by ${msg.from.id}`);
      recordCommand(msg.from.id, cmd, String(target.id));
    } catch (e) {
      await reply(`❌ 操作失败：${e.message}\n请确认机器人有「封禁用户」权限`);
    }
    return;
  }

  if (cmd === '/mute') {
    const dur = guard.parseDuration(durationArg) || { forever: false, minutes: 30, label: '30 分钟', seconds: 1800 };
    try {
      await call('restrictChatMember', {
        chat_id: chatId,
        user_id: target.id,
        permissions: {
          can_send_messages: false, can_send_audios: false, can_send_documents: false,
          can_send_photos: false, can_send_videos: false, can_send_video_notes: false,
          can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false,
          can_add_web_page_previews: false,
        },
        ...(dur.forever ? {} : { until_date: Math.floor(Date.now() / 1000) + dur.seconds }),
      });
      guard.logMod(chatId, target.id, target.username, 'man_mute', `${dur.label} by ${msg.from.id}`);
      recordCommand(msg.from.id, '/mute', `${target.id} ${dur.label}`);
      await reply(`🔇 <b>${name}</b> 已被禁言\n时长：<b>${dur.label}</b>\n操作人：${esc(msg.from.username ? '@' + msg.from.username : msg.from.first_name || '')}`);
    } catch (e) {
      await reply(`❌ 禁言失败：${e.message}\n请确认机器人有「限制成员」权限`);
    }
    return;
  }

  if (cmd === '/unmute') {
    try {
      await call('restrictChatMember', {
        chat_id: chatId,
        user_id: target.id,
        permissions: {
          can_send_messages: true, can_send_audios: true, can_send_documents: true,
          can_send_photos: true, can_send_videos: true, can_send_video_notes: true,
          can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true,
          can_add_web_page_previews: true, can_invite_users: true,
        },
      });
      guard.logMod(chatId, target.id, target.username, 'man_unmute', `by ${msg.from.id}`);
      recordCommand(msg.from.id, '/unmute', String(target.id));
      await reply(`🔊 <b>${name}</b> 已被解除禁言`);
    } catch (e) {
      await reply(`❌ 操作失败：${e.message}`);
    }
  }
}

async function handleHelp(chatId, bu) {
  const text = getSetting('bot_help') || [
    '❓ <b>使用帮助</b>',
    '',
    '/start — 开始使用',
    '/create — 创建代理',
    '/my — 我的代理',
    '/usage — 查看流量',
    '/signin — 每日签到',
    '/help — 帮助',
    '',
    `客服：${getSetting('support_contact') || '-'}`,
  ].join('\n');
  await send(chatId, text, mainMenu(bu));
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  // 群组消息
  if (['group', 'supergroup', 'channel'].includes(msg.chat.type)) {
    const raw = (msg.text || '').trim();

    // 模型指令（不带 / 也能触发）：所有模型 / 切换模型 xxx
    // 只响应带 @机器人 或在私聊的场合
    const mentionMe = new RegExp(`@${getSetting('bot_username') || 'dailivbot'}`, 'i');
    if (!raw.startsWith('/') && mentionMe.test(raw)) {
      const bare = raw.replace(mentionMe, '').trim();

      // 查看所有可用模型
      if (/^(所有模型|全部模型|模型列表|可用模型|models?)$/i.test(bare)) {
        try {
          await call('sendMessage', { chat_id: chatId, text: buildModelListText(msg.from.id), parse_mode: 'HTML', reply_to_message_id: msg.message_id });
        } catch (e) { console.error('[models]', e.message); }
        return;
      }

      // 切换模型
      const sm = bare.match(/^(?:切换模型|换模型|用模型|switch)\s*[:：]?\s*(.+)$/i);
      if (sm) {
        const r = switchModelForUser(msg.from.id, sm[1].trim());
        try {
          await call('sendMessage', { chat_id: chatId, text: r.text, parse_mode: 'HTML', reply_to_message_id: msg.message_id });
        } catch (e) { console.error('[switch]', e.message); }
        return;
      }
    }

    // 群里的命令：只响应 /id、/help（不触发违禁词检测、不注册用户）
    if (raw.startsWith('/')) {
      const cmd = raw.split(/[\s@]/)[0].toLowerCase();
      // 群内 /help
      if (cmd === '/help') {
        try {
          await call('sendMessage', {
            chat_id: chatId,
            text: [
              '🤖 <b>可用命令</b>',
              '',
              '/id — 查看你的 ID 与本群 ID',
              '/userid — 回复某人消息后查看其 ID 与身份',
              '/rules — 查看本群规则',
              '/help — 显示本帮助',
              '',
              '<b>管理员命令</b>（回复某人消息后使用）',
              '/ban — 封禁并移出',
              '/kick — 仅移出（可再次加入）',
              '/mute 30m — 禁言（支持 30m / 2h / 1d / forever）',
              '/unmute — 解除禁言',
              '',
              '创建代理、签到等请私聊机器人使用。',
            ].join('\n'),
            parse_mode: 'HTML',
            reply_to_message_id: msg.message_id,
          });
        } catch { /* ignore */ }
        return;
      }
      // 群内 /rules
      if (cmd === '/rules') {
        const grp = guard.getGroup(chatId);
        const text = (grp?.welcome_text || '').trim()
          || '本群启用了入群人机验证与违禁内容拦截。\n• 新成员需完成验证\n• 禁止广告、链接、二维码\n• 违者将被删除消息并禁言';
        try { await call('sendMessage', { chat_id: chatId, text, reply_to_message_id: msg.message_id }); } catch { /* ignore */ }
        return;
      }
      // 群内 /userid：回复某人查看其 ID
      if (cmd === '/userid') {
        const target = msg.reply_to_message?.from;
        if (!target) {
          try { await call('sendMessage', { chat_id: chatId, text: '请先回复某人的消息，再发送 /userid', reply_to_message_id: msg.message_id }); } catch { /* ignore */ }
          return;
        }
        let status = '成员';
        try {
          const m = await call('getChatMember', { chat_id: chatId, user_id: target.id });
          status = { creator: '👑 群主', administrator: '⭐ 管理员', member: '👤 成员', restricted: '🚫 受限', left: '已离开', kicked: '已移出' }[m.status] || m.status;
        } catch { /* ignore */ }
        const lines = [
          '🤖 <b>用户信息</b>',
          '',
          `👤 昵称：${esc(target.first_name || '')}${target.last_name ? ' ' + esc(target.last_name) : ''}`,
          target.username ? `🔗 用户名：@${esc(target.username)}` : '🔗 用户名：无',
          `🆔 ID：<code>${target.id}</code>`,
          `✅ 群内身份：${status}`,
        ];
        try { await call('sendMessage', { chat_id: chatId, text: lines.join('\n'), parse_mode: 'HTML', reply_to_message_id: msg.message_id }); } catch { /* ignore */ }
        // 记录到群成员表
        try {
          db.prepare(`INSERT INTO group_members(chat_id, tg_id, name) VALUES(?,?,?)
                      ON CONFLICT(chat_id, tg_id) DO UPDATE SET name = excluded.name, last_seen = datetime('now')`)
            .run(String(chatId), String(target.id), target.username || target.first_name || '');
        } catch { /* ignore */ }
        return;
      }
      // 重置 AI 对话上下文
      if (['/reset', '/clear', '/newchat'].includes(cmd)) {
        const inst = currentBot();
        ai.clearHistory(inst?.botId || 1, chatId, msg.from?.id);
        try {
          await call('sendMessage', { chat_id: chatId, text: '🔄 已清空你和我之间的对话记录，我们重新开始。', reply_to_message_id: msg.message_id });
        } catch { /* ignore */ }
        return;
      }
      // 管理命令：/ban /mute /unmute
      if (['/ban', '/mute', '/unmute', '/kick'].includes(cmd)) {
        return handleModCommand(msg, chatId, cmd, raw);
      }
      if (cmd === '/id') {
        const u = getBotUser(msg.from?.id);
        const lines = [
          '🆔 <b>你的 Telegram ID</b>', '', `<code>${msg.from?.id}</code>`,
          msg.from?.username ? `用户名：@${esc(msg.from.username)}` : '',
          '', '👥 <b>当前群组 ID</b>', `<code>${msg.chat.id}</code>`,
          msg.chat.title ? `群名：${esc(msg.chat.title)}` : '',
        ].filter(Boolean);
        try { await send(chatId, lines.join('\n')); } catch { /* ignore */ }
        recordCommand(msg.from?.id, '/id', 'group');
        return;
      }
      if (cmd === '/start' && msg.chat.type !== 'channel') {
        // 群里 /start 提示私聊
        try {
          await call('sendMessage', {
            chat_id: chatId,
            text: `👋 你好！请私聊机器人使用完整功能：<a href="https://t.me/${getSetting('bot_username') || 'dailivbot'}">@${getSetting('bot_username') || '机器人'}</a>`,
            parse_mode: 'HTML', reply_to_message_id: msg.message_id,
          });
        } catch { /* ignore */ }
        return;
      }
      // 非命令消息：不在此处返回，交给下面的 AI 与内容检测处理
    }
    // 群组里的 AI 回复（@机器人 触发，仅限后台指定的群组）
    const isCmd = raw.startsWith('/');
    if (!isCmd) {
      try {
        const inst = currentBot();
        let botRow = inst?.row;
        if (!botRow) {
          // 无实例上下文（如直接调用）时，退回到主机器人配置
          botRow = db.prepare('SELECT * FROM bots WHERE is_primary = 1 LIMIT 1').get()
            || { id: 1, ai_enabled: 1, ai_persona: '' };
        }
        const botUsername = inst?.me?.username || getSetting('bot_username');
        if (botRow && ai.shouldAiReply(msg, botUsername)) {
          const prompt = ai.cleanPrompt(msg.text || '', botUsername);
          if (prompt) {
            if (botRow.ai_enabled && getSettingBool('ai_typing')) {
              try { await call('sendChatAction', { chat_id: chatId, action: 'typing' }); } catch { /* ignore */ }
            }
            // 管理员判定：后台白名单 或 群内管理员/群主
            let isAdmin = isAdminTg(msg.from.id);
            if (!isAdmin) {
              try {
                const m = await call('getChatMember', { chat_id: chatId, user_id: msg.from.id });
                isAdmin = ['administrator', 'creator'].includes(m.status);
              } catch { /* ignore */ }
            }
            const r = await ai.aiReply({
              botId: botRow.id, bot: botRow, tgId: msg.from.id, chatId,
              text: prompt, isGroup: true, isAdmin,
              botUsername: botUsername || '',
            });
            if (r?.ok) {
              // 先发文字
              await call('sendMessage', {
                chat_id: chatId, text: r.text,
                reply_to_message_id: msg.message_id,
                allow_sending_without_reply: true,
              });
              // 再发截图（如果有）
              for (const ph of (r.photos || [])) {
                try {
                  await sendPhoto(chatId, ph, msg.message_id);
                } catch (e) { console.error('[photo]', e.message); }
              }
              return;
            }
            if (r?.error) console.error('[ai-group]', r.error);
          }
        }
      } catch (e) { console.error('[ai-group]', e.message); }
    }

    if (!isCmd) {
      // 处于入群验证期的成员，不在此时做内容检测（避免验证未完成就被禁言/删消息）
      const pending = msg.from?.id ? guard.getPendingVerify(chatId, msg.from.id) : null;
      if (!pending) {
        try { await guard.checkMessage(call, msg, chatId); } catch (e) { console.error('[guard]', e.message); }
      }
    }
    return;
  }
  const text = (msg.text || '').trim();
  const bu = await ensureBotUser(msg);
  state.counters.messages++;

  // 补发因「未私聊过机器人」而失败的入群验证题
  try {
    const resent = await guard.resendPendingVerify(call, bu.tg_id);
    if (resent.length) {
      await send(chatId, `✅ 已为你重新发送 <b>${esc(resent.join('、'))}</b> 的入群验证题，请点击上方选项作答。`);
    }
  } catch (e) { console.error('[resend]', e.message); }

  if (bu.banned) { await send(chatId, '你已被限制使用本机器人'); return; }

  // 加入频道校验
  if (getSettingBool('bot_require_join')) {
    const ch = getSetting('bot_require_channel');
    if (ch) {
      try {
        const member = await call('getChatMember', { chat_id: ch, user_id: Number(bu.tg_id) });
        if (['left', 'kicked'].includes(member.status)) {
          await send(chatId, `请先加入频道再使用：${ch}`, { inline_keyboard: [[{ text: '📢 加入频道', url: ch.startsWith('@') ? `https://t.me/${ch.slice(1)}` : ch }]] });
          return;
        }
      } catch { /* 权限不足时忽略 */ }
    }
  }

  // 邮箱验证流程：仅拦截普通文本输入（命令与菜单按钮正常放行）
  const isCommand = text.startsWith('/');
  if (isCommand && ['/start', '/help', '/verify'].includes(text.split(/[\s@]/)[0].toLowerCase())) {
    // 交给各自的处理函数
  } else if (bu.state === 'await_email' || bu.state === 'await_code') {
    const handled = await handleEmailFlow(chatId, bu, text);
    if (handled) return;
  }
  if (text === '/verify') {
    if (!needsEmailVerify()) { await send(chatId, '当前无需邮箱验证', mainMenu(bu)); return; }
    db.prepare("UPDATE bot_users SET state = 'await_email' WHERE id = ?").run(bu.id);
    await send(chatId, '请发送你的邮箱地址：');
    return;
  }

  if (text.startsWith('/')) {
    const cmd = text.split(/[\s@]/)[0].toLowerCase();
    state.counters.commands++;
    recordCommand(bu.tg_id, cmd);
    switch (cmd) {
      case '/start': return handleStart(msg);
      case '/help': return handleHelp(chatId, bu);
      case '/create': return handleCreate(chatId, bu);
      case '/my': return listAccounts(chatId, bu);
      case '/usage': return showUsage(chatId, bu);
      case '/signin': return handleSignin(chatId, bu);
      case '/invite': return handleInvite(chatId, bu);
      case '/id': return handleId(msg, chatId, bu);
      default: return handleHelp(chatId, bu);
    }
  }

  // 回复键盘按钮
  const map = {
    '🚀 创建代理': () => handleCreate(chatId, bu),
    '📋 我的代理': () => listAccounts(chatId, bu),
    '📊 我的流量': () => showUsage(chatId, bu),
    '🎁 每日签到': () => handleSignin(chatId, bu),
    '🎉 邀请赚流量': () => handleInvite(chatId, bu),
    '❓ 帮助': () => handleHelp(chatId, bu),
  };
  // 查看所有可用模型（私聊）
  if (/^(所有模型|全部模型|模型列表|可用模型|models?)$/i.test(text.trim())) {
    await send(chatId, buildModelListText(bu.tg_id), mainMenu(bu));
    return;
  }
  // 切换模型（私聊）
  const sw = text.trim().match(/^(?:切换模型|换模型|用模型|switch)\s*[:：]?\s*(.+)$/i);
  if (sw) {
    const r = switchModelForUser(bu.tg_id, sw[1].trim());
    await send(chatId, r.text, mainMenu(bu));
    return;
  }
  if (['/reset', '/clear', '/newchat'].includes(text.toLowerCase())) {
    const inst2 = currentBot();
    ai.clearHistory(inst2?.botId || 1, chatId, bu.tg_id);
    await send(chatId, '🔄 已清空对话记录，我们重新开始吧！', mainMenu(bu));
    return;
  }
  if (map[text]) return map[text]();

  // AI 智能回复
  try {
    const inst = currentBot();
    const botRow = inst?.row;
    const botUsername = inst?.me?.username || getSetting('bot_username');
    if (botRow && ai.shouldAiReply(msg, botUsername)) {
      const prompt = ai.cleanPrompt(text, botUsername);
      if (!prompt) { await send(chatId, '你好，有什么可以帮你？', mainMenu(bu)); return; }
      if (getSettingBool('ai_typing')) {
        try { await call('sendChatAction', { chat_id: chatId, action: 'typing' }); } catch { /* ignore */ }
      }
      const r = await ai.aiReply({
        botId: botRow.id, bot: botRow, tgId: bu.tg_id, chatId,
        text: prompt, isGroup: ['group', 'supergroup'].includes(msg.chat?.type),
        isAdmin: isAdminTg(bu.tg_id), botUsername: botUsername || '',
      });
      if (r?.ok) {
        await send(chatId, r.text, mainMenu(bu));
        for (const ph of (r.photos || [])) {
          try { await sendPhoto(chatId, ph); } catch (e) { console.error('[photo]', e.message); }
        }
        return;
      }
      if (r?.error) {
        console.error('[ai]', r.error);
      }
    }
  } catch (e) { console.error('[ai]', e.message); }

  return handleHelp(chatId, bu);
}

async function handleCreate(chatId, bu) {
  const r = await createAccount(bu);
  if (!r.ok) { await send(chatId, `❌ ${r.msg}`, mainMenu(bu)); return; }
  const links = mtg.genClientLinks(r.acc);
  await send(chatId, [
    '✅ <b>代理创建成功！</b>',
    '',
    `名称：${esc(r.acc.name)}`,
    `端口：<code>${r.acc.port}</code>`,
    `额度：${fmtMb(r.acc.quota_mb)}`,
    '',
    '点击下方按钮一键导入 Telegram 👇',
  ].join('\n'), {
    inline_keyboard: [
      [{ text: '✈️ 一键导入 Telegram', url: links.variants.standard.tme }],
      [{ text: '📋 管理我的代理', callback_data: `acc:view:${r.acc.id}` }],
    ],
  });
}

async function handleCallback(q) {
  const chatId = q.message?.chat?.id;
  const messageId = q.message?.message_id;
  const data = q.data || '';
  // 入群验证回调
  if (data.startsWith('vf:') || data.startsWith('vfpass:')) {
    try { await guard.handleVerifyCallback(call, q); } catch (e) { console.error('[verify]', e.message); }
    return;
  }
  const bu = await ensureBotUser({ from: q.from, chat: q.message.chat });
  const [action, sub, arg] = data.split(':');
  state.counters.commands++;
  recordCommand(bu.tg_id, `cb:${action}`, data);
  await answerCallback(q.id);

  if (data === 'menu') {
    const welcome = renderTpl(getSetting('bot_welcome'), { name: bu.tg_first_name || '朋友', site: getSetting('site_name') });
    await editOrSend(chatId, messageId, welcome, mainMenu(bu));
    return;
  }
  if (action === 'email') {
    if (sub === 'start') {
      if (!needsEmailVerify()) {
        await send(chatId, '当前无需邮箱验证，可直接使用', mainMenu(bu));
        return;
      }
      if (isEmailVerified(bu)) {
        await send(chatId, `✅ 你的邮箱 <b>${esc(bu.email || '')}</b> 已通过验证，无需重复注册。`, mainMenu(bu));
        return;
      }
      db.prepare("UPDATE bot_users SET state = 'await_email' WHERE id = ?").run(bu.id);
      await send(chatId, getSetting('bot_email_required_msg') || '请发送你的邮箱地址：', {
        inline_keyboard: [[{ text: '« 返回菜单', callback_data: 'menu' }]],
      });
      return;
    }
    if (sub === 'resend') {
      const fresh = getBotUser(bu.tg_id);
      if (!fresh.email) { db.prepare("UPDATE bot_users SET state = 'await_email' WHERE id = ?").run(fresh.id); await send(chatId, '请先发送邮箱地址'); return; }
      try {
        await emailVerify.sendCode(fresh.email, `tg_${fresh.tg_id}`, 'bot');
        db.prepare("UPDATE bot_users SET state = 'await_code' WHERE id = ?").run(fresh.id);
        await send(chatId, '🔁 验证码已重新发送，请查收邮件');
      } catch (e) { await send(chatId, `❌ ${e.message}`); }
      return;
    }
    if (sub === 'change') {
      db.prepare("UPDATE bot_users SET state = 'await_email' WHERE id = ?").run(bu.id);
      await send(chatId, '✏️ 请发送新的邮箱地址：');
      return;
    }
  }
  if (action === 'create') {
    if (!isEmailVerified(bu)) { await send(chatId, getSetting('bot_email_required_msg')); return; }
    return handleCreate(chatId, bu);
  }
  if (action === 'my') return listAccounts(chatId, bu);
  if (action === 'usage') return showUsage(chatId, bu);
  if (action === 'signin') return handleSignin(chatId, bu);
  if (action === 'help') return handleHelp(chatId, bu);
  if (action === 'invite') return handleInvite(chatId, bu);
  if (action === 'ref') {
    if (sub === 'invite') return handleInvite(chatId, bu);
    if (sub === 'stats') return handleInviteStats(chatId, bu);
    if (sub === 'code') {
      const card = invite.inviteCard(bu);
      await send(chatId, `你的邀请码：<code>${card.code}</code>\n邀请链接：\n<code>${card.url}</code>`, {
        inline_keyboard: [[{ text: '🎉 返回邀请页', callback_data: 'ref:invite' }]],
      });
      return;
    }
  }
  if (action === 'acc') {
    if (sub === 'view') return showAccount(chatId, bu, arg, messageId);
    if (sub === 'link') return sendLink(chatId, bu, arg, messageId);
    if (sub === 'qr') return sendQr(chatId, bu, arg);
    if (sub === 'rotate') {
      const pu = platformUserOf(bu);
      const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(arg));
      if (acc && acc.user_id === pu?.id) {
        const sec = genSecret();
        db.prepare('UPDATE accounts SET secret = ? WHERE id = ?').run(sec, acc.id);
        const fresh = db.prepare('SELECT * FROM accounts WHERE id = ?').get(acc.id);
        await mtg.reloadAccount(fresh);
      }
      return sendLink(chatId, bu, arg, messageId);
    }
    if (sub === 'on' || sub === 'off') {
      const pu = platformUserOf(bu);
      const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(arg));
      if (acc && acc.user_id === pu?.id) {
        db.prepare("UPDATE accounts SET status = ? WHERE id = ?").run(sub === 'on' ? 'active' : 'disabled', acc.id);
        const fresh = db.prepare('SELECT * FROM accounts WHERE id = ?').get(acc.id);
        await mtg.reloadAccount(fresh);
      }
      return showAccount(chatId, bu, arg, messageId);
    }
    if (sub === 'del') {
      const pu = platformUserOf(bu);
      const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(arg));
      if (acc && acc.user_id === pu?.id) {
        mtg.stopAccount(acc.id);
        await billing.removeRules(acc).catch(() => {});
        db.prepare('DELETE FROM accounts WHERE id = ?').run(acc.id);
      }
      return listAccounts(chatId, bu);
    }
  }
}

// ---------------------------------------------------------------
// 主循环
// ---------------------------------------------------------------
async function processUpdate(update) {
  state.counters.updates++;
  state.lastUpdateAt = new Date().toISOString();
  try {
    if (update.message) await handleMessage(update.message);
    else if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.chat_member) await handleChatMember(update.chat_member);
    else if (update.my_chat_member) await handleMyChatMember(update.my_chat_member);
    else if (update.channel_post) await handleChannelPost(update.channel_post);
  } catch (e) {
    state.counters.errors++;
    state.lastError = e.message;
    console.error('[bot]', e.message);
  }
}

let lastCleanup = 0;
async function pollLoop() {
  while (state.running) {
    if (Date.now() - lastCleanup > 10000) {
      lastCleanup = Date.now();
      try { await guard.cleanupExpired(call); } catch { /* ignore */ }
    }
    try {
      const updates = await call('getUpdates', {
        offset: state.offset,
        timeout: 25,
        allowed_updates: ['message', 'channel_post', 'callback_query', 'chat_member', 'my_chat_member'],
      });
      for (const u of updates) {
        state.offset = Math.max(state.offset, u.update_id + 1);
        await processUpdate(u);
      }
      state.lastError = '';
    } catch (e) {
      state.lastError = e.message;
      state.counters.errors++;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

export async function startBot() {
  if (state.running) return botState();
  if (!getSettingBool('bot_enabled')) throw new Error('机器人未启用');
  if (!token()) throw new Error('未配置 Token');
  state.me = await getMe();
  setSetting('bot_username', state.me.username || '');
  setSetting('bot_name', state.me.first_name || '');
  if (state.me.username) setSetting('bot_link', `https://t.me/${state.me.username}`);
  state.running = true;
  state.startedAt = new Date().toISOString();
  state.counters = { updates: 0, messages: 0, commands: 0, errors: 0 };

  if (getSettingBool('bot_webhook_mode') && getSetting('bot_webhook_url')) {
    const secret = getSetting('bot_webhook_secret') || '';
    await call('setWebhook', {
      url: getSetting('bot_webhook_url'),
      secret_token: secret || undefined,
      allowed_updates: ['message', 'channel_post', 'callback_query', 'chat_member', 'my_chat_member'],
      drop_pending_updates: false,
    });
    state.mode = 'webhook';
  } else {
    await call('deleteWebhook', { drop_pending_updates: false }).catch(() => {});
    state.mode = 'polling';
    pollLoop();
  }
  return botState();
}

export async function stopBot() {
  if (!state.running) return botState();
  state.running = false;
  if (state.mode === 'webhook') {
    await call('deleteWebhook').catch(() => {});
  }
  state.mode = null;
  return botState();
}

export async function restartBot() {
  await stopBot();
  await new Promise((r) => setTimeout(r, 500));
  return startBot();
}

/** 频道发帖：记录会话，并做违禁内容检测（如启用） */
async function handleChannelPost(msg) {
  const chat = msg.chat;
  if (chat?.type !== 'channel') return;
  // 记录频道（首次见到时）
  if (!guard.getGroup(chat.id)) {
    guard.upsertGroup(chat);
    db.prepare('UPDATE tg_groups SET type = ? WHERE chat_id = ?').run('channel', String(chat.id));
  }
  // 频道帖子：默认不检测（频道只有管理员能发帖，内容应为正常运营内容）
  if (!getSettingBool('grp_filter_channels')) return;
  try { await guard.checkMessage(call, msg, chat.id); } catch (e) { console.error('[guard-ch]', e.message); }
}

/** 群成员变动 */
async function handleChatMember(cm) {
  const chat = cm.chat;
  if (!['group', 'supergroup'].includes(chat.type)) return;
  const oldStatus = cm.old_chat_member?.status;
  const newStatus = cm.new_chat_member?.status;
  const user = cm.new_chat_member?.user;
  if (!user) return;
  // 管理员变动登记
  guard.trackAdmin(chat.id, user, newStatus);
  // 新成员入群
  const wasIn = ['member', 'administrator', 'creator', 'restricted'].includes(oldStatus);
  const nowIn = ['member', 'restricted'].includes(newStatus);
  if (!wasIn && nowIn && !user.is_bot) {
    await guard.onNewMember(call, { chat, from: user }, user, chat.id);
  }
}

/** 机器人被加入群 / 权限变化 */
async function handleMyChatMember(m) {
  const chat = m.chat;
  const st = m.new_chat_member?.status;
  const isChannel = chat.type === 'channel';
  const isGroup = ['group', 'supergroup'].includes(chat.type);
  if (!isChannel && !isGroup) return;

  // 机器人被移除
  if (['left', 'kicked'].includes(st)) {
    db.prepare('DELETE FROM tg_groups WHERE chat_id = ?').run(String(chat.id));
    return;
  }
  if (!['member', 'administrator'].includes(st)) return;

  // 记录为可管理的会话（群组与频道同等对待）
  guard.upsertGroup(chat);
  db.prepare('UPDATE tg_groups SET type = ? WHERE chat_id = ?').run(chat.type, String(chat.id));

  // 记录权限状态
  const perms = m.new_chat_member || {};
  const canPost = isChannel ? perms.can_post_messages : perms.can_send_messages;
  const canDelete = perms.can_delete_messages;
  const canBan = perms.can_restrict_members;

  if (isChannel) {
    // 频道里机器人无法主动发消息，只能由管理员在频道发帖时处理
    console.log(`[bot] 已加入频道：${chat.title}（${chat.id}），发帖权限=${canPost}`);
  } else {
    try {
      await call('sendMessage', {
        chat_id: chat.id,
        text: [
          '🤖 <b>群组守卫已启用</b>',
          '',
          '• 新成员入群需完成人机验证',
          '• 自动拦截违禁词、链接、二维码',
          '',
          `当前权限：删除消息 ${canDelete ? '✅' : '❌'} · 封禁用户 ${canBan ? '✅' : '❌'}`,
          (!canDelete || !canBan) ? '\n⚠️ 请把机器人设为管理员并开启「删除消息」「封禁用户」权限，否则部分功能无法使用。' : '',
        ].filter(Boolean).join('\n'),
        parse_mode: 'HTML',
      });
    } catch { /* ignore */ }
  }
}

/** Webhook 入口 */
export async function handleWebhookUpdate(req, body) {
  if (!state.running) return;
  const secret = getSetting('bot_webhook_secret');
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) return;
  await processUpdate(body);
}

/**
 * 广播
 * target: all（全部机器人用户）| one（指定用户）| groups（全部群组/频道）| mixed
 */
export async function broadcast({ text, target = 'all', tgId = '', chatIds = [], withMenu = true, parseMode }) {
  const mode = parseMode || getSetting('bot_parse_mode') || 'HTML';
  const detail = { users: { ok: 0, fail: 0 }, groups: { ok: 0, fail: 0 }, fails: [] };
  const delay = 60;

  const sendOne = async (chatId, bu) => {
    const body = {
      chat_id: chatId,
      text,
      parse_mode: mode,
      disable_web_page_preview: true,
    };
    if (withMenu && bu) body.reply_markup = mainMenu(bu);
    await call('sendMessage', body);
  };

  // 1) 群组/频道
  if (target === 'groups' || target === 'mixed') {
    const list = chatIds.length
      ? chatIds.map((id) => db.prepare('SELECT * FROM tg_groups WHERE chat_id = ?').get(String(id))).filter(Boolean)
      : db.prepare('SELECT * FROM tg_groups').all();
    for (const g of list) {
      try { await sendOne(g.chat_id, null); detail.groups.ok++; }
      catch (e) { detail.groups.fail++; detail.fails.push({ chat: g.chat_id, name: g.title, error: e.message }); }
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // 2) 指定用户
  if (target === 'one') {
    const bu = getBotUser(String(tgId).trim());
    if (!bu) throw new Error('该 Telegram 用户不存在于机器人用户列表');
    const chatId = /^\d+$/.test(String(tgId).trim()) ? Number(tgId) : String(tgId).trim();
    try { await sendOne(bu.tg_id, bu); detail.users.ok++; }
    catch (e) { detail.users.fail++; detail.fails.push({ chat: bu.tg_id, error: e.message }); }
    return { ...detail, total: 1, ok: detail.users.ok, fail: detail.users.fail };
  }

  // 3) 全部用户
  if (target === 'all' || target === 'mixed') {
    const users = db.prepare('SELECT * FROM bot_users WHERE banned = 0').all();
    for (const u of users) {
      try { await sendOne(u.tg_id, withMenu ? u : null); detail.users.ok++; }
      catch (e) { detail.users.fail++; detail.fails.push({ chat: u.tg_id, name: u.tg_username, error: e.message }); }
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  const ok = detail.users.ok + detail.groups.ok;
  const fail = detail.users.fail + detail.groups.fail;
  return { ...detail, total: ok + fail, ok, fail };
}

/** 预览广播目标数量 */
export function broadcastTargets() {
  const users = db.prepare('SELECT COUNT(*) AS c FROM bot_users WHERE banned = 0').get().c;
  const groups = db.prepare('SELECT * FROM tg_groups ORDER BY id DESC').all();
  return { users, groups };
}

/**
 * 同步机器人所在的群组/频道
 * 用 getUpdates 的最近记录 + 已有记录合并（Bot API 无法列出全部会话）
 */
export async function syncChats(knownIds = []) {
  const found = new Map();
  // 注意：不能调用 getUpdates（会中断正在运行的长轮询），只探测已知会话 ID
  // 2) 探测已知 ID
  for (const id of knownIds) {
    if (found.has(String(id))) continue;
    try {
      const c = await call('getChat', { chat_id: id });
      if (['group', 'supergroup', 'channel'].includes(c.type)) found.set(String(c.id), c);
    } catch { /* ignore */ }
  }
  const saved = [];
  for (const c of found.values()) {
    guard.upsertGroup(c);
    db.prepare('UPDATE tg_groups SET type = ? WHERE chat_id = ?').run(c.type, String(c.id));
    saved.push({ chat_id: String(c.id), title: c.title, type: c.type });
  }
  return saved;
}

/** 探测机器人在某会话中的权限 */
export async function chatPermissions(chatId) {
  try {
    const me = await getMe();
    const m = await call('getChatMember', { chat_id: chatId, user_id: me.id });
    const c = await call('getChat', { chat_id: chatId }).catch(() => null);
    return {
      chat_id: String(chatId), title: c?.title || '', type: c?.type || '',
      status: m.status,
      is_admin: ['administrator', 'creator'].includes(m.status),
      can_delete: !!m.can_delete_messages,
      can_restrict: !!m.can_restrict_members,
      can_send: m.status === 'creator' ? true : !!m.can_send_messages,
      can_post: m.status === 'creator' ? true : !!m.can_post_messages,
      can_pin: !!m.can_pin_messages,
    };
  } catch (e) {
    return { chat_id: String(chatId), error: e.message, is_admin: false, can_delete: false, can_restrict: false };
  }
}

/** 自动启动 */
export async function autoStart() {
  if (!getSettingBool('bot_enabled') || !token()) return;
  try {
    await startBot();
    console.log(`[bot] 已启动：@${state.me?.username}（${state.mode}）`);
  } catch (e) {
    state.lastError = e.message;
    console.error('[bot] 启动失败:', e.message);
  }
}


// 测试用：补建平台账号
export async function __createPlatformUserForTest(bu) {
  return createPlatformUser(bu, {});
}

// 测试用：直接驱动消息处理（供本地流程验证）
export async function __handleMessageForTest(msg) {
  return handleMessage(msg);
}
export async function __handleCallbackForTest(q) {
  return handleCallback(q);
}

// ---------------------------------------------------------------
// 供多机器人管理器调用的内部接口
// ---------------------------------------------------------------
export async function __internalGetUpdates(offset) {
  return call('getUpdates', {
    offset: offset || 0,
    timeout: 25,
    allowed_updates: ['message', 'channel_post', 'callback_query', 'chat_member', 'my_chat_member'],
  });
}

export async function __internalProcessUpdate(update) {
  return processUpdate(update);
}

export async function __internalSetWebhook(url, secret) {
  return call('setWebhook', {
    url,
    secret_token: secret || undefined,
    allowed_updates: ['message', 'channel_post', 'callback_query', 'chat_member', 'my_chat_member'],
    drop_pending_updates: false,
  });
}

export async function __internalDeleteWebhook() {
  return call('deleteWebhook', { drop_pending_updates: false });
}

export async function __internalBroadcast(payload) {
  return broadcast(payload);
}

export async function __getMeForCurrentCtx() {
  return call('getMe');
}
