# Kick Backend

![Node](https://img.shields.io/badge/Node.js-26.3.1-339933?logo=node.js&logoColor=white)
![npm](https://img.shields.io/badge/npm-11.16.0-CB3837?logo=npm&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.21.0-000000?logo=express&logoColor=white)

Backend Node.js para conectar con la API de Kick: OAuth, webhooks, chat, suscripción a eventos y túnel Cloudflare. Incluye dashboard web en vivo y un sistema modular de triggers.

> 📚 **Documentación completa:** empieza por [`docs/00-indice.md`](docs/00-indice.md).
> Incluye puesta en marcha, arquitectura, guías para añadir/modificar módulos, y
> referencias de endpoints, eventos y comandos.

## Requisitos rápidos

- Node.js ≥ 18
- Windows (obligatorio para TTS via SAPI; opcional para el resto)
- cloudflared (solo para recibir webhooks externos)

## Estructura

```
kick-backend/
├── lib/                       # Librerías base (núcleo: NO tocar)
│   ├── event-bus.js           # EventEmitter singleton (nervio central)
│   ├── config.js              # .env parser + constantes
│   ├── state.js               # Estado compartido mutable
│   └── forwarder.js           # Reenvío HTTP de eventos a otras máquinas
│
├── modules/                   # Módulos del core (núcleo: NO tocar)
│   ├── auth.js                # OAuth PKCE + token management
│   ├── webhook.js             # Receptor webhook Kick + validación RSA
│   ├── chat.js                # Enviar mensajes al chat de Kick
│   ├── tunnel.js              # Cloudflare tunnel (gestión automática)
│   ├── sse.js                 # SSE push al dashboard web
│   ├── events.js              # Suscripción/desuscripción a eventos de Kick
│   └── triggers/              # ★ Tus módulos de reacción (add/modify aquí)
│       ├── TTS2/              # Text-to-Speech SAPI (PowerShell)
│       ├── obs-actions/       # Control de OBS vía WebSocket
│       ├── GACHA/             # Sistema de gacha (personajes, overlays)
│       ├── vtuber-ai/         # IA conversacional (DeepSeek) + VTube Studio
│       ├── Music/             # Control de reproductor YouTube
│       ├── event-actions/     # Detección primer mensaje + miniprompts por evento
│       ├── chatbot/           # Comandos personalizados + timers automáticos
│       ├── strinova-app/      # Ruleta Strinova + overlay OBS
│       └── "iA Vision"/       # Librería interna (screenshot + visión AI) usada por vtuber-ai
│
├── server.js                  # Express setup + montaje de rutas
├── public/index.html          # Dashboard web (SSE, chat, TTS panel)
├── docs/                      # Documentación (ver docs/00-indice.md)
├── .env                       # Configuración (KICK, CF, FORWARD_URL_*)
├── tokens.json                # Tokens OAuth persistidos
├── iniciar.bat / iniciar.vbs  # Lanzadores de Windows
└── setup-cloudflare.bat       # Setup del túnel Cloudflare
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
# FORWARD_URL_1=http://192.168.1.119:4000/kick-events
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

## Documentación técnica

La referencia completa ya no vive en este README para no duplicarse. Todo está en
[`docs/`](docs/00-indice.md):

| | |
|---|---|
| **Arquitectura** y flujo de datos | [`docs/arquitectura.md`](docs/arquitectura.md) |
| **Endpoints HTTP** (todos los módulos) | [`docs/referencia/endpoints.md`](docs/referencia/endpoints.md) |
| **Eventos del bus** (Kick + internos + por módulo) | [`docs/referencia/eventos.md`](docs/referencia/eventos.md) |
| **Comandos de chat** (`!comando`) | [`docs/referencia/comandos.md`](docs/referencia/comandos.md) |
| **Módulos** detallados (core y triggers) | [`docs/modulos/`](docs/modulos/) |
| **Añadir un módulo nuevo** (paso a paso) | [`docs/guias/crear-modulo.md`](docs/guias/crear-modulo.md) |
| **Modificar un módulo existente** | [`docs/guias/modificar-modulo.md`](docs/guias/modificar-modulo.md) |
| **Reglas y estándares** | [`docs/estandares.md`](docs/estandares.md) |

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
- Pestañas: Eventos, TTS, Gacha, Comandos, VTuber, OBS, Chatbot, Event Actions
- Panel Event Actions: edición de miniprompts + excepciones + botón Reiniciar Chatters
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
| `tokens` | `object\|null` | Tokens OAuth (cuenta principal) |
| `botTokens` | `object\|null` | Tokens OAuth (bot) |
| `broadcasterUserId` | `string\|null` | ID del canal |
| `channelSlug` | `string\|null` | Slug del canal |
| `tunnelUrl` | `string\|null` | URL pública del túnel |
| `sseClients` | `array` | Conexiones SSE activas |
| `eventsCounter` | `number` | Total de eventos procesados |
| `authFailCount` | `number` | Intentos fallidos de auth (cuenta principal) |
| `botAuthFailCount` | `number` | Intentos fallidos de auth (bot) |

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

## Comandos del chat y guías

- **[Lista completa de comandos `!comando`]** → [`docs/referencia/comandos.md`](docs/referencia/comandos.md)
- **[Cómo añadir un módulo nuevo (paso a paso, patrones A/B/C)]** → [`docs/guias/crear-modulo.md`](docs/guias/crear-modulo.md)
- **[Cómo modificar / extender un módulo existente]** → [`docs/guias/modificar-modulo.md`](docs/guias/modificar-modulo.md)

> ⚠ **Importante al añadir un comando nuevo:** debes reflejarlo también en la pestaña
> "Comandos" del dashboard (`public/index.html#tab-comandos`), ya sea vía el endpoint
> `GET /api/commands` del módulo (dinámico) o hardcoded. Detalle en
> [`docs/estandares.md §9`](docs/estandares.md#9-añadir-un-comando-de-chat--no-olvides-el-dashboard).
