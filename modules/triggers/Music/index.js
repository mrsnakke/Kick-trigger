const express = require('express')
const fs = require('fs')
const path = require('path')
const eventBus = require('../../../lib/event-bus')
const sse = require('../../sse')
const chat = require('../../chat')
const client = require('./client')

const CONFIG_PATH = path.join(__dirname, 'config.json')
const router = express.Router()
router.use(express.json())
router.use(express.static(path.join(__dirname, 'public')))

const DEFAULTS = {
  PORT: 26538,
  POLL_INTERVAL: 3000,
  AUTO_NOTIFY: true,
  commands: {
    song: { enabled: true, trigger: '!song' },
    addsong: { enabled: true, trigger: ['!addsong', '!sr'] },
    skip: { enabled: true, trigger: '!skip' },
    stop: { enabled: true, trigger: '!stop' },
    volume: { enabled: true, trigger: '!volume' },
    like: { enabled: true, trigger: '!like' }
  }
}

let cfg = { ...DEFAULTS, commands: { ...DEFAULTS.commands } }
let previousTitle = null
let pollTimer = null
let initialized = false

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    cfg = { ...DEFAULTS, ...parsed, commands: { ...DEFAULTS.commands, ...(parsed.commands || {}) } }
  } catch {
    cfg = { ...DEFAULTS, commands: { ...DEFAULTS.commands } }
    saveConfig()
  }
  client.setPort(cfg.PORT)
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
}

function broadcast(data) {
  sse.broadcast({ _source: 'music', ...data, ts: Date.now() })
}

function getStatus() {
  return {
    port: cfg.PORT,
    pollInterval: cfg.POLL_INTERVAL,
    autoNotify: cfg.AUTO_NOTIFY,
    commands: cfg.commands,
    playerConnected: false,
    currentSong: null
  }
}

async function sendToChat(text) {
  // Retry up to 3 times with delay for authentication errors
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await chat.sendAsBot(text)
      return // Success
    } catch (err) {
      if (err.message.includes('Bot no autenticado') && attempt < 2) {
        // Wait before retrying (100ms, 200ms, 400ms)
        await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)))
        continue
      }
      console.error('[MUSIC] chat error:', err.message)
      return // Give up on persistent errors or non-auth errors
    }
  }
}

async function notifySongChange(info) {
  const title = info.title || 'Desconocido'
  const artist = info.artist || 'Desconocido'
  const url = info.url || ''
  await sendToChat(`🎤 ${title} — ${artist}`)
  if (url) await sendToChat(`🔗 ${url}`)
}

async function pollSong() {
  try {
    const info = await client.getSongInfo()
    if (!info || info.isPaused) {
      previousTitle = info?.title || null
      broadcast({ type: 'status', playerConnected: true, currentSong: info || null })
      return
    }
    broadcast({ type: 'status', playerConnected: true, currentSong: info })
    const currentTitle = info.title
    if (currentTitle && currentTitle !== previousTitle) {
      previousTitle = currentTitle
      if (cfg.AUTO_NOTIFY) notifySongChange(info).catch(() => {})
    }
  } catch {
    broadcast({ type: 'status', playerConnected: false, currentSong: null })
  }
}

