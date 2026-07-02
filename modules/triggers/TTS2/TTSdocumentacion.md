# TTS App — Documentación

Aplicación TTS (Text-to-Speech) para Windows usando SAPI (Speech API) vía PowerShell.  
Sin dependencias npm — solo Node.js built-ins (`http`, `child_process`, `path`, `fs`).

---

## Arquitectura

```
[ CLIENTE: index.html ]  ---> (POST /api/speak-queue) ----\
                                                          v
                                                 [ COLA DE ESPERA ]
                                                 (FIFO, 1 a la vez)
                                                          |
                                                          v
                                                 [ PROCESADOR TTS ]
                                                 (SAPI SpVoice vía PowerShell)
                                                          |
                                                          v
                                                 [ RESOLVER SALIDA ]
                                                 origen → originOutputs → outputAliases
                                                          |
                                                          v
                                                 [ SALIDA DE AUDIO ]
                                                 (índice de dispositivo)
```

Cola única compartida. Cada item lleva `origin` ("chat", "bot", etc.) para enrutar la salida según `config.json → originOutputs`.

---

## Configuración (`config.json`)

```json
{
  "voiceAliases": {
    "1": 1,
    "3": 3,
    "21": 21,
    "22": 22,
    "23": 23,
    "24": 24,
    "25": 25
  },
  "outputAliases": {
    "live": 0,
    "bot": 1
  },
  "originOutputs": {
    "chat": "live",
    "bot": "bot"
  }
}
```

| Campo | Tipo | Propósito |
|---|---|---|
| `voiceAliases` | `{string → number}` | Alias para voces españolas (1: Sabina, 3: Raul, 21: Alvaro, 22: Elvira, 23: Ximena, 24: Dalia, 25: Jorge) |
| `outputAliases` | `{string → number}` | Alias semánticos para índices de salida de audio |
| `originOutputs` | `{string → string}` | Mapeo origen → alias de salida (por defecto) |

### Resolución de índices (`resolve()`)

```
1. Si el valor existe en el alias map → usar el valor mapeado
2. Si se puede parsear como entero → usar ese entero
3. Sino → default 0
```

### Enrutamiento por origen (`resolveOutput()`)

Cuando un item se encola **sin salida explícita**, se usa `originOutputs` + `outputAliases`:

```
origin "chat" → originOutputs["chat"] = "live" → outputAliases["live"] = 0
origin "bot"  → originOutputs["bot"]  = "bot"  → outputAliases["bot"]  = 1
```

Si el item **tiene** salida explícita (`explicitOutput = true`), se usa directamente y se salta el mapeo por origen.

---

## API Endpoints

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| `GET` | `/api/voices` | — | `[{index, name}]` |
| `GET` | `/api/outputs` | — | `[{index, name}]` |
| `POST` | `/api/speak-now` | `{text, voice?, output?}` | `{ok: true}` |
| `POST` | `/api/speak-queue` | `{text, voice?, output?, origin?}` | `{id}` |
| `GET` | `/api/queue` | — | `{queue: [...], currentId}` |
| `DELETE` | `/api/queue` | — | `{ok: true}` |
| `GET` | `/api/config` | — | `{voiceAliases, outputAliases, originOutputs}` |
| `POST` | `/api/config/reload` | — | `{ok: true}` |
| `GET` | `/api/events` | — | SSE (`queue-update`) |
| `GET` | `/` | — | `index.html` |

### POST /api/speak-now

Fire-and-forget: habla inmediatamente sin pasar por la cola. No espera a que termine.

```bash
curl -X POST http://localhost:3000/api/speak-now ^
  -H "Content-Type: application/json" ^
  -d "{\"text\":\"Hola mundo\"}"
```

| Campo | Tipo | Default | Descripción |
|---|---|---|---|
| `text` | `string` | **requerido** | Texto a hablar |
| `voice` | `string\|number` | `"1"` (Sabina) | Alias o índice de voz |
| `output` | `string\|number` | `"0"` | Alias o índice de salida |

### POST /api/speak-queue

Encola un mensaje para procesamiento secuencial (FIFO). Si no se especifica `output`, se resuelve según `origin` → `originOutputs` → `outputAliases`.

```bash
curl -X POST http://localhost:3000/api/speak-queue ^
  -H "Content-Type: application/json" ^
  -d "{\"text\":\"Mensaje del bot\",\"voice\":\"21\",\"origin\":\"bot\"}"
```

