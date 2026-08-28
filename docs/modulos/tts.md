# Módulo TTS2 — Texto a voz (SAPI)

Combierte mensajes del chat en voz usando **SAPI SpVoice de Windows** vía PowerShell.
Sin dependencias npm (usa built-ins de Node). Se integra en el servidor principal
(`index.js`) como una cola FIFO que procesa un mensaje a la vez.

> Hay un `server.js` standalone dentro de la carpeta (duplica la lógica, puerto 3000);
> el backend principal **no lo usa** — usa `index.js`. Referencia standalone:
> [referencias/tts-standalone.md](../referencias/tts-standalone.md).

## Archivos clave

| Archivo | Contenido |
|---|---|
| `index.js` | Cola + SAPI + API + comandos (módulo integrado) |
| `server.js` | Servidor standalone (no usado por el main) |
| `config.json` | Mapeo de voces, salidas de audio y orígenes |
| `tts-data.json` | Persistencia de `userAliases` y `bannedWords` |
| `public/` | UI standalone (opcional) |

## Arquitectura

```
chat.message.sent ──► handleChatMessage ──► ¿empieza con COMMAND? ──► enqueue(texto)
                                                                    ▼
                                              COLA FIFO (1 a la vez)
                                                                    ▼
                                              SAPI SpVoice (PowerShell)
                                                                    ▼
                                              salida según origin (live/bot)
```

Se enruta la salida por `origin` vía `originOutputs` → `outputAliases`. El TTS **emite**
eventos al bus cuando empieza/termina de hablar (lo usa OBS Actions para triggers).

## Configuración (`config.json`)

- `voiceAliases`: alias → índice SAPI.
- `outputAliases`: nombre semántico (ej. `live: 0`, `bot: 1`) → índice de dispositivo.
- `originOutputs`: origen (chat/bot) → alias de salida.
- `COMMAND`: comando de chat (default `!sp`).
- `MAX_TEXT_LENGTH`: 600.
- `KICKBONKS_URL`: servicio de "bonks".
- `bannedWords`: palabras prohibidas (filtradas).
- `userAliases` (en `tts-data.json`): asignación usuario → voz persistente.

## Voces SAPI disponibles

| Alias | Voz | Índice |
|---|---|---|
| `"1"` | Sabina (México) | 1 |
| `"3"` | Raul (México) | 3 |
| `"21"` | Álvaro (España) | 21 |
| `"22"` | Elvira (España) | 22 |
| `"23"` | Ximena (Colombia) | 23 |
| `"24"` | Dalia (México) | 24 — solo para el bot (VTuber AI) |
| `"25"` | Jorge (México) | 25 |

> El bot VTuber AI usa la voz `24` (Dalia). Ver [vtuber-ai.md](vtuber-ai.md).

## Comandos de chat

| Comando | Descripción | Permiso |
|---|---|---|
| `!sp <texto>` | Reproduce con la voz asignada del usuario | User |
| `!sp <alias> <texto>` | Reproduce con una voz específica (ej: `!sp 21 hola`) | User |
| `!<nombre_voz>` | Asigna esa voz permanentemente al usuario (ej: `!sabina`) | User |
| `!voz` | Lista voces disponibles (excluye Dalia) | User |
| `!bonk` | Lanza un bonk (HTTP a KickBonks) | User |
| `!bonks` | Lanza ráfaga de bonks | User |

## Endpoints HTTP

| Ruta | Método | Descripción |
|---|---|---|
| `/api/tts/config` | GET | Obtener config |
| `/api/tts/config` | POST | Guardar config |
| `/api/tts/user-aliases` | GET | Lista de alias de usuarios |
| `/api/tts/user-alias/delete` | POST | Eliminar alias |
| `/api/tts/toggle` | POST | Activar/desactivar bot |
| `/api/tts/status` | GET | Estado del bot |
| `/api/tts/voices` | GET | Lista voces SAPI disponibles |
| `/api/tts/outputs` | GET | Lista dispositivos de audio |
| `/api/tts/speak-now` | POST | TTS inmediato (fire-and-forget) |
| `/api/tts/speak-queue` | POST | Encolar mensaje |
| `/api/tts/queue` | GET | Estado de la cola |
| `/api/tts/queue` | DELETE | Vaciar cola |
| `/api/tts/events` | GET | SSE — cola en tiempo real |

## Eventos del bus

**Emite:**
- `tts2:speak:start` `{ origin, voiceAlias, text }` — empezó a hablar
- `tts2:speak:end` `{ origin, voiceAlias }` — terminó
- `tts:config_updated` `{ config, bannedWords }`
- `tts:user_aliases_updated` `(userAliases)`

**Escucha:**
- `tts2:speak` `({ text, voice, origin })` — solicitud de habla desde otros módulos (vtuber-ai)
- `chat.message.sent`
- `tts:request_status`
- `tts:config_updated`, `tts:user_aliases_updated`

### API programática

`enqueue(text, voice, origin?)` encola un mensaje de voz directamente desde código.
Para hablar la voz `24` (Dalia) como bot, cualquier módulo puede emitir
`eventBus.emit('tts2:speak', { text, voice: '24', origin: 'bot' })` — así lo hace VTuber AI.
