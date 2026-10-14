// Puente Twitch -> Event Bus vía el WebSocket Server de Streamer.bot.
//
// La plomería común (conexión, auth, subscribe, dedup, SSE, SendMessage) vive en
// lib/streamerbot.js. Acá solo se declara la traducción de cada evento de Twitch al nombre y
// shape de Kick, para que los triggers que ya existen (event-actions, GACHA, TTS2, etc.)
// funcionen en Twitch sin tocarlos. Los eventos de Twitch sin equivalente en Kick se emiten
// como `twitch.<Tipo>` con el payload crudo (todos los eventos, sin escribir 139 handlers).
//
// No hay endpoint HTTP: nos conectamos COMO CLIENTE al server de Streamer.bot.
const { createBridge, stripEmotes } = require('../../../lib/streamerbot')

// Canal de la cuenta bot. Sin esto, un mensaje que escribe el bot vuelve como evento y los
// triggers le contestan al bot: loop infinito de mensajes en tu propio chat.
const BOT_ID = process.env.STREAMERBOT_TWITCH_BOT_ID || ''

// -- Normalizadores: Twitch user/broadcaster -> sender/broadcaster de Kick --

const BADGE_MAP = {
  broadcaster: { type: 'streamer', text: 'Streamer' },
  moderator: { type: 'moderator', text: 'Moderator' },
  vip: { type: 'vip', text: 'VIP' },
  subscriber: { type: 'subscriber', text: 'Subscriber' },
  founder: { type: 'subscriber', text: 'Founder' },
}

function u(user) {
  if (!user) return null
  const badges = []
  for (const b of user.badges || []) {
    const name = String((b && (b.name || b.Name)) || '').toLowerCase()
    if (BADGE_MAP[name]) badges.push(BADGE_MAP[name])
  }
  if (user.subscribed && !badges.some((b) => b.type === 'subscriber')) {
    badges.push({ type: 'subscriber', text: 'Subscriber' })
  }
  return {
    id: user.id,
    user_id: user.id,
    username: user.name || user.login,
    channel_slug: user.login,
    is_verified: false,
    profile_picture: '',
    is_anonymous: false,
    identity: { username_color: user.color || '', badges },
  }
}

function bc(user) {
  if (!user) return null
  return {
    user_id: user.id,
    username: user.name || user.login,
    is_anonymous: false,
    is_verified: false,
    profile_picture: '',
    channel_slug: user.login,
    identity: { username_color: '', badges: [] },
  }
}

// Twitch no marca los emotes en el texto; llegan como palabras sueltas ("Kappa"). Sacamos solo
// los NATIVOS para que TTS2 no los lea en voz alta. Los de terceros (source "7TVChannel"/BTTV/FFZ)
// NO se tocan: Kick tampoco los etiqueta, así que "si"/"no" se conservan y TTS los lee igual.
// `stripEmotes` (lib/streamerbot.js) corta por rango (StartIndex/EndIndex) y cae a borrar el token
// completo; nunca parte una palabra por la mitad.

// -- Tabla de mapeo: evento de Twitch -> (evento del bus, payload estilo Kick) --

