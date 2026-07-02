const eventBus = require('../../../lib/event-bus')
const sse = require('../../sse')
const chat = require('../../chat')
const { exec } = require('child_process')
const path = require('path')
const fs = require('fs')

// ─── Config ────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'config.json')
const DATA_PATH = path.join(__dirname, 'tts-data.json')

const VOICE_NAMES = { "1": "Sabina", "3": "Raul", "21": "Alvaro", "22": "Elvira", "23": "Ximena", "24": "Dalia", "25": "Jorge" }
const VOICE_BY_NAME = Object.fromEntries(Object.entries(VOICE_NAMES).map(([k, v]) => [v.toLowerCase(), k]))

let tts2Config
function loadTTS2Config() {
  tts2Config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
}
loadTTS2Config()

let data = {
  config: { COMMAND: '!sp', MAX_TEXT_LENGTH: 600, KICKBONKS_URL: 'http://192.168.50.246:3030' },
  bannedWords: ['cara de gato', 'Caradegato', 'puto', 'puta', 'maricon', 'pendejo'],
  userAliases: {}
}

// Migrate old tts-data.json if exists
const OLD_DATA_PATH = path.join(__dirname, '..', 'tts', 'tts-data.json')
function load() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      data = { ...data, ...JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8')) }
    } else if (fs.existsSync(OLD_DATA_PATH)) {
      const old = JSON.parse(fs.readFileSync(OLD_DATA_PATH, 'utf-8'))
      data.config = { COMMAND: old.config?.COMMAND || '!sp', MAX_TEXT_LENGTH: old.config?.MAX_TEXT_LENGTH || 600, KICKBONKS_URL: old.config?.KICKBONKS_URL || 'http://192.168.50.246:3030' }
      data.bannedWords = old.bannedWords || data.bannedWords
      if (old.userAliases) {
        const nameToAlias = Object.fromEntries(Object.entries(VOICE_NAMES).map(([k, v]) => [v.toLowerCase(), k]))
        data.userAliases = {}
        for (const [k, v] of Object.entries(old.userAliases)) {
          const alias = nameToAlias[v.voice?.toLowerCase()]
          data.userAliases[k] = { username: v.username, voice: alias || '1', updatedAt: v.updatedAt }
        }
      }
      save()
    }
  } catch (e) { console.error('[TTS2] Error loading data:', e.message) }
}
function save() {
  try { fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8') }
  catch (e) { console.error('[TTS2] Error writing data:', e.message) }
}
load()

// ─── PowerShell SAPI ──────────────────────────────────────
function runPS(script, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    exec(`powershell -NoProfile -EncodedCommand "${encoded}"`, { encoding: 'utf8', timeout }, (err, stdout) => {
      if (err) return reject(err)
      resolve(stdout ? stdout.trim().split('\r\n').filter(Boolean) : [])
    })
  })
}

function speakPS(voiceIndex, outputIndex, text) {
  const script = `$v = New-Object -ComObject SAPI.SpVoice
$v.Voice = $v.GetVoices().Item(${voiceIndex})
$v.AudioOutput = $v.GetAudioOutputs().Item(${outputIndex})
$v.Speak('${text.replace(/'/g, "''")}')`
  return runPS(script, { timeout: 120000 })
}

// ─── Queue ─────────────────────────────────────────────────
let queue = []
let processing = false
let msgIdCounter = 0
let currentId = null
let sseClients = []

function qState(q, sid) {
  return q.map(i => ({ id: i.id, text: i.text, origin: i.origin || null, voiceAlias: i.voiceAlias, status: i.id === sid ? 'speaking' : 'waiting' }))
}

function broadcastQueue() {
  const data = { queue: qState(queue, currentId) }
  const msg = `event: queue-update\ndata: ${JSON.stringify(data)}\n\n`
  sseClients = sseClients.filter(c => { try { c.write(msg); return true } catch { return false } })
  sse.broadcast({ _source: 'tts', type: 'tts:queue', ...data })
}

function resolve(key, map) {
  if (map && map[key] !== undefined) return map[key]
  const n = parseInt(key)
  if (!isNaN(n)) return n
  return 0
}

