# Módulo VTuber AI — IA conversacional + VTube Studio (+ iA Vision)

IA conversacional que escucha el chat (comando `!grim`), responde por chat y por voz, y
controla un modelo de VTube Studio (expresiones faciales, hotkeys, parámetros).

## Archivos clave

| Archivo | Contenido |
|---|---|
| `index.js` | Lógica principal, handlers HTTP, integración con el bus |
| `deepseek-client.js` | Cliente DeepSeek API (tool calling, web_search, toma de screenshot) |
| `config.js` | Carga el system prompt desde archivo |
| `logger.js` | Logging de conversaciones a JSONL |
| `vtube-client.js` | Cliente WebSocket VTube Studio |
| `vtube-model.js` | Mapeo de modelos y parámetros VTube Studio |
| `prompts/vtuber-system.es.md` | Prompt del sistema (personalidad) |
| `vtuber-data.json` | API key + config persistente |
| `model_dict.json` | Diccionario de parámetros/modelos |

## Funcionamiento

1. Escucha `chat.message.sent`, filtra por el comando (por defecto `!grim`).
2. Construye el contexto: prompt de sistema + historial por usuario (memoria en JSONL).
3. Llama a DeepSeek con **herramientas**: `web_search` (DuckDuckGo), `get_current_time`,
   y `take_screenshot` (usa **iA Vision**).
4. Extrae emoción → controla VTube Studio (expresión facial).
5. Envía la respuesta al chat como **bot** (divide en chunks de 400 chars) y emite
   `tts2:speak` (voz `24`, Dalia, origen `bot`) para que la lea el TTS.

### `processMessage(username, content, skipLog?)`

Función programática exportada para que **otros módulos** (p. ej. event-actions) envíen
mensajes directos a la IA sin pasar por `!grim`:

```js
const vtuber = require('./modules/triggers/vtuber-ai')
vtuber.processMessage(usuario, 'texto o contexto', true)
```

- Completa: memoria, herramientas, emoción, respuesta en chat + voz.
- `skipLog=true` evita loguear (útil para miniprompts internos sin ensuciar el historial).

## Configuración (`vtuber-data.json` + env)

| Variable | Default | Descripción |
|---|---|---|
| `VTUBER_API_KEY` / `DEEPSEEK_API_KEY` | — | Clave de DeepSeek |
| `VTUBER_TEMPERATURE` | `1.0` | Creatividad |
| `VTUBER_MAX_HISTORY` | `5` | Turnos de historial |
| `VTUBER_MAX_TOKENS` | `512` | Máx. tokens |
| `VTUBER_NAME` | `Grim` | Nombre |
| `VTUBER_COMMAND` | `!grim` | Comando del chat |
| `VTS_HOST` (en config) | `192.168.1.119:8002` | Host de VTube Studio |

## Comandos de chat

| Comando | Descripción | Permiso |
|---|---|---|
| `!grim <pregunta>` | Grim responde con IA (chat + voz) | User |

## Endpoints HTTP

| Ruta | Método | Descripción |
|---|---|---|
| `/api/vtuber/status` | GET | Estado |
| `/api/vtuber/config` | GET | Config actual |
| `/api/vtuber/config` | POST | Guardar API key/config |
| `/api/vtuber/test` | POST | Probar conexión |
| `/api/vtuber/memory/clear` | POST | Limpiar memoria |
| `/api/vtuber/vts/connect` | POST | Conectar VTube Studio |
| `/api/vtuber/vts/disconnect` | POST | Desconectar |
| `/api/vtuber/vts/status` | GET | Estado VTS |
| `/api/vtuber/vts/expression` | POST | Activar expresión facial |
| `/api/vtuber/vts/hotkey` | POST | Ejecutar hotkey |
| `/api/vtuber/vts/params` | GET | Lista parámetros del modelo |
| `/api/vtuber/vts/param` | POST | Inyectar valor a un parámetro |

## Eventos del bus

**Emite:**
- `tts2:speak` `{ text, voice: '24', origin: 'bot' }` — para que TTS lea la respuesta

**Escucha:**
- `chat.message.sent` (`onChatMessage`) — para `!grim` (y re-registrado si falta en saveConfig)

## iA Vision (librería interna)

⚠️ **`modules/triggers/iA Vision/` NO es un módulo independiente**: no tiene router ni
endpoints ni escucha el bus. Es una **librería** consumida exclusivamente por
`deepseek-client.js` como la herramienta `take_screenshot` del bot.

- `capture()` — ejecuta `capture.ps1` (captura la pantalla primaria con PowerShell) y
  devuelve la ruta del JPEG en `os.tmpdir()/ia-see-shot.jpg`.
- `analyze(apiKey, prompt)` — captura la pantalla, la codifica en base64 y la envía a
  DeepSeek (`deepseek-v4-flash-vision-exp`) para obtener una descripción en texto.

Se dispara **indirectamente** cuando el chat le pide al bot "mirar la pantalla" (vía la
herramienta `take_screenshot`).

## Logs

Las conversaciones se guardan en `logs/vtuber-ai/<usuario>_<fecha>.jsonl`. Se limpian
automáticamente los archivos con más de 30 días.
