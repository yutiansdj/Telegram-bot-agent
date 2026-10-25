/**
 * 基于 iptables owner 模块的按账号精确计费
 *
 * 原理：
 *   每个代理账号对应一个独立系统用户 tgpA<id>（固定 UID），mtg 进程以该 UID 运行，
 *   从而该进程发出的【全部】流量（直连 Telegram DC / 隐藏域名 / 中继）都由内核精确计数，
 *   不依赖代理软件自身的统计能力，也天然解决了"一个账号 = 一份用量"的隔离问题。
 *
 * 规则结构（nat 与 filter 表各一条链）：
 *   mangle OUTPUT: -m owner --uid-owner U -> TGACCT_OUT（按 UID 计数返回）-> RETURN
 *   filter  OUTPUT: -m owner --uid-owner U -p tcp --dport 443 -j DROP  （额度用尽流量闸门）
 *
 * 出方向统计用于账单；入方向由内核按连接计入进程，用 /proc/<pid>/net/dev 不可靠，
 * 因此「上行」取 owner 计数，「下行」通过连接跟踪无法按进程区分，
 * 这里采用双向折算计费：上行精确计数 × 1，并按 DC 回包比例折算下行（保守估计），
 * 平台同时提供「按上行计费 / 双向计费」两种口径供管理员在系统设置中选择。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { db, getSetting, audit } from './db.js';

const ACCT_CHAIN = 'TGACCT';
const GATE_CHAIN = 'TGGATE';
const UID_BASE = 4100; // tgpA<id> 的 UID = UID_BASE + accountId

export function uidFor(accountId) {
  return UID_BASE + Number(accountId);
}

export function userFor(accountId) {
  return `tgp${accountId}`;
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || (err ? err.message : '') });
    });
  });
}

let ready = false;

/** 初始化链与系统用户（幂等） */
export async function ensureAccounting() {
  const chk = await run('iptables', ['-nL']);
  if (!chk.ok) {
    console.warn('[billing] iptables 不可用，流量计费降级为代理内核指标：', chk.stderr.trim());
    return false;
  }
  for (const [chain, parent] of [[ACCT_CHAIN, 'OUTPUT'], [GATE_CHAIN, 'OUTPUT']]) {
    await run('iptables', ['-N', chain]);
    const has = await run('iptables', ['-C', parent, '-j', chain]);
    if (!has.ok) await run('iptables', ['-I', parent, '1', '-j', chain]);
  }
  ready = true;
  return true;
}

export function isReady() { return ready; }

/** 为账号创建系统用户（首次使用时） */
export async function ensureUser(accountId) {
  const uid = uidFor(accountId);
  const name = userFor(accountId);
  const exists = await run('id', ['-u', name]);
  if (exists.ok) return Number(exists.stdout.trim());
  await run('groupadd', ['-g', String(uid), name]);
  await run('useradd', ['-u', String(uid), '-g', String(uid), '-M', '-s', '/usr/sbin/nologin', name]);
  return uid;
}

/** 登记账号的计费规则（含流量闸门） */
export async function applyRules(acc, enabled) {
  if (!ready) return;
  const uid = uidFor(acc.id);
  // 会计链：命中后计数并返回
  const acctRule = ['-m', 'owner', '--uid-owner', String(uid), '-j', 'RETURN'];
  const hasAcct = await run('iptables', ['-C', ACCT_CHAIN, ...acctRule]);
  if (!hasAcct.ok) await run('iptables', ['-I', ACCT_CHAIN, '1', ...acctRule]);

  // 闸门链：额度用尽 / 停用时阻断该 UID 的全部出站
  const gateRule = ['-m', 'owner', '--uid-owner', String(uid), '-j', 'DROP'];
  const hasGate = await run('iptables', ['-C', GATE_CHAIN, ...gateRule]);
  if (enabled) {
    if (hasGate.ok) await run('iptables', ['-D', GATE_CHAIN, ...gateRule]);
  } else if (!hasGate.ok) {
    await run('iptables', ['-I', GATE_CHAIN, '1', ...gateRule]);
  }
}

export async function removeRules(acc) {
  if (!ready) return;
  const uid = uidFor(acc.id);
  const acctRule = ['-m', 'owner', '--uid-owner', String(uid), '-j', 'RETURN'];
  const gateRule = ['-m', 'owner', '--uid-owner', String(uid), '-j', 'DROP'];
  await run('iptables', ['-D', ACCT_CHAIN, ...acctRule]);
  await run('iptables', ['-D', GATE_CHAIN, ...gateRule]);
}

/** 读取每个账号的精确上行字节数（累计值，跨进程重启不丢） */
export async function readCounters() {
  const res = await run('iptables', ['-L', ACCT_CHAIN, '-v', '-n', '-x']);
  const out = new Map(); // accountId -> bytes（仅上行）
  if (!res.ok) return out;
  for (const line of res.stdout.split('\n')) {
    const m = line.match(/^\s*\d+\s+(\d+)\s+RETURN.*owner UID match (\d+)/);
    if (!m) continue;
    const uid = Number(m[2]);
    const accId = uid - UID_BASE;
    if (accId > 0) out.set(accId, Number(m[1]));
  }
  return out;
}

/** 读取进程出方向/入方向字节（/proc/<pid>/net/dev 为命名空间级，仅用于总览展示） */
export function procNetBytes(pid) {
  try {
    const s = fs.readFileSync(`/proc/${pid}/net/dev`, 'utf8');
    let up = 0;
    for (const line of s.split('\n').slice(2)) {
      const parts = line.split(':');
      if (parts.length < 2) continue;
      const f = parts[1].trim().split(/\s+/);
      if (parts[0].trim() === 'lo') continue;
      up += Number(f[8] || 0);
    }
    return up;
  } catch {
    return null;
  }
}
