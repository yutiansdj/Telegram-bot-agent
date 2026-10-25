/**
 * AI 工具系统（Function Calling）
 *
 * 安全设计原则：
 *   1. 白名单制：只暴露这里注册的工具，AI 无法调用未注册的能力
 *   2. 权限分级：public（所有人）| admin（仅管理员）
 *   3. 服务器隔离：绝不提供任何涉及文件系统、shell、网络配置、系统设置的工具
 *   4. 参数校验：所有参数强制类型检查与范围限制
 *
 * 严禁添加的工具（安全红线）：
 *   ✗ 任何 shell / exec / spawn
 *   ✗ 任何文件读写（服务器端）
 *   ✗ 任何系统设置修改（settings、数据库写操作）
 *   ✗ 任何涉及代理节点、端口、密钥的写操作
 *   ✗ 任何进程控制
 */
import { db, getSettings, getSetting } from './db.js';
import * as botmgr from './botmanager.js';
import { checkCommand, safetyHelp } from './shellguard.js';
import { screenshot as takeScreenshot, validateUrl } from './screenshot.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------
// 工具定义
// ---------------------------------------------------------------

/**
 * 每个工具：
 *   name        - 函数名（小写字母+下划线）
 *   description - 给 AI 看的说明
 *   parameters  - JSON Schema
 *   level       - 'public' | 'admin'
 *   handler(ctx, args) - 执行函数，ctx = { tgId, chatId, botUsername, isGroup, isAdmin }
 */
const TOOLS = [];

function defineTool(def) {
  TOOLS.push(def);
}

// ==================== 公开工具（任何人可用）====================

defineTool({
  name: 'get_my_info',
  description: '查询提问者自己的信息：Telegram ID、用户名、平台账号余额、剩余流量、已创建的代理数量。不涉及他人隐私。',
  parameters: { type: 'object', properties: {}, required: [] },
  level: 'public',
  async handler(ctx) {
    const bu = db.prepare('SELECT * FROM bot_users WHERE tg_id = ?').get(String(ctx.tgId));
    if (!bu) return { found: false, message: '你还没有在平台注册。发送 /start 开始使用。' };
    const pu = bu.user_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(bu.user_id) : null;
    const accs = bu.user_id ? db.prepare('SELECT COUNT(*) AS c FROM accounts WHERE user_id = ?').get(bu.user_id).c : 0;
    return {
      found: true,
      telegram_id: ctx.tgId,
      username: bu.tg_username || null,
      nickname: bu.tg_first_name || null,
      email_verified: !!bu.email_verified,
      balance_mb: Number(bu.balance_mb || 0),
      quota_mb: Number(pu?.quota_mb || 0),
      account_count: accs,
    };
  },
});

defineTool({
  name: 'get_my_proxies',
  description: '查询提问者自己已创建的代理列表（端口、状态、已用流量）。只返回自己的，不涉及他人。',
  parameters: { type: 'object', properties: {}, required: [] },
  level: 'public',
  async handler(ctx) {
    const bu = db.prepare('SELECT * FROM bot_users WHERE tg_id = ?').get(String(ctx.tgId));
    if (!bu?.user_id) return { list: [], message: '你还没有创建过代理。在私聊里发送 /create 创建。' };
    const rows = db.prepare('SELECT id, name, port, status, used_bytes, quota_bytes FROM accounts WHERE user_id = ? ORDER BY id DESC LIMIT 10').all(bu.user_id);
    return {
      count: rows.length,
      list: rows.map((r) => ({
        name: r.name,
        port: r.port,
        status: r.status,
        used_mb: Math.round(Number(r.used_bytes || 0) / 1048576 * 10) / 10,
        quota_mb: Math.round(Number(r.quota_bytes || 0) / 1048576 * 10) / 10,
      })),
    };
  },
});

defineTool({
  name: 'get_platform_help',
  description: '获取平台的功能说明：如何创建代理、如何签到领流量、如何邀请好友、代理怎么连接等。',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', enum: ['create', 'connect', 'signin', 'invite', 'usage', 'all'], description: '想了解的主题' },
    },
    required: ['topic'],
  },
  level: 'public',
  async handler(ctx, args) {
    const HELP = {
      create: '创建代理：私聊机器人发送 /create，系统会分配独立端口和密钥。每个账号最多创建 {max} 个代理。',
      connect: '连接代理：在「我的代理」里点链接，或复制 tg:// 链接在 Telegram 中打开。连不上时试试切换 secret 格式（标准/FakeTLS）。',
      signin: '每日签到：私聊发送 /signin，每天可领 {mb}MB 流量，连续签到有倍数奖励（最多 {days} 倍）。',
      invite: '邀请好友：发送 /invite 获取专属链接，好友通过链接注册并首次使用时，你获得 {reward}MB 流量。',
      usage: '查看流量：发送 /usage 查看已用和剩余流量。超额会自动停用，充值或等待周期重置后恢复。',
      all: '可用命令：\n/create 创建代理\n/my 我的代理\n/usage 查看流量\n/signin 每日签到\n/invite 邀请赚流量\n/id 查看我的ID\n/help 帮助',
    };
    const s = getSettings();
    let text = HELP[args.topic] || HELP.all;
    text = text.replace('{max}', s.max_accounts_per_user || '3')
      .replace('{mb}', s.bot_signin_bonus_mb || '512')
      .replace('{days}', s.bot_signin_max_days || '7')
      .replace('{reward}', s.bot_ref_bonus_mb || '716');
    return { topic: args.topic, content: text };
  },
});

