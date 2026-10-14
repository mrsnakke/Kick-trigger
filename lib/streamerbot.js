// Core compartido del puente Streamer.bot <-> Event Bus.
//
// Streamer.bot expone un WebSocket Server (localhost:8080). Acá nos conectamos COMO CLIENTE
// y él empuja los eventos de cada plataforma (source "YouTube", "Twitch", ...). El motor es
// el mismo para todas: handshake, auth, GetEvents, Subscribe, dedup, envío y SSE. Lo único
// que cambia por plataforma es a qué eventos suscribirse, cómo se normalizan a nombres/shape
// de Kick y el nombre del request SendMessage.
//
// createBridge(config) devuelve { init, stop, normalize, publish, send, EVENT_TYPES } — la
// misma API que tenía el módulo de YouTube, para que sus triggers y tests no cambien.
const WebSocket = require('ws')
const crypto = require('crypto')
const sse = require('../modules/sse')

const RECONNECT_MS = 5000
const DEDUP_MS = 10 * 60 * 1000
const SEND_TIMEOUT_MS = 10000

function createBridge({
  platform,       // 'youtube' | 'twitch' -> SendMessage.platform y tag del SSE
  source,         // 'YouTube' | 'Twitch' -> msg.event.source al recibir
  normalize,      // (type, data) => { event, id, payload } | null
  eventTypes,     // lista de eventos conocidos (para exportar y loguear)
  allEvents = false, // true = suscribirse a TODOS los que GetEvents devuelva
  isBotEcho = () => false,
  maxLen = 200,   // límite de caracteres del chat de la plataforma
}) {
  // Se leen en cada creación del bridge (no al cargar el módulo) para que los tests puedan
  // setear host/puerto/password por env antes de requerir el índice de la plataforma.
  const HOST = process.env.STREAMERBOT_WS_HOST || '127.0.0.1'
  const PORT = process.env.STREAMERBOT_WS_PORT || 8080
  const PASSWORD = process.env.STREAMERBOT_WS_PASSWORD || ''
  const TAG = `[${platform.toUpperCase()}]`
  const statusType = `${platform}:status`
  const seen = new Set()
  let ws = null
  let stopped = false
  // Resolver el bus al crear el bridge (no al cargar el módulo) permite que los tests que
  // limpian el cache de require entre plataformas obtengan la instancia correcta.
  const eventBus = require('./event-bus')

  // -- Publicación en el bus --

  function publish(type, data) {
    if (data && data.isTest) return null
    // El bot se responde a sí mismo si dejamos pasar sus propios mensajes al bus.
    if (isBotEcho(data)) return null
    const r = normalize(type, data || {})
    if (!r) {
      console.warn(`${TAG} Evento sin mapear: ${type}`)
      return null
    }
    if (r.id) {
      if (seen.has(r.id)) return null
      seen.add(r.id)
      setTimeout(() => seen.delete(r.id), DEDUP_MS)
    }
    const envelope = { payload: r.payload, ts: new Date().toISOString(), _source: platform }
    eventBus.emit(r.event, envelope)
    // El chat widget escucha el SSE, no el bus, así que publicamos con el mismo shape que Kick.
    sse.broadcast({ type: 'event', eventType: r.event, ...envelope })
    return r
  }

  // -- Cliente WebSocket --

  function status(connected, extra) {
    sse.broadcast({ _source: platform, type: statusType, connected, host: `${HOST}:${PORT}`, ...extra })
  }

  function authenticate(sock, hello) {
    if (!PASSWORD || !hello.authentication) return false
    const { salt, challenge } = hello.authentication
    const secret = crypto.createHash('sha256').update(PASSWORD + salt, 'utf8').digest('base64')
    sock.send(JSON.stringify({
      request: 'Authenticate',
      id: 'auth-1',
      authentication: crypto.createHash('sha256').update(secret + challenge, 'utf8').digest('base64'),
    }))
    return true
  }

  // Streamer.bot no manda eventos hasta que el cliente se suscribe ("Subscriptions 0" en su UI).
  function requestEvents(sock) {
    sock.send(JSON.stringify({ request: 'GetEvents', id: 'ev' }))
  }

  function subscribe(sock, available) {
    const key = Object.keys(available || {}).find((k) => k.toLowerCase() === platform)
    const list = (key ? available[key] : []) || []
    const wanted = allEvents ? list.slice() : (eventTypes || []).filter((t) => list.includes(t))
    if (!wanted.length) {
      console.error(`${TAG} Esta instancia de Streamer.bot no expone eventos de ${platform} compatibles`)
      return
    }
    sock.send(JSON.stringify({ request: 'Subscribe', id: 'sub', events: { [key]: wanted } }))
    if (allEvents) {
      console.log(`${TAG} Suscrito a ${wanted.length} eventos de ${platform}`)
    } else {
      const skipped = (eventTypes || []).filter((t) => !list.includes(t))
      console.log(`${TAG} Suscrito a ${wanted.length}/${eventTypes.length} eventos de ${platform}: ${wanted.join(', ')}`)
      if (skipped.length) console.log(`${TAG} Tu versión de Streamer.bot no tiene: ${skipped.join(', ')}`)
    }
  }

  // -- Envío de mensajes (SendMessage) --

  const pending = new Map()
  let sendSeq = 0

  function send(content) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Streamer.bot no está conectado'))
    if (!PASSWORD) return Promise.reject(new Error('Falta STREAMERBOT_WS_PASSWORD: Streamer.bot exige autenticación para enviar'))
    const text = String(content || '').trim()
    if (!text) return Promise.reject(new Error('Mensaje vacío'))
    if (text.length > maxLen) return Promise.reject(new Error(`${platform} acepta ${maxLen} caracteres, van ${text.length}`))

    const id = `sm-${++sendSeq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Streamer.bot no respondió el SendMessage'))
      }, SEND_TIMEOUT_MS)
      pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v) }, reject: (e) => { clearTimeout(timer); reject(e) } })
      // `bot: true` = usar la cuenta Bot Account de Streamer.bot, no el canal del broadcaster.
      ws.send(JSON.stringify({ request: 'SendMessage', id, platform, bot: true, message: text }))
    })
  }

  function connect() {
    if (stopped) return
    const sock = new WebSocket(`ws://${HOST}:${PORT}`)
    ws = sock

    sock.on('open', () => {
      console.log(`${TAG} Conectado a Streamer.bot en ws://${HOST}:${PORT}`)
      status(true, { state: 'open' })
    })

    sock.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (msg.request === 'Hello') {
        if (!authenticate(sock, msg)) requestEvents(sock)
        return
      }
      if (msg.id === 'auth-1') {
        if (msg.status === 'ok') requestEvents(sock)
        else console.error(`${TAG} Falló la autenticación con Streamer.bot:`, msg.error || 'status error')
        return
      }
      if (msg.id === 'ev') return subscribe(sock, msg.events)
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.status === 'ok') p.resolve(msg)
        else p.reject(new Error(msg.error || `Streamer.bot rechazó el request (${msg.status})`))
        return
      }
      if (msg.id === 'sub' && msg.status !== 'ok') {
        console.error(`${TAG} Streamer.bot rechazó la suscripción:`, msg.error || 'status error')
        return
      }
      if (!msg.event || msg.event.source !== source) return
      try {
        publish(msg.event.type, msg.data)
      } catch (err) {
        console.error(`${TAG} Error normalizando:`, err.message)
      }
    })

    sock.on('error', (err) => {
      if (err.code !== 'ECONNREFUSED') console.error(`${TAG} Error WS:`, err.message)
    })

    sock.on('close', () => {
      status(false, { state: 'closed' })
      if (stopped) return
      // ponytail: 5s fijos sin backoff exponencial; Streamer.bot reinicia pocas veces
      console.log(`${TAG} Desconectado de Streamer.bot; reintento en 5s`)
      for (const p of pending.values()) {
        try { p.reject(new Error('Conexión cerrada')) } catch {}
      }
      pending.clear()
      setTimeout(connect, RECONNECT_MS)
    })
  }

  function init() {
    stopped = false
    connect()
    console.log(`${TAG} Módulo cargado ✅`)
  }

  function stop() {
    stopped = true
    if (ws) ws.close()
    ws = null
  }

  return { init, stop, normalize, publish, send, EVENT_TYPES: eventTypes || Object.keys(normalize) }
}

