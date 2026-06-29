const { Router } = require('express')
const path = require('path')
const multer = require('multer')
const store = require('../modules/data/store')
const logger = require('../lib/logger')

const TAG = 'ADMIN'
const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

const { uploadImageToGitHub } = require('../lib/imageUploader')

// ─── characters ───

router.get('/characters', (req, res) => {
  res.json({
    standard_banner: store.state.standardBanner,
    seasonal_banner: store.state.seasonalBanner,
    character_details: store.state.characterData,
  })
})

router.get('/character-details/:name', (req, res) => {
  const c = store.state.characterData[req.params.name]
  if (!c) return res.status(404).json({ error: 'Not found' })
  const banner = store.findBannerForChar(req.params.name)
  res.json({ ...c, rarity: c.rarity, banner: banner || 'unknown' })
})

router.post('/character', upload.single('image'), async (req, res) => {
  const { name, rarity, banner, stock } = req.body
  if (!name || !rarity || !banner) return res.status(400).json({ error: 'name, rarity, banner required' })

  const safe = name.replace(/[\\/:*?"<>|]/g, '')
  if (store.state.characterData[name]) return res.status(409).json({ error: 'Character already exists' })

  let imageUrl = ''
  if (req.file) {
    try {
      const ext = path.extname(req.file.originalname)
      imageUrl = await uploadImageToGitHub(`${safe}${ext}`, req.file.buffer, rarity)
    } catch (e) {
      return res.status(500).json({ error: 'Image upload failed: ' + e.message })
    }
  }

  const newChar = {
    name, rarity,
    image_url: imageUrl,
    description: `Un nuevo personaje de ${rarity.replace('_star', ' estrellas')}.`,
    stock: (rarity === '5_star' || rarity === '6_star') && banner === 'seasonal_banner' ? (parseInt(stock) || 0) : undefined,
  }

  await store.saveCharacterFile(safe, newChar)
  store.state.characterData[name] = newChar

  const target = banner === 'standard_banner' ? store.state.standardBanner : store.state.seasonalBanner
  if (!target[rarity]) target[rarity] = []
  if (!target[rarity].includes(name)) target[rarity].push(name)
  await store.saveBanner(banner === 'standard_banner' ? 'standard_banner' : 'seasonal')

  if (newChar.stock !== undefined) {
    if (!store.state.gachaConfig.character_stocks) store.state.gachaConfig.character_stocks = {}
    store.state.gachaConfig.character_stocks[name] = newChar.stock
    await store.saveGachaConfig()
    const sc = store.state.seasonalCharactersConfig.characters
    if (!sc.find(c => c.name === name)) { sc.push({ name, stock: newChar.stock }); await store.saveSeasonalChars() }
  }

  logger.log(TAG, `Created: ${name}`)
  res.status(201).json({ message: `Personaje '${name}' creado.`, character: newChar })
})

router.put('/character/:oldName', upload.single('image'), async (req, res) => {
  const oldName = req.params.oldName
  const { name, rarity, banner, stock } = req.body
  if (!name || !rarity || !banner) return res.status(400).json({ error: 'name, rarity, banner required' })

  const oldChar = store.state.characterData[oldName]
  if (!oldChar) return res.status(404).json({ error: 'Original not found' })

  const safeOld = oldName.replace(/[\\/:*?"<>|]/g, '')
  const safeNew = name.replace(/[\\/:*?"<>|]/g, '')

  if (oldName !== name) {
    try { await require('fs').promises.rename(store.charFilePath(safeOld), store.charFilePath(safeNew)) } catch {}
  }

  let imageUrl = oldChar.image_url
  if (req.file) {
    try {
      const ext = path.extname(req.file.originalname)
      imageUrl = await uploadImageToGitHub(`${safeNew}${ext}`, req.file.buffer, rarity)
    } catch (e) {
      return res.status(500).json({ error: 'Image upload failed: ' + e.message })
    }
  }

  const updated = { ...oldChar, name, rarity, image_url: imageUrl,
    stock: (rarity === '5_star' || rarity === '6_star') && banner === 'seasonal_banner' ? (parseInt(stock) || 0) : undefined }

  delete store.state.characterData[oldName]
  store.state.characterData[name] = updated
  await store.saveCharacterFile(safeNew, updated)

  for (const rk in store.state.standardBanner) store.state.standardBanner[rk] = store.state.standardBanner[rk].filter(c => c !== oldName)
  for (const rk in store.state.seasonalBanner) store.state.seasonalBanner[rk] = store.state.seasonalBanner[rk].filter(c => c !== oldName)

  const target = banner === 'standard_banner' ? store.state.standardBanner : store.state.seasonalBanner
  if (!target[rarity]) target[rarity] = []
  if (!target[rarity].includes(name)) target[rarity].push(name)
  await store.saveBanner('standard_banner')
  await store.saveBanner('seasonal')

  if (store.state.gachaConfig.character_stocks) {
    if (oldName !== name && store.state.gachaConfig.character_stocks[oldName] !== undefined) {
      store.state.gachaConfig.character_stocks[name] = store.state.gachaConfig.character_stocks[oldName]
      delete store.state.gachaConfig.character_stocks[oldName]
    }
    if (updated.stock !== undefined) store.state.gachaConfig.character_stocks[name] = updated.stock
    else delete store.state.gachaConfig.character_stocks[name]
    await store.saveGachaConfig()
  }

  const sc = store.state.seasonalCharactersConfig.characters
  const sci = sc.findIndex(c => c.name === oldName)
  if (sci !== -1) { sc[sci].name = name; sc[sci].stock = updated.stock }
  else if ((rarity === '5_star' || rarity === '6_star') && banner === 'seasonal_banner') { sc.push({ name, stock: updated.stock }) }
  if (!((rarity === '5_star' || rarity === '6_star') && banner === 'seasonal_banner')) {
    store.state.seasonalCharactersConfig.characters = sc.filter(c => c.name !== name)
  }
  await store.saveSeasonalChars()

  logger.log(TAG, `Updated: ${oldName} -> ${name}`)
  res.json({ message: `Personaje '${name}' actualizado.`, character: updated })
})

router.delete('/character/:name', async (req, res) => {
  const name = req.params.name
  if (!store.state.characterData[name]) return res.status(404).json({ error: 'Not found' })
  await store.deleteCharacterFile(name)
  delete store.state.characterData[name]
  for (const rk in store.state.standardBanner) store.state.standardBanner[rk] = store.state.standardBanner[rk].filter(c => c !== name)
  for (const rk in store.state.seasonalBanner) store.state.seasonalBanner[rk] = store.state.seasonalBanner[rk].filter(c => c !== name)
  await store.saveBanner('standard_banner')
  await store.saveBanner('seasonal')
  if (store.state.gachaConfig.character_stocks) { delete store.state.gachaConfig.character_stocks[name]; await store.saveGachaConfig() }
  store.state.seasonalCharactersConfig.characters = store.state.seasonalCharactersConfig.characters.filter(c => c.name !== name)
  await store.saveSeasonalChars()
  logger.log(TAG, `Deleted: ${name}`)
  res.json({ message: `Personaje '${name}' eliminado.` })
})

// ─── gacha config ───

router.get('/gacha-config', (req, res) => res.json(store.state.gachaConfig))

router.put('/gacha-config/rarity-probabilities', async (req, res) => {
  const probs = req.body
  const sum = Object.values(probs).reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 1) > 0.0001) return res.status(400).json({ error: 'Probabilities must sum to 1' })
  store.state.gachaConfig.gacha_rules.rarity_probabilities = probs
  await store.saveGachaConfig()
  res.json({ message: 'Probabilities updated.' })
})

router.put('/gacha-config/banner-probabilities', async (req, res) => {
  // ponytail: store in config for frontend, actual 40/60 split is hardcoded in engine
  if (!store.state.gachaConfig.gacha_rules.banner_selection_probabilities) {
    store.state.gachaConfig.gacha_rules.banner_selection_probabilities = {}
  }
  store.state.gachaConfig.gacha_rules.banner_selection_probabilities['4_star_and_above'] = req.body
  await store.saveGachaConfig()
  res.json({ message: 'Banner probabilities updated.' })
})

router.put('/gacha-config/character-stocks', async (req, res) => {
  store.state.gachaConfig.character_stocks = req.body
  await store.saveGachaConfig()
  for (const [name, stock] of Object.entries(req.body)) {
    if (store.state.characterData[name]) store.state.characterData[name].stock = stock
    const sc = store.state.seasonalCharactersConfig.characters
    const idx = sc.findIndex(c => c.name === name)
    if (idx !== -1) sc[idx].stock = stock
  }
  await store.saveSeasonalChars()
  res.json({ message: 'Stocks updated.' })
})

// ─── seasonal ───

router.get('/seasonal-characters-config', (req, res) => {
  const chars = (store.state.seasonalCharactersConfig.characters || []).map(c => {
    const d = store.state.characterData[c.name] || {}
    const s = store.state.gachaConfig.character_stocks?.[c.name] ?? c.stock
    return { name: c.name, stock: s, image_url: d.image_url || '' }
  })
  res.json({ season_duration: store.state.seasonalCharactersConfig.season_duration, characters: chars })
})

router.put('/seasonal-characters-config/duration', async (req, res) => {
  store.state.seasonalCharactersConfig.season_duration = req.body.season_duration
  await store.saveSeasonalChars()
  res.json({ message: 'Duration updated.' })
})

router.post('/seasonal-characters-config/add-character', async (req, res) => {
  const { name, stock } = req.body
  if (!name || stock === undefined || !store.state.characterData[name]) return res.status(400).json({ error: 'Invalid' })
  if (store.state.seasonalCharactersConfig.characters.find(c => c.name === name)) return res.status(409).json({ error: 'Already in seasonal' })
  const s = parseInt(stock)
  store.state.seasonalCharactersConfig.characters.push({ name, stock: s })
  if (!store.state.gachaConfig.character_stocks) store.state.gachaConfig.character_stocks = {}
  store.state.gachaConfig.character_stocks[name] = s
  await store.saveSeasonalChars()
  await store.saveGachaConfig()
  res.status(201).json({ message: `'${name}' added to seasonal.` })
})

router.delete('/seasonal-characters-config/remove-character/:name', async (req, res) => {
  const { name } = req.params
  const len = store.state.seasonalCharactersConfig.characters.length
  store.state.seasonalCharactersConfig.characters = store.state.seasonalCharactersConfig.characters.filter(c => c.name !== name)
  if (store.state.seasonalCharactersConfig.characters.length === len) return res.status(404).json({ error: 'Not found' })
  await store.saveSeasonalChars()
  res.json({ message: `'${name}' removed from seasonal.` })
})

router.put('/seasonal-characters-config/update-stock', async (req, res) => {
  const { name, stock } = req.body
  if (!name || stock === undefined) return res.status(400).json({ error: 'name and stock required' })
  const sc = store.state.seasonalCharactersConfig.characters
  const idx = sc.findIndex(c => c.name === name)
  if (idx === -1) return res.status(404).json({ error: 'Not in seasonal' })
  sc[idx].stock = parseInt(stock)
  if (!store.state.gachaConfig.character_stocks) store.state.gachaConfig.character_stocks = {}
  store.state.gachaConfig.character_stocks[name] = parseInt(stock)
  if (store.state.characterData[name]) store.state.characterData[name].stock = parseInt(stock)
  await store.saveSeasonalChars()
  await store.saveGachaConfig()
  res.json({ message: `Stock de '${name}' actualizado a ${stock}.` })
})

// ─── user keys ───

router.get('/user-keys', (req, res) => {
  const keys = {}
  for (const [uid, u] of Object.entries(store.state.inventories)) {
    if (u.keys !== undefined && u.keys > 0) keys[uid] = { keys: u.keys, userName: u.userName }
  }
  res.json(keys)
})

router.post('/user-keys/add', async (req, res) => {
  const { username, keys } = req.body
  if (!username || keys === undefined || isNaN(keys) || keys <= 0) return res.status(400).json({ error: 'Invalid input' })
  const entry = Object.entries(store.state.inventories).find(([id, u]) => u.userName?.toLowerCase() === username.toLowerCase())
  if (!entry) return res.status(404).json({ error: 'Usuario no encontrado en inventario.' })
  const [userId, u] = entry
  u.keys = (u.keys || 0) + parseInt(keys)
  await store.saveInventories()
  res.json({ message: `Added ${keys} keys to ${username}. Total: ${u.keys}` })
})

// ─── endpoints info ───

router.get('/endpoints', (req, res) => {
  res.json({
    admin: [
      `Admin panel: /admin.html`,
      `Clear all data: /admin/clear-all-data?confirm=true`,
    ],
    trade: `/trades.html`,
    keys: [
      `Get user keys: GET /admin/user-keys`,
      `Add keys: POST /admin/user-keys/add { username, keys }`,
    ],
  })
})

router.get('/clear-all-data', async (req, res) => {
  if (req.query.confirm !== 'true') return res.status(400).send('?confirm=true required')
  store.state.inventories = {}
  await store.saveInventories()
  logger.log(TAG, 'All data cleared')
  res.send('Cleared.')
})

// ─── trades ───

router.get('/trades', (req, res) => {
  const trades = Object.values(store.state.trades).map(t => ({
    id: t.id,
    status: t.status,
    offeringId: t.offeringId,
    offeringName: t.offeringName,
    receivingId: t.receivingId,
    receivingName: t.receivingName,
    characterName: t.characterName,
    createdAt: t.createdAt,
    completedAt: t.completedAt
  }))
  res.json(trades)
})

router.delete('/trades/:id', async (req, res) => {
  const { id } = req.params
  const trade = store.state.trades[id]
  if (!trade) return res.status(404).json({ error: 'Trade not found' })
  if (trade.status !== 'pending') return res.status(400).json({ error: 'Only pending trades can be cancelled by admin' })
  trade.status = 'cancelled'
  await store.saveTrades()
  logger.log(TAG, `Admin cancelled trade ${id}`)
  res.json({ message: `Trade ${id.slice(0, 8)} cancelled.` })
})

module.exports = router
