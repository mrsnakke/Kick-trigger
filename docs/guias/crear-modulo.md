# Cómo añadir una nueva funcionalidad / módulo (paso a paso)

Guía práctica para crear un módulo nuevo de principio a fin, siguiendo el patrón del
repo para **no romper nada**.

Primero decide el **nivel de complejidad**. Hay tres patrones:

| Patrón | ¿Cuándo? | ¿Qué expone? |
|---|---|---|
| **A — Simple** | Solo reacciona a eventos del bus, sin API/UI | `index.js` que escucha el bus |
| **B — Completo** | Necesita endpoints HTTP y/o UI web | `{ router, init }` |
| **C — Completo + WebSocket** | Necesita conexión WebSocket (overlays) | `{ router, init, initWs }` |

---

## Índice rápido

- [Patrón A — Simple](#patrón-a--simple-solo-escucha-el-bus)
- [Patrón B — Completo (router + init)](#patrón-b--completo-router--init)
- [Patrón C — Completo + WebSocket](#patrón-c--completo-websocket)
- [Añadir un comando de chat](#añadir-un-comando-de-chat)
- [Añadir un endpoint HTTP](#añadir-un-endpoint-http)
- [Enviar un mensaje de chat desde tu módulo](#enviar-un-mensaje-de-chat-desde-tu-módulo)
- [Persistir datos de tu módulo](#persistir-datos-de-tu-módulo)
- [Enviar eventos SSE al dashboard](#enviar-eventos-sse-al-dashboard)
- [Ejemplo completo de punta a punta](#ejemplo-completo-vamos-a-hacer-un-módulo-me-bailas)
- [Checklist final](#checklist-final)

---

## Patrón A — Simple (solo escucha el bus)

Un solo archivo. Ideal para lógica reactiva sin API.

**`modules/triggers/mi-modulo/index.js`:**
```js
const eventBus = require('../../../lib/event-bus')

eventBus.on('chat.message.sent', (data) => {
  const msg = data.payload?.message?.content || ''
  const user = data.payload?.sender?.username
  if (!msg.startsWith('!hola')) return
  console.log(`[MI-MODULO] Saludo de @${user}`)
})

console.log('[MI-MODULO] Cargado')
```

**En `server.js`**, añade el require con los demás:
```js
require('./modules/triggers/mi-modulo')
```

> 📁 Ruta relativa al event bus: dentro de `triggers/<modulo>/` es
> `../../../lib/event-bus` (sube 3: modulo → triggers → modules → raíz).

---

## Patrón B — Completo (router + init)

Para módulos con endpoints HTTP y/o UI.

**`modules/triggers/mi-modulo/index.js`:**
```js
const path = require('path')
const fs = require('fs')
const express = require('express')
const eventBus = require('../../../lib/event-bus')

const router = express.Router()
const DATA_PATH = path.join(__dirname, 'mi-data.json')

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) }
  catch { return { saludos: 0 } }           // default si no existe
}

// — Endpoints HTTP —
router.get('/api/status', (req, res) => {
  res.json({ ok: true, data: load() })
})

// Sirve tu UI web (si tenés una carpeta public/)
router.use(express.static(path.join(__dirname, 'public')))

// — Init (se llama desde server.js) —
function init() {
  eventBus.on('chat.message.sent', (data) => {
    const msg = data.payload?.message?.content || ''
    if (!msg.startsWith('!hola')) return
    const d = load(); d.saludos++
    fs.writeFileSync(DATA_PATH, JSON.stringify(d, null, 2))
    console.log('[MI-MODULO] Saludos:', d.saludos)
  })
  console.log('[MI-MODULO] Inicializado')
}

module.exports = { router, init }
```

**En `server.js`:**
```js
const miModulo = require('./modules/triggers/mi-modulo')
// ...
app.use('/mi-modulo', miModulo.router)
miModulo.init()
```

Ahora tu módulo responde en `http://localhost:3000/mi-modulo/api/status`.

---

## Patrón C — Completo + WebSocket

Como GACHA o Strinova, que usan WebSocket para overlays. Igual que el B pero además
exporta `initWs(server)` y montas el WS **antes** de `server.listen`.

```js
const WebSocket = require('ws')

function initWs(server) {
  const wss = new WebSocket.Server({ server, path: '/ws/mi-modulo' })
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'init', data: {} }))
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw)
      // maneja mensajes del cliente
    })
  })
}

module.exports = { router, init, initWs }
```

**En `server.js`** (el orden importa):
```js
miModulo.initWs(server)   // 1. antes de server.listen
miModulo.init().catch(...)
app.use('/mi-modulo', miModulo.router)  // 2. el router
```

> ⚠️ Si varios módulos usan WS, cada uno debe usar un `path` distinto (`/ws/gacha`,
> `/ws/strinova`). No comparten "upgrade".

---

## Añadir un comando de chat

La mayoría de triggers reaccionan a `!comandos` escuchando `chat.message.sent` y
filtrando por prefijo.

```js
eventBus.on('chat.message.sent', (data) => {
  const content = data.payload?.message?.content || ''
  const user = data.payload?.sender?.username
  if (!content.startsWith('!miComando')) return

  const arg = content.replace('!miComando', '').trim()
  // haz algo con arg / user
})
```

Para **responder** en el chat (como usuario principal) usa `chat.send()`; como **bot**,
`chat.sendAsBot()`. Ver [Enviar un mensaje de chat](#enviar-un-mensaje-de-chat-desde-tu-módulo).

> 📌 Acuérdate de reflejar el comando en el dashboard (pestaña Comandos) — ver
> [estandares.md §9](../estandares.md#9-añadir-un-comando-de-chat--no-olvides-el-dashboard).

---

## Añadir un endpoint HTTP

Los endpoints de tu módulo viven en su `router`. Se montan bajo tu sub-path.

```js
router.post('/api/accion', express.json(), (req, res) => {
  try {
    const { dato } = req.body
    if (!dato) return res.status(400).json({ error: 'Falta dato' })
    // lógica...
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
```

> Si tu módulo está montado en `/mi-modulo`, este endpoint queda en
> `POST /mi-modulo/api/accion`.

---

## Enviar un mensaje de chat desde tu módulo

Usa `modules/chat.js`. No hagas el POST a Kick a mano.

```js
const chat = require('../../chat')   // desde modules/triggers/<m>/ → ../../chat
// o desde la raíz de un trigger: require('. /../../chat') ajusta según tu profundidad

// Como usuario principal:
chat.sendAsBot('¡Hola comunidad!')   // bot (requiere botTokens autorizado)
```

- `chat.send(req, res)` — handler HTTP para la ruta `/api/chat/send`.
- `chat.sendAsBot(content, replyTo?)` — función programática; envía como bot y devuelve el
  resultado. La usa VTuber AI y Gacha. Lanza error si el bot no está autenticado.

> La síntesis de voz (TTS2) se dispara escuchando el evento `tts2:speak`, o desde
> vtuber-ai emitiendo `tts2:speak`. Para que un mensaje se lea en voz alta, se puede
> emitir `eventBus.emit('tts2:speak', { text, voice, origin })`.

---

## Persistir datos de tu módulo

Guarda en un JSON dentro de tu carpeta. Patrón estándar:

```js
const path = require('path'); const fs = require('fs')
const F = path.join(__dirname, 'mi-data.json')

function load()   { try { return fs.existsSync(F) ? JSON.parse(fs.readFileSync(F,'utf8')) : {} } catch { return {} } }
function save(d)  { fs.writeFileSync(F, JSON.stringify(d, null, 2)) }
```

> No pongas claves ni datos de usuarios en git. Revisa `.gitignore` (muchos de estos
> archivos ya están ignorados).

---

## Enviar eventos SSE al dashboard

```js
const sse = require('../../sse')   // ajusta ruta según profundidad

sse.broadcast({ type: 'mi-tipo', _source: 'mi-modulo', ...datos })
```

⚠️ Nunca uses `type: 'status'` (reservado). Usa tu propio `type` y, de preferencia,
`_source`. Ver [estandares.md §7](../estandares.md#7-sse--tipos-reservados).

---

## Ejemplo completo — "Vamos a hacer un módulo: `!me-bailas`"

Un módulo completo (Patrón B) que cuando un usuario escribe `!me-bailas`, responde en
chat y guarda un contador.

**1. Crear la carpeta y el archivo**
```
modules/triggers/me-bailas/index.js
```

**2. Contenido de `index.js`**
```js
const path = require('path')
const fs = require('fs')
const express = require('express')
const eventBus = require('../../../lib/event-bus')
const chat = require('../../chat')

const router = express.Router()
const DATA = path.join(__dirname, 'bailes.json')

function load() {
  try { return fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA, 'utf8')) : {} }
  catch { return {} }
}
function save(d) { fs.writeFileSync(DATA, JSON.stringify(d, null, 2)) }

router.get('/api/status', (_req, res) => res.json({ total: Object.values(load()).reduce((a, b) => a + b, 0) }))

function init() {
  eventBus.on('chat.message.sent', async (data) => {
    const content = data.payload?.message?.content || ''
    const user = data.payload?.sender?.username
    if (!content.startsWith('!me-bailas')) return
    const d = load()
    d[user] = (d[user] || 0) + 1
    save(d)
    try {
      await chat.sendAsBot(`@${user} ¡${d[user]} bailes acumulados! 💃`)
    } catch (err) {
      console.error('[ME-BAILAS]', err.message)
    }
  })
  console.log('[ME-BAILAS] Inicializado')
}

module.exports = { router, init }
```

**3. Enganchar en `server.js`:**
```js
const meBailas = require('./modules/triggers/me-bailas')
// (con los otros requires, arriba)
app.use('/me-bailas', meBailas.router)
meBailas.init()
```

**4. Probar:**
- Arranca `node server.js`.
- Escribe `!me-bailas` en el chat de Kick.
- El bot responde y luego `GET /me-bailas/api/status` muestra el total.

---

## Checklist final

- [ ] Carpeta en `modules/triggers/` con su `index.js`.
- [ ] (si aplica) `package.json` propio + `npm install`.
- [ ] Escucha eventos del bus con try/catch propio.
- [ ] Lógica idempotente ante duplicados.
- [ ] Sub-path único; endpoint de estado (`/api/status`) de cortesía.
- [ ] Comandos reflejados en el dashboard.
- [ ] Enganchado en `server.js` (orden: `initWs` antes de `listen`, `init` y `router` después).
- [ ] No tocaste nada del core.
