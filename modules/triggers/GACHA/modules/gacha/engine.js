// ponytail: gacha pull & pity logic, pure functions operating on store state
const store = require('../data/store')

function selectRarity(pity) {
  const pityData = store.state.pityData.pity_thresholds
  // pity counts pulls since last hit; the current pull is pity+1, so the
  // guarantee must trigger when pity reaches hard_pity - 1
  if (pity['5_star'] >= pityData['5_star'].hard_pity - 1) return '5_star'
  if (pity['4_star'] >= pityData['4_star'].hard_pity - 1) return '4_star'

  const probs = { ...store.state.gachaConfig.gacha_rules.rarity_probabilities }
  if (pity['5_star'] >= pityData['5_star'].soft_pity - 1) probs['5_star'] += 0.1
  if (pity['4_star'] >= pityData['4_star'].soft_pity - 1) probs['4_star'] += 0.1

  const r = Math.random()
  let cum = 0
  if (r < (cum += probs['5_star'])) return '5_star'
  if (r < (cum += probs['4_star'])) return '4_star'
  return '3_star'
}

function updatePity(pity, rarity) {
  if (rarity === '5_star') { pity['5_star'] = 0; pity['4_star']++ }
  else if (rarity === '4_star') { pity['4_star'] = 0; pity['5_star']++ }
  else { pity['4_star']++; pity['5_star']++ }
}

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)] }

function getAvailable(names) {
  return names.filter(n => {
    const c = store.state.characterData[n]
    return c && (c.stock === undefined || c.stock > 0)
  })
}

function getNewChars(names, userId, rarity) {
  const inv = store.state.inventories[userId]
  if (!inv || !inv[rarity]) return names
  return names.filter(n => !inv[rarity].includes(n))
}

function selectCharacter(rarity, userId) {
  const sd = store.state
  let pool
  let bannerSource = 'standard'

  if (rarity === '3_star') {
    pool = sd.standardBanner['3_star']
  } else if (rarity === '4_star') {
    const bp = store.state.gachaConfig.gacha_rules?.banner_selection_probabilities?.['4_star_and_above']
    const seasonalProb = bp?.seasonal_banner ?? 0.4
    const isSeasonal = Math.random() < seasonalProb
    pool = isSeasonal ? sd.seasonalBanner['4_star'] : sd.standardBanner['4_star']
    bannerSource = isSeasonal ? 'seasonal' : 'standard'
  } else if (rarity === '5_star') {
    const bp = store.state.gachaConfig.gacha_rules?.banner_selection_probabilities?.['4_star_and_above']
    const seasonalProb = bp?.seasonal_banner ?? 0.5
    const won5050 = Math.random() < seasonalProb
    bannerSource = won5050 ? 'seasonal' : 'standard'
    pool = won5050 ? sd.seasonalBanner['5_star'] : sd.standardBanner['5_star']

    if (won5050) {
      const newAvail = getNewChars(getAvailable(pool), userId, '5_star')
      if (newAvail.length > 0) {
        const pick = sd.characterData[pickRandom(newAvail)]
        if (pick) return pick
      }
      console.log('[ENGINE] User has all seasonal 5-stars, falling back to standard')
      pool = sd.standardBanner['5_star']
    }

    const newAvail = getNewChars(getAvailable(pool), userId, '5_star')
    if (newAvail.length > 0) {
      return sd.characterData[pickRandom(newAvail)]
    }
    return null
  }

  if (!pool || pool.length === 0) {
    pool = sd.standardBanner[rarity]
    if (!pool || pool.length === 0) return null
  }

  let avail = getAvailable(pool)
  if (avail.length === 0 && bannerSource === 'seasonal') {
    avail = getAvailable(sd.standardBanner[rarity])
  }
  if (avail.length === 0) return null

  return sd.characterData[pickRandom(avail)] || null
}

async function performPull(userId) {
  const pity = store.getPity(userId)
  const rarity = selectRarity(pity)
  const char = selectCharacter(rarity, userId)
  if (!char) return null

  // track stock decrement (source of truth: gacha_temporadas.json via stockMap)
  const isNew = !store.state.inventories[userId]?.[rarity]?.includes(char.name)
  if (isNew && char.stock !== undefined && char.stock > 0) {
    const newStock = Math.max(0, char.stock - 1)
    await store.setStock(char.name, newStock)
    char.stock = newStock
  }

  updatePity(pity, rarity)
  // ponytail: no save here — addCharacters handles the final persist
  // this avoids a crash window where pity is updated but character is lost

  const result = {
    ...char,
    rarity,
    image_url: store.normalizeImageUrl(char.image_url),
  }
  console.log('[ENGINE] Pull:', result.name, '(' + rarity + ')')
  return result
}

async function performMultiPull(userId) {
  const results = []
  for (let i = 0; i < 10; i++) {
    const c = await performPull(userId)
    if (c) results.push(c)
  }
  return results
}

module.exports = { performPull, performMultiPull, selectRarity }
