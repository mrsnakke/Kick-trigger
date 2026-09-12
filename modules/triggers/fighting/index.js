const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const express = require('express')
const eventBus = require('../../../lib/event-bus')
const chat = require('../../chat')
const state = require('../../../lib/state')

// fighting-Chat es una app independiente (Express + Vite) que vive en
// modules/triggers/fighting-Chat. Este trigger (a) la levanta como proceso
// hijo en su propio puerto y (b) actúa como su "bot de Kick": lee el chat y
// llama su contrato /api/kick/*.
const FIGHT_ROOT = path.join(__dirname, '..', 'fighting-Chat')
const FIGHTING_URL = process.env.FIGHTING_URL || 'http://localhost:3001'
const FIGHT_HOST = new URL(FIGHTING_URL).hostname
const PORT = Number(new URL(FIGHTING_URL).port) || 3001
const MAX_SPAWN = 3

// -- Estado en memoria (se resetea al reiniciar; igual que el fight server) --
const seen = new Set()          // kick ids ya registrados esta sesión
const userMap = new Map()       // username(minúsculas) -> { id, name }
const repliedMsg = new Set()    // message ids ya respondidos (idempotencia)

// Llaves del gachapón por pelear: conjunto del gacha (mismo proceso) + contador de sesión.
const gachaStore = require(path.join(__dirname, '..', 'GACHA', 'modules', 'data', 'store'))
const gachaInventory = require(path.join(__dirname, '..', 'GACHA', 'modules', 'gacha', 'inventory'))
const KEY_CAP = 5               // llaves por pelea por jugador hasta reiniciar el backend
const fightKeys = new Map()     // userId (sin el prefijo kick_) -> llaves ganadas esta sesión

const STAT_MAP = {
  hp: 'hp', vida: 'hp',
  attack: 'attack', ataque: 'attack', atk: 'attack',
  defense: 'defense', defensa: 'defense',
  evasion: 'evasion', evasión: 'evasion',
  accuracy: 'accuracy', punteria: 'accuracy', puntería: 'accuracy',
  crit: 'crit', critico: 'crit', crítico: 'crit',
}
const STAT_KEYS = ['hp', 'attack', 'defense', 'evasion', 'accuracy', 'crit']
const STAT_LABELS = { hp: 'vida', attack: 'ataque', defense: 'defensa', evasion: 'evasión', accuracy: 'puntería', crit: 'crítico' }

// GrimVTbot es el personaje admin (nivel 999, vida casi infinita). Si lo retan en el chat,
// el duelo se auto-acepta. Lazy-require: vtuber-ai (solo usado por isHeld) se inicializa solo
// cuando hace falta, para no depender del orden de carga de los módulos.
const GRIM_KICK_ID = Number(process.env.FIGHT_GRIM_ID || 65967692)
const GRIM_USERNAME = process.env.FIGHT_GRIM_NAME || 'GrimVTbot'
const SNAKE_KICK_ID = Number(process.env.FIGHT_SNAKE_ID || 4623815)
const vtuberAI = () => require('../vtuber-ai')

