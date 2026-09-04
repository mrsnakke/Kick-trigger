const fs = require('fs')
const path = require('path')

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'chatwidget-config.json')

const DEFAULTS = {
  layoutMode: 'alternating',
  chatDirection: 'up',
  maxMessages: 15,
  messageSpacing: 14,
  chatWidth: 440,
  bubblePadding: 'normal',
  showAvatar: true,
  avatarShape: 'circle',
  avatarSize: 48,
  avatarDefaultType: 'bottts',
  avatarDefaultCustomUrl: '',
  glowStyle: 'kick_green',
  glowCustomColor: '#53fc18',
  glowIntensity: 'vibrant',
  avatarBorderWidth: 2,
  avatarOverlap: true,
  presetTheme: 'cyberpunk_glow',
  backgroundColor: '#1b0d26',
  backgroundOpacity: 85,
  borderColor: '#831843',
  borderOpacity: 50,
  borderWidth: 1,
  borderRadius: 18,
  backdropBlur: true,
  bubbleShadow: true,
  accentGlow: true,
  fontFamily: 'Poppins',
  fontSize: 15,
  usernameSize: 15,
  textContrastOutline: true,
  customUsernameColor: false,
  defaultUsernameColor: '#f43f5e',
  messageTextColor: '#f8fafc',
  entryAnimation: 'spring_pop',
  animationSpeed: 0.38,
  autoHide: false,
  autoHideDuration: 12,
  exitAnimation: 'fade',
  emoteBounce: true,
  emoteCustomSize: 28,
  emoteHoverAnim: 'bounce',
  emotePhysicsEnabled: true,
  emotePhysicsMode: 'bounce',
  emotePhysicsGravity: 0.6,
  emotePhysicsCount: 6,
  emotePhysicsSize: 42,
  soundEnabled: true,
  soundType: 'bubble',
  soundVolume: 50,
  showBadges: true,
  showTimestamp: false,
  hideStreamerMessages: false,
  botExclusionEnabled: true,
  ignoredBots: ['Botrix','KickBot','Nightbot','StreamElements','LiveBot','Moobot','Wizebot','CozyBot','Stay_Hydrated_Bot'],
  ignoreBotPrefixes: false,
  alertsEnabled: true,
  alertSubscriptions: true,
  alertGiftedSubs: true,
  alertFollowers: true,
  alertRaids: true,
  alertKickGifts: true,
  alertDuration: 6,
  alertSound: true,
  alertSoundVolume: 65,
  alertStyle: 'kick_green',
  alertPosition: 'bottom',
  seventvEnabled: true,
  seventvUserId: '01GJ7PS7DR000CQ2WDRACYQ5EH',
  seventvEmoteSetId: '01GJ7Q9840000CQ2WDRACYQ5FE',
  seventvIncludeGlobal: true,
  seventvEmoteSize: 'medium',
  seventvZeroWidth: true,
  showTimestamp: false
}

const THEME_PRESETS = {
  cyberpunk_glow: { presetTheme: 'cyberpunk_glow', backgroundColor: '#190a24', backgroundOpacity: 88, borderColor: '#db2777', borderOpacity: 55, borderWidth: 1, borderRadius: 18, glowStyle: 'neon_pink', glowIntensity: 'vibrant', avatarShape: 'circle', avatarOverlap: true, fontFamily: 'Poppins', textContrastOutline: true },
  midnight_purple: { presetTheme: 'midnight_purple', backgroundColor: '#0c071d', backgroundOpacity: 90, borderColor: '#7c3aed', borderOpacity: 60, borderWidth: 1, borderRadius: 16, glowStyle: 'neon_purple', glowIntensity: 'medium', avatarShape: 'circle', avatarOverlap: true, fontFamily: 'Outfit', textContrastOutline: true },
  obsidian_dark: { presetTheme: 'obsidian_dark', backgroundColor: '#09090b', backgroundOpacity: 94, borderColor: '#27272a', borderOpacity: 80, borderWidth: 1, borderRadius: 14, glowStyle: 'cyber_cyan', glowIntensity: 'soft', avatarShape: 'squircle', avatarOverlap: false, fontFamily: 'Inter', textContrastOutline: true },
  frosted_glass: { presetTheme: 'frosted_glass', backgroundColor: '#18181b', backgroundOpacity: 45, borderColor: '#ffffff', borderOpacity: 25, borderWidth: 1, borderRadius: 22, glowStyle: 'cyber_cyan', glowIntensity: 'vibrant', avatarShape: 'circle', avatarOverlap: true, fontFamily: 'Nunito', textContrastOutline: true },
  rainbow_streamer: { presetTheme: 'rainbow_streamer', backgroundColor: '#110d22', backgroundOpacity: 85, borderColor: '#a855f7', borderOpacity: 70, borderWidth: 2, borderRadius: 18, glowStyle: 'rainbow_rgb', glowIntensity: 'pulse', avatarShape: 'circle', avatarOverlap: true, fontFamily: 'Fredoka', textContrastOutline: true },
  clean_minimal: { presetTheme: 'clean_minimal', backgroundColor: '#000000', backgroundOpacity: 35, borderColor: '#ffffff', borderOpacity: 15, borderWidth: 1, borderRadius: 10, glowStyle: 'none', glowIntensity: 'soft', avatarShape: 'circle', avatarOverlap: false, fontFamily: 'Inter', textContrastOutline: true },
  mrsnakevt_green: { presetTheme: 'mrsnakevt_green', backgroundColor: '#0d1117', backgroundOpacity: 92, borderColor: '#53fc18', borderOpacity: 40, borderWidth: 1, borderRadius: 14, glowStyle: 'kick_green', glowIntensity: 'vibrant', avatarShape: 'circle', avatarOverlap: true, fontFamily: 'Inter', textContrastOutline: true }
}

let cfg = { ...DEFAULTS }

function load() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
      cfg = { ...DEFAULTS, ...JSON.parse(raw) }
    }
  } catch {}
}

function save() {
  try {
    const dir = path.dirname(CONFIG_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
  } catch {}
}

function getConfig() { return { ...cfg } }
function updateConfig(patch) { cfg = { ...cfg, ...patch }; save() }
function getDefaults() { return { ...DEFAULTS } }
function getThemes() { return THEME_PRESETS }

function handleGet(_req, res) { res.json({ config: getConfig(), themes: getThemes(), defaults: getDefaults() }) }
function handlePost(req, res) {
  if (req.body && typeof req.body === 'object') {
    updateConfig(req.body)
    res.json({ ok: true, config: getConfig() })
  } else {
    res.status(400).json({ error: 'JSON body required' })
  }
}

module.exports = { load, save, getConfig, updateConfig, getDefaults, getThemes, handleGet, handlePost }
