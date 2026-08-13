// ponytail: runnable self-check for pity thresholds. Run: node pity.check.js
const assert = require('assert')
const store = require('./modules/data/store')
const { selectRarity } = require('./modules/gacha/engine')

store.state.pityData = { pity_thresholds: { '4_star': { soft_pity: 8, hard_pity: 10 }, '5_star': { soft_pity: 70, hard_pity: 90 } } }
store.state.gachaConfig = { gacha_rules: { rarity_probabilities: { '5_star': 0.006, '4_star': 0.05, '3_star': 0.944 } } }

const origRandom = Math.random
Math.random = () => 0.9999
try {
  // guarantee at latest on pull hard_pity (counter is hard_pity - 1)
  assert.strictEqual(selectRarity({ '4_star': 0, '5_star': 89 }), '5_star') // pull 90 -> 5*
  assert.strictEqual(selectRarity({ '4_star': 9, '5_star': 0 }), '4_star')   // pull 10 -> 4*
  // one before the limit: not guaranteed, random returns 3*
  assert.strictEqual(selectRarity({ '4_star': 0, '5_star': 88 }), '3_star') // pull 89 -> not guaranteed
  assert.strictEqual(selectRarity({ '4_star': 8, '5_star': 0 }), '3_star')  // pull 9 -> not guaranteed
  console.log('PITY CHECK OK')
} finally {
  Math.random = origRandom
}
