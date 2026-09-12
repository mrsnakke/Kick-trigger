const express = require('express')
const http = require('http')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const os = require('os')

// -- Colorear [TAGS] en consola --
;(() => {
  const TAG_COLORS = {
    'VTUBER-AI': '\x1b[35m',  'VOZ': '\x1b[36m',       'VOICE-CHAT': '\x1b[36m',
    'SEND-BOT': '\x1b[33m',   'HEARTBEAT': '\x1b[90m',  'FWD': '\x1b[90m',
    'TUNNEL': '\x1b[32m',     'GACHA': '\x1b[33m',      'STORE': '\x1b[33m',
    'ENGINE': '\x1b[33m',     'CMDS': '\x1b[33m',       'INV': '\x1b[33m',
    'ADMIN': '\x1b[33m',      'TRADE': '\x1b[33m',      'WS': '\x1b[90m',
    'TTS2': '\x1b[94m',       'CHATBOT': '\x1b[32m',    'MUSIC': '\x1b[32m',
    'Strinova': '\x1b[36m',   'OBS-Actions': '\x1b[35m','OBS': '\x1b[35m',
    'EVENT-ACTIONS': '\x1b[35m', 'FIGHT': '\x1b[31m',   'GrimMemory': '\x1b[35m',
    'Store': '\x1b[33m',      'WEBHOOK': '\x1b[36m',    'SSE': '\x1b[90m',
    'SUB': '\x1b[32m',
  }
  const RST = '\x1b[0m'
  const re = /\[([A-Za-z0-9_-]+)\]/
  function colorize(args) {
    if (!args.length) return args
    const s = String(args[0])
    const m = s.match(re)
    if (m && TAG_COLORS[m[1]]) {
      args[0] = s.replace(m[0], TAG_COLORS[m[1]] + m[0] + RST)
    }
    return args
  }
  const origLog = console.log
  const origErr = console.error
  const origWarn = console.warn
  console.log = (...a) => origLog.apply(console, colorize(a))
  console.error = (...a) => origErr.apply(console, colorize(a))
  console.warn = (...a) => origWarn.apply(console, colorize(a))
})()
const config = require('./lib/config')
const state = require('./lib/state')
const auth = require('./modules/auth')
const webhook = require('./modules/webhook')
const chat = require('./modules/chat')
const tunnel = require('./modules/tunnel')
const sse = require('./modules/sse')
const events = require('./modules/events')
const forwarder = require('./lib/forwarder')
const ttsTrigger = require('./modules/triggers/TTS2')
const gacha = require('./modules/triggers/GACHA')
const vtuber = require('./modules/triggers/vtuber-ai')
const eventActions = require('./modules/triggers/event-actions')
const obsActions = require('./modules/triggers/obs-actions')
const music = require('./modules/triggers/Music')
const chatbot = require('./modules/triggers/chatbot')
const strinova = require('./modules/triggers/strinova-app')
const fighting = require('./modules/triggers/fighting')
const sevenTv = require('./modules/7tv')
const profile = require('./modules/profile')
const chatwidgetConfig = require('./modules/chatwidget-config')

const app = express()
const server = http.createServer(app)

function getLanIp() {
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) {
        if (n.family === 'IPv4' && !n.internal) return n.address
      }
    }
  } catch {}
  return null
}
state.lanIp = getLanIp()

// -- Preservar raw body para validación webhook --
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf }
}))
app.use(express.static(path.join(__dirname, 'public')))

// -- Auth --
app.get('/auth/login', auth.login)
app.get('/auth/callback', auth.callback)
app.get('/auth/bot/login', auth.botLogin)
app.get('/auth/bot/callback', auth.callback)

// -- Webhook --
app.all('/webhook/kick', webhook.handle)

// -- SSE --
app.get('/api/events', sse.handle)

// -- Chat --
app.post('/api/chat/send', express.json(), chat.send)

// -- 7TV & Profile --
app.get('/api/7tv/:userId', sevenTv.handler)
app.get('/api/profile/:username', profile.handler)

// -- ChatWidget --
app.use('/chatwidget', express.static(path.join(__dirname, 'public/chatwidget')))
app.get('/api/chatwidget/config', chatwidgetConfig.handleGet)
app.post('/api/chatwidget/config', express.json(), chatwidgetConfig.handlePost)

// -- Chat como Bot --
app.post('/api/chat/send-bot', express.json(), async (req, res) => {
  try {
    const { content, reply_to_message_id } = req.body
    console.log('[SEND-BOT] Enviando:', content?.slice(0, 50));
    if (!state.botTokens) {
      console.error('[SEND-BOT] botTokens es null');
      return res.status(400).json({ error: 'Bot no autenticado. Hacé clic en "Autorizar Bot".' })
    }
    const data = await chat.sendAsBot(content, reply_to_message_id)
    console.log('[SEND-BOT] Respuesta:', JSON.stringify(data));
    res.json(data)
  } catch (err) {
    console.error('[SEND-BOT] Error:', err.message)
    res.status(400).json({ error: err.message })
  }
})

