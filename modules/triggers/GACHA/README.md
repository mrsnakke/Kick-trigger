# 🌸 Gacha Waifus Overlay — Kick Event-Driven Integration

Sistema de Gacha, inventarios, trades y overlays animados para **Kick**. Funciona recibiendo eventos reenviados desde el **Kick Backend** (webhook `POST /kick-events`) y emitiendo animaciones a OBS vía WebSocket.

---

## 🚀 Arquitectura

```
Kick Chat/Recompensas
        │
        ▼
┌───────────────────┐
│   Kick Backend    │  (OAuth, Webhooks, EventSub)
│  (puerto 3000)    │
└─────────┬─────────┘
          │ POST /kick-events  (event, data)
          ▼
┌───────────────────┐
│  Gacha Server     │  (puerto 8085)
│  - Event Bus      │  ← chat.message.sent, channel.reward.redemption.updated
│  - Engine/Pity    │  ← motor probabilístico con pity suave/duro
│  - Inventory      │  ← JSON persistence (GachaWish/)
│  - Trades         │  ← intercambios 5⭐ entre usuarios
│  - WS Push        │  → overlays OBS (gacha_wish, trade_created, showCharacter)
└─────────┬─────────┘
          │ WebSocket (ws://localhost:8085)
          ▼
┌───────────────────┐
│  Overlays OBS     │  index.html, view.html, trades.html
└───────────────────┘
```

---

## 💬 Comandos de Chat (Kick)

### Usuario
| Comando | Descripción |
|---------|-------------|
| `!daily` | Reclama **10 llaves (🔑)** diarias (1 vez/día). |
| `!inventario` / `!inventory` | Muestra llaves, tiradas totales, pity 5⭐ y personajes por rareza. |
| `!top` | Top 3 coleccionistas con más tiradas. |
| `!trade <tu_personaje> por <su_personaje> @usuario` | Crea intercambio (solo 5⭐). |
| `!aceptar_trade <ID>` / `!accept_trade <ID>` | Acepta trade (debe ser destinatario). |
| `!rechazar_trade <ID>` / `!reject_trade <ID>` | Cancela/rechaza trade donde participas. |

### Moderador / Streamer
| Comando | Descripción |
|---------|-------------|
| `!keys @usuario <cantidad>` | Añade llaves a un usuario. |
| `!givechar @usuario <personaje>` | Entrega personaje al inventario del usuario. |
| `!takechar @usuario <personaje>` | Quita personaje del inventario del usuario. |
| `!resetpity [@usuario] [4\|5]` | Resetea pity 4⭐ y/o 5⭐ (sin args: el tuyo). |
| `!setprob <rareza> <valor>` | Ajusta probabilidad (ej: `!setprob 5_star 0.006`). Deben sumar 1. |
| `!setstock <personaje> <stock>` | Cambia stock de un personaje 5⭐/6⭐ seasonal. |
| `!banner <standard\|seasonal>` | Lista personajes en el banner indicado. |
| `!seasonal add <personaje> <stock>` / `!seasonal remove <personaje>` | Gestiona personajes del banner estacional. |
| `!reload` | Recarga datos desde JSON (GachaWish/). |
| `!cleardata confirm` | **BORRA TODO** (inventarios, trades, historial). Requiere `confirm`. |
| `!gachaconfig` | Muestra probabilidades actuales. |
| `!charinfo <personaje>` | Info: rareza, banner, stock, descripción. |
| `!announce <mensaje>` | Envía mensaje al chat (como bot). |

---

## 🎁 Canjes de Recompensas (Channel Points)

Configura recompensas en el panel de creador de Kick. El sistema detecta el tipo por el **Título**:

| Tipo de Tirada | Título debe contener | Coste |
|----------------|---------------------|-------|
| Individual Estándar | *(cualquier otro)* | Gratis |
| Individual con Llave | `key` o `llave` | 1 🔑 |
| Múltiple (x10) | `multi` o `x10` | Gratis |
| Múltiple con Llaves | `multi`/`x10` **y** `key`/`llave` | 10 🔑 |

*Si faltan llaves, se cancela y notifica en chat.*

---

## 🛠️ Instalación

### Requisitos
- **Node.js 18+**
- **Kick Backend** corriendo en paralelo (ver `READMEinfo del backend donde lo usare.md`)

### Configurar `.env`
```env
PORT=8085
KICK_BACKEND_URL=http://localhost:3000
GITHUB_TOKEN=            # opcional: para subir imágenes de personajes al admin
```

