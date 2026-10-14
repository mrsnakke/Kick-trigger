# YouTube — puente de eventos de YouTube vía Streamer.bot

## Objetivo

Que los eventos de un canal de **YouTube entren al [Event Bus](../arquitectura.md#event-bus)**
con el **mismo formato que los de Kick**, para que los triggers que ya existen (TTS2,
VTuber AI, Event Actions, GACHA, chatbot, peleas…) reaccionen a un mensaje de YouTube
sin tocar una sola línea de esos módulos.

## Integración con kick-backend

```
Streamer.bot 1.0  (WebSocket Server, localhost:8080)
   │  eventos source: "YouTube"
   ▼
modules/triggers/youtube/index.js   ★ este módulo (conecta + normaliza)
   │  eventBus.emit(<nombre de evento de Kick>, { payload, ts, _source: 'youtube' })
   ▼
Event Bus  ──►  los 11 triggers que ya escuchan chat.message.sent, kicks.gifted, …
```

- **No hay endpoint HTTP.** El módulo se conecta *como cliente* al WebSocket Server de
  Streamer.bot (`ws://127.0.0.1:8080`), al revés de lo que parece por el nombre. El server
  empuja los eventos; este proceso abre la conexión. Por eso el módulo no expone ninguna ruta
  y lo único que aporta al `server.js` es el `init()`.
- **No toca el core.** Es la regla de oro del proyecto: entra por el bus, no por dentro de
  `modules/webhook.js`.
- El campo `_source: 'youtube'` en el sobre del bus es lo único que distingue el origen.
  Kick no lo manda, así que la ausencia de `_source` significa Kick.
- **Core compartido.** Toda la plomería del WebSocket (conexión, auth, `GetEvents` →
  `Subscribe`, dedup, SSE, `SendMessage`) vive en `lib/streamerbot.js` (`createBridge`). Este
  archivo es una **config fina** que solo declara cómo se traduce cada evento de YouTube. El
  puente de [Twitch](twitch.md) reusa el mismo core.

## Por qué WebSocket y no Fetch URL

Streamer.bot 1.0 soporta las dos. Se eligió el WebSocket porque:

| | WebSocket Server | Fetch URL (Streamer Action) |
|---|---|---|
| Método HTTP | libre (el server manda `POST`) | **GET únicamente** |
| Eventos que llegan | los 10 de YouTube en vivo | los mismos, uno por request |
| Reconexión | a cargo del cliente (cada 5s) | a cargo de Streamer.bot |
| Secretos | fuera del request (auth al abrir) | van en la URL |

Con Fetch URL los identificadores de canal y el nombre del canal hay que pasarlos por la URL
o por headers custom, y GET no admite body. El WebSocket manda el payload crudo del evento.

## Configuración

Variables de entorno (todas opcionales, con default):

| Variable | Default | Para qué |
|---|---|---|
| `STREAMERBOT_WS_HOST` | `127.0.0.1` | Host del WebSocket Server de Streamer.bot |
| `STREAMERBOT_WS_PORT` | `8080` | Puerto del WebSocket Server |
| `STREAMERBOT_WS_PASSWORD` | *(vacío)* | Si está seteada, se autentica tras el `Hello` |

Para exponerlos, definilas en `.env` junto a las demás variables del proyecto.

### En Streamer.bot

1. **Servers/Clients → WebSocket Server**: activar el server. Conviene *Auto Start*, para que
   levante solo cada vez que se abre Streamer.bot.
2. **Address** `127.0.0.1` y **Port** `8080`: tienen que coincidir con `STREAMERBOT_WS_HOST` y
   `STREAMERBOT_WS_PORT`. **Endpoint** se deja en `/`, porque el módulo se connecta a
   `ws://host:puerto` sin path.
3. **Authentication**: opcional. Si la activás, la password tiene que ser idéntica a
   `STREAMERBOT_WS_PASSWORD` y el módulo contesta el `Authenticate` del `Hello`. Con *Enforce*
   apagado la auth solo se exige para pedidos privilegiados (tipo `SendMessage`), así que los
   eventos igual llegan sin contraseña.
4. **Platforms → YouTube → Accounts → Broadcaster Account → Sign in with Google**: es lo
   único imprescindible. Sin esa cuenta Streamer.bot no abre el live chat y no emite ningún
   evento de YouTube. Conviene *Auto Connect*. El *Bot Account* es opcional y solo sirve para
   mandar mensajes desde otra cuenta.
5. Nada más. La suscripción la hace el módulo solo (ver abajo), no hay que tocar nada en la UI
   para empezar a recibir eventos.

## Suscripción: por qué la UI dice "Subscriptions 0"

Streamer.bot **no manda ningún evento hasta que el cliente manda un `Subscribe`**. Conectarse no
alcanza: en su UI vas a ver el cliente conectado y `Subscriptions 0`, y no llega nada. Es el
síntoma de olvidarse de la suscripción.

El módulo la hace solo al abrir la conexión (`modules/triggers/youtube/index.js`):

```
[Conectado] → (Authenticate si hay password) → GetEvents → Subscribe{ youTube: [...] }
```

Con `GetEvents` primero porque la lista de eventos depende de la versión de Streamer.bot:
suscribirse a un evento que tu build no tiene hace fallar el `Subscribe` completo. Por eso pide
solo los tipos que declaraste y loguea el resto.

## Autenticación

Si `STREAMERBOT_WS_PASSWORD` está vacía, no se manda nada y los eventos llegan igual.

Si está seteada, al abrir la conexión Streamer.bot manda:

```json
{ "request": "Hello", "authentication": { "salt": "...", "challenge": "..." } }
```

y el cliente contesta con el doble hash que define Streamer.bot:

```
secret      = base64( sha256( PASSWORD + salt ) )
respuesta   = base64( sha256( secret   + challenge ) )
→ { "request": "Authenticate", "id": "auth-1", "authentication": "<respuesta>" }
```

## Mapeo de eventos

Cada evento de YouTube se re-emite en el bus bajo el **nombre y el shape de Kick**, para que
los triggers existentes los reconozcan sin tocarlos.

| Evento de Streamer.bot | Evento en el bus | Lo que ve el trigger |
|---|---|---|
| `YouTube.Message` | `chat.message.sent` | Texto del chat, con emotes ya eliminados |
| `YouTube.SuperChat` | `kicks.gifted` | `gift.type = SUPER_CHAT`, monto y `tier` |
| `YouTube.SuperSticker` | `kicks.gifted` | `gift.type = SUPER_STICKER` |
| `YouTube.JewelsGifted` † | `kicks.gifted` | `gift.type = JEWELS` |
| `YouTube.NewSponsor` | `channel.subscription.new` | `subscriber` |
| `YouTube.NewSubscriber` † | `channel.followed` | `follower` |
| `YouTube.MembershipGift` | `channel.subscription.gifts` | `gifter` + `giftees` |
| `YouTube.GiftMembershipReceived` | `channel.subscription.gifts` | `gifter` + `giftees` |
| `YouTube.MemberMileStone` | `channel.subscription.renewal` | `subscriber`, `duration = months` |
| `YouTube.BroadcastStarted` | `livestream.status.updated` | `is_live`, `title` |

> **Nombre con S:** el evento real se llama `MemberMileStone` (con la *S* mayúscula) aunque el
> schema de Streamer.bot lo escriba `MemberMilestone`. El módulo registra **las dos
> grafías** para no depender de eso.

> **† Dependen de la versión:** algunos tipos (según la build: `JewelsGifted`, `NewSubscriber`,
> `MemberMileStone`…) no aparecen en el `GetEvents`. El módulo no los pide a ciegas: se
> suscribe solo a los tipos que tu Streamer.bot declara, y loguea cuáles no encontró. Por eso
> el log dice `Suscrito a N/11` (10/11 en una build actual) en vez de 11: es normal, no es un
> error. Lo que tu build no soporta simplemente no llega al bus.

### Traducción de los campos

- **Usuario** → `sender` de Kick: `user_id` = el channel id (`UC…`), `username` = `name` o
  `login`. YouTube no tiene equivalentes de `is_verified`/`is_anonymous`/`color`, se mandan
  fijos/falseos. Los badges (`streamer` / `moderator` / `subscriber`) se derivan de
  `isOwner` / `isModerator` / `isSponsor`.
- **Canal** → `broadcaster` de Kick: solo se puede completar el `user_id` (= `channelId`).
  **YouTube nunca expone el nombre del canal**, así que `username` va vacío.
- **`isTest: true`** → el evento se descarta, no llega al bus. Es el flag de prueba de
  Streamer.bot.
- **Emotes**: el chat de YouTube trae `emotes: [{ name, startIndex, endIndex }]`. El módulo
  **borra solo los emotes nativos** antes de emitir. Sin esto, TTS2 leería ":chillwdog:" en voz
  alta porque solo sabe limpiar el formato de Kick `[emote:414:HYPERCLAP]`. El corte usa el
  rango `startIndex/endIndex` (auto-validado contra el nombre) y, si el rango no matchea, borra
  el token completo — nunca por subcadena, que mordería palabras normales. Los emotes de
  **terceros** (7TV/BTTV) llegan con nombre pelado (sin `:`) y **no se tocan**: Kick tampoco
  los etiqueta, así que una palabra real que además es emote (`si`, `no`) se conserva y TTS la
  lee, con el mismo comportamiento que en Kick. El helper vive en `lib/streamerbot.js`
  (`stripEmotes`) y lo comparte con Twitch.
- **`NewSubscriber` no trae `eventId` ni `publishedAt`.** Como Streamer.bot lo emite una sola
  vez, ese evento pasa **sin deduplicar**. Todos los demás se deduplican por `eventId`
  durante 10 minutos (igual que hace `modules/webhook.js`).

## Qué SÍ y qué NO funciona desde YouTube

- **Los triggers reaccionan bien** a los eventos de YouTube: TTS2, VTuber AI (`!grim` y el
  saludo de primer mensaje), Event Actions, chatbot, GACHA, Music, peleas.
- **El chat widget muestra los mensajes de YouTube**, mezclados con los de Kick, sin
  distinguirlos. Eso es por diseño: el widget escucha el SSE, y el módulo publica ahí lo mismo
  que `webhook.js` publica para Kick (`{type:'event', eventType, payload, ts}`). Solo el
  backend lleva el `_source` para saber de dónde vino.
- **Las respuestas van solo a Kick.** `chat.sendAsBot()` sigue hablando con Kick, así que un
  `!gacha` o `!stats` mandado desde YouTube se ejecuta pero el texto de respuesta aparece en
  el chat de Kick. Todos los call sites de `sendAsBot` capturan el error, así que **el comando
  se ejecuta igual** y no se rompe nada.
- **La voz (TTS) sigue atada a que el chat de Kick responda**, porque depende del mismo
  `sendAsBot`. Es el comportamiento que se pidió: TTS2 lee el chat de YouTube, pero la señal
  que dispara la locución es que Kick esté disponible.

## Peleas: namespace `yt_`

Los peleadores de YouTube entran a las peleas con **ficha propia**, en un namespace
separado del de Kick. El id de YouTube (`UC…`) y el de Kick (número) pueden no coincidir, y
aunque coincidieran no deben compartir nivel, EXP ni récords: son dos cuentas distintas en
dos plataformas distintas.

La llave de una ficha pasa a ser `${ns}_${id}` con `ns = 'kick'` (default) o `'yt'`:

- `kick_63964178` → un jugador de Kick (como siempre, byte a byte igual)
- `yt_UCI9-KG2xoyh5z-g41IL2jqf` → un jugador de YouTube

Ver [fighting.md](fighting.md) para el detalle. El bug que motivó esto: `playerIdOf` hacía
`Number(kickId)` y todos los ids de YouTube colapsaban en un mismo `kick_NaN`. Cubierto por
`modules/triggers/fighting-Chat/server/player-id.test.mjs`.

## Estado / observabilidad

El módulo avisa por SSE (feed `/events`) con:

```json
{ "_source": "youtube", "type": "youtube:status", "connected": true, "host": "127.0.0.1:8080" }
```

`connected: false` cuando está reconectando. Cada reintento de conexión está logueado:

```
[YOUTUBE] Conectado a Streamer.bot en ws://127.0.0.1:8080
[YOUTUBE] Suscrito a 10/11 eventos de YouTube: Message, SuperChat, …
[YOUTUBE] Desconectado de Streamer.bot; reintento en 5s
```

La línea de suscripción es la que confirma que llegan eventos. Si falta, estás conectado pero
sin eventos: es el `Subscriptions 0` de la UI de Streamer.bot.

## Enviar mensajes (responder donde se pidió)

El bot contesta en la plataforma donde se le habló. `chat.sendAsBot()` mira
`eventBus.origin()` y rutea: si el evento vino de YouTube usa el `SendMessage` del WebSocket
de Streamer.bot, si no, sigue yendo a Kick como siempre.

```js
// modules/chat.js — el único punto de decisión
if (eventBus.origin() === 'youtube') return sendToYouTube(content)
```

`origin()` usa `AsyncLocalStorage` en `lib/event-bus.js`: cada `emit` corre dentro de un
contexto con el `_source` del evento, y ese contexto sobrevive a los `await` y a las promesas
sin `await`. Por eso los ~60 call sites de `sendAsBot()` (chatbot, GACHA, VTuber AI, TTS2,
Music, peleas) **no se tocan** y ya contestan en la plataforma correcta. Un timer creado
fuera de un evento (los de chatbot, los de Music) da `origin() === 'kick'`, que es el
comportamiento de siempre.

El request que va por el cable:

```json
{ "request": "SendMessage", "id": "sm-1", "platform": "youtube", "bot": true, "message": "hola" }
```

La respuesta se **normaliza al contrato de Kick** (`{ data: { is_sent: true, message_id } }`) en
`chat.js`. No es cosmético: VTuber AI decide si hablar por voz mirando `data.data.is_sent`
(`vtuber-ai/index.js:435`), así que si `sendAsBot()` devolviera el `{ status: 'ok' }` crudo de
Streamer.bot, el mensaje saldría al chat pero **la voz se silenciaría**. Un error de Streamer.bot
se propaga como excepción, que es lo que los `try/catch` de los triggers ya esperan.

- `bot: true` = usar la **Bot Account** de Streamer.bot, no el canal del broadcaster.
- `id` propio por envío: el módulo correlaciona la respuesta de Streamer.bot con su promesa
  (timeout de 10s). Si el server cae, los envíos pendientes se rechazan en vez de colgarse.
- **Sin `replyTo`**: los ids de YouTube son `eventId` de Streamer.bot, no mensajes de chat.
- **Límite de 200 caracteres** (YouTube live chat). Si se pasa, `sendAsBot()` lanza un error
  visible en vez de cortar el texto en silencio.

### Anti-loop: por qué `STREAMERBOT_YT_BOT_CHANNEL_ID`

Cuando el bot escribe, Streamer.bot devuelve ese mensaje como evento `Message` con `user` = la
cuenta bot. Sin filtro, vuelve al bus, el chatbot le contesta, y así hasta llenar tu chat.

El módulo descarta en `publish()` todo evento cuyo `sender.user_id` sea ese canal, **antes**
de emitir al bus. Streamer.bot no expone el id del bot de YouTube (`GetBroadcaster` solo trae
`broadcastUserId`), así que va en `.env` a mano. Si queda vacío no hay protección: es el único
punto donde puede aparecer el loop.

skipped: chunking de mensajes largos y rate limit de 11 msgs/30s. Agregar el chunker cuando
una respuesta de VTuber AI corte a los 200 caracteres.

## Tests

```
node modules/triggers/youtube/test.js
```

Sin framework: son `assert` sobre `normalize()`, que es la función pura que traduce un evento.
Cubre los 10 tipos, el alias `MemberMileStone`, que los emotes desaparecen del texto, que
`isTest` se descarta, que el dedup aguanta y que el sobre lleva `_source: 'youtube'`.

La parte de red (conexión, `Authenticate`, `GetEvents` → `Subscribe`) no entra en `test.js`
porque necesita un server real: se probó contra un Streamer.bot simulado que rechaza eventos
inexistentes y devuelve el evento al bus, igual que en producción.

## Verificar que anda (a mano)

1. Con Streamer.bot corriendo, mirar el log: `[YOUTUBE] Conectado…` seguido de
   `[YOUTUBE] Suscrito a N/11 eventos…`. En la UI de Streamer.bot, *Subscriptions* debe dejar de
   decir 0.
2. Commentar en YouTube **con el directo en vivo** (no hay live chat antes de empezar) → debe
   aparecer el saludo de primer mensaje de GrimVTbot en el chat de Kick, con voz.
3. Escribir `!grim hola` desde YouTube → la IA responde.
4. Escribir `!retar @alguien` desde YouTube → el overlay de peleas crea la ficha `yt_…`.

## Ver también

- [referencia/eventos.md](../referencia/eventos.md) — tabla de equivalencias YouTube ↔ Kick
- [setup.md](../setup.md) — puesta en marcha
- [modulos/fighting.md](fighting.md) — peleas 1v1 (y el namespace `yt_`)
- [modulos/tts.md](tts.md) — por qué los emotes de YouTube hay que sacarlos antes
