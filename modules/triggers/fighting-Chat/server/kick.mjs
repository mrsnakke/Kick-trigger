import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// =============================================================
// Integración Kick — CONTRATO CON TU BOT
// =============================================================
// kick-bot: TU app de bot (la que ya tienes en otra aplicación) es quien
// se conecta a Kick (OAuth + webhooks `chat.message.sent`, verificación de
// firma RSA…). Cuando el chat escriba un comando, tu bot llama a ESTOS
// endpoints de nuestro server:
//
//   GET  /api/kick/help                    → mensajes cortitos para responder
//   POST /api/kick/players/upsert          → { kick_id, username } registra jugador
//   GET  /api/kick/players                 → lista de jugadores + combates restantes
//   POST /api/kick/challenges              → { from_kick_id, from_username,
//                                             to_kick_id, to_username } (comando !retar)
//   POST /api/kick/challenges/:id/accept   → { player_kick_id } (comando !aceptar / !si)
//   POST /api/kick/challenges/:id/decline  → { player_kick_id } (comando !no)
//   GET  /api/kick/challenges              → estado de la cola
//
// Tu bot conecta aquí con un simple fetch. No toques nada más del server.
// =============================================================

// EXP por PARTIDA (no por ronda): el ganador cobra más que el perdedor, pero ambos suman,
// y el tope es la EXP TOTAL del día (por sesión / arranque del server). Así ganes o pierdas
// siempre podés llenar tu cap de EXP diario. Vuelve a 0 en cada reinicio (Map en memoria).
export const SESSION_EXP_CAP = 300; // EXP total máxima por jugador y por arranque del server
export const WIN_EXP = 60;          // EXP del ganador del match
export const LOSE_EXP = 35;         // EXP del perdedor del match (ganar da más)

// EXP que exige subir del nivel `level` al siguiente. Curva polinómica suave (no exponencial):
// crece despacio al principio (niveles 1-4: 1 por día al llenar el cap) y se hace larga al final
// (~5 semanas por nivel cerca del 99) sin dispararse al infinito. Con el cap diario de 300 EXP,
// ir de nivel 1 a 99 lleva ~5 años de jugar a tope todos los días — progresión constante de
// largo plazo, nunca un muro. El umbral se recalcula SIEMPRE contra esta fórmula (no contra lo
// guardado), así un jugador con EXP vieja se re-nivela solo al primer combate con la curva nueva.
export function expForLevel(level) {
  const L = Math.max(1, Math.floor(level));
  return Math.floor(50 * Math.pow(L, 1.2));
}

// === Admin (GrimVTbot) ===
// El personaje del bot es admin: nivel 999, vida casi infinita e inmortal.
// ponytail: id hardcodeado + env override; mover a panel si un día se edita desde el dashboard.
export const GRIM_KICK_ID = Number(process.env.FIGHT_GRIM_ID || 65967692);
export const GRIM_USERNAME = process.env.FIGHT_GRIM_NAME || 'GrimVTbot';
export const GRIM_PLAYER_ID = `kick_${GRIM_KICK_ID}`;

export function grimAdminStats() {
  return {
    // Tanque raid boss: no pega fuerte (attackPower 1.6 ≈ nivel 30) pero es imposible tumbarlo
    // (998k vida + 80% de absorción + mucha evasión). Gana por desgaste, no por daño.
    level: 999, exp: 0,
    expToNextLevel: expForLevel(999),
    baseMaxHp: 999999, attackPower: 1.6, defense: 0.8, evasion: 0.4,
    accuracy: 0.99, speed: 2, critChance: 0.5, attributePoints: 0,
    allocated: { hp: 0, attack: 0, defense: 0, evasion: 0, accuracy: 0, speed: 0, crit: 0 },
    wins: 999, losses: 0,
  };
}

// Si el jugador Grim no existe, no está en nivel admin o su build no es la del tanque actual,
// lo crea/actualiza. `ADMIN_VERSION` se sube cuando cambie la plantilla para re-aplicar.
const ADMIN_VERSION = 2;
export function ensureGrim(cfg) {
  const grim = cfg?.players?.[GRIM_PLAYER_ID];
  const st = grim?.stats;
  const fresh = st?.level >= 999 && st?.baseMaxHp === 999999 && (st?.adminVersion ?? 0) >= ADMIN_VERSION;
  if (fresh) return false;
  if (!cfg.players) cfg.players = {};
  cfg.players[GRIM_PLAYER_ID] = {
    kick_id: GRIM_KICK_ID,
    username: GRIM_USERNAME,
    stats: { ...grimAdminStats(), adminVersion: ADMIN_VERSION },
  };
  return true;
}