function resolveOutput(item) {
  if (!item.explicitOutput && item.origin && tts2Config.originOutputs) {
    const alias = tts2Config.originOutputs[item.origin]
    if (alias !== undefined) return resolve(String(alias), tts2Config.outputAliases)
  }
  return item.outputIndex
}

function enqueue(text, voiceIndex, outputIndex, origin, explicitOutput, voiceAlias) {
  const id = ++msgIdCounter
  queue.push({ id, text, voiceIndex, outputIndex, origin, explicitOutput, voiceAlias })
  broadcastQueue()
  processQueue()
  return id
}

async function processQueue() {
  if (processing || queue.length === 0) return
  processing = true
  const item = queue.shift()
  currentId = item.id
  broadcastQueue()
  eventBus.emit('tts2:speak:start', { origin: item.origin, voiceAlias: item.voiceAlias, text: item.text })
  try {
    await speakPS(item.voiceIndex, resolveOutput(item), item.text)
  } catch (e) {
    console.error('[TTS2] Error speaking:', e.message)
  }
  eventBus.emit('tts2:speak:end', { origin: item.origin, voiceAlias: item.voiceAlias })
  currentId = null
  broadcastQueue()
  processing = false
  processQueue()
}

// ─── Chat handler ──────────────────────────────────────────
let botActive = true

function triggerBonk(isBarrage, user) {
  const url = data.config.KICKBONKS_URL
  const endpoint = isBarrage ? '/api/throw/barrage' : '/api/throw/single'
  const label = isBarrage ? 'ráfaga' : 'simple'
  fetch(`${url}${endpoint}`, { method: 'POST' })
    .then(() => sse.broadcast({ _source: 'tts', type: 'tts:log', logType: 'success', message: `Bonk ${label} de @${user}`, ts: Date.now() }))
    .catch(err => sse.broadcast({ _source: 'tts', type: 'tts:log', logType: 'error', message: `Bonk error: ${err.message}`, ts: Date.now() }))
}

function containsBannedWords(text) {
  const lower = text.toLowerCase()
  return data.bannedWords.some(w => { const c = w.trim().toLowerCase(); return c && lower.includes(c) })
}

function getUserAlias(username) {
  if (!username) return null
  return data.userAliases[username.toLowerCase()] || null
}

function setUserAlias(username, voiceAlias) {
  if (!username || !voiceAlias) return false
  const key = username.toLowerCase()
  data.userAliases[key] = { username, voice: voiceAlias, updatedAt: new Date().toISOString() }
  save()
  eventBus.emit('tts:user_aliases_updated', data.userAliases)
  return true
}

function deleteUserAlias(username) {
  if (!username) return false
  const key = username.toLowerCase()
  if (data.userAliases[key]) {
    delete data.userAliases[key]
    save()
    eventBus.emit('tts:user_aliases_updated', data.userAliases)
    return true
  }
  return false
}