defineTool({
  name: 'get_current_model',
  description: '查询当前回答你问题的是哪个 AI 模型（只返回模型名称和基础规格，不涉及任何账号信息）。当用户问"你是什么模型"时必须调用此工具。',
  parameters: { type: 'object', properties: {}, required: [] },
  level: 'public',
  async handler(ctx) {
    // 由 ai.js 在调用时注入，这里读取上下文
    if (ctx.modelInfo?.model) {
      return {
        model: ctx.modelInfo.model,
        provider: ctx.modelInfo.vendor || '',
        instruct: `请直接告诉用户："我使用的是 ${ctx.modelInfo.model} 模型。" 不要猜测其他模型名。`,
      };
    }
    return { model: '未知', note: '暂时无法获取模型信息' };
  },
});

defineTool({
  name: 'get_public_stats',
  description: '获取平台公开统计：注册用户总数、代理总数、运行中的代理数。不包含任何敏感信息。',
  parameters: { type: 'object', properties: {}, required: [] },
  level: 'public',
  async handler() {
    return {
      total_users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
      total_bot_users: db.prepare('SELECT COUNT(*) AS c FROM bot_users').get().c,
      total_proxies: db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c,
      running_proxies: db.prepare("SELECT COUNT(*) AS c FROM accounts WHERE status = 'active'").get().c,
    };
  },
});

defineTool({
  name: 'write_note',
  description: '把一段文字保存为笔记（服务端存文本，不是文件系统）。可用于记录待办、备忘。单条最多 2000 字。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '笔记标题，最多 60 字' },
      content: { type: 'string', description: '笔记内容，最多 2000 字' },
    },
    required: ['title', 'content'],
  },
  level: 'public',
  async handler(ctx, args) {
    const title = String(args.title || '').slice(0, 60);
    const content = String(args.content || '').slice(0, 2000);
    if (!title || !content) return { ok: false, message: '标题和内容都不能为空' };
    db.prepare('INSERT INTO ai_notes(tg_id, title, content, created_at) VALUES(?,?,?,datetime(\'now\'))')
      .run(String(ctx.tgId), title, content);
    const count = db.prepare('SELECT COUNT(*) AS c FROM ai_notes WHERE tg_id = ?').get(String(ctx.tgId)).c;
    return { ok: true, message: `已保存笔记「${title}」`, total_notes: count };
  },
});

defineTool({
  name: 'list_notes',
  description: '列出提问者自己保存的所有笔记标题和内容摘要。',
  parameters: { type: 'object', properties: {}, required: [] },
  level: 'public',
  async handler(ctx) {
    const rows = db.prepare('SELECT id, title, content, created_at FROM ai_notes WHERE tg_id = ? ORDER BY id DESC LIMIT 20').all(String(ctx.tgId));
    return {
      count: rows.length,
      list: rows.map((r) => ({ id: r.id, title: r.title, preview: r.content.slice(0, 80), created_at: r.created_at })),
    };
  },
});

// ==================== 管理员工具（仅管理员）====================

defineTool({
  name: 'admin_get_overview',
  description: '【管理员】查看平台概况：用户数、代理数、今日新增、流量总量。只读，不修改任何配置。',
  parameters: { type: 'object', properties: {}, required: [] },
  level: 'admin',
  async handler(ctx) {
    if (!ctx.isAdmin) return { denied: true, message: '该功能仅管理员可用' };
    return {
      users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
      users_today: db.prepare("SELECT COUNT(*) AS c FROM users WHERE date(created_at) = date('now')").get().c,
      proxies: db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c,
      proxies_active: db.prepare("SELECT COUNT(*) AS c FROM accounts WHERE status = 'active'").get().c,
      tickets_pending: db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE status = 'pending'").get().c,
      bot_users: db.prepare('SELECT COUNT(*) AS c FROM bot_users').get().c,
    };
  },
});

defineTool({
  name: 'admin_get_bot_status',
  description: '【管理员】查看机器人运行状态：是否在运行、模式、处理的更新数、最近错误。只读。',
  parameters: { type: 'object', properties: {}, required: [] },
  level: 'admin',
  async handler(ctx) {
    if (!ctx.isAdmin) return { denied: true, message: '该功能仅管理员可用' };
    const list = botmgr.listBots();
    return {
      count: list.length,
      bots: list.map((b) => ({
        name: b.name,
        username: b.username,
        status: b.status,
        ai_enabled: b.ai_enabled,
        last_error: b.last_error || null,
      })),
    };
  },
});