// Fórmula de nivel (única fuente de verdad; el frontend solo la muestra).
function calcLevelStats(level, baseHp = 200) {
  const safeLevel = Math.max(1, Math.min(99, Math.floor(level)));
  return {
    level: safeLevel,
    expToNextLevel: expForLevel(safeLevel),
    baseMaxHp: Math.round(baseHp + (safeLevel - 1) * 10),
    attackPower: Number((1 + (safeLevel - 1) * 0.02).toFixed(3)),
    defense: Number(Math.min(0.22, (safeLevel - 1) * 0.012).toFixed(3)),
    evasion: Number(Math.min(0.1, (safeLevel - 1) * 0.006).toFixed(3)),
    accuracy: Number(Math.min(0.98, 0.94 + (safeLevel - 1) * 0.004).toFixed(3)),
  };
}

// Suma exp/W/L a un jugador, sube niveles (+1 punto por nivel) y preserva enchants.
function applyStatsDelta(s, { exp = 0, wins = 0, losses = 0 } = {}) {
  let level = s.level ?? 0;
  let expToNext = expForLevel(level);
  let expTotal = (s.exp ?? 0) + exp;
  let points = s.attributePoints ?? 0;
  while (expTotal >= expToNext && level < 99) {
    expTotal -= expToNext;
    level += 1;
    expToNext = expForLevel(level);
    points += 1;
  }
  const baseHp = s.baseMaxHp || 200;
  const before = calcLevelStats(s.level ?? 0, baseHp);
  const after = calcLevelStats(level, baseHp);
  const levelDelta = Math.max(0, level - (s.level ?? 0));
  return {
    ...s, ...after, level, exp: expTotal,
    baseMaxHp: Math.round((s.baseMaxHp || 200) + levelDelta * 10),
    attackPower: Number(((s.attackPower ?? 1) + (after.attackPower - before.attackPower)).toFixed(3)),
    defense: Number(((s.defense ?? 0) + (after.defense - before.defense)).toFixed(3)),
    evasion: Number(((s.evasion ?? 0) + (after.evasion - before.evasion)).toFixed(3)),
    accuracy: Number(((s.accuracy ?? 0.94) + (after.accuracy - before.accuracy)).toFixed(3)),
    speed: s.speed ?? 1,
    critChance: s.critChance ?? 0,
    attributePoints: points,
    allocated: s.allocated ?? { hp: 0, attack: 0, defense: 0, evasion: 0, accuracy: 0, speed: 0, crit: 0 },
    wins: (s.wins ?? 0) + wins,
    losses: (s.losses ?? 0) + losses,
  };
}

// Aplica el resultado de un combate terminado a los stats de ambos jugadores.
// W/L se cuentan UNA VEZ por match (ganador +1 win, perdedor +1 loss), no por ronda.
// EXP por match: ganador WIN_EXP, perdedor LOSE_EXP (ambos reciben, el ganador más).
export function applyMatchResult(cfg) {
  const m = cfg?.match || {};
  const p1Id = m.p1, p2Id = m.p2;
  const p1 = cfg?.players?.[p1Id], p2 = cfg?.players?.[p2Id];
  const r0 = m.recordStart || {};
  const sc1 = Math.max(0, (p1?.stats?.wins ?? 0) - (r0?.p1?.w ?? 0));
  const sc2 = Math.max(0, (p2?.stats?.wins ?? 0) - (r0?.p2?.w ?? 0));
  const champion = sc1 === sc2 ? null : sc1 > sc2 ? p1Id : p2Id;
  const elig = m.expEligible || { p1: false, p2: false };
  // Wins/losses se fijan como total = recordStart + resultado del MATCH (idempotente).
  const wl = (id) => ({
    win: champion === id ? 1 : 0,
    loss: (champion !== null && champion !== id) ? 1 : 0,
  });
  for (const [id, slot] of [[p1Id, 'p1'], [p2Id, 'p2']]) {
    const p = cfg?.players?.[id];
    if (!p?.stats) continue;
    const exp = elig[slot] ? (champion === id ? WIN_EXP : LOSE_EXP) : 0;
    p.stats = applyStatsDelta(p.stats, { exp });
    const r = wl(id);
    p.stats.wins = (r0?.[slot]?.w ?? 0) + r.win;
    p.stats.losses = (r0?.[slot]?.l ?? 0) + r.loss;
  }
  // Registrar la EXP de esta sesión para el cap diario (ambos cuentan hacia él, ganes o pierdas).
  for (const id of [p1Id, p2Id]) {
    const expEarned = champion === id ? WIN_EXP : LOSE_EXP;
    if (cfg?.players?.[id]?.stats) sessionExp.set(id, Math.min(SESSION_EXP_CAP, (sessionExp.get(id) || 0) + expEarned));
  }
}

