# Módulo Chatbot — Comandos personalizados + Timers

Sistema de **comandos personalizados** y **timers** (mensajes periódicos) gestionados
desde un dashboard. Reacciona a `chat.message.sent`.

## Archivos clave

| Archivo | Contenido |
|---|---|
| `index.js` | Router Express, listener del bus, motor de timers |
| `store.js` | Persistencia en `chatbot-data.json` |
| `public/` | UI standalone |

## Funcionamiento

- **Comandos**: si un mensaje coincide con un comando habilitado, responde con la
  configuración indicada como **bot**. Soporta la variable `{user}` en la respuesta
  (se reemplaza por el username). Opcionalmente puede **emitir un evento al bus**
  (`trigger`).
- **Timers**: envían mensajes periódicamente. Para evitar spam, requieren **≥5 mensajes
  de chat** en la ventana para dispararse (`MIN_MESSAGES_TO_FIRE=5`,
  `CHECK_INTERVAL=5000`).

## Endpoints HTTP (montados en `/chatbot`)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/commands` | GET | Listar comandos |
| `/api/commands` | POST | Crear comando |
| `/api/commands/:id` | PUT | Actualizar comando |
| `/api/commands/:id` | DELETE | Eliminar comando |
| `/api/commands/:id/toggle` | PATCH | Activar/desactivar |
| `/api/timers` | GET | Listar timers |
| `/api/timers` | POST | Crear timer |
| `/api/timers/:id` | PUT | Actualizar timer |
| `/api/timers/:id` | DELETE | Eliminar timer |
| `/api/timers/:id/toggle` | PATCH | Activar/desactivar |
| `/api/status` | GET | Estado general |
| Estáticos `public/` | GET | UI |

## Eventos del bus

**Emite:**
- `eventBus.emit(cmd.trigger, { user, message, command, response })` — cuando un comando
  tiene `trigger` configurado, emite ese evento arbitrario (para conectar con otros módulos).

**Escucha:**
- `chat.message.sent` (`handleChatMessage`) — cuenta actividad y dispara comandos.

## Store (`store.js`)

Funciones: `getCommands`, `getTimers`, `addCommand`, `updateCommand`, `deleteCommand`,
`addTimer`, `updateTimer`, `deleteTimer`. Persistencia en `chatbot-data.json`.
