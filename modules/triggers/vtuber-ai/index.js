const fs = require('fs');
const path = require('path');
const { loadSystemPrompt, setSystemPrompt, resetSystemPrompt } = require('./config');
const { createDeepSeekClient } = require('./deepseek-client');
const { logMessage, getConversation } = require('./logger');
const eventBus = require('../../../lib/event-bus');
const sse = require('../../sse');
const chat = require('../../chat');

const CONFIG_PATH = path.join(__dirname, 'vtuber-data.json');
const { env } = process;

const defaults = {
  TEMPERATURE: parseFloat(env.VTUBER_TEMPERATURE || '1.0'),
  MAX_HISTORY_TURNS: parseInt(env.VTUBER_MAX_HISTORY || '5', 10),
  MAX_TOKENS: parseInt(env.VTUBER_MAX_TOKENS || '500', 10),
  VTUBER_NAME: env.VTUBER_NAME || 'Grim',
  COMMAND: (env.VTUBER_COMMAND || '!grim').toLowerCase()
};

let cfg = { ...defaults };
cfg.API_KEY = env.DEEPSEEK_API_KEY || env.VTUBER_API_KEY || '';
cfg.SYSTEM_PROMPT_BASE = null;
cfg.SYSTEM_PROMPT_CUSTOM = null;

let deepseek = null;
let initialized = false;

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const saved = JSON.parse(raw);
    if (saved.API_KEY) cfg.API_KEY = saved.API_KEY;
    if (saved.TEMPERATURE != null) cfg.TEMPERATURE = saved.TEMPERATURE;
    if (saved.MAX_TOKENS != null) cfg.MAX_TOKENS = saved.MAX_TOKENS;
    if (saved.MAX_HISTORY_TURNS != null) cfg.MAX_HISTORY_TURNS = saved.MAX_HISTORY_TURNS;
    if (saved.VTUBER_NAME) cfg.VTUBER_NAME = saved.VTUBER_NAME;
    if (saved.COMMAND) cfg.COMMAND = saved.COMMAND.toLowerCase();
    cfg.SYSTEM_PROMPT_BASE = saved.SYSTEM_PROMPT_BASE || null;
    if (saved.SYSTEM_PROMPT_BASE) setSystemPrompt(saved.SYSTEM_PROMPT_BASE);
    else resetSystemPrompt();
    cfg.SYSTEM_PROMPT_CUSTOM = saved.SYSTEM_PROMPT_CUSTOM || null;
  } catch {}
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    API_KEY: cfg.API_KEY,
    TEMPERATURE: cfg.TEMPERATURE,
    MAX_TOKENS: cfg.MAX_TOKENS,
    MAX_HISTORY_TURNS: cfg.MAX_HISTORY_TURNS,
    VTUBER_NAME: cfg.VTUBER_NAME,
    COMMAND: cfg.COMMAND,
    SYSTEM_PROMPT_BASE: cfg.SYSTEM_PROMPT_BASE,
    SYSTEM_PROMPT_CUSTOM: cfg.SYSTEM_PROMPT_CUSTOM
  }, null, 2), 'utf-8');
}

function getSystemPrompt() {
  const base = loadSystemPrompt()
    .replace('{name}', cfg.VTUBER_NAME);
  const custom = cfg.SYSTEM_PROMPT_CUSTOM || '';
  return base + (custom ? '\n\n' + custom : '');
}

function sanitizeUserId(name) {
  return name.replace(/[^a-zA-Z0-9\-_]/g, '_').slice(0, 512);
}

function emitStatus() {
  sse.broadcast({
    _source: 'vtuber',
    type: 'vtuber:status',
    connected: !!(cfg.API_KEY && deepseek),
    apiKeySet: !!cfg.API_KEY,
    command: cfg.COMMAND,
    name: cfg.VTUBER_NAME
  });
}

function init() {
  if (initialized) return;
  initialized = true;

  loadConfig();

  if (!cfg.API_KEY) {
    console.warn('[VTUBER-AI] DEEPSEEK_API_KEY no configurada. Módulo desactivado.');
    emitStatus();
    return;
  }

  deepseek = createDeepSeekClient(cfg.API_KEY);
  eventBus.on('chat.message.sent', onChatMessage);
  console.log('[VTUBER-AI] Módulo VTuber cargado ✅');
  emitStatus();
}

async function sendChatMessage(content) {
  try {
    const data = await chat.sendAsBot(content)
    if (data.data?.is_sent) return true
    console.error('[VTUBER-AI] Kick API rechazó el mensaje:', JSON.stringify(data))
    return false
  } catch (err) {
    console.error('[VTUBER-AI] Error enviando chat:', err.message)
    return false
  }
}