// -- Estado --
app.get('/api/status', (req, res) => {
  res.json({
    authenticated: !!state.tokens,
    botAuthenticated: !!state.botTokens,
    clientId: !!config.CLIENT_ID,
    tunnelUrl: state.tunnelUrl,
    broadcasterUserId: state.broadcasterUserId,
    channelSlug: state.channelSlug,
    eventsCounter: state.eventsCounter,
    sseClients: state.sseClients.length,
    lanIp: state.lanIp
  })
})

// -- Suscripción a eventos --
app.get('/api/events/subscriptions', events.listHandler)
app.post('/api/events/subscribe', events.subscribeHandler)

// -- Túnel --
app.post('/api/tunnel/start', tunnel.startHandler)
app.post('/api/tunnel/stop', tunnel.stopHandler)

// -- TTS --
app.get('/api/tts/config', ttsTrigger.handleGetConfig)
app.post('/api/tts/config', express.json(), ttsTrigger.handleSaveConfig)
app.get('/api/tts/user-aliases', ttsTrigger.handleGetUserAliases)
app.post('/api/tts/user-alias/delete', express.json(), ttsTrigger.handleDeleteUserAlias)
app.post('/api/tts/toggle', express.json(), ttsTrigger.handleToggleBot)
app.get('/api/tts/status', ttsTrigger.handleGetStatus)
app.get('/api/tts/voices', ttsTrigger.handleGetVoices)
app.get('/api/tts/outputs', ttsTrigger.handleGetOutputs)
app.post('/api/tts/speak-now', express.json(), ttsTrigger.handleSpeakNow)
app.post('/api/tts/speak-queue', express.json(), ttsTrigger.handleSpeakQueue)
app.get('/api/tts/queue', ttsTrigger.handleGetQueue)
app.delete('/api/tts/queue', ttsTrigger.handleClearQueue)
app.get('/api/tts/events', ttsTrigger.handleSSE)
ttsTrigger.init()

// -- VTUBER-AI --
app.get('/api/vtuber/status', vtuber.handleGetStatus)
app.get('/api/vtuber/config', vtuber.handleGetConfig)
app.post('/api/vtuber/config', express.json(), vtuber.handleSaveConfig)
app.post('/api/vtuber/test', express.json(), vtuber.handleTest)
app.post('/api/vtuber/vts/connect', vtuber.handleVTSConnect)
app.post('/api/vtuber/vts/disconnect', vtuber.handleVTSDisconnect)
app.get('/api/vtuber/vts/status', vtuber.handleVTSStatus)
app.post('/api/vtuber/vts/expression', express.json(), vtuber.handleVTSExpression)
app.post('/api/vtuber/vts/hotkey', express.json(), vtuber.handleVTSHotkey)
app.get('/api/vtuber/vts/params', vtuber.handleVTSParams)
app.post('/api/vtuber/vts/param', express.json(), vtuber.handleVTSInjectParam)
app.post('/api/vtuber/memory/clear', express.json(), vtuber.handleClearMemory)
app.get('/api/vtuber/memory/stats', vtuber.handleMemoryStats)
app.get('/api/vtuber/mood', vtuber.handleMoodStatus)

// -- Voice Chat (voz privada → Grim → TTS) --
app.get('/api/voice-chat/status', (_req, res) => {
  let sent = false
  const send = (data) => { if (!sent) { sent = true; res.json(data) } }
  const req = http.get('http://127.0.0.1:8000/', { timeout: 2000 }, () => {
    send({ ok: true, running: true, port: 8000 })
  })
  req.on('error', () => send({ ok: true, running: false, port: 8000 }))
  req.on('timeout', () => { req.destroy(); send({ ok: true, running: false, port: 8000 }) })
})
app.post('/api/voice-chat/ask', express.json(), async (req, res) => {
  const { text } = req.body || {}
  if (!text || typeof text !== 'string') return res.status(400).json({ ok: false, error: 'text requerido' })
  console.log('[VOICE-CHAT] Voz recibida:', text.slice(0, 80))
  sse.broadcast({ type: 'voice-chat', _source: 'voice-chat', direction: 'user', content: text })
  try {
    const result = await vtuber.processMessage('Streamowner', text, true, null, true)
    if (result.error) return res.status(500).json({ ok: false, error: result.error })
    sse.broadcast({ type: 'voice-chat', _source: 'voice-chat', direction: 'bot', content: result.text })
    res.json({ ok: true, text: result.text })
  } catch (err) {
    console.error('[VOICE-CHAT] Error:', err.message)
    res.status(500).json({ ok: false, error: err.message })
  }
})

