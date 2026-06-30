let BASE = 'http://localhost:26538'

function setPort(port) {
  BASE = `http://localhost:${port}`
}

function getBase() { return BASE }

async function getSongInfo() {
  const resp = await fetch(`${BASE}/api/v1/song-info`)
  if (resp.status === 204) return null
  if (!resp.ok) throw new Error(`song-info error: ${resp.status}`)
  return resp.json()
}

async function search(query) {
  const resp = await fetch(`${BASE}/api/v1/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  })
  if (!resp.ok) throw new Error(`search error: ${resp.status}`)
  if (resp.status === 204) return null
  const text = await resp.text()
  return text ? JSON.parse(text) : null
}

async function addToQueue(videoId) {
  const resp = await fetch(`${BASE}/api/v1/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId, insertPosition: 'INSERT_AFTER_CURRENT_VIDEO' })
  })
  if (!resp.ok) throw new Error(`queue error: ${resp.status}`)
  if (resp.status === 204 || resp.headers.get('content-length') === '0') return null
  const text = await resp.text()
  return text ? JSON.parse(text) : null
}

async function getQueue() {
  const resp = await fetch(`${BASE}/api/v1/queue`)
  if (resp.status === 204) return null
  if (!resp.ok) throw new Error(`queue error: ${resp.status}`)
  return resp.json()
}

async function next() {
  const resp = await fetch(`${BASE}/api/v1/next`, { method: 'POST' })
  if (resp.status === 204) return null
  if (!resp.ok) throw new Error(`next error: ${resp.status}`)
  return resp.json()
}

async function togglePlay() {
  const resp = await fetch(`${BASE}/api/v1/toggle-play`, { method: 'POST' })
  if (!resp.ok) throw new Error(`toggle-play error: ${resp.status}`)
  return resp.json()
}

async function setVolume(value) {
  const resp = await fetch(`${BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'setVolume', value })
  })
  if (!resp.ok) throw new Error(`volume error: ${resp.status}`)
  return resp.json()
}

async function like() {
  const resp = await fetch(`${BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'like' })
  })
  if (!resp.ok) throw new Error(`like error: ${resp.status}`)
  return resp.json()
}

function videoIdFromUrl(input) {
  const lower = input.toLowerCase()
  const short = 'youtu.be/'
  const idx = lower.indexOf(short)
  if (idx >= 0) {
    const start = idx + short.length
    const q = input.indexOf('?', start)
    return q < 0 ? input.slice(start).trim() : input.slice(start, q).trim()
  }
  if (lower.includes('youtube.com/watch')) {
    const v = input.match(/[?&]v=([^&]+)/)
    return v ? v[1] : null
  }
  return null
}

function extractVideoIdFromSearch(json) {
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return null
    if (obj.navigationEndpoint?.watchEndpoint?.videoId) return obj.navigationEndpoint.watchEndpoint.videoId
    for (const v of Object.values(obj)) {
      const r = walk(v)
      if (r) return r
    }
    return null
  }
  return walk(json)
}

module.exports = {
  setPort, getBase, getSongInfo, search, addToQueue, getQueue, next, togglePlay, setVolume, like,
  videoIdFromUrl, extractVideoIdFromSearch
}
