// Regression del namespace de jugadores. El bug era `Number(kickId)` en playerIdOf:
// los channel ids de YouTube son strings (UCI9-…), no castean, y TODOS caían en un único
// `kick_NaN` — el peleador de YouTube pisaba la ficha de todos los demás.
// Correr: node server/player-id.test.mjs
import assert from 'node:assert';
import { playerIdOf, GRIM_PLAYER_ID } from './kick.mjs';

// Back-compat: un id de Kick sigue dando exactamente la misma llave de siempre.
assert.equal(playerIdOf(63964178), 'kick_63964178');
assert.equal(playerIdOf(65967692), 'kick_65967692');
assert.equal(GRIM_PLAYER_ID, 'kick_65967692');

// YouTube: id crudo, sin castear, con su propio namespace.
assert.equal(playerIdOf('UCI9-KG2xoyh5z-g41IL2jqf', 'yt'), 'yt_UCI9-KG2xoyh5z-g41IL2jqf');

// El prefijo por defecto sigue siendo kick, así que un body sin `ns` no cambia de comportamiento.
assert.equal(playerIdOf('UCI9-KG2xoyh5z-g41IL2jqf'), 'kick_UCI9-KG2xoyh5z-g41IL2jqf');

// Ningún id puede terminar en NaN, y dos plataformas nunca comparten llave.
const kickId = playerIdOf(1);
const ytId = playerIdOf('UCI1', 'yt');
assert.ok(!kickId.includes('NaN') && !ytId.includes('NaN'));
assert.notEqual(kickId, ytId);

console.log('✅ player-id: todos los checks pasaron');
