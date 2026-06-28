// ponytail: chat commands + reward redemption handling via event bus
const bus = require('../../lib/event-bus')
const logger = require('../../lib/logger')
const store = require('../data/store')
const engine = require('../gacha/engine')
const inventory = require('../gacha/inventory')
const trades = require('../trades/manager')
const chat = require('../chat/sender')
const wsPush = require('../../lib/ws-push')
const broadcast = (...args) => wsPush.broadcast(...args)

const TAG = 'CMDS'
const DAILY_KEYS = 10
const MOD_COMMANDS = new Set(['keys', 'addchar', 'editchar', 'delchar', 'givechar', 'takechar', 'resetpity', 'setprob', 'setstock', 'banner', 'seasonal', 'reload', 'cleardata', 'gachaconfig', 'charinfo', 'announce'])

function isMod(sender) {
  return sender?.identity?.badges?.some(b => b.type === 'moderator' || b.type === 'broadcaster') || false
}

// keep a Set of userId+date who claimed daily to avoid double-claim
// ponytail: Set in memory, resets on restart. Fine for now.
const dailyClaims = new Set()

function dailyKey(userId) {
  const today = new Date().toISOString().slice(0, 10)
  const key = `${userId}:${today}`
  if (dailyClaims.has(key)) return false
  dailyClaims.add(key)
  return true
}

// ─── global redemption queue (serializes pulls) ───
const redemptionQueue = []
let processingQueue = false

async function processRedemptionQueue() {
  if (processingQueue || redemptionQueue.length === 0) return
  processingQueue = true
  while (redemptionQueue.length > 0) {
    const { payload, userId, userName, rewardTitle } = redemptionQueue.shift()
    try {
      await handleRedemption(payload, userId, userName, rewardTitle)
    } catch (e) {
      logger.error(TAG, `Redemption queue error: ${e.message}`)
    }
  }
  processingQueue = false
}

async function handleRedemption(payload, userId, userName, rewardTitle) {
  let characters = []
  let pullType = 'single'

  if (rewardTitle.includes('multi') || rewardTitle.includes('x10')) {
    if (rewardTitle.includes('key') || rewardTitle.includes('llave')) {
      await inventory.spendKeys(userId, 10)
    }
    characters = await engine.performMultiPull(userId)
    pullType = 'multi'
  } else {
    if (rewardTitle.includes('key') || rewardTitle.includes('llave')) {
      await inventory.spendKeys(userId, 1)
    }
    const c = await engine.performPull(userId)
    if (c) characters = [c]
    pullType = 'single'
  }

  if (characters.length === 0) {
    reply(`@${userName} error al realizar la tirada.`)
    return
  }

  await inventory.addCharacters(userId, characters, userName)

  broadcast({
    event: 'gacha_wish',
    data: {
      pull_type: pullType,
      userId,
      userName,
      characters: pullType === 'multi' ? characters : undefined,
      character: pullType === 'single' ? characters[0] : undefined,
    },
  })

  const fives = characters.filter(c => c.rarity === '5_star')
  if (fives.length > 0) {
    reply(`🎉 @${userName} tiró un personaje 5⭐: ${fives.map(c => c.name).join(', ')}!`)
  }
}

// parse chat command: "!command arg1 arg2"
function parseCmd(text) {
  const m = text.toLowerCase().trim().match(/^!(\S+)(?:\s+(.+))?$/)
  if (!m) return null
  return { cmd: m[1], args: (m[2] || '').trim() }
}

// send a reply to chat
function reply(msg) { chat.send(msg) }

// ─── register event handlers ───

