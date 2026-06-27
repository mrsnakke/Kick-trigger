# Kick Backend — Módulos & Triggers

![Node](https://img.shields.io/badge/Node.js-26.3.1-339933?logo=node.js&logoColor=white)
![npm](https://img.shields.io/badge/npm-11.16.0-CB3837?logo=npm&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.21.0-000000?logo=express&logoColor=white)

## Estructura

```
kick-backend/
├── lib/                  # Librerías base
│   ├── event-bus.js      # EventEmitter singleton (núcleo de comunicación)
│   ├── config.js         # .env parser + constantes
│   ├── state.js          # Estado compartido (tokens, channel info, etc.)
│   └── forwarder.js      # Reenvío HTTP de eventos a otras máquinas
│
├── modules/              # Módulos funcionales
│   ├── auth.js           # OAuth + token management
│   ├── webhook.js        # Receptor webhook Kick + validación RSA
│   ├── chat.js           # Enviar mensajes al chat de Kick
│   ├── tunnel.js         # Cloudflare tunnel
│   ├── sse.js            # SSE push al frontend
│   ├── events.js         # Suscripción a eventos de Kick
│   └── triggers/         # ★ Tus módulos de reacción aquí
│       └── (crea tus .js aquí)
│
├── server.js             # Express setup + montaje de rutas
├── .env                  # Configuración (KICK, CF, FORWARD_URL_*)
└── tokens.json           # Tokens OAuth persistidos
```

## Cómo funciona el Event Bus

`lib/event-bus.js` exporta un `EventEmitter` de Node.js. Es el sistema nervioso central:

- Cualquier módulo puede emitir eventos: `eventBus.emit('chat.message.sent', data)`
- Cualquier módulo/trigger puede escuchar: `eventBus.on('chat.message.sent', handler)`
- El forwarder escucha eventos y los reenvía por HTTP a otras máquinas
- Los triggers escuchan eventos y reaccionan (ruleta, recompensas, etc.)

**No necesitas modificar el core para agregar comportamiento nuevo.** Solo creas un trigger.

## Eventos disponibles

### Eventos de Kick (webhook entrante)

| Nombre del evento | Datos | Cuándo ocurre |
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

Cada `payload` contiene la estructura exacta que Kick envía en el webhook. El `ts` es el timestamp del evento.

### Eventos internos

| Evento | Datos | Cuándo ocurre |
|---|---|---|
| `auth:ready` | `{ slug }` | Auth completado exitosamente |
| `auth:disconnected` | `{}` | Auth falló permanentemente |
| `auth:token-refreshed` | `{}` | Token refrescado |
| `tunnel:open` | `{ url }` | Túnel Cloudflare abierto |
| `tunnel:closed` | `{ exitCode, log }` | Túnel cerrado |
| `tunnel:error` | `{ error }` | Error de túnel |
| `chat:sent` | `{ content, message_id }` | Mensaje enviado al chat |

## Cómo crear un trigger

### 1. Crear archivo en `modules/triggers/`

```js
// modules/triggers/ruleta.js
const eventBus = require('../../lib/event-bus')

// Escuchar canje de puntos de canal
eventBus.on('channel.reward.redemption.updated', async (data) => {
  const { payload, ts } = data
  const rewardName = payload.reward?.title

  if (rewardName === 'Ruleta Spin') {
    console.log('[RULETA]', payload.redeemer?.username, 'activó la ruleta')

    // Lógica de la ruleta...
    const resultado = ['🎉 Ganaste', '😢 Perdiste'][Math.random() > 0.5 ? 0 : 1]

    // Enviar resultado por chat (usa el módulo de chat o llama directo a la API)
    await fetch('http://localhost:3000/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `@${payload.redeemer?.username} ${resultado}` })
    })
  }
})

// Opcional: notificar al frontend vía SSE
const sse = require('../sse')
eventBus.on('tunnel:open', (data) => {
  sse.broadcast({ type: 'custom', message: 'Trigger ruleta activo' })
})

console.log('[TRIGGER] Ruleta cargada')
```

### 2. Cargar el trigger desde `server.js`

Agrega una línea al final de las imports en `server.js`:

```js
require('./modules/triggers/ruleta')
```

Eso es todo. El trigger arranca automáticamente con la app.

## Criterios importantes para crear triggers

1. **Archivos individuales**: cada trigger va en su propio `.js` dentro de `modules/triggers/`. Si el trigger crece, lo refactorizas a una carpeta.

2. **Sin modificar el core**: tu trigger solo importa del `lib/` o de otros módulos (`sse`, `chat`, etc.). No toques `server.js`, `webhook.js`, etc. (excepto para agregar el `require`).

3. **Fire-and-forget**: los handlers de eventos NO deben bloquear el event bus. Si haces trabajo pesado (API calls lentas), asegúrate de que no es síncrono.

4. **Manejo de errores**: cada trigger es responsable de su propio try/catch. Un error en un trigger no debe romper otros triggers ni el core.

5. **Cero dependencias nuevas**: usa `fetch` (nativo en Node 18+), `fs`, etc. Solo agrega un npm package si realmente es necesario.

6. **Idempotencia**: los eventos pueden llegar duplicados (el webhook tiene dedup de 10 min, pero igual). Diseña tu trigger para ser idempotente.

## Reenvío a otras máquinas (Forwarder)

Configurá en `.env` una o más URLs para reenviar eventos:

```env
FORWARD_URL_1=http://192.168.50.246:4000/kick-events
FORWARD_URL_2=http://localhost:4001/kick-events
```

Cada evento Kick válido se envía como POST a cada URL con el payload:

```json
{
  "event": "channel.reward.redemption.updated",
  "data": { "payload": { ... }, "ts": "..." },
  "source": "kick-backend",
  "ts": "2026-06-27T..."
}
```

La máquina remota recibe eventos igual que un trigger local, pero vía HTTP.

## Datos compartidos (state)

`lib/state.js` expone un objeto mutable con:

| Propiedad | Tipo | Descripción |
|---|---|---|
| `tokens` | `object\|null` | Tokens OAuth |
| `broadcasterUserId` | `string\|null` | ID del canal |
| `channelSlug` | `string\|null` | Slug del canal |
| `tunnelUrl` | `string\|null` | URL pública del túnel |
| `sseClients` | `array` | Conexiones SSE activas |
| `eventsCounter` | `number` | Total de eventos procesados |

Los triggers pueden leer este estado, pero no deberían modificarlo.
