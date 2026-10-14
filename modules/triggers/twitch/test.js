// Checks del normalizador de Twitch. Sin framework: `node modules/triggers/twitch/test.js`
const assert = require('assert')
const twitch = require('./index')
const eventBus = require('../../../lib/event-bus')

const user = { id: '9001', login: 'mrsnake', name: 'MrSnake', color: '#1e90ff', subscribed: true, badges: [{ name: 'broadcaster', version: '1' }, { name: 'subscriber', version: '12' }] }
const broadcaster = { id: '1000', login: 'canal', name: 'Canal' }
const check = (type, data) => twitch.normalize(type, data)

// -- Cada evento con equivalente Kick debe caer en su nombre y shape de Kick --
const chat = check('ChatMessage', { messageId: 'm1', text: 'buenas Kappa', user, broadcaster, emotes: [{ Name: 'Kappa' }], createdAt: '2026-01-01T00:00:00Z' })
assert.equal(chat.event, 'chat.message.sent')
assert.equal(chat.payload.content, 'buenas')
assert.equal(chat.payload.sender.username, 'MrSnake')
assert.equal(chat.payload.sender.user_id, '9001')
assert.equal(chat.payload.sender.id, '9001')
assert.equal(chat.payload.sender.identity.username_color, '#1e90ff')
assert.equal(chat.payload.sender.identity.badges.some((b) => b.type === 'streamer'), true)
assert.equal(chat.payload.sender.identity.badges.some((b) => b.type === 'subscriber'), true)
assert.equal(chat.payload.broadcaster.user_id, '1000')

// -- Emotes: no deben morderse palabras normales; se prefiere el rango de Streamer.bot --
const sub = check('ChatMessage', { messageId: 'm2', text: '!sp que noche tan linda', user, broadcaster, emotes: [{ Name: 'no' }] })
assert.equal(sub.payload.content, '!sp que noche tan linda', 'un nombre de emote dentro de una palabra no debe cortarla')
const siete = check('ChatMessage', { messageId: 'm3', text: '!sp mira el KEKW viejo', user, broadcaster, emotes: [{ Name: 'KEKW', Source: '7TVChannel' }] })
assert.equal(siete.payload.content, '!sp mira el KEKW viejo', 'un emote de terceros (7TV) NO se borra: paridad con Kick')
// Una palabra real que además es emote 7TV se conserva para que TTS la lea (bug "si"/"no").
const si = check('ChatMessage', { messageId: 'm7', text: 'si', user, broadcaster, emotes: [{ Name: 'si', Source: '7TVChannel' }] })
assert.equal(si.payload.content, 'si', 'un emote 7TV que es palabra real no debe desaparecer')
const rango = check('ChatMessage', { messageId: 'm4', text: '!sp hola KEKW mundo', user, broadcaster, emotes: [{ Name: 'KEKW', StartIndex: 9, EndIndex: 13 }] })
assert.equal(rango.payload.content, '!sp hola mundo', 'corta el rango exacto')
const rangoInc = check('ChatMessage', { messageId: 'm5', text: '!sp hola KEKW mundo', user, broadcaster, emotes: [{ Name: 'KEKW', StartIndex: 9, EndIndex: 12 }] })
assert.equal(rangoInc.payload.content, '!sp hola mundo', 'endIndex inclusivo también debe cortar')
const rangoMal = check('ChatMessage', { messageId: 'm6', text: '!sp hola KEKW mundo', user, broadcaster, emotes: [{ Name: 'KEKW', StartIndex: 999, EndIndex: 1003 }] })
assert.equal(rangoMal.payload.content, '!sp hola mundo', 'si el rango no matchea el nombre, cae a token')

assert.equal(check('Follow', { targetUser: user, broadcaster, followedAt: '2026-01-02T00:00:00Z' }).event, 'channel.followed')
assert.equal(check('Follow', { targetUser: user, broadcaster }).payload.follower.username, 'MrSnake')

assert.equal(check('Sub', { messageId: 's1', user, broadcaster, subTier: '1000', durationMonths: 1 }).event, 'channel.subscription.new')
assert.equal(check('Sub', { messageId: 's1', user, broadcaster }).payload.subscriber.user_id, '9001')

