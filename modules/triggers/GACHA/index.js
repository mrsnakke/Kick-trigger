// ponytail: GACHA module entry point — hooks into main backend's event bus, Express, and HTTP server
const express = require('express')
const { Router } = require('express')
const path = require('path')
const config = require('./lib/config')
const logger = require('./lib/logger')
const wsPush = require('./lib/ws-push')
const store = require('./modules/data/store')
const sse = require('../../sse')

const TAG = 'GACHA'
const router = Router()
const overlayRouter = Router()
let initialized = false

function initWs(server) {
  wsPush.init(server)
}

// ─── broadcast gacha events to dashboard via SSE ───
function notifyDashboard(type, data) {
  sse.broadcast({ _source: 'gacha', type, data, ts: new Date().toISOString() })
}

// ─── load overlay & admin routes ───
const overlayRoutes = require('./routes/overlay')
const adminRoutes = require('./routes/admin')

// overlay routes under /gacha/api
overlayRouter.use(overlayRoutes)

// admin routes under /gacha/admin
router.use('/admin', adminRoutes)

// ─── static web files (overlays for OBS) ───
const webDir = path.resolve(__dirname, 'web')
router.use(express.static(webDir))

// ─── API: gacha stats ───
router.get('/api/stats', (req, res) => {
  const inv = store.state.inventories
  const users = Object.keys(inv)
  const totalPulls = users.reduce((s, uid) => s + (inv[uid].total_pulls || 0), 0)
  const totalKeys = users.reduce((s, uid) => s + (inv[uid].keys || 0), 0)
  const totalChars = users.reduce((s, uid) => {
    let c = 0
    for (const r of ['3_star', '4_star', '5_star', '6_star']) c += (inv[uid][r] || []).length
    return s + c
  }, 0)
  res.json({ users: users.length, totalPulls, totalKeys, totalChars })
})

// ─── API: commands list ───
router.get('/api/commands', (req, res) => {
  res.json([
    { cmd: '!daily', desc: 'Reclama 10 llaves diarias', perm: 'user', mod: 'gacha' },
    { cmd: '!pull / !single / !tirada', desc: 'Gasta 1 llave para tirar un personaje', perm: 'user', mod: 'gacha' },
    { cmd: '!multi / !x10', desc: 'Gasta 10 llaves para 10 tiradas', perm: 'user', mod: 'gacha' },
    { cmd: '!inventario / !inventory', desc: 'Muestra llaves, tiradas, pity y personajes', perm: 'user', mod: 'gacha' },
    { cmd: '!top', desc: 'Top 3 coleccionistas con más tiradas', perm: 'user', mod: 'gacha' },
    { cmd: '!trade <tu_personaje> por <su_personaje> @usuario', desc: 'Crea intercambio de 5★', perm: 'user', mod: 'gacha' },
    { cmd: '!aceptar_trade / !accept_trade <ID>', desc: 'Acepta un trade (debes ser destinatario)', perm: 'user', mod: 'gacha' },
    { cmd: '!rechazar_trade / !reject_trade <ID>', desc: 'Cancela/rechaza un trade', perm: 'user', mod: 'gacha' },
    { cmd: '!keys @usuario <cantidad>', desc: 'Añade llaves a un usuario', perm: 'mod', mod: 'gacha' },
    { cmd: '!givechar @usuario <personaje>', desc: 'Entrega personaje al inventario', perm: 'mod', mod: 'gacha' },
    { cmd: '!takechar @usuario <personaje>', desc: 'Quita personaje del inventario', perm: 'mod', mod: 'gacha' },
    { cmd: '!resetpity [@usuario] [4|5]', desc: 'Resetea pity 4★ y/o 5★', perm: 'mod', mod: 'gacha' },
    { cmd: '!setprob <rareza> <valor>', desc: 'Ajusta probabilidad (ej: 5_star 0.006)', perm: 'mod', mod: 'gacha' },
    { cmd: '!setstock <personaje> <stock>', desc: 'Cambia stock de personaje 5★/6★', perm: 'mod', mod: 'gacha' },
    { cmd: '!banner <standard|seasonal>', desc: 'Lista personajes del banner', perm: 'mod', mod: 'gacha' },
    { cmd: '!seasonal add <personaje> <stock>', desc: 'Añade personaje al banner seasonal', perm: 'mod', mod: 'gacha' },
    { cmd: '!seasonal remove <personaje>', desc: 'Quita personaje del banner seasonal', perm: 'mod', mod: 'gacha' },
    { cmd: '!reload', desc: 'Recarga datos desde JSON', perm: 'mod', mod: 'gacha' },
    { cmd: '!cleardata confirm', desc: 'BORRA todos los datos (requiere confirm)', perm: 'mod', mod: 'gacha' },
    { cmd: '!gachaconfig', desc: 'Muestra probabilidades actuales', perm: 'mod', mod: 'gacha' },
    { cmd: '!charinfo <personaje>', desc: 'Info del personaje: rareza, banner, stock', perm: 'mod', mod: 'gacha' },
    { cmd: '!announce <mensaje>', desc: 'Envía mensaje al chat como bot', perm: 'mod', mod: 'gacha' },
  ])
})

// ─── API: overlay routes ───
router.use('/api', overlayRouter)

// ─── init: load data & register event handlers ───
async function init() {
  if (initialized) return
  initialized = true

  await store.init()
  logger.log(TAG, 'Data loaded')

  // register event handlers (commands.js hooks into event bus directly)
  require('./modules/events/commands')

  // forward gacha events to dashboard SSE
  const wsPushBroadcast = wsPush.broadcast
  const origBroadcast = wsPushBroadcast
  wsPush.broadcast = (data) => {
    origBroadcast(data)
    if (data.event === 'gacha_wish') {
      notifyDashboard('gacha_wish', data.data)
    } else if (data.event === 'trade_created' || data.event === 'trade_updated') {
      notifyDashboard(data.event, data.data)
    }
  }

  logger.log(TAG, 'Module initialized')
}

module.exports = { init, initWs, router, webDir, overlayRouter }