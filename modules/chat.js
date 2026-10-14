const config = require('../lib/config')
const eventBus = require('../lib/event-bus')
const state = require('../lib/state')
const sse = require('./sse')
const auth = require('./auth')

async function sendToKick(tokens, content, type, replyTo) {
  const body = { broadcaster_user_id: state.broadcasterUserId, content, type }
  if (replyTo) body.reply_to_message_id = replyTo
  const resp = await fetch('https://api.kick.com/public/v1/chat', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const data = await resp.json()
  if (data.data?.is_sent) {
    eventBus.emit('chat:sent', { content, message_id: data.data.message_id })
    sse.broadcast({ type: 'sent', content, message_id: data.data.message_id })
  } else if (!resp.ok) {
    console.error(`[CHAT] Kick API error ${resp.status}:`, JSON.stringify(data))
  }
  return data
}

async function send(req, res) {
  if (!state.tokens) return res.status(401).json({ error: 'No autenticado' })
  const { content, reply_to_message_id } = req.body
  if (!content || content.length > 500) return res.status(400).json({ error: 'Máx 500 caracteres' })

  await auth.ensureValidToken()
  if (!state.broadcasterUserId) await auth.fetchChannelInfo()
  try {
    const data = await sendToKick(state.tokens, content, 'user', reply_to_message_id)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// Responde en la plataforma donde se pidió. `origin()` lo saca del contexto del evento
// (ver lib/event-bus.js), así que los triggers no tienen que acordarse de nada.
// Kick = comportamiento de siempre, YouTube = el puente de Streamer.bot.
async function sendAsBot(content, replyTo) {
  if (eventBus.origin() === 'youtube') return sendToYouTube(content, replyTo)
  if (eventBus.origin() === 'twitch') return sendToTwitch(content)
  if (!state.botTokens) throw new Error('Bot no autenticado')
  if (!content || content.length > 500) throw new Error('Máx 500 caracteres')
  await auth.ensureValidBotToken()
  if (!state.broadcasterUserId) await auth.fetchChannelInfo()
  return sendToKick(state.botTokens, content, 'user', replyTo)
}

// YouTube va por el WebSocket de Streamer.bot, no por la API de Kick. El módulo se carga
// con `require` normal (no al tope) porque el bus es lo que le pasa los mensajes, así que
// no hay ciclo: youtube -> event-bus/sse, y nada de eso importa chat.
async function sendToYouTube(content) {
  const youtube = require('./triggers/youtube')
  const r = await youtube.send(content)
  if (r.status === 'ok') {
    const mid = r.id || 'yt'
    eventBus.emit('chat:sent', { content, message_id: mid })
    sse.broadcast({ type: 'sent', content, message_id: mid })
    return { data: { is_sent: true, message_id: mid } }
  }
  const err = new Error(r.error || 'Streamer.bot rechazó el SendMessage')
  throw err
}

// Igual que YouTube pero por el puente de Twitch (lib/streamerbot.js con platform 'twitch').
async function sendToTwitch(content) {
  const twitch = require('./triggers/twitch')
  const r = await twitch.send(content)
  if (r.status === 'ok') {
    const mid = r.id || 'tw'
    eventBus.emit('chat:sent', { content, message_id: mid })
    sse.broadcast({ type: 'sent', content, message_id: mid })
    return { data: { is_sent: true, message_id: mid } }
  }
  throw new Error(r.error || 'Streamer.bot rechazó el SendMessage')
}

module.exports = { send, sendAsBot }
