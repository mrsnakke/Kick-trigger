const fs = require('fs');
const path = require('path');
const { loadSystemPrompt } = require('./config');
const { createDeepSeekClient } = require('./deepseek-client');
const { logMessage, getConversation } = require('./logger');
const eventBus = require('../../../lib/event-bus');
const sse = require('../../sse');
const chat = require('../../chat');

const CONFIG_PATH = path.join(__dirname, 'vtuber-data.json');
const { env } = process;

const defaults = {
  TEMPERATURE: parseFloat(env.VTUBER_TEMPERATURE || '1.3'),
    MAX_HISTORY_TURNS: parseInt(env.VTUBER_MAX_HISTORY || '5', 10),
    MAX_TOKENS: parseInt(env.VTUBER_MAX_TOKENS || '512', 10),
  VTUBER_NAME: env.VTUBER_NAME || 'Grim',
  COMMAND: (env.VTUBER_COMMAND || '!grim').toLowerCase()
};

let cfg = { ...defaults };
cfg.API_KEY = env.DEEPSEEK_API_KEY || env.VTUBER_API_KEY || '';

let deepseek = null;
let initialized = false;

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const saved = JSON.parse(raw);
    if (saved.API_KEY) cfg.API_KEY = saved.API_KEY;
  } catch {}
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ API_KEY: cfg.API_KEY }, null, 2), 'utf-8');
}

function getSystemPrompt() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('es-ES', { timeZone: 'America/Los_Angeles', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('es-ES', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
  return loadSystemPrompt().replace('{name}', cfg.VTUBER_NAME) +
    `\n\n## Fecha y hora actual\n\nHoy es ${dateStr} y son las ${timeStr} (Pacific Time).`;
}

function emitStatus() {
  sse.broadcast({
    _source: 'vtuber',
    type: 'vtuber:status',
    connected: !!(cfg.API_KEY && deepseek),
    apiKeySet: !!cfg.API_KEY
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

  await logMessage({ username, role: 'user', content });

  const history = await getConversation(username, cfg.MAX_HISTORY_TURNS);
  const messages = [
    { role: 'system', content: getSystemPrompt() },
    ...history.map(e => ({ role: e.role, content: e.content })),
    { role: 'user', content }
  ];

  try {
    const start = Date.now();
    const result = await deepseek.complete({
      messages, temperature: cfg.TEMPERATURE, maxTokens: cfg.MAX_TOKENS
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
    const maxLen = 500 - prefix.length
    const text = result.text.length > maxLen
      ? result.text.slice(0, maxLen - 3) + '...'
      : result.text
    if (text !== result.text) console.warn(`[VTUBER-AI] Respuesta truncada de ${result.text.length} a ${text.length} caracteres`)
    const chatSent = await sendChatMessage(prefix + text);
    console.log(`[VTUBER-AI] Chat ${chatSent ? 'enviado ✅' : 'falló ❌'}`);

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
    COMMAND: cfg.COMMAND
  });
}

function handleSaveConfig(req, res) {
  const { API_KEY } = req.body;
  if (API_KEY && typeof API_KEY === 'string' && API_KEY.trim()) {
    cfg.API_KEY = API_KEY.trim();
    saveConfig();
    // reinitialize deepseek client
    if (cfg.API_KEY) {
      deepseek = createDeepSeekClient(cfg.API_KEY);
      if (!eventBus.listenerCount('chat.message.sent')) {
        eventBus.on('chat.message.sent', onChatMessage);
      }
    }
    emitStatus();
    console.log('[VTUBER-AI] API key actualizada ✅');
    res.json({ ok: true, message: 'API key guardada' });
  } else {
    res.status(400).json({ ok: false, message: 'API key inválida' });
  }
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
      maxTokens: cfg.MAX_TOKENS
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
