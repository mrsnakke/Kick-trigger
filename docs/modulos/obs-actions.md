# Módulo OBS Actions — Control de OBS

Controla OBS Studio vía WebSocket (`obs-websocket-js`). Permite configurar **acciones**
(secuencias de sub-acciones), asociarlas a **triggers** (comandos de chat o rewards de
Kick) y organizarlas en **grupos**, todo desde un dashboard web.

## Archivos clave

| Archivo | Contenido |
|---|---|
| `index.js` | Router Express, lógica de triggers, conexión con el bus |
| `obs.js` | Cliente OBS WebSocket (auto-reconexión, cache de escenas/ítems y grupos) |
| `engine.js` | Ejecutor de sub-acciones |
| `store.js` | Persistencia en `obs-data.json` |
| `public/` | Dashboard web del módulo |
| `package.json` | `express`, `obs-websocket-js` |

## Conceptos

- **Acción**: secuencia de **sub-acciones**.
- **Sub-acción**: tipo de paso a ejecutar:
  - `visibility` — muestra/oculta una fuente en una escena.
  - `delay` — espera N ms.
  - `event` — emite un evento arbitrario al bus (`eventBus.emit(subAction.event, data)`).
- **Trigger**: dispara una acción. Tipos:
  - `chat_command` — se dispara con un `!comando` en el chat.
  - `reward` — se dispara con un reward de canal (título contiene un `pattern`).
  - `tts:<origin>:start` / `tts:<origin>:end` — reacciona al inicio/fin de TTS.
- **Grupo**: organiza acciones en el dashboard.

### Pairing de rewards

`POST /api/triggers/pair` inicia un **modo pairing**: escucha el primer reward de canal
que llegue y lo asigna automáticamente al trigger.

## Comandos de chat

- **Dinámicos**: cualquier trigger de tipo `chat_command` con su `!comando` configurado
  desde el dashboard. No hay comandos hardcodeados.

## Endpoints HTTP (montados en `/obs-actions`)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/data` | GET | Carga inicial completa |
| `/api/obs/status` | GET | Estado de conexión OBS |
| `/api/obs/connect` | POST | Conectar a OBS |
| `/api/obs/disconnect` | POST | Desconectar |
| `/api/obs/scenes` | GET | Lista de escenas |
| `/api/obs/refresh-cache` | POST | Refrescar cache de escenas |
| `/api/obs/test-sub-action` | POST | Probar sub-acción |
| `/api/actions` | GET/POST | CRUD listado/crear acciones |
| `/api/actions/:id` | GET/PUT/DELETE | CRUD acción individual |
| `/api/actions/batch` | PUT | Actualización masiva |
| `/api/actions/:id/execute` | POST | Ejecutar acción |
| `/api/triggers` | GET/POST | CRUD triggers |
| `/api/triggers/:id` | GET/PUT/DELETE | CRUD trigger individual |
| `/api/triggers/:id/test` | POST | Probar trigger |
| `/api/triggers/pair` | POST | Emparejar reward |
| `/api/groups` | GET/POST | CRUD grupos |
| `/api/groups/:id` | PUT/DELETE | CRUD grupo individual |
| `/api/rewards` | GET | Lista de rewards de Kick |
| Estáticos `public/` | GET | Dashboard |

## Eventos del bus

**Emite:**
- `eventBus.emit(subAction.event, data)` — cuando ejecuta una sub-acción de tipo `event`
  (evento configurable por el usuario).

**Escucha:**
- `chat.message.sent` — triggers de tipo `chat_command`
- `channel.reward.redemption.updated` — triggers de tipo `reward`
- `tts2:speak:start` / `tts2:speak:end` — triggers de tipo `tts:<origin>:start/end`

## Exports

`{ router, obs, engine, store, init }`. `obs.js` exporta una instancia `OBSManager`
(EventEmitter que emite `connected` / `disconnected`).

## Para añadir un tipo de sub-acción

Ver [guias/modificar-modulo.md §6](../guias/modificar-modulo.md#6-añadir-una-sub-acción-nueva-caso-obs-actions).