function startPolling() {
  stopPolling()
  pollSong()
  pollTimer = setInterval(pollSong, cfg.POLL_INTERVAL)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

// --- Chat commands ---

function getCommandConfig(name) { return cfg.commands[name] }

function matchCommand(msg, name) {
  const cc = getCommandConfig(name)
  if (!cc || !cc.enabled) return null
  const triggers = Array.isArray(cc.trigger) ? cc.trigger : [cc.trigger]
  for (const t of triggers) {
    if (msg.startsWith(t)) return msg.slice(t.length).trim()
  }
  return null
}

async function handleSong(data) {
  try {
    const info = await client.getSongInfo()
    if (!info) return sendToChat('No hay ninguna canción reproduciéndose.')
    const title = info.title || 'Desconocido'
    const artist = info.artist || 'Desconocido'
    const url = info.url || ''
    await sendToChat(`🎤 ${title} — ${artist}`)
    await sendToChat(`──🎸───🥁───🎹───🎙️──`)
    if (url) await sendToChat(`🔗 ${url}`)
  } catch (err) {
    sendToChat(`Error al obtener la canción: ${err.message}`)
  }
}

async function handleAddSong(data, args) {
  if (!args) return sendToChat(`Uso: ${Array.isArray(cfg.commands.addsong.trigger) ? cfg.commands.addsong.trigger[0] : cfg.commands.addsong.trigger} <nombre o URL de YouTube>`)
  try {
    let videoId = client.videoIdFromUrl(args)
    if (!videoId) {
      const searchRes = await client.search(args)
      videoId = client.extractVideoIdFromSearch(searchRes)
      if (!videoId) return sendToChat(`No se encontró "${args}". Intenta con otro nombre.`)
    }
    await client.addToQueue(videoId)
    const user = data.payload?.sender?.username || 'Alguien'
    sendToChat(`¡Canción añadida a la cola! Gracias, @${user}.`)
  } catch (err) {
    sendToChat(`Error al añadir canción: ${err.message}`)
  }
}

async function handleSkip() {
  try { await client.next(); sendToChat('⏭ Saltando a la siguiente canción...') }
  catch (err) { sendToChat(`Error al saltar: ${err.message}`) }
}

async function handleStop() {
  try { await client.togglePlay(); sendToChat('⏯ Reproducción pausada/reanudada.') }
  catch (err) { sendToChat(`Error: ${err.message}`) }
}

async function handleVolume(value) {
  if (!value || isNaN(value)) return sendToChat(`Uso: ${cfg.commands.volume.trigger} <0-100>`)
  const v = parseInt(value, 10)
  if (v < 0 || v > 100) return sendToChat('El volumen debe ser entre 0 y 100.')
  try { await client.setVolume(v); sendToChat(`🔊 Volumen ajustado a ${v}%.`) }
  catch (err) { sendToChat(`Error al ajustar volumen: ${err.message}`) }
}

async function handleLike() {
  try { await client.like(); sendToChat('❤ Like agregado a la canción.') }
  catch (err) { sendToChat(`Error: ${err.message}`) }
}

function onChatMessage(data) {
  try {
    const content = (data.payload?.content || '').trim()
    if (!content.startsWith('!')) return
    const cmd = content.split(/\s+/)[0].toLowerCase()

    const match = (name) => {
      const cc = getCommandConfig(name)
      if (!cc || !cc.enabled) return null
      const triggers = Array.isArray(cc.trigger) ? cc.trigger : [cc.trigger]
      for (const t of triggers) {
        if (cmd === t.toLowerCase()) return content.slice(t.length).trim()
      }
      return null
    }

    const run = (fn) => fn().catch(err => console.error('[MUSIC] command error:', err))

    if (match('song') !== null) run(() => handleSong(data))
    if (match('skip') !== null) run(() => handleSkip())
    if (match('stop') !== null) run(() => handleStop())
    const addArg = match('addsong'); if (addArg !== null) run(() => handleAddSong(data, addArg))
    const volArg = match('volume'); if (volArg !== null) run(() => handleVolume(volArg))
    if (match('like') !== null) run(() => handleLike())
  } catch (err) {
    console.error('[MUSIC] onChatMessage error:', err)
  }
}

// --- API routes ---

router.get('/api/music/status', (_req, res) => {
  const status = getStatus()
  try {
    client.getSongInfo().then(info => {
      status.playerConnected = true
      status.currentSong = info
    }).catch(() => {})
  } catch {}
  res.json(status)
})

router.post('/api/music/config', (req, res) => {
  const { port, commands, autoNotify, pollInterval } = req.body
  if (port !== undefined) { cfg.PORT = port; client.setPort(port) }
  if (autoNotify !== undefined) cfg.AUTO_NOTIFY = autoNotify
  if (pollInterval !== undefined) cfg.POLL_INTERVAL = pollInterval
  if (commands) {
    for (const [key, val] of Object.entries(commands)) {
      if (cfg.commands[key]) cfg.commands[key] = { ...cfg.commands[key], ...val }
    }
  }
  saveConfig()
  if (pollInterval !== undefined || port !== undefined) startPolling()
  res.json({ ok: true, config: getStatus() })
})

router.get('/api/music/config', (_req, res) => {
  res.json(getStatus())
})

// --- Init ---

async function init() {
  if (initialized) return
  initialized = true
  loadConfig()
  eventBus.on('chat.message.sent', onChatMessage)
  startPolling()
  broadcast({ type: 'status', ...getStatus() })
  console.log('[MUSIC] Module loaded')
}

process.on('exit', stopPolling)

module.exports = { init, router }
