// ponytail: single-file persistence, all data loaded once at startup
const fs = require('fs').promises
const path = require('path')
const config = require('../../lib/config')
const logger = require('../../lib/logger')

const TAG = 'STORE'

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
  standardBanner: {},
  seasonalBanner: {},
  seasonalCharactersConfig: {},
  inventories: {},   // userId -> { userName, '3_star':[], '4_star':[], '5_star':[], '6_star':[], total_pulls, keys, pity: { '4_star':0, '5_star':0 } }
  trades: {},        // tradeId -> trade
  tradeHistory: [],
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
  logger.log(TAG, 'Loading data...')

  state.gachaConfig = await loadJson(WP('gacha_config.json'))
  state.pityData = await loadJson(p('pity_data.json'))
  state.standardBanner = await loadJson(path.join(BANNERS, 'standard_banner.json'))
  state.seasonalBanner = await loadJson(path.join(BANNERS, 'seasonal_banner.json'))
  state.seasonalCharactersConfig = await loadJson(path.join(BANNERS, 'seasonal_characters.json'))

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
      if (!inv[uid]) inv[uid] = { userName: uid, '3_star': [], '4_star': [], '5_star': [], '6_star': [], total_pulls: 0, keys: 0 }
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
    ...(state.seasonalBanner['4_star'] || []),
    ...(state.seasonalBanner['5_star'] || []),
    ...(state.seasonalBanner['6_star'] || []),
    ...(state.seasonalCharactersConfig.characters || []).map(c => c.name),
  ])

  for (const name of allCharNames) {
    try {
      const c = JSON.parse(await fs.readFile(path.join(CHARS, `${name}.json`), 'utf8'))
      c.stock = (state.gachaConfig.character_stocks || {})[name] ?? c.stock
      // ponytail: index by the JSON's "name" field (canonical display name), not the filename
      const canonicalKey = c.name || name
      state.characterData[canonicalKey] = c
      // ponytail: keep file-name alias so !setstock, !takechar, etc. still find it either way
      if (canonicalKey !== name) {
        Object.defineProperty(state.characterData[canonicalKey], '_fileKey', { value: name, enumerable: false })
      }
    } catch {
      logger.warn(TAG, `Could not load character: ${name}`)
    }
  }

  sanitizeInventories()

  logger.log(TAG, `Loaded ${Object.keys(state.characterData).length} characters`)
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
    for (const r of ['3_star', '4_star', '5_star', '6_star']) {
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
    if (!Array.isArray(u['6_star'])) u['6_star'] = []
  }
  if (purged > 0) logger.warn(TAG, `Sanitized ${purged} invalid character entries from inventories`)
  if (orphanIds.length > 0) logger.warn(TAG, `Orphan numeric userIds without userName: ${orphanIds.join(', ')}`)
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
async function saveSeasonalChars(){ await persist('gacha_data/banners/seasonal_characters.json', state.seasonalCharactersConfig) }

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

async function deleteCharacterFile(name) {
  try { await fs.unlink(charFilePath(name)) } catch {}
}

// --- user helpers ---
function getUser(userId) {
  if (!state.inventories[userId]) {
    state.inventories[userId] = {
      userName: userId,
      '3_star': [], '4_star': [], '5_star': [], '6_star': [],
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
  const file = type === 'standard_banner' ? 'standard_banner.json' : 'seasonal_banner.json'
  const data = type === 'standard_banner' ? state.standardBanner : state.seasonalBanner
  await fs.writeFile(path.join(BANNERS, file), JSON.stringify(data, null, 2))
}

module.exports = {
  state,
  init,
  saveInventories,
  saveTrades,
  saveTradeHistory,
  saveGachaConfig,
  saveSeasonalChars,
  normalizeImageUrl,
  saveCharacterFile,
  deleteCharacterFile,
  getUser,
  getPity,
  findBannerForChar,
  saveBanner,
  charFilePath,
}
