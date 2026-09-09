import assert from 'assert';
import {
  applyMatchResult,
  ensureGrim,
  grimAdminStats,
  expForLevel,
  WIN_EXP,
  LOSE_EXP,
  SESSION_EXP_CAP,
  sessionExp,
  GRIM_PLAYER_ID,
} from './kick.mjs';

function player(name, over = {}) {
  return {
    kick_id: 1,
    username: name,
    stats: {
      level: 0, exp: 0, expToNextLevel: 50, baseMaxHp: 200, attackPower: 1,
      defense: 0, evasion: 0, accuracy: 0.94, speed: 1, critChance: 0,
      attributePoints: 0,
      allocated: { hp: 0, attack: 0, defense: 0, evasion: 0, accuracy: 0, speed: 0, crit: 0 },
      wins: 0, losses: 0,
      ...over,
    },
  };
}

// config con match p1='a', p2='b'. recordStart = fotografía de W/L al INICIAR el duelo.
function makeMatch(a, b, recordStart = { p1: { w: 0, l: 0 }, p2: { w: 0, l: 0 } }) {
  return {
    players: { a, b },
    match: {
      p1: 'a', p2: 'b', active: true,
      expEligible: { p1: true, p2: true },
      recordStart,
    },
  };
}

// El W/L del MATCH (no por ronda): a gana 1 ronda interna, b gana el duelo por más rounds.
// EXP va por match: campeón +WIN_EXP, derrotado +LOSE_EXP (aunque haya ganado rondas sueltas).
{
  sessionExp.clear();
  const a = player('a'), b = player('b', { level: 99, expToNextLevel: expForLevel(99) });
  a.stats.wins = 1; a.stats.losses = 2; // rondas internas DURANTE el duelo
  b.stats.wins = 2; b.stats.losses = 1;
  const cfg = makeMatch(a, b);
  applyMatchResult(cfg);
  assert.equal(a.stats.exp, LOSE_EXP, 'perdedor → +LOSE_EXP por match');
  assert.equal(b.stats.exp, WIN_EXP, 'campeón → +WIN_EXP por match');
  // El W/L se REESCRIBE a recordStart + resultado del match: las rondas internas no cuentan.
  assert.equal(a.stats.wins, 0, 'a perdió el match → sin win');
  assert.equal(a.stats.losses, 1);
  assert.equal(b.stats.wins, 1, 'b ganó el match → +1 win');
  assert.equal(b.stats.losses, 0);
  assert.equal(b.stats.level, 99, 'el veterano no sube de 99');
  assert.equal(sessionExp.get('a'), LOSE_EXP);
  assert.equal(sessionExp.get('b'), WIN_EXP);
}

// El cap de EXP total de sesión: nadie pasa de SESSION_EXP_CAP, ganando o perdiendo.
{
  sessionExp.clear();
  sessionExp.set('a', SESSION_EXP_CAP - LOSE_EXP);
  sessionExp.set('b', SESSION_EXP_CAP - WIN_EXP);
  const a = player('a'), b = player('b', { exp: 100000, expToNextLevel: 999999999, level: 999 });
  a.stats.wins = 2; a.stats.losses = 3;
  b.stats.wins = 3; b.stats.losses = 2;
  const cfg = makeMatch(a, b);
  applyMatchResult(cfg);
  assert.equal(sessionExp.get('a'), SESSION_EXP_CAP, 'cap no se pasa');
  assert.equal(sessionExp.get('b'), SESSION_EXP_CAP);
}

// Sin elegibilidad de EXP → no suma exp, pero sí W/L.
{
  const a = player('a'), b = player('b');
  b.stats.wins = 1; a.stats.losses = 1;
  const cfg = makeMatch(a, b);
  cfg.match.expEligible = { p1: false, p2: false };
  applyMatchResult(cfg);
  assert.equal(b.stats.exp, 0, 'no elegible → 0 EXP');
  assert.equal(b.stats.wins, 1);
  assert.equal(a.stats.exp, 0);
  assert.equal(a.stats.losses, 1);
}

// Subida de nivel: campeón b con +WIN_EXP → b sube a nivel 1, sobra WIN_EXP-60... si WIN_EXP=60 no sobra.
{
  const a = player('a'), b = player('b');
  a.stats.wins = 1; b.stats.wins = 3;
  applyMatchResult(makeMatch(a, b));
  assert.equal(b.stats.level, 1);
  assert.equal(b.stats.exp, WIN_EXP - 50);
  assert.equal(b.stats.attributePoints, 1);
  assert.equal(b.stats.expToNextLevel, 50, 'de nivel 1 el siguiente umbral son 50');
}

// Grim admin: nivel 999, mucha vida, inmutable ante un duelo.
{
  const stats = grimAdminStats();
  assert.equal(stats.level, 999);
  assert.ok(stats.baseMaxHp > 900000, 'vida casi infinita');

  const blank = { players: {} };
  assert.equal(ensureGrim(blank), true);
  assert.equal(blank.players[GRIM_PLAYER_ID].stats.level, 999);
  assert.equal(ensureGrim(blank), false, 'ya en admin → no re-escribe');

  const a = player('a'), b = { ...blank.players[GRIM_PLAYER_ID] };
  b.stats = { ...b.stats, wins: 1000, losses: 0, exp: 0 };
  b.stats.wins = 1001; a.stats.wins = 0; a.stats.losses = 1; // Grim ganó el duelo por 1 round
  const cfg = makeMatch(a, b, { p1: { w: 0, l: 0 }, p2: { w: 1000, l: 0 } });
  applyMatchResult(cfg);
  assert.equal(cfg.players.b.stats.level, 999, 'Grim sigue en 999');
  assert.equal(cfg.players.b.stats.wins, 1001);
  assert.equal(cfg.players.b.stats.baseMaxHp, 999999, 'la vida no se recalcula');
}

console.log('✅ apply-match: todos los checks pasaron');