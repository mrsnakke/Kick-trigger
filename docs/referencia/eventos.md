# Eventos del Event Bus (referencia)

El Event Bus (`lib/event-bus.js`) es un `EventEmitter` singleton. Los eventos pueden ser
**emitidos** por varios módulos y **escuchados** por cualquier otro. Esta página es el
catálogo consolidado.

> ⚠️ **Duplicados:** la dedup de webhooks es de 10 min, pero ante reinicios puedes recibir
> duplicados. Tu lógica debe ser idempotente.

## Eventos de Kick (webhook entrante)

Re-emitidos por `modules/webhook.js` con el payload `{ payload, ts }`. El `evType` viene
de la cabecera `Kick-Event-Type`, así que cualquier evento de Kick se replica aquí.

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

### Acceso a datos útiles de cada payload

| Evento | Campos útiles en `payload` |
|---|---|
| `chat.message.sent` | `message.content`, `sender.username`, `message.id` |
| `channel.reward.redemption.updated` | `reward.title`, `redeemer.username` |
| `channel.subscription.new/renewal/gifts` | `user.username` (según tipo) |
| `kicks.gifted` | datos del regalo |

## Eventos internos (sistema)

| Evento | Datos | Quién lo emite | Cuándo |
|---|---|---|---|
| `auth:ready` | `{ slug }` | `auth.js` | Auth completado |
| `auth:disconnected` | — | `auth.js` | 3 fallos consecutivos |
| `auth:token-refreshed` | — | `auth.js` | Token principal refrescado |
| `bot:token-refreshed` | — | `auth.js` | Token bot refrescado |
| `tunnel:open` | `{ url }` | `tunnel.js` | Túnel abierto (dispara auto-suscripción) |
| `tunnel:closed` | `{ exitCode, log }` | `tunnel.js` | Túnel cerrado |
| `tunnel:error` | `{ error }` | `tunnel.js` | Error de túnel |
| `chat:sent` | `{ content, message_id }` | `chat.js` | Mensaje enviado al chat |

## Eventos del módulo TTS2

| Evento | Datos | Emite | Cuándo |
|---|---|---|---|
| `tts2:speak` | `{ text, voice, origin }` | **otros** (vtuber-ai) | Solicitud de habla |
| `tts2:speak:start` | `{ origin, voiceAlias, text }` | TTS2 | Empezó a hablar |
| `tts2:speak:end` | `{ origin, voiceAlias }` | TTS2 | Terminó de hablar |
| `tts:request_status` | — | `sse.js` | Cliente SSE conectado (pide estado) |
| `tts:config_updated` | `{ config, bannedWords }` | TTS2 | Config guardada |
| `tts:user_aliases_updated` | `(userAliases)` | TTS2 | Alias actualizados |

## Eventos de Event Actions

| Evento | Datos | Cuándo |
|---|---|---|
| `event-actions:status` | `{ chattersCount }` | Estado del módulo (vía SSE) |
| `event-actions:reset` | `{ chattersCount: 0 }` | Chatters reiniciados (vía SSE) |

## Eventos de otros módulos

| Evento | Datos | Emisor | Cuándo |
|---|---|---|---|
| `strinova:spin` | — | (externo, ej. OBS Actions) | Ordenar a Strinova girar la ruleta |
| `chatbot` custom `trigger` | `{ user, message, command, response }` | chatbot | Un comando configurado lo emite |

> OBS Actions emite `eventBus.emit(subAction.event, data)` con un **evento arbitrario**
> configurable por el usuario (sub-acción de tipo `event`). El nombre lo defines tú.

## Convenciones

- Nombra con prefijo de módulo: `tts2:`, `strinova:`, `event-actions:`.
- Documenta los eventos nuevos que crees aquí.

## Nota sobre "eventos SSE" vs "eventos del bus"

No confundas con los mensajes **SSE** al dashboard (`sse.broadcast(...)`) ni con los
mensajes **WebSocket** de los overlays — esos no pasan por el Event Bus. El Event Bus es
solo la comunicación **interna entre módulos** en Node.
