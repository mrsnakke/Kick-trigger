# Módulo Music — Control de reproductor YouTube

Controla un **reproductor de YouTube externo** vía su API REST
(`http://localhost:PORT`). Hace polling del estado y notifica cambios de canción al chat.

> El reproductor es un proceso aparte (no forma parte de este backend). Este módulo se
> comunica con él por HTTP.

## Archivos clave

| Archivo | Contenido |
|---|---|
| `index.js` | Lógica principal, comandos, polling, API |
| `client.js` | Cliente HTTP del reproductor externo |
| `config.json` | Config persistente |
| `public/` | Dashboard del módulo |

## Api del `client.js` (reproductor externo)

`setPort`, `getBase`, `getSongInfo`, `search`, `addToQueue`, `getQueue`, `next`,
`togglePlay`, `setVolume`, `like`, `videoIdFromUrl`, `extractVideoIdFromSearch`.

Comunica con el reproductor (`localhost:26538` por defecto) en `/api/v1/song-info`,
`/api/v1/search`, `/api/v1/queue`, `/api/v1/next`, `/api/v1/toggle-play`, `/query`.

## Configuración (`config.json`)

- `PORT`: puerto del reproductor (default `26538`).
- `POLL_INTERVAL`: ms de polling (default `3000`).
- `AUTO_NOTIFY`: notificar cambios de canción al chat (default `true`).
- Comandos configurables: `song`, `addsong`/`sr`, `skip`, `stop`, `volume`, `like`.

## Comandos de chat

| Comando | Descripción | Permiso |
|---|---|---|
| `!song` | Canción actual | User |
| `!addsong` / `!sr` | Añadir a la cola | User |
| `!skip` | Saltar a la siguiente | User |
| `!stop` | Pausa/reanuda | User |
| `!volume <0-100>` | Volumen | User |
| `!like` | Like | User |

## Endpoints HTTP (montados en `/music`)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/music/status` | GET | Estado |
| `/api/music/config` | GET | Config |
| `/api/music/config` | POST | Guardar config |
| Estáticos `public/` | GET | Dashboard |

## Eventos del bus

**Escucha:** `chat.message.sent` (`onChatMessage`).

**No emite** eventos al bus. Solo hace broadcast SSE con `_source: 'music'` y
`type: 'status'` (estado del reproductor — manejado aparte en el frontend, no pisa los
badges de auth; ver [estandares.md §7](../estandares.md#7-sse--tipos-reservados)).
