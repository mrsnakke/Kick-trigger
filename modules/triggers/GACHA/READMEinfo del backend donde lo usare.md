# Kick Backend

![Node](https://img.shields.io/badge/Node.js-26.3.1-339933?logo=node.js&logoColor=white)
![npm](https://img.shields.io/badge/npm-11.16.0-CB3837?logo=npm&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.21.0-000000?logo=express&logoColor=white)

Backend Node.js para conectar con la API de Kick: OAuth, webhooks, chat, suscripción a eventos y túnel Cloudflare. Incluye dashboard web en vivo y un sistema modular de triggers.

## Estructura

```
kick-backend/
├── lib/                   # Librerías base
│   ├── event-bus.js       # EventEmitter singleton (nervio central)
│   ├── config.js          # .env parser + constantes
│   ├── state.js           # Estado compartido mutable
│   └── forwarder.js       # Reenvío HTTP de eventos a otras máquinas
│
├── modules/               # Módulos funcionales
│   ├── auth.js            # OAuth PKCE + token management
│   ├── webhook.js         # Receptor webhook Kick + validación RSA
│   ├── chat.js            # Enviar mensajes al chat de Kick
│   ├── tunnel.js          # Cloudflare tunnel (gestión automática)
│   ├── sse.js             # SSE push al dashboard web
│   ├── events.js          # Suscripción/desuscripción a eventos de Kick
│   └── triggers/          # ★ Tus módulos de reacción aquí
│       └── tts/           # Trigger TTS (Speaker.bot + !sp)
│
├── server.js              # Express setup + montaje de rutas
├── public/index.html      # Dashboard web (SSE, chat, TTS panel)
├── .env                   # Configuración (KICK, CF, FORWARD_URL_*)
├── tokens.json            # Tokens OAuth persistidos
├── iniciar.bat            # Lanzador Windows (consola)
└── iniciar.vbs            # Lanzador silencioso (sin consola)
```

## Configuración inicial

### 1. Crear app en Kick

1. Ve a https://dev.kick.com/applications
2. Crea una app con `http://localhost:3000/auth/callback` como Redirect URI
3. Copia `KICK_CLIENT_ID` y `KICK_CLIENT_SECRET` a `.env`

### 2. Configurar `.env`

```env
KICK_CLIENT_ID=tu_client_id
KICK_CLIENT_SECRET=tu_client_secret

# Cloudflare Tunnel (URL fija)
CF_TUNNEL_NAME=kick-backend
CF_DOMAIN=tudominio.ejemplo.com

# Reenviar eventos a otras máquinas (opcional)
# FORWARD_URL_1=http://192.168.50.246:4000/kick-events
# FORWARD_URL_2=http://localhost:4001/kick-events
```

### 3. Iniciar

```bash
npm install
node server.js
# o: iniciar.bat (Windows)
# o: iniciar.vbs (silencioso)
```

Abrir `http://localhost:3000`, autorizar con Kick e iniciar el túnel.

## API Endpoints

| Ruta | Método | Descripción |
|---|---|---|
| `/auth/login` | GET | Inicia OAuth PKCE (redirect a Kick) |
| `/auth/callback` | GET | Callback OAuth, recibe tokens |
| `/webhook/kick` | GET/POST | GET=verificación, POST=eventos Kick (firmados) |
| `/api/events` | GET | SSE — stream de eventos al dashboard |
| `/api/status` | GET | Estado actual (auth, túnel, contadores) |
| `/api/chat/send` | POST | Enviar mensaje al chat de Kick |
| `/api/events/subscriptions` | GET | Listar suscripciones activas |
| `/api/events/subscribe` | POST | Suscribir a todos los eventos |
| `/api/tunnel/start` | POST | Iniciar túnel Cloudflare |
| `/api/tunnel/stop` | POST | Detener túnel |
| `/api/tts/config` | GET/POST | Obtener/guardar config TTS |
| `/api/tts/user-aliases` | GET | Listar voces personalizadas por usuario |
| `/api/tts/user-alias/delete` | POST | Eliminar voz personalizada de un usuario |
| `/api/tts/toggle` | POST | Activar/desactivar bot TTS |
| `/api/tts/status` | GET | Estado del bot TTS y Speaker.bot |
| `/api/shutdown` | POST | Detener servidor + túnel |

## Event Bus

`lib/event-bus.js` exporta un `EventEmitter` de Node.js. Es el sistema nervioso central.

Cualquier módulo puede emitir/escuchar eventos. Los triggers se conectan al bus sin modificar el core.

### Eventos de Kick (webhook entrante)

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

### Eventos internos

| Evento | Datos | Cuándo ocurre |
|---|---|---|
| `auth:ready` | `{ slug }` | Auth completado exitosamente |
| `auth:disconnected` | `{}` | Auth falló permanentemente (>3 intentos) |
| `auth:token-refreshed` | `{}` | Token refrescado automáticamente |
| `tunnel:open` | `{ url }` | Túnel Cloudflare abierto |
| `tunnel:closed` | `{ exitCode, log }` | Túnel cerrado |
| `tunnel:error` | `{ error }` | Error de túnel |
| `chat:sent` | `{ content, message_id }` | Mensaje enviado al chat |

## Webhook — validación de firma

Los webhooks de Kick incluyen firma RSA-SHA256. El módulo `webhook.js`:

1. Verifica cabeceras: `kick-event-signature`, `kick-event-message-id`, `kick-event-message-timestamp`
2. Valida timestamp (±5 min)
3. Deduplica por `message-id` (ventana de 10 min)
4. Verifica firma contra la clave pública de Kick (se refresca automáticamente)
5. Emite el evento al bus y notifica al dashboard vía SSE

## Suscripción a eventos

`events.js` se suscribe automáticamente al abrirse el túnel. Un heartbeat cada 5 min verifica que las 10 suscripciones sigan activas y las repara si es necesario.

## Heartbeat

Cada 5 minutos `server.js` ejecuta:
1. Refresca token si es necesario
2. Reinicia el túnel si está caído
3. Verifica que las 10 suscripciones a eventos estén activas
4. Si hay menos de 10, re-subscribe todo

## Túnel Cloudflare

`tunnel.js` maneja el túnel con Cloudflare:
- Detecta si ya hay una conexión activa
- Busca credenciales del túnel en `~/.cloudflared/`
- Usa `cloudflared.yml` generado automáticamente
- Reintenta automáticamente tras caídas no intencionales
- Expone la URL en `state.tunnelUrl` y notifica vía SSE

## Forwarder (reenvío a otras máquinas)

Configurá `FORWARD_URL_*` en `.env`. Cada evento Kick válido se reenvía como POST a cada URL configurada:

```json
{
  "event": "channel.reward.redemption.updated",
  "data": { "payload": { ... }, "ts": "..." },
  "source": "kick-backend",
  "ts": "2026-06-27T..."
}
```

## Dashboard web

`public/index.html` es un dashboard single-page que se conecta vía SSE a `/api/events`.

**Características:**
- Feed de eventos en vivo con formato por tipo (chat, subs, follows, bans, etc.)
- Badges de usuario (Kick) renderizados desde imágenes locales
- Respuesta a mensajes del chat (click en un mensaje → reply)
- Botón de autorización OAuth (popup)
- Botón de inicio/parada del túnel
- Panel TTS completo (configuración, voces, palabras prohibidas, monitoreo)
- Console TTS con logs en tiempo real
- Shutdown al cerrar la pestaña

## Estado compartido (`lib/state.js`)

| Propiedad | Tipo | Descripción |
|---|---|---|
| `tokens` | `object\|null` | Tokens OAuth |
| `broadcasterUserId` | `string\|null` | ID del canal |
| `channelSlug` | `string\|null` | Slug del canal |
| `tunnelUrl` | `string\|null` | URL pública del túnel |
| `sseClients` | `array` | Conexiones SSE activas |
| `eventsCounter` | `number` | Total de eventos procesados |
| `authFailCount` | `number` | Intentos fallidos de auth consecutivos |

## Trigger TTS (Text-to-Speech)

### Cómo funciona

Escucha mensajes del chat y envía texto a **Speaker.bot** vía WebSocket para reproducirlo en vivo.

### Comandos

| Comando | Acción |
|---|---|
| `!sp <texto>` | Reproduce `<texto>` con la voz principal |
| `!sp <alias> <texto>` | Reproduce con la voz del alias (ej: `!sp ava hola`) |
| `!<nombre_voz>` | Asigna permanentemente esa voz al usuario (ej: `!ava`) |
| `!bonk` | Lanza un bonk al streamer |
| `!bonks` | Lanza ráfaga de bonks |

### Configuración (desde dashboard o `tts-data.json`)

| Parámetro | Default | Descripción |
|---|---|---|
| `COMMAND` | `!sp` | Comando para activar TTS |
| `VOICE_NAME` | `Sabina` | Voz principal |
| `VOICE_ALIASES` | `{ ava, brian, jorge, sabina }` | Alias de voces disponibles |
| `SPEAKERBOT_URL` | `ws://127.0.0.1:7580/` | URL de Speaker.bot |
| `MAX_TEXT_LENGTH` | `600` | Máx caracteres (0 = sin límite) |
| `KICKBONKS_URL` | `http://localhost:3030` | URL del servicio de bonks |
| `bannedWords` | — | Palabras bloqueadas (no se reproducen) |

### Conexión con Speaker.bot

El trigger se conecta automáticamente a Speaker.bot vía WebSocket. Si la conexión se pierde, reintenta cada 5 segundos.

### Archivos del trigger

- `index.js` — lógica principal, manejo de comandos, HTTP handlers
- `config-manager.js` — persistencia en `tts-data.json`, filtro de palabras
- `speakerbot.js` — WebSocket a Speaker.bot
- `tts-data.json` — datos persistentes (config, palabras, aliases de usuarios)

## Cómo crear un trigger

### 1. Crear archivo en `modules/triggers/`

```js
// modules/triggers/ruleta.js
const eventBus = require('../../lib/event-bus')

eventBus.on('channel.reward.redemption.updated', async (data) => {
  const { payload } = data
  if (payload.reward?.title === 'Ruleta Spin') {
    console.log('[RULETA]', payload.redeemer?.username, 'activó la ruleta')
  }
})

console.log('[TRIGGER] Ruleta cargada')
```

### 2. Cargar el trigger desde `server.js`

```js
require('./modules/triggers/ruleta')
```

### Criterios

1. **Archivos individuales**: cada trigger en su propio `.js` dentro de `modules/triggers/`
2. **Sin modificar el core**: solo importás de `lib/` o de otros módulos
3. **Fire-and-forget**: no bloquear el event bus
4. **Manejo de errores**: cada trigger es responsable de su propio try/catch
5. **Cero dependencias nuevas**: usá `fetch` (nativo Node 18+), `fs`, etc.
6. **Idempotencia**: los eventos pueden llegar duplicados (dedup de 10 min)
