# Arquitectura y estructura

## Visión general

Backend **Node.js / Express** que se conecta a Kick para:

- Autorizar canales vía **OAuth PKCE** (cuenta principal + cuenta bot).
- Recibir **webhooks** de Kick (mensajes, follows, subs, rewards, etc.).
- Enviar **mensajes al chat**.
- Suscribirse/dessuscribirse a eventos de Kick.
- Exponer un **dashboard web en vivo** (SSE) y un **sistema de módulos de reacción**
  (triggers) que responden a los eventos.

No usa base de datos: persiste todo en **archivos JSON** dentro del proyecto.

## Estructura de carpetas

```
kick-backend/
│
├── server.js                    # ★ ENTRY POINT: crea Express, monta todas las rutas e inicializa módulos
├── package.json                 # Dependencias del core (express, openai, ws, multer)
├── .env                         # Config sensible (NO se sube a git)
├── tokens.json                  # Tokens OAuth persistidos (cuenta principal)
├── bot_tokens.json              # Tokens OAuth persistidos (cuenta bot)
├── cloudflared.yml              # Config del túnel (se regenera automáticamente)
│
├── lib/                         # ★ NÚCLEO: librerías base utilizadas por todo el sistema
│   ├── config.js                #   Parser .env + constantes globales
│   ├── state.js                 #   Estado compartido mutable (objeto plano)
│   ├── event-bus.js             #   EventEmitter singleton — ★ sistema nervioso central
│   └── forwarder.js             #   Reenvío HTTP opcional de eventos a otras máquinas
│
├── modules/                     # ★ MÓDULOS del core (funcionales)
│   ├── auth.js                  #   OAuth PKCE + gestión de tokens
│   ├── webhook.js               #   Receptor de webhooks Kick + validación de firma RSA
│   ├── chat.js                  #   Envío de mensajes al chat de Kick
│   ├── tunnel.js                #   Gestión del túnel Cloudflare
│   ├── sse.js                   #   Push SSE al dashboard web
│   ├── events.js                #   Suscripción/dessuscripción a eventos de Kick
│   │
│   └── triggers/                # ★ TRIGGERS: módulos de reacción (plugins). No tocan el core.
│       ├── TTS2/                #   Texto → voz con SAPI (PowerShell)
│       ├── vtuber-ai/           #   IA conversacional (DeepSeek) + VTube Studio
│       │                        #     y consume "iA Vision" internamente
│       ├── GACHA/               #   Sistema de gacha (personajes, overlays OBS)
│       ├── obs-actions/         #   Control de OBS vía WebSocket
│       ├── Music/               #   Control de reproductor YouTube externo
│       ├── chatbot/             #   Comandos personalizados + timers
│       ├── event-actions/       #   Detección de primer mensaje + miniprompts
│       ├── strinova-app/        #   Ruleta Strinova + overlay OBS
│       └── "iA Vision"/         #   ★ Librería INTERNA (screenshot + visión AI).
│                                #     NO es un router; la usa vtuber-ai.
│
├── public/                      # Static: dashboard web (index.html) + imágenes de badges
├── logs/vtuber-ai/              # Historial de conversaciones de la IA (JSONL)
│
├── docs/                        # ★ ESTA documentación (empezar por 00-indice.md)
├── iniciar.bat / iniciar.vbs    # Lanzadores de Windows
└── setup-cloudflare.bat         # Setup del túnel Cloudflare (una vez)
```

### En qué fijarse

- `server.js` es el **único** lugar donde se registran rutas Express e inicializan módulos.
- `lib/` y `modules/*.js` del core forman el "núcleo duro": **no se tocan** desde triggers.
- Los `triggers/` se comunican exclusivamente a través del **Event Bus** y de `lib/state.js`.
- Cada trigger es una carpeta autocontenida; algunos traen su propio `package.json`.

## Flujo de datos (end-to-end)

