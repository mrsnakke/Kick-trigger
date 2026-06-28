const { WebSocketServer } = require('ws')

let wss

function init(server) {
  wss = new WebSocketServer({ server, path: '/ws/gacha' })
  wss.on('connection', (ws) => {
    console.log('[WS] Gacha overlay connected')
    ws.on('close', () => console.log('[WS] Gacha overlay disconnected'))
  })
}

function broadcast(data) {
  if (!wss) return
  const msg = JSON.stringify(data)
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) client.send(msg)
  })
}

module.exports = { init, broadcast, getWss: () => wss }
