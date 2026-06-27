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

// -- Persistencia de tokens --
function saveTokens() {
  if (!state.tokens) return
  fs.writeFileSync(config.TOKENS_PATH, JSON.stringify({
    access_token: state.tokens.access_token,
    refresh_token: state.tokens.refresh_token,
    expires_at: state.tokens.expires_at
  }))
}

function loadTokens() {
  try {
    const raw = fs.readFileSync(config.TOKENS_PATH, 'utf8')
    state.tokens = JSON.parse(raw)
    if (!state.tokens?.access_token) { state.tokens = null; return false }
    console.log('[TOKENS] Cargados')
    return true
  } catch { return false }
}

async function ensureValidToken() {
  if (!state.tokens) throw new Error('No autenticado')
  if (Date.now() < state.tokens.expires_at - 60000) return
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.CLIENT_ID,
    client_secret: config.CLIENT_SECRET,
    refresh_token: state.tokens.refresh_token
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
  state.tokens.access_token = data.access_token
  state.tokens.refresh_token = data.refresh_token
  state.tokens.expires_at = Date.now() + (data.expires_in * 1000)
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

let oauthSession = null

async function autoFlow() {
  if (!state.tokens) return
  try {
    await ensureValidToken()
    saveTokens()
    await fetchChannelInfo()
    eventBus.emit('auth:ready', { slug: state.channelSlug })
    sse.broadcast({ type: 'auth', status: 'connected', slug: state.channelSlug })

    const tunnel = require('./tunnel')
    const tunnelResp = await tunnel.startTunnel()
    if (tunnelResp?.url) {
      setTimeout(() => {
        const events = require('./events')
        events.subscribeToEvents()
      }, 3000)
    }
  } catch (err) {
    state.authFailCount++
    console.log('[AUTO]', err.message, `(intento ${state.authFailCount}/3)`)
    if (state.authFailCount >= 3) {
      state.tokens = null
      try { fs.unlinkSync(config.TOKENS_PATH) } catch {}
      eventBus.emit('auth:disconnected')
      sse.broadcast({ type: 'auth', status: 'disconnected' })
    }
  }
}

// -- Route handlers --

function login(req, res) {
  if (!config.CLIENT_ID) return res.status(400).json({ error: 'KICK_CLIENT_ID no configurado' })
  const verifier = generateCodeVerifier()
  const challenge = generateCodeChallenge(verifier)
  oauthSession = { state: crypto.randomBytes(16).toString('hex'), verifier }

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

async function callback(req, res) {
  const { code, state: reqState, error } = req.query
  if (error) return res.send(`<script>window.opener.postMessage({type:'oauth-error',error:'${error}'},'*');window.close()</script>`)
  if (reqState !== oauthSession?.state) return res.status(401).send('State inválido')

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

    state.tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in * 1000)
    }
    oauthSession = null
    saveTokens()
    autoFlow().catch(() => {})
    res.send(`<script>window.opener.postMessage({type:'oauth-success'},'*');window.close()</script>`)
  } catch (err) {
    res.send(`<script>window.opener.postMessage({type:'oauth-error',error:'${err.message}'},'*');window.close()</script>`)
  }
}

module.exports = { login, callback, ensureValidToken, fetchChannelInfo, loadTokens, autoFlow }
