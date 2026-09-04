# Endpoints HTTP (referencia)

Lista consolidada de todos los endpoints. Los del **core** los registra `server.js`; los
de los **módulos** son routers montados bajo su sub-path.

## Núcleo (`server.js`)

| Ruta | Método | Descripción |
|---|---|---|
| `/auth/login` | GET | Inicia OAuth PKCE (cuenta principal) |
| `/auth/bot/login` | GET | Inicia OAuth PKCE (cuenta bot) |
| `/auth/callback` | GET | Callback OAuth (ambas cuentas) |
| `/webhook/kick` | GET/POST | GET=verificación; POST=eventos firmados de Kick |
| `/api/events` | GET | SSE — stream de eventos al dashboard |
| `/api/chat/send` | POST | Enviar mensaje como usuario principal |
| `/api/chat/send-bot` | POST | Enviar mensaje como bot |
| `/api/status` | GET | Estado actual del servidor |
| `/api/events/subscriptions` | GET | Listar suscripciones activas |
| `/api/events/subscribe` | POST | Suscribir a todos los eventos |
| `/api/tunnel/start` | POST | Iniciar túnel Cloudflare |
| `/api/tunnel/stop` | POST | Detener túnel |
| `/api/7tv/:userId` | GET | Proxy 7TV — emotes del canal (cache 10min) |
| `/api/profile/:username` | GET | Proxy perfil Kick — profile pic (cache 5min) |
| `/api/chatwidget/config` | GET | Config del ChatWidget `{config, themes, defaults}` |
| `/api/chatwidget/config` | POST | Guardar config del ChatWidget (merge) |
| `/chatwidget` | GET | Chat Widget para OBS (HTML standalone) |
| `/api/shutdown` | POST | Detener servidor + túnel |

## TTS2 (montado en `/api/tts`)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/tts/config` | GET/POST | Obtener/guardar config |
| `/api/tts/user-aliases` | GET | Lista de alias de usuarios |
| `/api/tts/user-alias/delete` | POST | Eliminar alias |
| `/api/tts/toggle` | POST | Activar/desactivar bot |
| `/api/tts/status` | GET | Estado del bot |
| `/api/tts/voices` | GET | Lista voces SAPI |
| `/api/tts/outputs` | GET | Lista dispositivos de audio |
| `/api/tts/speak-now` | POST | TTS inmediato |
| `/api/tts/speak-queue` | POST | Encolar mensaje |
| `/api/tts/queue` | GET/DELETE | Ver/vaciar cola |
| `/api/tts/events` | GET | SSE — cola TTS |

## VTuber AI (montado en `/api/vtuber`)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/vtuber/status` | GET | Estado |
| `/api/vtuber/config` | GET/POST | Config |
| `/api/vtuber/test` | POST | Probar conexión |
| `/api/vtuber/memory/clear` | POST | Limpiar memoria |
| `/api/vtuber/vts/connect` | POST | Conectar VTube Studio |
| `/api/vtuber/vts/disconnect` | POST | Desconectar VTS |
| `/api/vtuber/vts/status` | GET | Estado VTS |
| `/api/vtuber/vts/expression` | POST | Expresión facial |
| `/api/vtuber/vts/hotkey` | POST | Hotkey |
| `/api/vtuber/vts/params` | GET | Parámetros del modelo |
| `/api/vtuber/vts/param` | POST | Inyectar valor a parámetro |

## Event Actions (montado en `/api/event-actions`)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/event-actions/config` | GET/POST | Miniprompts + contador de chatters |
| `/api/event-actions/toggle` | POST | Activar/desactivar |
| `/api/event-actions/exceptions` | GET/POST | Ver/añadir excepciones |
| `/api/event-actions/exceptions/remove` | POST | Eliminar excepción |
| `/api/event-actions/reset-chatters` | POST | Reiniciar chatters |

