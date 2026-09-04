const cache = new Map()
const CACHE_TTL = 10 * 60 * 1000

async function fetchEmotes(userId) {
  const cached = cache.get(userId)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data

  const emotes = []
  let emoteSetId = null
  let userInfo = { username: '', displayName: '', emoteCount: 0, emoteSetName: '' }

  try {
    const userRes = await fetch(`https://7tv.io/v3/users/${userId}`)
    if (userRes.ok) {
      const userData = await userRes.json()
      userInfo.username = userData.username || ''
      userInfo.displayName = userData.display_name || userData.username || ''

      if (userData.emote_sets && userData.emote_sets.length > 0) {
        emoteSetId = userData.emote_sets[0].id
        userInfo.emoteSetName = userData.emote_sets[0].name || ''
      } else if (userData.connections && userData.connections.length > 0) {
        const conn = userData.connections.find(c => c.emote_set_id || c.emote_set?.id)
        if (conn) {
          emoteSetId = conn.emote_set_id || conn.emote_set?.id
          if (conn.emote_set?.name) userInfo.emoteSetName = conn.emote_set.name
        }
      }
    }
  } catch {}

  if (emoteSetId) {
    try {
      const setRes = await fetch(`https://7tv.io/v3/emote-sets/${emoteSetId}`)
      if (setRes.ok) {
        const setData = await setRes.json()
        userInfo.emoteSetName = setData.name || userInfo.emoteSetName
        if (Array.isArray(setData.emotes)) {
          for (const e of setData.emotes) {
            const isZeroWidth = (e.flags & 1) !== 0 || (e.flags & 256) !== 0
            emotes.push({
              id: e.id,
              name: e.name,
              url: `https://cdn.7tv.app/emote/${e.id}/2x.webp`,
              animated: e.data?.animated ?? true,
              isZeroWidth,
              ownerName: e.data?.owner?.display_name || ''
            })
          }
          userInfo.emoteCount = emotes.length
        }
      }
    } catch {}
  }

  // global emotes
  try {
    const globalRes = await fetch('https://7tv.io/v3/emote-sets/global')
    if (globalRes.ok) {
      const globalData = await globalRes.json()
      if (Array.isArray(globalData.emotes)) {
        const existing = new Set(emotes.map(e => e.name))
        for (const e of globalData.emotes) {
          if (existing.has(e.name)) continue
          const isZeroWidth = (e.flags & 1) !== 0 || (e.flags & 256) !== 0
          emotes.push({
            id: e.id,
            name: e.name,
            url: `https://cdn.7tv.app/emote/${e.id}/2x.webp`,
            animated: e.data?.animated ?? true,
            isZeroWidth,
            ownerName: ''
          })
        }
      }
    }
  } catch {}

  const result = { emotes, userInfo }
  cache.set(userId, { data: result, ts: Date.now() })
  return result
}

async function handler(req, res) {
  const userId = req.params.userId || req.query.userId
  if (!userId) return res.status(400).json({ error: 'userId required' })
  try {
    const data = await fetchEmotes(userId)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = { fetchEmotes, handler }
