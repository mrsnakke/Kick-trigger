# Módulos del core (`modules/` + `lib/`)

Referencia exhaustiva del núcleo del backend. Estos son los archivos que **no debes
tocar** salvo necesidad real (ver [estandares.md §1](../estandares.md#1-regla-de-oro-no-toques-el-core)).

---

## `lib/event-bus.js` — evento bus (nervio central)

Exporta una **instancia singleton** de `EventEmitter` (Node.js) con `setMaxListeners(100)`.

```js
const bus = require('./lib/event-bus')
bus.emit('evento', data)
bus.on('evento', (data) => {})
```

Lista completa de eventos: [referencia/eventos.md](../referencia/eventos.md).

---

## `lib/config.js` — configuración global

Lee `.env` línea a línea al arrancar e inyecta en `process.env`, luego exporta constantes:

| Constante | Fuente (.env) | Descripción |
|---|---|---|
| `PORT` | `PORT` | Puerto HTTP (default 3000) |
| `CLIENT_ID` | `KICK_CLIENT_ID` | Client ID de la app Kick |
| `CLIENT_SECRET` | `KICK_CLIENT_SECRET` | Client secret |
| `REDIRECT_URI` | `KICK_REDIRECT_URI` | Default `http://localhost:PORT/auth/callback` |
| `CF_TUNNEL_NAME` | `CF_TUNNEL_NAME` | Nombre del túnel Cloudflare |
| `CF_DOMAIN` | `CF_DOMAIN` | Subdominio público del túnel |
| `CF_BIN` | — | Ruta de `cloudflared.exe` (default `%LOCALAPPDATA%\cloudflared\cloudflared.exe`) |
| `CF_CREDENTIALS_DIR` | — | `~/.cloudflared` |
| `CF_CONFIG` | — | `cloudflared.yml` en la raíz |
| `TOKENS_PATH` / `BOT_TOKENS_PATH` | — | `tokens.json` / `bot_tokens.json` |
| `DEEPSEEK_API_KEY` | `DEEPSEEK_API_KEY` o `VTUBER_API_KEY` | Clave de IA |
| `FORWARD_URLS` | `FORWARD_URL_*` | Array de URLs de reenvío (auto-descubiertas) |
| `TEN_MINUTES` | — | `600000` (ventana dedup webhook) |

---

## `lib/state.js` — estado compartido mutable

Objeto plano (sin getters/setters). Ver tabla en [arquitectura.md](../arquitectura.md#estado-compartido-libstatejs).

---

## `lib/forwarder.js` — reenvío a otras máquinas

`init()` registra listeners en el bus para los eventos de Kick (`chat.message.sent`,
`channel.followed`, ...) e internos relevantes (`auth:ready`, `auth:disconnected`,
`tunnel:open`, `tunnel:closed`). Por cada evento hace un POST fire-and-forget a cada URL
de `config.FORWARD_URLS`.

---

## `modules/auth.js` — OAuth PKCE + tokens

Soporta **dos cuentas independientes**: la principal (usuario/streamer) y el **bot**.

### Flujo
1. `login()` / `botLogin()` generan `code_verifier` + `code_challenge` y redirigen a Kick.
2. Kick redirige a `callback()` con el código.
3. `callback()` intercambia el código por tokens y los persiste en
   `tokens.json` / `bot_tokens.json`.
4. `autoFlow()` / `botAutoFlow()` validan el token, obtienen info del canal y emiten `auth:ready`.

### Funciones exportadas
| Función | Descripción |
|---|---|
| `login(req,res)` / `botLogin(req,res)` | Inician OAuth (handlers de ruta) |
| `callback(req,res)` | Recibe el código OAuth |
| `ensureValidToken()` | Refresca el token principal si expira en <60s (con retry 2s) |
| `ensureValidBotToken()` | Igual para el bot |
| `fetchChannelInfo()` | Obtiene `state.broadcasterUserId` y `state.channelSlug` |
| `loadTokens()` / `loadBotTokens()` | Carga tokens de disco al arrancar |
| `autoFlow()` / `botAutoFlow()` | Init automático al arrancar |

### Eventos que emite
- `auth:token-refreshed` — token principal refrescado
- `bot:token-refreshed` — token bot refrescado
- `auth:ready` `{ slug }` — auth exitoso
- `auth:disconnected` — 3 fallos consecutivos (borra tokens)

### Scopes OAuth
`events:subscribe`, `chat:write`, `channel:read`, `channel:rewards:read`, `user:read`.

---

## `modules/webhook.js` — receptor de webhooks Kick

`handle(req,res)`:
1. **GET** → verificación de Kick, responde 200.
2. **POST** → valida:
   - Cabeceras `kick-event-signature`, `kick-event-message-id`, `kick-event-message-timestamp`.
   - Timestamp dentro de ±5 min.
   - Dedup por `message-id` (ventana de 10 min).
   - Firma RSA-SHA256 contra la clave pública de Kick (hardcodeada + refresh dinámico)
     → si falla, refresca la clave y devuelve 401.
3. Válido → `eventBus.emit(evType, { payload: req.body, ts })` y `sse.broadcast(...)`.

El `evType` viene de la cabecera `Kick-Event-Type` (ej. `chat.message.sent`), por lo que
**cualquier** evento de Kick se re-emite al bus con su nombre.

Exporta `{ handle, fetchPublicKey }`.

---

## `modules/chat.js` — envío de mensajes al chat

| Función | Descripción |
|---|---|
| `send(req,res)` | Handler de `POST /api/chat/send` — envía como usuario principal |
| `sendAsBot(content, replyTo?)` | Envía como **bot** (programático). Error si `state.botTokens` es null |

Interna: `sendToKick(tokens, content, type, replyTo)` hace `POST https://api.kick.com/public/v1/chat`
con `{ broadcaster_user_id, content, type, reply_to_message_id }`. Máx. 500 caracteres.

Al enviar con éxito emite `chat:sent` `{ content, message_id }` y SSE `{ type: 'sent' }`.

---

## `modules/tunnel.js` — túnel Cloudflare

`startTunnel()`: verifica que no corra, busca credenciales en `~/.cloudflared/`, genera
`cloudflared.yml`, spawnea `cloudflared tunnel run <name>`, escucha stderr buscando
"Registered tunnel"/"Connection established", hace health check a
`https://<CF_DOMAIN>/api/status` (5 intentos, 2s de espera). Timeout 60s. Reconexión
automática a los 10s si el proceso muere inesperadamente. Mata el proceso al salir.

### Eventos que emite
- `tunnel:open` `{ url }`
- `tunnel:closed` `{ exitCode, log }`
- `tunnel:error` `{ error }`

### Exportadas
`startTunnel`, `startHandler`, `stopHandler`, `getTunnelProcess`, `getTunnelIntentionalStop`,
`setTunnelIntentionalStop`.

---

## `modules/sse.js` — Server-Sent Events

`handle(req,res)` abre la conexión SSE y registra al cliente en `state.sseClients`. Al
conectar envía estado inicial (`status`, `auth`, `bot-auth`) y emite `tts:request_status`.
`broadcast(data)` envía `data: <json>\n\n` a todos los clientes.

Exporta `{ broadcast, handle }`.

⚠️ **El tipo `status` está reservado.** Ver [estandares.md §7](../estandares.md#7-sse--tipos-reservados).

---

## `modules/events.js` — suscripción a eventos de Kick

| Función | Descripción |
|---|---|
| `listSubscriptions()` | Lista suscripciones activas |
| `subscribeToEvents()` | Borra las viejas y suscribe las 10 estándar |
| `subscribeWithRetry(max=6, delay=10s)` | Reintenta la suscripción |
| `listHandler` / `subscribeHandler` | Handlers HTTP |

Escucha `tunnel:open` → se auto-suscribe (con retry).

**Los 10 eventos suscritos:**

| Evento | Versión |
|---|---|
| `chat.message.sent` | v1 |
| `channel.followed` | v1 |
| `channel.subscription.new` | v1 |
| `channel.subscription.renewal` | v1 |
| `channel.subscription.gifts` | v1 |
| `channel.reward.redemption.updated` | v1 |
| `livestream.status.updated` | v1 |
| `livestream.metadata.updated` | v1 |
| `moderation.banned` | v1 |
| `kicks.gifted` | v1 |

---

## `server.js` — entry point (montaje de rutas)

Registra middleware, rutas del core y monta los routers de los triggers. Orden de
inicialización importante:

1. Middlewares: `express.json` (con `verify` que guarda `req.rawBody` para webhook), estáticos.
2. Rutas del core (auth, webhook, SSE, chat, status, subscriptions, túnel, shutdown).
3. `ttsTrigger.init()`, `obsActions.init()`, `music.init()`, `chatbot.init()`.
4. `gacha.initWs(server)` + `app.use('/gacha', ...)`; `strinova.initWs(server)` + `/strinova`.
5. En `server.listen`: carga tokens, `webhook.fetchPublicKey()`, inicializa GACHA/
   Strinova/Music, arranca el túnel con reintentos, y el heartbeat (cada 5 min).

Todos los endpoints HTTP registrados: [referencia/endpoints.md](../referencia/endpoints.md).

WebSockets: `/ws/gacha` (GACHA) y `/ws/strinova` (Strinova).

ChatWidget: overlay de chat para OBS (mismo estilo cyberpunk neon verde), se controla
desde el dashboard y guarda su config en `data/chatwidget-config.json`.
Detalles: [modulos/chatwidget.md](chatwidget.md).
