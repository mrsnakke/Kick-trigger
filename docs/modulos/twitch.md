# Twitch — puente de eventos de Twitch vía Streamer.bot

## Objetivo

Que los eventos de un canal de **Twitch entren al [Event Bus](../arquitectura.md#event-bus)**
con el **mismo formato que los de Kick**, para que los triggers que ya existen (TTS2,
VTuber AI, Event Actions, GACHA, chatbot, peleas…) reaccionen a un mensaje o una sub de
Twitch sin tocar una sola línea de esos módulos.

Es el gemelo de [youtube.md](youtube.md): los dos comparten el **core**
`lib/streamerbot.js` (`createBridge`) y solo se diferencian en la config y en el
normalizador.

## Integración con kick-backend

```
Streamer.bot 1.0  (WebSocket Server, localhost:8080)
   │  eventos source: "Twitch"
   ▼
modules/triggers/twitch/index.js   ★ config fina (mapea eventos -> Kick)
   │  eventBus.emit(<nombre de evento de Kick>, { payload, ts, _source: 'twitch' })
   ▼
Event Bus  ──►  los triggers que ya escuchan chat.message.sent, channel.followed, …
```

- **No hay endpoint HTTP.** El módulo se conecta *como cliente* al WebSocket Server de
  Streamer.bot (`ws://127.0.0.1:8080`). El server empuja los eventos; este proceso abre la
  conexión. Solo aporta `init()` al `server.js`.
- **No toca el core.** Entra por el bus, no por dentro de `modules/webhook.js`.
- El campo `_source: 'twitch'` es lo único que distingue el origen de un evento de Twitch.

## Configuración

Variables de entorno (compartidas con YouTube, más una propia):

| Variable | Default | Para qué |
|---|---|---|
| `STREAMERBOT_WS_HOST` | `127.0.0.1` | Host del WebSocket Server de Streamer.bot |
| `STREAMERBOT_WS_PORT` | `8080` | Puerto del WebSocket Server |
| `STREAMERBOT_WS_PASSWORD` | *(vacío)* | Si está seteada, se autentica tras el `Hello` |
| `STREAMERBOT_TWITCH_BOT_ID` | *(vacío)* | Id de la cuenta bot de Twitch (anti-loop) |

### En Streamer.bot

Los mismos pasos que en [youtube.md](youtube.md#en-streamerbot), con dos cambios:

1. **Platforms → Twitch → Accounts**: la **Broadcaster Account** es lo imprescindible (sin
   ella no hay eventos). El **Bot Account** es opcional y solo sirve para enviar mensajes.
2. La **Bot Account** de Twitch necesita los scopes de chat para poder mandar mensajes.

El resto (WebSocket Server, address/puerto/password) es idéntico y **compartido** con YouTube.

## Suscripción: a *todos* los eventos

Streamer.bot no manda nada hasta que el cliente manda un `Subscribe`. A diferencia de
YouTube (que pide una lista fija), Twitch se suscribe a **todos** los tipos que tu build
exponga:

```
[Conectado] → (Authenticate si hay password) → GetEvents → Subscribe{ twitch: [<todos>] }
```

Se pide `GetEvents` primero porque la lista depende de la versión: suscribirse a un evento
que tu build no tiene hace fallar el `Subscribe` completo. El log dice
`Suscrito a N eventos de twitch`.

## Mapeo de eventos

Los eventos de Twitch con equivalente en Kick se re-emiten bajo el **nombre y shape de Kick**:

| Evento de Streamer.bot | Evento en el bus | Lo que ve el trigger |
|---|---|---|
| `Twitch.ChatMessage` | `chat.message.sent` | Texto del chat, emotes eliminados, badges |
| `Twitch.Sub` | `channel.subscription.new` | `subscriber`, `duration` |
| `Twitch.ReSub` | `channel.subscription.renewal` | `subscriber`, `duration = cumulativeMonths` |
| `Twitch.GiftSub` | `channel.subscription.gifts` | `sender`/`gifter` + `giftees` (1) |
| `Twitch.GiftBomb` | `channel.subscription.gifts` | `sender`/`gifter` + `giftees` + `count` |
| `Twitch.Follow` | `channel.followed` | `follower` |
| `Twitch.Cheer` | `kicks.gifted` | `gift.type = BITS`, `gift.amount = bits` |
| `Twitch.RewardRedemption` | `channel.reward.redemption.updated` | `redeemer`, `reward.title`, `input` |
| `Twitch.StreamOnline` | `livestream.status.updated` | `is_live`, `title` |
| `Twitch.StreamUpdate` | `livestream.metadata.updated` | `title`, `category` |

### Todo lo demás → `twitch.<Tipo>`

Los ~139 eventos de Twitch que **no** tienen equivalente en Kick se emiten con el nombre
genérico `twitch.<Tipo>` y el **payload crudo de Streamer.bot**:

```
eventBus: 'twitch.HypeTrainStart'  →  { payload: <datos crudos>, ts, _source: 'twitch' }
```

Así "todos los eventos" quedan disponibles sin escribir 139 handlers. Ojo: **ningún trigger
de Kick escucha `twitch.*`**; si querés reaccionar a uno, escuchá ese nombre en un módulo
propio.

### Traducción de los campos

- **Usuario** → `sender`/`follower`/`subscriber` de Kick: `user_id` y `id` = id numérico de
  Twitch (string), `username` = `name` o `login`, `channel_slug` = `login`, `color` =
  `user.color`. Los **badges** (`streamer` / `moderator` / `vip` / `subscriber` / `founder`)
  se derivan de `user.badges[].name`.
- **Canal** → `broadcaster` de Kick desde `broadcaster` (sí trae nombre y slug, a diferencia
  de YouTube).
- **`isTest: true`** → el evento se descarta, no llega al bus.
- **Emotes**: Twitch no marca los emotes en el texto (llegan como palabras sueltas, p. ej.
  `Kappa`). El módulo **borra solo los emotes nativos** (por `StartIndex/EndIndex`, cayendo a
  borrar el token completo si el rango no matchea) para que TTS2 no los lea en voz alta. Los
  emotes de **terceros** (7TV/BTTV/FFZ, que llegan con `source`/`Type` tipo `7TVChannel`) **no
  se tocan**: Kick tampoco los etiqueta, así que una palabra real que además es emote (`si`,
  `no`) se conserva y TTS la lee, con el mismo comportamiento que en Kick. Nunca reemplaza por
  subcadena. El helper vive en `lib/streamerbot.js`.
- **Dedup**: por `messageId` cuando existe; `Follow`/`Raid`/`StreamOnline` no lo traen, así que
  usan un id compuesto (`follow:<id>:<followedAt>`). Dedup de 10 minutos, igual que el core.

## Qué SÍ y qué NO funciona desde Twitch

- **Los triggers reaccionan bien** a los eventos mapeados: TTS2, VTuber AI (`!grim` y saludo
  de primer mensaje), Event Actions, chatbot, GACHA, Music, peleas.
- **El chat widget muestra los mensajes de Twitch**, mezclados con Kick y YouTube.
- **Las respuestas van a la plataforma donde se habló**: `chat.sendAsBot()` mira
  `eventBus.origin()` y rutea a Twitch cuando el evento vino de Twitch.

## Enviar mensajes

```js
// modules/chat.js — el único punto de decisión
if (eventBus.origin() === 'twitch') return sendToTwitch(content)
```

El request por el cable (idéntico al de YouTube salvo `platform`):

```json
{ "request": "SendMessage", "id": "sm-1", "platform": "twitch", "bot": true, "message": "hola" }
```

- `bot: true` = usar la **Bot Account** de Streamer.bot.
- Respuesta normalizada al contrato de Kick (`{ data: { is_sent: true, message_id } }`), para
  que VTuber AI hable por voz mirando `data.data.is_sent`.
- **Límite de 500 caracteres** (Twitch chat). Si se pasa, `sendAsBot()` lanza un error visible
  en vez de cortar el texto en silencio.
- Sin `replyTo`: el `SendMessage` de este puente no responde hilos.

### Anti-loop: por qué `STREAMERBOT_TWITCH_BOT_ID`

Cuando el bot escribe, Streamer.bot devuelve ese mensaje como evento con `user` = cuenta bot.
Sin filtro, vuelve al bus, el chatbot le contesta, y así hasta llenar tu chat. El módulo
descarta en `publish()` todo evento cuyo `meta.isMe`/`meta.internal` sea `true` o cuyo
`user.id` sea el bot. Va en `.env` a mano; vacío = sin protección por id.

skipped: chunking de mensajes largos y rate limit de Twitch. Agregar el chunker cuando una
respuesta de VTuber AI corte a los 500 caracteres.

## Estado / observabilidad

El módulo avisa por SSE (feed `/events`) con:

```json
{ "_source": "twitch", "type": "twitch:status", "connected": true, "host": "127.0.0.1:8080" }
```

Cada reintento de conexión está logueado:

```
[TWITCH] Conectado a Streamer.bot en ws://127.0.0.1:8080
[TWITCH] Suscrito a N eventos de twitch
[TWITCH] Desconectado de Streamer.bot; reintento en 5s
```

## Tests

```
node modules/triggers/twitch/test.js
```

Sin framework: `assert` sobre `normalize()` (función pura), el fallback genérico, el
anti-loop, el dedup y el `_source`. Incluye un Streamer.bot simulado que verifica el
handshake y que `SendMessage` sale con `platform: 'twitch'` y la Bot Account.

## Verificar que anda (a mano)

1. Con Streamer.bot corriendo, mirar el log: `[TWITCH] Conectado…` seguido de
   `[TWITCH] Suscrito a N eventos de twitch`.
2. Escribir en el chat de Twitch → debe aparecer el saludo de primer mensaje de GrimVTbot en
   el chat de Twitch, con voz.
3. Tirar un follow / un `!grim hola` / un cheer desde Twitch.

## Ver también

- [referencia/eventos.md](../referencia/eventos.md) — tabla de equivalencias Twitch ↔ Kick
- [modulos/youtube.md](youtube.md) — el otro lado del mismo core (`lib/streamerbot.js`)
- [arquitectura.md](../arquitectura.md#event-bus) — el Event Bus
