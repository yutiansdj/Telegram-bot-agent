/**
 * 邀请奖励系统
 *
 * 生成「邀请链接」：t.me/<bot>?start=<邀请码>
 * 被邀请人通过链接首次 /start 时绑定邀请关系；
 * 按配置（立即 / 完成验证后）发放奖励给邀请人（默认 0.7GB），可另设被邀请人奖励。
 */
import crypto from 'node:crypto';
import { db, getSettings, getSetting, getSettingNum, getSettingBool } from './db.js';

function nowStr() {
  return new Date(Date.now() + 8 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
}

export function genCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) s += chars[bytes[i] % chars.length];
  return s;
}

/** 获取或创建该用户的专属邀请码 */
export function getOrCreateInvite(bu) {
  let link = db.prepare('SELECT * FROM invite_links WHERE inviter_tg_id = ? ORDER BY id LIMIT 1').get(String(bu.tg_id));
  if (!link) {
    let code = genCode();
    for (let i = 0; i < 5; i++) {
      if (!db.prepare('SELECT id FROM invite_links WHERE code = ?').get(code)) break;
      code = genCode();
    }
    db.prepare('INSERT INTO invite_links(code, inviter_tg_id, inviter_user_id) VALUES(?,?,?)')
      .run(code, String(bu.tg_id), bu.user_id || null);
    link = db.prepare('SELECT * FROM invite_links WHERE code = ?').get(code);
  }
  return link;
}

export function inviteUrl(code) {
  const uname = getSetting('bot_username');
  if (!uname) return '';
  return `https://t.me/${uname}?start=${code}`;
}

/**
 * /start 带参数时调用：绑定邀请关系
 * 返回 { ok, reason } —— 是否首次绑定成功
 */
export function bindInvite(bu, code) {
  if (!getSettingBool('bot_ref_enabled') || !code) return { ok: false, reason: 'disabled' };
  const link = db.prepare('SELECT * FROM invite_links WHERE code = ?').get(String(code).trim());
  if (!link) return { ok: false, reason: 'invalid' };
  if (String(link.inviter_tg_id) === String(bu.tg_id)) return { ok: false, reason: 'self' };
  // 已有绑定（被邀请过）
  const exists = db.prepare('SELECT * FROM invite_records WHERE invitee_tg_id = ?').get(String(bu.tg_id));
  if (exists) return { ok: false, reason: 'already' };

  // 每日/总量限制
  const dailyLimit = getSettingNum('bot_ref_daily_limit');
  if (dailyLimit > 0) {
    const todayCnt = db.prepare("SELECT COUNT(*) AS c FROM invite_records WHERE inviter_tg_id = ? AND created_at >= date('now')")
      .get(String(link.inviter_tg_id)).c;
    if (todayCnt >= dailyLimit) return { ok: false, reason: 'daily_limit' };
  }
  const maxReward = getSettingNum('bot_ref_max_reward');
  if (maxReward > 0) {
    const total = db.prepare("SELECT COALESCE(SUM(reward_mb),0) AS s FROM invite_records WHERE inviter_tg_id = ? AND status = 'rewarded'")
      .get(String(link.inviter_tg_id)).s;
    if (total >= maxReward) return { ok: false, reason: 'max_reward' };
  }

  const needVerify = getSettingBool('bot_ref_need_verify');
  const info = db.prepare('INSERT INTO invite_records(code, inviter_tg_id, invitee_tg_id, invitee_name, reward_mb, status) VALUES(?,?,?,?,?,?)')
    .run(link.code, String(link.inviter_tg_id), String(bu.tg_id), bu.tg_username || bu.tg_first_name || '', 0, needVerify ? 'pending' : 'confirmed');
  db.prepare('UPDATE invite_links SET use_count = use_count + 1, last_used = ? WHERE code = ?').run(nowStr(), link.code);
  return { ok: true, reason: needVerify ? 'pending' : 'confirmed', recordId: info.lastInsertRowid, inviter: link.inviter_tg_id };
}

