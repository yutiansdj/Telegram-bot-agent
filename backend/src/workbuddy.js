/**
 * WorkBuddy 集成模块
 *
 * 复刻自 WorkBuddy-Hub-Android 的协议实现：
 *   - 浏览器授权登录（state → authUrl → 轮询 token）
 *   - 拉取模型列表      GET  /v3/config
 *   - 查询积分余额      POST /v2/billing/meter/get-user-resource
 *   - 每日签到          POST /billing/meter/daily-checkin
 *   - 对话调用          POST /v2/chat/completions
 *
 * 支持国内版（copilot.tencent.com）与国际版（www.workbuddy.ai）
 */
import { db } from './db.js';

// ---------------------------------------------------------------
// 常量
// ---------------------------------------------------------------
export const REGIONS = {
  cn: {
    label: '国内版',
    chatBase: 'https://copilot.tencent.com',
    billingBase: 'https://www.codebuddy.cn',
    origin: 'https://www.codebuddy.cn',
    userAgent: 'WorkBuddy/5.5.6',
    clientUA: 'CLI/2.63.2 CodeBuddy/2.63.2',
    domain: 'copilot.tencent.com',
  },
  global: {
    label: '国际版',
    chatBase: 'https://www.workbuddy.ai',
    billingBase: 'https://www.workbuddy.ai',
    origin: 'https://www.workbuddy.ai',
    userAgent: 'WorkBuddy/5.5.2',
    clientUA: 'WorkBuddy/5.5.2',
    domain: 'www.workbuddy.ai',
  },
};

function regionCfg(region) {
  return REGIONS[region] || REGIONS.cn;
}

const TIMEOUT = 30000;

// ---------------------------------------------------------------
// 底层请求
// ---------------------------------------------------------------
async function http(url, { method = 'GET', headers = {}, body = null, region = 'cn', timeout = TIMEOUT } = {}) {
  const cfg = regionCfg(region);
  const h = {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': cfg.userAgent,
    Origin: cfg.origin,
    Referer: cfg.origin + '/',
    'X-Requested-With': 'XMLHttpRequest',
    ...headers,
  };
  if (body !== null) h['Content-Type'] = h['Content-Type'] || 'application/json';

  const res = await fetch(url, {
    method,
    headers: h,
    body: body === null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { ok: res.ok, status: res.status, text, json };
}

/** 解析 JWT 拿 uid（sub） */
function uidOf(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length < 2) return '';
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json).sub || '';
  } catch { return ''; }
}

