import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.TGPROXY_ROOT || '/opt/tgproxy';

function loadEnvFile(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
    }
  } catch { /* ignore */ }
}
loadEnvFile(path.join(ROOT, 'backend/.env'));

export const config = {
  root: ROOT,
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || '127.0.0.1',
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'backend/data'),
  dbFile: process.env.DB_FILE || path.join(ROOT, 'backend/data/app.db'),
  instanceDir: process.env.INSTANCE_DIR || path.join(ROOT, 'instances'),
  mtgBin: process.env.MTG_BIN || path.join(ROOT, 'bin/mtg'),
  ipcDir: process.env.IPC_DIR || path.join(ROOT, 'run/ipc'),
  jwtSecret: process.env.JWT_SECRET || 'change-me-please',
  tokenTTL: Number(process.env.TOKEN_TTL || 86400 * 7),
  frontendDist: process.env.FRONTEND_DIST || path.join(ROOT, 'frontend/dist'),
  version: '1.0.0',
};

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.instanceDir, { recursive: true });
fs.mkdirSync(config.ipcDir, { recursive: true });
