# Módulo Voice Chat — Voz privada → Grim → TTS

Canal privado de comunicación por voz entre el streamer y Grim. El streamer habla,
Whisper transcribe, Grim responde y el TTS lee la respuesta en voz alta. **No se
envía nada al chat de Kick.**

## Arquitectura

```
Hotkey "+" → grabar audio → Whisper transcribe → POST /api/voice-chat/ask
    → vtuber.processMessage(skipChat=true) → DeepSeek responde → TTS lee
```

Dos procesos:
- **Python** (`modules/triggers/VOz/server.py`) — FastAPI + Whisper + hotkey, puerto 8000
- **Node** (`server.js`) — endpoint `/api/voice-chat/ask`, reutiliza vtuber-ai, puerto 3000

## Archivos

| Archivo | Rol |
|---|---|
| `modules/triggers/VOz/server.py` | Servidor Python: Whisper + hotkey + POST al backend |
| `modules/triggers/VOz/index.html` | UI: botón mic, estado, log de preguntas/respuestas |
| `modules/triggers/VOz/requirements.txt` | Dependencias Python |
| `modules/triggers/VOz/start.bat` | Fallback manual para arrancar uvicorn |
| `server.js` (línea ~145) | Endpoint `POST /api/voice-chat/ask` |
| `server.js` (línea ~286) | Auto-start del servidor Python VOz |
| `modules/triggers/vtuber-ai/index.js` | `processMessage(..., skipChat)` — quinto parámetro |

## Endpoints

### Node backend (puerto 3000)

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| POST | `/api/voice-chat/ask` | `{ "text": "pregunta del streamer" }` | `{ "ok": true, "text": "respuesta de Grim" }` |

### Python VOz (puerto 8000)

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| POST | `/ask` | FormData `file` (audio webm) | `{ "text": "transcripción", "reply": "respuesta Grim" }` |
| POST | `/transcribe` | FormData `file` (audio webm) | `{ "text": "transcripción" }` |
| GET | `/` | — | `index.html` |
| WS | `/ws` | — | `start`/`stop` (hotkey events) |

## Flujo detallado

1. El streamer presiona `+` (hotkey global) o hace click en el botón mic
2. El navegador graba audio con `MediaRecorder` (webm)
3. Al soltar la tecla, el audio se envía a `POST /ask` del servidor Python
4. Python transcribe con Whisper (`faster-whisper`, modelo `base`)
5. Python hace POST a `http://localhost:3000/api/voice-chat/ask` con el texto
6. Node llama `vtuber.processMessage('Streamowner', text, true, null, true)`:
   - `skipLog=true` — no loguea en memoria (conversación privada)
   - `skipChat=true` — no envía a chat de Kick
7. DeepSeek genera la respuesta, se procesan emociones VTS
8. Se emite `tts2:speak` — el TTS lee la respuesta en voz alta
9. La respuesta llega de vuelta al HTML y se muestra en el log

## Configuración

### Variable de entorno

```bash
BACKEND_URL=http://localhost:3000  # URL del Node backend (default)
```

### Requisitos

- Python 3.10+ con venv
- Node.js backend corriendo en :3000
- DeepSeek API key configurada en vtuber-ai
- TTS2 activo para que Grim hable

### Instalar (una sola vez)

```bash
cd modules/triggers/VOz
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### Arrancar

**Automático** — al iniciar `node server.js`, el servidor Python VOz arranca solo en `:8000`.
Si el venv no existe o Python no está instalado, falla silenciosamente con un warning.

**Manual** (fallback) — `start.bat` dentro de `modules/triggers/VOz/`.

## `processMessage` — parámetro `skipChat`

```js
// Flujo normal (chat + TTS):
vtuber.processMessage('user', 'hola', false)

// Voz privada (solo TTS, sin chat):
vtuber.processMessage('Streamowner', 'pregunta', true, null, true)
//                                                        ^^^^^ skipChat
```

Cuando `skipChat=true`:
- **No** envía mensajes a Kick chat
- **Sí** llama a DeepSeek (genera respuesta)
- **Sí** emite `tts2:speak` (TTS lee la respuesta)
- **Sí** procesa emociones VTS (expresiones faciales)
- **No** loguea en memoria (si `skipLog=true`)
