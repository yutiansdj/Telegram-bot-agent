/**
 * 多机器人管理器
 *
 * - 每个机器人独立 Token、独立轮询循环、独立状态
 * - 通过 AsyncLocalStorage 隔离上下文，业务代码无需改动
 * - 支持主机器人（沿用原有 settings 里的 Token，兼容升级）
 */
import { db, getSetting, setSetting, getSettings } from './db.js';
import * as bot from './bot.js';

const API = 'https://api.telegram.org';

/** botId -> { running, mode, me, offset, startedAt, lastError, lastUpdateAt, counters, timer, token } */
const instances = new Map();

function rowById(id) {
  return db.prepare('SELECT * FROM bots WHERE id = ?').get(Number(id));
}

export function listBots() {
  const rows = db.prepare('SELECT * FROM bots ORDER BY is_primary DESC, id ASC').all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    username: r.username,
    display_name: r.display_name,
    enabled: !!r.enabled,
    is_primary: !!r.is_primary,
    mode: r.mode,
    ai_enabled: !!r.ai_enabled,
    has_token: !!r.token,
    token: r.token ? r.token.slice(0, 8) + '****' + r.token.slice(-4) : '',
    status: instances.get(r.id)?.running ? 'running' : 'stopped',
    started_at: instances.get(r.id)?.startedAt || null,
    last_error: instances.get(r.id)?.lastError || r.last_error || '',
    me: instances.get(r.id)?.me || null,
  }));
}

export function getInstance(id) {
  return instances.get(Number(id)) || null;
}

