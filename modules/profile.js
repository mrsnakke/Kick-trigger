const cache = new Map()
const CACHE_TTL = 5 * 60 * 1000

function diceBearUrl(username) {
  return `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username)}`
}

async function fetchProfile(username) {
  const key = username.toLowerCase()
  const cached = cache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data

  let profileUrl = diceBearUrl(username)
  let channelName = username

  try {
    const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(username)}`)
    if (res.ok) {
      const data = await res.json()
      if (data.profile_pic) profileUrl = data.profile_pic
      if (data.user?.username) channelName = data.user.username
    }
  } catch {}

  const result = { username: channelName, profileUrl }
  cache.set(key, { data: result, ts: Date.now() })
  return result
}

async function handler(req, res) {
  const username = req.params.username
  if (!username) return res.status(400).json({ error: 'username required' })
  try {
    const data = await fetchProfile(username)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = { fetchProfile, handler }
