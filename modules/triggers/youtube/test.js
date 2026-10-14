// Checks del normalizador de YouTube. Sin framework: `node modules/triggers/youtube/test.js`
const assert = require('assert')
const youtube = require('./index')
const eventBus = require('../../../lib/event-bus')

const user = { id: 'UC123', login: 'streamer', name: 'Streamer', channelId: 'UC999', isOwner: true, isVerified: true }
const broadcast = { id: 'b1', channelId: 'UC999', title: 'Directo', actualStartTime: '2026-01-01T00:00:00Z' }
const check = (type, data) => youtube.normalize(type, data)

// -- Cada tipo debe caer en su evento de Kick, con los campos que el trigger lee --
assert.equal(check('Message', { eventId: 'e1', message: 'hola', user, broadcast }).event, 'chat.message.sent')

const superchat = check('SuperChat', { eventId: 'e2', amount: '5', decimalAmount: 5, currencyCode: 'USD', tier: '1', user, broadcast })
assert.equal(superchat.event, 'kicks.gifted')
assert.equal(superchat.payload.sender.username, 'Streamer')
assert.equal(superchat.payload.sender.identity.badges[0].type, 'streamer')
assert.equal(superchat.payload.gift.type, 'SUPER_CHAT')

assert.equal(check('SuperSticker', { eventId: 'e3', decimalAmount: 2, sticker: { id: 's1' }, user, broadcast }).payload.gift.type, 'SUPER_STICKER')
assert.equal(check('JewelsGifted', { eventId: 'e4', jewelsAmount: 50, name: 'Dragon', user, broadcast }).payload.gift.type, 'JEWELS')
assert.equal(check('NewSponsor', { eventId: 'e5', user, broadcast }).event, 'channel.subscription.new')
assert.equal(check('NewSubscriber', { user }).event, 'channel.followed')
assert.equal(check('MembershipGift', { eventId: 'e6', count: 3, user, broadcast }).payload.giftees.length, 3)
assert.equal(check('GiftMembershipReceived', { eventId: 'e7', user, gifter: user, broadcast }).event, 'channel.subscription.gifts')
assert.equal(check('MemberMileStone', { eventId: 'e8', months: 12, user, broadcast }).event, 'channel.subscription.renewal')
assert.equal(check('BroadcastStarted', { broadcast }).payload.is_live, true)

// El alias con la S mayúscula es el que emite Streamer.bot de verdad.
const alias = check('MemberMileStone', { eventId: 'e8', months: 12, user, broadcast })
assert.equal(alias.event, 'channel.subscription.renewal')
assert.equal(alias.payload.subscriber.user_id, 'UC123')

// Los 10 eventos del pedido, más el alias, deben estar mapeados.
assert.equal(youtube.EVENT_TYPES.length, 11)
assert.equal(youtube.normalize('AlgoQueNoExiste', {}), null)

// -- Emotes: TTS2 no limpia el formato :nombre: de YouTube, lo hacemos acá --
const conEmote = check('Message', { eventId: 'e9', message: 'bueno :chillwdog: :fire:', emotes: [{ name: ':chillwdog:' }, { name: ':fire:' }], user })
assert.equal(conEmote.payload.content, 'bueno')

// -- Emotes: cortar por rango y no morder palabras normales (los 7TV llegan con nombre pelado) --
const subEmote = check('Message', { eventId: 'e10', message: 'buenas noches amigos', user, emotes: [{ name: 'no' }] })
assert.equal(subEmote.payload.content, 'buenas noches amigos', 'un nombre de emote dentro de una palabra no debe cortarla')
// Los emotes 7TV pelados son de terceros: no se borran, así "si"/"no" sobreviven (paridad con Kick).
const siEmote = check('Message', { eventId: 'e14', message: 'si', user, emotes: [{ name: 'si', type: '7TV' }] })
assert.equal(siEmote.payload.content, 'si', 'un emote 7TV que es palabra real no debe desaparecer')
const rangoEmote = check('Message', { eventId: 'e11', message: 'hola :chillwdog: mundo', user, emotes: [{ name: ':chillwdog:', startIndex: 5, endIndex: 16 }] })
assert.equal(rangoEmote.payload.content, 'hola mundo', 'corta el rango exacto')
const rangoInc = check('Message', { eventId: 'e12', message: 'hola :chillwdog: mundo', user, emotes: [{ name: ':chillwdog:', startIndex: 5, endIndex: 15 }] })
assert.equal(rangoInc.payload.content, 'hola mundo', 'endIndex inclusivo también debe cortar')
const rangoMal = check('Message', { eventId: 'e13', message: 'hola :chillwdog: mundo', user, emotes: [{ name: ':chillwdog:', startIndex: 999, endIndex: 1010 }] })
assert.equal(rangoMal.payload.content, 'hola mundo', 'si el rango no matchea el nombre, cae a token')

// -- Anti-loop: el bot no se responde a sí mismo --
// El módulo lee el id del canal bot al cargarse, así que va antes del require.
process.env.STREAMERBOT_YT_BOT_CHANNEL_ID = 'UCBOT'
delete require.cache[require.resolve('./index')]
delete require.cache[require.resolve('../../../lib/event-bus')]
const yt2 = require('./index')
const bus2 = require('../../../lib/event-bus')

