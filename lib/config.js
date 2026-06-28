const path = require('path')
const fs = require('fs')

try {
  fs.readFileSync('.env', 'utf8').split('\n').forEach(l => {
    const i = l.indexOf('=')
    if (i > 0) process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim()
  })
} catch {}

const PORT = process.env.PORT || 3000

module.exports = {
  PORT,
  CLIENT_ID: process.env.KICK_CLIENT_ID,
  CLIENT_SECRET: process.env.KICK_CLIENT_SECRET,
  REDIRECT_URI: process.env.KICK_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`,
  CF_TUNNEL_NAME: process.env.CF_TUNNEL_NAME,
  CF_DOMAIN: process.env.CF_DOMAIN,
  CF_BIN: path.join(process.env.LOCALAPPDATA || '', 'cloudflared', 'cloudflared.exe'),
  CF_CREDENTIALS_DIR: path.join(process.env.USERPROFILE || process.env.HOME, '.cloudflared'),
  CF_CONFIG: path.join(__dirname, '..', 'cloudflared.yml'),
  TOKENS_PATH: path.join(__dirname, '..', 'tokens.json'),
  BOT_TOKENS_PATH: path.join(__dirname, '..', 'bot_tokens.json'),
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || process.env.VTUBER_API_KEY,
  // ponytail: tantas FORWARD_URL_ como quieras en .env, se leen automáticamente
  FORWARD_URLS: Object.keys(process.env).filter(k => k.startsWith('FORWARD_URL_')).map(k => process.env[k]).filter(Boolean),
  TEN_MINUTES: 10 * 60 * 1000,
}