// Corta los emotes NATIVOS del texto (para que TTS2 no los lea en voz alta).
//
// Usa las posiciones exactas que Streamer.bot manda en `emotes` (startIndex/endIndex en YouTube,
// StartIndex/EndIndex en Twitch). El rango se auto-valida: si `text.slice(s, e)` coincide con el
// nombre, se corta ese span; si no (offsets raros, byte vs char, endIndex inclusivo), cae a borrar
// el token completo. Nunca se reemplaza por subcadena: eso borraría adentro de palabras normales.
//
// Los emotes de TERCEROS (7TV/BTTV/FFZ) NO se tocan: Kick tampoco los etiqueta, así que una
// palabra real que además es emote (p. ej. "si" o "no") se conserva, igual que en Kick. Se
// detectan por `Type`/`Source` ("7TVChannel", ...) o, en YouTube, porque vienen sin `:`.
const THIRD_PARTY = /7tv|bttv|ffz|betterttv|frankerfacez/i

function isThirdPartyEmote(e, thirdPartyIfBare) {
  const provider = e.Type ?? e.type ?? e.Source ?? e.source
  if (provider) return THIRD_PARTY.test(String(provider))
  if (!thirdPartyIfBare) return false
  return !String(e.name || e.Name || '').startsWith(':')
}

function stripEmotes(text, emotes, opts = {}) {
  if (!text || !emotes || !emotes.length) return text || ''
  const spans = []
  const fallback = []
  for (const e of emotes) {
    const name = e && (e.name || e.Name)
    if (!name) continue
    if (isThirdPartyEmote(e, opts.thirdPartyIfBare)) continue
    const s = e.startIndex ?? e.StartIndex
    const end = e.endIndex ?? e.EndIndex
    let span = null
    if (Number.isInteger(s) && Number.isInteger(end) && end > s) {
      if (text.slice(s, end) === name) span = [s, end]
      else if (text.slice(s, end + 1) === name) span = [s, end + 1]
    }
    if (span) spans.push(span)
    else fallback.push(name)
  }
  let out = text
  // De atrás hacia adelante para que los offsets no se corran entre sí.
  for (const [s, end] of spans.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + ' ' + out.slice(end)
  if (fallback.length) {
    const names = new Set(fallback)
    out = out.split(/\s+/).filter((tok) => !names.has(tok)).join(' ')
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim()
}

module.exports = { createBridge, stripEmotes }