const NORMALIZE = {
  ChatMessage: (d) => ({
    event: 'chat.message.sent',
    id: d.messageId,
    payload: {
      message_id: d.messageId,
      content: stripEmotes(d.text, d.emotes),
      sender: u(d.user),
      emotes: d.emotes || [],
      replies_to: d.reply ? { message_id: d.reply.msgId, sender: { username: d.reply.userName } } : null,
      broadcaster: bc(d.broadcaster),
      created_at: d.createdAt,
    },
  }),

  // Primer sub del usuario (no renovación).
  Sub: (d) => ({
    event: 'channel.subscription.new',
    id: d.messageId || `sub:${d.user?.id}:${d.createdAt}`,
    payload: {
      broadcaster: bc(d.broadcaster),
      subscriber: u(d.user),
      duration: d.durationMonths || 1,
      created_at: d.createdAt,
      expires_at: null,
    },
  }),

  ReSub: (d) => ({
    event: 'channel.subscription.renewal',
    id: d.messageId || `resub:${d.user?.id}:${d.createdAt}`,
    payload: {
      broadcaster: bc(d.broadcaster),
      subscriber: u(d.user),
      duration: d.cumulativeMonths || d.durationMonths || 1,
      created_at: d.createdAt,
      expires_at: null,
    },
  }),

  // Una suscripción regalada a un usuario concreto.
  GiftSub: (d) => ({
    event: 'channel.subscription.gifts',
    id: d.messageId || `giftsub:${d.user?.id}:${d.recipient?.id}:${d.createdAt}`,
    payload: {
      broadcaster: bc(d.broadcaster),
      sender: u(d.user),
      gifter: u(d.user),
      giftees: [u(d.recipient)].filter(Boolean),
      tier: d.subTier,
      created_at: d.createdAt,
      expires_at: null,
    },
  }),

  // Bombardeo de subs a la comunidad (varias de golpe).
  GiftBomb: (d) => ({
    event: 'channel.subscription.gifts',
    id: d.messageId || d.id || `giftbomb:${d.user?.id}:${d.createdAt}`,
    payload: {
      broadcaster: bc(d.broadcaster),
      sender: u(d.user),
      gifter: u(d.user),
      giftees: (d.recipients || []).map(u),
      count: d.total,
      tier: d.subTier,
      created_at: d.createdAt,
      expires_at: null,
    },
  }),

  Follow: (d) => ({
    event: 'channel.followed',
    id: `follow:${d.targetUser?.id}:${d.followedAt || d.createdAt}`,
    payload: { broadcaster: bc(d.broadcaster), follower: u(d.targetUser) },
  }),

  Cheer: (d) => ({
    event: 'kicks.gifted',
    id: d.messageId || `cheer:${d.user?.id}:${d.createdAt}`,
    payload: {
      broadcaster: bc(d.broadcaster),
      sender: u(d.user),
      gift: {
        amount: d.bits,
        name: 'Bits',
        type: 'BITS',
        tier: '',
        message: stripEmotes(d.text, d.emotes),
        pinned_time_seconds: 0,
      },
      created_at: d.createdAt,
    },
  }),

  RewardRedemption: (d) => ({
    event: 'channel.reward.redemption.updated',
    id: d.redemptionId || `redeem:${d.user?.id}:${d.reward?.id}:${d.redeemedAt || d.createdAt}`,
    payload: {
      broadcaster: bc(d.broadcaster),
      redeemer: u(d.user),
      user: u(d.user),
      reward: {
        id: d.reward?.id,
        title: d.reward?.title,
        cost: d.reward?.cost,
        prompt: d.reward?.prompt,
      },
      input: d.userInput || '',
      status: d.status,
      created_at: d.redeemedAt || d.createdAt,
    },
  }),

  StreamOnline: (d) => ({
    event: 'livestream.status.updated',
    id: `live:${d.channelId || d.broadcaster?.id}:${d.startedAt || d.createdAt}`,
    payload: {
      broadcaster: bc(d.broadcaster),
      is_live: true,
      title: d.status || d.channel || '',
      started_at: d.startedAt || d.createdAt,
      ended_at: null,
    },
  }),

  StreamUpdate: (d) => ({
    event: 'livestream.metadata.updated',
    id: `streamupdate:${d.channelId || d.broadcaster?.id}:${d.createdAt}`,
    payload: {
      broadcaster: bc(d.broadcaster),
      title: d.status || d.channel || '',
      category: d.game?.name || d.game?.Name || '',
      created_at: d.createdAt,
    },
  }),
}

// El resto de los eventos de Twitch sale por el fallback genérico `twitch.<Tipo>`.
const EVENT_TYPES = Object.keys(NORMALIZE)

function normalize(type, data) {
  const d = data || {}
  const build = NORMALIZE[type]
  if (build) return build(d)
  const id = d.messageId || d.redemptionId || d.id
  return { event: `twitch.${type}`, id: id ? `${type}:${id}` : null, payload: d }
}

module.exports = createBridge({
  platform: 'twitch',
  source: 'Twitch',
  normalize,
  eventTypes: EVENT_TYPES,
  // Todos los eventos que tu Streamer.bot exponga; los no mapeados salen como twitch.<Tipo>.
  allEvents: true,
  isBotEcho: (data) =>
    !!(data && ((data.meta && (data.meta.isMe || data.meta.internal)) || (BOT_ID && data.user && data.user.id === BOT_ID))),
  maxLen: 500, // Twitch chat
})
