// ponytail: trades — create, accept, cancel, query
const crypto = require('crypto')
const store = require('../data/store')
const logger = require('../../lib/logger')

const TAG = 'TRADE'

function getInventory(userId) {
  const u = store.state.inventories[userId]
  if (!u) return []
  const all = []
  for (const r of ['6_star', '5_star', '4_star', '3_star']) {
    if (u[r]) all.push(...u[r].map(n => ({ name: n, rarity: r })))
  }
  return all
}

function removeChar(userId, charName) {
  const u = store.state.inventories[userId]
  if (!u) return false
  for (const r of ['6_star', '5_star', '4_star', '3_star']) {
    const idx = (u[r] || []).indexOf(charName)
    if (idx !== -1) { u[r].splice(idx, 1); return true }
  }
  return false
}

function addChar(userId, charName, rarity) {
  const u = store.getUser(userId)
  if (!u[rarity]) u[rarity] = []
  if (!u[rarity].includes(charName)) u[rarity].push(charName)
}

async function createTrade(offeringId, offeringName, receivingId, receivingName, charName) {
  const all = getInventory(offeringId)
  const owned = all.find(c => c.name === charName)
  if (!owned) throw new Error(`${offeringName} no tiene el personaje ${charName}`)
  if (owned.rarity !== '5_star') throw new Error('Solo se pueden intercambiar personajes de 5⭐')

  const id = crypto.randomUUID()
  const trade = {
    id, status: 'pending',
    offeringId, offeringName,
    receivingId, receivingName,
    characterName: charName,
    createdAt: new Date().toISOString(),
  }
  store.state.trades[id] = trade
  await store.saveTrades()
  logger.log(TAG, `Trade ${id}: ${offeringName} -> ${receivingName} (${charName})`)
  return trade
}

async function acceptTrade(tradeId, acceptingId) {
  const t = store.state.trades[tradeId]
  if (!t) throw new Error('Trade no existe')
  if (t.status !== 'pending') throw new Error('Trade ya no está pendiente')
  if (t.receivingId !== acceptingId) throw new Error('No puedes aceptar un trade que no es para ti')

  // find the character's rarity
  const c = store.state.characterData[t.characterName]
  const rarity = c ? c.rarity : '5_star'

  if (!removeChar(t.offeringId, t.characterName)) {
    t.status = 'cancelled'
    await store.saveTrades()
    throw new Error(`El personaje ${t.characterName} ya no está disponible`)
  }

  addChar(t.receivingId, t.characterName, rarity)
  t.status = 'accepted'
  store.state.tradeHistory.push({ ...t, completedAt: new Date().toISOString() })
  await store.saveInventories()
  await store.saveTrades()
  await store.saveTradeHistory()
  logger.log(TAG, `Trade ${tradeId} accepted`)
  return t
}

async function cancelTrade(tradeId, userId) {
  const t = store.state.trades[tradeId]
  if (!t) throw new Error('Trade no existe')
  if (t.status !== 'pending') throw new Error('Trade ya no está pendiente')
  if (t.offeringId !== userId && t.receivingId !== userId) throw new Error('No participas en este trade')
  t.status = 'cancelled'
  await store.saveTrades()
  return t
}

function getTradesForPlayer(userId) {
  const sent = []
  const received = []
  for (const t of Object.values(store.state.trades)) {
    if (t.offeringId === userId) sent.push(t)
    if (t.receivingId === userId) received.push(t)
  }
  return { sent, received }
}

module.exports = { createTrade, acceptTrade, cancelTrade, getTradesForPlayer, removeChar }
