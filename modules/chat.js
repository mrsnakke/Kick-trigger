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

async function sendAsBot(content, replyTo) {
  if (!state.botTokens) throw new Error('Bot no autenticado')
  if (!content || content.length > 500) throw new Error('Máx 500 caracteres')
  await auth.ensureValidBotToken()
  if (!state.broadcasterUserId) await auth.fetchChannelInfo()
  return sendToKick(state.botTokens, content, 'user', replyTo)
}

module.exports = { send, sendAsBot }
