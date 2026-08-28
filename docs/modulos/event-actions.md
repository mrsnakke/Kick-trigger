# Módulo Event Actions — Primer mensaje + miniprompts

Intercepta eventos de Kick y los **canaliza hacia la VTuber AI** con contexto adicional.
Detecta cuándo un usuario escribe por primera vez y reacciona a los eventos del canal con
"miniprompts" configurables desde el dashboard.

## Archivos clave

| Archivo | Contenido |
|---|---|
| `index.js` | Lógica principal, handlers HTTP, integración con el bus |
| `chatters.json` | Usuarios que ya han escrito (se crea automáticamente) |
| `event-actions-config.json` | Miniprompts por evento (se crea automáticamente) |

## Funcionamiento

Escucha eventos del bus y llama a `vtuber-ai.processMessage()` con contexto:

| Evento | Acción |
|---|---|
| `chat.message.sent` | Si es el **primer mensaje** del usuario, lo envía a la IA con prefijo `PRIMER MENSAJE DEL DIA DE @user: msg`. Si parece promoción/bot, alerta a `@MrsnakeVT`. |
| `channel.followed` | Envía el miniprompt de nuevo seguidor |
| `channel.subscription.new` | Miniprompt de nueva suscripción |
| `channel.subscription.renewal` | Miniprompt de renovación |
| `channel.subscription.gifts` | Miniprompt de subs regaladas |
| `channel.reward.redemption.updated` | Miniprompt con `{reward_title}` |
| `livestream.metadata.updated` | Miniprompt con `{title}` |
| `kicks.gifted` | Miniprompt de KICKS regalados |

### Detección de primer mensaje

- Los usuarios se guardan en `chatters.json` (persistencia entre reinicios).
- Si el primer mensaje empieza con `!grim` → se agrega a chatters pero **NO** se llama a
  la IA (lo maneja `vtuber-ai` directamente), evitando doble respuesta.
- Ignora bots conocidos: `botrix`, `GrimVTbot`, `mersnakevt` (case insensitive).

### Detección de bots de promoción

Analiza el primer mensaje contra keywords (URLs, "compra", "venta", "descuento", "visita
mi"...). Si detecta promoción, envía al chat:
`@MrsnakeVT ponte a chambear hay un bot haciendo promoción en chat: @user: "mensaje"`.

### Miniprompts configurables

Variables disponibles por evento:
- `{username}` — todos los eventos
- `{reward_title}` — solo `channel.reward.redemption.updated`
- `{title}` — solo `livestream.metadata.updated`

El botón **"Reiniciar Chatters"** del dashboard borra `chatters.json` en caliente.

## Endpoints HTTP

| Ruta | Método | Descripción |
|---|---|---|
| `/api/event-actions/config` | GET | Obtener miniprompts + contador de chatters |
| `/api/event-actions/config` | POST | Guardar miniprompts |
| `/api/event-actions/toggle` | POST | Activar/desactivar módulo |
| `/api/event-actions/exceptions` | GET | Listar excepciones (usuarios ignorados) |
| `/api/event-actions/exceptions` | POST | Añadir excepción |
| `/api/event-actions/exceptions/remove` | POST | Eliminar excepción |
| `/api/event-actions/reset-chatters` | POST | Reiniciar lista de chatters |

## Eventos del bus

**Escucha:** `chat.message.sent`, `channel.followed`, `channel.subscription.new`,
`channel.subscription.renewal`, `channel.subscription.gifts`,
`channel.reward.redemption.updated`, `livestream.metadata.updated`, `kicks.gifted`.

**No emite** al bus; hace broadcast SSE con `_source: 'event-actions'` y tipos
`event-actions:status` / `event-actions:reset`.

## Exports

`handleGetConfig`, `handleSaveConfig`, `handleResetChatters`, `handleToggle`,
`handleGetExceptions`, `handleAddException`, `handleRemoveException`.
