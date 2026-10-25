/**
 * 网页截图模块
 *
 * 安全限制：
 *   1. 仅允许 http/https 协议
 *   2. 必须经过管理员工具授权或用户显式请求
 *   3. 禁止访问内网地址（127.x / 10.x / 172.16-31.x / 192.168.x / localhost）
 *   4. 禁止访问云元数据服务（169.254.169.254）
 *   5. 超时与体积限制
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// 懒加载 playwright（未安装时给出友好提示）
let chromium = null;
async function getChromium() {
  if (chromium) return chromium;
  try {
    const mod = await import('playwright');
    chromium = mod.chromium;
    return chromium;
  } catch {
    try {
      const mod = await import('playwright-core');
      chromium = mod.chromium;
      return chromium;
    } catch {
      throw new Error('截图组件未安装，请在服务器执行：cd /opt/tgproxy/backend && npm i playwright && npx playwright install chromium');
    }
  }
}

/** 私有/内网地址检测 */
function isBlockedHost(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');

  // 元数据服务
  if (h === '169.254.169.254' || h === 'metadata.google.internal') return '云元数据地址';
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return '本机地址';
  if (h.endsWith('.local') || h.endsWith('.internal')) return '内网域名';

  // IPv4 私有段
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return '内网地址 10.x';
    if (a === 127) return '本机地址 127.x';
    if (a === 172 && b >= 16 && b <= 31) return '内网地址 172.16-31.x';
    if (a === 192 && b === 168) return '内网地址 192.168.x';
    if (a === 169 && b === 254) return '链路本地地址';
    if (a === 0) return '保留地址';
  }
  // IPv6 私有
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return 'IPv6 内网地址';
  return null;
}

/** 校验 URL 安全性 */
export function validateUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return { ok: false, reason: 'URL 格式不正确，需要以 http:// 或 https:// 开头' };
  }
  if (!['http:', 'https:'].includes(u.protocol)) {
    return { ok: false, reason: `不支持 ${u.protocol} 协议，只允许 http/https` };
  }
  const blocked = isBlockedHost(u.hostname);
  if (blocked) return { ok: false, reason: `该地址属于${blocked}，出于安全考虑不允许访问` };
  return { ok: true, url: u.toString() };
}

/**
 * 截图
 * @returns {{ok, filePath, buffer, width, height}}
 */
export async function screenshot(rawUrl, opts = {}) {
  const check = validateUrl(rawUrl);
  if (!check.ok) throw new Error(check.reason);

  const url = check.url;
  const width = Math.min(Math.max(Number(opts.width) || 1280, 400), 1920);
  const height = Math.min(Math.max(Number(opts.height) || 900, 300), 1600);
  const fullPage = !!opts.fullPage;
  const timeout = Math.min(Math.max(Number(opts.timeout) || 25000, 5000), 45000);

  const cr = await getChromium();
  const browser = await cr.launch({
    // 使用系统安装的 chromium
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true,
  });

  try {
    const page = await browser.newPage({
      viewport: { width, height },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'zh-CN',
    });

    // 拦截内网资源请求（防止 SSRF）
    await page.route('**/*', (route) => {
      try {
        const u = new URL(route.request().url());
        if (isBlockedHost(u.hostname)) return route.abort();
      } catch { /* ignore */ }
      return route.continue();
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    // 等待网络空闲，但最多再等 3 秒
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(600);

    const title = await page.title().catch(() => '');
    const buffer = await page.screenshot({ fullPage, type: 'jpeg', quality: 82 });

    // 保存到 uploads 目录，便于排查
    const dir = path.join(config.root, 'uploads', 'shots');
    fs.mkdirSync(dir, { recursive: true });
    const name = `shot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, buffer);

    return {
      ok: true,
      url,
      title,
      buffer,
      filePath,
      filename: name,
      width,
      height,
      size: buffer.length,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** 清理旧截图（保留最近 50 张） */
export function cleanupShots(keep = 50) {
  try {
    const dir = path.join(config.root, 'uploads', 'shots');
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir)
      .filter((f) => f.startsWith('shot_') && f.endsWith('.jpg'))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const item of files.slice(keep)) {
      fs.unlinkSync(path.join(dir, item.f));
    }
  } catch { /* ignore */ }
}
