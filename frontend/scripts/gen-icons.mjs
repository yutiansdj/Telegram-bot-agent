/**
 * 从 @iconify-json/tabler/icons.json 中提取项目实际用到的图标，
 * 生成体积很小的 src/utils/tabler-subset.js（避免把 2MB 全量图标集打进前端包）。
 *
 * 用法：node scripts/gen-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const iconFile = path.join(root, 'node_modules/@iconify-json/tabler/icons.json');

const used = new Set();

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(p); continue; }
    if (!/\.(vue|js|ts)$/.test(entry.name)) continue;
    if (p.endsWith('tabler-subset.js')) continue;
    const text = fs.readFileSync(p, 'utf8');
    for (const m of text.matchAll(/tabler:([a-z0-9-]+)/g)) used.add(m[1]);
  }
}
walk(srcDir);

const all = JSON.parse(fs.readFileSync(iconFile, 'utf8'));
const icons = {};
const missing = [];
for (const name of [...used].sort()) {
  if (all.icons[name]) icons[name] = all.icons[name];
  else missing.push(name);
}

const out = `// 由 scripts/gen-icons.mjs 自动生成，请勿手动修改
// 仅包含项目中实际使用的 tabler 图标（共 ${Object.keys(icons).length} 个）
export const tablerSubset = ${JSON.stringify({ prefix: 'tabler', icons, width: all.width, height: all.height })};
`;
fs.writeFileSync(path.join(srcDir, 'utils/tabler-subset.js'), out);
console.log(`生成完成：${Object.keys(icons).length} 个图标${missing.length ? `，缺失：${missing.join(', ')}` : ''}`);
