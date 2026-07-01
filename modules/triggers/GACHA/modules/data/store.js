// ponytail: single-file persistence, all data loaded once at startup
const fs = require('fs').promises
const path = require('path')
const config = require('../../lib/config')

// --- paths ---
const p = (file) => path.join(config.dataDir, file)
const WP = (file) => path.join(config.webDir, file)
const BANNERS = p('gacha_data/banners')
const CHARS = p('gacha_data/characters')

// --- in-memory state ---
const state = {
  gachaConfig: {},
  pityData: {},
  characterData: {},
  stockMap: {},      // name -> stock number | undefined (undefined = unlimited)
  standardBanner: {},
  seasonalBanner: {},
  seasonData: { seasons: [] },
  inventories: {},   // userId -> { userName, '3_star':[], '4_star':[], '5_star':[], total_pulls, keys, pity: { '4_star':0, '5_star':0 } }
  trades: {},        // tradeId -> trade
  tradeHistory: [],
}

function normalizeRarity(r) {
  if (typeof r === 'number') return `${r}_star`
  if (typeof r === 'string' && r.includes('_star')) return r
  if (typeof r === 'string' && /^\d+$/.test(r)) return `${r}_star`
  return r || '5_star'
}

function buildBannerFromSeasons(seasonData, charData) {
  const banner = {}
  const seen = new Set()
  for (const s of (seasonData.seasons || [])) {
    for (const c of (s.characters || [])) {
      if (!seen.has(c.name)) {
        seen.add(c.name)
        let rarity = c.rarity
        if (!rarity && charData && charData[c.name]) {
          rarity = normalizeRarity(charData[c.name].rarity)
        }
        rarity = rarity || '5_star'
        if (!banner[rarity]) banner[rarity] = []
        banner[rarity].push(c.name)
      }
    }
  }
  return banner
}

async function loadJson(filePath, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') return fallback
    throw e
  }
}

async function init() {
  console.log('[STORE] Loading data...')

  state.gachaConfig = await loadJson(WP('gacha_config.json'))
  state.pityData = await loadJson(p('pity_data.json'))
  state.standardBanner = await loadJson(path.join(BANNERS, 'standard_banner.json'))
  state.seasonData = await loadJson(path.join(BANNERS, 'gacha_temporadas.json'), { seasons: [] })

  // migration: from old seasonal_characters.json / seasonal_banner.json to gacha_temporadas.json
  if (!state.seasonData.seasons || state.seasonData.seasons.length === 0) {
    const oldData = await loadJson(path.join(BANNERS, 'seasonal_characters.json'), null)
    const oldBannerData = await loadJson(path.join(BANNERS, 'seasonal_banner.json'), null)
    const charNames = new Set()
    if (oldData && oldData.characters) oldData.characters.forEach(c => charNames.add(c.name))
    if (oldBannerData) {
      for (const arr of Object.values(oldBannerData)) {
        if (Array.isArray(arr)) arr.forEach(n => charNames.add(n))
      }
    }
    if (charNames.size > 0) {
      const raw = oldData?.season_duration || ''
      const month = raw.slice(0, 7) || new Date().toISOString().slice(0, 7)
      const [year, m] = month.split('-')
      const endDate = new Date(parseInt(year), parseInt(m), 0).toISOString().slice(0, 10)
      state.seasonData = {
        seasons: [{
          id: 1,
          label: 'Temporada 1',
          month,
          start_date: `${month}-01`,
          end_date: endDate,
          characters: Array.from(charNames).map(name => {
            let rarity = '5_star'
            try {
              const cf = JSON.parse(require('fs').readFileSync(path.join(CHARS, `${name}.json`), 'utf8'))
              rarity = normalizeRarity(cf.rarity || '5_star')
            } catch {}
            const oldEntry = oldData?.characters?.find(c => c.name === name)
            return { name, rarity, stock: 5 }
          }),
        }]
      }
      await saveSeasonData()
      console.log('[STORE] Migrated', charNames.size, 'chars to gacha_temporadas.json with stock=5')
    }
  }

  // startup validation
  validateConfig()

  // ponytail: inventory & user_data merge — pity lives inside inventories now
  let oldUserData = await loadJson(p('user_data.json'))
  state.inventories = await loadJson(p('user_inventory.json'))
  migratePity(oldUserData, state.inventories)

  // migrate old user_data pity counters into inventory if missing
  function migratePity(oldData, inv) {
    if (!oldData.pity_counters) return
    for (const [uid, pc] of Object.entries(oldData.pity_counters)) {
      if (!inv[uid]) inv[uid] = { userName: uid, '3_star': [], '4_star': [], '5_star': [], total_pulls: 0, keys: 0 }
      if (!inv[uid].pity) inv[uid].pity = { '4_star': pc['4_star'] || 0, '5_star': pc['5_star'] || 0 }
    }
  }

  state.trades = await loadJson(p('trades.json'))
  state.tradeHistory = await loadJson(p('trade_history.json'), [])

  // load all characters from files
  const allCharNames = new Set([
    ...(state.standardBanner['3_star'] || []),
    ...(state.standardBanner['4_star'] || []),
    ...(state.standardBanner['5_star'] || []),
    ...(state.seasonData.seasons || []).flatMap(s => (s.characters || []).map(c => c.name)),
  ])

  // stockMap: source of truth is gacha_temporadas.json
  for (const s of (state.seasonData.seasons || [])) {
    for (const c of (s.characters || [])) {
      state.stockMap[c.name] = c.stock
    }
  }

  for (const name of allCharNames) {
    try {
      const c = JSON.parse(await fs.readFile(path.join(CHARS, `${name}.json`), 'utf8'))
      // stock comes from season data, not character files
      c.stock = state.stockMap[c.name || name]
      // ponytail: index by the JSON's "name" field (canonical display name), not the filename
      const canonicalKey = c.name || name
      state.characterData[canonicalKey] = c
      // ponytail: keep file-name alias so !setstock, !takechar, etc. still find it either way
      if (canonicalKey !== name) {
        Object.defineProperty(state.characterData[canonicalKey], '_fileKey', { value: name, enumerable: false })
      }
    } catch {
      console.warn('[STORE] Could not load character:', name)
    }
  }

  // build seasonal banner from season data (single source of truth)
  state.seasonalBanner = buildBannerFromSeasons(state.seasonData, state.characterData)

  sanitizeInventories()

  console.log('[STORE] Loaded', Object.keys(state.characterData).length, 'characters')
}