```
                            ┌───────────────────────────┐
                            │       KICK (Internet)     │
                            │  API de Kick + Webhooks   │
                            └─────────────┬─────────────┘
                                          │  webhook HTTPS
                                          ▼
                      ┌──────────────────────────────────┐
                      │  cloudflared tunnel (opcional)   │  ← expone localhost:3000
                      │  URL pública = state.tunnelUrl   │
                      └───────────────┬──────────────────┘
                                      │  http://localhost:3000
                                      ▼
   ┌────────────────────────────────────────────────────────────────┐
   │                      server.js (Express)                        │
   │                                                                 │
   │   /webhook/kick ──► webhook.handle()                            │
   │        │              1. valida firma RSA-SHA256                │
   │        │              2. deduplica (10 min)                     │
   │        │              3. eventBus.emit(evento, {payload, ts})   │
   │        │              4. sse.broadcast(evento)                  │
   │        ▼                                                        │
   │   ┌──────────────── intranet ───────────────────────┐           │
   │   │  Event Bus (lib/event-bus.js)  EventEmitter     │           │
   │   │  – distribuye el evento a TODOS los listeners   │           │
   │   │  – forwarder.js reenvía a otras máquinas (opc.) │           │
   │   └───────┬──────────┬──────────┬──────────────────┘           │
   │           ▼          ▼          ▼                              │
   │      TTS2        vtuber     obs-actions     GACHA  Music       │
   │      chatbot   event-actions  strinova        ...              │
   │           │  (cada uno reacciona / emite más eventos)          │
   │                                                                 │
   │   SSE ──► /api/events ──► Dashboard web (public/index.html)     │
   │   WS   ──► /ws/gacha, /ws/strinova ──► overlays OBS             │
   │                                                                 │
   │   Salida: chat.send() / chat.sendAsBot()  ──► API de Kick       │
   │           TTS (voz local) / OBS / reproductor YouTube           │
   └────────────────────────────────────────────────────────────────┘
```

### Pasos del flujo principal (un mensaje de chat)

1. Un viewer escribe en el chat de Kick.
2. Kick envía el webhook `chat.message.sent` a la URL pública del túnel.
3. `webhook.handle()` valida la firma y emite `eventBus.emit('chat.message.sent', {payload, ts})`.
4. El Event Bus notifica en paralelo a: dashboard (SSE), forwarder, y todos los triggers.
5. Cada trigger decide si le interesa (p. ej. TTS busca el comando `!sp`, VTuber busca `!grim`, gacha busca `!pull`...).
6. Si un trigger quiere responder, usa `chat.sendAsBot()` o `chat.send()` → POST a la API de Kick.

```
                    Frontend (dashboard/overlays) ↔ Backend ↔ Archivos JSON ↔ Servicios de terceros
   ┌──────────────────┐       SSE/WS       ┌──────────────┐    fs.io     ┌─────────────────────────┐
   │  Dashboard web   │◄──────────────────►│  server.js   │◄───────────► │ tokens.json, *-data.json│
   │  index.html      │                    │  + Event Bus │              │ state.json, logs/*.jsonl│
   │  overlays gacha  │◄──WS(/ws/gacha)───►│              │              └─────────────────────────┘
   │  overlays strin  │◄──WS(/ws/strinova)►│              │              ┌─────────────────────────┐
   └──────────────────┘                    └──────┬───────┘              │ Servicios de terceros   │
                                                  │  HTTP/HTTPS          │  – Kick API OAuth        │
                                                  ├────────────────────► │  – DeepSeek (IA)         │
                                                  ├────────────────────► │  – VTube Studio (WS)     │
                                                  ├────────────────────► │  – OBS (WS)              │
                                                  ├────────────────────► │  – reproductor YouTube   │
                                                  └────────────────────► │  – cloudflared           │
                                                                         └─────────────────────────┘
```

## Event Bus — el sistema nervioso central

`lib/event-bus.js` exporta una **única instancia** de `EventEmitter` de Node.js
(con `setMaxListeners(100)`). Es el mecanismo de comunicación **desacoplado**: el core
**emite** eventos, los triggers **escuchan**; nadie importa a nadie directamente.

```js
// Emitir un evento (cualquier módulo)
const eventBus = require('../../lib/event-bus')
eventBus.emit('mi.evento', { dato: 1 })

// Escuchar un evento (típico en triggers)
const eventBus = require('../../../lib/event-bus')
eventBus.on('chat.message.sent', (data) => {
  // data = { payload, ts }
})
```

Puedes emitir **cualquier evento nuevo** con cualquier nombre; no hace falta registrarlo.
La clave: **asume que pueden llegarte eventos duplicados** (la dedup de webhooks es de
10 min) → tu lógica debe ser idempotente.

Lista completa de eventos: [referencia/eventos.md](referencia/eventos.md).

## Persistencia (dónde guarda cada cosa — archivos JSON)

