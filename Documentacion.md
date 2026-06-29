# Kick Backend — Documentación completa

Backend Node.js para conectar con la API de Kick: OAuth, webhooks, chat, suscripción a eventos y túnel Cloudflare. Incluye dashboard web en vivo y un sistema modular de triggers reactivos.

---

## Índice

1. [Arquitectura general](#1-arquitectura-general)
2. [Configuración inicial](#2-configuración-inicial)
3. [Estructura del proyecto](#3-estructura-del-proyecto)
4. [Librerías base (`lib/`)](#4-librerías-base-lib)
5. [Módulos del core (`modules/`)](#5-módulos-del-core-modules)
6. [Triggers (`modules/triggers/`)](#6-triggers-modulestriggers)
7. [Dashboard web (`public/index.html`)](#7-dashboard-web-publicindexhtml)
8. [API Endpoints](#8-api-endpoints)
9. [Event Bus — sistema nervioso central](#9-event-bus--sistema-nervioso-central)
10. [Eventos de Kick (webhook)](#10-eventos-de-kick-webhook)
11. [Eventos internos](#11-eventos-internos)
12. [Comandos del chat](#12-comandos-del-chat)
13. [Cómo agregar un nuevo módulo/trigger](#13-cómo-agregar-un-nuevo-módulotrigger)
14. [Overlays en otra PC (Stream PC)](#14-overlays-en-otra-pc-stream-pc)
15. [Forwarder (reenvío a otras máquinas)](#15-forwarder-reenvío-a-otras-máquinas)
16. [Heartbeat](#16-heartbeat)
17. [Estado compartido](#17-estado-compartido)
18. [Archivos de lanzamiento](#18-archivos-de-lanzamiento)

---

## 1. Arquitectura general

```
Internet (Kick API)
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│                    cloudflared tunnel                    │
│           (opcional, expone el backend a Internet)       │
└────────────────────────┬─────────────────────────────────┘
                         │
                    Puerto 3000
                         │
┌────────────────────────▼─────────────────────────────────┐
│                     server.js                            │
│  Express + HTTP + WebSocket                              │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │  Auth    │  │ Webhook  │  │  Chat    │  │  Events │  │
│  │  OAuth   │  │ Validación│  │  Envío   │  │  Subsc. │  │
│  │  PKCE    │  │  RSA     │  │  msgs    │  │         │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐  │
│  │  Tunnel  │  │  SSE     │  │    Event Bus          │  │
│  │  CF      │  │  Push    │  │  (EventEmitter)       │  │
│  └──────────┘  └──────────┘  └──────┬────────────────┘  │
│                                      │                    │
│                          ┌───────────┼───────────┐        │
│                          ▼           ▼           ▼        │
│                    ┌────────┐ ┌────────┐ ┌────────────┐   │
│                    │  TTS   │ │ GACHA  │ │ VTuber AI  │   │
│                    │Speaker │ │ Gacha  │ │ DeepSeek   │   │
│                    │.bot WS │ │ Sist.  │ │ + chat     │   │
│                    └────────┘ └────────┘ └────────────┘   │
│                    ┌────────┐ ┌────────┐                  │
│                    │ OBS-Act│ │ Music  │                  │
│                    │ Control│ │YouTube │                  │
│                    └────────┘ └────────┘                  │
└──────────────────────────────────────────────────────────┘
```

**Flujo de datos:**

1. Kick envía webhooks al túnel → Express recibe en `/webhook/kick`
2. `webhook.js` valida firma RSA, deduplica, emite al Event Bus
3. El Event Bus notifica a todos los triggers suscritos
4. `sse.js` empuja al dashboard web en tiempo real
5. `forwarder.js` reenvía a otras máquinas si está configurado
6. Los triggers reaccionan (TTS, Gacha, VTuber, OBS, Music)

---

## 2. Configuración inicial

### 2.1 Crear app en Kick Developers

1. Ir a https://dev.kick.com/applications
2. Crear app con Redirect URI: `http://localhost:3000/auth/callback`
3. Copiar `KICK_CLIENT_ID` y `KICK_CLIENT_SECRET` al `.env`

### 2.2 Configurar `.env`

```env
KICK_CLIENT_ID=tu_client_id
KICK_CLIENT_SECRET=tu_client_secret

# Cloudflare Tunnel (URL fija)
CF_TUNNEL_NAME=kick-backend
CF_DOMAIN=tudominio.ejemplo.com

# Opcional: reenviar eventos a otras máquinas
# FORWARD_URL_1=http://192.168.50.246:4000/kick-events
```

### 2.3 Iniciar

```bash
npm install
node server.js
# o: iniciar.bat (Windows con consola)
# o: iniciar.vbs (Windows silencioso)
```

Abrir `http://localhost:3000`, autorizar con Kick e iniciar el túnel.

### 2.4 Setup Cloudflare Tunnel

Ejecutar `setup-cloudflare.bat` que guía paso a paso:
1. Autentica cloudflared con tu cuenta Cloudflare
2. Crea un túnel nombrado
3. Crea un DNS route (subdominio)
4. Actualiza `.env` automáticamente

---

## 3. Estructura del proyecto

```
kick-backend/
├── server.js                     # Entry point: Express setup + rutas
├── package.json                  # Dependencias (express, openai, ws, multer)
├── .env                          # Config sensible (no subir a git)
├── tokens.json                   # Tokens OAuth persistidos (cuenta principal)
├── bot_tokens.json               # Tokens OAuth persistidos (bot)
├── cloudflared.yml               # Config auto-generada del túnel CF
│
├── lib/                          # ★ Librerías base
│   ├── config.js                 # Parser .env + constantes globales
│   ├── state.js                  # Estado compartido mutable entre módulos
│   ├── event-bus.js              # EventEmitter singleton (nervio central)
│   └── forwarder.js              # Reenvío HTTP de eventos a otras máquinas
│
├── modules/                      # ★ Módulos funcionales del core
│   ├── auth.js                   # OAuth PKCE + manejo de tokens
│   ├── webhook.js                # Receptor webhook Kick + validación RSA
│   ├── chat.js                   # Enviar mensajes al chat de Kick
│   ├── tunnel.js                 # Cloudflare tunnel (gestión automática)
│   ├── sse.js                    # SSE push al dashboard web
│   ├── events.js                 # Suscripción/desuscripción a eventos Kick
│   │
│   └── triggers/                 # ★ Módulos de reacción (plugins)
│       ├── tts/                  # Text-to-Speech con Speaker.bot
│       ├── GACHA/                # Sistema de gacha (personajes, overlays)
│       ├── vtuber-ai/            # VTuber AI con DeepSeek
│       ├── obs-actions/          # Control de OBS vía WebSocket
│       └── Music/                # Control de reproductor YouTube
│
├── public/                       # Archivos estáticos
│   ├── index.html                # Dashboard web single-page
│   └── images/badges/           # Badges de Kick para el dashboard
│
├── logs/vtuber-ai/               # Logs de conversaciones VTuber AI
├── iniciar.bat                   # Lanzador Windows (consola visible)
├── iniciar.vbs                   # Lanzador silencioso (sin consola)
└── setup-cloudflare.bat          # Script de setup de túnel Cloudflare
```

---

## 4. Librerías base (`lib/`)

### 4.1 `config.js` — Configuración global

- Parsea `.env` manualmente línea por línea
- Exporta constantes: `PORT`, `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI`
- Configuración de Cloudflare: `CF_TUNNEL_NAME`, `CF_DOMAIN`, `CF_BIN`, `CF_CREDENTIALS_DIR`, `CF_CONFIG`
- Rutas de persistencia: `TOKENS_PATH`, `BOT_TOKENS_PATH`
- `DEEPSEEK_API_KEY`: clave para VTuber AI
- `FORWARD_URLS`: array de URLs de reenvío, se leen automáticamente de todas las `FORWARD_URL_*` en `.env`
- `TEN_MINUTES`: constante de 10 min para ventana de dedup de webhooks

### 4.2 `state.js` — Estado compartido

Exporta un objeto mutable plano compartido entre todos los módulos:

| Propiedad | Tipo | Descripción |
|---|---|---|
| `tokens` | `object\|null` | Tokens OAuth de la cuenta principal |
| `botTokens` | `object\|null` | Tokens OAuth de la cuenta bot |
| `broadcasterUserId` | `string\|null` | ID del canal |
| `channelSlug` | `string\|null` | Slug del canal |
| `tunnelUrl` | `string\|null` | URL pública del túnel |
| `sseClients` | `array` | Conexiones SSE activas |
| `eventsCounter` | `number` | Total de eventos procesados |
| `authFailCount` | `number` | Intentos fallidos de auth (cuenta principal) |
| `botAuthFailCount` | `number` | Intentos fallidos de auth (bot) |

### 4.3 `event-bus.js` — Event Bus (nervio central)

Exporta una instancia singleton de `EventEmitter` de Node.js con `setMaxListeners(100)`. Cualquier módulo puede emitir o escuchar eventos. Es el mecanismo de comunicación desacoplado entre el core y los triggers.

### 4.4 `forwarder.js` — Reenvío de eventos

Si hay `FORWARD_URL_*` configuradas en `.env`, reenvía cada evento de Kick (y eventos internos relevantes) como POST HTTP a cada URL. Fire-and-forget con catch silencioso.

---

## 5. Módulos del core (`modules/`)

### 5.1 `auth.js` — OAuth PKCE + gestión de tokens

**Flujo OAuth PKCE:**
1. `login()` / `botLogin()` generan `code_verifier` y `code_challenge`
2. Redirigen al usuario a Kick para autorizar
3. Kick redirige de vuelta a `callback()` con el código de autorización
4. `callback()` intercambia el código por tokens (access + refresh)
5. Los tokens se persisten en `tokens.json` / `bot_tokens.json`

**Características:**
- Soporte para **cuenta principal** y **cuenta bot** (dos OAuth flows independientes)
- Auto-refresh de tokens: `ensureValidToken()` refresca si expira en < 60s
- Reintento en refresh: si falla la primera vez, espera 2s y reintenta
- `autoFlow()` / `botAutoFlow()`: al arrancar, validan tokens existentes, obtienen info del canal y emiten eventos de estado
- Si falla 3 veces seguidas, borra tokens y emite `auth:disconnected`
- Scopes solicitados: `events:subscribe`, `chat:write`, `channel:read`, `channel:rewards:read`, `user:read`

**Funciones exportadas:**
- `login`, `botLogin`, `callback` — handlers de rutas
- `ensureValidToken`, `ensureValidBotToken` — refresh automático
- `fetchChannelInfo` — obtiene `broadcasterUserId` y `channelSlug`
- `loadTokens`, `loadBotTokens` — carga tokens desde disco
- `autoFlow`, `botAutoFlow` — init automático al arrancar

### 5.2 `webhook.js` — Receptor de webhooks Kick

**Validación de firma RSA-SHA256:**

1. Verifica cabeceras obligatorias: `kick-event-signature`, `kick-event-message-id`, `kick-event-message-timestamp`
2. Valida que el timestamp esté dentro de ±5 minutos
3. Deduplica por `message-id` (ventana de 10 min via `Set` + timeout)
4. Verifica firma RSA contra la clave pública de Kick (hardcodeada + refresh dinámico)
5. Si la firma es inválida, refresca la clave pública y devuelve 401
6. Emite el evento al bus: `eventBus.emit(evType, { payload, ts })`
7. Notifica al dashboard via SSE: `sse.broadcast()`

**Manejo de GET:** Kick envía GET de verificación, responde 200 OK.

### 5.3 `chat.js` — Envío de mensajes al chat de Kick

**Funciones:**
- `send(req, res)`: endpoint POST, envía como usuario principal
- `sendAsBot(content, replyTo)`: envía como bot (usado por triggers como VTuber AI y Gacha)
- `sendToKick(tokens, content, type, replyTo)`: función interna que hace el POST a la API

**Validaciones:** máximo 500 caracteres, verifica autenticación y obtiene `broadcasterUserId` si es necesario.

### 5.4 `tunnel.js` — Cloudflare Tunnel

**Características:**
- Busca credenciales automáticamente en `~/.cloudflared/`
- Detecta si el túnel ya está corriendo via `cloudflared tunnel info`
- Genera `cloudflared.yml` automáticamente con las rutas correctas
- Spawnea `cloudflared tunnel run` como subproceso
- Escucha stderr para detectar `"Registered tunnel"` o `"Connection established"` y actualiza estado
- Timeout de conexión: 60 segundos
- Reconexión automática: si el proceso muere inesperadamente, reintenta a los 10 segundos
- Limpieza al salir: mata el subproceso en `exit`, `SIGINT`, `SIGTERM`

**Handlers HTTP:**
- `POST /api/tunnel/start` — inicia el túnel
- `POST /api/tunnel/stop` — detiene el túnel intencionalmente

### 5.5 `sse.js` — Server-Sent Events

Mantiene una lista de clientes conectados (`state.sseClients`). Cuando se conecta un cliente:
1. Envía estado inicial (auth, túnel, etc.)
2. Solicita estado TTS via evento `tts:request_status`
3. Permanece abierto; broadcast envía mensajes a todos los clientes

### 5.6 `events.js` — Suscripción a eventos de Kick

**Funcionalidad:**
- `listSubscriptions()`: lista suscripciones activas via API
- `subscribeToEvents()`: limpia suscripciones viejas, se suscribe a los 10 eventos estándar:
  - `chat.message.sent`
  - `channel.followed`
  - `channel.subscription.new`
  - `channel.subscription.renewal`
  - `channel.subscription.gifts`
  - `channel.reward.redemption.updated`
  - `livestream.status.updated`
  - `livestream.metadata.updated`
  - `moderation.banned`
  - `kicks.gifted`
- Auto-suscripción: escucha `tunnel:open` y se suscribe automáticamente tras 5s

---

## 6. Triggers (`modules/triggers/`)

### 6.1 TTS (`triggers/tts/`) — Text-to-Speech con Speaker.bot

**Archivos:**
- `index.js` — lógica principal, handlers HTTP
- `speakerbot.js` — cliente WebSocket para Speaker.bot
- `config-manager.js` — persistencia de configuración en `tts-data.json`

**Funcionamiento:**
- Escucha `chat.message.sent` en el event bus
- Comando `!sp <texto>` — reproduce texto con la voz configurada
- `!sp <alias> <texto>` — usa una voz específica para ese mensaje
- `!<nombre_voz>` — asigna permanentemente esa voz al usuario (alias persistente)
- `!bonk` / `!bonks` — lanza bonks via HTTP a KickBonks
- Filtro de palabras prohibidas (bannedWords)
- Reconexión automática a Speaker.bot cada 5s si se cae

**Configuración en `tts-data.json`:**
- `COMMAND`: comando trigger (default `!sp`)
- `VOICE_NAME`: voz por defecto (default `Sabina`)
- `VOICE_ALIASES`: mapa de alias a voces
- `SPEAKERBOT_URL`: URL WebSocket de Speaker.bot (default `ws://127.0.0.1:7580/`)
- `MAX_TEXT_LENGTH`: límite de caracteres (600)
- `KICKBONKS_URL`: URL del servicio KickBonks
- `bannedWords`: lista de palabras prohibidas
- `userAliases`: asignaciones usuario → voz persistentes

**Endpoints:**
- `GET /api/tts/config` — obtener config
- `POST /api/tts/config` — guardar config
- `GET /api/tts/user-aliases` — lista de alias de usuarios
- `POST /api/tts/user-alias/delete` — eliminar alias
- `POST /api/tts/toggle` — activar/desactivar bot
- `GET /api/tts/status` — estado del bot

### 6.2 VTuber AI (`triggers/vtuber-ai/`) — IA conversacional con DeepSeek

**Archivos:**
- `index.js` — lógica principal, handlers HTTP, integración con event bus
- `deepseek-client.js` — cliente DeepSeek API (tool calling, web_search)
- `config.js` — carga system prompt desde archivo
- `logger.js` — logging de conversaciones a archivos JSONL
- `prompts/vtuber-system.es.md` — prompt del sistema (personalidad VTuber)

**Funcionamiento:**
- Escucha `chat.message.sent`, filtra por comando `!grim <pregunta>`
- Envía a DeepSeek API (modelo `deepseek-v4-flash`)
- Soporta tool calling: `web_search` via DuckDuckGo
- Envía respuesta al chat de Kick como bot (prefijada con `!sp` para que TTS la lea)
- Mantiene historial de conversación por usuario (archivos JSONL en `logs/vtuber-ai/`)
- Limpieza automática de logs > 30 días
- Cachea system prompt en memoria

**Configuración en `vtuber-data.json`:**
- `API_KEY`: clave de DeepSeek
- Variables de entorno: `VTUBER_TEMPERATURE` (1.3), `VTUBER_MAX_HISTORY` (5), `VTUBER_MAX_TOKENS` (512), `VTUBER_NAME` (Grim), `VTUBER_COMMAND` (!grim)

**Endpoints:**
- `GET /api/vtuber/status` — estado
- `GET /api/vtuber/config` — config actual
- `POST /api/vtuber/config` — guardar API key
- `POST /api/vtuber/test` — probar conexión

### 6.3 GACHA (`triggers/GACHA/`) — Sistema de gacha

Módulo independiente con su propio `package.json`, server.js (para desarrollo standalone), y estructura completa.

**Arquitectura interna:**

```
GACHA/
├── index.js              # Entry point, conecta con backend principal
├── server.js             # Servidor standalone (para desarrollo)
├── package.json          # Dependencias propias
│
├── lib/
│   ├── config.js         # Config (puerto, GitHub, rutas)
│   ├── event-bus.js      # EventBus interno
│   ├── logger.js         # Logger
│   ├── ws-push.js        # WebSocket push a overlays (OBS Browser Sources)
│   └── imageUploader.js  # Subida de imágenes a GitHub
│
├── modules/
│   ├── data/
│   │   └── store.js      # Store central (inventarios, personajes, banners)
│   ├── gacha/
│   │   └── engine.js     # Motor de gacha (pulls, pity, probabilidades)
│   ├── trades/
│   │   └── manager.js    # Sistema de intercambios entre usuarios
│   ├── events/
│   │   └── commands.js   # Handlers de comandos del chat
│   └── chat/
│       └── sender.js     # Envío de mensajes formateados al chat
│
├── routes/
│   ├── overlay.js        # Endpoints para overlays (view.html)
│   ├── admin.js          # Endpoints de administración
│   └── webhook.js        # Webhook de integración
│
├── web/                  # Archivos estáticos para overlays OBS
│   ├── index.html        # Animación multi-pull
│   ├── view.html         # Vista de personaje individual
│   └── js/               # JS de overlays
│
└── GachaWish/            # Base de datos de personajes (JSON/img)
```

**Características:**
- Sistema de **pulls** con pity (4★ y 5★), probabilidades configurables
- Banners **standard** y **seasonal**
- Inventario por usuario con persistencia en JSON
- Llaves diarias (comando `!daily`)
- Sistema de **trades** (intercambios 5★ entre usuarios)
- Overlays para OBS via WebSocket (animaciones de gacha en stream)
- Subida de imágenes a GitHub (GachaWish)
- Estadísticas globales

**Comandos de chat** (todos vía event bus):

| Comando | Descripción | Permiso |
|---|---|---|
| `!daily` | 10 llaves diarias | User |
| `!pull` / `!single` / `!tirada` | 1 pull = 1 llave | User |
| `!multi` / `!x10` | 10 pulls = 10 llaves | User |
| `!inventario` / `!inv` | Inventario en chat | User |
| `!Sinv` | Inventario en overlay | User |
| `!pj <personaje>` | Carta de personaje en overlay | User |
| `!top` | Top 3 coleccionistas | User |
| `!trade` | Intercambio 5★ | User |
| `!aceptar_trade` / `!accept_trade` | Aceptar trade | User |
| `!rechazar_trade` / `!reject_trade` | Rechazar trade | User |
| `!keys` | Dar llaves (mod) | Mod |
| `!givechar` | Dar personaje (mod) | Mod |
| `!takechar` | Quitar personaje (mod) | Mod |
| `!resetpity` | Resetear pity (mod) | Mod |
| `!setprob` | Cambiar probabilidad (mod) | Mod |
| `!setstock` | Cambiar stock (mod) | Mod |
| `!banner` | Ver banner (mod) | Mod |
| `!seasonal` | Gestionar seasonal (mod) | Mod |
| `!reload` | Recargar datos (mod) | Mod |
| `!cleardata` | Borrar datos (mod) | Mod |
| `!gachaconfig` | Ver config (mod) | Mod |
| `!charinfo` | Info personaje (mod) | Mod |
| `!announce` | Anunciar en chat (mod) | Mod |

**Endpoints:**
- `GET /gacha/api/stats` — estadísticas globales
- `GET /gacha/api/commands` — lista de comandos
- `GET /gacha/api/*` — endpoints de overlay
- `GET /gacha/admin/*` — endpoints de admin
- `GET /gacha/*` — archivos estáticos (overlays)
- WebSocket en `/ws/gacha` — comunicación en tiempo real con overlays

### 6.4 OBS Actions (`triggers/obs-actions/`) — Control de OBS

**Archivos:**
- `index.js` — rutas Express, lógica de triggers, conexión con event bus
- `obs.js` — cliente OBS WebSocket (OBSWebSocket, auto-reconexión, cache de escenas)
- `engine.js` — ejecutor de sub-acciones (visibility, delay)
- `store.js` — persistencia de acciones, triggers y grupos en `obs-data.json`

**Características:**
- Conexión WebSocket a OBS Studio
- Cache de escenas e ítems (con soporte para grupos)
- **Acciones**: secuencias de sub-acciones (mostrar/ocultar fuentes, delays)
- **Triggers**: asociados a comandos de chat (`!comando`) o rewards de canal
- **Grupos**: organizan acciones en el dashboard
- **Pairing**: modo para asociar un reward de Kick a un trigger (escucha el primer reward que llegue tras iniciar pairing)
- Reconexión automática a OBS
- Dashboard web en `public/` del módulo

**Tipos de sub-acciones:**
- `visibility`: muestra/oculta una fuente en una escena
- `delay`: espera N milisegundos

**Endpoints:**
- `GET /obs-actions/api/data` — carga inicial completa
- `GET /obs-actions/api/obs/status` — estado de conexión OBS
- `POST /obs-actions/api/obs/connect` — conectar a OBS
- `POST /obs-actions/api/obs/disconnect` — desconectar
- `GET /obs-actions/api/obs/scenes` — lista de escenas
- `POST /obs-actions/api/obs/refresh-cache` — refrescar cache
- `POST /obs-actions/api/obs/test-sub-action` — probar sub-acción
- `GET /obs-actions/api/actions` — CRUD de acciones
- `GET /obs-actions/api/triggers` — CRUD de triggers
- `POST /obs-actions/api/triggers/pair` — emparejar reward
- `GET /obs-actions/api/groups` — CRUD de grupos
- `GET /obs-actions/api/rewards` — rewards de Kick
- Archivos estáticos en `public/`

### 6.5 Music (`triggers/Music/`) — Control de reproductor YouTube

**Archivos:**
- `index.js` — lógica principal, comandos, polling, API
- `client.js` — cliente HTTP para reproductor externo (API REST)
- `config.json` — configuración persistente

**Funcionamiento:**
- Se conecta a un reproductor de YouTube externo (API en `http://localhost:PORT`)
- Hace polling cada 3s para obtener información de la canción actual
- Notifica cambios de canción automáticamente al chat (`AUTO_NOTIFY`)
- Comandos: `!song`, `!addsong`, `!skip`, `!stop`, `!volume`, `!like`
- Búsqueda en YouTube y añadido a cola via API del reproductor

**Endpoints:**
- `GET /music/api/music/status` — estado
- `GET /music/api/music/config` — config
- `POST /music/api/music/config` — guardar config
- Archivos estáticos en `public/`

---

## 7. Dashboard web (`public/index.html`)

Single-page application en HTML + CSS + JS vanilla (~1490 líneas) que se conecta via SSE a `/api/events`.

**Características:**
- Feed de eventos en vivo con formato por tipo (chat, subs, follows, bans, etc.)
- Badges de usuario renderizados desde imágenes locales en `public/images/badges/`
- Respuesta a mensajes del chat (click en mensaje → reply)
- Botón de autorización OAuth (popup)
- Botón de inicio/parada del túnel
- Panel TTS completo (config, toggle, logs)
- Console TTS con logs en tiempo real
- Pestañas: Eventos, Chat, TTS, VTuber, OBS, Música, Comandos
- Shutdown al cerrar la pestaña

---

## 8. API Endpoints

| Ruta | Método | Descripción |
|---|---|---|
| `/auth/login` | GET | Inicia OAuth PKCE para cuenta principal |
| `/auth/bot/login` | GET | Inicia OAuth PKCE para cuenta bot |
| `/auth/callback` | GET | Callback OAuth (recibe tokens de ambas cuentas) |
| `/webhook/kick` | GET/POST | GET=verificación, POST=eventos Kick firmados |
| `/api/events` | GET | SSE — stream de eventos al dashboard |
| `/api/status` | GET | Estado actual del servidor |
| `/api/chat/send` | POST | Enviar mensaje como usuario principal |
| `/api/chat/send-bot` | POST | Enviar mensaje como bot |
| `/api/events/subscriptions` | GET | Listar suscripciones activas |
| `/api/events/subscribe` | POST | Suscribir a todos los eventos |
| `/api/tunnel/start` | POST | Iniciar túnel Cloudflare |
| `/api/tunnel/stop` | POST | Detener túnel |
| `/api/shutdown` | POST | Detener servidor + túnel |
| `/api/tts/config` | GET/POST | Configuración TTS |
| `/api/tts/user-aliases` | GET | Alias de usuarios TTS |
| `/api/tts/user-alias/delete` | POST | Eliminar alias |
| `/api/tts/toggle` | POST | Activar/desactivar TTS |
| `/api/tts/status` | GET | Estado TTS |
| `/api/vtuber/status` | GET | Estado VTuber AI |
| `/api/vtuber/config` | GET/POST | Config VTuber AI |
| `/api/vtuber/test` | POST | Probar VTuber AI |
| `/gacha/*` | varias | Sistema de gacha (API + overlays + estáticos) |
| `/obs-actions/*` | varias | Control OBS (API + dashboard) |
| `/music/*` | varias | Control música (API + dashboard) |

---

## 9. Event Bus — sistema nervioso central

`lib/event-bus.js` exporta un `EventEmitter` singleton con capacidad para 100 listeners. Es el mecanismo de comunicación desacoplado entre módulos.

**Patrón de uso:**

```js
// Emitir
const eventBus = require('./lib/event-bus')
eventBus.emit('chat.message.sent', { payload: { ... }, ts: '...' })

// Escuchar (en triggers)
const eventBus = require('../../../lib/event-bus')
eventBus.on('chat.message.sent', (data) => {
  // reaccionar
})
```

---

## 10. Eventos de Kick (webhook)

| Evento | Datos | Cuándo ocurre |
|---|---|---|
| `chat.message.sent` | `{ payload, ts }` | Alguien escribe en el chat |
| `channel.followed` | `{ payload, ts }` | Nuevo seguidor |
| `channel.subscription.new` | `{ payload, ts }` | Nueva suscripción |
| `channel.subscription.renewal` | `{ payload, ts }` | Renovación de suscripción |
| `channel.subscription.gifts` | `{ payload, ts }` | Suscripciones regaladas |
| `channel.reward.redemption.updated` | `{ payload, ts }` | Canje de puntos de canal |
| `livestream.status.updated` | `{ payload, ts }` | Stream online/offline |
| `livestream.metadata.updated` | `{ payload, ts }` | Cambio de título/categoría |
| `moderation.banned` | `{ payload, ts }` | Usuario baneado |
| `kicks.gifted` | `{ payload, ts }` | KICKs regalados |

---

## 11. Eventos internos

| Evento | Datos | Cuándo ocurre |
|---|---|---|
| `auth:ready` | `{ slug }` | Auth completado exitosamente |
| `auth:disconnected` | `{}` | Auth falló permanentemente (>3 intentos) |
| `auth:token-refreshed` | `{}` | Token refrescado automáticamente |
| `bot:token-refreshed` | `{}` | Token de bot refrescado |
| `tunnel:open` | `{ url }` | Túnel Cloudflare abierto |
| `tunnel:closed` | `{ exitCode, log }` | Túnel cerrado |
| `tunnel:error` | `{ error }` | Error de túnel |
| `chat:sent` | `{ content, message_id }` | Mensaje enviado al chat |
| `tts:request_status` | — | Solicitar estado TTS (al conectar SSE) |
| `tts:config_updated` | `{ config, bannedWords }` | Config TTS actualizada |
| `tts:user_aliases_updated` | `{ userAliases }` | Alias de TTS actualizados |

---

## 12. Comandos del chat

Resumen de todos los comandos disponibles por módulo:

### TTS
| Comando | Descripción |
|---|---|
| `!sp <texto>` | Reproduce texto con voz principal |
| `!sp <alias> <texto>` | Reproduce con voz del alias |
| `!<nombre_voz>` | Asigna voz permanentemente al usuario |
| `!bonk` | Lanza un bonk |
| `!bonks` | Lanza ráfaga de bonks |

### VTuber AI
| Comando | Descripción |
|---|---|
| `!grim <pregunta>` | Grim responde con IA |

### Gacha
| Comando | Descripción |
|---|---|
| `!daily` | 10 llaves diarias |
| `!pull` / `!single` / `!tirada` | 1 pull |
| `!multi` / `!x10` | 10 pulls |
| `!inventario` / `!inv` | Inventario |
| `!Sinv` | Inventario en overlay |
| `!pj <personaje>` | Carta en overlay |
| `!top` | Top coleccionistas |
| `!trade` / `!accept_trade` / `!reject_trade` | Intercambios |
| `!keys @user <n>` | Dar llaves (mod) |
| `!givechar` / `!takechar` | Dar/quitar personaje (mod) |
| `!resetpity` | Resetear pity (mod) |
| `!setprob` / `!setstock` | Config (mod) |
| `!banner` / `!seasonal` | Banners (mod) |
| `!reload` / `!cleardata` / `!gachaconfig` | Admin (mod) |
| `!charinfo` | Info personaje (mod) |
| `!announce` | Anunciar (mod) |

### Music
| Comando | Descripción |
|---|---|
| `!song` | Canción actual |
| `!addsong <nombre/URL>` | Añadir a cola |
| `!skip` | Saltar |
| `!stop` | Pausar/reanudar |
| `!volume <0-100>` | Volumen |
| `!like` | Like |

### OBS-Actions
| Comando | Descripción |
|---|---|
| Comandos dinámicos configurables desde el dashboard | Mod |

---

## 13. Cómo agregar un nuevo módulo/trigger

### Patrón A — Simple (sin router, sin init)

Un archivo único que escucha eventos del bus.

```js
// modules/triggers/mi-modulo/index.js
const eventBus = require('../../../lib/event-bus')
eventBus.on('chat.message.sent', (data) => {
  // tu lógica
})
console.log('[MI-MODULO] Cargado')
```

Luego en `server.js`:
```js
require('./modules/triggers/mi-modulo')
```

### Patrón B — Completo (con router Express + init)

Módulo con router, estado, init asíncrono y persistencia.

```js
const express = require('express')
const eventBus = require('../../../lib/event-bus')
const router = express.Router()

router.get('/api/status', (req, res) => { res.json({ ok: true }) })

function init() {
  eventBus.on('chat.message.sent', (data) => {
    // tu lógica
  })
}

module.exports = { router, init }
```

En `server.js`:
```js
const miModulo = require('./modules/triggers/mi-modulo')
app.use('/mi-modulo', miModulo.router)
miModulo.init()
```

### Patrón C — Completo + WebSocket

Como GACHA, que necesita WebSocket para overlays.

```js
module.exports = { router, init, initWs }
```

En `server.js`:
```js
gacha.initWs(server)  // antes de server.listen
gacha.init().catch(...)
app.use('/gacha', gacha.router)
```

### Checklist para nuevo módulo
- [ ] Crear carpeta en `modules/triggers/`
- [ ] Si tiene dependencias extra, `npm init` dentro y agregar `package.json`
- [ ] Escuchar eventos del bus
- [ ] Si tiene UI web, servir estáticos con `router.use(express.static(...))`
- [ ] Si expone endpoints, usar sub-path único
- [ ] Exportar `{ router, init }` y enganchar en `server.js`
- [ ] NO modificar archivos del core (`lib/`, `modules/auth.js`, etc.) a menos que sea estrictamente necesario
- [ ] Cada trigger es responsable de su propio try/catch
- [ ] Los eventos pueden llegar duplicados (ventana de dedup 10 min) — asegurar idempotencia

---

## 14. Overlays en otra PC (Stream PC)

El módulo GACHA sirve archivos estáticos bajo `/gacha/`. Para usar overlays en una PC secundaria:

1. Asegurar que el firewall permita tráfico en puerto 3000 (TCP) en la PC del backend
2. En la PC de stream (o como Browser Source en OBS), abrir:
   - `http://<IP_BACKEND>:3000/gacha/view.html` — personaje individual
   - `http://<IP_BACKEND>:3000/gacha/index.html` — animación multi-pull
3. El WebSocket conecta automáticamente a `ws://<host>/ws/gacha`
4. Para servir localmente (latencia mínima), copiar `modules/triggers/GACHA/web/` a la PC de stream y servir con `npx serve web -p 4000`

---

## 15. Forwarder (reenvío a otras máquinas)

Configurar `FORWARD_URL_1`, `FORWARD_URL_2`, etc. en `.env`. Cada evento Kick válido se reenvía como POST a cada URL configurada.

Payload enviado:
```json
{
  "event": "channel.reward.redemption.updated",
  "data": { "payload": { ... }, "ts": "..." },
  "source": "kick-backend",
  "ts": "2026-06-27T..."
}
```

---

## 16. Heartbeat

Cada 5 minutos (`setInterval(heartbeat, 300000)` en `server.js`):

1. Refresca token si es necesario
2. Reinicia el túnel si está caído
3. Verifica que las 10 suscripciones a eventos estén activas
4. Si hay menos de 10, re-subscribe todo

---

## 17. Estado compartido

Ver `lib/state.js`. Es un objeto plano mutable accesible desde cualquier módulo vía `require('../lib/state')`. No tiene getters/setters — es deliberadamente simple (ponytail).

---

## 18. Archivos de lanzamiento

### `iniciar.bat`
Lanzador con consola visible:
1. Verifica Node.js instalado
2. Instala dependencias si no existen (`node_modules/`)
3. Carga variables de `.env` si no están en entorno
4. Libera puerto 3000 (mata proceso que lo ocupe)
5. Abre Microsoft Edge en `http://localhost:3000`
6. Ejecuta `node server.js`

### `iniciar.vbs`
Lanzador silencioso (sin ventana de consola). Oculta la ventana de terminal.

### `setup-cloudflare.bat`
Script interactivo de una sola vez:
1. Verifica cloudflared instalado
2. Ejecuta `cloudflared tunnel login` (abre navegador)
3. Pide nombre del túnel y crea `cloudflared tunnel create`
4. Pide subdominio y crea `cloudflared tunnel route dns`
5. Actualiza `.env` con `CF_TUNNEL_NAME` y `CF_DOMAIN`