// ponytail: drop junk on load — characters not in characterData, bogus fields inside pity, orphan numeric userNames
function sanitizeInventories() {
  const valid = state.characterData
  const orphanIds = []
  let purged = 0
  for (const [uid, u] of Object.entries(state.inventories)) {
    if (!u || typeof u !== 'object') continue
    const looksNumericId = /^\d+$/.test(uid) && u.userName === uid
    if (looksNumericId) orphanIds.push(uid)
    for (const r of ['3_star', '4_star', '5_star']) {
      if (!Array.isArray(u[r])) { u[r] = []; continue }
      const before = u[r].length
      u[r] = u[r].filter(n => valid[n])
      purged += before - u[r].length
    }
    if (u.pity && typeof u.pity === 'object') {
      u.pity = { '4_star': u.pity['4_star'] || 0, '5_star': u.pity['5_star'] || 0 }
    } else {
      u.pity = { '4_star': 0, '5_star': 0 }
    }
    if (!Array.isArray(u['3_star'])) u['3_star'] = []
    if (!Array.isArray(u['4_star'])) u['4_star'] = []
    if (!Array.isArray(u['5_star'])) u['5_star'] = []

  }
  if (purged > 0) console.warn('[STORE] Sanitized', purged, 'invalid character entries from inventories')
  if (orphanIds.length > 0) console.warn('[STORE] Orphan numeric userIds without userName:', orphanIds.join(', '))
}

function validateConfig() {
  if (!state.pityData.pity_thresholds) {
    throw new Error('pity_data.json missing pity_thresholds')
  }
  for (const r of ['4_star', '5_star']) {
    const t = state.pityData.pity_thresholds[r]
    if (!t || typeof t.soft_pity !== 'number' || typeof t.hard_pity !== 'number') {
      throw new Error(`pity_data.json missing thresholds for ${r}`)
    }
  }

  const probs = state.gachaConfig.gacha_rules?.rarity_probabilities
  if (probs) {
    const sum = Object.values(probs).reduce((a, b) => a + b, 0)
    if (Math.abs(sum - 1) > 0.0001) {
      throw new Error(`rarity_probabilities sum to ${sum}, must be 1`)
    }
  }

  const bp = state.gachaConfig.gacha_rules?.banner_selection_probabilities?.['4_star_and_above']
  if (bp) {
    const sum = (bp.standard_banner || 0) + (bp.seasonal_banner || 0)
    if (Math.abs(sum - 1) > 0.0001) {
      throw new Error(`banner probabilities sum to ${sum}, must be 1`)
    }
  }
}

// --- generic persist helpers ---
async function persist(file, data) {
  await fs.writeFile(p(file), JSON.stringify(data, null, 2))
}

