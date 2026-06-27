const config = require('./config')
const eventBus = require('./event-bus')

// ponytail: fire-and-forget con catch silencioso, reintentos si alguna URL lo requiere
function forward(eventName, data) {
  if (!config.FORWARD_URLS.length) return
  const body = JSON.stringify({ event: eventName, data, source: 'kick-backend', ts: new Date().toISOString() })
  for (const url of config.FORWARD_URLS) {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    }).catch(() => { /* ponytail: fire-and-forget, logs si alguien quiere debug */ })
  }
}

// Escucha todos los eventos Kick (nombres planos) y los reenvía
// ponytail: lista explícita, add cuando se agreguen eventos
const KICK_EVENTS = [
  'chat.message.sent',
  'channel.followed',
  'channel.subscription.new',
  'channel.subscription.renewal',
  'channel.subscription.gifts',
  'channel.reward.redemption.updated',
  'livestream.status.updated',
  'livestream.metadata.updated',
  'moderation.banned',
  'kicks.gifted',
]

function init() {
  for (const ev of KICK_EVENTS) {
    eventBus.on(ev, data => forward(ev, data))
  }
  // También reenvía eventos internos relevantes
  eventBus.on('auth:ready', data => forward('auth:ready', data))
  eventBus.on('auth:disconnected', () => forward('auth:disconnected', {}))
  eventBus.on('tunnel:open', data => forward('tunnel:open', data))
  eventBus.on('tunnel:closed', data => forward('tunnel:closed', data))
}

module.exports = { init }
