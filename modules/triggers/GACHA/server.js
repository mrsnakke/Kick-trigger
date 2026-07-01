const express = require('express')
const http = require('http')
const path = require('path')
const cors = require('cors')
const config = require('./lib/config')
const logger = require('./lib/logger')
const wsPush = require('./lib/ws-push')
const store = require('./modules/data/store')

const TAG = 'SERVER'
const app = express()
const server = http.createServer(app)

// ─── middleware ───
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(config.webDir))

// ─── WebSocket ───
wsPush.init(server)

// ─── routes ───
const webhookRoutes = require('./routes/webhook')
const overlayRoutes = require('./routes/overlay')
const adminRoutes = require('./routes/admin')

app.use('/', webhookRoutes)
app.use('/api', overlayRoutes)
app.use('/admin', adminRoutes)

// ─── legacy compatibility routes (old StreamerBot-style endpoints, now event-driven) ───
// These respond with helpful info instead of doing pulls directly
app.get('/pull-single', (req, res) => {
  res.status(410).send('Gacha is now event-driven via Kick backend. Send channel reward redemptions to trigger pulls.')
})
app.get('/pull-multi', (req, res) => {
  res.status(410).send('Gacha is now event-driven via Kick backend. Send channel reward redemptions to trigger pulls.')
})
app.get('/add-keys', (req, res) => {
  res.status(410).send('Use Kick chat command !daily or admin panel to add keys.')
})

// ─── legacy View endpoint ───
app.get('/View', async (req, res) => {
  const { userId, userName, character: characterName } = req.query
  if (!characterName) return res.status(400).send('character required')

  const norm = characterName.toLowerCase()
  const c = store.state.characterData[Object.keys(store.state.characterData).find(k => k.toLowerCase() === norm)]
  if (!c) return res.status(404).send('Character not found')

  const image = store.normalizeImageUrl(c.image_url)
  const inv = store.state.inventories
  let total = 0
  let userOwns = false
  const owners = []

  for (const [uid, uinv] of Object.entries(inv)) {
    let count = 0
    for (const r of ['5_star', '4_star', '3_star']) {
      if (uinv[r]) count += uinv[r].filter(n => n.toLowerCase() === norm).length
    }
    if (count > 0) {
      total += count
      owners.push({ userName: (uinv.userName && uinv.userName !== '%user%') ? uinv.userName : uid, count })
      if (uid === userId) userOwns = true
    }
  }

  const quality = typeof c.rarity === 'number' ? `${c.rarity}-star` : String(c.rarity || 'Unknown').replace('_', ' ')

  wsPush.broadcast({
    type: 'showCharacter',
    data: {
      character: { name: c.name, image, quality },
      userOwnsCharacter: userOwns,
      totalInInventories: total,
      owners,
    },
  })

  res.send('OK')
})

// ─── load data & start ───
store.init().then(() => {
  // load event handlers
  require('./modules/events/commands')

server.listen(config.port, '0.0.0.0', () => {
    logger.log(TAG, `Gacha server running on http://0.0.0.0:${config.port}`)
    logger.log(TAG, `Overlay: http://localhost:${config.port}/`)
    logger.log(TAG, `Overlay (view): http://localhost:${config.port}/view.html`)
    logger.log(TAG, `Receiving events at POST /kick-events`)
  })
}).catch((e) => {
  logger.error(TAG, `Failed to load data: ${e.message}`)
  process.exit(1)
})
