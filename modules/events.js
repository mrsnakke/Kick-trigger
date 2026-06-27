const config = require('../lib/config')
const eventBus = require('../lib/event-bus')
const state = require('../lib/state')
const sse = require('./sse')
const auth = require('./auth')

async function listSubscriptions() {
  await auth.ensureValidToken()
  const resp = await fetch('https://api.kick.com/public/v1/events/subscriptions', {
    headers: { Authorization: `Bearer ${state.tokens.access_token}` }
  })
  return resp.ok ? (await resp.json()).data || [] : []
}

async function subscribeToEvents() {
  if (!state.broadcasterUserId) await auth.fetchChannelInfo()
  const results = []
  await auth.ensureValidToken()
  // limpiar suscripciones viejas
  try { for (const s of await listSubscriptions()) await fetch(`https://api.kick.com/public/v1/events/subscriptions?id=${s.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${state.tokens.access_token}` } }) } catch {}
  const webhookUrl = state.tunnelUrl ? `${state.tunnelUrl}/webhook/kick` : null
  if (!webhookUrl) {
    sse.broadcast({ type: 'subscription', event: 'all', status: 'error', message: 'Iniciá el túnel antes de subscribir' })
    return [{ name: 'all', ok: false, error: 'No tunnel URL' }]
  }
  try {
    const resp = await fetch('https://api.kick.com/public/v1/events/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.tokens.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        events: [
          { name: 'chat.message.sent', version: 1 },
          { name: 'channel.followed', version: 1 },
          { name: 'channel.subscription.new', version: 1 },
          { name: 'channel.subscription.renewal', version: 1 },
          { name: 'channel.subscription.gifts', version: 1 },
          { name: 'channel.reward.redemption.updated', version: 1 },
          { name: 'livestream.status.updated', version: 1 },
          { name: 'livestream.metadata.updated', version: 1 },
          { name: 'moderation.banned', version: 1 },
          { name: 'kicks.gifted', version: 1 }
        ],
        method: 'webhook',
        webhook_url: webhookUrl
      })
    })
    const text = await resp.text()
    let data
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    const ok = resp.ok && (resp.status === 200 || resp.status === 201 || resp.status === 204)
    console.log(`[SUB] ${resp.status} — ${ok ? 'OK' : text}`)
    if (data.data) {
      data.data.forEach(sub => {
        const s = sub.status || sub.error || 'active'
        console.log(`  ${sub.name || sub.event}: ${sub.subscription_id || s}`)
        sse.broadcast({ type: 'subscription', event: sub.name || sub.event, status: sub.error ? 'error' : 'active', subscriptionId: sub.subscription_id })
        results.push({ name: sub.name || sub.event, ok: !sub.error, subscriptionId: sub.subscription_id, error: sub.error })
      })
    } else {
      sse.broadcast({ type: 'subscription', event: 'all', status: 'error', statusCode: resp.status, message: data.message || data.error || text })
      results.push({ name: 'all', ok: false, status: resp.status, body: data })
    }
  } catch (err) {
    console.error(`[SUB] ${err.message}`)
    sse.broadcast({ type: 'subscription', event: 'all', status: 'error', message: err.message })
    results.push({ name: 'all', ok: false, error: err.message })
  }
  return results
}

async function listHandler(req, res) {
  if (!state.tokens) return res.status(401).json({ error: 'No autenticado' })
  const subs = await listSubscriptions()
  res.json(subs)
}

async function subscribeHandler(req, res) {
  if (!state.tokens) return res.status(401).json({ error: 'No autenticado' })
  const results = await subscribeToEvents()
  const allOk = results.every(r => r.ok)
  res.json({ ok: allOk, results })
}

module.exports = { listSubscriptions, subscribeToEvents, listHandler, subscribeHandler }
