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
    if (!fs.existsSync(config.CF_BIN)) return reject(new Error('cloudflared no instalado'))
    exec(`"${config.CF_BIN}" ${args}`, (err, stdout) => {
      if (err) reject(err); else resolve(stdout)
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
      if (f) return { filePath: path.join(config.CF_CREDENTIALS_DIR, f), tunnelId: t.id }
    }
  } catch (err) {
    console.warn('[CF] No se pudo listar los túneles para emparejar credenciales:', err.message)
  }
  const tunnelId = path.basename(all[0], '.json')
  console.warn(`[CF] Usando archivo de credenciales por defecto: ${all[0]}`)
  return { filePath: path.join(config.CF_CREDENTIALS_DIR, all[0]), tunnelId }
}

async function tunnelAlreadyRunning() {
  try {
    const out = await cfExec(`tunnel --output json info ${config.CF_TUNNEL_NAME}`)
    const t = JSON.parse(out)
    if (t.conns && t.conns.length > 0) return true
  } catch {}
  return false
}

async function waitForTunnelHealthy(maxAttempts = 10, delay = 2000) {
  if (!config.CF_DOMAIN) return false
  const url = `https://${config.CF_DOMAIN}/api/status`
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (resp.ok) {
        console.log('[CF] Health check OK')
        return true
      }
    } catch {}
    await new Promise(r => setTimeout(r, delay))
  }
  console.error('[CF] Health check falló después de', maxAttempts, 'intentos')
  return false
}

async function startTunnel() {
  if (tunnelProcess || state.tunnelUrl) return { url: state.tunnelUrl }
  if (!config.CF_TUNNEL_NAME || !config.CF_DOMAIN) throw new Error('Falta CF_TUNNEL_NAME o CF_DOMAIN en .env')
  if (!fs.existsSync(config.CF_BIN)) throw new Error('cloudflared no instalado')

  if (await tunnelAlreadyRunning()) {
    state.tunnelUrl = `https://${config.CF_DOMAIN}`
    if (await waitForTunnelHealthy()) {
      eventBus.emit('tunnel:open', { url: state.tunnelUrl })
      sse.broadcast({ type: 'tunnel', status: 'open', url: state.tunnelUrl })
      return { url: state.tunnelUrl }
    }
    state.tunnelUrl = null
  }

  const creds = await findTunnelCredentials()
  if (!creds) throw new Error(`No hay credenciales para ${config.CF_TUNNEL_NAME}`)

  const yml = `tunnel: ${creds.tunnelId}
credentials-file: ${creds.filePath.replace(/\\/g, '/')}
originRequest:
  connectTimeout: 30s
ingress:
  - service: http://localhost:${config.PORT}
`
  fs.writeFileSync(config.CF_CONFIG, yml)

  tunnelProcess = spawn(config.CF_BIN, ['tunnel', '--config', config.CF_CONFIG, 'run', config.CF_TUNNEL_NAME], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })

  return new Promise((resolve, reject) => {
    let errLog = ''
    let connected = false
    let rejected = false
    let healthCheckPassed = false

    const connectTimeout = setTimeout(() => {
      if (!healthCheckPassed && tunnelProcess) {
        console.error('[CF] Timeout superado (60s) esperando conexión — deteniendo proceso')
        tunnelProcess.kill()
        if (!rejected) { rejected = true; reject(new Error('Timeout superado (60s) esperando conexión')) }
      }
    }, 60000)

    let stderrBuffer = ''

    tunnelProcess.stderr.on('data', d => {
      stderrBuffer += d.toString()
      const lines = stderrBuffer.split('\n')
      stderrBuffer = lines.pop()

      for (let line of lines) {
        line = line.trim()
        if (!line) continue

        console.log('[CF]', line)
        errLog += line + '\n'

        if (!connected && (line.includes('Registered tunnel') || line.includes('Registered connection') || (line.includes('Connection') && line.includes('established')))) {
          connected = true
          ;(async () => {
            const healthy = await waitForTunnelHealthy()
            if (rejected) return
            if (healthy) {
              clearTimeout(connectTimeout)
              healthCheckPassed = true
              state.tunnelUrl = `https://${config.CF_DOMAIN}`
              eventBus.emit('tunnel:open', { url: state.tunnelUrl })
              sse.broadcast({ type: 'tunnel', status: 'open', url: state.tunnelUrl })
              rejected = true
              resolve({ url: state.tunnelUrl })
            } else if (!rejected) {
              tunnelProcess?.kill()
              rejected = true
              reject(new Error('Health check falló después de conexión cloudflared'))
            }
          })()
        }
      }
    })

    tunnelProcess.on('error', err => {
      clearTimeout(connectTimeout)
      tunnelProcess = null
      state.tunnelUrl = null
      eventBus.emit('tunnel:error', { error: err.message })
      sse.broadcast({ type: 'tunnel', status: 'closed', error: err.message })
      if (!rejected) { rejected = true; reject(new Error(`Error al iniciar proceso: ${err.message}`)) }
    })

    tunnelProcess.on('exit', code => {
      clearTimeout(connectTimeout)
      tunnelProcess = null
      state.tunnelUrl = null
      const wasIntentional = tunnelIntentionalStop
      tunnelIntentionalStop = false

      if (errLog) console.error('[CF] Proceso finalizado con código:', code)

      eventBus.emit('tunnel:closed', { exitCode: code, log: errLog.slice(0, 1000) })
      sse.broadcast({ type: 'tunnel', status: 'closed', exitCode: code, log: errLog.slice(0, 1000) })

      if (!wasIntentional) {
        console.log('[CF] Intento de reconexión programado en 10 segundos...')
        sse.broadcast({ type: 'subscription', event: 'tunnel', status: 'reconnecting' })
        setTimeout(() => startTunnel().catch(() => {}), 10000)
      }

      if (!healthCheckPassed && !rejected) {
        rejected = true
        reject(new Error(`Proceso finalizado con código: ${code}`))
      }
    })
  })
}

async function startHandler(req, res) {
  const result = await startTunnel()
  if (result.error) return res.status(400).json(result)
  res.json(result)
}

function stopHandler(_req, res) {
  tunnelIntentionalStop = true
  if (tunnelProcess) { 
    tunnelProcess.kill()
    tunnelProcess = null
    state.tunnelUrl = null 
  }
  res.json({ ok: true })
}

// Asegurar que el subproceso cloudflared muera si la app de Node.js finaliza
function cleanup() {
  if (tunnelProcess) {
    console.log('[CF] Limpieza: Matando proceso huérfano de cloudflared')
    tunnelProcess.kill('SIGTERM')
  }
}
process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit() })
process.on('SIGTERM', () => { cleanup(); process.exit() })

module.exports = { 
  startTunnel, 
  startHandler, 
  stopHandler, 
  getTunnelProcess: () => tunnelProcess, 
  getTunnelIntentionalStop: () => tunnelIntentionalStop, 
  setTunnelIntentionalStop: v => { tunnelIntentionalStop = v } 
}