| Archivo | Contenido | Lo escribe |
|---|---|---|
| `tokens.json` | Token OAuth de la cuenta principal | `modules/auth.js` |
| `bot_tokens.json` | Token OAuth de la cuenta bot | `modules/auth.js` |
| `cloudflared.yml` | Config del túnel (se regenera sola) | `modules/tunnel.js` |
| `TTS2/tts-data.json` | userAliases y bannedWords del TTS | `modules/triggers/TTS2/` |
| `TTS2/config.json` | Config de voces/salidas del TTS | `modules/triggers/TTS2/` |
| `vtuber-ai/vtuber-data.json` | API key y config de VTuber AI | `modules/triggers/vtuber-ai/` |
| `logs/vtuber-ai/*.jsonl` | Conversaciones por usuario | `modules/triggers/vtuber-ai/logger.js` |
| `event-actions/chatters.json` | Usuarios que ya escribieron | `modules/triggers/event-actions/` |
| `event-actions/event-actions-config.json` | Miniprompts por evento | `modules/triggers/event-actions/` |
| `obs-actions/obs-data.json` | Acciones/triggers/grupos de OBS | `modules/triggers/obs-actions/store.js` |
| `chatbot/chatbot-data.json` | Comandos y timers del chatbot | `modules/triggers/chatbot/store.js` |
| `Music/config.json` | Config del reproductor | `modules/triggers/Music/` |
| `strinova-app/state.json` | Posiciones/historial/rango de la ruleta | `modules/triggers/strinova-app/` |
| `GACHA/...` | Datos de gacha (inventarios, banners, etc.) | `modules/triggers/GACHA/` |

> 🛑 **Ojo con git:** muchos de estos archivos guardan datos locales. Revisa `.gitignore`
> antes de hacer commit. Los `tokens.json`, `bot_tokens.json`, `*.env` y las bases de
> datos JSON **no deberían subirse**.

## Estado compartido (`lib/state.js`)

Objeto plano mutable, accesible desde cualquier módulo:

```js
const state = require('../lib/state')
console.log(state.tunnelUrl)
```

| Propiedad | Tipo | Descripción |
|---|---|---|
| `tokens` | `object\|null` | Tokens OAuth de la cuenta principal |
| `botTokens` | `object\|null` | Tokens OAuth de la cuenta bot |
| `broadcasterUserId` | `string\|null` | ID numérico del canal |
| `channelSlug` | `string\|null` | Slug del canal |
| `tunnelUrl` | `string\|null` | URL pública del túnel activo |
| `sseClients` | `array` | Conexiones SSE activas |
| `eventsCounter` | `number` | Total de eventos procesados |
| `authFailCount` | `number` | Fallos consecutivos de auth (principal) |
| `botAuthFailCount` | `number` | Fallos consecutivos de auth (bot) |

## Configuración (`lib/config.js`)

Lee `.env` al arrancar y exporta constantes: `PORT`, `CLIENT_ID`, `CLIENT_SECRET`,
`REDIRECT_URI`, `CF_TUNNEL_NAME`, `CF_DOMAIN`, `CF_BIN`, `CF_CREDENTIALS_DIR`,
`CF_CONFIG`, `TOKENS_PATH`, `BOT_TOKENS_PATH`, `DEEPSEEK_API_KEY`, `FORWARD_URLS`
(array autogenerado desde todas las `FORWARD_URL_*`), `TEN_MINUTES`.

## Comunicación en tiempo real

- **SSE** (`/api/events`) → el dashboard web (`public/index.html`). `sse.broadcast()` empuja
  mensajes a todos los clientes.
- **WebSocket** (`/ws/gacha`, `/ws/strinova`) → los overlays de OBS (Browser Sources).

> ⚠️ El tipo SSE `status` está **reservado** para el estado del servidor. Si un módulo
> quiere enviar estado periódico, debe usar su propio `type` (p. ej. `music-status`) o
> incluir `_source: '<modulo>'` y manejarlo aparte en el frontend. Ver
> [estandares.md](estandares.md#sse-tipos-reservados).

## Heartbeat

`server.js` corre un `setInterval(heartbeat, 300000)` (cada 5 min):
1. Refresca el token si hace falta.
2. Reinicia el túnel si está caído.
3. Verifica que las 10 suscripciones de eventos estén activas; si hay menos de 10, re-subscribe.

## Forwarder (reenvío a otras máquinas)

Si hay `FORWARD_URL_*` en `.env`, `lib/forwarder.js` reenvía cada evento Kick (y algunos
internos relevantes) como POST a cada URL:

```json
{
  "event": "channel.reward.redemption.updated",
  "data": { "payload": { ... }, "ts": "..." },
  "source": "kick-backend",
  "ts": "2026-06-27T..."
}
```

Fire-and-forget con catch silencioso.

## Próximos pasos

- [Guía para crear un módulo nuevo](guias/crear-modulo.md)
- [Guía para modificar un módulo existente](guias/modificar-modulo.md)
- [Reglas y estándares](estandares.md)
