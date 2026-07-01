// ponytail: merged config, reads env from the main backend's process.env
const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')

// ponytail: load GACHA's own .env (GITHUB_TOKEN lives here)
try {
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').forEach(l => {
    const i = l.indexOf('=')
    if (i > 0) process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim()
  })
} catch {}

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  kickBackendUrl: process.env.KICK_BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`,
  dev: process.env.NODE_ENV !== 'production',
  githubToken: process.env.GITHUB_TOKEN || '',
  github: {
    owner: 'mrsnakke',
    repo: 'gachaIMG',
    branch: 'main',
  },
  dataDir: path.resolve(ROOT, 'GachaWish'),
  webDir: path.resolve(ROOT, 'web'),
  rootDir: ROOT,
}

module.exports = config
