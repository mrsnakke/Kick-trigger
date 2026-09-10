# Fighting Chat — overlay de peleas 1v1

## Objetivo

Un **overlay de pelea 1v1 estilo arcade para OBS** donde los espectadores del stream
**participan de verdad**: cada uno tiene su propio personaje con **nivel, EXP, puntos de
atributo y estadísticas permanentes**, pueden **retarse entre ellos por el chat** y los
combates se ven en directo en el escenario.

La progresión es permanente (se guarda en disco), pero limitada por sesión para que nadie
pueda acumular niveles infinitos — y todo corre en local, sin servicios externos.

## Integración con kick-backend

```
Kick chat (!retar, !aceptar, !stats, !invertir)
   │  webhook → Event Bus
   ▼
modules/triggers/fighting/   ★ este módulo (trigger + bot glue)
   │  fetch → contrato /api/kick/*        │  spawn (proceso hijo)
   ▼                                     ▼
fighting-Chat server (puerto 3001, app independiente en modules/triggers/fighting-Chat/)
   │  data/config.json  (persistencia)
   ▼
Overlay OBS (http://<IP>:3001/)  ➜  escena en otra PC de la red
```

- **fighting-Chat** es una app standalone (Express + Vite/React, ESM) dentro de
  `modules/triggers/fighting-Chat/`. Este módulo **no la toca**: la levanta como proceso
  hijo y le habla por HTTP.