const ACCEPT_TTL_MS = 1 * 60 * 1000; // si el retado no responde en 1 min, el reto se cancela solo

// Estado efímero en memoria → se resetea al reiniciar el server (requisito).
export const sessionExp = new Map(); // playerId -> EXP total acumulada esta sesión (cap SESSION_EXP_CAP)
let challenges = [];              // [{ id, from, to, status, createdAt, expiresAt }]

export function playerIdOf(kickId) {
  return `kick_${Number(kickId)}`;
}

export function getSessionExp() {
  return Object.fromEntries(sessionExp);
}

// Quién recibe EXP en el próximo combate (se decide AL INICIAR, no al terminar): todos los que
// aún no hayan llenado su cap de EXP total diario.
export function snapshotEligibility(cfg) {
  const p1 = cfg?.match?.p1;
  const p2 = cfg?.match?.p2;
  const left = (id) => (sessionExp.get(id) || 0) < SESSION_EXP_CAP;
  return { p1: left(p1), p2: left(p2) };
}

// W/L de cada jugador al iniciar el combate → permite saber cuántos rounds ganó cada quien.
export function snapshotRecord(cfg) {
  const rec = (id) => {
    const s = cfg?.players?.[id]?.stats;
    return s ? { w: s.wins ?? 0, l: s.losses ?? 0 } : { w: 0, l: 0 };
  };
  return { p1: rec(cfg?.match?.p1), p2: rec(cfg?.match?.p2) };
}

// Resultado estructurado de un combate terminado (para que el trigger lo anuncie al chat).
// rawScore = rounds del /api/end (la arena ya los envió); tras applyMatchResult las wins de
// los jugadores ya valen recordStart + resultado del MATCH, y el score debe conservar las rondas.
export function buildMatchResult(cfg, rawScore = {}) {
  const m = cfg?.match || {};
  const p1Id = m.p1, p2Id = m.p2;
  const p1 = cfg?.players?.[p1Id], p2 = cfg?.players?.[p2Id];
  const p1Stats = p1?.stats || {};
  const p2Stats = p2?.stats || {};
  const r0 = m.recordStart || {};
  const sc1 = Math.max(0, (p1Stats.wins || 0) - (r0?.p1?.w ?? 0));
  const sc2 = Math.max(0, (p2Stats.wins || 0) - (r0?.p2?.w ?? 0));
  const champion = sc1 === sc2 ? null : sc1 > sc2 ? p1Id : p2Id;
  const scoreFor = (slot) => Math.max(0, Math.floor(Number(rawScore?.[slot] ?? NaN) || 0));
  const elig = m.expEligible || { p1: false, p2: false };
  const expFor = (slot, isChampion) => champion !== null && elig[slot] ? (isChampion ? WIN_EXP : LOSE_EXP) : 0;
  const summary = (id, p, isChampion, slot) => ({
    id,
    username: p?.username || id,
    score: scoreFor(slot),
    champion: champion === id,
    expGained: expFor(slot, isChampion),
    level: p?.stats?.level ?? 0,
    exp: p?.stats?.exp ?? 0,
    expToNextLevel: p?.stats?.expToNextLevel ?? expForLevel(0),
    expLeft: Math.max(0, SESSION_EXP_CAP - (sessionExp.get(id) || 0)),
  });
  return {
    endedAt: Date.now(),
    p1: summary(p1Id, p1, champion === p1Id, 'p1'),
    p2: summary(p2Id, p2, champion === p2Id, 'p2'),
  };
}

function pruneExpired() {
  const now = Date.now();
  challenges = challenges.filter(
    (c) => c.status === 'accepted' || now - c.createdAt < ACCEPT_TTL_MS
  );
  return challenges;
}

