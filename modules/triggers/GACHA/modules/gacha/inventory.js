// ponytail: inventory CRUD — keys, char tracking, add-to-inventory
const store = require('../data/store')
const logger = require('../../lib/logger')

const TAG = 'INV'

function ensureUser(userId, userName) {
  const u = store.getUser(userId)
  u.userName = userName
  return u
}

async function addCharacters(userId, characters, userName) {
  const u = ensureUser(userId, userName || userId)
  let dropped = 0
  for (const c of characters) {
    if (!store.state.characterData[c.name]) {
      logger.warn(TAG, `Rejected unknown character: ${c.name} (rarity=${c.rarity})`)
      dropped++
      continue
    }
    const arr = u[c.rarity]
    if (arr && !arr.includes(c.name)) {
      arr.push(c.name)
      logger.log(TAG, `Added ${c.name} (${c.rarity}) to ${userName || userId}`)
    }
  }
  u.total_pulls = (u.total_pulls || 0) + characters.length
  await store.saveInventories()
  return { added: characters.length - dropped, dropped }
}

function getKeys(userId) {
  const u = store.state.inventories[userId]
  return u ? (u.keys || 0) : 0
}

async function addKeys(userId, amount, userName) {
  const u = ensureUser(userId, userName || userId)
  u.keys = (u.keys || 0) + amount
  await store.saveInventories()
  return u.keys
}

async function spendKeys(userId, amount) {
  const u = store.state.inventories[userId]
  if (!u || (u.keys || 0) < amount) throw new Error('Not enough keys')
  u.keys -= amount
  await store.saveInventories()
  return u.keys
}

function getInventoryText(userId) {
  const u = store.state.inventories[userId]
  if (!u) return ['No tienes personajes aún.']

  const keys = u.keys || 0
  const totalPulls = u.total_pulls || 0
  const pity = u.pity || { '4_star': 0, '5_star': 0 }
  const fourStars = (u['4_star'] || []).length
  const fiveStars = (u['5_star'] || []).length
  const sixStars = (u['6_star'] || []).length

  return [
    `🔑 Keys: ${keys}  ｜  📊 Tiradas: ${totalPulls}  ｜  🎯 Pity: ${pity['5_star']}/90 (Faltan ${90 - pity['5_star']})  ｜  🟣 4⭐: ${fourStars}  🟡 5⭐: ${fiveStars}  🔴 6⭐: ${sixStars}`
  ]
}

module.exports = { ensureUser, addCharacters, getKeys, addKeys, spendKeys, getInventoryText }