const eco = []
bus2.on('chat.message.sent', (d) => eco.push(d))
yt2.publish('Message', { eventId: 'loop1', message: 'hola', user: { id: 'UCBOT', login: 'elbot', name: 'El Bot', channelId: 'UC999' } })
assert.equal(eco.length, 0, 'el mensaje del propio bot no debe llegar al bus')
yt2.publish('Message', { eventId: 'ok1', message: 'hola', user: { id: 'UC123', login: 'streamer', name: 'Streamer', channelId: 'UC999' } })
assert.equal(eco.length, 1, 'un mensaje humano sí debe llegar')

// -- publish(): isTest se descarta, el dedup aguanta y el sobre lleva _source --
const vistos = []
eventBus.on('chat.message.sent', (d) => vistos.push(d))

youtube.publish('Message', { eventId: 'dup1', message: 'a', user })
youtube.publish('Message', { eventId: 'dup1', message: 'a', user }) // duplicado
youtube.publish('Message', { eventId: 'dup2', message: 'b', user, isTest: true }) // no va
assert.equal(vistos.length, 1)
assert.equal(vistos[0]._source, 'youtube')
assert.equal(vistos[0].payload.sender.user_id, 'UC123')

// -- Enruteo: sendAsBot manda a la plataforma del evento, sin que el trigger se entere --
// Streamer.bot simulado: contesta el handshake y acepta (o rechaza) el SendMessage.
async function testEnvio() {
  const { WebSocketServer } = require('ws')
  const wss = new WebSocketServer({ port: 0 })
  await new Promise((r) => wss.once('listening', r))
  const port = wss.address().port
  const recibidos = []
  const rechazados = new Set()

  wss.on('connection', (sock) => {
    sock.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.request === 'SendMessage') {
        recibidos.push(m)
        sock.send(JSON.stringify({ id: m.id, status: rechazados.has(m.message) ? 'error' : 'ok', error: 'msgTooLong' }))
        return
      }
      if (m.request === 'Authenticate') return sock.send(JSON.stringify({ id: m.id, status: 'ok' }))
      if (m.request === 'GetEvents') return sock.send(JSON.stringify({ id: m.id, status: 'ok', events: { YouTube: [{ event: 'Message' }] } }))
      sock.send(JSON.stringify({ request: 'Hello', session: 'test', challenge: 'c', authenticationRequired: true, heartbeatInterval: 30000 }))
    })
  })

  process.env.STREAMERBOT_WS_PORT = String(port)
  process.env.STREAMERBOT_WS_PASSWORD = '1379'
  delete require.cache[require.resolve('./index')]
  delete require.cache[require.resolve('../../../lib/event-bus')]
  delete require.cache[require.resolve('../../chat')]
  const ytx = require('./index')
  const busx = require('../../../lib/event-bus')
  const chatx = require('../../chat')
  ytx.init()
  await new Promise((r) => setTimeout(r, 250))

  // 1) Desde un evento de YouTube -> SendMessage a youtube
  const res = await new Promise((resolve) => {
    busx.once('chat.message.sent', () => chatx.sendAsBot('hola desde youtube').then(resolve, resolve))
    ytx.publish('Message', { eventId: 'e1', message: 'hola', user: { id: 'UC123', login: 'streamer', name: 'Streamer', channelId: 'UC999' } })
  })
  assert.equal(recibidos.length, 1, 'debería haber 1 SendMessage')
  assert.equal(recibidos[0].request, 'SendMessage')
  assert.equal(recibidos[0].platform, 'youtube')
  assert.equal(recibidos[0].bot, true, 'debe usar la Bot Account')
  assert.equal(recibidos[0].message, 'hola desde youtube')
  // Contrato de Kick: VTuber AI decide si habla por voz con `data.data.is_sent`.
  assert.equal(res.data.is_sent, true, 'debe devolver la forma de Kick o la IA no habla')
  assert.ok(res.data.message_id)

  // 2) Fuera de un evento (timers) -> Kick, no toca Streamer.bot
  await chatx.sendAsBot('esto va a kick').catch(() => {})
  assert.equal(recibidos.length, 1, 'un envío sin origen no debe ir a YouTube')

  // 3) YouTube rechaza 201 caracteres: el error debe verse, no tragarse el texto
  rechazados.add('x'.repeat(201))
  const largo = await new Promise((resolve) => {
    busx.once('chat.message.sent', () => chatx.sendAsBot('x'.repeat(201)).then(resolve, resolve))
    ytx.publish('Message', { eventId: 'e2', message: 'hola', user: { id: 'UC123', login: 'streamer', name: 'Streamer', channelId: 'UC999' } })
  })
  assert.ok(largo instanceof Error && /200/.test(largo.message), 'debe avisar del límite de 200')

  // 4) `chat:sent` se emite en ambas plataformas, para que el widget muestre lo enviado
  const enviados = []
  busx.on('chat:sent', (d) => enviados.push(d))
  await new Promise((resolve) => {
    busx.once('chat.message.sent', () => chatx.sendAsBot('otro').then(resolve, resolve))
    ytx.publish('Message', { eventId: 'e3', message: 'hola', user: { id: 'UC123', login: 'streamer', name: 'Streamer', channelId: 'UC999' } })
  })
  assert.equal(enviados.length, 1, 'debe emitir chat:sent al enviar a YouTube')
  assert.equal(enviados[0].content, 'otro')

  ytx.stop()
  wss.close()
}

testEnvio().then(() => {
  console.log('OK - youtube: checks pasaron')
  process.exit(0)
}).catch((e) => {
  console.error('FALLO:', e && e.message)
  process.exit(1)
})