| Campo | Tipo | Default | Descripción |
|---|---|---|---|
| `text` | `string` | **requerido** | Texto a hablar |
| `voice` | `string\|number` | `"1"` (Sabina) | Alias o índice de voz |
| `output` | `string\|number` | depende del `origin` | Alias o índice de salida; si se omite, se resuelve vía `originOutputs` |
| `origin` | `string` | `undefined` | Etiqueta de origen ("chat", "bot", etc.) para enrutamiento |

### Voces disponibles (aliases)

| Alias | Voz | Índice SAPI |
|-------|-----|-------------|
| `"1"` | Sabina (México) | 1 |
| `"3"` | Raul (México) | 3 |
| `"21"` | Álvaro (España) | 21 |
| `"22"` | Elvira (España) | 22 |
| `"23"` | Ximena (Colombia) | 23 |
| `"24"` | Dalia (México) | 24 |
| `"25"` | Jorge (México) | 25 |

---

## Frontend

### Paneles

Dos paneles lado a lado: **Chat** y **Bot**. Cada uno tiene:

- **Filtro de voces** — input de texto que oculta/muestra opciones del selector de voz
- **Selector de voz** — solo los 7 aliases del config (Sabina, Raul, Alvaro, Elvira, Ximena, Dalia, Jorge)
- **Selector de salida** — muestra todos los dispositivos de audio disponibles + los aliases del config
- **Input de texto + botón Encolar**

La selección de voz y salida se persiste en `localStorage` (clave `tts_<id>`) y se restaura al recargar la página.

### Cola compartida

Lista debajo de los paneles que muestra todos los mensajes encolados sin importar su origen. Cada item muestra:

- Badge de origen (`chat` / `bot`) con la salida resuelta (ej: `chat → live`)
- Número en cola (1-indexed)
- Texto (truncado a 50 chars)
- Estado: `waiting` (gris) o `speaking` (azul con borde izquierdo)
- Icono: ⏳ (waiting) / 🔊 (speaking)

Botón **Vaciar cola** para limpiar todos los mensajes pendientes.

### Barra de configuración

- Resumen de aliases: cantidad de voces + mapeo de orígenes (ej: `6 voces | chat → live, bot → bot`)
- Botón **Recargar config** — hot-reload + refresca el frontend
- Indicador de estado: punto inactivo (gris) / hablando (azul con pulso)
- Contador de items en cola

### Log de eventos

Caja scrolleable al fondo con timestamps. Muestra cada mensaje encolado, cuando comienza a hablar, y errores. Retiene los últimos 50 eventos.

### SSE (Server-Sent Events)

Conexión persistente a `/api/events` que recibe eventos `queue-update` y re-renderiza la cola en tiempo real. El payload incluye el array completo de items con su estado actual.

---

## Flujo de Cola y Procesamiento

```
POST /api/speak-queue
        │
        v
  enqueue(text, voiceIndex, outputIndex, origin, explicitOutput)
        │
        ├── Asigna id autoincremental
        ├── Push a queue[]
        ├── Broadcast SSE "queue-update" (item como "waiting")
        └── processQueue()
                │
                v
          ┌─── processing = true
          │    item = queue.shift()
          │    currentId = item.id
          │    Broadcast (item como "speaking")
          │    await speakPS(voiceIndex, resolveOutput(item), text)
          │      │
          │      v
          │    PowerShell: SAPI SpVoice → .Speak()
          │      │
          │      v
          │    (éxito o error)
          │    currentId = null
          │    Broadcast (item removido)
          │    processing = false
          └─── processQueue() ← tail recursion
```

- **FIFO estricto** — se procesa un mensaje a la vez
- **Lock** con booleano `processing`
- **Timeout** de 120s por llamada a PowerShell
- El texto se escapa duplicando comillas simples (`'` → `''`) para evitar errores en el script PS

---

## Inicio

```bash
node server.js
# Puerto 3000 por defecto (overridable via PORT env)
```

O usando `start.bat`:

```batch
@echo off
cd /d "%~dp0"
echo Starting TTS Server...
node server.js
pause
```

Abrir en navegador: `http://localhost:3000`

---

## Flujo completo

1. `config.json` mapea 7 voces españolas con aliases `"1"`–`"25"`
2. Usuario escribe "Hola" en panel Chat y presiona **Encolar**
3. Frontend envía `POST /api/speak-queue` con `{text: "Hola", voice: "1", output: "live", origin: "chat"}`
4. Servidor encola, resuelve `voice→1` (Sabina), `output→0` vía outputAliases (explícito)
5. `processQueue()` ejecuta `speakPS(1, 0, "Hola")`
6. PowerShell habla "Hola" con voz Sabina por el dispositivo de audio índice 0
7. Broadcast SSE actualiza la cola — item desaparece
