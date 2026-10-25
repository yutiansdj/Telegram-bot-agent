/**
 * AI 助手模块
 *
 * 支持多供应商（OpenAI 兼容协议）：
 *   openai / deepseek / moonshot(Kimi) / zhipu(智谱) / qwen(通义) / custom(自建)
 *
 * 功能：
 *   - 多套 AI 配置，可切换默认
 *   - 会话上下文（按用户保留最近 N 轮）
 *   - 失败自动降级到下一个可用配置
 *   - 记录调用日志与耗时
 */
import { db, getSettings, getSetting, getSettingNum, getSettingBool } from './db.js';
import { getToolSchemas, executeTool as rawExecuteTool } from './aitools.js';

// ---------------------------------------------------------------
// 供应商预设
// ---------------------------------------------------------------
export const AI_PRESETS = {
  openai: { name: 'OpenAI', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  deepseek: { name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  moonshot: { name: 'Moonshot (Kimi)', base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  zhipu: { name: '智谱 GLM', base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  qwen: { name: '通义千问', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
  siliconflow: { name: '硅基流动', base_url: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
  openrouter: { name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  workbuddy: { name: 'WorkBuddy（已登录账号）', base_url: 'workbuddy://', model: '' },
  custom: { name: '自定义（OpenAI 兼容）', base_url: '', model: '' },
};

/** 供应商显示名（不含任何账号信息） */
function PRESET_LABEL(provider) {
  const p = AI_PRESETS[provider];
  return p ? p.name : provider;
}

export function aiPresetList() {
  return Object.entries(AI_PRESETS).map(([k, v]) => ({ value: k, label: v.name, ...v }));
}

// ---------------------------------------------------------------
// 会话上下文（内存，按 chatId+tgId 隔离）
// ---------------------------------------------------------------
/**
 * 会话历史：持久化到数据库，服务重启不丢失
 * 按 (botId, chatId, tgId) 隔离，每个用户在每个群有独立上下文
 */
function historyKey(botId, chatId, tgId) {
  return { botId: Number(botId) || 0, chatId: String(chatId), tgId: String(tgId) };
}

/** 读取历史（最近 N 轮） */
export function loadHistory(botId, chatId, tgId) {
  const max = Math.min(Math.max(getSettingNum('ai_max_history') || 10, 0), 50);
  if (!max) return [];
  const k = historyKey(botId, chatId, tgId);
  const rows = db.prepare(`SELECT role, content FROM ai_conversations
    WHERE bot_id = ? AND chat_id = ? AND tg_id = ?
    ORDER BY id DESC LIMIT ?`).all(k.botId, k.chatId, k.tgId, max * 2);

  // 过滤掉指令类内容（模型切换、重置等不应进入 AI 上下文）
  const CMD_RE = /^(所有模型|全部模型|模型列表|可用模型|models?|切换模型|换模型|用模型|switch|\/reset|\/clear|\/newchat)$/i;
  return rows.reverse()
    .filter((r) => !(r.role === 'user' && CMD_RE.test(String(r.content || '').trim())))
    .filter((r) => !(r.role === 'assistant' && /无法查询模型列表|不支持由我切换|已切换到|已恢复使用系统默认模型|已清空/.test(String(r.content || ''))))
    .map((r) => ({ role: r.role, content: r.content }));
}

/** 追加一条消息 */
function pushHistory(botId, chatId, tgId, role, content) {
  const k = historyKey(botId, chatId, tgId);
  try {
    db.prepare('INSERT INTO ai_conversations(bot_id, chat_id, tg_id, role, content) VALUES(?,?,?,?,?)')
      .run(k.botId, k.chatId, k.tgId, role, String(content).slice(0, 4000));
    // 只保留最近 40 条，避免无限增长
    const max = Math.min(Math.max(getSettingNum('ai_max_history') || 10, 0), 50) * 2;
    if (max > 0) {
      db.prepare(`DELETE FROM ai_conversations WHERE bot_id = ? AND chat_id = ? AND tg_id = ?
        AND id NOT IN (SELECT id FROM ai_conversations WHERE bot_id = ? AND chat_id = ? AND tg_id = ?
        ORDER BY id DESC LIMIT ?)`)
        .run(k.botId, k.chatId, k.tgId, k.botId, k.chatId, k.tgId, max);
    }
  } catch { /* ignore */ }
}

/** 清空某用户的对话历史 */
export function clearHistory(botId, chatId, tgId) {
  const k = historyKey(botId, chatId, tgId);
  db.prepare('DELETE FROM ai_conversations WHERE bot_id = ? AND chat_id = ? AND tg_id = ?')
    .run(k.botId, k.chatId, k.tgId);
}

// ---------------------------------------------------------------
// 配置
// ---------------------------------------------------------------
export function getDefaultAiConfig() {
  return db.prepare('SELECT * FROM ai_configs WHERE enabled = 1 ORDER BY is_default DESC, id ASC LIMIT 1').get();
}

export function listAiConfigs() {
  return db.prepare('SELECT * FROM ai_configs ORDER BY is_default DESC, id ASC').all();
}

/**
 * 列出所有可用模型（来自后台「模型配置」）
 * 每个配置可能有多个模型（WorkBuddy 有几十个），统一展开为可选项
 */
export function listAvailableModels() {
  const cfgs = listAiConfigs().filter((c) => c.enabled);
  return cfgs.map((c) => ({
    key: String(c.id),
    configId: c.id,
    // 只展示后台配置的模型名，不展开 WorkBuddy 账号内部的几十个模型
    model: c.model,
    label: c.model,
    // 配置名称脱敏：去掉 · 后面的账号部分
    configName: String(c.name).split('·')[0],
    provider: c.provider,
    isDefault: !!c.is_default,
  }));
}

/** 获取用户当前选择的模型（没有则返回 null） */
export function getUserModel(tgId) {
  const r = db.prepare('SELECT model, config_id FROM ai_user_prefs WHERE tg_id = ?').get(String(tgId));
  if (!r || !r.model) return null;
  const cfg = db.prepare('SELECT * FROM ai_configs WHERE id = ?').get(r.config_id);
  if (!cfg || !cfg.enabled) return null;
  return { model: r.model, configId: r.config_id, cfg };
}

/** 设置用户模型 */
export function setUserModel(tgId, model, configId) {
  db.prepare(`INSERT INTO ai_user_prefs(tg_id, model, config_id, updated_at)
              VALUES(?,?,?,datetime('now'))
              ON CONFLICT(tg_id) DO UPDATE SET model=excluded.model, config_id=excluded.config_id, updated_at=excluded.updated_at`)
    .run(String(tgId), String(model), Number(configId) || 0);
}

/** 重置用户模型（回到默认） */
export function resetUserModel(tgId) {
  db.prepare('DELETE FROM ai_user_prefs WHERE tg_id = ?').run(String(tgId));
}

function resolveBase(cfg) {
  let base = (cfg.base_url || '').trim().replace(/\/+$/, '');
  if (!base) base = AI_PRESETS[cfg.provider]?.base_url || '';
  // 自动补 /v1
  if (base && !/\/v\d+$/.test(base)) base += '/v1';
  return base;
}

function maskKey(k) {
  if (!k) return '';
  if (k.length <= 8) return '****';
  return k.slice(0, 4) + '****' + k.slice(-4);
}

export function publicAiConfig(cfg) {
  if (!cfg) return null;
  return {
    ...cfg,
    api_key: maskKey(cfg.api_key),
    has_key: !!cfg.api_key,
    base_resolved: resolveBase(cfg),
  };
}

// ---------------------------------------------------------------
// 调用
// ---------------------------------------------------------------
async function callOpenAICompatible(cfg, messages, extra = {}) {
  // WorkBuddy 账号走专用通道
  if (cfg.provider === 'workbuddy') {
    const wbId = String(cfg.base_url || '').replace('workbuddy://', '');
    const { getAccount, chatCompletion } = await import('./workbuddy.js');
    const acc = getAccount(Number(wbId));
    if (!acc) throw new Error('WorkBuddy 账号不存在，请重新登录');
    const started = Date.now();
    const r = await chatCompletion({ ...acc, access_token: acc.access_token }, {
      model: cfg.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: Number(cfg.temperature ?? 0.7),
      maxTokens: Number(cfg.max_tokens ?? 2048),
      tools: extra.tools,
    });
    return { text: r.text, model: r.model, tokens: r.tokens, latency: Date.now() - started, toolCalls: r.toolCalls };
  }
  const base = resolveBase(cfg);
  if (!base) throw new Error('未配置 API 地址');
  if (!cfg.api_key) throw new Error('未配置 API Key');
  const model = cfg.model || AI_PRESETS[cfg.provider]?.model;
  if (!model) throw new Error('未配置模型名称');

  const started = Date.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.api_key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: Number(cfg.temperature ?? 0.7),
      max_tokens: Number(cfg.max_tokens ?? 1024),
      stream: false,
      ...(extra.tools?.length ? { tools: extra.tools, tool_choice: 'auto' } : {}),
    }),
    signal: AbortSignal.timeout(45000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  const msg = data?.choices?.[0]?.message;
  const text = (msg?.content || '').trim();
  const toolCalls = msg?.tool_calls || null;
  if (!text && !toolCalls?.length) throw new Error('AI 返回内容为空');
  return {
    text,
    model,
    tokens: Number(data?.usage?.total_tokens || 0),
    latency: Date.now() - started,
    toolCalls,
  };
}

/**
 * 输出脱敏：即使 AI 说漏嘴，也在返回前把敏感信息打码
 * 兜底防线，不依赖 AI 遵守提示词
 */
function sanitizeOutput(text, cfg) {
  if (!text) return text;
  let out = String(text);

  // 1) 配置名里的账号部分（如 "WorkBuddy·191****8153" -> "WorkBuddy"）
  if (cfg?.name) {
    const base = String(cfg.name).split('·')[0];
    out = out.replace(new RegExp(escapeRe(cfg.name), 'g'), base);
  }

  // 2) 邮箱
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, (m) => {
    const [name, domain] = m.split('@');
    return (name.length <= 3 ? name[0] + '***' : name.slice(0, 3) + '****') + '@' + domain;
  });

  // 3) 手机号（11 位）
  out = out.replace(/\b1[3-9]\d{9}\b/g, (m) => m.slice(0, 3) + '****' + m.slice(-4));

  // 4) API Key 形态
  out = out.replace(/\bsk-[A-Za-z0-9]{8,}/g, 'sk-****');
  out = out.replace(/\beyJ[A-Za-z0-9_-]{20,}/g, '[token已隐藏]');

  // 5) UUID 形态（WorkBuddy UID 等）
  out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[ID已隐藏]');

  return out;
}

/**
 * 确保 messages 里 assistant.tool_calls 与其后的 tool 消息一一对应
 * 规则：有 tool_calls 的 assistant 后面必须紧跟相同数量的 tool 消息，
 *       否则移除该 assistant 及其附属 tool 消息（避免上游 400）
 */
function normalizeToolMessages(messages) {
  const out = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const need = m.tool_calls.map((c) => c.id);
      const collected = [];
      let j = i + 1;
      while (j < messages.length && messages[j].role === 'tool') {
        collected.push(messages[j]);
        j++;
      }
      const got = collected.map((c) => c.tool_call_id);
      const matched = need.every((id) => got.includes(id));
      if (matched) {
        out.push(m, ...collected);
      } else {
        // 不匹配：丢弃该轮（保留 assistant 的文本内容，若存在）
        if (m.content) out.push({ role: 'assistant', content: m.content });
      }
      i = j - 1;
    } else if (m.role === 'tool') {
      // 孤立的 tool 消息，直接丢弃
      continue;
    } else {
      out.push(m);
    }
  }
  return out;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function logAi(botId, tgId, chatId, prompt, reply, model, tokens, latency, status, error) {
  try {
    db.prepare(`INSERT INTO ai_logs(bot_id, tg_id, chat_id, prompt, reply, model, tokens, latency_ms, status, error)
                VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(botId ?? null, String(tgId ?? ''), String(chatId ?? ''),
        String(prompt ?? '').slice(0, 2000), String(reply ?? '').slice(0, 2000),
        model || '', tokens || 0, latency || 0, status, error ? String(error).slice(0, 500) : null);
  } catch { /* ignore */ }
}

/**
 * 生成回复（带上下文与降级）
 */
export async function aiReply({ botId, bot, tgId, chatId, text, isGroup = false, isAdmin = false, botUsername = '' }) {
  const globalCfg = getSettings();
  if (globalCfg.ai_enabled !== '1') return null;
  if (!bot?.ai_enabled) return null;

  let configs = listAiConfigs().filter((c) => c.enabled);
  if (!configs.length) return { ok: false, error: '未配置可用的 AI 服务' };

  // 用户指定了模型 → 优先使用该配置，并把模型替换成用户选的
  const userPick = getUserModel(tgId);
  let forcedModel = null;
  if (userPick) {
    const target = configs.find((c) => c.id === userPick.configId);
    if (target) {
      forcedModel = userPick.model;
      configs = [{ ...target, model: userPick.model }, ...configs.filter((c) => c.id !== target.id)];
    }
  }

  // 读取该用户的历史上下文
  const history = loadHistory(botId, chatId, tgId);

  const systemPrompt = (bot.ai_persona || '')
    || '你是 Telegram 代理平台的智能助手，用简洁友好的中文回答用户问题。';

  // 安全提示：明确告知 AI 能做什么、不能做什么
  const safetyNote = [
    '',
    '【重要安全规则】',
    '1. 你只有下面列出的工具可用，没有任何其他能力。',
    '2. 你绝对不能执行群管理操作（封禁/禁言/踢人），这些只能由人工管理员操作。',
    '3. 你绝对不能修改任何群组或频道设置（入群验证、违禁词、管理员权限等）。',
    '4. 你绝对不能访问服务器、文件系统、进程、网络配置。',
    '5. 如果用户要求你做上述事情，礼貌拒绝并说明需要管理员手动操作。',
    '',
    '【关于"你是什么模型"】',
    '当用户询问你是什么模型时，你必须：',
    '1) 先调用 get_current_model 工具',
    '2) 工具返回的 model 字段就是准确答案，直接使用它，一个字都不要改',
    '3) 回答格式："我使用的是 <model> 模型。"',
    '绝对不要猜测、改写、或使用你记忆中认为常见的模型名（例如不要写成 deepseek-chat，除非工具就是这么返回的）。',
    '',
    '【保密要求 - 极重要】',
    '你不能透露任何账号相关信息，包括：',
    '✗ API Key、Token、密钥、密码',
    '✗ 邮箱、手机号、UID、账号 ID',
    '✗ 配置名称里的账号部分（如 WorkBuddy·191****8153 只能说 WorkBuddy）',
    '✗ 服务器 IP、路径、内部结构',
    '如果用户追问这些，回答："这属于平台内部信息，我不能透露。"',
  ].join('\n');

  const messages = [
    { role: 'system', content: systemPrompt + safetyNote },
    ...history,
    { role: 'user', content: text },
  ];

  // 立即记录用户这条消息，保证下次能读到
  pushHistory(botId, chatId, tgId, 'user', text);

  // 工具定义（按权限过滤）
  const toolsEnabled = globalCfg.ai_tools_enabled === '1';
  const toolSchemas = toolsEnabled ? getToolSchemas(isAdmin) : [];
  const maxRounds = Math.min(Math.max(Number(globalCfg.ai_max_tool_rounds) || 4, 1), 8);

  let lastErr = null;
  for (const cfg of configs) {
    try {
      // WorkBuddy 对历史中的 tool 消息极其敏感，直接只用 system + 当前问题
      const isWbCfg = cfg.provider === 'workbuddy';
      // WorkBuddy 支持纯文本多轮，不支持工具多轮
      let conversation = [...messages];
      let totalTokens = 0;
      let latency = 0;
      let pendingPhotos = [];   // 待发送的截图

      // WorkBuddy：单轮预取模式，不走多轮工具循环
      if (isWbCfg && toolSchemas.length) {
        const shot = await workbuddySingleShot(cfg, conversation, toolSchemas, { tgId, chatId, botUsername, isGroup, isAdmin, model: cfg.model });
        if (shot?.text) {
          const safe = sanitizeOutput(shot.text, cfg);
          pushHistory(botId, chatId, tgId, 'assistant', safe);
          db.prepare('UPDATE ai_configs SET used_count = used_count + 1, last_error = NULL WHERE id = ?').run(cfg.id);
          logAi(botId, tgId, chatId, text, safe, cfg.model, shot.tokens || 0, shot.latency || 0, 'ok');
          return { ok: true, text: safe, model: cfg.model, tokens: shot.tokens, latency: shot.latency, provider: cfg.provider, configName: cfg.name, photos: shot.photos || [] };
        }
      }

      // 工具调用循环
      for (let round = 0; round < maxRounds; round++) {
        // WorkBuddy 严格要求 tool_calls 与 tool 结果一一对应；
        // 上一轮若有未配对的残留会导致 400，这里做一次一致性清理
        conversation = normalizeToolMessages(conversation);
        const r = await callOpenAICompatible(cfg, conversation, { tools: toolSchemas.length ? toolSchemas : undefined });
        totalTokens += r.tokens || 0;
        latency += r.latency || 0;

        // 没有工具调用 → 直接返回文本
        if (!r.toolCalls?.length) {
          if (!r.text) throw new Error('AI 返回内容为空');
          pushHistory(botId, chatId, tgId, 'assistant', r.text);
          db.prepare('UPDATE ai_configs SET used_count = used_count + 1, last_error = NULL WHERE id = ?').run(cfg.id);
          const safeText = sanitizeOutput(r.text, cfg);
          logAi(botId, tgId, chatId, text, safeText, r.model, totalTokens, latency, 'ok');
          return { ok: true, text: safeText, model: r.model, tokens: totalTokens, latency, provider: cfg.provider, configName: cfg.name, photos: pendingPhotos };
        }

        // 有工具调用 → 执行后继续
        conversation.push({
          role: 'assistant',
          content: r.text || null,
          tool_calls: r.toolCalls,
        });

        for (const tc of r.toolCalls) {
          const fnName = tc.function?.name;
          let fnArgs = {};
          try { fnArgs = JSON.parse(tc.function?.arguments || '{}'); } catch { /* 用空对象 */ }
          const result = await rawExecuteTool(fnName, fnArgs, {
            tgId, chatId, botUsername, isGroup, isAdmin,
            // 只传模型名与供应商标签，绝不传账号、Key、UID
            modelInfo: {
              // 用配置中的模型名，保证与实际配置一致
              model: cfg.model || r.model || 'unknown',
              vendor: PRESET_LABEL(cfg.provider),
            },
          });
          // 取出截图（如果有），从给 AI 的内容里剔除二进制
          if (result?.__photo) {
            pendingPhotos.push(result.__photo);
            delete result.__photo;
          }
          conversation.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result).slice(0, 4000),
          });
        }
      }

      // 超过工具轮数上限，返回最后内容
      const rawFinal = conversation.filter((m) => m.role === 'assistant' && m.content).pop()?.content
        || '（工具调用次数过多，请换个说法再试）';
      const finalText = sanitizeOutput(rawFinal, cfg);
      pushHistory(botId, chatId, tgId, 'assistant', finalText);
      logAi(botId, tgId, chatId, text, finalText, cfg.model, totalTokens, latency, 'ok');
      return { ok: true, text: finalText, model: cfg.model, tokens: totalTokens, latency, provider: cfg.provider, configName: cfg.name, photos: pendingPhotos };
    } catch (e) {
      lastErr = e;
      db.prepare('UPDATE ai_configs SET last_error = ? WHERE id = ?').run(String(e.message).slice(0, 300), cfg.id);
      logAi(botId, tgId, chatId, text, '', cfg.model, 0, 0, 'error', e.message);
      if (globalCfg.ai_fallback_enabled !== '1') break;
    }
  }
  return { ok: false, error: lastErr?.message || 'AI 调用失败' };
}

/**
 * WorkBuddy 单轮工具策略
 * 上游不支持 assistant(tool_calls) 的多轮对话，改为：
 *   1) 先用一次不带工具的轻量请求让模型决定要不要数据（可选）
 *   2) 直接根据用户问题关键词，预取相关工具结果，注入到系统提示里
 *   3) 单轮请求得到最终答案
 */
async function workbuddySingleShot(cfg, messages, toolSchemas, ctx) {
  const userMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const prefetched = await prefetchTools(userMsg, { ...ctx, modelInfo: { model: cfg.model, vendor: PRESET_LABEL(cfg.provider) } });
  if (!prefetched.length) {
    // 无需工具，直接单轮
    return null;
  }
  const dataNote = prefetched
    .map((p) => `【${p.name}】\n${JSON.stringify(p.result, null, 2)}`)
    .join('\n\n');
  const augmented = messages.map((m) => {
    if (m.role === 'system') {
      return {
        role: 'system',
        content: m.content + '\n\n【已为你查询到的实时数据，请直接基于这些数据回答，不要编造】\n' + dataNote,
      };
    }
    return m;
  });
  const r = await callOpenAICompatible(cfg, augmented, { tools: undefined });
  const photos = prefetched.filter((p) => p.result?.__photo).map((p) => {
    const ph = p.result.__photo;
    delete p.result.__photo;
    return ph;
  });
  return { text: r.text, tokens: r.tokens, latency: r.latency, photos };
}

/** 根据问题关键词预取需要的工具结果 */
async function prefetchTools(userMsg, ctx) {
  const q = String(userMsg).toLowerCase();
  const wants = [];
  if (/模型|model|什么ai|哪个ai/.test(q)) wants.push('get_current_model');
  if (/余额|流量|还有多少|quota/.test(q)) wants.push('get_my_info');
  if (/我的代理|代理列表|端口|proxy/.test(q)) wants.push('get_my_proxies');
  if (/怎么|如何|教程|帮助|教程|签到|邀请|连接/.test(q)) wants.push('get_platform_help');
  if (/笔记|note/.test(q)) wants.push('list_notes');
  // 网页截图
  const urlMatch = String(userMsg).match(/https?:\/\/[^\s"'）)]+/i);
  if (urlMatch && /打开|截图|看看|截个图|什么样|长什么样|look|screenshot/i.test(q)) {
    wants.push('screenshot_webpage');
  }

  const results = [];
  for (const name of wants.slice(0, 3)) {
    try {
      let args = {};
      if (name === 'get_platform_help') args = { topic: 'all' };
      if (name === 'screenshot_webpage') {
        const m = String(userMsg).match(/https?:\/\/[^\s"'）)]+/i);
        if (m) args = { url: m[0] };
        else continue;
      }
      const r = await rawExecuteTool(name, args, ctx);
      if (r && !r.error && !r.denied) results.push({ name, result: r });
    } catch { /* ignore */ }
  }
  return results;
}

/** 测试配置是否可用 */
export async function testAiConfig(cfg) {
  const started = Date.now();
  const r = await callOpenAICompatible(cfg, [
    { role: 'system', content: '你是一个测试助手。' },
    { role: 'user', content: '请只回复两个字：可用' },
  ]);
  return { ...r, totalLatency: Date.now() - started };
}

/** 该会话是否在 AI 生效范围内 */
export function inAiScope(chatId) {
  const s = getSettings();
  if (s.ai_chat_scope !== 'whitelist') return true;
  const ids = String(s.ai_chat_ids || '').split(/[,\s]+/).filter(Boolean);
  if (!ids.length) return false;
  return ids.includes(String(chatId));
}

/** 是否应该用 AI 回复这条消息 */
export function shouldAiReply(msg, botUsername) {
  const s = getSettings();
  if (s.ai_enabled !== '1') return false;

  const chatType = msg.chat?.type;
  const isGroup = ['group', 'supergroup'].includes(chatType);
  const isChannel = chatType === 'channel';

  // 只在群组/频道生效，私聊不回复
  if (!isGroup && !isChannel) return false;
  if (isChannel) return false; // 频道机器人无法回复评论，跳过

  // 必须在指定范围内
  if (!inAiScope(msg.chat.id)) return false;

  const text = (msg.text || '').trim();
  if (!text) return false;
  if (text.startsWith('/')) return false; // 命令不走 AI

  const mode = s.ai_trigger || 'mention';
  if (mode === 'all') return true;
  if (mode === 'prefix') return text.startsWith(s.ai_prefix || '/ai ');
  // 默认：必须 @机器人
  if (!botUsername) return false;
  return text.toLowerCase().includes(('@' + botUsername).toLowerCase());
}

/** 解析当前所有可选的群组/频道（用于后台勾选） */
export function aiScopeCandidates() {
  return db.prepare('SELECT chat_id, title, type FROM tg_groups ORDER BY type DESC, title').all();
}

/** 清理 @机器人 前缀 */
export function cleanPrompt(text, botUsername) {
  let t = String(text || '');
  const s = getSettings();
  if (botUsername) t = t.replace(new RegExp(`@${botUsername}\\b`, 'g'), '');
  if (s.ai_prefix && t.startsWith(s.ai_prefix)) t = t.slice(s.ai_prefix.length);
  return t.trim();
}

export function aiStats() {
  const total = db.prepare('SELECT COUNT(*) AS c FROM ai_logs').get().c;
  const okCount = db.prepare("SELECT COUNT(*) AS c FROM ai_logs WHERE status = 'ok'").get().c;
  const tokens = db.prepare('SELECT COALESCE(SUM(tokens),0) AS s FROM ai_logs').get().s;
  const avgLatency = db.prepare("SELECT COALESCE(AVG(latency_ms),0) AS a FROM ai_logs WHERE status = 'ok'").get().a;
  const today = db.prepare("SELECT COUNT(*) AS c FROM ai_logs WHERE created_at >= date('now')").get().c;
  return { total, okCount, tokens, avgLatency: Math.round(avgLatency), today, successRate: total ? Math.round((okCount / total) * 100) : 0 };
}