### Iniciar
```bash
npm install
npm start        # producción
npm run dev      # desarrollo (--watch)
```

---

## 🖥️ Overlays para OBS (Browser Sources)

| Overlay | URL | Uso |
|---------|-----|-----|
| **Principal (animaciones gacha)** | `http://localhost:8085/` | Animaciones de invocación single/multi + revelado de raros |
| **Vista Personaje** | `http://localhost:8085/view.html` | Carta volteable con stats, dueños, rareza |
| **Panel Trades** | `http://localhost:8085/trades.html` | Trades activos recibidos/enviados (input nombre usuario) |
| **Admin Panel** | `http://localhost:8085/admin.html` | Gestión personajes, banners, stocks, probs, keys, limpieza |

---

## ⚙️ Estructura del Proyecto

```
GACHA/
├── server.js                 # Express + WS + rutas
├── .env                      # Configuración
├── GachaWish/                # Persistencia JSON
│   ├── pity_data.json        # Umbrales pity (soft/hard)
│   ├── user_inventory.json   # Inventarios + pity por usuario
│   ├── trades.json           # Trades activos
│   ├── trade_history.json    # Historial
│   └── gacha_data/
│       ├── banners/          # standard_banner.json, seasonal_banner.json, seasonal_characters.json
│       └── characters/       # <nombre>.json por personaje
├── lib/
│   ├── config.js             # .env + paths
│   ├── event-bus.js          # EventEmitter central
│   ├── logger.js             # Logs con timestamp
│   ├── ws-push.js            # WebSocket broadcast a overlays
│   └── imageUploader.js      # Subida imágenes a GitHub (admin)
├── modules/
│   ├── chat/sender.js        # POST /api/chat/send → Kick Backend
│   ├── data/store.js         # Carga/guarda todo en memoria + JSON
│   ├── events/commands.js    # Handlers: chat + reward redemptions
│   ├── gacha/
│   │   ├── engine.js         # Pull, pity, selección rareza/personaje
│   │   └── inventory.js      # Keys, add chars, texto inventario
│   └── trades/manager.js     # Create/accept/cancel trades (5⭐ only)
├── routes/
│   ├── webhook.js            # POST /kick-events + /health
│   ├── overlay.js            # GET /api/view-character, /api/show-character
│   └── admin.js              # CRUD chars, config, seasonal, keys, clear
└── web/                      # Static files (HTML, CSS, JS, sounds, img)
```

---

## 🔄 Integración con Kick Backend

En el `.env` del Kick Backend:
```env
FORWARD_URL_GACHA=http://localhost:8085/kick-events
```

El backend reenvía **todos** los eventos válidos firmados por Kick. Este servidor filtra y reacciona a:
- `chat.message.sent` → comandos `!daily`, `!inventario`, `!top`, `!trade`...
- `channel.reward.redemption.updated` → tiradas gacha según título recompensa

---

## 📦 Datos Persistidos (JSON)

- `pity_data.json` — umbrales: `soft_pity`, `hard_pity` para 4⭐ y 5⭐
- `user_inventory.json` — por `userId`: `userName`, arrays por rareza, `total_pulls`, `keys`, `pity`
- `trades.json` / `trade_history.json` — intercambios
- `gacha_config.json` — `gacha_rules.rarity_probabilities`, `character_stocks`
- `gacha_data/banners/` — listas de personajes por rareza/banner
- `gacha_data/characters/` — un `.json` por personaje con `image_url`, `description`, `rarity`, `stock`

---

## 🧪 Health Check

```
GET http://localhost:8085/health
→ { "status": "ok", "uptime": 123.45 }
```

---

## ⚠️ Notas

- **Pity en memoria**: `dailyClaims` (Set) se resetea al reiniciar. Acceptable.
- **Stock 5⭐/6⭐ seasonal**: se decrementa al conseguir personaje nuevo; se persiste en `gacha_config.json` y `seasonal_characters.json`.
- **WebSocket**: reconexión automática en el frontend (`websocket.js`).
- **Admin**: requiere `GITHUB_TOKEN` en `.env` para subir imágenes nuevas.
- **Cola de redenciones**: tiradas se serializan globalmente para evitar race conditions.
- **Validación al inicio**: falla si `pity_data.json` inválido o probs no suman 1.

---

## 📄 Licencia

AGPL-3.0 — `mrsnakevt`