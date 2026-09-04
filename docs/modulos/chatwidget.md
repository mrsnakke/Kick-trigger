# ChatWidget (Overlay para OBS)

Overlay de chat en vivo para OBS, integrado con el SSE del backend (no usa Pusher).
Se sirve de forma standalone en `/chatwidget` y se controla desde la pestaña
**Chat Widget** del dashboard (`public/index.html`).

## URL para OBS

- Preview/desarrollo: `http://localhost:3000/chatwidget`
- OBS Browser Source (fondo sólido): `http://localhost:3000/chatwidget?obs=true`

Parámetros soportados:

| Parámetro | Valor | Efecto |
|---|---|---|
| `obs` | `true` | Fondo sólido `#0d1117` en vez de transparente |

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
| Física | `<canvas>` con bounce/rain/fireworks (gravedad, restitución, fricción) |
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

## Filtrado de bots

Los mensajes de usuarios configurados como bot (Botrix, KickBot, Nightbot, etc.) se
excluyen del render. Opcionalmente también se filtran mensajes que empiezan con
prefijos de comando (`!`, `/`).

## Archivos clave

| Archivo | Propósito |
|---|---|
| `public/chatwidget/index.html` | Widget completo (HTML + CSS + JS en un solo archivo IIFE) |
| `modules/chatwidget-config.js` | Persistencia de config + endpoints Express |
| `data/chatwidget-config.json` | Config persistida (blob JSON) |
| `public/index.html` (pestaña Chat Widget) | Dashboard: formulario, preview en iframe, hot-reload vía postMessage |
