# ChatWidget (Overlay para OBS)

Overlay de chat en vivo para OBS, integrado con el SSE del backend (no usa Pusher).
Se sirve de forma standalone en `/chatwidget` y se controla desde la pestaña
**Chat Widget** del dashboard (`public/index.html`).

## URL para OBS

- Preview/desarrollo: `http://localhost:3000/chatwidget`
- OBS Browser Source (fondo sólido): `http://localhost:3000/chatwidget?obs=true`
- Emote Overlay (solo emotes, pantalla completa): `http://localhost:3000/emotes`

Parámetros soportados:

| Parámetro | Valor | Efecto |
|---|---|---|
| `obs` | `true` | Fondo sólido `#0d1117` en vez de transparente |

## Overlay de Emotes (`/emotes`)

Overlay independiente de pantalla completa (recomendado **1920×1080**, fondo
transparente) que dibuja **un emote cayendo por cada emote del chat**: cae con
gravedad, rebota y se desvanece. Va **encima** de cámara/juego en OBS para que
los emotes caigan "frente al stream".

- Página: `public/chatwidget/emotes.html` (servida por la ruta `/emotes`).
- Motor de física compartido y reutilizable: `public/chatwidget/physics.js`
  (`EmotePhysics.create(canvas, opts)` → `spawn/clear/setOptions/pause/resume`).
  Usa delta-time normalizado (misma velocidad a 60/120/144Hz), respeta la
  proporción real del emote, tiene tope de partículas y caché de imágenes.
- Fuente de datos: mismo SSE `/api/events` (`chat.message.sent`). Detecta emotes
  de Kick (`emote_id`), YouTube (`imageUrl`), tags `[emote:id:name]` y nombres
  7TV presentes en el texto.
- **Dedupe**: por defecto un solo emote por emote distinto en el mensaje (evita
  que spameen el mismo y te llenen la pantalla).
- El widget de chat ya **no** dibuja física (evita emotes duplicados en OBS).

Parámetros de URL (override sin guardar):

| Parámetro | Ejemplo | Efecto |
|---|---|---|
| `mode` | `rain` \| `fountain` \| `burst` | Patrón de caída |
| `size` | `120` | Lado mayor del emote en px |
| `gravity` | `0.6` | Gravedad |
| `bounce` | `0.62` | Rebote al tocar el piso (0..1) |
| `friction` | `0.99` | Rozamiento del aire |
| `wind` | `0` | Viento lateral |
| `spin` | `1` | Multiplicador de giro |
| `life` | `6` | Vida en segundos |
| `max` | `24` | Máximo de emotes simultáneos |
| `shadow` | `true` | Sombra bajo el emote |
| `dedupe` | `true` | Un emote por emote distinto |
| `ox` / `oy` | `0.5` / `1` | Origen para `fountain`/`burst` |
| `obs` | `true` | Fondo sólido (debug) |
| `test` | `true` | Genera emotes de muestra para calibrar |
| `debug` | `true` | HUD con contadores y estado |

Claves de configuración (`data/chatwidget-config.json`): `emoteOverlayEnabled`,
`emoteOverlayMode`, `emoteOverlaySize`, `emoteOverlaySizeVariance`,
`emoteOverlayGravity`, `emoteOverlayBounce`, `emoteOverlayFriction`,
`emoteOverlayWind`, `emoteOverlaySpin`, `emoteOverlayLife`,
`emoteOverlayMaxParticles`, `emoteOverlayShadow`, `emoteOverlayDedupe`,
`emoteOverlayOriginX`, `emoteOverlayOriginY`, `emoteOverlaySpread`,
`emoteOverlayLaunchPower`.

En el dashboard (pestaña Chat Widget) hay una tarjeta **Overlay de Emotes** con
los controles y una URL + botón **Copiar** exclusiva para emotes, más una preview
dedicada con botón **Probar**.

## Guardado de configuración (JSON en servidor)

La config se persiste en `data/chatwidget-config.json` via `modules/chatwidget-config.js`.

Endpoints:

| Ruta | Método | Descripción |
|---|---|---|
| `/api/chatwidget/config` | GET | Devuelve `{ config, themes, defaults }` |
| `/api/chatwidget/config` | POST | Guarda un parcial de config (merge) |

El widget carga la config al arrancar. El dashboard la aplica **en vivo** a la preview
y OBS enviando un `postMessage`:

```js
previewWin.postMessage({ type:'chatwidget-config', config: {...} }, location.origin)
```

El widget actualiza su CSS/JS al instante sin recargar (mensaje `message` en `window`).

## Mapeo de config → render

El widget implementa las mismas opciones y animaciones que la versión web del
overlay. Resumen de cada área:

| Área | Implementación en el widget |
|---|---|
| Layout | `.msg` flex-row / flex-row-reverse (alternating/left/right), dirección up/down |
| Glow avatar | `.avatar-ring` box-shadow + animaciones pulse/rainbow |
| Formas avatar | circle/squircle/hexagon/rounded/square |
| Entrada | clases `.anim-*` (spring_pop, slide_in, neon_flash, float_up, elastic_zoom, bounce_in, flip_3d) |
| Badges | imágenes reales `/images/badges/` + fallback estilo icono |
| Emotes | parse `[emote:id:name]` + 7TV + zero-width + posiciones del webhook |
| Física | Movida al overlay independiente `/emotes` (motor `public/chatwidget/physics.js`) |
| Alertas | 4 estilos, shimmer, progress bar, live dot con ping |
| Audio | Web Audio API (bubble/pop/chime/arcade/click + fanfare/arpeggio/horn/coin) |
| 7TV | `/api/7tv/:userId` |

## Temas (presets)

`cyberpunk_glow`, `midnight_purple`, `obsidian_dark`, `frosted_glass`, `rainbow_streamer`,
`clean_minimal`, `mrsnakevt_green` (verde Kick, el predeterminado).

## Flujo de datos

```
Kick webhook → webhook.js → SSE /api/events → chatwidget (EventSource)
```

- `chat.message.sent` → mensaje (avatar/color/badges/emotes del payload del webhook)
- `channel.subscription.new/renewal/gifts`, `channel.followed`, `kicks.gifted`, raids → alertas

### Anti-spam de KICKS

Los `kicks.gifted` del mismo usuario se agrupan (~1.2s) en **una** alerta con el total, y el
sonido se limita a **1 por usuario cada 10s** para no disparar un tono por cada bit.

## Filtrado de bots

Los mensajes de usuarios configurados como bot (Botrix, KickBot, Nightbot, etc.) se
excluyen del render. Opcionalmente también se filtran mensajes que empiezan con
prefijos de comando (`!`, `/`).

## Archivos clave

| Archivo | Propósito |
|---|---|
| `public/chatwidget/index.html` | Widget de chat completo (HTML + CSS + JS en un solo archivo IIFE) |
| `public/chatwidget/emotes.html` | Overlay de emotes a pantalla completa (`/emotes`) |
| `public/chatwidget/physics.js` | Motor de física compartido (`EmotePhysics`) |
| `modules/chatwidget-config.js` | Persistencia de config + endpoints Express |
| `data/chatwidget-config.json` | Config persistida (blob JSON) |
| `public/index.html` (pestaña Chat Widget) | Dashboard: formulario, URLs (chat y emotes), previews en iframe, hot-reload vía postMessage |
