const { exec, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const config = require('../lib/config')
const eventBus = require('../lib/event-bus')
const state = require('../lib/state')
const sse = require('./sse')

let tunnelProcess = null
let tunnelIntentionalStop = false

function cfExec(args) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(config.CF_BIN)) return reject('cloudflared no instalado')
    exec(`"${config.CF_BIN}" ${args}`, (err, stdout) => {
      if (err) reject(err.message); else resolve(stdout)
    })
  })
}

async function findTunnelCredentials() {
  if (!fs.existsSync(config.CF_CREDENTIALS_DIR)) return null
  const all = fs.readdirSync(config.CF_CREDENTIALS_DIR).filter(f => f.endsWith('.json') && f !== 'cert.pem')
  if (!all.length) return null
  try {
    const list = await cfExec('tunnel --output json list')
    const tunnels = JSON.parse(list)
    const t = tunnels.find(t => t.name === config.CF_TUNNEL_NAME)
    if (t) {
      const f = all.find(f => f.startsWith(t.id))
      if (f) return path.join(config.CF_CREDENTIALS_DIR, f)
    }
  } catch {}
  return path.join(config.CF_CREDENTIALS_DIR, all[0])
}

async function tunnelAlreadyRunning() {
  try {
    const out = await cfExec(`tunnel --output json info ${config.CF_TUNNEL_NAME}`)
    const t = JSON.parse(out)
    if (t.conns && t.conns.length > 0) {
      state.tunnelUrl = `https://${config.CF_DOMAIN}`
      eventBus.emit('tunnel:open', { url: state.tunnelUrl })
      sse.broadcast({ type: 'tunnel', status: 'open', url: state.tunnelUrl })
      return true
    }
  } catch {}
  return false
}

async function startTunnel() {
  if (tunnelProcess || state.tunnelUrl) return { url: state.tunnelUrl }
  if (!config.CF_TUNNEL_NAME || !config.CF_DOMAIN) return { error: 'Falta CF_TUNNEL_NAME o CF_DOMAIN en .env' }
  if (!fs.existsSync(config.CF_BIN)) return { error: 'cloudflared no instalado' }
  if (await tunnelAlreadyRunning()) return { url: state.tunnelUrl }

  const credsFile = await findTunnelCredentials()
  if (!credsFile) return { error: `No hay credenciales para ${config.CF_TUNNEL_NAME}` }

  const yml = `tunnel: ${config.CF_TUNNEL_NAME}
credentials-file: ${credsFile.replace(/\\/g, '/')}
ingress:
  - service: http://localhost:${config.PORT}
`
  fs.writeFileSync(config.CF_CONFIG, yml)

  tunnelProcess = spawn(config.CF_BIN, ['tunnel', '--config', config.CF_CONFIG, 'run', config.CF_TUNNEL_NAME], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })

  let errLog = ''
  let connected = false
  tunnelProcess.stderr.on('data', d => {
    errLog += d.toString()
    const line = d.toString().trim()
    if (line) console.log('[CF]', line)
    if (!connected && line && (line.includes('Registered') || line.includes('connection') || line.includes('+'))) {
      connected = true
      state.tunnelUrl = `https://${config.CF_DOMAIN}`
      eventBus.emit('tunnel:open', { url: state.tunnelUrl })
      sse.broadcast({ type: 'tunnel', status: 'open', url: state.tunnelUrl })
    }
  })
  tunnelProcess.on('error', err => {
    tunnelProcess = null
    state.tunnelUrl = null
    eventBus.emit('tunnel:error', { error: err.message })
    sse.broadcast({ type: 'tunnel', status: 'closed', error: err.message })
  })
  tunnelProcess.on('exit', code => {
    tunnelProcess = null
    state.tunnelUrl = null
    const wasIntentional = tunnelIntentionalStop
    tunnelIntentionalStop = false
    if (errLog) console.error('[CF] Exit:', code)
    eventBus.emit('tunnel:closed', { exitCode: code, log: errLog.slice(0, 1000) })
    sse.broadcast({ type: 'tunnel', status: 'closed', exitCode: code, log: errLog.slice(0, 1000) })
    if (!wasIntentional && state.tokens) {
      sse.broadcast({ type: 'subscription', event: 'tunnel', status: 'reconnecting' })
      setTimeout(startTunnel, 10000)
    }
  })

  return { url: state.tunnelUrl }
}

async function startHandler(req, res) {
  const result = await startTunnel()
  if (result.error) return res.status(400).json(result)
  res.json(result)
}

function stopHandler(_req, res) {
  tunnelIntentionalStop = true
  if (tunnelProcess) { tunnelProcess.kill(); tunnelProcess = null; state.tunnelUrl = null }
  res.json({ ok: true })
}

module.exports = { startTunnel, startHandler, stopHandler, getTunnelProcess: () => tunnelProcess, getTunnelIntentionalStop: () => tunnelIntentionalStop, setTunnelIntentionalStop: v => { tunnelIntentionalStop = v } }