function handleChatMessage(evt) {
  if (!botActive) return
  const { payload } = evt
  const user = payload.sender?.username
  const message = (payload.content || '').trim()
  if (!user || !message) return

  const cmd = message.toLowerCase()
  const COMMAND = data.config.COMMAND || '!sp'

  if (cmd === '!bonk') { triggerBonk(false, user); return }
  if (cmd === '!bonks') { triggerBonk(true, user); return }

  if (cmd === '!voz') {
    const list = Object.entries(VOICE_NAMES).filter(([k]) => k !== '24').map(([,v]) => v).join(', ')
    chat.sendAsBot(`✨ Voces disponibles: ${list}`).catch(() => {})
    return
  }

  if (message.startsWith('!') && !cmd.startsWith(COMMAND)) {
    const key = message.slice(1).trim().toLowerCase()
    const alias = VOICE_BY_NAME[key]
    // ponytail: Dalia (24) is reserved for AI bot only
    if (alias && alias !== '24') {
      setUserAlias(user, alias)
      sse.broadcast({ _source: 'tts', type: 'tts:log', logType: 'system', message: `@${user} asignó voz "${VOICE_NAMES[alias]}"`, ts: Date.now() })
    }
    return
  }

  if (!cmd.startsWith(COMMAND)) return

  const text = message.slice(COMMAND.length).trim()
  if (!text.length) return

  let finalAlias = null
  let textToSpeak = text
  const words = text.split(/\s+/)
  const firstWord = words[0].toLowerCase()

  if (tts2Config.voiceAliases[firstWord] !== undefined) {
    finalAlias = firstWord
    textToSpeak = words.slice(1).join(' ').trim()
  }

  if (!finalAlias) {
    const pa = getUserAlias(user)
    if (pa) finalAlias = pa.voice
  }

  if (!finalAlias) finalAlias = '1'

  if (!textToSpeak.length) return

  if (containsBannedWords(textToSpeak)) {
    sse.broadcast({ _source: 'tts', type: 'tts:log', logType: 'error', message: `@${user} mensaje bloqueado (palabras prohibidas)`, ts: Date.now() })
    return
  }

  const maxLen = data.config.MAX_TEXT_LENGTH
  if (maxLen && textToSpeak.length > maxLen) {
    textToSpeak = textToSpeak.slice(0, maxLen) + '...'
  }

  const clean = textToSpeak.replace(/\[emote:\d+:[^\]]+\]/g, '').trim()
  if (clean.length) {
    const vi = resolve(finalAlias, tts2Config.voiceAliases)
    sse.broadcast({ _source: 'tts', type: 'tts:log', logType: 'chat_tts', message: `@${user}: ${clean}`, ts: Date.now() })
    enqueue(clean, vi, 0, 'chat', false, finalAlias)
  }
}

// ─── Listen for tts2:speak events (from vtuber-ai, etc.) ──
eventBus.on('tts2:speak', ({ text, voice, origin }) => {
  if (!botActive || !text) return
  const vi = resolve(voice || '1', tts2Config.voiceAliases)
  const oi = resolve(origin === 'bot' ? String(tts2Config.originOutputs?.bot || '0') : '0', tts2Config.outputAliases)
  enqueue(text, vi, oi, origin || 'bot', false, voice || '1')
})

eventBus.on('chat.message.sent', handleChatMessage)

eventBus.on('tts:request_status', () => {
  sse.broadcast({ _source: 'tts', type: 'tts:status', botActive, voices: Object.keys(tts2Config.voiceAliases).length })
})

eventBus.on('tts:user_aliases_updated', (aliases) => {
  sse.broadcast({ _source: 'tts', type: 'tts:user_aliases', userAliases: aliases })
})

eventBus.on('tts:config_updated', () => {
  // Config reloaded, nothing to re-init
})

// ─── HTTP handlers ─────────────────────────────────────────
async function handleGetVoices(req, res) {
  try {
    const voices = await runPS(`$v = New-Object -ComObject SAPI.SpVoice; if ($v.GetVoices().Count -gt 0) { 0..($v.GetVoices().Count-1) | % { '{0}||{1}' -f $_, $v.GetVoices().Item($_).GetDescription() } }`)
    const list = voices.map(v => { const [idx, ...name] = v.split('||'); return { index: parseInt(idx), name: name.join('||') } })
    res.json(list)
  } catch (e) { res.status(500).json({ error: e.message }) }
}

async function handleGetOutputs(req, res) {
  try {
    const outputs = await runPS(`$v = New-Object -ComObject SAPI.SpVoice; if ($v.GetAudioOutputs().Count -gt 0) { 0..($v.GetAudioOutputs().Count-1) | % { '{0}||{1}' -f $_, $v.GetAudioOutputs().Item($_).GetDescription() } }`)
    const list = outputs.map(o => { const [idx, ...name] = o.split('||'); return { index: parseInt(idx), name: name.join('||') } })
    res.json(list)
  } catch (e) { res.status(500).json({ error: e.message }) }
}

function handleGetConfig(req, res) {
  res.json({
    config: {
      COMMAND: data.config.COMMAND,
      MAX_TEXT_LENGTH: data.config.MAX_TEXT_LENGTH,
      KICKBONKS_URL: data.config.KICKBONKS_URL,
      voiceAliases: tts2Config.voiceAliases,
      outputAliases: tts2Config.outputAliases,
      originOutputs: tts2Config.originOutputs,
      VOICE_NAMES
    },
    bannedWords: data.bannedWords
  })
}