## GACHA (montado en `/gacha`)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/stats` | GET | Estadísticas globales |
| `/api/commands` | GET | Comandos (usa el dashboard) |
| `/api/view-character?userId&userName&characterName` | GET | Carta de personaje (overlay) |
| `/api/trades/:userName` | GET | Trades de un usuario |
| `/api/trade/:id/accept` | POST | Aceptar trade |
| `/api/trade/:id/cancel` | POST | Cancelar trade |
| `/api/show-character?characterName` | GET | Mostrar personaje |
| `/admin/characters` | GET | Personajes |
| `/admin/character-details/:name` | GET | Detalle |
| `/admin/character` | POST | Crear personaje (multipart) |
| `/admin/character/:oldName` | PUT | Actualizar personaje |
| `/admin/character/:name` | DELETE | Eliminar personaje |
| `/admin/gacha-config` | GET | Config |
| `/admin/pity-data` | GET/PUT | Pity |
| `/admin/gacha-config/rarity-probabilities` | PUT | Probabilidades rareza |
| `/admin/gacha-config/banner-probabilities` | PUT | Probabilidades banner |
| `/admin/gacha-config/character-stocks` | PUT | Stocks |
| `/admin/seasons` | GET | Seasons |
| `/admin/seasons/:id/stock` | PUT | Stock season |
| `/admin/seasons/:id/mass-stock` | PUT | Stock masivo |
| `/admin/seasons/:id/add-character` | POST | Añadir personaje |
| `/admin/seasons/:id/remove-character/:name` | DELETE | Quitar personaje |
| `/admin/user-keys` | GET | Llaves de usuarios |
| `/admin/user-keys/add` | POST | Añadir llaves |
| `/admin/user-keys/add-all` | POST | Añadir llaves a todos |
| `/admin/endpoints` | GET | Lista de endpoints |
| `/admin/clear-all-data?confirm=true` | GET | Borrar todo |
| `/admin/trades` | GET | Trades |
| `/admin/trades/:id` | DELETE | Eliminar trade |
| `/*` | GET | Estáticos (overlays OBS: `view.html`, `index.html`...) |

## OBS Actions (montado en `/obs-actions`)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/data` | GET | Carga inicial completa |
| `/api/rewards` | GET | Rewards de Kick |
| `/api/obs/status` | GET | Estado OBS |
| `/api/obs/connect` | POST | Conectar OBS |
| `/api/obs/disconnect` | POST | Desconectar OBS |
| `/api/obs/scenes` | GET | Escenas |
| `/api/obs/refresh-cache` | POST | Refrescar cache |
| `/api/obs/test-sub-action` | POST | Probar sub-acción |
| `/api/actions` | GET/POST | Listar/crear acciones |
| `/api/actions/batch` | PUT | Actualización masiva |
| `/api/actions/:id` | GET/PUT/DELETE | Acción individual |
| `/api/actions/:id/execute` | POST | Ejecutar acción |
| `/api/triggers` | GET/POST | Listar/crear triggers |
| `/api/triggers/:id` | GET/PUT/DELETE | Trigger individual |
| `/api/triggers/:id/test` | POST | Probar trigger |
| `/api/triggers/pair` | POST | Emparejar reward |
| `/api/groups` | GET/POST | Listar/crear grupos |
| `/api/groups/:id` | PUT/DELETE | Grupo individual |
| `/*` | GET | Dashboard estático |

## Music (montado en `/music`)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/music/status` | GET | Estado |
| `/api/music/config` | GET/POST | Config |
| `/*` | GET | Dashboard estático |

## Chatbot (montado en `/chatbot`)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/status` | GET | Estado general |
| `/api/commands` | GET/POST | Listar/crear comandos |
| `/api/commands/:id` | PUT/DELETE | Actualizar/eliminar comando |
| `/api/commands/:id/toggle` | PATCH | Activar/desactivar comando |
| `/api/timers` | GET/POST | Listar/crear timers |
| `/api/timers/:id` | PUT/DELETE | Actualizar/eliminar timer |
| `/api/timers/:id/toggle` | PATCH | Activar/desactivar timer |
| `/*` | GET | UI estática |

## Strinova (montado en `/strinova`)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/status` | GET | Estado `{ok:true}` |
| `/*` | GET | Estáticos (default `control.html`, `overlay.html`...) |

## WebSockets

| Path | Módulo | Uso |
|---|---|---|
| `/ws/gacha` | GACHA | Overlays de OBS |
| `/ws/strinova` | Strinova | Overlay + panel de control |