/** 从 Telegram 校验 Token */
export async function verifyToken(token) {
  const res = await fetch(`${API}/bot${token}/getMe`, { signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || 'Token 无效');
  return data.result;
}

export async function createBot({ name, token }) {
  if (!token) throw new Error('Token 不能为空');
  const me = await verifyToken(token);
  const exists = db.prepare('SELECT id FROM bots WHERE username = ?').get(me.username);
  if (exists) throw new Error(`机器人 @${me.username} 已存在`);
  const count = db.prepare('SELECT COUNT(*) AS c FROM bots').get().c;
  const info = db.prepare(`INSERT INTO bots(name, token, username, display_name, is_primary, ai_enabled, enabled)
                            VALUES(?,?,?,?,0,1,1)`)
    .run(name || me.first_name || me.username, token, me.username, me.first_name || '');
  return rowById(info.lastInsertRowid);
}

export async function updateBot(id, patch) {
  const b = rowById(id);
  if (!b) throw new Error('机器人不存在');
  const fields = [];
  const args = [];
  if (patch.name !== undefined) { fields.push('name = ?'); args.push(String(patch.name).slice(0, 64)); }
  if (patch.ai_enabled !== undefined) { fields.push('ai_enabled = ?'); args.push(patch.ai_enabled ? 1 : 0); }
  if (patch.enabled !== undefined) { fields.push('enabled = ?'); args.push(patch.enabled ? 1 : 0); }
  if (patch.ai_persona !== undefined) { fields.push('ai_persona = ?'); args.push(String(patch.ai_persona).slice(0, 4000)); }
  if (patch.welcome !== undefined) { fields.push('welcome = ?'); args.push(String(patch.welcome).slice(0, 4000)); }
  if (patch.mode !== undefined) { fields.push('mode = ?'); args.push(patch.mode === 'webhook' ? 'webhook' : 'polling'); }
  if (patch.webhook_url !== undefined) { fields.push('webhook_url = ?'); args.push(String(patch.webhook_url)); }
  if (patch.webhook_secret !== undefined) { fields.push('webhook_secret = ?'); args.push(String(patch.webhook_secret)); }
  if (patch.token) {
    const me = await verifyToken(patch.token);
    fields.push('token = ?'); args.push(patch.token);
    fields.push('username = ?'); args.push(me.username);
    fields.push('display_name = ?'); args.push(me.first_name || '');
  }
  if (!fields.length) return rowById(id);
  fields.push("updated_at = datetime('now')");
  db.prepare(`UPDATE bots SET ${fields.join(', ')} WHERE id = ?`).run(...args, id);
  return rowById(id);
}

export async function deleteBot(id) {
  const b = rowById(id);
  if (!b) throw new Error('机器人不存在');
  if (b.is_primary) throw new Error('主机器人不能删除');
  await stopBot(id);
  db.prepare('DELETE FROM bots WHERE id = ?').run(id);
  return true;
}

// ---------------------------------------------------------------
// 启动 / 停止
// ---------------------------------------------------------------
async function pollLoop(id) {
  const inst = instances.get(id);
  while (inst && inst.running) {
    try {
      const updates = await bot.botCtx.run(inst, () => bot.__internalGetUpdates(inst.offset));
      for (const u of updates) {
        inst.offset = Math.max(inst.offset, u.update_id + 1);
        inst.lastUpdateAt = new Date().toISOString();
        inst.counters.updates++;
        try {
          await bot.botCtx.run(inst, () => bot.__internalProcessUpdate(u));
        } catch (e) {
          inst.counters.errors++;
          inst.lastError = e.message;
        }
      }
    } catch (e) {
      inst.lastError = e.message;
      inst.counters.errors++;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

export async function startBot(id) {
  const b = rowById(id);
  if (!b) throw new Error('机器人不存在');
  const existing = instances.get(Number(id));
  if (existing?.running) return { ok: true, already: true };

  const me = await verifyToken(b.token);
  const inst = {
    botId: Number(id),
    token: b.token,
    row: b,
    running: true,
    mode: b.mode || 'polling',
    me,
    offset: 0,
    startedAt: new Date().toISOString(),
    lastError: '',
    lastUpdateAt: null,
    counters: { updates: 0, messages: 0, commands: 0, errors: 0 },
    state: null,
  };
  inst.state = inst; // 让 ctxState() 可用
  instances.set(Number(id), inst);

  // 回写账号信息
  db.prepare("UPDATE bots SET username = ?, display_name = ?, status = 'running', last_error = NULL, started_at = datetime('now') WHERE id = ?")
    .run(me.username || '', me.first_name || '', id);

  // 主机器人同步到旧设置（兼容）
  if (b.is_primary) {
    setSetting('bot_username', me.username || '');
    setSetting('bot_name', me.first_name || '');
    if (me.username) setSetting('bot_link', `https://t.me/${me.username}`);
  }

  if (b.mode === 'webhook' && b.webhook_url) {
    await bot.botCtx.run(inst, () => bot.__internalSetWebhook(b.webhook_url, b.webhook_secret));
  } else {
    await bot.botCtx.run(inst, () => bot.__internalDeleteWebhook()).catch(() => {});
    pollLoop(Number(id));
  }
  return { ok: true, me };
}

export async function stopBot(id) {
  const inst = instances.get(id);
  if (!inst) return { ok: true, already: true };
  inst.running = false;
  if (inst.mode === 'webhook') {
    try { await bot.botCtx.run(inst, () => bot.__internalDeleteWebhook()); } catch { /* ignore */ }
  }
  instances.delete(Number(id));
  db.prepare("UPDATE bots SET status = 'stopped' WHERE id = ?").run(id);
  return { ok: true };
}

export async function restartBot(id) {
  await stopBot(id);
  await new Promise((r) => setTimeout(r, 500));
  return startBot(id);
}

/** 启动全部启用中的机器人 */
export async function startAll() {
  const rows = db.prepare('SELECT * FROM bots WHERE enabled = 1').all();
  const result = [];
  for (const r of rows) {
    try {
      await startBot(r.id);
      result.push({ id: r.id, ok: true });
    } catch (e) {
      db.prepare('UPDATE bots SET last_error = ? WHERE id = ?').run(String(e.message).slice(0, 300), r.id);
      result.push({ id: r.id, ok: false, error: e.message });
    }
  }
  return result;
}

export async function stopAll() {
  for (const id of [...instances.keys()]) await stopBot(id);
}

/** 升级兼容：把旧的 settings.bot_token 迁移成主机器人 */
export async function migrateLegacy() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM bots').get().c;
  if (count > 0) return { migrated: false };
  const token = getSetting('bot_token').trim();
  if (!token) return { migrated: false };
  try {
    const me = await verifyToken(token);
    db.prepare(`INSERT INTO bots(name, token, username, display_name, is_primary, enabled, mode, ai_enabled)
                VALUES(?,?,?,?,1,?,?,1)`)
      .run(me.first_name || me.username || '主机器人', token, me.username, me.first_name || '',
        getSetting('bot_enabled') === '1' ? 1 : 0, getSetting('bot_webhook_mode') === '1' ? 'webhook' : 'polling');
    return { migrated: true, username: me.username };
  } catch (e) {
    return { migrated: false, error: e.message };
  }
}

/** Webhook 入口：按 URL 里的 botId 路由 */
export async function handleWebhook(botId, req, body) {
  const inst = instances.get(Number(botId));
  if (!inst?.running) return false;
  const secret = inst.row?.webhook_secret;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) return false;
  await bot.botCtx.run(inst, async () => {
    await bot.__internalProcessUpdate(body);
  });
  return true;
}

/** 广播（指定机器人实例） */
export async function broadcastWith(botId, payload) {
  const inst = instances.get(Number(botId));
  if (!inst) throw new Error('该机器人未运行');
  return bot.botCtx.run(inst, () => bot.__internalBroadcast(payload));
}
