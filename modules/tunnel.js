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
      if (f) return path.join(config.CF_CREDENTIALS_DIR, f)
    }
  } catch (err) {
    console.warn('[CF] No se pudo listar los túneles para emparejar credenciales:', err.message)
  }
  // Al menos advertimos en consola qué credenciales usaremos de respaldo
  console.warn(`[CF] Usando archivo de credenciales por defecto: ${all[0]}`)
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
  return new Promise((resolve, reject) => {
    if (tunnelProcess || state.tunnelUrl) {
      resolve({ url: state.tunnelUrl })
      return
    }
    if (!config.CF_TUNNEL_NAME || !config.CF_DOMAIN) {
      reject(new Error('Falta CF_TUNNEL_NAME o CF_DOMAIN en .env'))
      return
    }
    if (!fs.existsSync(config.CF_BIN)) {
      reject(new Error('cloudflared no instalado'))
      return
    }
    
    // Check if tunnel already running
    tunnelAlreadyRunning()
      .then(running => {
        if (running) {
          resolve({ url: state.tunnelUrl })
          return
        }
        
        // Continue with tunnel startup
        findTunnelCredentials()
          .then(credsFile => {
            if (!credsFile) {
              reject(new Error(`No hay credenciales para ${config.CF_TUNNEL_NAME}`))
              return
            }

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
            
            const connectTimeout = setTimeout(() => {
              if (!connected && tunnelProcess) {
                console.error('[CF] Timeout superado (60s) esperando conexión — deteniendo proceso')
                tunnelProcess.kill()
                reject(new Error('Timeout superado (60s) esperando conexión'))
              }
            }, 60000)

            // Buffer para reconstruir líneas completas de logs
            let stderrBuffer = ''

            tunnelProcess.stderr.on('data', d => {
              stderrBuffer += d.toString()
              const lines = stderrBuffer.split('\n')
              
              // El último elemento puede ser una línea incompleta, la dejamos en el buffer
              stderrBuffer = lines.pop()

              for (let line of lines) {
                line = line.trim()
                if (!line) continue
                
                console.log('[CF]', line)
                errLog += line + '\n'

                // Filtros más estrictos para asegurar que realmente se conectó
                const isRegistered = line.includes('Registered tunnel') || line.includes('Registered connection')
                const isEstablished = line.includes('Connection') && line.includes('established')

                if (!connected && (isRegistered || isEstablished)) {
                  clearTimeout(connectTimeout)
                  connected = true
                  state.tunnelUrl = `https://${config.CF_DOMAIN}`
                  eventBus.emit('tunnel:open', { url: state.tunnelUrl })
                  sse.broadcast({ type: 'tunnel', status: 'open', url: state.tunnelUrl })
                  resolve({ url: state.tunnelUrl })
                }
              }
            })

            tunnelProcess.on('error', err => {
              clearTimeout(connectTimeout)
              tunnelProcess = null
              state.tunnelUrl = null
              eventBus.emit('tunnel:error', { error: err.message })
              sse.broadcast({ type: 'tunnel', status: 'closed', error: err.message })
              reject(new Error(`Error al iniciar proceso: ${err.message}`))
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
              
              // Asegúrate de validar si la condición 'state.tokens' es realmente necesaria para reintentar
              if (!wasIntentional) {
                console.log('[CF] Intento de reconexión programado en 10 segundos...')
                sse.broadcast({ type: 'subscription', event: 'tunnel', status: 'reconnecting' })
                setTimeout(() => startTunnel().catch(() => {}), 10000)
              }
              
              // Only reject if we haven't already resolved (connection succeeded)
              if (!connected) {
                reject(new Error(`Proceso finalizado con código: ${code}`))
              }
            })
          })
          .catch(reject)
      })
      .catch(reject)
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