bus.on('chat.message.sent', async (data) => {
  const payload = data.payload
  const content = (payload.content || '').trim()
  const sender = payload.sender
  if (!content || !sender) return

  const userId = String(sender.id || sender.user_id || (sender.identity?.id ?? sender.username))
  const userName = sender.username || userId

  const parsed = parseCmd(content)
  if (!parsed) return

  const { cmd, args } = parsed

  try {
    switch (cmd) {
      case 'daily': {
        if (!dailyKey(userId)) { reply(`@${userName} ya reclamaste tus llaves hoy!`); return }
        await inventory.addKeys(userId, DAILY_KEYS, userName)
        reply(`@${userName} recibiste ${DAILY_KEYS} 🔑 llaves del daily!`)
        break
      }

      case 'inventario':
      case 'inventory': {
        const text = inventory.getInventoryText(userId)
        reply(`@${userName} ${text}`)
        break
      }

      case 'top': {
        const sorted = Object.entries(store.state.inventories)
          .sort((a, b) => (b[1].total_pulls || 0) - (a[1].total_pulls || 0))
          .slice(0, 3)
        if (sorted.length === 0) { reply(`@${userName} no hay tiradas aún.`); break }
        const lines = sorted.map(([id, u], i) => `${i + 1}. ${u.userName || id} - ${u.total_pulls || 0} tiradas`)
        const myRank = sorted.findIndex(([id]) => id === userId)
        const rankStr = myRank !== -1 ? ` | Tu puesto: #${myRank + 1}` : ''
        reply(`@${userName} 🏆 Top Coleccionistas: ${lines.join(' | ')}${rankStr}`)
        break
      }

      case 'pull':
      case 'single':
      case 'tirada': {
        if (inventory.getKeys(userId) < 1) { reply(`@${userName} no tienes 🔑 llaves. Usa !daily para reclamar.`); break }
        await inventory.spendKeys(userId, 1)
        const c = await engine.performPull(userId)
        if (!c) { reply(`@${userName} error al realizar la tirada.`); break }
        await inventory.addCharacters(userId, [c], userName)
        broadcast({ event: 'gacha_wish', data: { pull_type: 'single', userId, userName, character: c } })
        if (c.rarity === '5_star') {
          reply(`🎉 @${userName} tiró ${c.name} (5⭐)!`)
        } else {
          reply(`@${userName} obtuviste ${c.name} (${c.rarity.replace('_star', '⭐')})`)
        }
        break
      }

      case 'multi':
      case 'x10': {
        if (inventory.getKeys(userId) < 10) { reply(`@${userName} necesitas 10 🔑 llaves para multi-tirada.`); break }
        await inventory.spendKeys(userId, 10)
        const chars = await engine.performMultiPull(userId)
        if (chars.length === 0) { reply(`@${userName} error al realizar la tirada.`); break }
        await inventory.addCharacters(userId, chars, userName)
        broadcast({ event: 'gacha_wish', data: { pull_type: 'multi', userId, userName, characters: chars } })
        const fives = chars.filter(x => x.rarity === '5_star')
        const msg = fives.length > 0
          ? `🎉 @${userName} multi-tirada! Obtuviste ${fives.length} 5⭐: ${fives.map(x => x.name).join(', ')}`
          : `@${userName} multi-tirada completada. Revisa !inventario`
        reply(msg)
        break
      }

      case 'trade': {
        // !trade <charName> por <charName> @user
        const tradeMatch = args.match(/^(.+?)\s+por\s+(.+?)\s+@(\S+)$/i)
        if (!tradeMatch) { reply(`@${userName} formato: !trade <tu_personaje> por <su_personaje> @usuario`); break }
        const offeringChar = tradeMatch[1].trim()
        const receivingChar = tradeMatch[2].trim()
        const receivingName = tradeMatch[3].replace('@', '').trim()
        // find receiving user
        const recvEntry = Object.entries(store.state.inventories).find(([id, u]) =>
          u.userName?.toLowerCase() === receivingName.toLowerCase()
        )
        if (!recvEntry) { reply(`@${userName} usuario @${receivingName} no encontrado.`); break }
        const [recvId] = recvEntry
        try {
          const t = await trades.createTrade(userId, userName, recvId, receivingName, offeringChar)
          reply(`@${userName} trade creado! ID: ${t.id.slice(0, 8)} — ${offeringChar} por ${receivingChar} con @${receivingName}`)
          // also notify overlay
          broadcast({ event: 'trade_created', data: t })
        } catch (e) {
          reply(`@${userName} ${e.message}`)
        }
        break
      }

      case 'aceptar_trade':
      case 'accept_trade': {
        const tid = args.trim()
        if (!tid) { reply(`@${userName} uso: !aceptar_trade <ID>`); break }
        try {
          const t = await trades.acceptTrade(tid, userId)
          reply(`@${userName} trade ${t.id.slice(0, 8)} aceptado! Recibiste ${t.characterName}`)
          broadcast({ event: 'trade_updated', data: t })
        } catch (e) { reply(`@${userName} ${e.message}`) }
        break
      }

      case 'rechazar_trade':
      case 'reject_trade': {
        const tid2 = args.trim()
        if (!tid2) { reply(`@${userName} uso: !rechazar_trade <ID>`); break }
        try {
          const t = await trades.cancelTrade(tid2, userId)
          reply(`@${userName} trade ${t.id.slice(0, 8)} cancelado.`)
          broadcast({ event: 'trade_updated', data: t })
        } catch (e) { reply(`@${userName} ${e.message}`) }
        break
      }

      case 'keys': {
        if (!isMod(sender)) { reply(`@${userName} solo moderadores.`); break }
        const [target, amountStr] = args.split(/\s+/)
        const amount = parseInt(amountStr, 10)
        if (!target || isNaN(amount) || amount <= 0) { reply(`@${userName} uso: !keys @usuario <cantidad>`); break }
        const targetEntry = Object.entries(store.state.inventories).find(([id, u]) => u.userName?.toLowerCase() === target.replace('@', '').toLowerCase())
        if (!targetEntry) { reply(`@${userName} usuario @${target} no encontrado.`); break }
        const [targetId] = targetEntry
        await inventory.addKeys(targetId, amount, targetEntry[1].userName)
        reply(`@${userName} añadidas ${amount} llaves a @${targetEntry[1].userName || targetId}. Total: ${store.state.inventories[targetId].keys}`)
        break
      }

      case 'givechar': {
        if (!isMod(sender)) { reply(`@${userName} solo moderadores.`); break }
        const [target, ...charParts] = args.split(/\s+/)
        const charName = charParts.join(' ')
        if (!target || !charName) { reply(`@${userName} uso: !givechar @usuario <personaje>`); break }
        const targetEntry = Object.entries(store.state.inventories).find(([id, u]) => u.userName?.toLowerCase() === target.replace('@', '').toLowerCase())
        if (!targetEntry) { reply(`@${userName} usuario @${target} no encontrado.`); break }
        const [targetId] = targetEntry
        const char = store.state.characterData[charName]
        if (!char) { reply(`@${userName} personaje "${charName}" no existe.`); break }
        await inventory.addCharacters(targetId, [{ ...char, rarity: char.rarity }], targetEntry[1].userName)
        reply(`@${userName} ${charName} (${char.rarity}) dado a @${targetEntry[1].userName || targetId}`)
        break
      }

      case 'takechar': {
        if (!isMod(sender)) { reply(`@${userName} solo moderadores.`); break }
        const [target, ...charParts2] = args.split(/\s+/)
        const charName2 = charParts2.join(' ')
        if (!target || !charName2) { reply(`@${userName} uso: !takechar @usuario <personaje>`); break }
        const targetEntry2 = Object.entries(store.state.inventories).find(([id, u]) => u.userName?.toLowerCase() === target.replace('@', '').toLowerCase())
        if (!targetEntry2) { reply(`@${userName} usuario @${target} no encontrado.`); break }
        const [targetId2] = targetEntry2
        const removed = trades.removeChar ? trades.removeChar(targetId2, charName2) : false
        if (!removed) { reply(`@${userName} @${target} no tiene ${charName2}.`); break }
        await store.saveInventories()
        reply(`@${userName} ${charName2} quitado a @${targetEntry2[1].userName || targetId2}`)
        break
      }

      case 'resetpity': {
        if (!isMod(sender)) { reply(`@${userName} solo moderadores.`); break }
        const [target, pityType] = args.split(/\s+/)
        const targetEntry3 = target ? Object.entries(store.state.inventories).find(([id, u]) => u.userName?.toLowerCase() === target.replace('@', '').toLowerCase()) : null
        if (target) {
          if (!targetEntry3) { reply(`@${userName} usuario @${target} no encontrado.`); break }
          const [targetId3] = targetEntry3
          const p = store.getPity(targetId3)
          if (pityType === '4') p['4_star'] = 0
          else if (pityType === '5') p['5_star'] = 0
          else { p['4_star'] = 0; p['5_star'] = 0 }
          await store.saveInventories()
          reply(`@${userName} pity reseteado para @${targetEntry3[1].userName || targetId3}`)
        } else {
          const p = store.getPity(userId)
          if (pityType === '4') p['4_star'] = 0
          else if (pityType === '5') p['5_star'] = 0
          else { p['4_star'] = 0; p['5_star'] = 0 }
          await store.saveInventories()
          reply(`@${userName} tu pity reseteado.`)
        }
        break
      }

      case 'setprob': {
        if (!isMod(sender)) { reply(`@${userName} solo moderadores.`); break }
        const [rarity, valStr] = args.split(/\s+/)
        const val = parseFloat(valStr)
        if (!rarity || isNaN(val)) { reply(`@${userName} uso: !setprob <rareza> <valor>`); break }
        const cfg = store.state.gachaConfig
        if (!cfg.gacha_rules) cfg.gacha_rules = {}
        if (!cfg.gacha_rules.rarity_probabilities) cfg.gacha_rules.rarity_probabilities = {}
        cfg.gacha_rules.rarity_probabilities[rarity] = val
        await store.saveGachaConfig()
        reply(`@${userName} prob ${rarity} = ${val}`)
        break
      }

      case 'setstock': {
        if (!isMod(sender)) { reply(`@${userName} solo moderadores.`); break }
        const [charName3, stockStr] = args.split(/\s+/)
        const stock = parseInt(stockStr, 10)
        if (!charName3 || isNaN(stock)) { reply(`@${userName} uso: !setstock <personaje> <stock>`); break }
        if (!store.state.characterData[charName3]) { reply(`@${userName} personaje no existe.`); break }
        if (!store.state.gachaConfig.character_stocks) store.state.gachaConfig.character_stocks = {}
        store.state.gachaConfig.character_stocks[charName3] = stock
        store.state.characterData[charName3].stock = stock
        await store.saveGachaConfig()
        const sc = store.state.seasonalCharactersConfig.characters
        const idx = sc.findIndex(c => c.name === charName3)
        if (idx !== -1) { sc[idx].stock = stock; await store.saveSeasonalChars() }
        reply(`@${userName} stock ${charName3} = ${stock}`)
        break
      }

      case 'banner': {
        if (!isMod(sender)) { reply(`@${userName} solo moderadores.`); break }
        const [bannerType] = args.split(/\s+/)
        if (!['standard', 'seasonal'].includes(bannerType)) { reply(`@${userName} uso: !banner <standard|seasonal>`); break }
        const b = store.state[bannerType === 'standard' ? 'standardBanner' : 'seasonalBanner']
        const lines = Object.entries(b).map(([r, arr]) => `${r}: ${arr.length} (${arr.join(', ')})`)
        reply(`@${userName} ${bannerType} banner: ${lines.join(' | ')}`)
        break
      }

      case 'seasonal': {
        if (!isMod(sender)) { reply(`@${userName} solo moderadores.`); break }
        const [action, ...rest] = args.split(/\s+/)
        if (action === 'add' && rest.length >= 2) {
          const charName4 = rest[0]
          const stock4 = parseInt(rest[1], 10)
          if (!store.state.characterData[charName4]) { reply(`@${userName} personaje no existe.`); break }
          const sc = store.state.seasonalCharactersConfig.characters
          if (sc.find(c => c.name === charName4)) { reply(`@${userName} ya está en seasonal.`); break }
          sc.push({ name: charName4, stock: stock4 })
          if (!store.state.gachaConfig.character_stocks) store.state.gachaConfig.character_stocks = {}
          store.state.gachaConfig.character_stocks[charName4] = stock4
          if (!store.state.seasonalBanner['5_star']) store.state.seasonalBanner['5_star'] = []
          if (!store.state.seasonalBanner['5_star'].includes(charName4)) store.state.seasonalBanner['5_star'].push(charName4)
          await store.saveSeasonalChars()
          await store.saveGachaConfig()
          await store.saveBanner('seasonal')
          reply(`@${userName} ${charName4} añadido a seasonal (stock ${stock4})`)
        } else if (action === 'remove' && rest[0]) {
          const charName5 = rest[0]
          store.state.seasonalCharactersConfig.characters = store.state.seasonalCharactersConfig.characters.filter(c => c.name !== charName5)
          delete store.state.gachaConfig.character_stocks?.[charName5]
          store.state.seasonalBanner['5_star'] = (store.state.seasonalBanner['5_star'] || []).filter(c => c !== charName5)
          store.state.seasonalBanner['6_star'] = (store.state.seasonalBanner['6_star'] || []).filter(c => c !== charName5)
          await store.saveSeasonalChars()
          await store.saveGachaConfig()
          await store.saveBanner('seasonal')
          reply(`@${userName} ${charName5} quitado de seasonal`)
        } else {
          reply(`@${userName} uso: !seasonal add <personaje> <stock> | !seasonal remove <personaje>`)
        }
        break
      }

      case 'reload': {
        if (!isMod(sender)) { reply(`@${userName} solo moderadores.`); break }
        await store.init()
        reply(`@${userName} datos recargados desde disco.`)
        break
      }

      case 'cleardata': {
        if (!isMod(sender)) { reply(`@${userName} solo moderadores.`); break }
        if (args.trim() !== 'confirm') { reply(`@${userName} uso: !cleardata confirm (ELIMINA TODO)`); break }
        store.state.inventories = {}
        store.state.trades = {}
        store.state.tradeHistory = []
        await store.saveInventories()
        await store.saveTrades()
        await store.saveTradeHistory()
        reply(`@${userName} TODOS LOS DATOS BORRADOS.`)
        break
      }

      case 'gachaconfig': {
        const cfg = store.state.gachaConfig.gacha_rules || {}
        const probs = cfg.rarity_probabilities || {}
        const lines = Object.entries(probs).map(([k, v]) => `${k}: ${(v * 100).toFixed(2)}%`)
        reply(`@${userName} Gacha Config: ${lines.join(' | ')}`)
        break
      }

      case 'charinfo': {
        const name = args.trim()
        if (!name) { reply(`@${userName} uso: !charinfo <personaje>`); break }
        const c = store.state.characterData[name]
        if (!c) { reply(`@${userName} personaje no encontrado.`); break }
        const banner = store.findBannerForChar(name) || 'unknown'
        reply(`@${userName} ${c.name} | ${c.rarity} | ${banner} | stock: ${c.stock ?? '∞'} | ${c.description?.slice(0, 80)}`)
        break
      }

      case 'announce': {
        if (!isMod(sender)) { reply(`@${userName} solo moderadores.`); break }
        if (!args.trim()) { reply(`@${userName} uso: !announce <mensaje>`); break }
        reply(args.trim())
        break
      }

      default:
        // not a gacha command, ignore
        break
    }
  } catch (e) {
    logger.error(TAG, `Error handling cmd ${cmd}: ${e.message}`)
  }
})
// ponytail: channel-point redemptions disabled — pulls only via chat commands (!pull/!multi/!tirada/!x10)
// bus.on('channel.reward.redemption.updated', (data) => {
//   const payload = data.payload
//   const reward = payload.reward
//   const redeemer = payload.redeemer
//   if (!reward || !redeemer) return
//
//   const userId = String(redeemer.id || redeemer.user_id || redeemer.username)
//   const userName = redeemer.username || userId
//   const rewardTitle = (reward.title || '').toLowerCase()
//
//   logger.log(TAG, `Redemption queued: ${userName} -> ${rewardTitle}`)
//
//   redemptionQueue.push({ payload, userId, userName, rewardTitle })
//   processRedemptionQueue()
// })

