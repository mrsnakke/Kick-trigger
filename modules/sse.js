const state = require('../lib/state')
const eventBus = require('../lib/event-bus')

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`
  state.sseClients.forEach(c => { try { c.res.write(msg) } catch {} })
}

function handle(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
  const client = { id: Date.now(), res }
  state.sseClients.push(client)
  res.write(`data: ${JSON.stringify({
    type: 'status',
    authenticated: !!state.tokens,
    botAuthenticated: !!state.botTokens,
    tunnelUrl: state.tunnelUrl,
    channelSlug: state.channelSlug,
    eventsCounter: state.eventsCounter
  })}\n\n`)

  res.write(`data: ${JSON.stringify({
    type: 'auth',
    status: state.tokens ? 'connected' : 'disconnected',
    slug: state.channelSlug
  })}\n\n`)

  res.write(`data: ${JSON.stringify({
    type: 'bot-auth',
    status: state.botTokens ? 'connected' : 'disconnected'
  })}\n\n`)
  eventBus.emit('tts:request_status')
  res.on('error', () => {})
  req.on('close', () => {
    const i = state.sseClients.indexOf(client)
    if (i !== -1) state.sseClients.splice(i, 1)
  })
}

module.exports = { broadcast, handle }