/** 账单类请求头 */
function billingHeaders(cred, region) {
  const cfg = regionCfg(region);
  const h = {
    Authorization: `Bearer ${cred.access_token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': cfg.clientUA,
  };
  if (cred.uid) {
    h['X-User-Id'] = cred.uid;
    h['X-Domain'] = cred.domain || cfg.domain;
  }
  return h;
}

// ---------------------------------------------------------------
// 登录流程
// ---------------------------------------------------------------
/** 第一步：申请授权链接 */
export async function loginStart(region = 'cn') {
  const cfg = regionCfg(region);
  const r = await http(`${cfg.chatBase}/v2/plugin/auth/state?platform=CLI`, {
    method: 'POST', body: {}, region,
  });
  if (!r.json) throw new Error('auth/state 返回非 JSON：' + r.text.slice(0, 120));
  const data = r.json.data;
  if (!data?.state || !data?.authUrl) {
    throw new Error('auth/state 返回异常：' + (r.json.msg || r.text.slice(0, 120)));
  }
  return { state: data.state, authUrl: data.authUrl, region };
}

/** 第二步：轮询换取 Token。返回 { code: 'pending'|'done'|'error' } */
export async function loginPoll(state, region = 'cn') {
  const cfg = regionCfg(region);
  const r = await http(`${cfg.chatBase}/v2/plugin/auth/token?state=${encodeURIComponent(state)}`, { region });
  if (!r.json) return { code: 'pending' };
  const code = r.json.code;
  if (code === 11217) return { code: 'pending' };  // 登录进行中
  if (code !== 0) return { code: 'error', message: r.json.msg || `code=${code}` };
  const d = r.json.data;
  if (!d?.accessToken) return { code: 'pending' };

  const cred = {
    access_token: d.accessToken,
    refresh_token: d.refreshToken || '',
    expires_at: Number(d.expiresAt || 0),
    domain: d.domain || cfg.domain,
    uid: uidOf(d.accessToken),
    region,
    nickname: '',
  };
  // 拿昵称
  try {
    const a = await http(`${cfg.chatBase}/v2/plugin/login/account?state=${encodeURIComponent(state)}`, {
      headers: { Authorization: `Bearer ${cred.access_token}` }, region,
    });
    cred.nickname = a.json?.data?.nickname || '';
  } catch { /* ignore */ }
  return { code: 'done', credential: cred };
}

/** 刷新 token */
export async function refreshToken(cred) {
  const cfg = regionCfg(cred.region);
  try {
    const r = await http(`${cfg.chatBase}/v2/plugin/auth/token/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cred.access_token}`, 'Content-Type': 'application/json' },
      body: { refreshToken: cred.refresh_token },
      region: cred.region,
    });
    if (r.json?.code === 0 && r.json.data?.accessToken) {
      return {
        ...cred,
        access_token: r.json.data.accessToken,
        refresh_token: r.json.data.refreshToken || cred.refresh_token,
        expires_at: Number(r.json.data.expiresAt || 0),
      };
    }
  } catch { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------
// 模型 / 余额 / 签到
// ---------------------------------------------------------------
/** 拉取模型列表 */
export async function fetchModels(cred) {
  const cfg = regionCfg(cred.region);
  const headers = {
    Authorization: `Bearer ${cred.access_token}`,
    Accept: 'application/json',
    Origin: cfg.origin,
    Referer: cfg.origin + '/',
    'User-Agent': cred.region === 'global' ? cfg.clientUA : cfg.clientUA,
  };
  if (cred.region === 'global') {
    headers['X-Requested-With'] = 'XMLHttpRequest';
    headers['X-Product'] = 'SaaS';
  }
  const r = await http(`${cfg.chatBase}/v3/config`, { headers, region: cred.region });
  if (!r.json) throw new Error('模型列表返回非 JSON');
  if (r.json.code !== 0) throw new Error('模型列表获取失败：' + (r.json.msg || ''));

  // 模型可能在多个位置
  const d = r.json.data || {};
  let list = d.models || d.modelList || d.availableModels || [];
  if (!Array.isArray(list)) {
    // 有些版本是 { chats: { models: [] } }
    list = d.chats?.models || d.config?.models || [];
  }
  return list.map((m) => ({
    id: m.id || m.model || m.modelId || m.name,
    name: m.name || m.displayName || m.title || m.id,
    vendor: m.vendor || m.provider || '',
    description: m.description || '',
    maxTokens: m.maxTokens || m.max_tokens || 0,
    raw: m,
  })).filter((m) => m.id);
}

/** 查询余额/积分 */
export async function fetchBalance(cred) {
  const cfg = regionCfg(cred.region);
  const now = new Date();
  const begin = now.toISOString().replace('T', ' ').slice(0, 19);
  const end = new Date(now.getTime() + 365 * 100 * 86400000).toISOString().replace('T', ' ').slice(0, 19);

  const r = await http(`${cfg.billingBase}/v2/billing/meter/get-user-resource`, {
    method: 'POST',
    headers: billingHeaders(cred, cred.region),
    body: {
      PageNumber: 1,
      PageSize: 100,
      ProductCode: 'p_tcaca',
      Status: [0, 3],
      PackageEndTimeRangeBegin: begin,
      PackageEndTimeRangeEnd: end,
    },
    region: cred.region,
  });
  if (!r.json) throw new Error('余额接口返回非 JSON');
  if (r.json.code !== 0) throw new Error('余额查询失败：' + (r.json.msg || ''));

  const inner = r.json.data?.Response?.Data || {};
  const accounts = inner.Accounts || [];
  let total = 0;
  const list = [];
  for (const a of accounts) {
    const size = Number(a.CycleCapacitySize || 0);
    const cycleRemain = Number(a.CycleCapacityRemain || 0);
    const cycleUsed = Number(a.CycleCapacityUsed || 0);
    const remain = size > 0 ? cycleRemain : (cycleRemain > 0 || cycleUsed > 0 ? cycleRemain : Number(a.CapacityRemain || 0));
    const v = Math.max(0, remain);
    total += v;
    list.push({
      name: a.PackageName || '(未命名)',
      remain: v,
      size: size > 0 ? size : Number(a.CapacitySize || 0),
      cycleEnd: a.CycleEndTime || '',
    });
  }
  return { total, accounts: list, cycleEnd: list[0]?.cycleEnd || '' };
}

/** 每日签到 */
export async function dailyCheckin(cred) {
  const cfg = regionCfg(cred.region);
  const r = await http(`${cfg.chatBase}/billing/meter/daily-checkin`, {
    method: 'POST',
    headers: billingHeaders(cred, cred.region),
    body: {},
    region: cred.region,
  });
  if (!r.json) return { ok: false, message: r.text.slice(0, 120) };
  return {
    ok: r.json.code === 0,
    message: r.json.msg || (r.json.code === 0 ? '签到成功' : `code=${r.json.code}`),
  };
}

/** 成长任务列表 */
export async function fetchTasks(cred) {
  const cfg = regionCfg(cred.region);
  const r = await http(`${cfg.chatBase}/v2/activity/growth/tasks`, {
    headers: billingHeaders(cred, cred.region),
    region: cred.region,
  });
  if (!r.json || r.json.code !== 0) return [];
  const rows = r.json.data?.tasks || [];
  return rows.map((row) => ({
    code: row.task_code || '',
    current: row.progress?.current ?? row.current ?? 0,
    target: row.progress?.target ?? row.target ?? 0,
    claimed: row.accept_status === 'claimed',
  }));
}

/** 对话补全（流式 SSE，腾讯接口只支持 stream） */
export async function chatCompletion(cred, { model, messages, temperature = 0.7, maxTokens = 2048, tools = null }) {
  const cfg = regionCfg(cred.region);
  const url = `${cfg.chatBase}/v2/chat/completions`;
  const headers = {
    ...billingHeaders(cred, cred.region),
    Accept: 'text/event-stream',
    'Cache-Control': 'no-cache',
  };
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,          // 腾讯接口强制要求流式
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
    }),
    signal: AbortSignal.timeout(90000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const code = res.status ?? '(无响应状态)';
    throw new Error(`WorkBuddy 接口返回 ${code}：${errText.slice(0, 200) || '无内容'}`);
  }

  // 解析 SSE
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let content = '';
  let tokenCount = 0;
  let upstreamErr = '';
  const toolCallMap = new Map();  // index -> { id, name, args }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // 按行处理
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line || line.startsWith(':')) continue;
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;

      try {
        const j = JSON.parse(payload);
        // 错误帧
        if (j.error) {
          upstreamErr = typeof j.error === 'string' ? j.error : (j.error.message || JSON.stringify(j.error));
          continue;
        }
        const delta = j.choices?.[0]?.delta;
        if (delta?.content) content += delta.content;
        else if (delta?.reasoning_content) { /* 跳过思考过程 */ }
        else if (j.choices?.[0]?.message?.content) content += j.choices[0].message.content;

        // 累积工具调用（流式分片）
        const tcDelta = delta?.tool_calls || j.choices?.[0]?.message?.tool_calls;
        if (Array.isArray(tcDelta)) {
          for (const tc of tcDelta) {
            const idx = tc.index ?? 0;
            if (!toolCallMap.has(idx)) toolCallMap.set(idx, { id: '', name: '', args: '' });
            const cur = toolCallMap.get(idx);
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
          }
        }
        if (j.usage?.total_tokens) tokenCount = j.usage.total_tokens;
        if (j.code && j.code !== 0 && j.msg) upstreamErr = j.msg;
      } catch { /* 忽略无法解析的帧 */ }
    }
  }

  if (upstreamErr && !content) throw new Error(upstreamErr);

  // 整理工具调用
  const toolCalls = [...toolCallMap.values()]
    .filter((t) => t.name)
    .map((t, i) => ({ id: t.id || `call_${i}`, type: 'function', function: { name: t.name, arguments: t.args || '{}' } }));

  if (!content && !toolCalls.length) throw new Error('AI 返回内容为空');
  return { text: content.trim(), model, tokens: tokenCount, latency: Date.now() - started, toolCalls: toolCalls.length ? toolCalls : null };
}

// ---------------------------------------------------------------
// 账号存储
// ---------------------------------------------------------------
export function listAccounts() {
  return db.prepare('SELECT * FROM wb_accounts ORDER BY id ASC').all();
}

export function saveAccount(cred) {
  const exists = db.prepare('SELECT id FROM wb_accounts WHERE uid = ?').get(cred.uid);
  if (exists) {
    db.prepare(`UPDATE wb_accounts SET access_token=?, refresh_token=?, expires_at=?, domain=?, region=?, nickname=?, updated_at=datetime('now') WHERE id=?`)
      .run(cred.access_token, cred.refresh_token || '', cred.expires_at || 0, cred.domain || '', cred.region || 'cn', cred.nickname || '', exists.id);
    return exists.id;
  }
  const r = db.prepare(`INSERT INTO wb_accounts(uid, access_token, refresh_token, expires_at, domain, region, nickname)
                         VALUES(?,?,?,?,?,?,?)`)
    .run(cred.uid || '', cred.access_token, cred.refresh_token || '', cred.expires_at || 0, cred.domain || '', cred.region || 'cn', cred.nickname || '');
  return Number(r.lastInsertRowid);
}

export function deleteAccount(id) {
  db.prepare('DELETE FROM wb_accounts WHERE id = ?').run(Number(id));
}

export function getAccount(id) {
  return db.prepare('SELECT * FROM wb_accounts WHERE id = ?').get(Number(id));
}

/** 保存模型缓存 */
export function saveModels(accountId, models) {
  db.prepare('DELETE FROM wb_models WHERE account_id = ?').run(Number(accountId));
  const ins = db.prepare('INSERT INTO wb_models(account_id, model_id, name, vendor) VALUES(?,?,?,?)');
  const seen = new Set();
  for (const m of models) {
    if (!m.id || seen.has(m.id)) continue;   // 去重
    seen.add(m.id);
    ins.run(Number(accountId), m.id, m.name || m.id, m.vendor || '');
  }
}
