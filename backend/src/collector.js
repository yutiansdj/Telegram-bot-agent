/**
 * 流量采集器（内核级精确计费）
 *
 * 每个代理账号以独立系统 UID 运行 mtg，iptables owner 模块按 UID 累计字节数：
 *   - 计数器由内核维护，跨进程重启不丢失、无法被客户端绕过
 *   - 每 30 秒读取一次累计值，与上次快照求差写入 accounts.used_bytes 与 traffic_daily
 *   - 超额 / 到期 / 停用 -> 立即停止进程并启用流量闸门（TGGATE 链 DROP）
 */
import fs from 'node:fs';
import { db, getSettingBool, getSettingNum, audit } from './db.js';
import * as mailer from './mailer.js';
import * as mtg from './mtg.js';
import * as billing from './billing.js';

/** accountId -> 上次读取的累计上行字节 */
const lastCounters = new Map();
/** accountId -> 上次读取的累计出站字节（估算下行用） */
const lastProc = new Map();
/** 预警去重：accountId_day */
const warned = new Set();

function todayStr() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

/** 读取进程级累计收发字节（来自 /proc/<pid>/io，按进程隔离，重启后归零） */
function procIo(pid) {
  try {
    const txt = fs.readFileSync(`/proc/${pid}/io`, 'utf8');
    const rchar = Number((txt.match(/rchar:\s+(\d+)/) || [])[1] || 0);
    const wchar = Number((txt.match(/wchar:\s+(\d+)/) || [])[1] || 0);
    return { up: wchar, down: rchar, pid };
  } catch {
    return null;
  }
}

function newAccountTotals(accountId) {
  return db.prepare('SELECT used_bytes FROM accounts WHERE id = ?').get(accountId)?.used_bytes || 0;
}

export async function collectOnce() {
  const accounts = db.prepare("SELECT * FROM accounts WHERE status = 'active'").all();
  const counters = await billing.readCounters();
  const day = todayStr();
  const upsert = db.prepare(`INSERT INTO traffic_daily(account_id, day, up_bytes, down_bytes) VALUES(?,?,?,?)
                             ON CONFLICT(account_id, day) DO UPDATE SET
                               up_bytes = up_bytes + excluded.up_bytes,
                               down_bytes = down_bytes + excluded.down_bytes`);
  const addUsed = db.prepare('UPDATE accounts SET used_bytes = used_bytes + ?, last_used_at = ? WHERE id = ?');
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  let total = 0;
  let billed = 0;

  for (const acc of accounts) {
    const entry = mtg.getRunningEntry(acc.id);
    const io = entry ? procIo(entry.pid) : null;

    // ---- 上行：iptables UID 计数（权威，跨重启累计）----
    const curUp = counters.get(acc.id);
    const prevUp = lastCounters.get(acc.id);
    let upDelta = 0;
    if (curUp !== undefined) {
      if (prevUp === undefined) upDelta = 0; // 首次读取只建立基线
      else if (curUp >= prevUp) upDelta = curUp - prevUp;
      else upDelta = curUp; // 计数器被规则重建清零
      lastCounters.set(acc.id, curUp);
    }

    // ---- 下行：进程 rchar 差值（进程重启后自动从 0 重新累计）----
    const prevIo = lastProc.get(acc.id);
    let downDelta = 0;
    if (io) {
      if (prevIo && prevIo.pid === io.pid && io.down >= prevIo.down) downDelta = io.down - prevIo.down;
      else if (prevIo && prevIo.pid !== io.pid) downDelta = io.down; // 新进程从 0 开始
      lastProc.set(acc.id, io);
    } else {
      lastProc.delete(acc.id);
    }

    const delta = upDelta + downDelta;
    if (delta <= 0) continue;
    billed++;
    total += delta;
    upsert.run(acc.id, day, upDelta, downDelta);
    addUsed.run(delta, now, acc.id);

    const fresh = db.prepare('SELECT * FROM accounts WHERE id = ?').get(acc.id);
    // 额度预警（每账号每天最多一次）
    const warnPct = getSettingNum('usage_notify_pct');
    if (warnPct > 0 && fresh.quota_mb > 0) {
      const pct = (fresh.used_bytes / 1024 / 1024 / fresh.quota_mb) * 100;
      if (pct >= warnPct && pct < 100) {
        const key = `warn_${fresh.id}_${todayStr()}`;
        if (!warned.has(key)) {
          warned.add(key);
          const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(fresh.user_id);
          if (owner) mailer.notifyQuotaWarn(owner, Math.floor(pct), fresh);
        }
      }
    }
    if (fresh.quota_mb > 0 && fresh.used_bytes >= fresh.quota_mb * 1024 * 1024) {
      audit(null, '流量超额自动停用', `account:${fresh.id}`,
        `已用 ${(fresh.used_bytes / 1048576).toFixed(1)} MB / 额度 ${fresh.quota_mb} MB`, 'system');
      mtg.stopAccount(fresh.id);
      lastProc.delete(fresh.id);
      await billing.applyRules(fresh, false).catch(() => {});
    }
  }
  return { bytes: total, accounts: accounts.length, billed };
}

/** 账号启用/停用时同步流量闸门 */
export async function syncGate(acc, enabled) {
  await billing.applyRules(acc, enabled).catch(() => {});
}

/** 进程 RSS 等运行信息 */
export function sampleStats() {
  const out = [];
  for (const r of mtg.runningAccounts()) {
    let rss = 0;
    try {
      const statm = fs.readFileSync(`/proc/${r.pid}/statm`, 'utf8').trim().split(/\s+/);
      rss = Number(statm[1]) * 4096;
    } catch { /* ignore */ }
    out.push({ ...r, rss });
  }
  return out;
}

let timer = null;
export function startCollector(intervalMs = 30000) {
  if (timer) return;
  const tick = async () => {
    try { await collectOnce(); } catch (e) { console.error('[collector]', e.message); }
  };
  timer = setInterval(tick, intervalMs);
  setTimeout(tick, 4000);
}

export function stopCollector() {
  if (timer) clearInterval(timer);
  timer = null;
}
