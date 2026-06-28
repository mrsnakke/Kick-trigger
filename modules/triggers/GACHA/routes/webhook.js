// Receives forwarded events from Kick Backend.
// Kick Backend POSTs here via FORWARD_URL in .env
const { Router } = require('express')
const bus = require('../lib/event-bus')
const logger = require('../lib/logger')

const TAG = 'WEBHOOK'
const router = Router()

// Known event types consumed by modules/events/commands.js
const KNOWN = new Set([
  'chat.message.sent',
  'channel.followed',
  'channel.subscription.new',
  'channel.subscription.renewal',
  'channel.subscription.gifts',
  'channel.reward.redemption.updated',
  'livestream.status.updated',
  'moderation.banned',
  'kicks.gifted',
])

router.post('/kick-events', (req, res) => {
  const { event, data } = req.body
  if (!event) return res.status(400).json({ error: 'Missing event field' })

  if (KNOWN.has(event)) {
    logger.log(TAG, `${event}`)
  } else {
    logger.log(TAG, `${event} (unhandled)`)
  }

  bus.emit(event, data || {})

  res.json({ ok: true })
})

// health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})

module.exports = router