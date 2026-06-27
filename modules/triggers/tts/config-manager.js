const fs = require('fs')
const path = require('path')
const eventBus = require('../../../lib/event-bus')

const DATA_PATH = path.join(__dirname, 'tts-data.json')

let data = {
  config: {
    COMMAND: '!sp',
    VOICE_NAME: 'Sabina',
    VOICE_ALIASES: { ava: 'Ava', brian: 'Brian', jorge: 'Jorge', sabina: 'Sabina' },
    SPEAKERBOT_URL: 'ws://127.0.0.1:7580/',
    MAX_TEXT_LENGTH: 600,
    KICKBONKS_URL: 'http://localhost:3030'
  },
  bannedWords: ['cara de gato', 'Caradegato', 'puto', 'puta', 'maricon', 'pendejo'],
  userAliases: {}
}

function load() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      data = { ...data, ...JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) }
    }
  } catch (e) { console.error('[TTS] Error cargando tts-data.json:', e.message) }
}

function save() {
  try { fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8') }
  catch (e) { console.error('[TTS] Error escribiendo tts-data.json:', e.message) }
}

load()

function getConfig() { return data.config }
function getBannedWords() { return data.bannedWords }
function getUserAliases() { return data.userAliases }

function getUserAlias(username) {
  if (!username) return null
  return data.userAliases[username.toLowerCase()] || null
}

function setUserAlias(username, voiceName) {
  if (!username || !voiceName) return false
  const key = username.toLowerCase()
  data.userAliases[key] = { username, voice: voiceName, updatedAt: new Date().toISOString() }
  save()
  eventBus.emit('tts:user_aliases_updated', data.userAliases)
  return true
}

function deleteUserAlias(username) {
  if (!username) return false
  const key = username.toLowerCase()
  if (data.userAliases[key]) {
    delete data.userAliases[key]
    save()
    eventBus.emit('tts:user_aliases_updated', data.userAliases)
    return true
  }
  return false
}

function updateConfig(newConfig, newBannedWords) {
  if (newConfig) {
    data.config = { ...data.config, ...newConfig }
  }
  if (newBannedWords && Array.isArray(newBannedWords)) {
    data.bannedWords = newBannedWords
  }
  save()
  eventBus.emit('tts:config_updated', { config: data.config, bannedWords: data.bannedWords })
}

function containsBannedWords(message) {
  const lower = message.toLowerCase()
  return data.bannedWords.some(w => { const c = w.trim().toLowerCase(); return c && lower.includes(c) })
}

module.exports = {
  getConfig, getBannedWords, updateConfig,
  containsBannedWords,
  getUserAliases, getUserAlias, setUserAlias, deleteUserAlias
}
