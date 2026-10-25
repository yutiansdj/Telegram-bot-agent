/**
 * 群组守卫：入群人机验证 + 违禁词/垃圾内容检测
 *
 * 入群验证：
 *   - 新成员入群后立即禁言，机器人私聊该用户发送「多选答案」验证题
 *   - 答对 → 自动解禁；答错 3 次（可配）→ 踢出；超时（可配）→ 踢出
 *   - 群管理员/群主可在群内点「直接通过」按钮放行，也可配置白名单管理员不参与验证
 *
 * 内容检测：
 *   - 违禁词（自定义词库）、链接、二维码/图片、转发、@所有人、刷屏
 *   - 命中后按配置执行：删除 / 禁言 / 删除+禁言 / 踢出，禁言时长可调
 */

import { db, getSettings, getSetting, getSettingNum, getSettingBool } from './db.js';

const pad = (n) => String(n).padStart(2, '0');
function now() {
  const d = new Date(Date.now() + 8 * 3600000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function logMod(chatId, tgId, tgName, action, detail) {
  try {
    db.prepare('INSERT INTO mod_logs(chat_id, tg_id, tg_name, action, detail) VALUES(?,?,?,?,?)')
      .run(String(chatId || ''), String(tgId || ''), tgName || '', action, detail || '');
  } catch { /* ignore */ }
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function render(text, vars = {}) {
  return String(text || '').replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_, k) => esc(vars[k] ?? ''));
}

// ---------------------------------------------------------------
// 群组
// ---------------------------------------------------------------
export function getGroup(chatId) {
  return db.prepare('SELECT * FROM tg_groups WHERE chat_id = ?').get(String(chatId));
}

export function upsertGroup(chat) {
  const existing = getGroup(chat.id);
  if (existing) {
    db.prepare('UPDATE tg_groups SET title = ?, type = ? WHERE chat_id = ?').run(chat.title || existing.title, chat.type || existing.type, String(chat.id));
    return getGroup(chat.id);
  }
  db.prepare('INSERT INTO tg_groups(chat_id, title, type) VALUES(?,?,?)').run(String(chat.id), chat.title || '', chat.type || 'supergroup');
  return getGroup(chat.id);
}

/** 记录群管理员（从 Telegram 的 member update 推断） */
export function trackAdmin(chatId, user, status) {
  if (!user) return;
  const isAdmin = ['administrator', 'creator'].includes(status);
  const row = db.prepare('SELECT * FROM group_admins WHERE chat_id = ? AND tg_id = ?').get(String(chatId), String(user.id));
  if (isAdmin && !row) {
    db.prepare('INSERT INTO group_admins(chat_id, tg_id, title) VALUES(?,?,?)').run(String(chatId), String(user.id), user.username || '');
  } else if (!isAdmin && row) {
    db.prepare('DELETE FROM group_admins WHERE chat_id = ? AND tg_id = ?').run(String(chatId), String(user.id));
  }
}

/** 该用户是否免验证（群主/管理员 且未被后台禁用） */
export async function isExemptAdmin(call, chatId, userId) {
  const blocked = db.prepare('SELECT * FROM group_admins WHERE chat_id = ? AND tg_id = ? AND blocked = 1').get(String(chatId), String(userId));
  if (blocked) return false; // 被后台禁用 → 不享受豁免，正常验证
  try {
    const m = await call('getChatMember', { chat_id: chatId, user_id: userNum(userId) });
    if (['creator', 'administrator'].includes(m.status)) {
      trackAdmin(chatId, m.user, m.status);
      return true;
    }
  } catch { /* 无权限时忽略 */ }
  return false;
}

function userNum(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : id;
}

/**
 * 管理命令权限检查（独立于「验证豁免」逻辑，不受后台禁用管理员影响）
 * 返回 { ok, isOwner, status, reason }
 */
export async function checkManageRight(call, chatId, userId) {
  try {
    const m = await call('getChatMember', { chat_id: chatId, user_id: userNum(userId) });
    const isOwner = m.status === 'creator';
    const isAdmin = ['creator', 'administrator'].includes(m.status);
    if (isAdmin) trackAdmin(chatId, m.user, m.status);
    return { ok: isAdmin, isOwner, status: m.status };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** 判断目标是否比操作者权限更高（防越权） */
export async function canModerate(call, chatId, operatorId, targetId, superAdmin = false) {
  if (String(operatorId) === String(targetId)) return { ok: false, reason: '不能对自己执行该操作' };
  try {
    // 后台管理员：可操作除群主外的任何人（避免把整个群管死）
    if (superAdmin) {
      const target0 = await call('getChatMember', { chat_id: chatId, user_id: userNum(targetId) });
      if (target0.status === 'creator') return { ok: false, reason: '不能对群主执行该操作' };
      return { ok: true, target: target0 };
    }
    const me = await call('getChatMember', { chat_id: chatId, user_id: userNum(operatorId) });
    const target = await call('getChatMember', { chat_id: chatId, user_id: userNum(targetId) });
    if (target.status === 'creator') return { ok: false, reason: '不能对群主执行该操作' };
    if (target.status === 'administrator' && me.status !== 'creator') {
      return { ok: false, reason: '只有群主才能对管理员执行该操作' };
    }
    return { ok: true, target };
  } catch (e) {
    return { ok: false, reason: '无法获取成员信息：' + e.message };
  }
}

/** 解析时长：8h / 30m / 1d / 纯数字(分钟) / forever */
export function parseDuration(input) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  if (['forever', 'permanent', '永久', '∞'].includes(s)) return { forever: true, minutes: 0, label: '永久' };
  const m = s.match(/^(\d+)\s*(s|m|h|d|秒|分|时|天)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2] || 'm';
  const mult = { s: 1 / 60, m: 1, h: 60, d: 60 * 24, 秒: 1 / 60, 分: 1, 时: 60, 天: 60 * 24 }[unit] || 1;
  const minutes = Math.round(n * mult);
  const label = minutes < 60 ? `${minutes} 分钟`
    : minutes < 1440 ? `${(minutes / 60).toFixed(minutes % 60 ? 1 : 0)} 小时`
    : `${(minutes / 1440).toFixed(minutes % 1440 ? 1 : 0)} 天`;
  return { forever: false, minutes, label, seconds: minutes * 60 };
}

// ---------------------------------------------------------------
// 入群验证
// ---------------------------------------------------------------
function genOptions(correct, count) {
  const set = new Set([String(correct)]);
  const correctNum = Number(correct);
  let guard = 0;
  while (set.size < count && guard++ < 200) {
    let v;
    if (Number.isFinite(correctNum)) {
      v = correctNum + (Math.floor(Math.random() * 2) ? 1 : -1) * (1 + Math.floor(Math.random() * 9));
      if (v < 0) v = Math.abs(v) + 1;
    } else {
      v = Math.random().toString(36).slice(2, 5).toUpperCase();
    }
    set.add(String(v));
  }
  return [...set].sort(() => Math.random() - 0.5);
}

function questionFor(type) {
  if (type === 'math') {
    const a = 1 + Math.floor(Math.random() * 9);
    const b = 1 + Math.floor(Math.random() * 9);
    const ops = ['+', '-', '×'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    let ans;
    if (op === '+') ans = a + b;
    else if (op === '-') ans = Math.abs(a - b);
    else ans = a * b;
    return { question: op === '-' ? `${Math.max(a, b)} - ${Math.min(a, b)} = ?` : `${a} ${op} ${b} = ?`, answer: String(ans) };
  }
  // choice：从题池中随机
  const pool = [
    { q: '以下哪个是苹果 🍎？', a: '苹果', opts: ['苹果', '香蕉', '橙子', '葡萄'] },
    { q: '以下哪个是月亮 🌙？', a: '月亮', opts: ['月亮', '太阳', '星星', '云朵'] },
    { q: '2 + 3 等于多少？', a: '5', opts: ['4', '5', '6', '7'] },
    { q: '以下哪个是猫 🐱？', a: '猫', opts: ['狗', '猫', '兔', '鸟'] },
    { q: '水的化学式是？', a: 'H2O', opts: ['H2O', 'CO2', 'O2', 'NaCl'] },
    { q: '以下哪个是红色 ❤️？', a: '红色', opts: ['红色', '蓝色', '绿色', '黄色'] },
    { q: '10 - 4 等于多少？', a: '6', opts: ['5', '6', '7', '8'] },
    { q: '请选出「太阳」☀️', a: '太阳', opts: ['月亮', '太阳', '地球', '火星'] },
  ];
  const p = pool[Math.floor(Math.random() * pool.length)];
  return { question: p.q, answer: p.a, preset: p.opts };
}

/**
 * 有新成员加入时调用
 */
export async function onNewMember(call, msg, user, chatId) {
  const s = getSettings();
  if (s.grp_verify_enabled !== '1') return;
  const grp = upsertGroup(msg.chat);
  if (!grp.verify_enabled) return;

  // 管理员豁免
  if (await isExemptAdmin(call, chatId, user.id)) {
    logMod(chatId, user.id, user.username, 'skip_verify', '管理员/群主豁免');
    return;
  }

  const maxAttempts = getSettingNum('grp_captcha_attempts') || 3;
  const timeout = getSettingNum('grp_captcha_timeout') || 120;
  const type = getSetting('grp_captcha_type') || 'choice';
  const q = questionFor(type);
  const options = q.preset ? [...q.preset].sort(() => Math.random() - 0.5) : genOptions(q.answer, getSettingNum('grp_captcha_options') || 4);
  const sid = Math.random().toString(36).slice(2) + Date.now().toString(36);

  db.prepare(`INSERT INTO verify_sessions(id, chat_id, tg_id, tg_name, answer, options, max_attempts, status, expires_at)
              VALUES(?,?,?,?,?,?,?, 'pending', ?)`)
    .run(sid, String(chatId), String(user.id), user.username || user.first_name || '', q.answer, JSON.stringify(options), maxAttempts, Date.now() + timeout * 1000);

  // 先尝试私聊发送验证题（决定群内提示内容）
  const botMe = await call('getMe').catch(() => ({ username: '' }));
  const botUser = botMe.username || '';
  const rowsOpt = [];
  let r1 = [];
  options.forEach((opt) => {
    r1.push({ text: String(opt), callback_data: `vf:${sid}:${encodeURIComponent(opt)}` });
    if (r1.length === 2) { rowsOpt.push(r1); r1 = []; }
  });
  if (r1.length) rowsOpt.push(r1);
  if (getSettingBool('grp_show_admin_pass')) {
    rowsOpt.push([{ text: '✅ 群管理员直接通过', callback_data: `vfpass:${sid}` }]);
  }
  const dmText = [
    `🔐 <b>入群验证</b>`,
    ``,
    `群组：<b>${esc(msg.chat.title || '本群')}</b>`,
    `题目：<b>${esc(q.question)}</b>`,
    ``,
    `你有 <b>${maxAttempts}</b> 次机会，答对即可入群。`,
  ].join('\n');

  let dmOk = false;
  try {
    await call('sendMessage', { chat_id: user.id, text: dmText, parse_mode: 'HTML', reply_markup: { inline_keyboard: rowsOpt } });
    dmOk = true;
  } catch (e) {
    dmOk = false;
    db.prepare('UPDATE verify_sessions SET status = ? WHERE id = ?').run('no_pm', sid);
    logMod(chatId, user.id, user.username, 'verify_no_pm', e.message);
  }

  // 1) 群内提示（内容随私聊是否成功而不同）
  const groupName = msg.chat.title || '本群';
  const mention = botUser ? '@' + botUser : '机器人';
  const hint = dmOk
    ? `👋 欢迎 <b>${esc(user.first_name || user.username || '新成员')}</b>！\n\n📩 <b>验证题已发送到你的私聊</b>（来自 ${mention}），请切换到与机器人的私聊完成答题。\n\n<i>${timeout} 秒内未完成将被移出群组</i>`
    : `👋 欢迎 <b>${esc(user.first_name || user.username || '新成员')}</b>！\n\n⚠️ <b>请先点击下方按钮打开 ${mention}，然后发送任意消息（如 /start）</b>，机器人才能把验证题发给你。\n\n<i>Telegram 规定：机器人不能主动私聊从未联系过它的用户。</i>`;
  const groupKb = { inline_keyboard: [[{ text: dmOk ? '📩 打开私聊答题' : '👉 点此打开机器人', url: `https://t.me/${botUser}` }]] };
  try {
    const sent = await call('sendMessage', { chat_id: chatId, text: hint, parse_mode: 'HTML', reply_markup: groupKb });
    try { db.prepare('UPDATE verify_sessions SET message_id = ? WHERE id = ?').run(String(sent.message_id), sid); } catch { /* ignore */ }
  } catch { /* ignore */ }

  // 2) 禁言新成员（等待验证）
  if (getSettingBool('grp_on_join_mute')) {
    try {
      await call('restrictChatMember', {
        chat_id: chatId, user_id: user.id,
        permissions: { can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false, can_send_videos: false, can_send_other_messages: false, can_add_web_page_previews: false },
        until_date: Math.floor(Date.now() / 1000) + timeout + 30,
      });
    } catch { /* 无权限时忽略 */ }
  }
}

async function kick(call, chatId, userId) {
  try {
    await call('banChatMember', { chat_id: chatId, user_id: userId });
    await call('unbanChatMember', { chat_id: chatId, user_id: userId, only_if_banned: true });
    return true;
  } catch { return false; }
}

async function unMute(call, chatId, userId) {
  try {
    await call('restrictChatMember', {
      chat_id: chatId, user_id: userId,
      permissions: { can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true, can_send_videos: true, can_send_other_messages: true, can_add_web_page_previews: true },
    });
    return true;
  } catch { return false; }
}

/** 处理验证按钮回调 */
export async function handleVerifyCallback(call, q) {
  const data = q.data || '';
  const from = q.from;
  const [action, sid, optEnc] = data.split(':');
  const sess = db.prepare('SELECT * FROM verify_sessions WHERE id = ?').get(sid);
  if (!sess) {
    await call('answerCallbackQuery', { callback_query_id: q.id, text: '验证已失效', show_alert: true });
    return;
  }
  if (sess.status !== 'pending') {
    await call('answerCallbackQuery', { callback_query_id: q.id, text: '该验证已结束', show_alert: true });
    return;
  }
  if (String(from.id) !== String(sess.tg_id) && action !== 'vfpass') {
    await call('answerCallbackQuery', { callback_query_id: q.id, text: '这不是发给你的验证题', show_alert: true });
    return;
  }
  const grp = getGroup(sess.chat_id);
  const groupName = grp?.title || '群组';

  // 管理员直接通过
  if (action === 'vfpass') {
    const allowed = await isExemptAdmin(call, sess.chat_id, from.id);
    if (!allowed) {
      await call('answerCallbackQuery', { callback_query_id: q.id, text: '只有群管理员可以使用该按钮', show_alert: true });
      return;
    }
    db.prepare("UPDATE verify_sessions SET status = 'passed' WHERE id = ?").run(sid);
    await unMute(call, sess.chat_id, sess.tg_id);
    logMod(sess.chat_id, sess.tg_id, sess.tg_name, 'admin_pass', `by ${from.username || from.id}`);
    await call('answerCallbackQuery', { callback_query_id: q.id, text: '已放行 ✅' });
    // 通知被放行的用户
    try {
      await call('sendMessage', { chat_id: sess.tg_id, text: `✅ 管理员已手动通过你的验证，欢迎加入 <b>${esc(groupName)}</b>！`, parse_mode: 'HTML' });
    } catch { /* ignore */ }
    return;
  }

  const opt = decodeURIComponent(optEnc || '');
  if (opt === sess.answer) {
    db.prepare("UPDATE verify_sessions SET status = 'passed' WHERE id = ?").run(sid);
    await unMute(call, sess.chat_id, sess.tg_id);
    logMod(sess.chat_id, sess.tg_id, sess.tg_name, 'verify_pass', opt);
    await call('answerCallbackQuery', { callback_query_id: q.id, text: '回答正确 ✅' });
    const okText = getSetting('grp_pass_text') ? render(getSetting('grp_pass_text'), { name: sess.tg_name, group: groupName }) : '';
    if (okText) {
      try { await call('sendMessage', { chat_id: sess.chat_id, text: okText, parse_mode: 'HTML' }); } catch { /* ignore */ }
    }
    try { await call('sendMessage', { chat_id: sess.tg_id, text: `✅ 验证通过，你已成功加入 <b>${esc(groupName)}</b>`, parse_mode: 'HTML' }); } catch { /* ignore */ }
    return;
  }

  // 答错
  const attempts = sess.attempts + 1;
  const left = sess.max_attempts - attempts;
  if (left <= 0) {
    db.prepare("UPDATE verify_sessions SET status = 'failed', attempts = ? WHERE id = ?").run(attempts, sid);
    logMod(sess.chat_id, sess.tg_id, sess.tg_name, 'verify_fail', `答案错误 ${attempts} 次`);
    await call('answerCallbackQuery', { callback_query_id: q.id, text: '回答错误，机会已用完', show_alert: true });
    if (getSettingBool('grp_kick_on_fail')) {
      await kick(call, sess.chat_id, sess.tg_id);
      const failText = getSetting('grp_fail_text') || '';
      if (failText) { try { await call('sendMessage', { chat_id: sess.chat_id, text: render(failText, { name: sess.tg_name, group: groupName }), parse_mode: 'HTML' }); } catch { /* ignore */ } }
    }
    try { await call('sendMessage', { chat_id: sess.tg_id, text: `❌ 验证失败，你已被移出 <b>${esc(groupName)}</b>`, parse_mode: 'HTML' }); } catch { /* ignore */ }
    return;
  }
  db.prepare('UPDATE verify_sessions SET attempts = ? WHERE id = ?').run(attempts, sid);
  await call('answerCallbackQuery', { callback_query_id: q.id, text: `回答错误，还剩 ${left} 次机会`, show_alert: true });
  try {
    await call('sendMessage', { chat_id: sess.tg_id, text: `❌ 回答错误，你还有 <b>${left}</b> 次机会`, parse_mode: 'HTML' });
  } catch { /* ignore */ }
}

/**
 * 用户私聊机器人时补发未送达的验证题
 * 场景：新成员入群时因「从未私聊过机器人」导致私聊失败，等用户主动发消息后补发
 */
export async function resendPendingVerify(call, tgId) {
  const sessions = db.prepare("SELECT * FROM verify_sessions WHERE tg_id = ? AND status = 'no_pm' ORDER BY id DESC LIMIT 3").all(String(tgId));
  const sentTo = [];
  for (const sess of sessions) {
    if (sess.expires_at < Date.now()) continue;
    const grp = getGroup(sess.chat_id);
    const options = JSON.parse(sess.options || '[]');
    // 重建题目：从 answer + options 反推
    const rowsOpt = [];
    let row = [];
    options.forEach((opt) => {
      row.push({ text: String(opt), callback_data: `vf:${sess.id}:${encodeURIComponent(opt)}` });
      if (row.length === 2) { rowsOpt.push(row); row = []; }
    });
    if (row.length) rowsOpt.push(row);
    if (getSettingBool('grp_show_admin_pass')) rowsOpt.push([{ text: '✅ 群管理员直接通过', callback_data: `vfpass:${sess.id}` }]);
    const left = Math.max(0, Math.floor((sess.expires_at - Date.now()) / 1000));
    const text = [
      '🔐 <b>入群验证</b>',
      '',
      `群组：<b>${esc(grp?.title || '群组')}</b>`,
      `请从下方选项中选出正确答案（你之前入群时未收到题目）`,
      '',
      `剩余时间：<b>${left}</b> 秒 · 机会：<b>${sess.max_attempts}</b> 次`,
    ].join('\n');
    try {
      await call('sendMessage', { chat_id: tgId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: rowsOpt } });
      db.prepare("UPDATE verify_sessions SET status = 'pending' WHERE id = ?").run(sess.id);
      sentTo.push(grp?.title || sess.chat_id);
    } catch { /* ignore */ }
  }
  return sentTo;
}

/** 查询该成员是否处于待验证状态 */
export function getPendingVerify(chatId, tgId) {
  return db.prepare("SELECT * FROM verify_sessions WHERE chat_id = ? AND tg_id = ? AND status = 'pending'")
    .get(String(chatId), String(tgId)) || null;
}

/** 超时清理（由主循环定时调用） */
export async function cleanupExpired(call) {
  const rows = db.prepare("SELECT * FROM verify_sessions WHERE status = 'pending' AND expires_at < ?").all(Date.now());
  for (const sess of rows) {
    db.prepare("UPDATE verify_sessions SET status = 'timeout' WHERE id = ?").run(sess.id);
    logMod(sess.chat_id, sess.tg_id, sess.tg_name, 'verify_timeout', '');
    if (getSettingBool('grp_kick_on_fail')) {
      await kick(call, sess.chat_id, sess.tg_id);
      const t = getSetting('grp_timeout_text');
      const grp = getGroup(sess.chat_id);
      if (t) { try { await call('sendMessage', { chat_id: sess.chat_id, text: render(t, { name: sess.tg_name, group: grp?.title || '' }), parse_mode: 'HTML' }); } catch { /* ignore */ } }
    }
    try { await call('sendMessage', { chat_id: sess.tg_id, text: '⏰ 验证超时，你已被移出群组' }); } catch { /* ignore */ }
  }
  return rows.length;
}

// ---------------------------------------------------------------
// 内容检测
// ---------------------------------------------------------------
// 只识别真正像链接的内容：http(s)://、www.、或带常见 TLD 的域名（排除 t.me 这类纯提及）
const TLD = 'com|cn|net|org|io|xyz|top|cc|vip|app|dev|link|info|biz|shop|site|online|club|work|live|ltd|tech|store|space|fun|icu|pro';
const LINK_RE = new RegExp(
  '(https?:\\/\\/[^\\s]+)'                                  // http(s)://...
  + '|(www\\.[a-z0-9-]+\\.[a-z]{2,})'                        // www.xxx.xx
  + '|(\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:' + TLD + ')\\b(?!\\.)[\\/]?[^\\s]*)', // xxx.com/path
  'i',
);
// Telegram 链接单独识别（用于判断是否为推广链接，而不是普通提及）
const TG_LINK_RE = /(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/[a-z0-9_]+/i;

function muteMinutes() {
  return getSettingNum('grp_word_mute_minutes') || 5;
}

async function applyAction(call, chatId, msg, action, reason, muteMin, label) {
  const userId = msg.from?.id;
  const name = msg.from?.username || msg.from?.first_name || '';
  const done = [];
  const errors = [];

  // 1) 删除消息
  let deleted = false;
  try {
    await call('deleteMessage', { chat_id: chatId, message_id: msg.message_id });
    deleted = true;
    done.push('已删除消息');
  } catch (e) {
    errors.push('删除失败（机器人需要「删除消息」权限）');
  }

  // 2) 禁言
  if ((action === 'mute' || action === 'delete_mute') && userId) {
    try {
      await call('restrictChatMember', {
        chat_id: chatId, user_id: userId,
        permissions: {
          can_send_messages: false, can_send_audios: false, can_send_documents: false,
          can_send_photos: false, can_send_videos: false, can_send_other_messages: false,
          can_add_web_page_previews: false,
        },
        until_date: Math.floor(Date.now() / 1000) + muteMin * 60,
      });
      done.push(`已禁言 ${muteMin} 分钟`);
    } catch (e) {
      errors.push('禁言失败（机器人需要「限制成员」权限）');
    }
  }

  // 3) 踢出
  if (action === 'kick' && userId) {
    try {
      await call('banChatMember', { chat_id: chatId, user_id: userId });
      await call('unbanChatMember', { chat_id: chatId, user_id: userId, only_if_banned: true });
      done.push('已踢出');
    } catch (e) {
      errors.push('踢出失败（机器人需要「封禁用户」权限）');
    }
  }

  logMod(chatId, userId, name, `filter_${action}`, `${label}: ${reason} | ${done.join('/')}${errors.length ? ' | 失败:' + errors.join('/') : ''}`.slice(0, 300));

  // 如实回报：没做成什么就明确说
  const who = esc(msg.from?.first_name || msg.from?.username || '用户');
  let text;
  if (done.length && !errors.length) {
    text = `🚫 <b>${who}</b> 的消息已拦截（${esc(label)}）\n${done.join('，')}`;
  } else if (done.length) {
    text = `⚠️ <b>${who}</b> 的消息部分拦截（${esc(label)}）\n成功：${done.join('，')}\n失败：${errors.join('；')}`;
  } else {
    text = `⚠️ <b>${who}</b> 的消息命中「${esc(label)}」，但<b>无法执行处理</b>：\n${errors.join('；')}\n\n👉 请把机器人设为管理员并开启对应权限`;
  }
  try {
    await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_to_message_id: msg.message_id });
  } catch {
    try { await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' }); } catch { /* ignore */ }
  }
  return { deleted, done, errors };
}

/**
 * 消息内容检测（违禁词/链接/二维码/转发/@所有人）
 */
export async function checkMessage(call, msg, chatId) {
  const s = getSettings();
  if (s.grp_word_filter_enabled !== '1') return false;
  const text = msg.text || msg.caption || '';
  const grp = getGroup(chatId);
  void grp;

  // 频道帖子没有 from 字段；频道帖转发到群时 from 是频道（sender_chat），均视为管理员发布
  const isChannelMsg = msg.chat?.type === 'channel';
  if (msg.sender_chat?.type === 'channel') return false;   // 频道自动转发到讨论群 -> 放行
  if (msg.is_automatic_forward) return false;               // Telegram 自动转发标记 -> 放行
  // 0) 白名单：指定用户、管理员、链接白名单
  const uid = msg.from?.id;
  // 频道帖（无 from 或 from.id 与 sender_chat 相同）直接放行
  if (msg.chat?.type === 'channel' && !uid) return false;
  const wlUsers = String(s.grp_filter_whitelist || '').split(/[,\s]+/).filter(Boolean);
  if (uid && wlUsers.includes(String(uid))) return false;

  // 管理员豁免
  if (s.grp_admin_bypass === '1' && uid) {
    try {
      const m = await call('getChatMember', { chat_id: chatId, user_id: uid });
      if (['creator', 'administrator'].includes(m.status)) return false;
    } catch { /* ignore */ }
  }

  // 链接白名单：包含这些关键词的链接不拦截
  // 链接白名单：仅当发送者也在白名单内时才生效（避免陌生人发白名单链接也放行）
  const linkWl = String(s.grp_link_whitelist || '').split(/[,\s]+/).filter(Boolean);
  const senderTrusted = uid && wlUsers.includes(String(uid));
  const skipLink = senderTrusted && linkWl.length > 0
    && linkWl.some((w) => text.toLowerCase().includes(w.toLowerCase()));
  const action = s.grp_word_action || 'delete_mute';
  const muteMin = muteMinutes();

  // 1) 违禁词
  if (s.grp_filter_words === '1') {
    const words = db.prepare('SELECT * FROM banned_words WHERE enabled = 1').all();
    const lower = text.toLowerCase();
    for (const w of words) {
      if (!w.word) continue;
      const hit = w.category === 'regex'
        ? (() => { try { return new RegExp(w.word, 'i').test(text); } catch { return false; } })()
        : lower.includes(String(w.word).toLowerCase());
      if (hit) {
        await applyAction(call, chatId, msg, w.action || action, w.word, w.mute_minutes || muteMin, '违禁词');
        return true;
      }
    }
  }

  // 2) 链接（支持白名单豁免）
  if (!skipLink && s.grp_filter_links === '1' && (LINK_RE.test(text) || TG_LINK_RE.test(text))) {
    await applyAction(call, chatId, msg, action, text.slice(0, 40), muteMin, '链接/广告');
    return true;
  }

  // 3) 二维码/图片（频道帖子不按图片拦截，避免误删正常配图）
  const isChannelPost = msg.chat?.type === 'channel';
  if (!isChannelPost && s.grp_filter_qrcode === '1' && (msg.photo || msg.document?.mime_type?.startsWith('image/'))) {
    await applyAction(call, chatId, msg, action, '图片/二维码', muteMin, '图片/二维码');
    return true;
  }

  // 4) 转发消息
  if (s.grp_filter_forward === '1' && (msg.forward_origin || msg.forward_from || msg.forward_from_chat)) {
    await applyAction(call, chatId, msg, action, '转发消息', muteMin, '转发');
    return true;
  }

  // 5) @所有人
  if (s.grp_filter_mention_all === '1' && /@all\b|@everyone\b/i.test(text)) {
    await applyAction(call, chatId, msg, action, '@所有人', muteMin, '@所有人');
    return true;
  }

  // 6) 刷屏
  if (s.grp_flood_enabled === '1') {
    const limit = getSettingNum('grp_flood_limit') || 8;
    const window = getSettingNum('grp_flood_window') || 10;
    const key = `flood_${chatId}_${msg.from?.id}`;
    const nowMs = Date.now();
    const bucket = (globalThis.__flood || (globalThis.__flood = new Map()));
    const arr = (bucket.get(key) || []).filter((t) => nowMs - t < window * 1000);
    arr.push(nowMs);
    bucket.set(key, arr);
    if (arr.length >= limit) {
      bucket.delete(key);
      const fa = s.grp_flood_action || 'mute';
      const fm = getSettingNum('grp_flood_mute_minutes') || 10;
      await applyAction(call, chatId, msg, fa === 'delete' ? 'delete' : fa, `刷屏 ${arr.length} 条/${window}秒`, fm, '刷屏');
      return true;
    }
  }
  return false;
}

export { logMod, now };
