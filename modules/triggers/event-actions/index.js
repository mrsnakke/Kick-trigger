const fs = require('fs')
const path = require('path')
const eventBus = require('../../../lib/event-bus')
const sse = require('../../sse')
const chat = require('../../chat')
const vtuber = require('../vtuber-ai')

const CHATTERS_PATH = path.join(__dirname, 'chatters.json')
const CONFIG_PATH = path.join(__dirname, 'event-actions-config.json')

const KNOWN_BOTS = ['botrix', 'grimvtbot', 'mersnakevt']

const PROMO_KEYWORDS = [
  /https?:\/\//i, /www\./i,
  /\b(compr[aeo]|vendo?|venta|descuento|oferta|promocion)\b/i,
  /\b(gana\s+dinero|dinero\s+facil|registrate|visita\s+mi)\b/i,
  /\b(sigue\s+mi|mira\s+mi|checa\s+mi)\b/i
]

const DEFAULT_MINIPROMPTS = {
  'channel.chatter.first': 'chat.message.sent. PRIMER MENSAJE DEL DÍA DE @{username}: {content}. Es su primer mensaje hoy. Haz un saludo corto y dale la bienvenida al chat. Máximo dos oraciones.',
  'channel.followed': 'chat.message.sent. [EVENTO: Nuevo seguidor] @{username} acaba de seguir el canal en Kick. Dale una bienvenida cálida y agradécele el follow.',
  'channel.subscription.new': 'chat.message.sent. [EVENTO: Nueva suscripción] @{username} acaba de suscribirse al canal por primera vez. Es una suscripción nueva. Muéstrate emocionada y agradécele muchísimo su apoyo.',
  'channel.subscription.renewal': 'chat.message.sent. [EVENTO: Renovación de suscripción] @{username} ha renovado su suscripción mensual. Agradécele por seguir apoyando el canal otro mes más.',
  'channel.subscription.gifts': 'chat.message.sent. [EVENTO: Suscripciones regaladas] @{username} ha regalado suscripciones a la comunidad. Reconoce su generosidad y da las gracias a todos los nuevos suscriptores.',
  'channel.reward.redemption.updated': 'chat.message.sent. [EVENTO: Canje de recompensa] @{username} ha canjeado "{reward_title}" con puntos de canal. Reacciona con emoción al canje y pregúntale qué tal le parece la recompensa.',
  'livestream.metadata.updated': 'chat.message.sent. [EVENTO: Stream actualizado] Se cambió el título o categoría del stream. Nuevo título: "{title}". Reacciona al cambio brevemente.',
  'kicks.gifted': 'chat.message.sent. [EVENTO: KICKS regalados] @{username} ha regalado KICKS en el canal. Es la moneda de la plataforma Kick. Agradécele su generosidad con entusiasmo.'
}

let chatters = new Set()
let exceptions = new Set()
let miniprompts = {}
let enabled = {}

function loadChatters() {
  try {
    const raw = fs.readFileSync(CHATTERS_PATH, 'utf-8')
    const data = JSON.parse(raw)
    chatters = new Set((data.usernames || []).map(u => u.toLowerCase()))
    exceptions = new Set((data.exceptions || ['mrsnakevt', 'kickbot']).map(u => u.toLowerCase()))
  } catch {
    chatters = new Set()
    exceptions = new Set(['mrsnakevt', 'kickbot'])
    saveChatters()
  }
}

function saveChatters() {
  fs.writeFileSync(CHATTERS_PATH, JSON.stringify({ usernames: [...chatters], exceptions: [...exceptions] }, null, 2), 'utf-8')
}

function resetChatters() {
  chatters = new Set([...exceptions])
  saveChatters()
  console.log('[EVENT-ACTIONS] Chatters reseteados ✅')
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.miniprompts === 'object') {
      miniprompts = parsed.miniprompts
      enabled = parsed.enabled || {}
    } else {
      miniprompts = parsed
      enabled = {}
    }
  } catch {
    miniprompts = { ...DEFAULT_MINIPROMPTS }
    enabled = {}
    saveConfig()
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ miniprompts, enabled }, null, 2), 'utf-8')
}

function isKnownBot(username) {
  return KNOWN_BOTS.includes(username.toLowerCase())
}

function isPromotion(content) {
  return PROMO_KEYWORDS.some(r => r.test(content))
}

function emitStatus() {
  sse.broadcast({
    _source: 'event-actions',
    type: 'event-actions:status',
    chattersCount: chatters.size,
    exceptions: [...exceptions]
  })
}

function extractUsername(payload) {
  return (
    payload?.sender?.username ||
    payload?.user?.username ||
    payload?.redeemer?.username ||
    'unknown'
  )
}

async function onChatMessage(data) {
  const { payload } = data
  const username = (extractUsername(payload)).toLowerCase()
  const content = (payload.content || '').trim()

  if (!username || username === 'unknown') return
  if (isKnownBot(username)) return

  if (chatters.has(username)) return

  chatters.add(username)
  saveChatters()
  emitStatus()

  if (content.startsWith('!grim')) return

  if (isPromotion(content)) {
    const alertMsg = `@MrsnakeVT ponte a chambear hay un bot haciendo promoción en chat: @${username}: "${content.slice(0, 200)}"`
    await chat.sendAsBot(alertMsg).catch(() => {})
    return
  }

  if (enabled['channel.chatter.first'] === false) return

  let prompt = miniprompts['channel.chatter.first']
  if (!prompt) prompt = DEFAULT_MINIPROMPTS['channel.chatter.first']
  prompt = prompt.replace(/\{username\}/g, username).replace(/\{content\}/g, content)

  await vtuber.processMessage(username, prompt).catch(err => {
    console.error('[EVENT-ACTIONS] Error calling vtuber.processMessage:', err.message)
  })
}

