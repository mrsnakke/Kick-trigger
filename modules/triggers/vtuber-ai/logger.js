const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.VTUBER_LOG_DIR || './logs/vtuber-ai';
const MAX_LOG_AGE_DAYS = 30;
const fsp = fs.promises;

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function logFile(username) {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${username}_${date}.jsonl`);
}

async function logMessage(entry) {
  const line = JSON.stringify(entry) + '\n';
  await fsp.appendFile(logFile(entry.username), line, 'utf-8');
}

async function getConversation(username, maxTurns = 15) {
  const file = logFile(username);
  try {
    const raw = await fsp.readFile(file, 'utf-8');
    const lines = raw.trim().split('\n');
    const entries = lines.map(l => JSON.parse(l));
    return entries.slice(-maxTurns * 2);
  } catch {
    return [];
  }
}

// limpieza de logs viejos al arrancar
(async () => {
  try {
    const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 86400000;
    const files = await fsp.readdir(LOG_DIR);
    for (const f of files) {
      const p = path.join(LOG_DIR, f);
      const stat = await fsp.stat(p);
      if (stat.mtimeMs < cutoff) await fsp.unlink(p);
    }
  } catch {}
})();

module.exports = { logMessage, getConversation };
