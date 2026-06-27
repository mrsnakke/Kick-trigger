const eventBus = require('../../../lib/event-bus')
const sse = require('../../sse')
const configManager = require('./config-manager')
const speakerbot = require('./speakerbot')

let botActive = true

function broadcast(data) { sse.broadcast({ ...data, _source: 'tts' }) }

function logMessage(msg, logType, user) {
  broadcast({ type: 'tts:log', logType, message: msg, user, ts: Date.now() })
}

function emitStatus() {
  broadcast({
    type: 'tts:status',
    botActive,
    speakerbotActive: speakerbot.getStatus()
  })
}

function triggerBonk(isBarrage, user) {
  const url = configManager.getConfig().KICKBONKS_URL || 'http://localhost:3030'
  const endpoint = isBarrage ? '/api/throw/barrage' : '/api/throw/single'
  const label = isBarrage ? 'ráfaga' : 'simple'
  fetch(`${url}${endpoint}`, { method: 'POST' })
    .then(() => logMessage(`Lanzamiento ${label} ejecutado por @${user}`, 'success'))
    .catch(err => logMessage(`Error al lanzar ${label}: ${err.message}`, 'error'))
}

function handleChatMessage(data) {
  if (!botActive) return
  const { payload } = data
  const user = payload.sender?.username
  const message = (payload.content || '').trim()
  if (!user || !message) return

  const config = configManager.getConfig()
  const cmd = message.toLowerCase()

  if (cmd === '!bonk') { triggerBonk(false, user); return }
  if (cmd === '!bonks') { triggerBonk(true, user); return }

  if (message.startsWith('!') && !cmd.startsWith(config.COMMAND.toLowerCase())) {
    const key = message.slice(1).trim().toLowerCase()
    const aliases = config.VOICE_ALIASES
    if (aliases && aliases[key]) {
      configManager.setUserAlias(user, aliases[key])
      logMessage(`Asignada voz "${aliases[key]}" a ${user}`, 'system')
    }
    return
  }

  if (!cmd.startsWith(config.COMMAND.toLowerCase())) return

  const text = message.slice(config.COMMAND.length).trim()
  if (!text.length) return

  let finalVoice = config.VOICE_NAME
  let textToSpeak = text
  const words = text.split(/\s+/)
  const firstWord = words[0].toLowerCase()
  const aliases = config.VOICE_ALIASES
  let usedTemporal = false

  if (aliases && aliases[firstWord]) {
    finalVoice = aliases[firstWord]
    textToSpeak = words.slice(1).join(' ').trim()
    usedTemporal = true
  }

  if (!usedTemporal) {
    const pa = configManager.getUserAlias(user)
    if (pa) finalVoice = pa.voice
  }

  if (!textToSpeak.length) return

  if (configManager.containsBannedWords(textToSpeak)) {
    logMessage(`Mensaje bloqueado de @${user} (palabras prohibidas)`, 'error')
    return
  }

  const maxLen = config.MAX_TEXT_LENGTH
  if (maxLen && textToSpeak.length > maxLen) {
    textToSpeak = textToSpeak.slice(0, maxLen) + '...'
  }

  logMessage(textToSpeak, 'chat_tts_kick', user)

  const clean = textToSpeak.replace(/\[emote:\d+:[^\]]+\]/g, '').trim()
  if (clean.length) {
    const ok = speakerbot.sendToSpeakerBot(clean, user, finalVoice)
    if (ok) logMessage(`Enviado a Speaker.bot con voz "${finalVoice}"`, 'success')
    else logMessage(`Speaker.bot desconectado`, 'error')
  }
}

eventBus.on('chat.message.sent', handleChatMessage)

eventBus.on('tts:config_updated', () => {
  speakerbot.initSpeakerbot()
})

eventBus.on('tts:user_aliases_updated', (aliases) => {
  broadcast({ type: 'tts:user_aliases', userAliases: aliases })
})

eventBus.on('tts:request_status', () => {
  emitStatus()
})

// -- HTTP Handlers --

function handleGetConfig(req, res) {
  res.json({ config: configManager.getConfig(), bannedWords: configManager.getBannedWords() })
}

function handleSaveConfig(req, res) {
  configManager.updateConfig(req.body.config, req.body.bannedWords)
  res.json({ ok: true })
}

function handleGetUserAliases(req, res) {
  res.json({ userAliases: configManager.getUserAliases() })
}

function handleDeleteUserAlias(req, res) {
  configManager.deleteUserAlias(req.body.username)
  res.json({ ok: true })
}

function handleToggleBot(req, res) {
  botActive = !!req.body.active
  logMessage(botActive ? 'Bot TTS iniciado' : 'Bot TTS detenido', 'system')
  emitStatus()
  res.json({ ok: true, botActive })
}

function handleGetStatus(req, res) {
  res.json({ botActive, speakerbotActive: speakerbot.getStatus() })
}

emitStatus()
logMessage('Módulo TTS cargado — auto-iniciado', 'system')

module.exports = {
  handleGetConfig, handleSaveConfig,
  handleGetUserAliases, handleDeleteUserAlias,
  handleToggleBot, handleGetStatus
}
