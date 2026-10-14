const { EventEmitter } = require('events')
const { AsyncLocalStorage } = require('async_hooks')

const bus = new EventEmitter()
bus.setMaxListeners(100)

// Cada emit corre dentro de un contexto con el origen del evento. Kick no manda `_source`,
// así que su contexto es undefined y `origin()` devuelve 'kick'.
// Sirve para que quien mande al chat sepa a qué plataforma responder sin que los triggers
// tengan que acordarse de `_source`: el contexto viaja solo por los awaits y las promesas.
const als = new AsyncLocalStorage()
const _emit = bus.emit
bus.emit = (ev, msg) => als.run({ source: msg && msg._source }, () => _emit.call(bus, ev, msg))

// 'youtube' | 'twitch' | 'kick'. Ojo: fuera de un evento (timers, startup) siempre da 'kick',
// que es el comportamiento de siempre.
function origin() {
  const ctx = als.getStore()
  if (ctx && (ctx.source === 'youtube' || ctx.source === 'twitch')) return ctx.source
  return 'kick'
}

module.exports = bus
module.exports.origin = origin