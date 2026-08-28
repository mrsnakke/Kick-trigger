# Puesta en marcha (Setup)

## Requisitos previos

- **Node.js** >= 18 (probado con Node 26.3.x). Se usan `fetch` nativo y built-ins modernos.
- **npm** incluido con Node.
- **Windows** (obligatorio para TTS: usa SAPI vía PowerShell; y para OBS si se usa).
- **cloudflared** (opcional) — solo si vas a exponer el backend a Internet para recibir webhooks de Kick. Ver [Túnel Cloudflare](#túnel-cloudflare-cloudflared).
- **OBS Studio** + plugin WebSocket (opcional, solo para el módulo OBS Actions).
- **VTube Studio** + plugin "GrimAI" (opcional, solo para el módulo VTuber AI).

## Advertencia importante sobre la "base de datos"

Este proyecto **NO usa base de datos (SQL/NoSQL)**. Toda la persistencia es en
**archivos JSON** dentro del proyecto (ver [arquitectura.md](arquitectura.md#persistencia-dónde-guarda-cada-cosa-archivos-json)):

- `tokens.json` / `bot_tokens.json` — tokens OAuth de Kick
- `modules/triggers/*/*-data.json`, `state.json`, `config.json` — config y datos de cada módulo
- `modules/triggers/event-actions/chatters.json` — lista de chatters
- `logs/vtuber-ai/*.jsonl` — historial de conversación de la IA

Para "conectar a la BD" = asegurarte de que estos archivos existan/estén bien (se crean
automáticamente al guardar config). **No hay servidor de BD que arrancar.**

## Instalación

```bash
npm install
```

> Los módulos independientes (GACHA, strinova-app, obs-actions) tienen su propio
> `package.json` con dependencias. En el backend principal, sus dependencias se resuelven
> desde sus carpetas. Si recién clonaste el repo y un módulo falla por dependencias,
> ejecuta `npm install` dentro de esa carpeta.

## Configurar variables de entorno (`.env`)

Copia los valores reales en un archivo `.env` en la raíz (ya viene ignorado por git).

```env
# --- Kick OAuth (obligatorio) ---
KICK_CLIENT_ID=tu_client_id
KICK_CLIENT_SECRET=tu_client_secret

# Opcional: override del redirect (por defecto http://localhost:3000/auth/callback)
# KICK_REDIRECT_URI=http://localhost:3000/auth/callback

# --- Cloudflare Tunnel (obligatorio para webhooks) ---
CF_TUNNEL_NAME=kick-backend
CF_DOMAIN=tudominio.ejemplo.com

# --- Opcional: reenviar eventos a otras máquinas ---
# FORWARD_URL_1=http://192.168.1.119:4000/kick-events
# FORWARD_URL_2=http://localhost:4001/kick-events

# --- Opcional: override del puerto ---
# PORT=3000

# --- Opcional: token de DeepSeek para VTuber AI (o se guarda en vtuber-data.json) ---
# DEEPSEEK_API_KEY=sk-...
# El módulo VTuber también acepta VTUBER_API_KEY
```

> `lib/config.js` lee `.env` línea a línea al arrancar e inyecta las variables en
> `process.env`. Las variables reales de entorno tienen prioridad solo si `.env` no las
> define (el parser respeta las ya existentes).

### Variables de entorno del módulo VTuber AI (todas opcionales)

| Variable | Default | Descripción |
|---|---|---|
| `VTUBER_API_KEY` | — | Alias de la API key de DeepSeek |
| `VTUBER_TEMPERATURE` | `1.0` | Creatividad de la IA |
| `VTUBER_MAX_HISTORY` | `5` | Turnos de historial por usuario |
| `VTUBER_MAX_TOKENS` | `512` | Máx. tokens de respuesta |
| `VTUBER_NAME` | `Grim` | Nombre del personaje |
| `VTUBER_COMMAND` | `!grim` | Comando del chat |

### Otras configuraciones relevantes

- `VTS_HOST` (en `vtuber-data.json` / config): IP:puerto de VTube Studio (default `192.168.1.119:8002`).
- Puerto del reproductor de YouTube (módulo Music): default `26538` (en `Music/config.json`).

## Crear la aplicación en Kick Developers

1. Ve a https://dev.kick.com/applications
2. Crea una app con Redirect URI: `http://localhost:3000/auth/callback`
3. Copia `KICK_CLIENT_ID` y `KICK_CLIENT_SECRET` al `.env`.

Los scopes OAuth solicitados por el backend (definidos en `modules/auth.js`):
`events:subscribe`, `chat:write`, `channel:read`, `channel:rewards:read`, `user:read`.
No hace falta pedir más: con autorizar una vez, el token queda persistido en
`tokens.json`.

## Correr el proyecto

```bash
node server.js
# o
npm start
# o (Windows, consola visible)
iniciar.bat
# o (Windows, silencioso — sin ventana de consola)
iniciar.vbs
```

Luego abre `http://localhost:3000` en el navegador:

1. Haz clic en **Autorizar** (cuenta principal de Kick).
2. (Opcional) Haz clic en **Autorizar Bot** (cuenta bot separada).
3. Haz clic en **Iniciar túnel** para exponer el backend y recibir webhooks.

### Lanzadores de Windows

- **`iniciar.bat`** — consola visible. Verifica Node, instala dependencias si falta
  `node_modules/`, carga `.env`, libera el puerto 3000 (mata el proceso que lo ocupe),
  abre Edge en `http://localhost:3000` y arranca `node server.js`.
- **`iniciar.vbs`** — el mismo arranque pero sin ventana de consola (ideal para autostart).
- **`setup-cloudflare.bat`** — guía interactiva de una sola vez para crear el túnel
  Cloudflare y actualizar `.env`. Ver abajo.

## Túnel Cloudflare (cloudflared)

Los webhooks de Kick necesitan una URL pública. El backend levanta un túnel de
Cloudflare que expone el puerto 3000.

**Setup por primera vez** (una vez): ejecuta `setup-cloudflare.bat`

1. Verifica que `cloudflared` esté instalado.
2. Ejecuta `cloudflared tunnel login` (abre el navegador para autenticar).
3. Pide un nombre de túnel y ejecuta `cloudflared tunnel create <nombre>`.
4. Pide un subdominio y ejecuta `cloudflared tunnel route dns <tunnel> <subdominio>`.
5. Actualiza `.env` con `CF_TUNNEL_NAME` y `CF_DOMAIN`.

**Manual (referencia completa):** ver [referencias/cloudflare-tunnel.md](referencias/cloudflare-tunnel.md).

> El binario de cloudflared se busca en `%LOCALAPPDATA%\cloudflared\cloudflared.exe`
> (ver `lib/config.js` → `CF_BIN`).

## Verificación rápida de que todo funciona

- `http://localhost:3000/api/status` devuelve JSON con `authenticated: true` tras autorizar.
- La consola muestra `[TUNNEL] Túnel iniciado con éxito!` y luego `[HEARTBEAT] OK`.
- En el dashboard (pestaña Eventos) deberían aparecer follows, mensajes, subs en vivo.

## Solución de problemas comunes

| Problema | Causa probable / solución |
|---|---|
| `Configura KICK_CLIENT_ID...` al iniciar | Falta `KICK_CLIENT_ID`/`KICK_CLIENT_SECRET` en `.env` |
| No llegan webhooks | El túnel no está iniciado, o `CF_DOMAIN` no apunta bien |
| Puerta 3000 ocupada | `iniciar.bat` la libera; a mano: `Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess` |
| TTS no suena | SAPI requiere Windows; revisa las salidas en `GET /api/tts/outputs` |
| Un módulo falla al arrancar con dependencias | `npm install` dentro de la carpeta de ese módulo |
