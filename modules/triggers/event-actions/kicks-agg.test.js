// Checks del agregador de KICKS. Sin framework: `node modules/triggers/event-actions/kicks-agg.test.js`
const assert = require('assert')
const { createKicksAggregator } = require('./kicks-agg')

const base = { windowMs: 100000, minAmount: 5, cooldownMs: 100000, now: () => 0 }

// -- Spam de 1 bit: por debajo del umbral, no entra al buffer --
{
  const out = []
  const agg = createKicksAggregator({ ...base, onFlush: (x) => out.push(x) })
  for (let i = 0; i < 100; i++) agg.push('spammer', 1)
  assert.equal(agg._buffers.size, 0, '100x1 bit no debe crear buffer')
  agg.flush('spammer')
  assert.equal(out.length, 0, 'no debe avisar la IA')
  agg.reset()
}

// -- Ráfaga válida: se agrupa en un solo aviso con total y count --
{
  const out = []
  const agg = createKicksAggregator({ ...base, onFlush: (x) => out.push(x) })
  agg.push('fan', 5)
  agg.push('fan', 5)
  agg.push('fan', 5)
  agg.push('fan', 5)
  agg.push('fan', 5)
  assert.equal(agg._buffers.get('fan').total, 25)
  assert.equal(agg._buffers.get('fan').count, 5)
  agg.flush('fan')
  assert.equal(out.length, 1, 'un solo aviso para toda la ráfaga')
  assert.deepEqual(out[0], { username: 'fan', total: 25, count: 5 })
  agg.reset()
}

// -- Cooldown por usuario: un segundo flush dentro de la ventana no avisa --
{
  const out = []
  let t = 0
  const agg = createKicksAggregator({ ...base, cooldownMs: 60000, now: () => t, onFlush: (x) => out.push(x) })
  agg.push('fan', 50)
  agg.flush('fan')
  t = 30000
  agg.push('fan', 50)
  agg.flush('fan')
  assert.equal(out.length, 1, 'el segundo aviso cae dentro del cooldown')
  t = 120000
  agg.push('fan', 50)
  agg.flush('fan')
  assert.equal(out.length, 2, 'pasado el cooldown sí avisa')
  agg.reset()
}

// -- Ventana fija: el timer se abre una sola vez por ráfaga --
{
  const out = []
  const agg = createKicksAggregator({ ...base, onFlush: (x) => out.push(x) })
  agg.push('fan', 5)
  const timer = agg._buffers.get('fan').timer
  agg.push('fan', 5)
  assert.equal(agg._buffers.get('fan').timer, timer, 'la ventana no se reinicia con cada gift')
  agg.reset()
}

console.log('OK - kicks-agg: checks pasaron')
