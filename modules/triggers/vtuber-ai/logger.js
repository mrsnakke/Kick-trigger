const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.VTUBER_LOG_DIR || './logs/vtuber-ai';
const MAX_LOG_AGE_DAYS = 30;

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function logFile(username) {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${username}_${date}.jsonl`);
}

function logMessage(entry) {
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(logFile(entry.username), line, 'utf-8');
}

function getConversation(username, maxTurns = 15) {
  const file = logFile(username);
  if (!fs.existsSync(file)) return [];

  const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
  const entries = lines.map(l => JSON.parse(l));
  return entries.slice(-maxTurns * 2);
}

// limpieza de logs viejos al arrancar
(() => {
  const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 86400000;
  for (const f of fs.readdirSync(LOG_DIR)) {
    const p = path.join(LOG_DIR, f);
    if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
  }
})();

module.exports = { logMessage, getConversation };
