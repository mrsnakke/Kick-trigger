# Módulo Strinova — Ruleta + Overlay OBS

Ruleta aleatoria de personajes de "Strinova" (3 facciones) que se muestra en un overlay
de OBS. Incluye un panel de control y tarjeta de rango.

## Archivos clave

```
strinova-app/
├── index.js        # Módulo integrado: router Express + WS + lógica
├── server.js       # Servidor standalone (puerto 3231, desarrollo) — NO usado por el main
├── package.json    # ws
├── state.json      # Estado persistente (posiciones, historial, rango)
└── public/
    ├── overlay.html    # Overlay OBS 1920×1080 (Browser Source)
    ├── control.html    # Panel de control
    ├── css/, js/, assets/   # estilos, clientes WS, imágenes
```

## Funcionamiento

- Ruleta de **dos carretes** que combina personajes de 3 facciones: **Cizalla** (rojo),
  **S.U.P** (azul) y **Urbino** (dorado).
- Si el ganador es de **Urbino**, aparece solo en ambos carretes (personaje individual).
- Si es de Cizalla o SUP, se combina con uno de la facción contraria.
- WebSocket en `/ws/strinova` para tiempo real entre overlay y panel de control.
- Persiste estado (posiciones, historial, rango) en `state.json`.

## Personajes por facción

| Facción | Personajes |
|---|---|
| **Cizalla** 🔴 | Eika, Fragrans, Kanami, Lawine, Mara, Meredith, Ming, Nora, Reiichi |
| **S.U.P** 🔵 | Chiyo, Flavia, Kokona, Leona, Michele, Nobunaga, Yugiri, Yvette |
| **Urbino** 🟡 | Audrey, Bai Mo, Celestia, Cielle, Fuchsia, Galatea, Maddelena |

## Sistema de rango

Substance (III-I) → Molecule (III-I) → Atom (IV-I) → Proton (IV-I) → Neutron (IV-I) →
Electron (V-I) → Quark (V-I) → Superstring → Singularity.

Cada rango tiene 3-5 tiers (III, II, I...). Puntuación SR: cada 100 puntos sube de tier.
Superstring y Singularity no tienen progreso por puntos.

## Comandos de chat

| Comando | Descripción | Permiso |
|---|---|---|
| `!rank` | Muestra tarjeta de rango en overlay (20s) | User |
| `!rulet` | Muestra historial de personajes en overlay (20s) | User |

## Eventos WebSocket

**Servidor → overlay** (`broadcast`): `init`, `spin`, `history_update`, `toggle_list`,
`toggle_rank`, `show_roulette`, `roulette_pos`, `rank_pos`, `rank_update`, `panel_pos`.

**Overlay → servidor** (mensajes entrantes): `spin`, `clear_history`,
`remove_from_history`, `toggle_list`, `toggle_rank`, `show_roulette`, `roulette_pos`,
`rank_pos`, `rank_update`, `panel_pos`.

## Eventos del bus

**Escucha:**
- `chat.message.sent` (`handleChatMessage`) — para `!rank` y `!rulet`.
- `strinova:spin` — ejecuta la ruleta sin pasar por comando (lo puede emitir OBS Actions
  o un endpoint/programáticamente; el módulo emite los eventos de spin directamente a WS).

**No emite** eventos al bus.

## Endpoints HTTP (montados en `/strinova`)

| Ruta | Método | Descripción |
|---|---|---|
| `/api/status` | GET | Estado `{ok:true}` |
| `/*` (estáticos) | GET | Serve `public/` (default `control.html`) |

## Exports

`{ router, initWs, init, state, doSpin }`. `doSpin()` ejecuta la ruleta programáticamente.
