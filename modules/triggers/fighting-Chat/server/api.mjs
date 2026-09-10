import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  kickApiRoutes,
  getSessionExp,
  snapshotEligibility,
  snapshotRecord,
  randomizeSprites,
  buildMatchResult,
  tryStartNext,
  applyMatchResult,
  ensureGrim,
} from './kick.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
const SPRITES_DIR = path.join(DATA_DIR, 'sprites');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
// Los jugadores (inventario: stats, W/L, puntos) viven en su propio archivo para no mezclarse
// con la configuración visual (sprites/layout). El API igualmente los sirve bajo `players`.
const PLAYERS_PATH = path.join(DATA_DIR, 'players.json');

function ensureDirs() {
  mkdirSync(SPRITES_DIR, { recursive: true });
}

function defaultPlayerStats() {
  return { level: 0, exp: 0, expToNextLevel: 50, baseMaxHp: 200, attackPower: 1.0, defense: 0, evasion: 0, accuracy: 0.94, critChance: 0, attributePoints: 0, allocated: { hp: 0, attack: 0, defense: 0, evasion: 0, accuracy: 0, crit: 0 }, wins: 0, losses: 0 };
}

function defaultConfig() {
  return {
    version: 2,
    p1: null,
    p2: null,
    match: { background: 'transparent', layout: 'full-arena', maxWins: 3, p1: 'local-p1', p2: 'local-p2', active: false, expEligible: null, recordStart: null, lastResult: null },
    updatedAt: new Date().toISOString(),
  };
}

// Limpia duplicados entre fichas: la clave canónica de un jugador real es `kick_<id>`; se
// eliminan otras claves que apunten al mismo kick_id y los placeholders (kick_id null) cuyo
// nombre coincide con el de un jugador real. Devuelve true si hubo cambios.
function sanitizePlayers(cfg) {
  const ps = cfg.players || {};
  let changed = false;
  for (const [key, p] of Object.entries(ps)) {
    if (!p) {
      delete ps[key];
      changed = true;
      continue;
    }
    if (p.kick_id != null) {
      const want = `kick_${Number(p.kick_id)}`;
      if (key !== want) {
        delete ps[key];
        changed = true;
      }
    } else {
      const name = String(p.username || '').toLowerCase();
      const dupReal = name && Object.values(ps).some(
        (q) => q?.kick_id != null && String(q?.username || '').toLowerCase() === name
      );
      if (dupReal) {
        delete ps[key];
        changed = true;
      }
    }
  }
  return changed;
}

// El stat "velocidad" se eliminó: los puntos invertidos se devuelven (1 punto consumido por
// enchante) y se limpian los campos muertos. Idempotente: tras la primera escritura a disco la
// clave ya no existe, así que nunca suma dos veces.
export function migrateSpeedRefund(cfg) {
  let changed = false;
  for (const pid of Object.keys(cfg.players || {})) {
    const s = cfg.players[pid]?.stats;
    if (!s) continue;
    if (s.allocated?.speed) {
      s.attributePoints = (s.attributePoints || 0) + s.allocated.speed;
      changed = true;
    }
    if (s.allocated && 'speed' in s.allocated) {
      delete s.allocated.speed;
      changed = true;
    }
    if ('speed' in s) {
      delete s.speed;
      changed = true;
    }
  }
  return changed;
}