// Proxy audio recording → Python /ask (evita CORS)
app.post('/api/voice-chat/ask-recording', (req, res) => {
  const proxyReq = http.request(`http://127.0.0.1:8000/ask`, { method: 'POST', headers: { 'content-type': req.headers['content-type'], 'content-length': req.headers['content-length'] }, timeout: 30000 }, (proxyRes) => {
    let body = ''; proxyRes.on('data', c => body += c); proxyRes.on('end', () => {
      res.status(proxyRes.statusCode).set('Content-Type', 'application/json').end(body)
    })
  })
  proxyReq.on('error', (e) => { console.error('[VOZ] Proxy error:', e.message); res.status(502).json({ error: e.message }) })
  req.pipe(proxyReq)
})

// -- Event Actions --
app.get('/api/event-actions/config', eventActions.handleGetConfig)
app.post('/api/event-actions/config', express.json(), eventActions.handleSaveConfig)
app.post('/api/event-actions/reset-chatters', express.json(), eventActions.handleResetChatters)
app.post('/api/event-actions/toggle', express.json(), eventActions.handleToggle)
app.get('/api/event-actions/exceptions', eventActions.handleGetExceptions)
app.post('/api/event-actions/exceptions', express.json(), eventActions.handleAddException)
app.post('/api/event-actions/exceptions/remove', express.json(), eventActions.handleRemoveException)

// -- GACHA --
gacha.initWs(server)
app.use('/gacha', gacha.router)

// -- OBS-Actions --
app.use('/obs-actions', obsActions.router)
obsActions.init()

// -- Music --
app.use('/music', music.router)
music.init()

// -- Chatbot --
app.use('/chatbot', chatbot.router)
chatbot.init()

// -- Strinova App --
strinova.initWs(server)
app.use('/strinova', strinova.router)

// -- Fighting Chat --
app.use('/fighting', fighting.router)

// -- Shutdown --
app.post('/api/shutdown', (_req, res) => {
  res.json({ ok: true })
  tunnel.setTunnelIntentionalStop(true)
  const tp = tunnel.getTunnelProcess()
  if (tp) tp.kill()
  setTimeout(() => process.exit(0), 500)
})

// -- Heartbeat: verificar suscripciones cada 5 min y reparar --
async function heartbeat() {
  if (!state.tokens) return
  try {
    await auth.ensureValidToken()
    state.authFailCount = 0
    if (!state.tunnelUrl || !tunnel.getTunnelProcess()) {
      await tunnel.startTunnel()
      return
    }
    const subs = await events.listSubscriptions()
    if (!subs || subs.length < 10) {
      console.log('[HEARTBEAT] suscripciones perdidas, re-subscribiendo...')
      sse.broadcast({ type: 'subscription', event: 'all', status: 'error', message: 'Re-subscribiendo...' })
      await events.subscribeToEvents()
    } else {
      console.log('[HEARTBEAT] OK')
    }
  } catch (err) {
    console.log('[HEARTBEAT]', err.message)
  }
}

process.on('uncaughtException', err => console.error('[FATAL] uncaughtException:', err))
process.on('unhandledRejection', err => console.error('[FATAL] unhandledRejection:', err))

chatwidgetConfig.load()