// Si la arena está libre y hay un reto aceptado esperando → arranca ese duelo.
export function tryStartNext({ readConfig, writeConfig }) {
  const cfg = readConfig();
  if (cfg?.match?.active) return false; // nunca interrumpe un duelo en curso
  pruneExpired();
  const next = challenges.find((c) => c.status === 'accepted');
  if (!next) return false;

  cfg.match = {
    ...cfg.match,
    p1: next.from,
    p2: next.to,
    active: true,
    expEligible: null, // lo rellena writeStart después de fijar p1/p2
  };
  randomizeSprites(cfg); // cada duelo reparte el sprite p1/p2 al azar entre slots
  // La elegibilidad se fotografía ANTES del combate, con los ids ya puestos.
  cfg.match.expEligible = snapshotEligibility(cfg);
  cfg.match.recordStart = snapshotRecord(cfg);
  cfg.updatedAt = new Date().toISOString();
  challenges = challenges.filter((c) => c.id !== next.id);
  writeConfig(cfg);
  return true;
}

// Reparto aleatorio de qué slot usa qué sprite (p1.png vs p2.png) por combate.
// Ambos sheets comparten layout/attributes/dimensión (misma cuadrícula), así que solo se
// baraja el spriteUrl: 50/50 a qué lado (izquierda/derecha) le toca cada personaje.
const SPRITES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sprites');
const spriteExists = (id) => existsSync(path.join(SPRITES_DIR, `${id}.png`));
export function randomizeSprites(cfg) {
  const a = cfg?.p1, b = cfg?.p2;
  if (!a || !b || !a.spriteUrl || !b.spriteUrl) return false;
  if (!spriteExists('p1') || !spriteExists('p2')) return false;
  const useP1A = Math.random() < 0.5;
  a.spriteUrl = useP1A ? '/api/sprites/p1' : '/api/sprites/p2';
  b.spriteUrl = useP1A ? '/api/sprites/p2' : '/api/sprites/p1';
  return true;
}

function upsertPlayer(cfg, kickId, username, deps) {
  cfg.players ??= {};
  const kickIdNum = kickId != null ? Number(kickId) : null;
  const playerId = kickIdNum != null ? playerIdOf(kickIdNum) : `local_${username || 'anon'}`;
  if (!cfg.players[playerId]) {
    // Si creamos un kick user y ya existe un placeholder (kick_id null) con ese username,
    // lo descartamos para que nunca haya dos fichas del mismo nombre.
    const placeholder = Object.entries(cfg.players).find(
      ([k, q]) => k !== playerId && q?.kick_id == null &&
        String(q?.username || '').toLowerCase() === String(username || '').toLowerCase()
    );
    if (placeholder) delete cfg.players[placeholder[0]];
    cfg.players[playerId] = {
      kick_id: kickIdNum,
      username: username || playerId,
      stats: kickIdNum === GRIM_KICK_ID ? grimAdminStats() : deps.defaultPlayerStats(),
    };
    return cfg.players[playerId];
  }
  if (username) cfg.players[playerId].username = username;
  if (kickIdNum === GRIM_KICK_ID) ensureGrim(cfg); // el admin se mantiene admin ante cualquier upsert
  return cfg.players[playerId];
}