async function api(fpath, { method = 'GET', body, timeout } = {}) {
  const res = await fetch(`${FIGHTING_URL}${fpath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: timeout ? AbortSignal.timeout(timeout) : undefined,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error || `Fight API ${fpath} falló: ${res.status}`)
  }
  return res.json()
}

async function isUp() {
  try { await api('/api/config', { timeout: 2000 }); return true } catch { return false }
}

// -- Spawn del fight server (último módulo en arrancar, sin ventanas) --
let child = null
let attempts = 0
let shuttingDown = false

function spawnFight() {
  if (child || attempts >= MAX_SPAWN) return
  if (!['localhost', '127.0.0.1', '::1'].includes(FIGHT_HOST)) return // URL remota: asumimos que ya corre ahí
  isUp().then((up) => {
    if (up) {
      console.log(`[FIGHT] Ya hay un fight server respondiendo en ${FIGHTING_URL}`)
      return
    }
    if (!fs.existsSync(path.join(FIGHT_ROOT, 'dist'))) {
      console.warn(`[FIGHT] No encuentro dist/ en ${FIGHT_ROOT} — el server no va a poder servir el frontend`)
    }
    attempts++
    console.log(`[FIGHT] Levantando fight server en ${FIGHTING_URL} (intento ${attempts}/${MAX_SPAWN})`)
    child = spawn('node', ['server.js'], {
      cwd: FIGHT_ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'inherit',
      windowsHide: true,
    })
    child.on('exit', (code) => {
      child = null
      if (shuttingDown || attempts >= MAX_SPAWN) return
      console.error(`[FIGHT] El fight server salió (code ${code}); reintentando en 5s`)
      setTimeout(spawnFight, 5000)
    })
  })
}

process.on('exit', () => { shuttingDown = true; if (child) child.kill() })

// -- Glue de chat (contrato /api/kick/* del fight server) --
async function handleMessage(data) {
  const payload = data?.payload || {}
  const content = payload?.content || '' // el webhook trae content/message_id a nivel raíz, no dentro de "message"
  const sender = payload?.sender || {}
  const userId = sender?.user_id ?? sender?.id
  const username = sender?.username
  const messageId = payload?.message_id
  if (!userId || !username || !content) return

  userMap.set(username.toLowerCase(), { id: userId, name: username })

  // Ignorar mención al inicio: "@usuario: !si" → "!si"
  const stripped = content.trim().replace(/^@\S+\s*:?\s*/, '')
  const head = stripped.split(/\s+/)[0]?.toLowerCase()
  const FIGHT_CMDS = ['!retar', '!aceptar', '!si', '!no', '!stats', '!invertir', '!pelea']
  if (!FIGHT_CMDS.includes(head)) {
    // Primer mensaje de un usuario → crear su ficha igual (le sirve a !retar @usuario)
    if (!seen.has(String(userId))) {
      seen.add(String(userId))
      api('/api/kick/players/upsert', { method: 'POST', body: { kick_id: userId, username } }).catch(() => {})
    }
    return
  }
  if (messageId && repliedMsg.has(messageId)) return
  repliedMsg.add(messageId)

  // Comando de pelea: garantizar el personaje (nivel 0, con nombre e id) antes de actuar.
  await api('/api/kick/players/upsert', { method: 'POST', body: { kick_id: userId, username } }).catch(() => {})

  const reply = (text) => chat.sendAsBot(text, messageId).catch(() => {})
  try {
    switch (head) {
      case '!retar': {
        const target = content.trim().split(/\s+/)[1]?.replace(/^@/, '').toLowerCase()
        if (!target) return reply(`@${username} usá: !retar @jugador`)

        // Reto al admin (GrimVTbot): se auto-acepta y la IA se burla del retador.
        if (target === GRIM_USERNAME.toLowerCase()) {
          if (Number(userId) === GRIM_KICK_ID) return reply(`@${username} el admin no se reta a sí mismo 😅`)
          const c = await api('/api/kick/challenges', {
            method: 'POST',
            body: { from_kick_id: userId, from_username: username, to_kick_id: GRIM_KICK_ID, to_username: GRIM_USERNAME },
          })
          const res = await api(`/api/kick/challenges/${c.challenge.id}/accept`, {
            method: 'POST',
            body: { player_kick_id: GRIM_KICK_ID },
          })
          reply(res.started
            ? `@${username} 🥊 ¡GRIM acepta el duelo! Nivel 999 bajando a la arena…`
            : `@${username} ⏳ Grim acepta, pero hay pelea en curso: quedás en cola.`)
          return
        }

        let t = userMap.get(target)
        if (!t) {
          // Fallback: buscar en el fight server (puede existir de sesión anterior)
          try {
            const list = await api('/api/kick/players')
            const p = list.players?.find((r) => r.username?.toLowerCase() === target)
            if (p) t = { id: String(p.kick_id), name: p.username }
          } catch {}
          if (!t) return reply(`@${username} todavía no conozco a @${target}; que escriba primero en el chat`)
        }
        if (t.id === userId) return reply(`@${username} no te podés retar a vos mismo 😄`)
        await api('/api/kick/challenges', {
          method: 'POST',
          body: { from_kick_id: userId, from_username: username, to_kick_id: t.id, to_username: t.name },
        })
        // MrSnakeVT atado no puede rechazar: si su modelo está "atadas", el reto se auto-acepta.
        if (Number(t.id) === SNAKE_KICK_ID && await vtuberAI().isHeld()) {
          const list = await api('/api/kick/challenges')
          const mine = list.challenges.find((c) => c.to === `kick_${t.id}` && c.status === 'awaiting_accept')
          if (mine) {
            await api(`/api/kick/challenges/${mine.id}/accept`, { method: 'POST', body: { player_kick_id: t.id } })
            return reply(`@${username} retó a @${t.name} 🥊 ¡pero ${t.name} está atado y no puede decir que no!`)
          }
        }
        return reply(`@${username} retó a @${t.name} 🥊 ¡@${t.name} responde !aceptar (o !si) o !no!`)
      }
      case '!aceptar':
      case '!si': {
        const list = await api('/api/kick/challenges')
        const mine = list.challenges.find((c) => c.to === `kick_${userId}` && c.status === 'awaiting_accept')
        if (!mine) return reply(`@${username} no tenés un reto pendiente`)
        const res = await api(`/api/kick/challenges/${mine.id}/accept`, { method: 'POST', body: { player_kick_id: userId } })
        return reply(res.started ? `@${username} ¡duelo iniciado! 🥊` : `@${username} reto aceptado, en cola ⏳`)
      }
      case '!no': {
        const list = await api('/api/kick/challenges')
        const mine = list.challenges.find((c) => c.to === `kick_${userId}` && c.status === 'awaiting_accept')
        if (!mine) return reply(`@${username} no tenés un reto pendiente`)
        await api(`/api/kick/challenges/${mine.id}/decline`, { method: 'POST', body: { player_kick_id: userId } })
        return reply(`@${username} reto rechazado. Sin pique 🕊️`)
      }
      case '!stats': {
        const cfg = await api('/api/config')
        const list = await api('/api/kick/players')
        const pid = `kick_${userId}`
        const p = cfg.players?.[pid]
        if (!p) return reply(`@${username} todavía no tenés ficha; escribí cualquier cosa y te creo una`)
        const st = p.stats || {}
        const row = list.players?.find((r) => r.id === pid)
        const keysLeft = Math.max(0, KEY_CAP - (fightKeys.get(String(userId)) || 0))
        const inv = Object.entries(st.allocated || {}).filter(([, n]) => n > 0)
        const invTxt = inv.length
          ? ` · 📈 ${inv.map(([k, n]) => `${STAT_LABELS[k]} +${n}`).join(', ')}`
          : ' · 📈 sin puntos invertidos todavía'
        return reply(`@${username} Nv ${st.level} · EXP ${st.exp}/${st.expToNextLevel} · 🧬 ${st.attributePoints} pts libres · W:${st.wins} L:${st.losses} · ⚡ ${row?.battlesLeft ?? '?'}/300 de EXP hoy · 🎟️ ${keysLeft}/5 llaves por ganar${invTxt}`)
      }
      case '!invertir': {
        const stat = STAT_MAP[content.trim().split(/\s+/)[1]?.toLowerCase()]
        if (!stat) {
          return reply(`@${username} podés invertir en: ${STAT_KEYS.map((k) => STAT_LABELS[k]).join(' · ')}. Ej: !invertir ataque`)
        }
        const res = await api('/api/allocate', { method: 'POST', body: { player: `kick_${userId}`, stat } })
        const val = res.stats?.allocated?.[stat] ?? 0
        return reply(`@${username} ✨ ${STAT_LABELS[stat]} +${val}`)
      }
      case '!pelea': {
        const list = await api('/api/kick/players')
        const row = list.players?.find((r) => r.id === `kick_${userId}`)
        const keysLeft = Math.max(0, KEY_CAP - (fightKeys.get(String(userId)) || 0))
        return reply(`@${username} ⚡ ${row?.battlesLeft ?? '?'}/300 de EXP hoy · 🎟️ ${keysLeft}/5 llaves diarias del gachapón`)
      }
    }
  } catch (err) {
    await reply(`@${username} ${err.message}`)
  }
}

// -- Anuncio del resultado de cada pelea en el chat --
// El fight server guarda un `lastResult` (estructurado) al terminar cada combate
// (`/api/end`). Este trigger lo chequea por polling y lo anuncia como bot.
let lastResultAt = Date.now() // resultados viejos (antes de arrancar) no se re-anuncian

// Un solo lineaje: Kick no soporta saltos de línea, todo separado por |
function formatResult(r) {
  const entries = r?.p1 && r?.p2 ? [r.p1, r.p2] : null
  if (!entries) return null
  const champ = entries.find((p) => p.champion)
  const loser = entries.find((p) => !p.champion)
  const recap = (p) => {
    const medal = p.champion ? '🏆' : '🥈'
    const exp = p.expGained > 0 ? `+${p.expGained} EXP` : '0 EXP 😔'
    const remain = Math.max(0, (p.expToNextLevel || 0) - (p.exp || 0))
    const progress = p.level >= 999
      ? 'Nv 999 😈 (el admin no pierde)'
      : remain > 0 ? `Nv ${p.level} (faltan ${remain})` : `¡subió a Nv ${p.level}! 🎉`
    return `${medal} @${p.username} ${exp} · ${progress} · ⚡ ${p.expLeft}/300 de EXP hoy`
  }
  const head = champ
    ? `⚔️ @${champ.username} venció a @${loser.username} (${champ.score}-${loser.score}) 🥊 | `
    : `⚔️ @${entries[0].username} y @${entries[1].username} empataron 🥊 | `
  return `${head}${entries.map(recap).join(' | ')}`
}

// Llave del gachapón para 1 de los 2 peleadores (dado 50/50 si ambos pueden).
// Tope KEY_CAP por jugador y por reinicio del backend (Map en memoria → vuelve a 0).
async function awardBattleKey(r, cfg) {
  if (Object.keys(gachaStore.state.characterData).length === 0) return null // gacha aún cargando
  const gachaId = (p) => {
    const raw = String(p?.id || '').replace(/^kick_/, '')
    return /^\d+$/.test(raw) && (fightKeys.get(raw) || 0) < KEY_CAP ? raw : null
  }
  // El username sale de la ficha real (players.json), nunca del id, para no pisar el del gacha.
  const realName = (p) => cfg?.players?.[p?.id]?.username || p?.username
  const pool = [r.p1, r.p2]
    .filter(Boolean)
    .map((p) => ({ uid: gachaId(p), username: realName(p) }))
    .filter((e) => e.uid) // solo no-capados → el dado reparte parejo entre los elegibles
  if (pool.length === 0) return null
  const lucky = pool[Math.floor(Math.random() * pool.length)]
  const used = (fightKeys.get(lucky.uid) || 0) + 1
  fightKeys.set(lucky.uid, used)
  await gachaInventory.addKeys(lucky.uid, 1, lucky.username).catch(() => {})
  return `🎟️ @${lucky.username} se lleva la llave del gachapón (+1 🔑 · ${used}/5 hoy)`
}

async function pollResults() {
  try {
    const cfg = await api('/api/config', { timeout: 4000 })
    const r = cfg?.match?.lastResult
    if (!r?.endedAt || r.endedAt <= lastResultAt) return
    lastResultAt = r.endedAt
    // Solo anunciamos peleas donde participa gente del chat (no la local-p1/local-p2).
    if (!r.p1?.id.startsWith('kick_') && !r.p2?.id.startsWith('kick_')) return
    const msg = formatResult(r)
    if (msg) {
      const keyMsg = await awardBattleKey(r, cfg)
      await chat.sendAsBot(keyMsg ? `${msg} | ${keyMsg}` : msg).catch(() => {})
    }
  } catch { /* fight server aún no arrancado o caído */ }
}

function init() {
  eventBus.on('chat.message.sent', (data) => {
    Promise.resolve(handleMessage(data)).catch((err) => console.error('[FIGHT]', err.message))
  })
  spawnFight()
  // Ficha del admin (GrimVTbot): el server la crea sola, pero la aseguramos si apunta a
  // una URL remota o si el server ya tenía una versión vieja del personaje.
  api('/api/kick/players/upsert', { method: 'POST', body: { kick_id: GRIM_KICK_ID, username: GRIM_USERNAME } }).catch(() => {})
  setInterval(pollResults, 2000)
  console.log('[FIGHT] Inicializado')
}

// -- Router (proxy hacia el fight server para el dashboard) --
const router = express.Router()

router.get('/api/status', async (_req, res) => {
  const lanIp = state.lanIp || 'localhost'
  res.json({
    ok: true,
    running: !!(child || await isUp()),
    url: `${FIGHTING_URL}/`,
    lanUrl: `http://${lanIp}:${PORT}/`,
    lanPlayersUrl: `http://${lanIp}:${PORT}/players`,
    lanCalibrateUrl: `http://${lanIp}:${PORT}/calibrate`,
  })
})

router.get('/api/players', async (_req, res) => {
  try {
    const cfg = await api('/api/config')
    const list = await api('/api/kick/players')
    const players = Object.entries(cfg.players || {})
      .map(([id, p]) => {
        const row = list.players?.find((r) => r.id === id) || {}
        const st = p.stats || {}
        return {
          id,
          username: p.username,
          level: st.level ?? 0,
          exp: st.exp ?? 0,
          expToNextLevel: st.expToNextLevel,
          attributePoints: st.attributePoints ?? 0,
          wins: st.wins ?? 0,
          losses: st.losses ?? 0,
          battlesLeft: row.battlesLeft ?? 0,
        }
      })
      .sort((a, b) => b.level - a.level || b.exp - a.exp || a.username.localeCompare(b.username))
    res.json({ ok: true, players })
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message })
  }
})

module.exports = { router, init }