function createEventHandler(eventType) {
  return async (data) => {
    if (enabled[eventType] === false) return
    const { payload } = data
    let username = ''
    let extra = {}

    if (eventType === 'channel.reward.redemption.updated') {
      username = payload?.redeemer?.username || 'unknown'
      extra.reward_title = payload?.reward?.title || 'Recompensa'
    } else if (eventType === 'livestream.metadata.updated') {
      username = extractUsername(payload)
      extra.title = payload?.title || 'Stream'
    } else if (eventType === 'channel.subscription.gifts') {
      username = payload?.sender?.username || payload?.user?.username || 'unknown'
    } else if (eventType === 'channel.followed') {
      username = payload?.user?.username || 'unknown'
    } else if (eventType === 'kicks.gifted') {
      username = payload?.sender?.username || payload?.user?.username || 'unknown'
    } else {
      username = extractUsername(payload) || 'unknown'
    }

    if (!username || username === 'unknown') return

    let prompt = miniprompts[eventType]
    if (!prompt) prompt = DEFAULT_MINIPROMPTS[eventType] || `chat.message.sent. [EVENTO: ${eventType}] @${username}`

    prompt = prompt
      .replace(/\{username\}/g, username)
      .replace(/\{reward_title\}/g, extra.reward_title || '')
      .replace(/\{title\}/g, extra.title || '')

    await vtuber.processMessage(username, prompt).catch(err => {
      console.error(`[EVENT-ACTIONS] Error calling vtuber.processMessage for ${eventType}:`, err.message)
    })
  }
}

function init() {
  loadChatters()
  loadConfig()

  eventBus.on('chat.message.sent', onChatMessage)
  eventBus.on('channel.followed', createEventHandler('channel.followed'))
  eventBus.on('channel.subscription.new', createEventHandler('channel.subscription.new'))
  eventBus.on('channel.subscription.renewal', createEventHandler('channel.subscription.renewal'))
  eventBus.on('channel.subscription.gifts', createEventHandler('channel.subscription.gifts'))
  eventBus.on('channel.reward.redemption.updated', createEventHandler('channel.reward.redemption.updated'))
  eventBus.on('livestream.metadata.updated', createEventHandler('livestream.metadata.updated'))
  eventBus.on('kicks.gifted', createEventHandler('kicks.gifted'))

  emitStatus()
  console.log('[EVENT-ACTIONS] Módulo cargado ✅')
}

function handleGetConfig(req, res) {
  res.json({
    chattersCount: chatters.size,
    chatters: [...chatters],
    exceptions: [...exceptions],
    miniprompts: miniprompts,
    enabled: enabled,
    defaults: DEFAULT_MINIPROMPTS
  })
}

function handleSaveConfig(req, res) {
  const { miniprompts: newMiniprompts, enabled: newEnabled } = req.body
  if (newMiniprompts && typeof newMiniprompts === 'object') {
    for (const [key, val] of Object.entries(newMiniprompts)) {
      if (typeof val === 'string' && val.trim()) {
        miniprompts[key] = val.trim()
      }
    }
  }
  if (newEnabled && typeof newEnabled === 'object') {
    for (const [key, val] of Object.entries(newEnabled)) {
      enabled[key] = val === true
    }
  }
  saveConfig()
  console.log('[EVENT-ACTIONS] Config guardada ✅')
  res.json({ ok: true, message: 'Config guardada' })
}

function handleResetChatters(req, res) {
  resetChatters()
  emitStatus()
  sse.broadcast({
    _source: 'event-actions',
    type: 'event-actions:reset',
    chattersCount: chatters.size,
    exceptions: [...exceptions]
  })
  res.json({ ok: true, message: 'Chatters reiniciados' })
}

function handleToggle(req, res) {
  const { event, eventEnabled } = req.body
  if (event && typeof eventEnabled === 'boolean') {
    enabled[event] = eventEnabled
    saveConfig()
    console.log(`[EVENT-ACTIONS] ${event} ${eventEnabled ? 'activado' : 'desactivado'} ✅`)
    res.json({ ok: true, message: `Evento ${eventEnabled ? 'activado' : 'desactivado'}` })
  } else {
    res.status(400).json({ ok: false, message: 'Formato inválido: se requiere { event: string, eventEnabled: boolean }' })
  }
}

function handleGetExceptions(req, res) {
  res.json({ chatters: [...chatters], exceptions: [...exceptions] })
}

function handleAddException(req, res) {
  const { username } = req.body
  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ ok: false, message: 'username requerido' })
  }
  exceptions.add(username.trim().toLowerCase())
  saveChatters()
  emitStatus()
  console.log(`[EVENT-ACTIONS] Excepción añadida: ${username.trim().toLowerCase()}`)
  res.json({ ok: true, exceptions: [...exceptions] })
}

function handleRemoveException(req, res) {
  const { username } = req.body
  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ ok: false, message: 'username requerido' })
  }
  exceptions.delete(username.trim().toLowerCase())
  saveChatters()
  emitStatus()
  console.log(`[EVENT-ACTIONS] Excepción removida: ${username.trim().toLowerCase()}`)
  res.json({ ok: true, exceptions: [...exceptions] })
}

init()

module.exports = { handleGetConfig, handleSaveConfig, handleResetChatters, handleToggle, handleGetExceptions, handleAddException, handleRemoveException }
