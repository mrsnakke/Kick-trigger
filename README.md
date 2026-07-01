# Kick Backend

![Node](https://img.shields.io/badge/Node.js-26.3.1-339933?logo=node.js&logoColor=white)
![npm](https://img.shields.io/badge/npm-11.16.0-CB3837?logo=npm&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.21.0-000000?logo=express&logoColor=white)

Backend Node.js para conectar con la API de Kick: OAuth, webhooks, chat, suscripción a eventos y túnel Cloudflare. Incluye dashboard web en vivo y un sistema modular de triggers.

## Estructura

```
kick-backend/
├── lib/                       # Librerías base
│   ├── event-bus.js           # EventEmitter singleton (nervio central)
│   ├── config.js              # .env parser + constantes
│   ├── state.js               # Estado compartido mutable
│   └── forwarder.js           # Reenvío HTTP de eventos a otras máquinas
│
├── modules/                   # Módulos funcionales del core
│   ├── auth.js                # OAuth PKCE + token management
│   ├── webhook.js             # Receptor webhook Kick + validación RSA
│   ├── chat.js                # Enviar mensajes al chat de Kick
│   ├── tunnel.js              # Cloudflare tunnel (gestión automática)
│   ├── sse.js                 # SSE push al dashboard web
│   ├── events.js              # Suscripción/desuscripción a eventos de Kick
│   └── triggers/              # ★ Tus módulos de reacción aquí
│       ├── tts/               # Text-to-Speech con Speaker.bot
│       ├── obs-actions/       # Control de OBS vía WebSocket
│       ├── GACHA/             # Sistema de gacha (personajes, overlays)
│       ├── vtuber-ai/         # Integración con VTuber AI
│       └── chatbot/           # Comandos personalizados + timers automáticos
│
├── server.js                  # Express setup + montaje de rutas
├── public/index.html          # Dashboard web (SSE, chat, TTS panel)
├── .env                       # Configuración (KICK, CF, FORWARD_URL_*)
├── tokens.json                # Tokens OAuth persistidos
├── iniciar.bat                # Lanzador Windows (consola)
└── iniciar.vbs                # Lanzador silencioso (sin consola)
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
| `/api/chat/send-bot` | POST | Enviar mensaje como bot |
| `/api/events/subscriptions` | GET | Listar suscripciones activas |
| `/api/events/subscribe` | POST | Suscribir a todos los eventos |
| `/api/tunnel/start` | POST | Iniciar túnel Cloudflare |
| `/api/tunnel/stop` | POST | Detener túnel |
| `/api/tts/*` | varias | Configuración y control de TTS |
| `/api/vtuber/*` | varias | Configuración de VTuber AI |
| `/gacha/*` | varias | Sistema de gacha + overlays |
| `/obs-actions/*` | varias | Panel de control de OBS |
| `/chatbot/*` | varias | Comandos personalizados y timers del chatbot |
| `/api/shutdown` | POST | Detener servidor + túnel |

## Event Bus

`lib/event-bus.js` exporta un `EventEmitter` de Node.js. Es el sistema nervioso central. Cualquier módulo puede emitir/escuchar eventos. Los triggers se conectan al bus sin modificar el core.

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
- Panel TTS completo
- Console TTS con logs en tiempo real
- Shutdown al cerrar la pestaña

## Overlays en otra PC (Stream PC)

El módulo GACHA sirve sus archivos estáticos (HTML, CSS, JS, audio, imágenes) bajo `/gacha/`. Para usar los overlays en una segunda PC (ej. la de streaming):

1. **Acceso de red**  
   - Asegúrate de que el firewall de Windows en la PC del backend (ej. `192.168.50.254`) permita entrada en el puerto `3000` (TCP).  
   - Ambas PCs deben estar en la misma LAN.

2. **Abrir los overlays en la PC de stream**  
   - En el navegador (o como *Browser Source* en OBS) abre:  
     ```
     http://192.168.50.254:3000/gacha/view.html   # vista de personaje (single pull)
     http://192.168.50.254:3000/gacha/index.html  # animación de gacha (multi, gashapon, etc.)
     ```
   - Los archivos de audio (`/gacha/sounds/...`), CSS y JS se cargan con rutas relativas, así que funcionan directo.

3. **WebSocket**  
   - Los overlays usan `ws://<host>/ws/gacha` (construido con `window.location.host`). Al abrir la URL de arriba, el WebSocket conecta automáticamente al backend.

4. **Si necesitas servir los archivos localmente en la PC de stream** (latencia mínima)  
   - Copia la carpeta `modules/triggers/GACHA/web` a la PC de stream.  
   - Sirve con cualquier servidor estático:  
     ```bash
     npx serve web -p 4000
     # o: python -m http.server 4000
     ```
   - Edita `web/js/view.js` y `web/js/websocket.js`: cambia la URL del WebSocket a la IP fija del backend:  
     ```js
     const WS_ADDRESS = 'ws://192.168.50.254:3000/ws/gacha';
     ```
   - Abre `http://localhost:4000/view.html` y `index.html` en OBS.

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

---

## Rewards (Puntos de Canal)

### Cómo funciona

Los viewers pueden canjear puntos de canal por rewards personalizados que creás en el dashboard de Kick. Cuando un viewer canjea un reward, Kick envía un webhook con el evento `channel.reward.redemption.updated` que este backend recibe y emite al event bus.

### Lo que ya está configurado

1. **Scope OAuth**: `channel:rewards:read` — ya se solicita en `auth.js` (líneas 169, 187)
2. **Suscripción**: `channel.reward.redemption.updated` — ya suscrito en `events.js` (línea 40)
3. **Endpoint API**: `GET /obs-actions/api/rewards` — lista los rewards disponibles desde la API de Kick (`modules/triggers/obs-actions/index.js:211`)
4. **Manejo del evento**: cualquier módulo puede escuchar `channel.reward.redemption.updated` en el event bus

### Cómo escuchar rewards en tu módulo

```js
const eventBus = require('../../../lib/event-bus')

eventBus.on('channel.reward.redemption.updated', (data) => {
  const title = data.payload.reward?.title       // nombre del reward
  const user = data.payload.redeemer?.username    // quién lo canjeó
  // tu lógica acá
})
```

### Crear rewards en Kick

Los rewards se crean desde el dashboard de Kick (no via API pública):
1. Ve a tu canal de Kick → Puntos de Canal → Canales personalizados
2. Creá un reward con nombre, costo en puntos y descripción
3. El nombre debe coincidir con el `pattern` configurado en tu trigger

---

## Comandos del chat (!comando)

### Cómo funciona

Cuando alguien escribe en el chat, Kick envía un webhook `chat.message.sent`. El backend lo recibe, lo valida y lo emite al event bus. Los módulos escuchan este evento y filtran por comandos (mensajes que empiezan con `!`).

### Lista completa de comandos

| Módulo | Comando | Descripción | Permiso |
|---|---|---|---|
| **TTS** | `!sp &lt;texto&gt;` | Reproduce texto con la voz principal por Speaker.bot | User |
| | `!sp &lt;alias&gt; &lt;texto&gt;` | Reproduce con la voz del alias (ej: `!sp ava hola`) | User |
| | `!&lt;nombre_voz&gt;` | Asigna permanentemente esa voz al usuario (ej: `!ava`) | User |
| | `!bonk` | Lanza un bonk al streamer | User |
| | `!bonks` | Lanza ráfaga de bonks | User |
| **VTuber AI** | `!grim &lt;pregunta&gt;` | Grim responde con IA en chat y voz | User |
| **Gacha** | `!daily` | Reclama 10 llaves diarias | User |
| | `!pull` / `!single` / `!tirada` | Gasta 1 llave para tirar un personaje | User |
| | `!multi` / `!x10` | Gasta 10 llaves para 10 tiradas | User |
| | `!inventario` / `!inventory` / `!inv` | Muestra llaves, tiradas, pity y personajes en el chat | User |
| | `!Sinv` | Muestra inventario como tarjeta en el overlay (view.html) | User |
| | `!pj &lt;personaje&gt;` | Muestra la carta del personaje en el overlay (view.html) | User |
| | `!lista` | Lista personajes disponibles 4★ y 5★ del banner + promocionales | User |
| | `!top` | Top 3 coleccionistas con más personajes | User |
| | `!trade &lt;tu_pj&gt; por &lt;su_pj&gt; @usuario` | Crea intercambio de 5★ | User |
| | `!aceptar_trade` / `!accept_trade &lt;ID&gt;` | Acepta un trade | User |
| | `!rechazar_trade` / `!reject_trade &lt;ID&gt;` | Cancela/rechaza un trade | User |
| | `!keys @usuario &lt;cantidad&gt;` | Añade llaves a un usuario | Mod |
| | `!givechar @usuario &lt;personaje&gt;` | Entrega personaje al inventario | Mod |
| | `!takechar @usuario &lt;personaje&gt;` | Quita personaje del inventario | Mod |
| | `!resetpity [@usuario] [4\|5]` | Resetea pity 4★ y/o 5★ | Mod |
| | `!setprob &lt;rareza&gt; &lt;valor&gt;` | Ajusta probabilidad (ej: `5_star 0.006`) | Mod |
| | `!setstock &lt;personaje&gt; &lt;stock&gt;` | Cambia stock de personaje 5★/6★ | Mod |
| | `!banner &lt;standard\|seasonal&gt;` | Lista personajes del banner | Mod |
| | `!seasonal add &lt;pj&gt; &lt;stock&gt;` | Añade personaje al banner seasonal | Mod |
| | `!seasonal remove &lt;pj&gt;` | Quita personaje del banner seasonal | Mod |
| | `!reload` | Recarga datos desde JSON | Mod |
| | `!cleardata confirm` | BORRA todos los datos | Mod |
| | `!gachaconfig` | Muestra probabilidades actuales | Mod |
| | `!charinfo &lt;personaje&gt;` | Info del personaje (rareza, banner, stock) | Mod |
| | `!announce &lt;mensaje&gt;` | Envía mensaje al chat como bot | Mod |
| **Music** | `!song` | Muestra la canción actual | User |
| | `!addsong &lt;nombre/URL&gt;` | Añade canción a la cola | User |
| | `!skip` | Salta a la siguiente canción | User |
| | `!stop` | Pausa/reanuda la reproducción | User |
| | `!volume &lt;0-100&gt;` | Ajusta el volumen | User |
| | `!like` | Da like a la canción actual | User |
| **OBS-Actions** | Comandos dinámicos configurables desde el dashboard | — | Mod |
| **Chatbot** | Comandos personalizados configurables desde el dashboard | — | User/Mod |

### Embeber comandos en el dashboard

Cada módulo expone sus comandos vía un endpoint `GET /api/commands` para que el dashboard los muestre en la pestaña **Comandos**. Ver `modules/triggers/GACHA/index.js:54` como ejemplo.

> ⚠ **Importante**: Al añadir un nuevo comando en cualquier módulo, debe agregarse al endpoint `GET /api/commands` de ese módulo **y** también a la pestaña Comandos del dashboard (`public/index.html#tab-comandos`), ya sea hardcoded (TTS, VTuber, Music) o dinámico (Gacha).

---

## Cómo agregar un nuevo módulo

Hay **dos patrones** según la complejidad del módulo:

### Patrón A — Simple (sin router, sin init)

Un archivo único que escucha eventos del bus. Ideal para lógica simple.

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

Un módulo con su propio router, estado, init asíncrono y persistencia. Ideal cuando necesitás API endpoints, UI web y configuración.

```js
// modules/triggers/mi-modulo/index.js
const express = require('express')
const eventBus = require('../../../lib/event-bus')
const router = express.Router()

// — Rutas API —
router.get('/api/status', (req, res) => {
  res.json({ ok: true })
})

// — Init (se llama desde server.js) —
function init() {
  eventBus.on('chat.message.sent', (data) => {
    // tu lógica
  })
  console.log('[MI-MODULO] Inicializado')
}

module.exports = { router, init }
```

Luego en `server.js`:
```js
const miModulo = require('./modules/triggers/mi-modulo')
// ...
app.use('/mi-modulo', miModulo.router)
miModulo.init()
```

### Patrón C — Completo + WebSocket

Como el GACHA, que necesita WebSocket para overlays. Misma estructura que el patrón B pero además exporta `initWs(server)`.

```js
module.exports = { router, init, initWs }
```

```js
// En server.js:
gacha.initWs(server)  // antes de server.listen
gacha.init().catch(...)
app.use('/gacha', gacha.router)
```

### Checklist para agregar un nuevo módulo

- [ ] Crear carpeta en `modules/triggers/`
- [ ] Si tiene dependencias extra, `npm init` dentro y agregar `package.json`
- [ ] Escuchar eventos del bus (`chat.message.sent`, `channel.reward.redemption.updated`, etc.)
- [ ] Si tiene UI web, servir estáticos con `router.use(express.static(...))`
- [ ] Si expone endpoints, usar un sub-path único (ej: `/mi-modulo/*`)
- [ ] Exportar `{ router, init }` y enganchar en `server.js` (ver `server.js:96-102`)
- [ ] NO modificar archivos del core (`lib/`, `modules/auth.js`, etc.) a menos que sea estrictamente necesario
- [ ] Cada trigger es responsable de su propio try/catch
- [ ] Los eventos pueden llegar duplicados (dedup window de 10 min) — asegurar idempotencia