async function processMessage(username, content) {
  if (!deepseek) return { error: 'No inicializado' };

  console.log(`[VTUBER-AI] ${username}: ${content}`);

  const history = await getConversation(username, cfg.MAX_HISTORY_TURNS);
  const messages = [
    { role: 'system', content: getSystemPrompt() },
    ...history.map(e => ({
      role: e.role,
      content: e.role === 'user' ? `${e.username}: ${e.content}` : e.content
    })),
    { role: 'user', content: `${username}: ${content}` }
  ];

  await logMessage({ username, role: 'user', content });

  try {
    const start = Date.now();
    const result = await deepseek.complete({
      messages, temperature: cfg.TEMPERATURE, maxTokens: cfg.MAX_TOKENS, userId: sanitizeUserId(username)
    });
    const elapsed = Date.now() - start;

    const promptMiss = Math.max(0, result.usage.prompt - result.usage.cacheHit);
    const cost = (result.usage.cacheHit * 0.0028 + promptMiss * 0.14 + result.usage.completion * 0.28) / 1_000_000;
    console.log(
      `[VTUBER-AI] ✅ ${result.usage.total} tokens ` +
      `(prompt:${result.usage.prompt}, completion:${result.usage.completion}, ` +
      `cache_hit:${result.usage.cacheHit}) en ${elapsed}ms ` +
      `~$${cost.toFixed(6)}`
    );

    await logMessage({ username, role: 'assistant', content: result.text });

    const prefix = '!sp '
    const maxLen = 400 - prefix.length
    const text = result.text
    const chunks = []
    for (let i = 0; i < text.length; ) {
      if (i + maxLen >= text.length) {
        chunks.push(text.slice(i))
        break
      }
      let end = text.lastIndexOf(' ', i + maxLen)
      if (end <= i) end = i + maxLen
      chunks.push(text.slice(i, end))
      i = end + 1
    }
    // ponytail: naive slice replaced with word-boundary split; words >397 chars still hard-cut
    if (chunks.length > 1) console.warn(`[VTUBER-AI] Respuesta larga (${text.length} chars), dividiendo en ${chunks.length} mensajes`)
    let chatSent = false
    for (const chunk of chunks) {
      const sent = await sendChatMessage(prefix + chunk)
      if (sent) chatSent = true
      else break
    }
    console.log(`[VTUBER-AI] Chat ${chatSent ? 'enviado ✅' : 'falló ❌'} (${chunks.length} parte(s))`);

    return { ok: true, text: result.text, usage: result.usage, chatSent };
  } catch (err) {
    console.error('[VTUBER-AI] Error:', err.message);
    return { error: err.message };
  }
}

async function onChatMessage(data) {
  const { payload } = data;
  const content = (payload.content || '').trim();
  if (!content.toLowerCase().startsWith(cfg.COMMAND)) return;
  const message = content.slice(cfg.COMMAND.length).trim();
  if (!message.length) return;
  await processMessage(payload.sender?.username || 'anon', message);
}

// -- HTTP handlers --

function handleGetStatus(req, res) {
  res.json({
    connected: !!(cfg.API_KEY && deepseek),
    apiKeySet: !!cfg.API_KEY,
    command: cfg.COMMAND
  });
}

function handleGetConfig(req, res) {
  res.json({
    API_KEY: cfg.API_KEY ? '****' : '',
    API_KEY_SET: !!cfg.API_KEY,
    TEMPERATURE: cfg.TEMPERATURE,
    MAX_HISTORY_TURNS: cfg.MAX_HISTORY_TURNS,
    MAX_TOKENS: cfg.MAX_TOKENS,
    VTUBER_NAME: cfg.VTUBER_NAME,
    COMMAND: cfg.COMMAND,
    SYSTEM_PROMPT_BASE: loadSystemPrompt(),
    SYSTEM_PROMPT_CUSTOM: cfg.SYSTEM_PROMPT_CUSTOM
  });
}

function handleSaveConfig(req, res) {
  const { API_KEY, TEMPERATURE, MAX_TOKENS, MAX_HISTORY_TURNS, VTUBER_NAME, COMMAND, SYSTEM_PROMPT_BASE, SYSTEM_PROMPT_CUSTOM } = req.body;

  if (API_KEY && typeof API_KEY === 'string' && API_KEY.trim()) {
    cfg.API_KEY = API_KEY.trim();
    if (cfg.API_KEY) {
      deepseek = createDeepSeekClient(cfg.API_KEY);
      if (!eventBus.listenerCount('chat.message.sent')) {
        eventBus.on('chat.message.sent', onChatMessage);
      }
    }
  }

  if (TEMPERATURE != null) cfg.TEMPERATURE = parseFloat(TEMPERATURE);
  if (MAX_TOKENS != null) cfg.MAX_TOKENS = parseInt(MAX_TOKENS, 10);
  if (MAX_HISTORY_TURNS != null) cfg.MAX_HISTORY_TURNS = parseInt(MAX_HISTORY_TURNS, 10);
  if (VTUBER_NAME) cfg.VTUBER_NAME = VTUBER_NAME;
  if (COMMAND) cfg.COMMAND = COMMAND.toLowerCase().trim();

  if (SYSTEM_PROMPT_BASE !== undefined) {
    cfg.SYSTEM_PROMPT_BASE = SYSTEM_PROMPT_BASE || null;
    if (cfg.SYSTEM_PROMPT_BASE) setSystemPrompt(cfg.SYSTEM_PROMPT_BASE);
    else resetSystemPrompt();
  }

  if (SYSTEM_PROMPT_CUSTOM !== undefined) {
    cfg.SYSTEM_PROMPT_CUSTOM = SYSTEM_PROMPT_CUSTOM || null;
  }

  saveConfig();
  emitStatus();
  console.log('[VTUBER-AI] Configuración guardada ✅');
  res.json({ ok: true, message: 'Configuración guardada' });
}

async function handleTest(req, res) {
  if (!deepseek) {
    return res.status(400).json({ ok: false, message: 'Configura una API key primero' });
  }
  const content = req.body?.content || 'Hola!';
  try {
    const start = Date.now();
    const result = await deepseek.complete({
      messages: [
        { role: 'system', content: getSystemPrompt() },
        { role: 'user', content }
      ],
      temperature: cfg.TEMPERATURE,
      maxTokens: cfg.MAX_TOKENS,
      userId: 'test'
    });
    const elapsed = Date.now() - start;

    const chatSent = await sendChatMessage(result.text);

    res.json({
      ok: true,
      text: result.text,
      usage: result.usage,
      elapsed,
      chatSent
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

function shutdown() {
  initialized = false;
  console.log('[VTUBER-AI] Apagado');
}

init();

module.exports = { processMessage, shutdown, handleGetStatus, handleGetConfig, handleSaveConfig, handleTest };