async function saveInventories() { await persist('user_inventory.json', state.inventories) }
async function saveTrades()       { await persist('trades.json', state.trades) }
async function saveTradeHistory() { await persist('trade_history.json', state.tradeHistory) }
async function saveGachaConfig()  { await fs.writeFile(WP('gacha_config.json'), JSON.stringify(state.gachaConfig, null, 2)) }
async function saveSeasonData() {
  await persist('gacha_data/banners/gacha_temporadas.json', state.seasonData)
  // rebuild stockMap from seasons
  state.stockMap = {}
  for (const s of (state.seasonData.seasons || [])) {
    for (const c of (s.characters || [])) {
      state.stockMap[c.name] = c.stock
    }
  }
  // sync to characterData so engine lookups stay correct
  for (const [name, data] of Object.entries(state.characterData)) {
    data.stock = state.stockMap[name]
  }
}

// stock helpers
function getStock(charName) {
  return state.stockMap[charName]
}

async function setStock(charName, value) {
  state.stockMap[charName] = value
  if (state.characterData[charName]) state.characterData[charName].stock = value
  for (const s of state.seasonData.seasons) {
    const idx = s.characters.findIndex(c => c.name === charName)
    if (idx !== -1) { s.characters[idx].stock = value; break }
  }
  await saveSeasonData()
}

// --- season helpers ---
function getOrCreateSeason(month) {
  if (!month) month = new Date().toISOString().slice(0, 7)
  let season = state.seasonData.seasons.find(s => s.month === month)
  if (!season) {
    const id = state.seasonData.seasons.length + 1
    const [year, m] = month.split('-')
    const endDate = new Date(parseInt(year), parseInt(m), 0).toISOString().slice(0, 10)
    season = { id, label: `Temporada ${id}`, month, start_date: `${month}-01`, end_date: endDate, characters: [] }
    state.seasonData.seasons.push(season)
  }
  return season
}

function getAllSeasonalCharacters() {
  const seen = new Set()
  const result = []
  for (const s of state.seasonData.seasons) {
    for (const c of s.characters || []) {
      if (!seen.has(c.name)) { seen.add(c.name); result.push(c) }
    }
  }
  return result
}

// --- character helpers ---
function normalizeImageUrl(url) {
  if (!url || url.startsWith('http')) return url
  let n = url.startsWith('public/') ? url.slice(7) : url
  if (!n.startsWith('/')) n = '/' + n
  return n
}

function charFilePath(name) { return path.join(CHARS, `${name}.json`) }

async function saveCharacterFile(name, data) {
  await fs.writeFile(charFilePath(name), JSON.stringify(data, null, 2))
}

async function savePityData() {
  await persist('pity_data.json', state.pityData)
}

async function deleteCharacterFile(name) {
  try { await fs.unlink(charFilePath(name)) } catch {}
}

// --- user helpers ---
function getUser(userId) {
  if (!state.inventories[userId]) {
    state.inventories[userId] = {
      userName: userId,
      '3_star': [], '4_star': [], '5_star': [],
      total_pulls: 0, keys: 0,
      pity: { '4_star': 0, '5_star': 0 },
    }
  }
  return state.inventories[userId]
}

function getPity(userId) {
  const u = getUser(userId)
  if (!u.pity) u.pity = { '4_star': 0, '5_star': 0 }
  return u.pity
}

// --- banner helpers ---
function findBannerForChar(charName) {
  for (const rarity in state.standardBanner) {
    if (state.standardBanner[rarity].includes(charName)) return 'standard_banner'
  }
  for (const rarity in state.seasonalBanner) {
    if (state.seasonalBanner[rarity].includes(charName)) return 'seasonal_banner'
  }
  return null
}

async function saveBanner(type) {
  if (type === 'seasonal') {
    // seasonal banner is derived from gacha_temporadas.json
    await saveSeasonData()
    state.seasonalBanner = buildBannerFromSeasons(state.seasonData, state.characterData)
    return
  }
  const file = 'standard_banner.json'
  await fs.writeFile(path.join(BANNERS, file), JSON.stringify(state.standardBanner, null, 2))
}

module.exports = {
  state,
  init,
  saveInventories,
  saveTrades,
  saveTradeHistory,
  saveGachaConfig,
  saveSeasonData,
  getOrCreateSeason,
  getAllSeasonalCharacters,
  normalizeImageUrl,
  saveCharacterFile,
  savePityData,
  deleteCharacterFile,
  getUser,
  getPity,
  findBannerForChar,
  saveBanner,
  charFilePath,
  getStock,
  setStock,
}
