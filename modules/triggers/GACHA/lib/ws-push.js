const { WebSocketServer } = require('ws')

let wss

function init(server) {
  wss = new WebSocketServer({ server, path: '/ws/gacha' })
  wss.on('error', err => console.error('[WS] Gacha server error:', err.message))
  wss.on('connection', (ws) => {
    console.log('[WS] Gacha overlay connected')
    ws.on('error', err => console.error('[WS] Gacha client error:', err.message))
    ws.on('close', () => console.log('[WS] Gacha overlay disconnected'))
  })
}

function broadcast(data) {
  if (!wss) return
  const msg = JSON.stringify(data)
  wss.clients.forEach((client) => {
    try { if (client.readyState === client.OPEN) client.send(msg) } catch {}
  })
}

module.exports = { init, broadcast, getWss: () => wss }
