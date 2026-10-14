// Puente YouTube -> Event Bus vía el WebSocket Server de Streamer.bot.
//
// Toda la plomería (conexión, auth, subscribe, dedup, SSE, SendMessage) vive en
// lib/streamerbot.js. Acá solo se declara cómo se traduce cada evento de YouTube al nombre y
// shape de Kick, para que los triggers existentes funcionen sin tocarlos. Ver twitch/index.js
// para el otro lado del mismo puente.
//
// No hay endpoint HTTP: el módulo se conecta COMO CLIENTE al server de Streamer.bot
// (ws://127.0.0.1:8080), que es quien empuja los eventos. Por eso solo aporta init().
const { createBridge, stripEmotes } = require('../../../lib/streamerbot')

// Canal de la cuenta bot. Sin esto, un mensaje que escribe el bot vuelve como evento y los
// triggers le contestan al bot: loop infinito de mensajes en tu propio chat.
const BOT_CHANNEL_ID = process.env.STREAMERBOT_YT_BOT_CHANNEL_ID || ''

// -- Normalizadores: YouTube user/broadcast -> sender/broadcaster de Kick --

function u(user) {
  if (!user) return null
  const badges = []
  if (user.isOwner) badges.push({ text: 'Streamer', type: 'streamer' })
  if (user.isModerator) badges.push({ text: 'Moderator', type: 'moderator' })
  if (user.isSponsor) badges.push({ text: 'Subscriber', type: 'subscriber' })
  return {
    user_id: user.id,
    username: user.name || user.login,
    channel_slug: user.login,
    is_verified: !!user.isVerified,
    profile_picture: user.profileImageUrl || '',
    is_anonymous: false,
    identity: { username_color: '', badges },
  }
}

// YouTube solo expone channelId, nunca el nombre del canal.
function bc(broadcast) {
  if (!broadcast || !broadcast.channelId) return null
  return {
    user_id: broadcast.channelId,
    username: '',
    is_anonymous: false,
    is_verified: false,
    profile_picture: '',
    channel_slug: '',
    identity: { username_color: '', badges: [] },
  }
}

// TTS2 solo limpia el formato de Kick `[emote:414:HYPERCLAP]`. Los emotes NATIVOS de YouTube
// llegan como `:chillwdog:` dentro del texto y se leerían en voz alta si no los sacamos aquí.
// Los de terceros (7TV/BTTV) llegan pelados y NO se tocan: igual que Kick, una palabra real que
// además es emote ("si", "no") se conserva. `stripEmotes` (lib/streamerbot.js) corta por rango y
// cae a token; con `thirdPartyIfBare` distingue los pelados como terceros.

const paidGift = (d, extra) => ({
  broadcaster: bc(d.broadcast),
  sender: u(d.user),
  gift: { amount: null, name: '', type: '', tier: '', message: '', pinned_time_seconds: 0, ...extra },
  created_at: d.publishedAt,
})

// -- Tabla de mapeo: evento de Streamer.bot -> (evento del bus, payload estilo Kick) --

const NORMALIZE = {
  Message: (d) => ({
    event: 'chat.message.sent',
    id: d.eventId,
    payload: {
      message_id: d.eventId,
      content: stripEmotes(d.message, d.emotes, { thirdPartyIfBare: true }),
      sender: u(d.user),
      emotes: d.emotes || [],
      replies_to: null,
      broadcaster: bc(d.broadcast),
      created_at: d.publishedAt,
    },
  }),

  SuperChat: (d) => ({
    event: 'kicks.gifted',
    id: d.eventId,
    payload: paidGift(d, {
      amount: d.decimalAmount,
      name: `${d.amount} ${d.currencyCode}`,
      type: 'SUPER_CHAT',
      tier: String(d.tier ?? ''),
      message: stripEmotes(d.message, d.emotes, { thirdPartyIfBare: true }),
    }),
  }),

  SuperSticker: (d) => ({
    event: 'kicks.gifted',
    id: d.eventId,
    payload: paidGift(d, {
      amount: d.decimalAmount,
      name: `Super Sticker ${d.sticker?.id ?? ''}`.trim(),
      type: 'SUPER_STICKER',
      tier: String(d.tier ?? ''),
    }),
  }),

  JewelsGifted: (d) => ({
    event: 'kicks.gifted',
    id: d.eventId,
    payload: paidGift(d, {
      amount: d.jewelsAmount,
      name: d.name || 'Jewels',
      type: 'JEWELS',
      pinned_time_seconds: d.durationSeconds ?? 0,
    }),
  }),

  NewSponsor: (d) => ({
    event: 'channel.subscription.new',
    id: d.eventId,
    payload: {
      broadcaster: bc(d.broadcast),
      subscriber: u(d.user),
      duration: 1,
      created_at: d.publishedAt,
      expires_at: null,
    },
  }),

  // No trae eventId ni publishedAt: Streamer.bot lo emite una sola vez, así que va sin dedup.
  NewSubscriber: (d) => ({
    event: 'channel.followed',
    id: null,
    payload: { broadcaster: null, follower: u(d.user) },
  }),

  MembershipGift: (d) => ({
    event: 'channel.subscription.gifts',
    id: d.eventId,
    payload: {
      broadcaster: bc(d.broadcast),
      // `sender` no existe en el payload de Kick, pero event-actions/index.js:98-106 saca el
      // usuario de `sender` y no de `gifter`/`giftees`: sin esto el saludo no se dispara.
      sender: u(d.user),
      gifter: u(d.user),
      giftees: Array.from({ length: d.count || 0 }, () => u(d.user)),
      tier: d.tier,
      created_at: d.publishedAt,
      expires_at: null,
    },
  }),

  GiftMembershipReceived: (d) => ({
    event: 'channel.subscription.gifts',
    id: d.eventId,
    payload: {
      broadcaster: bc(d.broadcast),
      sender: u(d.gifter) || u(d.user),
      gifter: u(d.gifter) || u(d.user),
      giftees: [u(d.user)].filter(Boolean),
      tier: d.tier,
      created_at: d.publishedAt,
      expires_at: null,
    },
  }),

  MemberMilestone: (d) => ({
    event: 'channel.subscription.renewal',
    id: d.eventId,
    payload: {
      broadcaster: bc(d.broadcast),
      subscriber: u(d.user),
      duration: d.months ?? 1,
      created_at: d.publishedAt,
      expires_at: null,
    },
  }),

  BroadcastStarted: (d) => ({
    event: 'livestream.status.updated',
    id: `bs_${d.broadcast?.id || 'unknown'}`,
    payload: {
      broadcaster: bc(d.broadcast),
      is_live: true,
      title: d.broadcast?.title || '',
      started_at: d.broadcast?.actualStartTime || new Date().toISOString(),
      ended_at: null,
    },
  }),
}

// El nombre real del evento lleva la S mayúscula ("MileStone"); el schema la escribe "Milestone".
// Nos suscribimos a las dos por si Streamer.bot lo normaliza.
NORMALIZE.MemberMileStone = NORMALIZE.MemberMilestone

const EVENT_TYPES = Object.keys(NORMALIZE)

function normalize(type, data) {
  const build = NORMALIZE[type]
  return build ? build(data || {}) : null
}

module.exports = createBridge({
  platform: 'youtube',
  source: 'YouTube',
  normalize,
  eventTypes: EVENT_TYPES,
  // El bot se responde a sí mismo si su mensaje vuelve al bus.
  isBotEcho: (data) => BOT_CHANNEL_ID && data && data.user && data.user.id === BOT_CHANNEL_ID,
  maxLen: 200, // YouTube live chat
})