/** 发放奖励（幂等） */
export function grantReward(recordId) {
  const rec = db.prepare('SELECT * FROM invite_records WHERE id = ?').get(recordId);
  if (!rec || rec.status === 'rewarded') return null;
  const mb = getSettingNum('bot_ref_bonus_mb') || 716;
  const inviteeMb = getSettingNum('bot_ref_invitee_mb') || 0;
  const reward = mb * Math.max(1, getSettingNum('bot_ref_per_invite') || 1);
  const now = nowStr();

  // 邀请人：机器人余额 + 平台额度（共享池模式）
  db.prepare('UPDATE bot_users SET balance_mb = balance_mb + ? WHERE tg_id = ?').run(reward, rec.inviter_tg_id);
  const inviter = db.prepare('SELECT * FROM bot_users WHERE tg_id = ?').get(rec.inviter_tg_id);
  if (inviter?.user_id && (getSetting('bot_quota_mode') || 'pool') === 'pool') {
    db.prepare('UPDATE users SET quota_mb = quota_mb + ? WHERE id = ?').run(reward, inviter.user_id);
  }
  // 被邀请人奖励
  if (inviteeMb > 0) {
    db.prepare('UPDATE bot_users SET balance_mb = balance_mb + ? WHERE tg_id = ?').run(inviteeMb, rec.invitee_tg_id);
    const invitee = db.prepare('SELECT * FROM bot_users WHERE tg_id = ?').get(rec.invitee_tg_id);
    if (invitee?.user_id && (getSetting('bot_quota_mode') || 'pool') === 'pool') {
      db.prepare('UPDATE users SET quota_mb = quota_mb + ? WHERE id = ?').run(inviteeMb, invitee.user_id);
    }
  }
  db.prepare("UPDATE invite_records SET status = 'rewarded', reward_mb = ? WHERE id = ?").run(reward, recordId);
  void now;
  return { reward, inviteeMb, inviterTg: rec.inviter_tg_id };
}

/** 被邀请人完成验证/签到后触发 */
export function tryConfirmInvite(tgId) {
  const rec = db.prepare('SELECT * FROM invite_records WHERE invitee_tg_id = ? AND status = ?').get(String(tgId), 'pending');
  if (!rec) return null;
  return grantReward(rec.id);
}

/** 统计 */
export function inviteStats(tgId) {
  const rows = db.prepare('SELECT * FROM invite_records WHERE inviter_tg_id = ? ORDER BY id DESC').all(String(tgId));
  const rewarded = rows.filter((r) => r.status === 'rewarded');
  const pending = rows.filter((r) => r.status === 'pending');
  const totalMb = rewarded.reduce((s, r) => s + Number(r.reward_mb || 0), 0);
  const today = rewarded.filter((r) => r.created_at.slice(0, 10) === nowStr().slice(0, 10));
  return {
    total: rows.length,
    rewarded: rewarded.length,
    pending: pending.length,
    totalMb,
    today: today.length,
    list: rows.slice(0, 10),
  };
}

/** 后台：全部邀请记录 */
export function allInviteRecords(limit = 200) {
  return db.prepare('SELECT * FROM invite_records ORDER BY id DESC LIMIT ?').all(limit);
}

/** 卡片文案 */
export function inviteCard(bu) {
  const link = getOrCreateInvite(bu);
  const st = inviteStats(bu.tg_id);
  const url = inviteUrl(link.code);
  const mb = getSettingNum('bot_ref_bonus_mb') || 716;
  const fmt = (v) => (v >= 1024 ? `${(v / 1024).toFixed(2)} GB` : `${v.toFixed(0)} MB`);
  const text = getSetting('bot_ref_text') || [
    '🎉 <b>邀请好友领流量</b>',
    '',
    `每邀请 1 位新用户，你可获得 <b>${fmt(mb)}</b> 流量！`,
    '',
    `👥 已邀请：<b>${st.rewarded}</b> 人`,
    `🎁 累计获得：<b>${fmt(st.totalMb)}</b>`,
    st.pending ? `⏳ 待确认：<b>${st.pending}</b> 人（对方完成验证后到账）` : '',
    '',
    '👇 把下方链接发给朋友，对方通过链接打开机器人即可绑定',
  ].filter(Boolean).join('\n');
  return { text, url, code: link.code, stats: st };
}
