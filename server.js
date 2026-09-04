const express = require('express')
const http = require('http')
const path = require('path')
const os = require('os')
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
  console.log(`\n  Abrí http://localhost:${config.PORT} en tu navegador\n`)
})
