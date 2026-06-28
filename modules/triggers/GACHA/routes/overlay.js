// ponytail: overlay JSON endpoints + legacy /view-character for admin panel
const { Router } = require('express')
const store = require('../modules/data/store')
const { broadcast } = require('../lib/ws-push')
const trades = require('../modules/trades/manager')

const router = Router()

// used by view.html / admin panel to get character info
router.get('/view-character', async (req, res) => {
  const { userId, userName, characterName } = req.query
  if (!characterName) return res.status(400).json({ error: 'characterName required' })

  const norm = characterName.toLowerCase()
  const c = store.state.characterData[Object.keys(store.state.characterData).find(k => k.toLowerCase() === norm)]
  if (!c) return res.status(404).json({ error: `Character "${characterName}" not found` })

  const image = store.normalizeImageUrl(c.image_url)
  let quality = 0
  if (c.rarity) {
    if (typeof c.rarity === 'number') quality = c.rarity
    else if (typeof c.rarity === 'string') {
      const m = c.rarity.match(/^(\d+)/)
      if (m) quality = parseInt(m[1])
    }
  }

  const inv = store.state.inventories
  let totalInInventories = 0
  let userOwnsCharacter = false
  const owners = []

  for (const [uid, uinv] of Object.entries(inv)) {
    let count = 0
    for (const r of ['6_star', '5_star', '4_star', '3_star']) {
      if (uinv[r]) count += uinv[r].filter(n => n.toLowerCase() === norm).length
    }
    if (count > 0) {
      totalInInventories += count
      const ownerName = (uinv.userName && uinv.userName !== '%user%') ? uinv.userName : uid
      owners.push({ userName: ownerName, count })
      if (uid === userId) userOwnsCharacter = true
    }
  }

  res.json({
    character: {
      name: c.name.toUpperCase(),
      image,
      quality,
      description: c.description || 'No hay descripción disponible.',
    },
    userOwnsCharacter,
    totalInInventories,
    owners,
  })
})

// user trades for trades.html
router.get('/trades/:userName', (req, res) => {
  const userName = req.params.userName.toLowerCase()
  const entry = Object.entries(store.state.inventories).find(([id, u]) => u.userName?.toLowerCase() === userName)
  if (!entry) return res.json({ sent: [], received: [] })
  const [userId] = entry
  const { sent, received } = trades.getTradesForPlayer(userId)
  res.json({ sent, received })
})

// accept trade
router.post('/trade/:id/accept', async (req, res) => {
  const { acceptingPlayer } = req.body
  if (!acceptingPlayer) return res.status(400).json({ message: 'acceptingPlayer required' })
  try {
    const t = await trades.acceptTrade(req.params.id, acceptingPlayer)
    broadcast({ event: 'trade_updated', data: t })
    res.json({ message: 'Trade accepted', trade: t })
  } catch (e) { res.status(400).json({ message: e.message }) }
})

// cancel trade
router.post('/trade/:id/cancel', async (req, res) => {
  const { cancellingPlayer } = req.body
  if (!cancellingPlayer) return res.status(400).json({ message: 'cancellingPlayer required' })
  try {
    const t = await trades.cancelTrade(req.params.id, cancellingPlayer)
    broadcast({ event: 'trade_updated', data: t })
    res.json({ message: 'Trade cancelled', trade: t })
  } catch (e) { res.status(400).json({ message: e.message }) }
})

// broadcast a character card to overlay (used by admin/chat commands)
router.get('/show-character', async (req, res) => {
  const { characterName } = req.query
  if (!characterName) return res.status(400).send('characterName required')

  const norm = characterName.toLowerCase()
  const c = store.state.characterData[Object.keys(store.state.characterData).find(k => k.toLowerCase() === norm)]
  if (!c) return res.status(404).send('Character not found')

  broadcast({
    type: 'showCharacter',
    data: {
      character: {
        name: c.name.toUpperCase(),
        image: store.normalizeImageUrl(c.image_url),
        quality: typeof c.rarity === 'string' ? parseInt(c.rarity.match(/^(\d+)/)?.[1] || '0') : (c.rarity || 0),
        description: c.description || '',
      },
      userOwnsCharacter: false,
      totalInInventories: 0,
      owners: [],
    },
  })
  res.send('OK')
})

module.exports = router
