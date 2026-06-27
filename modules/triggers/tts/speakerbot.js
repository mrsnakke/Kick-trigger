const WebSocket = require('ws')
const configManager = require('./config-manager')

let speakerbotWs = null
let speakerbotActive = false

function getStatus() { return speakerbotActive }

function initSpeakerbot() {
  if (speakerbotWs) { try { speakerbotWs.terminate() } catch {} }
  speakerbotWs = null
  connect()
}

function connect() {
  const url = configManager.getConfig().SPEAKERBOT_URL
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) { console.error('[TTS] URL inválida para Speaker.bot:', url); return }

  try {
    speakerbotWs = new WebSocket(url)
    speakerbotWs.on('open', () => {
      console.log('[TTS] ✅ Conectado a Speaker.bot')
      speakerbotActive = true
    })
    speakerbotWs.on('error', (err) => console.error('[TTS] Speaker.bot WS error:', err.message))
    speakerbotWs.on('close', () => {
      speakerbotActive = false
      console.warn('[TTS] ⚠ Speaker.bot desconectado, reconectando en 5s...')
      setTimeout(connect, 5000)
    })
  } catch (err) {
    console.error('[TTS] Error iniciando Speaker.bot WS:', err.message)
  }
}

function sendToSpeakerBot(text, user, voice) {
  const config = configManager.getConfig()
  const finalVoice = voice || config.VOICE_NAME
  if (speakerbotWs && speakerbotWs.readyState === WebSocket.OPEN) {
    try {
      speakerbotWs.send(JSON.stringify({
        request: 'Speak',
        id: `kick-tts-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        voice: finalVoice,
        message: text
      }))
      return true
    } catch (err) {
      console.error('[TTS] Error enviando a Speaker.bot:', err.message)
    }
  } else {
    console.warn('[TTS] Speaker.bot no conectado')
  }
  return false
}

initSpeakerbot()

module.exports = { initSpeakerbot, sendToSpeakerBot, getStatus }
