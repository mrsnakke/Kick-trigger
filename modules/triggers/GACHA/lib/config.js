// ponytail: merged config, reads env from the main backend's process.env
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

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