function handleSaveConfig(req, res) {
  if (req.body.config) {
    if (req.body.config.COMMAND) data.config.COMMAND = req.body.config.COMMAND
    if (req.body.config.MAX_TEXT_LENGTH != null) data.config.MAX_TEXT_LENGTH = req.body.config.MAX_TEXT_LENGTH
    if (req.body.config.KICKBONKS_URL != null) data.config.KICKBONKS_URL = req.body.config.KICKBONKS_URL
    if (req.body.config.originOutputs) {
      tts2Config.originOutputs = req.body.config.originOutputs
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(tts2Config, null, 2), 'utf-8')
    }
    if (req.body.config.outputAliases) {
      tts2Config.outputAliases = req.body.config.outputAliases
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(tts2Config, null, 2), 'utf-8')
    }
  }
  if (req.body.bannedWords && Array.isArray(req.body.bannedWords)) {
    data.bannedWords = req.body.bannedWords
  }
  save()
  eventBus.emit('tts:config_updated', { config: data.config, bannedWords: data.bannedWords })
  res.json({ ok: true })
}

function handleGetUserAliases(req, res) {
  res.json({ userAliases: data.userAliases })
}

function handleDeleteUserAlias(req, res) {
  deleteUserAlias(req.body.username)
  res.json({ ok: true })
}

function handleToggleBot(req, res) {
  botActive = !!req.body.active
  sse.broadcast({ _source: 'tts', type: 'tts:log', logType: 'system', message: botActive ? 'TTS activado' : 'TTS desactivado', ts: Date.now() })
  sse.broadcast({ _source: 'tts', type: 'tts:status', botActive, voices: Object.keys(tts2Config.voiceAliases).length })
  res.json({ ok: true, botActive })
}

function handleGetStatus(req, res) {
  res.json({ botActive, queueSize: queue.length, speaking: currentId !== null })
}

async function handleSpeakNow(req, res) {
  const { text, voice, output } = req.body
  if (!text) return res.status(400).json({ error: 'text required' })
  const vi = resolve(voice ?? '1', tts2Config.voiceAliases)
  const oi = resolve(output ?? '0', tts2Config.outputAliases)
  speakPS(vi, oi, text).catch(e => console.error('[TTS2] speak-now error:', e.message))
  res.json({ ok: true })
}

async function handleSpeakQueue(req, res) {
  const { text, voice, output, origin } = req.body
  if (!text) return res.status(400).json({ error: 'text required' })
  const vi = resolve(voice ?? '1', tts2Config.voiceAliases)
  const hasOutput = output !== undefined
  const oi = hasOutput ? resolve(output, tts2Config.outputAliases) : 0
  const id = enqueue(text, vi, oi, origin || 'chat', hasOutput, voice || '1')
  res.json({ id })
}

function handleGetQueue(req, res) {
  res.json({ queue: qState(queue, currentId), currentId })
}

function handleClearQueue(req, res) {
  queue = []
  broadcastQueue()
  res.json({ ok: true })
}

function handleGetSpeakerStatus(req, res) {
  // ponytail: legacy endpoint for frontend that expects speakerbot status
  res.json({ botActive, speakerbotActive: false })
}

// ─── SSE for TTS2 queue ────────────────────────────────────
function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })
  sseClients.push(res)
  req.on('close', () => { sseClients = sseClients.filter(c => c !== res) })
}

// ─── Init ──────────────────────────────────────────────────
function init() {
  console.log('[TTS2] Módulo TTS2 cargado ✅')
  sse.broadcast({ _source: 'tts', type: 'tts:status', botActive, voices: Object.keys(tts2Config.voiceAliases).length })
}

sse.broadcast({ _source: 'tts', type: 'tts:log', logType: 'system', message: 'Módulo TTS2 cargado', ts: Date.now() })

module.exports = {
  init,
  handleGetConfig, handleSaveConfig,
  handleGetUserAliases, handleDeleteUserAlias,
  handleToggleBot, handleGetStatus,
  handleGetVoices, handleGetOutputs,
  handleSpeakNow, handleSpeakQueue,
  handleGetQueue, handleClearQueue,
  handleGetSpeakerStatus,
  handleSSE,
  enqueue, resolve
}
