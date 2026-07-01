const { Router } = require('express')
const path = require('path')
const multer = require('multer')
const store = require('../modules/data/store')
const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

const { uploadImageToGitHub } = require('../lib/imageUploader')

function stockVal(name) { return store.getStock(name) }

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
  if (!req.file) return res.status(400).json({ error: 'Image file is required' })

  const safe = name.replace(/[\\/:*?"<>|]/g, '')
  if (store.state.characterData[name]) return res.status(409).json({ error: 'Character already exists' })

  let imageUrl = ''
  try {
    const ext = path.extname(req.file.originalname)
    imageUrl = await uploadImageToGitHub(`${safe}${ext}`, req.file.buffer, rarity)
  } catch (e) {
    return res.status(500).json({ error: 'Image upload failed: ' + e.message })
  }

  const isSeasonal = rarity === '5_star' && banner === 'seasonal_banner'
  const charStock = isSeasonal ? 5 : undefined

  const newChar = {
    name, rarity,
    image_url: imageUrl,
  }

  if (charStock !== undefined) newChar.stock = charStock
  await store.saveCharacterFile(safe, newChar)
  store.state.characterData[name] = newChar
  newChar.stock = charStock

  if (charStock !== undefined) {
    const season = store.getOrCreateSeason()
    if (!season.characters.find(c => c.name === name)) { season.characters.push({ name, rarity, stock: charStock }); await store.saveSeasonData() }
  }

  const target = banner === 'standard_banner' ? store.state.standardBanner : store.state.seasonalBanner
  if (!target[rarity]) target[rarity] = []
  if (!target[rarity].includes(name)) target[rarity].push(name)
  await store.saveBanner(banner === 'standard_banner' ? 'standard_banner' : 'seasonal')

  console.log('[ADMIN] Created:', name)
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

  const newStockVal = rarity === '5_star' && banner === 'seasonal_banner' ? (parseInt(stock) || 5) : undefined
  const updated = { ...oldChar, name, rarity, image_url: imageUrl }
  if (newStockVal !== undefined) updated.stock = newStockVal

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

  const isSeasonal = rarity === '5_star' && banner === 'seasonal_banner'
  const foundInAny = []
  for (const s of store.state.seasonData.seasons) {
    const sci = s.characters.findIndex(c => c.name === oldName)
    if (sci !== -1) {
      s.characters[sci].name = name
      s.characters[sci].rarity = rarity
      s.characters[sci].stock = newStockVal
      foundInAny.push(s)
    }
  }
  if (isSeasonal && foundInAny.length === 0) {
    const season = store.getOrCreateSeason()
    if (!season.characters.find(c => c.name === name)) season.characters.push({ name, rarity, stock: newStockVal })
  }
  if (!isSeasonal) {
    for (const s of store.state.seasonData.seasons) {
      s.characters = s.characters.filter(c => c.name !== name)
    }
  }
  await store.saveSeasonData()

  // sync characterData stock from stockMap (source of truth)
  updated.stock = store.getStock(name)

  console.log('[ADMIN] Updated:', oldName, '->', name)
  res.json({ message: `Personaje '${name}' actualizado.`, character: updated })
})

router.delete('/character/:name', async (req, res) => {
  const name = req.params.name
  if (!store.state.characterData[name]) return res.status(404).json({ error: 'Not found' })
  await store.deleteCharacterFile(name)
  delete store.state.characterData[name]
  delete store.state.stockMap[name]
  for (const rk in store.state.standardBanner) store.state.standardBanner[rk] = store.state.standardBanner[rk].filter(c => c !== name)
  for (const rk in store.state.seasonalBanner) store.state.seasonalBanner[rk] = store.state.seasonalBanner[rk].filter(c => c !== name)
  await store.saveBanner('standard_banner')
  await store.saveBanner('seasonal')
  for (const s of store.state.seasonData.seasons) s.characters = s.characters.filter(c => c.name !== name)
  await store.saveSeasonData()
  console.log('[ADMIN] Deleted:', name)
  res.json({ message: `Personaje '${name}' eliminado.` })
})

// ─── gacha config ───

router.get('/gacha-config', (req, res) => res.json(store.state.gachaConfig))

router.get('/pity-data', (req, res) => res.json(store.state.pityData))