function readPlayersFile() {
  if (!existsSync(PLAYERS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(PLAYERS_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function readConfig() {
  ensureDirs();
  let cfg;
  if (!existsSync(CONFIG_PATH)) {
    cfg = defaultConfig();
    cfg.players = {
      'local-p1': { kick_id: null, username: 'Player 1', stats: defaultPlayerStats() },
      'local-p2': { kick_id: null, username: 'Player 2', stats: defaultPlayerStats() },
    };
    writeConfig(cfg);
    return cfg;
  }
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    // defaultConfig ya no trae players: si el archivo viejo los tenía, quedan en `parsed`.
    cfg = { ...defaultConfig(), ...parsed };
  } catch {
    cfg = defaultConfig();
  }

  // Migration v1 → v2: los stats de p1/p2 pasan a ser jugadores locales.
  // Detección por `cfg.stats` (legacy), no por `!cfg.players` (un config viejo puede traerlos).
  if (cfg.stats && !cfg.players) {
    const s = cfg.stats;
    cfg.players = {
      'local-p1': { kick_id: null, username: cfg.p1?.name || 'Player 1', stats: { ...defaultPlayerStats(), ...(s.p1 || {}) } },
      'local-p2': { kick_id: null, username: cfg.p2?.name || 'Player 2', stats: { ...defaultPlayerStats(), ...(s.p2 || {}) } },
    };
  }
  delete cfg.stats;
  cfg.version = 2;

  // v2.1: los players viven en players.json, no en config.json. Si aún estaban embebidos o no
  // existe el archivo, se migran/crean ahora (writeConfig separa ambos archivos).
  const embedded = cfg.players || null;
  delete cfg.players;
  cfg.players = readPlayersFile() || embedded || {
    'local-p1': { kick_id: null, username: 'Player 1', stats: defaultPlayerStats() },
    'local-p2': { kick_id: null, username: 'Player 2', stats: defaultPlayerStats() },
  };

  // Deep-default each player's stats so newly added fields always exist.
  const d = defaultPlayerStats();
  for (const pid of Object.keys(cfg.players || {})) {
    if (cfg.players[pid]?.stats) {
      cfg.players[pid].stats = {
        ...d,
        ...cfg.players[pid].stats,
        allocated: { ...d.allocated, ...(cfg.players[pid].stats.allocated || {}) },
      };
    }
  }
  if (!cfg.match) cfg.match = { ...defaultConfig().match };
  cfg.match = { ...defaultConfig().match, ...cfg.match };
  if (!cfg.match.p1) cfg.match.p1 = 'local-p1';
  if (!cfg.match.p2) cfg.match.p2 = 'local-p2';

  const changed = sanitizePlayers(cfg) || !!embedded || !existsSync(PLAYERS_PATH) || migrateSpeedRefund(cfg);
  // El personaje del bot (GrimVTbot) es admin: recién booteado o en build vieja, se re-sella.
  if (ensureGrim(cfg) || changed) writeConfig(cfg);
  return cfg;
}

function writeConfig(cfg) {
  ensureDirs();
  const { players, ...rest } = cfg;
  writeFileSync(CONFIG_PATH, JSON.stringify(rest, null, 2));
  if (players) writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2));
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) {
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

export function apiRoutes(req, res) {
  const url = req.url || '';
  const pathname = url.split('?')[0];

  // kick-bot: tu otra app se conecta aquí (ver server/kick.mjs).
  if (pathname.startsWith('/api/kick/')) {
    kickApiRoutes(req, res, { readConfig, writeConfig, readBody, sendJson, sendError, defaultPlayerStats });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/config') {
    sendJson(res, 200, { ...readConfig(), session: { exp: getSessionExp() } });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/config') {
    readBody(req)
      .then((body) => {
        const base = readConfig();
        const merged = { ...base, ...body, players: base.players, updatedAt: new Date().toISOString() };
        // Un `match` parcial (p.ej. {background, layout} desde /calibrate) NO pisa el combate en
        // curso: se fusiona, no se reemplaza. Reemplazarlo entero borraba active/p1/p2/recordStart/
        // lastResult/enchant y la arena (OBS) veía el duelo "caído" a mitad — se cortaba sin /api/end
        // y el siguiente reto/Iniciar arrancaba una pelea rara con jugadores locales.
        if (body && typeof body === 'object' && body.match && typeof body.match === 'object') {
          merged.match = { ...base.match, ...body.match };
        }
        // In-memory state never gets persisted into the file; el inventario (players) siempre
        // viene de players.json en disco, el browser jamás lo reescribe.
        delete merged.stats;
        delete merged.session;
        delete merged.challenges;
        ensureGrim(merged); // un guard que no se lleve al admin de la arena
        writeConfig(merged);
        sendJson(res, 200, merged);
      })
      .catch((err) => sendError(res, 400, err.message));
    return true;
  }

  // GET /api/sprites/:id -> raw png
  const spriteGet = pathname.match(/^\/api\/sprites\/([a-zA-Z0-9_-]+)$/);
  if (req.method === 'GET' && spriteGet) {
    const id = spriteGet[1];
    const file = path.join(SPRITES_DIR, `${id}.png`);
    if (!existsSync(file)) {
      sendError(res, 404, 'Sprite not found');
      return true;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    res.end(readFileSync(file));
    return true;
  }

  // POST /api/sprites/:id -> body { dataUrl } store as png
  const spritePost = pathname.match(/^\/api\/sprites\/([a-zA-Z0-9_-]+)$/);
  if (req.method === 'POST' && spritePost) {
    const id = spritePost[1];
    readBody(req)
      .then(({ dataUrl }) => {
        if (!dataUrl || !dataUrl.startsWith('data:image/')) {
          throw new Error('Invalid image data');
        }
        const base64 = dataUrl.split(',')[1] || '';
        ensureDirs();
        writeFileSync(path.join(SPRITES_DIR, `${id}.png`), Buffer.from(base64, 'base64'));
        sendJson(res, 200, { ok: true, url: `/api/sprites/${id}` });
      })
      .catch((err) => sendError(res, 400, err.message));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/export') {
    sendJson(res, 200, readConfig());
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/reset') {
    writeConfig(defaultConfig());
    sendJson(res, 200, readConfig());
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/allocate') {
    readBody(req)
      .then(({ player, stat }) => {
        const STATS = ['hp', 'attack', 'defense', 'evasion', 'accuracy', 'crit'];
        if (!player) throw new Error('player es obligatorio');
        if (!stat || !STATS.includes(stat)) throw new Error(`stat must be one of ${STATS.join(', ')}`);

        const cfg = readConfig();
        // El streamer puede pasar 'p1'/'p2' (slot) o un playerId directo (ej. kick_…).
        const playerId = player === 'p1' ? cfg.match.p1 : player === 'p2' ? cfg.match.p2 : player;
        const s = cfg.players?.[playerId]?.stats;
        if (!s) throw new Error('Player stats not found');
        if ((s.attributePoints || 0) <= 0) throw new Error('No attribute points available');

        const allocated = s.allocated || { hp: 0, attack: 0, defense: 0, evasion: 0, accuracy: 0, crit: 0 };
        const invested = allocated[stat] || 0;

        // Sin RNG: el punto SIEMPRE mejora el atributo, pero cada punto da muy poquito
        // (y los stats "problemáticos" — evasión, crítico, puntería — suben menos).
        // Los tope duros por stat evitan que nadie se dispare en un atributo.
        const success = true;
        allocated[stat] = invested + 1;
        s.allocated = allocated;
        s.attributePoints = (s.attributePoints || 0) - 1;

        if (stat === 'hp') s.baseMaxHp = (s.baseMaxHp || 200) + 2;
        else if (stat === 'attack') s.attackPower = Number(((s.attackPower || 1) + 0.005).toFixed(4));
        else if (stat === 'defense') s.defense = Number(Math.min(0.5, (s.defense || 0) + 0.003).toFixed(4));
        else if (stat === 'evasion') s.evasion = Number(Math.min(0.4, (s.evasion || 0) + 0.002).toFixed(4));
        else if (stat === 'accuracy') s.accuracy = Number(Math.min(0.99, (s.accuracy || 0.94) + 0.001).toFixed(4));
        else if (stat === 'crit') s.critChance = Number(Math.min(0.5, (s.critChance || 0) + 0.004).toFixed(4));

        cfg.match = { ...cfg.match, enchant: { player: playerId, stat, success, at: Date.now() } };
        cfg.updatedAt = new Date().toISOString();
        writeConfig(cfg);
        sendJson(res, 200, { ok: true, success, player: playerId, stats: cfg.players[playerId].stats });
      })
      .catch((err) => sendError(res, 400, err.message));
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/set-match') {
    readBody(req)
      .then(({ p1, p2 }) => {
        const cfg = readConfig();
        if (!p1 || !p2 || p1 === p2) throw new Error('p1 y p2 deben ser ids de jugadores distintos');
        if (!cfg.players?.[p1] || !cfg.players?.[p2]) throw new Error('Jugador no encontrado');
        if (cfg.match.active) throw new Error('Hay un combate en curso; espera a que termine');
        cfg.match = { ...cfg.match, p1, p2 };
        cfg.updatedAt = new Date().toISOString();
        writeConfig(cfg);
        sendJson(res, 200, cfg);
      })
      .catch((err) => sendError(res, 400, err.message));
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/start') {
    const cfg = readConfig();
    if (!cfg.match.active) {
      randomizeSprites(cfg); // reparte el sprite p1/p2 al azar entre slots en cada duelo
      cfg.match = { ...cfg.match, active: true, expEligible: snapshotEligibility(cfg), recordStart: snapshotRecord(cfg) };
    }
    cfg.updatedAt = new Date().toISOString();
    writeConfig(cfg);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/end') {
    readBody(req)
      .then(({ p1, p2 }) => {
        const cfg = readConfig();
        const wasActive = !!cfg.match?.active;
        if (wasActive) {
          // La arena (OBS) es quien ve terminar el duelo; manda el score { p1, p2 } (rounds
          // ganados por cada slot). applyMatchResult deriva el ganador del match y aplica
          // EXP (ganador WIN_EXP / perdedor LOSE_EXP) y W/L (1 win / 1 loss por match).
          const score = (v) => Math.max(0, Math.floor(Number(v) || 0));
          const rawScore = { p1: score(p1), p2: score(p2) };
          for (const slot of ['p1', 'p2']) {
            const s = cfg.players?.[cfg.match?.[slot]]?.stats;
            if (s) s.wins = (cfg.match?.recordStart?.[slot]?.w ?? 0) + score(slot === 'p1' ? p1 : p2);
          }
          applyMatchResult(cfg);
          // El resultado se captura ANTES de dejar la arena libre y de arrancar la cola.
          cfg.match = { ...cfg.match, active: false, expEligible: null, recordStart: null, lastResult: buildMatchResult(cfg, rawScore) };
        } else {
          cfg.match = { ...cfg.match, active: false, expEligible: null };
        }
        cfg.updatedAt = new Date().toISOString();
        writeConfig(cfg);
        if (wasActive) {
          // El combate cuenta para ambos jugadores y, si hay un reto aceptado, arranca el siguiente.
          tryStartNext({ readConfig, writeConfig });
        }
        sendJson(res, 200, { ok: true });
      })
      .catch((err) => sendError(res, 400, err.message));
    return true;
  }

  return false;
}