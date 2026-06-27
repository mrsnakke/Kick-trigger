const express = require('express')
const path = require('path')
const config = require('./lib/config')
const state = require('./lib/state')
const auth = require('./modules/auth')
const webhook = require('./modules/webhook')
const chat = require('./modules/chat')
const tunnel = require('./modules/tunnel')
const sse = require('./modules/sse')
const events = require('./modules/events')
const forwarder = require('./lib/forwarder')
const ttsTrigger = require('./modules/triggers/tts')

const app = express()

// -- Preservar raw body para validación webhook --
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf }
}))
app.use(express.static(path.join(__dirname, 'public')))

// -- Auth --
app.get('/auth/login', auth.login)
app.get('/auth/callback', auth.callback)

// -- Webhook --
app.all('/webhook/kick', webhook.handle)

// -- SSE --
app.get('/api/events', sse.handle)

// -- Chat --
app.post('/api/chat/send', express.json(), chat.send)

// -- Estado --
app.get('/api/status', (req, res) => {
  res.json({
    authenticated: !!state.tokens,
    clientId: !!config.CLIENT_ID,
    tunnelUrl: state.tunnelUrl,
    broadcasterUserId: state.broadcasterUserId,
    channelSlug: state.channelSlug,
    eventsCounter: state.eventsCounter,
    sseClients: state.sseClients.length
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
    state.authFailCount = 0
  } catch (err) {
    console.log('[HEARTBEAT]', err.message)
  }
}

// -- Arranque --
app.listen(config.PORT, async () => {
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

  await webhook.fetchPublicKey()
  if (auth.loadTokens()) auth.autoFlow().catch(() => {})
  setInterval(heartbeat, 300000)
  console.log(`\n  Abrí http://localhost:${config.PORT} en tu navegador\n`)
})