router.put('/pity-data', async (req, res) => {
  const { '4_star': s4, '5_star': s5 } = req.body
  if (!s4 || !s5) return res.status(400).json({ error: '4_star and 5_star required' })
  if (s4.soft_pity >= s4.hard_pity || s5.soft_pity >= s5.hard_pity) return res.status(400).json({ error: 'soft_pity must be less than hard_pity' })
  store.state.pityData.pity_thresholds['4_star'] = { soft_pity: s4.soft_pity, hard_pity: s4.hard_pity }
  store.state.pityData.pity_thresholds['5_star'] = { soft_pity: s5.soft_pity, hard_pity: s5.hard_pity }
  await store.savePityData()
  res.json({ message: 'Pity thresholds updated.' })
})

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
  for (const [name, stock] of Object.entries(req.body)) {
    await store.setStock(name, stock)
  }
  res.json({ message: 'Stocks updated.' })
})

// ─── seasons ───

router.get('/seasons', (req, res) => {
  const seasons = store.state.seasonData.seasons.map(s => ({
    ...s,
    characters: s.characters.map(c => {
      const d = store.state.characterData[c.name] || {}
      return { name: c.name, stock: store.getStock(c.name) ?? c.stock, image_url: d.image_url || '' }
    })
  }))
  res.json(seasons)
})

router.put('/seasons/:id/stock', async (req, res) => {
  const id = parseInt(req.params.id)
  const { name, stock } = req.body
  if (!name || stock === undefined) return res.status(400).json({ error: 'name and stock required' })
  const season = store.state.seasonData.seasons.find(s => s.id === id)
  if (!season) return res.status(404).json({ error: 'Season not found' })
  const idx = season.characters.findIndex(c => c.name === name)
  if (idx === -1) return res.status(404).json({ error: 'Character not in this season' })
  const s = parseInt(stock)
  await store.setStock(name, s)
  res.json({ message: `Stock de '${name}' = ${s}` })
})

router.put('/seasons/:id/mass-stock', async (req, res) => {
  const id = parseInt(req.params.id)
  const { amount } = req.body
  if (amount === undefined || isNaN(amount)) return res.status(400).json({ error: 'amount required' })
  const season = store.state.seasonData.seasons.find(s => s.id === id)
  if (!season) return res.status(404).json({ error: 'Season not found' })
  const a = parseInt(amount)
  for (const c of season.characters) {
    await store.setStock(c.name, (store.getStock(c.name) ?? c.stock ?? 0) + a)
  }
  res.json({ message: `+${a} stock a ${season.characters.length} personajes de ${season.label}` })
})

router.post('/seasons/:id/add-character', async (req, res) => {
  const id = parseInt(req.params.id)
  const { name, stock } = req.body
  if (!name) return res.status(400).json({ error: 'name required' })
  if (!store.state.characterData[name]) return res.status(400).json({ error: 'Character does not exist' })
  const season = store.state.seasonData.seasons.find(s => s.id === id)
  if (!season) return res.status(404).json({ error: 'Season not found' })
  if (season.characters.find(c => c.name === name)) return res.status(409).json({ error: 'Already in this season' })
  const charData = store.state.characterData[name]
  const rarity = typeof charData.rarity === 'number' ? `${charData.rarity}_star` : (charData.rarity || '5_star')
  const s = parseInt(stock) || 5
  season.characters.push({ name, rarity, stock: s })
  await store.saveSeasonData()
  res.status(201).json({ message: `'${name}' añadido a ${season.label}` })
})

router.delete('/seasons/:id/remove-character/:name', async (req, res) => {
  const id = parseInt(req.params.id)
  const { name } = req.params
  const season = store.state.seasonData.seasons.find(s => s.id === id)
  if (!season) return res.status(404).json({ error: 'Season not found' })
  const len = season.characters.length
  season.characters = season.characters.filter(c => c.name !== name)
  if (season.characters.length === len) return res.status(404).json({ error: 'Character not in this season' })
  await store.saveSeasonData()
  res.json({ message: `'${name}' quitado de ${season.label}` })
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

router.post('/user-keys/add-all', async (req, res) => {
  const { keys } = req.body
  if (keys === undefined || isNaN(keys) || keys <= 0) return res.status(400).json({ error: 'Invalid amount' })
  const amount = parseInt(keys)
  let count = 0
  for (const u of Object.values(store.state.inventories)) {
    u.keys = (u.keys || 0) + amount
    count++
  }
  await store.saveInventories()
  res.json({ message: `Added ${amount} keys to ${count} users.` })
})

// ─── endpoints info ───

router.get('/endpoints', (req, res) => {
  res.json({
    admin: [
      `Admin panel: Integrated in main dashboard at / (⚙️ Administrar Gacha)`,
      `Clear all data: /admin/clear-all-data?confirm=true`,
    ],
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
  console.log('[ADMIN] All data cleared')
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
  console.log('[ADMIN] Admin cancelled trade', id)
  res.json({ message: `Trade ${id.slice(0, 8)} cancelled.` })
})

module.exports = router
