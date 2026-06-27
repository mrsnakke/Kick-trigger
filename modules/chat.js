const config = require('../lib/config')
const eventBus = require('../lib/event-bus')
const state = require('../lib/state')
const sse = require('./sse')
const auth = require('./auth')

async function send(req, res) {
  if (!state.tokens) return res.status(401).json({ error: 'No autenticado' })
  const { content, reply_to_message_id } = req.body
  if (!content || content.length > 500) return res.status(400).json({ error: 'Máx 500 caracteres' })

  await auth.ensureValidToken()
  if (!state.broadcasterUserId) await auth.fetchChannelInfo()
  try {
    const body = { broadcaster_user_id: state.broadcasterUserId, content, type: 'user' }
    if (reply_to_message_id) body.reply_to_message_id = reply_to_message_id
    const resp = await fetch('https://api.kick.com/public/v1/chat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.tokens.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    const data = await resp.json()
    if (data.data?.is_sent) {
      eventBus.emit('chat:sent', { content, message_id: data.data.message_id })
      sse.broadcast({ type: 'sent', content, message_id: data.data.message_id })
    }
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = { send }