// -- Arranque --
server.listen(config.PORT, async () => {
  console.log(`\n╔══════════════════════════════════════╗`)
  console.log(`║   Kick Backend                      ║`)
  console.log(`║   http://localhost:${config.PORT}              ║`)
  console.log(`╚══════════════════════════════════════╝\n`)
  if (!config.CLIENT_ID) console.warn('⚠  Configura KICK_CLIENT_ID y KICK_CLIENT_SECRET en .env o variables de entorno')

  // Iniciar forwarder si hay URLs configuradas
  if (config.FORWARD_URLS.length) {
    forwarder.init()
    console.log('[FWD] Reenviando eventos a:', config.FORWARD_URLS.join(', '))
  }

  // Cargar tokens ANTES de fetchPublicKey para evitar race condition con SSE
  if (auth.loadTokens()) auth.autoFlow().catch(() => {})
  if (auth.loadBotTokens()) auth.botAutoFlow().catch(() => {})
  await webhook.fetchPublicKey()

  // Iniciar módulo GACHA
  gacha.init().catch(e => console.error('[GACHA] Error init:', e.message))

  // Iniciar módulo Strinova
  strinova.init()

  // Iniciar módulo Music
  setTimeout(() => music.init().catch(e => console.error('[MUSIC] Error init:', e.message)), 5000)

  // Delay inicial antes de subscribir y de iniciar túnel, para que los servicios se estabilicen
  await new Promise(r => setTimeout(r, 3000))

  // Iniciar túnel Cloudflare con reintentos
  async function initTunnelWithRetry(attempts = 3, delay = 5000) {
    for (let i = 0; i < attempts; i++) {
      try {
        console.log(`[TUNNEL] Intentando iniciar túnel (intento ${i + 1}/${attempts})...`)
        await tunnel.startTunnel()
        if (state.tunnelUrl) {
          console.log('[TUNNEL] Túnel iniciado con éxito!')
          return
        }
      } catch (err) {
        console.error('[TUNNEL] Error al iniciar túnel:', err.message)
      }
      if (i < attempts - 1) await new Promise(r => setTimeout(r, delay))
    }
    console.error('[TUNNEL] Fallo al iniciar el túnel después de varios intentos.')
  }
  initTunnelWithRetry()

  setInterval(heartbeat, 300000)

  // Último módulo en iniciar: el fight server (proceso hijo en :3001)
  fighting.init()

  // -- Voice Chat (Python VOz server, auto-start) --
  ;(() => {
    const VOZ_ROOT = path.join(__dirname, 'modules/triggers', 'VOz')
    const VOZ_PORT = 8000
    let vozChild = null
    let vozAttempts = 0
    const VOZ_MAX = 3

    function spawnVoz() {
      if (vozChild || vozAttempts >= VOZ_MAX) return
      const req = http.get(`http://127.0.0.1:${VOZ_PORT}/`, { timeout: 2000 }, () => {
        console.log(`[VOZ] Ya corriendo en :${VOZ_PORT}`)
      })
      req.on('error', () => {
        const venvPy = path.join(VOZ_ROOT, 'venv', 'Scripts', 'python.exe')
        const py = fs.existsSync(venvPy) ? venvPy : 'python'
        vozAttempts++
        console.log(`[VOZ] Arrancando voice-chat en :${VOZ_PORT} (intento ${vozAttempts}/${VOZ_MAX})`)
        vozChild = spawn(py, ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', String(VOZ_PORT)], {
          cwd: VOZ_ROOT,
          detached: true,
          stdio: 'ignore',
        })
        vozChild.unref()
        vozChild.on('exit', (code) => {
          console.log(`[VOZ] Proceso Python terminó (code ${code})`)
          vozChild = null
          if (code !== 0 && code !== null && vozAttempts < VOZ_MAX) {
            setTimeout(spawnVoz, 5000)
          }
        })
      })
      req.on('timeout', () => { req.destroy(); console.log(`[VOZ] Ya corriendo en :${VOZ_PORT}`) })
    }

    process.on('exit', () => { if (vozChild) try { vozChild.kill() } catch {} })
    spawnVoz()

    // -- Hotkey global '+' detectado en Node.js via GetAsyncKeyState --
    try {
      const koffi = require('koffi')
      const user32 = koffi.load('user32.dll')
      const GetAsyncKeyState = user32.func('short GetAsyncKeyState(int vKey)')
      const VK_OEM_PLUS = 0xBB
      const VK_ADD = 0x6B
      let wasDown = false
      function pollHotkey() {
        const down = !!(GetAsyncKeyState(VK_OEM_PLUS) & 0x8000) || !!(GetAsyncKeyState(VK_ADD) & 0x8000)
        if (down && !wasDown) {
          wasDown = true
          sse.broadcast({ type: 'voice-recording', _source: 'voice-chat', direction: 'start' })
          const r = http.request(`http://127.0.0.1:${VOZ_PORT}/hotkey`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 2000 })
          r.on('error', () => {})
          r.end(JSON.stringify({ event: 'start' }))
          r.end(JSON.stringify({ event: 'start' }))
        } else if (!down && wasDown) {
          wasDown = false
          sse.broadcast({ type: 'voice-recording', _source: 'voice-chat', direction: 'stop' })
          const r = http.request(`http://127.0.0.1:${VOZ_PORT}/hotkey`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 2000 })
          r.on('error', () => {})
          r.end(JSON.stringify({ event: 'stop' }))
          r.end(JSON.stringify({ event: 'stop' }))
        }
        setTimeout(pollHotkey, 50)
      }
      pollHotkey()
      console.log('[VOZ] Hotkey global + activo (GetAsyncKeyState)')
    } catch (e) {
      console.warn('[VOZ] No se pudo activar hotkey global:', e.message)
    }
  })()

  console.log(`\n  Abrí http://localhost:${config.PORT} en tu navegador\n`)
})