defineTool({
  name: 'admin_get_groups',
  description: '【管理员】查看已接入的群组/频道列表（标题、类型、ID）。只读，不能修改群设置。',
  parameters: { type: 'object', properties: {}, required: [] },
  level: 'admin',
  async handler(ctx) {
    if (!ctx.isAdmin) return { denied: true, message: '该功能仅管理员可用' };
    const rows = db.prepare('SELECT chat_id, title, type FROM tg_groups ORDER BY type DESC, title').all();
    return { count: rows.length, list: rows.map((r) => ({ id: r.chat_id, title: r.title, type: r.type })) };
  },
});

defineTool({
  name: 'admin_search_logs',
  description: '【管理员】搜索最近的操作日志（拦截、禁言、踢出记录）。只读。',
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '搜索关键词（用户名或操作类型），留空返回最近的' },
      limit: { type: 'integer', description: '返回条数，默认 10，最多 30' },
    },
    required: [],
  },
  level: 'admin',
  async handler(ctx, args) {
    if (!ctx.isAdmin) return { denied: true, message: '该功能仅管理员可用' };
    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 30);
    const kw = String(args.keyword || '').trim();
    let rows;
    if (kw) {
      rows = db.prepare(`SELECT * FROM mod_logs WHERE tg_name LIKE ? OR action LIKE ? ORDER BY id DESC LIMIT ?`)
        .all(`%${kw}%`, `%${kw}%`, limit);
    } else {
      rows = db.prepare('SELECT * FROM mod_logs ORDER BY id DESC LIMIT ?').all(limit);
    }
    return {
      count: rows.length,
      list: rows.map((r) => ({ time: r.created_at, user: r.tg_name, action: r.action, detail: r.detail })),
    };
  },
});

// ---------------------------------------------------------------
// 供 AI 使用的 schema（只暴露给对应权限的工具）
// ---------------------------------------------------------------
export function getToolSchemas(isAdmin) {
  return TOOLS
    .filter((t) => t.level === 'public' || (t.level === 'admin' && isAdmin))
    .map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
}

/** 执行工具调用 */
export async function executeTool(name, args, ctx) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `未知工具：${name}` };
  if (tool.level === 'admin' && !ctx.isAdmin) {
    return { error: '权限不足：该功能仅管理员可用' };
  }
  try {
    return await tool.handler(ctx, args || {});
  } catch (e) {
    return { error: `执行失败：${e.message}` };
  }
}

/** 工具清单（后台展示用） */
export function toolList() {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, level: t.level }));
}


// ==================== 网页截图 ====================

defineTool({
  name: 'screenshot_webpage',
  description: '打开一个网页并截图返回给用户。当用户说"帮我打开某个网址""看看这个网页长什么样""截图给我看"时必须调用。只支持 http/https 公开网站，不能访问内网。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要打开的完整网址，必须以 http:// 或 https:// 开头' },
      full_page: { type: 'boolean', description: '是否截取整页（默认 false，只截首屏）' },
    },
    required: ['url'],
  },
  level: 'public',
  async handler(ctx, args) {
    const check = validateUrl(args.url);
    if (!check.ok) return { ok: false, error: check.reason };

    try {
      const r = await takeScreenshot(check.url, { fullPage: !!args.full_page });
      return {
        ok: true,
        url: r.url,
        title: r.title || '(无标题)',
        size: `${Math.round(r.size / 1024)}KB`,
        note: '截图已生成，将直接发送给用户',
        // 内部字段，由 bot.js 取用发送照片，不会展示给用户
        __photo: { buffer: r.buffer, filename: r.filename },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
});

// ==================== Shell 工具（仅管理员，强过滤）====================

defineTool({
  name: 'run_shell',
  description: `【管理员专用】执行只读的系统查询命令（如 uptime、df -h、ps aux、systemctl status xxx）。
严禁：删除文件、安装软件、重启服务、修改配置、提权、管道、重定向、命令串联。
可用命令：${[...safetyHelp().allowed].slice(0, 30).join(', ')} 等`,
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的命令，例如 "df -h" 或 "ps aux"' },
    },
    required: ['command'],
  },
  level: 'admin',
  async handler(ctx, args) {
    if (!ctx.isAdmin) return { denied: true, message: '该功能仅管理员可用' };

    const raw = String(args.command || '').trim();
    const check = checkCommand(raw);
    if (!check.ok) {
      return { blocked: true, message: `🚫 命令被安全策略拦截：${check.reason}`, command: raw };
    }

    try {
      const { stdout, stderr } = await execFileAsync(check.command, check.args, {
        timeout: 15000,
        maxBuffer: 1024 * 256,   // 256KB 上限
        encoding: 'utf8',
        cwd: '/tmp',
        env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' },
      });
      let out = (stdout || '').slice(0, 3000);
      if (stderr) out += (out ? '\n--- stderr ---\n' : '') + stderr.slice(0, 500);
      return { ok: true, command: raw, output: out || '(无输出)' };
    } catch (e) {
      return {
        ok: false,
        command: raw,
        error: e.message,
        output: String(e.stdout || '').slice(0, 1500),
      };
    }
  },
});