const resub = check('ReSub', { messageId: 'r1', user, broadcaster, cumulativeMonths: 14 })
assert.equal(resub.event, 'channel.subscription.renewal')
assert.equal(resub.payload.duration, 14)

const giftSub = check('GiftSub', { messageId: 'g1', user, recipient: { id: '777', login: 'juan', name: 'Juan' }, broadcaster, subTier: '1000' })
assert.equal(giftSub.event, 'channel.subscription.gifts')
assert.equal(giftSub.payload.giftees.length, 1)
assert.equal(giftSub.payload.giftees[0].username, 'Juan')

const giftBomb = check('GiftBomb', { messageId: 'gb1', user, broadcaster, total: 5, subTier: '1000', recipients: [{ id: '1', login: 'a', name: 'A' }, { id: '2', login: 'b', name: 'B' }] })
assert.equal(giftBomb.event, 'channel.subscription.gifts')
assert.equal(giftBomb.payload.count, 5)
assert.equal(giftBomb.payload.giftees.length, 2)

const cheer = check('Cheer', { messageId: 'c1', user, broadcaster, bits: 300, text: 'toma 300' })
assert.equal(cheer.event, 'kicks.gifted')
assert.equal(cheer.payload.gift.type, 'BITS')
assert.equal(cheer.payload.gift.amount, 300)
assert.equal(cheer.payload.sender.username, 'MrSnake')

const redeem = check('RewardRedemption', { redemptionId: 'rr1', user, broadcaster, userInput: 'una canción', reward: { id: 'rw1', title: 'Pedir canción', cost: 100 }, status: 'unfulfilled', redeemedAt: '2026-01-03T00:00:00Z' })
assert.equal(redeem.event, 'channel.reward.redemption.updated')
assert.equal(redeem.payload.redeemer.username, 'MrSnake')
assert.equal(redeem.payload.reward.title, 'Pedir canción')
assert.equal(redeem.payload.input, 'una canción')

const online = check('StreamOnline', { broadcaster, channelId: '1000', status: 'jugando', startedAt: '2026-01-04T00:00:00Z' })
assert.equal(online.event, 'livestream.status.updated')
assert.equal(online.payload.is_live, true)
assert.equal(online.payload.title, 'jugando')

const update = check('StreamUpdate', { broadcaster, channelId: '1000', status: 'nuevo título', game: { name: 'Fortnite' } })
assert.equal(update.event, 'livestream.metadata.updated')
assert.equal(update.payload.title, 'nuevo título')
assert.equal(update.payload.category, 'Fortnite')

// -- El resto de eventos sale por el fallback genérico twitch.<Tipo> --
const hype = check('HypeTrainStart', { level: 1, total: 50 })
assert.equal(hype.event, 'twitch.HypeTrainStart')
assert.equal(hype.payload.total, 50)

// Los 10 eventos del pedido, cada uno con su equivalencia de Kick.
assert.equal(twitch.EVENT_TYPES.length, 10)

// -- Anti-loop: los eventos del propio bot no llegan al bus --
process.env.STREAMERBOT_TWITCH_BOT_ID = '999'
delete require.cache[require.resolve('./index')]
delete require.cache[require.resolve('../../../lib/event-bus')]
const tw2 = require('./index')
const bus2 = require('../../../lib/event-bus')

const eco = []
bus2.on('chat.message.sent', (d) => eco.push(d))
tw2.publish('ChatMessage', { messageId: 'loop1', text: 'hola', user: { id: '999', login: 'bot', name: 'Bot' }, meta: { isMe: true } })
tw2.publish('ChatMessage', { messageId: 'loop2', text: 'hola', user: { id: '999', login: 'bot', name: 'Bot' } })
assert.equal(eco.length, 0, 'ni el eco del bot (isMe) ni su id deben llegar al bus')
tw2.publish('ChatMessage', { messageId: 'ok1', text: 'hola', user, meta: { internal: false } })
assert.equal(eco.length, 1, 'un mensaje humano sí debe llegar')

// -- publish(): isTest se descarta, el dedup aguanta y el sobre lleva _source --
const vistos = []
eventBus.on('chat.message.sent', (d) => vistos.push(d))