export async function kickApiRoutes(req, res, deps) {
  const { readConfig, writeConfig, readBody, sendJson, sendError } = deps;
  const url = req.url || '';
  const pathname = url.split('?')[0];

  // kick-bot: instrucciones cortitas que TU bot responde al recibir !retar / !aceptar
  if (req.method === 'GET' && pathname === '/api/kick/help') {
    sendJson(res, 200, {
      help: '¡Retos! Escribe !retar @usuario para retar a alguien. Si te retan a ti, responde !aceptar (o !si) para aceptar, o !no para rechazar. ¡!stats muestra tu ficha y !invertir <stat> encanta un atributo!',
      commands: {
        '!retar': '!retar @jugador — reta a un jugador. No pelea hasta que acepte y la arena esté libre. Responde !aceptar o !si para aceptar.',
        '!aceptar': '!aceptar (o !si) — acepta el reto pendiente. El duelo empieza automáticamente cuando la arena se libere.',
        '!no': '!no — rechaza el reto.',
        '!stats': '!stats — muestra tu nivel, EXP y puntos de atributo.',
        '!invertir': '!invertir <vida|ataque|defensa|evasion|punteria|velocidad|critico> — encanta un atributo (consume 1 punto; si falla se pierde).',
      },
    });
    return true;
  }

  // kick-bot: llámalo cuando veas un usuario nuevo en el chat para crearlo/subir su nombre.
  if (req.method === 'POST' && pathname === '/api/kick/players/upsert') {
    readBody(req)
      .then(({ kick_id, username }) => {
        if (kick_id == null) throw new Error('kick_id es obligatorio');
        const cfg = readConfig();
        const player = upsertPlayer(cfg, kick_id, username, deps);
        cfg.updatedAt = new Date().toISOString();
        writeConfig(cfg);
        sendJson(res, 200, { ok: true, playerId: playerIdOf(kick_id), player });
      })
      .catch((err) => sendError(res, 400, err.message));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/kick/players') {
    const cfg = readConfig();
    const players = Object.entries(cfg.players || {}).map(([id, p]) => ({
      id,
      kick_id: p.kick_id ?? null,
      username: p.username,
      level: p.stats?.level ?? 0,
      wins: p.stats?.wins ?? 0,
      losses: p.stats?.losses ?? 0,
      battlesLeft: Math.max(0, SESSION_EXP_CAP - (sessionExp.get(id) || 0)),
    }));
    sendJson(res, 200, { players });
    return true;
  }

  // kick-bot: comando !retar @usuario
  if (req.method === 'POST' && pathname === '/api/kick/challenges') {
    readBody(req)
      .then(({ from_kick_id, from_username, to_kick_id, to_username }) => {
        if (from_kick_id == null || to_kick_id == null) {
          throw new Error('from_kick_id y to_kick_id son obligatorios');
        }
        if (Number(from_kick_id) === Number(to_kick_id)) throw new Error('No te puedes retar a ti mismo');
        const cfg = readConfig();
        const from = playerIdOf(from_kick_id);
        const to = playerIdOf(to_kick_id);
        upsertPlayer(cfg, from_kick_id, from_username, deps);
        upsertPlayer(cfg, to_kick_id, to_username, deps);

        pruneExpired();
        const busy = challenges.some((c) => c.from === from || c.to === from || c.from === to || c.to === to);
        if (busy) throw new Error('Uno de los dos ya tiene un reto en curso. Espera a que termine.');

        const challenge = {
          id: randomUUID(),
          from,
          to,
          status: 'awaiting_accept',
          createdAt: Date.now(),
          expiresAt: Date.now() + ACCEPT_TTL_MS,
        };
        challenges.push(challenge);
        cfg.updatedAt = new Date().toISOString();
        writeConfig(cfg);
        sendJson(res, 200, { ok: true, challenge });
      })
      .catch((err) => sendError(res, 400, err.message));
    return true;
  }

  // kick-bot: comando !aceptar / !si
  const acceptMatch = pathname.match(/^\/api\/kick\/challenges\/([a-zA-Z0-9-]+)\/accept$/);
  if (req.method === 'POST' && acceptMatch) {
    const id = acceptMatch[1];
    readBody(req)
      .then(({ player_kick_id }) => {
        pruneExpired();
        const challenge = challenges.find((c) => c.id === id);
        if (!challenge) throw new Error('El reto no existe o expiró');
        if (player_kick_id == null || playerIdOf(player_kick_id) !== challenge.to) {
          throw new Error('Solo la persona retada puede aceptar');
        }
        if (challenge.status !== 'awaiting_accept') throw new Error('Este reto ya no está aceptable');
        challenge.status = 'accepted';
        const started = tryStartNext({ readConfig, writeConfig });
        sendJson(res, 200, { ok: true, started, queued: !started });
      })
      .catch((err) => sendError(res, 400, err.message));
    return true;
  }

  // kick-bot: comando !no
  const declineMatch = pathname.match(/^\/api\/kick\/challenges\/([a-zA-Z0-9-]+)\/decline$/);
  if (req.method === 'POST' && declineMatch) {
    const id = declineMatch[1];
    readBody(req)
      .then(({ player_kick_id }) => {
        const challenge = challenges.find((c) => c.id === id);
        if (!challenge) throw new Error('El reto no existe o expiró');
        if (player_kick_id == null || playerIdOf(player_kick_id) !== challenge.to) {
          throw new Error('Solo la persona retada puede rechazar');
        }
        challenges = challenges.filter((c) => c.id !== id);
        sendJson(res, 200, { ok: true });
      })
      .catch((err) => sendError(res, 400, err.message));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/kick/challenges') {
    sendJson(res, 200, { challenges: pruneExpired() });
    return true;
  }

  return false;
}