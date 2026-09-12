const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'chat-filter-data.json');

const DEFAULTS = {
  knownBots: [
    'streamlabs', 'nightbot', 'soundalerts', 'sound alerts',
    'botrix', 'kickbot', 'xposedbot', 'fossabot', 'staybot',
    'kickerbot', 'moobot', 'vborimer', 'grimvtbot',
  ],
  blockedCommands: [
    '!title', '!game', '!socials', '!discord', '!uptime',
    '!followage', '!subage', '!commands', '! merch', '!ruleta',
    '!raffle', '!giveaway', '!pls', '!rank', '!level', '!xp',
  ],
  bannedUsers: [],
  bannedWords: [],
  allowedCommands: ['!grim'],
  minMessageLength: 3,
  rateLimitMinIntervalMs: 8000,
  rateLimitMaxPerMinute: 4,
};

let cfg = { ...DEFAULTS };

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const saved = JSON.parse(raw);
    Object.assign(cfg, saved);
  } catch {}
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

loadConfig();

const EMOJI_ONLY_RE = /^[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\p{Emoji_Modifier_Base}\p{Emoji_Presentation}\u200d\ufe0f]+$/u;

function filterMessage(payload) {
  const content = (payload.content || '').trim();
  const sender = payload.sender;
  const lower = content.toLowerCase();

  if (!content) return { shouldProcess: false, reason: 'empty' };

  if (sender && cfg.knownBots.includes((sender.username || '').toLowerCase())) {
    return { shouldProcess: false, reason: 'known_bot' };
  }

  if (sender && cfg.bannedUsers.includes((sender.username || '').toLowerCase())) {
    return { shouldProcess: false, reason: 'banned_user' };
  }

  if (cfg.bannedWords.some(w => lower.includes(w.toLowerCase()))) {
    return { shouldProcess: false, reason: 'banned_word' };
  }

  if (cfg.allowedCommands.some(cmd => lower.startsWith(cmd))) {
    return { shouldProcess: true, reason: 'allowed_command' };
  }

  if (cfg.blockedCommands.some(cmd => lower.startsWith(cmd))) {
    return { shouldProcess: false, reason: 'blocked_command' };
  }

  if (lower.startsWith('!')) {
    return { shouldProcess: false, reason: 'unknown_command' };
  }

  if (content.length < cfg.minMessageLength) {
    return { shouldProcess: false, reason: 'too_short' };
  }

  if (EMOJI_ONLY_RE.test(content)) {
    return { shouldProcess: false, reason: 'emoji_only' };
  }

  return { shouldProcess: true, reason: 'passed' };
}

function cleanContent(content, emotes) {
  if (!emotes || !emotes.length) return content;
  return content.replace(/\[emote:\d+:[^\]]+\]/g, '').trim();
}

function getContextHint(payload) {
  const badges = (payload.sender && payload.sender.identity && payload.sender.identity.badges) || [];
  const hints = [];

  if (badges.some(b => b.type === 'moderator')) hints.push('MODERADOR');
  const sub = badges.find(b => b.type === 'subscriber');
  if (sub) hints.push('SUB (' + (sub.count || 1) + ' meses)');
  if (badges.some(b => b.type === 'sub_gifter')) hints.push('GIFTER');
  if (payload.sender && payload.broadcaster && payload.sender.user_id === payload.broadcaster.user_id) {
    hints.push('STREAMER');
  }

  return hints.length > 0 ? '[USUARIO: ' + hints.join(', ') + '] ' : '';
}

class BotRateLimiter {
  constructor(minIntervalMs, maxPerMinute) {
    this.minInterval = minIntervalMs || cfg.rateLimitMinIntervalMs;
    this.maxPerMinute = maxPerMinute || cfg.rateLimitMaxPerMinute;
    this.timestamps = [];
    this.lastResponse = 0;
  }

  canRespond() {
    const now = Date.now();
    if (now - this.lastResponse < this.minInterval) {
      return { allowed: false, reason: 'cooldown' };
    }
    this.timestamps = this.timestamps.filter(t => now - t < 60000);
    if (this.timestamps.length >= this.maxPerMinute) {
      return { allowed: false, reason: 'rate_limit' };
    }
    return { allowed: true };
  }

  recordResponse() {
    const now = Date.now();
    this.lastResponse = now;
    this.timestamps.push(now);
  }

  reset() {
    this.timestamps = [];
    this.lastResponse = 0;
  }
}

function updateConfig(newCfg) {
  Object.assign(cfg, newCfg);
  saveConfig();
}

function getConfig() {
  return { ...cfg };
}

module.exports = {
  filterMessage,
  cleanContent,
  getContextHint,
  BotRateLimiter,
  updateConfig,
  getConfig,
};
