const crypto = require('crypto')
const fs = require('fs')
const config = require('../lib/config')
const eventBus = require('../lib/event-bus')
const state = require('../lib/state')
const sse = require('./sse')

// -- PKCE --
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url')
}
function generateCodeChallenge(v) {
  return crypto.createHash('sha256').update(v).digest('base64url')
}

// -- Token helpers --
function persistTokens(filePath, tokens) {
  if (!tokens) return
  fs.writeFileSync(filePath, JSON.stringify({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expires_at
  }))
}

function readTokens(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const t = JSON.parse(raw)
    if (!t?.access_token) return null
    return t
  } catch { return null }
}

async function refreshToken(tokens) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.CLIENT_ID,
    client_secret: config.CLIENT_SECRET,
    refresh_token: tokens.refresh_token
  })
  const resp = await fetch('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  let data = await resp.json()
  if (!resp.ok) {
    await new Promise(r => setTimeout(r, 2000))
    const resp2 = await fetch('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    data = await resp2.json()
    if (!resp2.ok) throw new Error('Error refresh token')
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in * 1000)
  }
}

// -- Main account token management --
function saveTokens() {
  persistTokens(config.TOKENS_PATH, state.tokens)
}

function loadTokens() {
  state.tokens = readTokens(config.TOKENS_PATH)
  if (state.tokens) console.log('[TOKENS] Cargados')
  return !!state.tokens
}

async function ensureValidToken() {
  if (!state.tokens) throw new Error('No autenticado')
  if (Date.now() < state.tokens.expires_at - 60000) return
  state.tokens = await refreshToken(state.tokens)
  saveTokens()
  eventBus.emit('auth:token-refreshed')
}

async function fetchChannelInfo() {
  await ensureValidToken()
  const resp = await fetch('https://api.kick.com/public/v1/channels', {
    headers: { Authorization: `Bearer ${state.tokens.access_token}` }
  })
  const data = await resp.json()
  if (data.data?.[0]) {
    state.broadcasterUserId = data.data[0].broadcaster_user_id
    state.channelSlug = data.data[0].slug
  }
}

// -- Bot account token management --
function saveBotTokens() {
  persistTokens(config.BOT_TOKENS_PATH, state.botTokens)
}

function loadBotTokens() {
  state.botTokens = readTokens(config.BOT_TOKENS_PATH)
  if (state.botTokens) console.log('[BOT TOKENS] Cargados')
  return !!state.botTokens
}

async function ensureValidBotToken() {
  if (!state.botTokens) throw new Error('Bot no autenticado')
  if (Date.now() < state.botTokens.expires_at - 60000) return
  state.botTokens = await refreshToken(state.botTokens)
  saveBotTokens()
  eventBus.emit('bot:token-refreshed')
}

let oauthSession = null

async function autoFlow() {
  if (!state.tokens) return
  try {
    await ensureValidToken()
    saveTokens()
    await fetchChannelInfo()
    state.authFailCount = 0
    console.log('[AUTO] OK — canal:', state.channelSlug || 'desconocido')
    eventBus.emit('auth:ready', { slug: state.channelSlug })
    sse.broadcast({ type: 'auth', status: 'connected', slug: state.channelSlug })
  } catch (err) {
    state.authFailCount++
    console.log('[AUTO]', err.message, `(intento ${state.authFailCount}/3)`)
    if (state.authFailCount >= 3) {
      state.tokens = null
      // ponytail: no borramos el archivo, así un reinicio del server recupera si Kick fue un outage temporal
      eventBus.emit('auth:disconnected')
      sse.broadcast({ type: 'auth', status: 'disconnected' })
    }
  }
}

async function botAutoFlow() {
  if (!state.botTokens) return
  try {
    await ensureValidBotToken()
    saveBotTokens()
    state.botAuthFailCount = 0
    console.log('[BOT AUTO] Bot autenticado')
    sse.broadcast({ type: 'bot-auth', status: 'connected' })
  } catch (err) {
    state.botAuthFailCount++
    console.log('[BOT AUTO]', err.message, `(intento ${state.botAuthFailCount}/3)`)
    if (state.botAuthFailCount >= 3) {
      state.botTokens = null
      // ponytail: mantener archivo, recuperable al reiniciar
    }
  }
}

// -- Route handlers --

function login(req, res) {
  if (!config.CLIENT_ID) return res.status(400).json({ error: 'KICK_CLIENT_ID no configurado' })
  const verifier = generateCodeVerifier()
  const challenge = generateCodeChallenge(verifier)
  oauthSession = { state: crypto.randomBytes(16).toString('hex'), verifier, type: 'main' }

  const q = new URLSearchParams({
    response_type: 'code',
    client_id: config.CLIENT_ID,
    redirect_uri: config.REDIRECT_URI,
    scope: 'events:subscribe chat:write channel:read channel:rewards:read user:read',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: oauthSession.state
  })
  res.redirect(`https://id.kick.com/oauth/authorize?${q}`)
}

function botLogin(req, res) {
  if (!config.CLIENT_ID) return res.status(400).json({ error: 'KICK_CLIENT_ID no configurado' })
  const verifier = generateCodeVerifier()
  const challenge = generateCodeChallenge(verifier)
  oauthSession = { state: crypto.randomBytes(16).toString('hex'), verifier, type: 'bot' }

  const q = new URLSearchParams({
    response_type: 'code',
    client_id: config.CLIENT_ID,
    redirect_uri: config.REDIRECT_URI,
    scope: 'events:subscribe chat:write channel:read channel:rewards:read user:read',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: oauthSession.state,
    prompt: 'login'
  })
  res.redirect(`https://id.kick.com/oauth/authorize?${q}`)
}

async function callback(req, res) {
  const { code, state: reqState, error } = req.query
  if (error) return res.send(`<script>window.opener.postMessage({type:'oauth-error',error:'${error}'},'*');window.close()</script>`)
  if (reqState !== oauthSession?.state) return res.status(401).send('State inválido')

  const isBot = oauthSession.type === 'bot'
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.CLIENT_ID,
      client_secret: config.CLIENT_SECRET,
      redirect_uri: config.REDIRECT_URI,
      code_verifier: oauthSession.verifier,
      code
    })
    const resp = await fetch('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    const data = await resp.json()
    if (!resp.ok) throw new Error(data.error || 'Error token')

    const tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in * 1000)
    }

    if (isBot) {
      state.botTokens = tokens
      saveBotTokens()
      botAutoFlow().catch(() => {})
    } else {
      state.tokens = tokens
      saveTokens()
      autoFlow().catch(() => {})
    }

    oauthSession = null
    const msgType = isBot ? 'bot-oauth-success' : 'oauth-success'
    res.send(`<script>window.opener.postMessage({type:'${msgType}'},'*');window.close()</script>`)
  } catch (err) {
    res.send(`<script>window.opener.postMessage({type:'oauth-error',error:'${err.message}'},'*');window.close()</script>`)
  }
}

module.exports = {
  login, botLogin, callback,
  ensureValidToken, ensureValidBotToken,
  fetchChannelInfo, loadTokens, loadBotTokens,
  autoFlow, botAutoFlow
}
