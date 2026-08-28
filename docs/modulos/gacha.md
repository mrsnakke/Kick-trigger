# Módulo GACHA — Sistema de gacha

Sistema de gacha semi-independiente (con su propio `package.json`) que se monta en el
backend principal bajo `/gacha`. Incluye pulls con pity, banners, inventarios, trades,
dailies y overlays para OBS.

## Estructura

```
GACHA/
├── index.js              # Entry point: conecta con el backend (bus + router + WS)
├── package.json          # Dependencias propias (express, ws, multer, cors, dotenv)
│
├── lib/
│   ├── config.js         # Config (puerto, GitHub, rutas)
│   ├── ws-push.js        # WebSocket push a overlays OBS
│   └── imageUploader.js  # Subida de imágenes a GitHub
│
├── modules/
│   ├── data/store.js     # Store central (inventarios, personajes, banners)
│   ├── gacha/engine.js   # Motor de gacha (pulls, pity, probabilidades)
│   ├── gacha/inventory.js# Gestión de inventarios
│   ├── trades/manager.js # Sistema de intercambios
│   └── events/commands.js# Handlers de comandos del chat
│
├── routes/
│   ├── overlay.js        # Endpoints para overlays (view.html)
│   └── admin.js          # Endpoints de administración
│
├── web/                  # Estáticos para overlays OBS
│   ├── index.html        # Animación multi-pull
│   ├── view.html         # Vista de personaje individual
│   └── js/               # JS de overlays
│
└── GachaWish/            # Base de datos de personajes (JSON/img)
```

## Características

- Pulls con **pity** (4★ y 5★) y probabilidades configurables.
- Banners **standard** y **seasonal**.
- Inventario por usuario (persistencia JSON).
- Llaves diarias (`!daily`).
- **Trades** de 5★ entre usuarios.
- Overlays OBS vía WebSocket (`/ws/gacha`).
- Subida de imágenes a GitHub (GachaWish).
- Estadísticas globales.

## Comandos de chat (vía `chat.message.sent`)

| Comando | Descripción | Permiso |
|---|---|---|
| `!daily` | 10 llaves diarias | User |
| `!pull` / `!single` / `!tirada` | 1 pull = 1 llave | User |
| `!multi` / `!x10` | 10 pulls = 10 llaves | User |
| `!inventario` / `!inventory` / `!inv` | Inventario en chat | User |
| `!Sinv` | Inventario en overlay (view.html) | User |
| `!pj <personaje>` | Carta del personaje en overlay | User |
| `!lista` | Personajes disponibles del banner | User |
| `!top` | Top 3 coleccionistas | User |
| `!trade <tu_pj> por <su_pj> @usuario` | Crear intercambio 5★ | User |
| `!aceptar_trade` / `!accept_trade <ID>` | Aceptar trade | User |
| `!rechazar_trade` / `!reject_trade <ID>` | Rechazar/cancelar trade | User |
| `!keys @usuario <n>` | Dar llaves | Mod |
| `!givechar @usuario <pj>` | Dar personaje | Mod |
| `!takechar @usuario <pj>` | Quitar personaje | Mod |
| `!resetpity [@u] [4\|5]` | Resetear pity | Mod |
| `!setprob <rareza> <valor>` | Cambiar probabilidad | Mod |
| `!setstock <pj> <n>` | Cambiar stock | Mod |
| `!banner <standard\|seasonal>` | Ver banner | Mod |
| `!seasonal add/remove <pj>` | Gestionar seasonal | Mod |
| `!reload` | Recargar datos | Mod |
| `!cleardata confirm` | Borrar todos los datos | Mod |
| `!gachaconfig` | Ver config | Mod |
| `!charinfo <pj>` | Info personaje | Mod |
| `!announce <msg>` | Anunciar en chat | Mod |

## Endpoints HTTP (montados en `/gacha`)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/stats` | GET | Estadísticas globales |
| `/api/commands` | GET | Lista de comandos (usa el dashboard) |
| `/api/view-character?userId&userName&characterName` | GET | Carta de personaje para overlay |
| `/api/trades/:userName` | GET | Trades de un usuario |
| `/api/trade/:id/accept` | POST | Aceptar trade |
| `/api/trade/:id/cancel` | POST | Cancelar trade |
| `/api/show-character?characterName` | GET | Mostrar personaje |
| `/admin/characters` | GET | Lista de personajes |
| `/admin/character-details/:name` | GET | Detalle de personaje |
| `/admin/character` | POST | Crear personaje (multipart imagen) |
| `/admin/character/:oldName` | PUT | Actualizar personaje |
| `/admin/character/:name` | DELETE | Eliminar personaje |
| `/admin/gacha-config` | GET | Config de gacha |
| `/admin/pity-data` | GET/PUT | Pity |
| `/admin/gacha-config/rarity-probabilities` | PUT | Probabilidades por rareza |
| `/admin/gacha-config/banner-probabilities` | PUT | Probabilidades por banner |
| `/admin/gacha-config/character-stocks` | PUT | Stocks |
| `/admin/seasons` | GET | Seasons |
| `/admin/seasons/:id/stock` | PUT | Stock de season |
| `/admin/seasons/:id/mass-stock` | PUT | Stock masivo |
| `/admin/seasons/:id/add-character` | POST | Añadir personaje a season |
| `/admin/seasons/:id/remove-character/:name` | DELETE | Quitar personaje de season |
| `/admin/user-keys` | GET | Llaves de usuarios |
| `/admin/user-keys/add` | POST | Añadir llaves |
| `/admin/user-keys/add-all` | POST | Añadir llaves a todos |
| `/admin/endpoints` | GET | Lista de endpoints |
| `/admin/clear-all-data?confirm=true` | GET | Borrar todos los datos |
| `/admin/trades` | GET | Trades |
| `/admin/trades/:id` | DELETE | Eliminar trade |
| `/*` (estáticos) | GET | Overlays OBS (`view.html`, `index.html`, js, ...) |

## WebSocket

- **`/ws/gacha`** — comunicación en tiempo real con los overlays de OBS.

## Eventos del bus

**Escucha:** `chat.message.sent` (comandos) y handlers skeleton para
`channel.followed`, `channel.subscription.*`, `livestream.status.updated`,
`moderation.banned`, `kicks.gifted`.

> El handler de `channel.reward.redemption.updated` está **comentado/deshabilitado**
> (los pulls solo se hacen por comandos de chat).

**No emite** eventos al bus; hace broadcast por **SSE** con `_source: 'gacha'`
(tipos `gacha_wish`, `trade_created`, `trade_updated`, ...).
