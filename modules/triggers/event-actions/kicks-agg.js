// Agrupa regalos de KICKS/bits por usuario para no contestar 1 vez por cada bit.
// Puro y sin dependencias para poder testearlo sin arrancar el módulo.
function createKicksAggregator({ windowMs, minAmount, cooldownMs, onFlush, now = Date.now }) {
  const buffers = new Map()
  const lastFlush = new Map()

  function push(username, amount, extra) {
    if (!username) return
    if (!(amount >= minAmount)) return // umbral por gift: el spam de 1 bit no entra
    const b = buffers.get(username) || { total: 0, count: 0, timer: null, extra: {} }
    b.total += amount
    b.count += 1
    b.extra = extra || b.extra
    if (!b.timer) b.timer = setTimeout(() => flush(username), windowMs) // ventana fija desde el primer gift
    buffers.set(username, b)
  }

  function flush(username) {
    const b = buffers.get(username)
    if (!b) return
    buffers.delete(username)
    if (b.timer) clearTimeout(b.timer)
    if (lastFlush.has(username) && now() - lastFlush.get(username) < cooldownMs) return
    lastFlush.set(username, now())
    onFlush({ username, total: b.total, count: b.count, ...b.extra })
  }

  function reset() {
    for (const b of buffers.values()) if (b.timer) clearTimeout(b.timer)
    buffers.clear()
    lastFlush.clear()
  }

  return { push, flush, reset, _buffers: buffers }
}

module.exports = { createKicksAggregator }