// ─── skeleton handlers for remaining known events ───
bus.on('channel.followed', (data) => {
  logger.log(TAG, `Follow: ${data.payload?.followed?.username || 'unknown'}`)
})
bus.on('channel.subscription.new', (data) => {
  logger.log(TAG, `New sub: ${data.payload?.subscriber?.username || 'unknown'} (${data.payload?.subscriber_tier || '?'})`)
})
bus.on('channel.subscription.renewal', (data) => {
  logger.log(TAG, `Sub renewal: ${data.payload?.subscriber?.username || 'unknown'}`)
})
bus.on('channel.subscription.gifts', (data) => {
  logger.log(TAG, `Sub gifts: ${data.payload?.gifter?.username || 'unknown'} x${data.payload?.amount || '?'}`)
})
bus.on('livestream.status.updated', (data) => {
  logger.log(TAG, `Livestream: ${data.payload?.livestream?.is_live ? 'ONLINE' : 'OFFLINE'}`)
})
bus.on('moderation.banned', (data) => {
  logger.log(TAG, `Ban: ${data.payload?.user?.username || 'unknown'}`)
})
bus.on('kicks.gifted', (data) => {
  logger.log(TAG, `Kicks gifted by ${data.payload?.gifter?.username || 'unknown'}`)
})

logger.log(TAG, 'All event handlers registered')