twitch.publish('ChatMessage', { messageId: 'dup1', text: 'a', user })
twitch.publish('ChatMessage', { messageId: 'dup1', text: 'a', user }) // duplicado
twitch.publish('ChatMessage', { messageId: 'dup2', text: 'b', user, isTest: true }) // no va
assert.equal(vistos.length, 1)
assert.equal(vistos[0]._source, 'twitch')
assert.equal(vistos[0].payload.sender.user_id, '9001')

// -- Enruteo: sendAsBot manda a Twitch cuando el evento vino de Twitch --
async function testEnvio() {
  const { WebSocketServer } = require('ws')
  const wss = new WebSocketServer({ port: 0 })
  await new Promise((r) => wss.once('listening', r))
  const port = wss.address().port
  const recibidos = []

  wss.on('connection', (sock) => {
    sock.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.request === 'SendMessage') {
        recibidos.push(m)
        sock.send(JSON.stringify({ id: m.id, status: 'ok' }))
        return
      }
      if (m.request === 'Authenticate') return sock.send(JSON.stringify({ id: m.id, status: 'ok' }))
      if (m.request === 'GetEvents') return sock.send(JSON.stringify({ id: m.id, status: 'ok', events: { twitch: ['ChatMessage', 'Follow'] } }))
      sock.send(JSON.stringify({ request: 'Hello', session: 'test', authenticationRequired: true, heartbeatInterval: 30000 }))
    })
  })

  process.env.STREAMERBOT_WS_PORT = String(port)
  process.env.STREAMERBOT_WS_PASSWORD = '1379'
  delete require.cache[require.resolve('./index')]
  delete require.cache[require.resolve('../../../lib/event-bus')]
  delete require.cache[require.resolve('../../chat')]
  const twx = require('./index')
  const busx = require('../../../lib/event-bus')
  const chatx = require('../../chat')
  twx.init()
  await new Promise((r) => setTimeout(r, 250))

  // 1) Desde un evento de Twitch -> SendMessage a twitch con la Bot Account
  const res = await new Promise((resolve) => {
    busx.once('chat.message.sent', () => chatx.sendAsBot('hola desde twitch').then(resolve, resolve))
    twx.publish('ChatMessage', { messageId: 'e1', text: 'hola', user })
  })
  assert.equal(recibidos.length, 1, 'debería haber 1 SendMessage')
  assert.equal(recibidos[0].request, 'SendMessage')
  assert.equal(recibidos[0].platform, 'twitch')
  assert.equal(recibidos[0].bot, true, 'debe usar la Bot Account')
  assert.equal(recibidos[0].message, 'hola desde twitch')
  assert.equal(res.data.is_sent, true, 'debe devolver la forma de Kick o la IA no habla')
  assert.ok(res.data.message_id)

  // 2) Fuera de un evento (timers) -> Kick, no toca Streamer.bot
  await chatx.sendAsBot('esto va a kick').catch(() => {})
  assert.equal(recibidos.length, 1, 'un envío sin origen no debe ir a Twitch')

  // 3) Twitch acepta hasta 500: 501 se rechaza localmente y avisa
  const largo = await new Promise((resolve) => {
    busx.once('chat.message.sent', () => chatx.sendAsBot('x'.repeat(501)).then(resolve, resolve))
    twx.publish('ChatMessage', { messageId: 'e2', text: 'hola', user })
  })
  assert.ok(largo instanceof Error && /500/.test(largo.message), 'debe avisar del límite de 500')
  assert.equal(recibidos.length, 1, 'el mensaje largo no debe enviarse')

  // 4) `chat:sent` se emite también en Twitch, para que el widget muestre lo enviado
  const enviados = []
  busx.on('chat:sent', (d) => enviados.push(d))
  await new Promise((resolve) => {
    busx.once('chat.message.sent', () => chatx.sendAsBot('otro').then(resolve, resolve))
    twx.publish('ChatMessage', { messageId: 'e3', text: 'hola', user })
  })
  assert.equal(enviados.length, 1, 'debe emitir chat:sent al enviar a Twitch')
  assert.equal(enviados[0].content, 'otro')

  twx.stop()
  wss.close()
}

testEnvio().then(() => {
  console.log('OK - twitch: checks pasaron')
  process.exit(0)
}).catch((e) => {
  console.error('FALLO:', e && e.message)
  process.exit(1)
})