- El **trigger** (`modules/triggers/fighting/index.js`) es quien lee el chat y responde,
  llamando el contrato `/api/kick/*` del fight server (su doc original dice "tu bot de otra
  app" — aquí el bot es este backend).
- **La pelea la controla una IA** en el navegador del escenario (sin mando, sin jugadores
  reales). Debajo de la barra de HP hay una **barra de skill**: al llenarse, el personaje
  **se cura 10% de su vida máxima** y queda **invencible mientras dura la animación** (la
  habilidad se usa una vez por carga de barra).
- **El server es la fuente de verdad**: `data/config.json` guarda todo lo permanente.

## URLs

| URL | Qué es |
|---|---|
| `http://localhost:3000/` | Dashboard de Kick Backend (pestaña **🥊 Peleas**) |
| `http://<IP>:3001/` | **Escenario OBS** — pantalla limpia, solo la pelea (Browser Source en la otra PC) |
| `http://localhost:3001/players` | **Panel de jugadores** — liga, fichas, encantar atributos, elegir P1/P2, iniciar combate |
| `http://localhost:3001/calibrate` | **Calibración** — sprites, animaciones, fondos, layout, exportar/importar |

Desde la pestaña **Peleas** del dashboard hay botón para **copiar la URL del overlay**
(lista para la otra PC de la misma red).

## Arranque

El fight server se **auto-levanta** como proceso hijo en el puerto **3001** cuando arranca
kick-backend (es el **último** módulo en iniciar). No abre ventanas extra.

- Si ya hay un fight server respondiendo (p. ej. lo corrés a mano), no lo duplica.
- Si muere, se reintenta hasta 3 veces (5 s entre intentos).
- **No se hace build**: el fight server se corre directo con `node server.js`
  (`spawn('node', ['server.js'])` desde `modules/triggers/fighting/index.js`) y sirve el
  `dist/` que ya viene en la carpeta. El `dist/` es **lo que se sirve de verdad**: los
  cambios de frontend se dejan reflejados ahí (los bundles hasheados de `dist/assets/`),
  tanto si se editan a mano como si algún día se regeneran con `npm run build` (opcional,
  nunca requisito). `npm install` solo la primera vez.
- Modo manual (opcional): `node server.js` con `PORT=3001` (el `iniciar.bat` original abre
  las 3 páginas en el navegador y usa :3000 — ya no se usa).

Config: variable de entorno `FIGHTING_URL` (default `http://localhost:3001`). Si apuntás a
una URL remota, el spawn se omite (asume que ya corre allá).

Atajos en el escenario: `Espacio` = pausa, `R` = reiniciar pelea.

## Juego y progresión

### Stats por jugador
`vida (hp)`, `ataque`, `defensa`, `evasión`, `puntería` y `crítico`. Cada
**subida de nivel** da **1 punto de atributo**.

### Encantamiento (`!invertir <stat>` o botón en `/players`)
Se consume **1 punto** y **siempre mejora** el atributo en una cantidad pequeña fija
(`vida +2`, `ataque +0.5%`, `defensa +0.3%`, `evasión +0.2%`, `puntería +0.1%`,
`crítico +0.4%`, con tope por stat). **No hay dado ni fallo** (quitaron el RNG): cada punto
invertido es progreso garantizado.
- Los **enchants individuales** (por stat, `allocated`) avisan con `insufficient points` si no
  quedan puntos; el resultado siempre llega `success: true`.
- El resultado se **anima en el escenario OBS** (broadcast por polling cada 2s).

### EXP
- Ganar el **match** (3 victorias): **+60 EXP** (`WIN_EXP`). Perder: **+35 EXP** (`LOSE_EXP`).
- **Ganar o perder suma al tope de sesión**; solo el premio cambia.
- La **curva de nivel** es polinómica suave — `expForLevel(n) = 50·n^1.2` en `kick.mjs` (única
  fuente de verdad, el frontend solo la muestra). Crece despacio al principio y se alarga
  gradualmente al final sin dispararse al infinito (el server la recalcula siempre contra la
  fórmula, así un jugador con EXP de la curva vieja se re-nivela solo en su primer combate):

  | Nivel | EXP requerida | ≈ días llenando el cap diario |
  |---|---|---|
  | 1-4 | 50 → 263 | 1 día por nivel |
  | 10 | 792 | 3 días |
  | 20 | 1.820 | 1 semana |
  | 30 | 2.961 | 10 días |
  | 50 | 5.466 | 3 semanas |
  | 75 | 8.892 | 1 mes |
  | 90+ | ~11.000+ | 5-6 semanas |

  De nivel 1 a 99 se necesitan **~552.000 EXP totales ≈ 5 años** llenando el tope todos los
  días: progreso visible todas las sesiones, sin muro ni techo imposible.
- El **W/L se cuenta por match, no por ronda**: al terminar (`/api/end`) el server **recalcula**
  `wins/losses = recordStart + resultado del duelo` (el campeón suma +1 win, el otro +1 loss),
  descartando las rondas internas que la arena mostró en vivo.
- Al terminar cada combate por chat, el bot **anuncia el resultado** (ganador, EXP de cada
  jugador, progreso al siguiente nivel y EXP restante de la sesión).
- **El server escribe la EXP**: en `/api/end` (`applyMatchResult` en `kick.mjs`) suma el premio
  y fija W/L de ambos jugadores directamente sobre su ficha (`players[kick_<id>]`), sin
  importar qué slot ocuparon. El aviso del chat (`buildMatchResult`) y el cálculo del server
  usan **la misma matemática**. El frontend ya **no** persiste stats (se eliminó
  `addExpToFighter`/`saveFighterStats`); solo muestra.

### ⚠️ Tope de EXP por sesión
Hay un **tope total de 300 EXP por jugador y por arranque del server** (`SESSION_EXP_CAP` en
`fighting-Chat/server/kick.mjs`). Ganar y perder **suman contra el tope** (60/35 respectivamente).

- Al llegar al tope el jugador **sigue pudiendo pelear**, pero el combate da **0 EXP** (ya no
  "gasta" llaves por combate).
- El contador vive **en memoria** (`sessionExp`): reinicia a 0 para todos cada vez que se
  reinicia el server.
- La elegibilidad se fija **al iniciar cada combate**, no al terminarlo; se reporta como
  `battlesLeft`/`expLeft` (EXP restante hoy).

> Así nadie consigue niveles infinitos en una sesión, pero todos pueden seguir jugando.

### 🎟️ Llaves del gachapón por pelear
- Cada **combate por chat** entrega **1 llave** para el módulo GACHA (`!pull`/`!multi`).
- Al terminar la pelea se tira un **dado** (`Math.random`) entre los **2 jugadores** para
  ver quién se lleva la llave; el bot la **anuncia en el chat** junto al resultado.
- **Tope: 5 llaves por jugador y por reinicio del backend**. El contador (`fightKeys` en
  `fighting/index.js`) vive **en memoria** → cada vez que prendés el backend vuelve a 0 y
  las "diarias" quedan listas.
- Si un jugador ya llegó al tope, el dado reparte solo entre los que aún pueden recibir.
- `!pelea` resume el estado de ambos contadores (EXP restante hoy + llaves del día).

## Retos por chat (cola de duelo)

Flujo soportado por `fighting-Chat/server/kick.mjs` (en memoria, se resetea al reiniciar):

1. **`!retar @jugador`** → crea un reto pendiente (`awaiting_accept`) con **TTL de 1 min**: si el retado no responde, el reto se cancela solo.
2. **`!aceptar` o `!si`** → si la arena está libre, el duelo **arranca solo** con esos jugadores.
3. Si hay un combate en curso → el reto aceptado **entra en cola** y arranca al terminar el actual.
4. **`!no`** → rechaza el reto.

Reglas anti-abuso: un jugador solo puede tener **1 reto activo** (como retador o retado) y
**no se puede retar a uno mismo**. Los retos expirados se limpian solos.

### 🤖 Gris contra el admin (GrimVTbot)

**GrimVTbot** (`kick_65967692`) es el personaje del bot y es **admin**: un **tanque raid
boss** — nivel **999**, **998k de vida**, **80% de absorción** y mucha evasión, pero **no pega
fuerte** (ataque ≈ nivel 30). No lo podés tumbar: gana por desgaste.

- Si alguien hace **`!retar @GrimVTbot`** → el trigger **auto-acepta el reto** por él y
  anuncia que el admin baja a la arena (o que quedó en cola si hay combate en curso).
- Unos segundos después, la **IA del vtuber** (`modules/triggers/vtuber-ai`) se **burla del
  retador** — **solo** para este caso, manteniendo su prompt base y personalidad. Si la IA no
  está disponible, responde una plantilla fija ("Nivel 999, admin, invicto…").
- El server crea/actualiza la ficha de Grim al arrancar (`ensureGrim` con `ADMIN_VERSION`) y
  la **mantiene** en nivel admin contra cualquier re-escritura del config (upsert o
  `POST /api/config`). Si la build de admin cambia en una versión nueva, se re-aplica sola.
- Al pelear se comporta como cualquier jugador (gana y sube W/L), pero jamás baja de nivel ni
  pierde vida base. En la arena su HUD muestra **`NV.999`**.

## Comandos de chat

| Comando | Qué hace |
|---|---|
| `!retar @jugador` | Crea un reto (TTL 1 min; si el retado no responde, se cancela). La persona retada debe haber escrito antes en el chat. Retar a **@GrimVTbot** auto-acepta el duelo y la IA se burla de vos |
| `!aceptar` / `!si` | Acepta el reto pendiente. El duelo arranca solo si la arena está libre; si no, entra en cola |
| `!no` | Rechaza el reto |
| `!stats` | Ficha: nivel, EXP, puntos de atributo, W/L, EXP de sesión restante y en qué atributos ya invertiste |
| `!invertir <stat>` | Encanta un atributo (`vida`, `ataque`, `defensa`, `evasion`, `punteria`, `critico`). Sin argumento lista los stats disponibles. Consume 1 punto; la mejora es **garantizada** (sin suerte) |
| `!pelea` | Estado resumido: EXP de la sesión restante (`⚡ x/300`) y llaves diarias del gachapón disponibles (`🎟️ x/5`) |

## API del fight server (`:3001`)

### Configuración y combate
| Endpoint | Método | Qué hace |
| -------- | ------ | -------- |
| `/api/config` | GET | Config completa + `session.exp` (EXP acumulada por jugador esta sesión, cap 300) |
| `/api/config` | POST | Guardar parcial (personajes, match) |
| `/api/sprites/:id` | GET/POST | Subir/leer spritesheet PNG |
| `/api/allocate` | POST | `{ player, stat }` — encantamiento garantizado (playerId o `p1`/`p2`) |
| `/api/set-match` | POST | `{ p1, p2 }` — elegir quiénes pelean (ids de jugador) |
| `/api/start` | POST | Inicia combate (fija la elegibilidad de EXP) |
| `/api/end` | POST | Termina combate, cuenta combates de sesión y lanza el siguiente de la cola |

### Contrato `/api/kick/*` (lo consume `modules/triggers/fighting/index.js`)
| Endpoint | Método | Cuerpo / qué hace |
| -------- | ------ | ----------------- |
| `/api/kick/help` | GET | Instrucciones cortitas para responder en el chat |
| `/api/kick/players/upsert` | POST | `{ kick_id, username }` — crea/actualiza jugador (id = `kick_<user_id>`) |
| `/api/kick/players` | GET | Lista de jugadores + EXP de sesión restante (`battlesLeft`) |
| `/api/kick/challenges` | POST | `{ from_kick_id, from_username, to_kick_id, to_username }` — comando `!retar` |
| `/api/kick/challenges/:id/accept` | POST | `{ player_kick_id }` — comando `!aceptar` / `!si` |
| `/api/kick/challenges/:id/decline` | POST | `{ player_kick_id }` — comando `!no` |
| `/api/kick/challenges` | GET | Estado actual de la cola |

## Endpoints del módulo (montado en `/fighting`)

Proxies hacia el fight server (evitan CORS desde el dashboard):

| Ruta | Método | Descripción |
|---|---|---|
| `/api/status` | GET | `{ ok, running, url, lanUrl, lanPlayersUrl, lanCalibrateUrl }` |
| `/api/players` | GET | Liga: `username, level, exp, attributePoints, wins, losses, battlesLeft` |

## Modelo de datos

El server persiste en **dos archivos** (fuera del scope de los sprites):

- `data/config.json` — **configuración visual**: `p1`/`p2` (CharacterConfig: sprites, animaciones,
  layout), `match` y `updatedAt`. **No** contiene `players`.
- `data/players.json` — **inventario**: el mapa `players` (una ficha por persona con `kick_id`,
  `username` y `stats`: nivel, EXP, W/L, puntos de atributo, enchants).

El API los fusiona: `/api/config` y los endpoints siguen devolviendo/aceptando `players` dentro
de la misma shape, para que el frontend no cambie. La diferencia es **de persistencia**:

```jsonc
// config.json
{
  "version": 2,
  "p1": { /* CharacterConfig del slot P1 (sprites/animaciones) */ },
  "p2": { /* CharacterConfig del slot P2 */ },
  "match": {
    "p1": "local-p1",          // qué JUGADOR ocupa el slot P1
    "p2": "local-p2",
    "active": false,
    "expEligible": null,       // fotografía al iniciar
    "recordStart": null,       // W/L al iniciar (para el anuncio final)
    "lastResult": null,        // resultado estructurado del último combate
    "enchant": null,           // último intento de encantamiento (broadcast a OBS)
    "background": "transparent", "layout": "full-arena", "maxWins": 3
  },
  "updatedAt": "…"
}
```
```jsonc
// players.json
{
  "local-p1": { "kick_id": null, "username": "Player 1", "stats": { /* nivel, exp, allocated… */ } },
  "local-p2": { "kick_id": null, "username": "Player 2", "stats": { /*…*/ } },
  "kick_65967692": { "kick_id": 65967692, "username": "GrimVTbot", "stats": { /* nivel 999… */ } }
}
```

- Los **sprites y animaciones** viven en `config.json` (`p1`/`p2`; los editas en `/calibrate`).
- **Sprites aleatorios por combate**: al iniciar duelo (`/api/start` y al lanzar el siguiente)
  `randomizeSprites` asigna 50/50 `/api/sprites/p1` o `/api/sprites/p2` a cada slot — mismo
  layout/dimensiones (sheets de 763x1652 en `data/sprites/`), el luchador puede salir en cualquiera
  de los dos lados. No-op si falta algún png.
- Los **stats e identidad** viven en `players.json`, por `playerId` (`kick_<user_id>` = a prueba
  de renombres; `local-*` = modo sin bot).
- **Un jugador = una ficha**: al leer se limpian duplicados (`sanitizePlayers`) — la clave
  canónica es `kick_<id>`, se descartan otras claves con el mismo `kick_id` y los placeholders
  (`kick_id: null`) cuyo nombre coincide con un jugador real.
- **GrimVTbot** se auto-crea/actualiza en nivel admin con `ensureGrim` (id configurable vía
  `FIGHT_GRIM_ID`/`FIGHT_GRIM_NAME`).
- Migración automática: un `config.json` viejo (v1 con `stats.p1/p2` o v2 con `players`
  embebidos) se convierte al nuevo esquema al arrancar sin perder nada.

## Estructura del proyecto (app)

```
fighting-Chat/
  server/
    api.mjs      # API principal: config, allocate, start/end, set-match, players.json
    kick.mjs     # Cola de retos, tope de EXP por sesión, admin Grim y contrato /api/kick/*
  src/
    App.tsx                   # Escenario OBS (polling 2s, overlay de encantamiento)
    components/FightArena.tsx # Motor de pelea en canvas + HUD (nombre con NV.<nivel>, EXP)
    playersMain.tsx           # Liga de jugadores + encantar + selector P1/P2
    calibrateMain.tsx         # Editor de personaje/escenario
    utils/{storage,api}.ts    # Cliente de la API y caché
  dist/                       # ⚠️ LO QUE SE SIRVE: no se build, se corre node server.js
  data/
    config.json               # Visual: personajes (sprites), match, layout
    players.json              # Inventario: stats, W/L, puntos por jugador
    sprites/                  # Spritesheets subidos
```

## Persistencia

| Archivo | Contenido | Lo escribe |
|---|---|---|
| `fighting-Chat/data/config.json` | Visual: sprites, match, layout | el fight server |
| `fighting-Chat/data/players.json` | Inventario: stats, W/L, puntos | el fight server (EXP en `/api/end`) |
| `fighting-Chat/data/sprites/*.png` | Spritesheets subidos desde `/calibrate` | el fight server |

El inventario (`players.json`) solo lo toca el **server**: el browser jamás lo reescribe
(`POST /api/config` ignora `players` y siempre toma el de disco). El estado efímero (retos,
tope de EXP por sesión) vive **en memoria** y se resetea al reiniciar el fight server.
El trigger también resetea su mapa de "jugadores ya vistos".

## Requisitos y notas

- Node.js v18+.
- OBS en otra PC: Browser Source con `http://<IP-del-PC>:3001/`.
- Los jugadores se crean solos al escribir por primera vez (el trigger hace upsert vía
  `sender.user_id` del webhook), arrancan en **nivel 0** con EXP 0/50.

Col 0       Col 1       Col 2       Col 3       Col 4       Col 5
        +-----------+-----------+-----------+-----------+-----------+-----------+
Fila 0  |  Idle_1   |  Idle_2   |  Idle_3   |  (vacío)  |  (vacío)  |  (vacío)  |
        +-----------+-----------+-----------+-----------+-----------+-----------+
Fila 1  |  Walk_1   |  Walk_2   |  Walk_3   |  Walk_4   |  Walk_5   |  Walk_6   |
        +-----------+-----------+-----------+-----------+-----------+-----------+
Fila 2  |  Jump_1   |  Jump_2   |  Crouch_1 |  Guard_1  |  Guard_2  |  (vacío)  |
        +-----------+-----------+-----------+-----------+-----------+-----------+
Fila 3  |  AtkRap_1 |  AtkRap_2 |  AtkRap_3 |  (vacío)  |  (vacío)  |  (vacío)  |
        +-----------+-----------+-----------+-----------+-----------+-----------+
Fila 4  |  AtkFte_1 |  AtkFte_2 |  AtkFte_3 |  AtkFte_4 |  (vacío)  |  (vacío)  |
        +-----------+-----------+-----------+-----------+-----------+-----------+
Fila 5  |  AtkBjo_1 |  AtkBjo_2 |  AtkBjo_3 |  AtkBjo_4 |  (vacío)  |  (vacío)  |
        +-----------+-----------+-----------+-----------+-----------+-----------+
Fila 6  |   Hit_1   |   Hit_2   |   Hit_3   |  (vacío)  |  (vacío)  |  (vacío)  |
        +-----------+-----------+-----------+-----------+-----------+-----------+
Fila 7  |  Fall_1   |  Fall_2   |  Fall_3   |  Fall_4   |  (vacío)  |  (vacío)  |
        +-----------+-----------+-----------+-----------+-----------+-----------+
Fila 8  |  GetUp_1  |  GetUp_2  |  GetUp_3  |  (vacío)  |  (vacío)  |  (vacío)  |
        +-----------+-----------+-----------+-----------+-----------+-----------+
Fila 9  |  Skill_1  |  Skill_2  |  Skill_3  |  Skill_4  |  Skill_5  |  Skill_6  |
        +-----------+-----------+-----------+-----------+-----------+-----------+
Fila 10 | Finish_1  | Finish_2  | Finish_3  | Finish_4  | Finish_5  | Finish_6  |
        +-----------+-----------+-----------+-----------+-----------+-----------+
Fila 11 |  Vict_1   |  Vict_2   |  Vict_3   |  Vict_4   |  (vacío)  |  (vacío)  |
        +-----------+-----------+-----------+-----------+-----------+-----------+
Fila 12 |  Fail_1   |  Fail_2   |  Fail_3   |  Fail_4   |  (vacío)  |  (vacío)  |
        +-----------+-----------+-----------+-----------+-----------+-----------+