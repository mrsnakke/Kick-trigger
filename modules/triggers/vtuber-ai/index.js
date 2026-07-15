const fs = require('fs');
const path = require('path');
const { loadSystemPrompt, setSystemPrompt, resetSystemPrompt } = require('./config');
const { createDeepSeekClient } = require('./deepseek-client');
const { logMessage, getConversation, clearConversation, clearAllConversations } = require('./logger');
const { VTubeClient } = require('./vtube-client');
const { VTubeModel } = require('./vtube-model');
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
  COMMAND: (env.VTUBER_COMMAND || '!grim').toLowerCase(),
  VTS_HOST: env.VTS_HOST || '192.168.1.119',
  VTS_PORT: parseInt(env.VTS_PORT || '8002', 10),
  VTS_PLUGIN_NAME: env.VTS_PLUGIN_NAME || 'GrimAI',
  VTS_PLUGIN_DEV: env.VTS_PLUGIN_DEV || 'MrsnakeVT',
  VTS_MODEL_NAME: env.VTS_MODEL_NAME || 'Grim',
  VTS_AUTO_CONNECT: env.VTS_AUTO_CONNECT !== 'false',
  MEMORY_ENABLED: env.VTUBER_MEMORY_ENABLED !== 'false'
};

let cfg = { ...defaults };
cfg.API_KEY = env.DEEPSEEK_API_KEY || env.VTUBER_API_KEY || '';
cfg.SEARCH_API_KEY = env.SEARCH_API_KEY || '';
cfg.SYSTEM_PROMPT_BASE = null;
cfg.SYSTEM_PROMPT_CUSTOM = null;

let deepseek = null;
let vtube = null;
let vtubeModel = null;
let initialized = false;

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const saved = JSON.parse(raw);
    if (saved.API_KEY) cfg.API_KEY = saved.API_KEY;
    if (saved.SEARCH_API_KEY) cfg.SEARCH_API_KEY = saved.SEARCH_API_KEY;
    if (saved.TEMPERATURE != null) cfg.TEMPERATURE = saved.TEMPERATURE;
    if (saved.MAX_TOKENS != null) cfg.MAX_TOKENS = saved.MAX_TOKENS;
    if (saved.MAX_HISTORY_TURNS != null) cfg.MAX_HISTORY_TURNS = saved.MAX_HISTORY_TURNS;
    if (saved.VTUBER_NAME) cfg.VTUBER_NAME = saved.VTUBER_NAME;
    if (saved.COMMAND) cfg.COMMAND = saved.COMMAND.toLowerCase();
    cfg.SYSTEM_PROMPT_BASE = saved.SYSTEM_PROMPT_BASE || null;
    if (saved.SYSTEM_PROMPT_BASE) setSystemPrompt(saved.SYSTEM_PROMPT_BASE);
    else resetSystemPrompt();
    cfg.SYSTEM_PROMPT_CUSTOM = saved.SYSTEM_PROMPT_CUSTOM || null;
    cfg.VTS_PROMPT = saved.VTS_PROMPT || null;
    if (saved.VTS_HOST) cfg.VTS_HOST = saved.VTS_HOST;
    if (saved.VTS_PORT != null) cfg.VTS_PORT = saved.VTS_PORT;
    if (saved.VTS_PLUGIN_NAME) cfg.VTS_PLUGIN_NAME = saved.VTS_PLUGIN_NAME;
    if (saved.VTS_PLUGIN_DEV) cfg.VTS_PLUGIN_DEV = saved.VTS_PLUGIN_DEV;
    if (saved.VTS_MODEL_NAME) cfg.VTS_MODEL_NAME = saved.VTS_MODEL_NAME;
    if (saved.VTS_AUTO_CONNECT != null) cfg.VTS_AUTO_CONNECT = saved.VTS_AUTO_CONNECT;
    if (saved.VTS_TOKEN) cfg.VTS_TOKEN = saved.VTS_TOKEN;
    if (saved.MEMORY_ENABLED != null) cfg.MEMORY_ENABLED = saved.MEMORY_ENABLED;
  } catch {}
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    API_KEY: cfg.API_KEY,
    SEARCH_API_KEY: cfg.SEARCH_API_KEY,
    TEMPERATURE: cfg.TEMPERATURE,
    MAX_TOKENS: cfg.MAX_TOKENS,
    MAX_HISTORY_TURNS: cfg.MAX_HISTORY_TURNS,
    VTUBER_NAME: cfg.VTUBER_NAME,
    COMMAND: cfg.COMMAND,
    SYSTEM_PROMPT_BASE: cfg.SYSTEM_PROMPT_BASE,
    SYSTEM_PROMPT_CUSTOM: cfg.SYSTEM_PROMPT_CUSTOM,
    VTS_HOST: cfg.VTS_HOST,
    VTS_PORT: cfg.VTS_PORT,
    VTS_PLUGIN_NAME: cfg.VTS_PLUGIN_NAME,
    VTS_PLUGIN_DEV: cfg.VTS_PLUGIN_DEV,
    VTS_MODEL_NAME: cfg.VTS_MODEL_NAME,
    VTS_AUTO_CONNECT: cfg.VTS_AUTO_CONNECT,
    VTS_TOKEN: cfg.VTS_TOKEN,
    VTS_PROMPT: cfg.VTS_PROMPT,
    MEMORY_ENABLED: cfg.MEMORY_ENABLED,
  }, null, 2), 'utf-8');
}

function getSystemPrompt() {
  const base = loadSystemPrompt()
    .replace('{name}', cfg.VTUBER_NAME);
  const custom = cfg.SYSTEM_PROMPT_CUSTOM || '';
  const vts = cfg.VTS_PROMPT || '';
  return (base + (custom ? '\n\n' + custom : '') + (vts ? '\n\n' + vts : ''))
    + '\n\nIMPORTANTE: Si no sabes la respuesta o necesitas información actualizada, usa la herramienta web_search para buscar en internet antes de responder. Si necesitas saber la fecha y hora actual, usa la herramienta get_current_time.';
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
    name: cfg.VTUBER_NAME,
    vtsConnected: vtube ? vtube.connected : false,
    vtsAuthenticated: vtube ? vtube.authenticated : false
  });
}

function initVTS() {
  // If vtube exists and is still alive, skip
  if (vtube?.connected && vtube?.authenticated) return;
  // Kill stale client before re-creating
  if (vtube) { vtube.disconnect(); vtube = null; }
  try {
    vtubeModel = new VTubeModel(cfg.VTS_MODEL_NAME, path.join(__dirname, 'model_dict.json'));
    vtube = new VTubeClient({
      host: cfg.VTS_HOST,
      port: cfg.VTS_PORT,
      pluginName: cfg.VTS_PLUGIN_NAME,
      pluginDeveloper: cfg.VTS_PLUGIN_DEV,
      token: cfg.VTS_TOKEN || null,
    });
    vtube.on('connected', () => {
      console.log('[VTUBER-AI] VTube Studio conectado ✅');
      emitStatus();
    });
    vtube.on('token', (token) => {
      cfg.VTS_TOKEN = token;
      saveConfig();
      console.log('[VTUBER-AI] Token VTS guardado');
    });
    vtube.on('authenticated', () => {
      console.log('[VTUBER-AI] VTube Studio autenticado ✅');
      emitStatus();
    });
    vtube.on('disconnected', () => {
      console.warn('[VTUBER-AI] VTube Studio desconectado');
      emitStatus();
    });
    vtube.on('error', (msg) => {
      console.error('[VTUBER-AI] VTS error:', msg);
    });
    vtube.connect();
    startVTSPoller();
  } catch (e) {
    console.warn('[VTUBER-AI] Error iniciando VTS:', e.message);
  }
}

// ponytail: periodic VTS reconnection poll — retries every 15s if not connected/authd
let _vtsPoller = null;
function startVTSPoller() {
  if (_vtsPoller) return;
  _vtsPoller = setInterval(() => {
    if (!vtube?.connected || !vtube?.authenticated) {
      initVTS();
    }
  }, 15000);
}

let _vtsExprTimer = null;

async function deactivateAllExpressions() {
  if (!vtube?.authenticated) return;
  try {
    const r = await vtube.getExpressionState();
    if (r.data?.expressions) {
      for (const ex of r.data.expressions) {
        if (ex.active) await vtube.setExpression(ex.file, false, 0.2);
      }
    }
  } catch {}
}

async function triggerVTSExpression(emotion, tempMs = 4000) {
  if (!vtube || !vtube.authenticated || !vtubeModel) return false;
  const file = vtubeModel.expressionFile(emotion);
  if (!file) return false;
  try {
    clearTimeout(_vtsExprTimer);
    await deactivateAllExpressions();
    await vtube.setExpression(file, true, 0.3);
    _vtsExprTimer = setTimeout(() => {
      vtube.setExpression(file, false, 0.3).catch(() => {});
    }, tempMs);
    return true;
  } catch {}
  return false;
}

function init() {
  if (initialized) return;
  initialized = true;

  loadConfig();

  if (cfg.VTS_AUTO_CONNECT) initVTS();

  if (!cfg.API_KEY) {
    console.warn('[VTUBER-AI] DEEPSEEK_API_KEY no configurada. Módulo desactivado.');
    emitStatus();
    return;
  }

  deepseek = createDeepSeekClient(cfg.API_KEY, cfg.SEARCH_API_KEY);
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

  const history = cfg.MEMORY_ENABLED ? await getConversation(username, cfg.MAX_HISTORY_TURNS) : [];
  const messages = [
    { role: 'system', content: getSystemPrompt() },
    ...history.map(e => ({
      role: e.role,
      content: e.role === 'user' ? `${e.username}: ${e.content}` : e.content
    })),
    { role: 'user', content: `${username}: ${content}` }
  ];

  if (cfg.MEMORY_ENABLED) await logMessage({ username, role: 'user', content });

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

    if (cfg.MEMORY_ENABLED) await logMessage({ username, role: 'assistant', content: result.text });

    // Extract emotions for VTS and clean text
    let displayText = result.text
    if (vtubeModel) {
      const emotions = vtubeModel.extractEmotion(result.text)
      if (emotions.length) {
        console.log(`[VTUBER-AI] Emociones detectadas: ${emotions.join(', ')}`)
        for (const em of emotions) {
          await triggerVTSExpression(em)
          await new Promise(r => setTimeout(r, 100))
        }
      }
      displayText = vtubeModel.removeEmotion(result.text) || result.text
    }

    const maxLen = 400
    const chunks = []
    for (let i = 0; i < displayText.length; ) {
      if (i + maxLen >= displayText.length) {
        chunks.push(displayText.slice(i))
        break
      }
      let end = displayText.lastIndexOf(' ', i + maxLen)
      if (end <= i) end = i + maxLen
      chunks.push(displayText.slice(i, end))
      i = end + 1
    }
    if (chunks.length > 1) console.warn(`[VTUBER-AI] Respuesta larga (${displayText.length} chars), dividiendo en ${chunks.length} mensajes`)
    let chatSent = false
    for (const chunk of chunks) {
      const sent = await sendChatMessage(chunk)
      if (sent) chatSent = true
      else break
    }
    console.log(`[VTUBER-AI] Chat ${chatSent ? 'enviado ✅' : 'falló ❌'} (${chunks.length} parte(s))`);

    // Speak via TTS2 with Dalia voice directly
    if (chatSent) {
      eventBus.emit('tts2:speak', { text: displayText, voice: '24', origin: 'bot' })
    }

    return { ok: true, text: displayText, usage: result.usage, chatSent };
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
    command: cfg.COMMAND,
    vtsConnected: vtube ? vtube.connected : false,
    vtsAuthenticated: vtube ? vtube.authenticated : false,
    vtsHost: cfg.VTS_HOST,
    vtsPort: cfg.VTS_PORT
  });
}

function handleGetConfig(req, res) {
  res.json({
    API_KEY: cfg.API_KEY ? '****' : '',
    API_KEY_SET: !!cfg.API_KEY,
    SEARCH_API_KEY: cfg.SEARCH_API_KEY ? '****' : '',
    SEARCH_API_KEY_SET: !!cfg.SEARCH_API_KEY,
    TEMPERATURE: cfg.TEMPERATURE,
    MAX_HISTORY_TURNS: cfg.MAX_HISTORY_TURNS,
    MAX_TOKENS: cfg.MAX_TOKENS,
    VTUBER_NAME: cfg.VTUBER_NAME,
    COMMAND: cfg.COMMAND,
    SYSTEM_PROMPT_BASE: loadSystemPrompt(),
    SYSTEM_PROMPT_CUSTOM: cfg.SYSTEM_PROMPT_CUSTOM,
    VTS_HOST: cfg.VTS_HOST,
    VTS_PORT: cfg.VTS_PORT,
    VTS_PLUGIN_NAME: cfg.VTS_PLUGIN_NAME,
    VTS_PLUGIN_DEV: cfg.VTS_PLUGIN_DEV,
    VTS_MODEL_NAME: cfg.VTS_MODEL_NAME,
    VTS_AUTO_CONNECT: cfg.VTS_AUTO_CONNECT,
    VTS_PROMPT: cfg.VTS_PROMPT || '',
    MEMORY_ENABLED: cfg.MEMORY_ENABLED,
  });
}

function handleSaveConfig(req, res) {
  const { API_KEY, SEARCH_API_KEY, TEMPERATURE, MAX_TOKENS, MAX_HISTORY_TURNS, VTUBER_NAME, COMMAND, SYSTEM_PROMPT_BASE, SYSTEM_PROMPT_CUSTOM, VTS_HOST, VTS_PORT, VTS_PLUGIN_NAME, VTS_PLUGIN_DEV, VTS_MODEL_NAME, VTS_AUTO_CONNECT, VTS_TOKEN, MEMORY_ENABLED } = req.body;

  if (API_KEY && typeof API_KEY === 'string' && API_KEY.trim()) {
    cfg.API_KEY = API_KEY.trim();
    if (cfg.API_KEY) {
      deepseek = createDeepSeekClient(cfg.API_KEY, cfg.SEARCH_API_KEY);
      if (!eventBus.listenerCount('chat.message.sent')) {
        eventBus.on('chat.message.sent', onChatMessage);
      }
    }
  }

  if (SEARCH_API_KEY !== undefined) cfg.SEARCH_API_KEY = SEARCH_API_KEY;

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

  if (VTS_HOST) cfg.VTS_HOST = VTS_HOST;
  if (VTS_PORT != null) cfg.VTS_PORT = parseInt(VTS_PORT, 10);
  if (VTS_PLUGIN_NAME) cfg.VTS_PLUGIN_NAME = VTS_PLUGIN_NAME;
  if (VTS_PLUGIN_DEV) cfg.VTS_PLUGIN_DEV = VTS_PLUGIN_DEV;
  if (VTS_MODEL_NAME) cfg.VTS_MODEL_NAME = VTS_MODEL_NAME;
  if (VTS_AUTO_CONNECT != null) cfg.VTS_AUTO_CONNECT = !!VTS_AUTO_CONNECT;
  if (VTS_TOKEN) cfg.VTS_TOKEN = VTS_TOKEN;
  if (MEMORY_ENABLED != null) cfg.MEMORY_ENABLED = !!MEMORY_ENABLED;
  // Re-init VTS if settings changed
  if (VTS_AUTO_CONNECT || VTS_HOST || VTS_PORT || VTS_PLUGIN_NAME || VTS_PLUGIN_DEV || VTS_TOKEN) {
    if (vtube) { vtube.disconnect(); vtube = null; }
    if (cfg.VTS_AUTO_CONNECT) initVTS();
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

    let displayText = result.text;
    if (vtubeModel) {
      const emotions = vtubeModel.extractEmotion(result.text);
      if (emotions.length) {
        for (const em of emotions) {
          await triggerVTSExpression(em);
          await new Promise(r => setTimeout(r, 100));
        }
      }
      displayText = vtubeModel.removeEmotion(result.text) || result.text;
    }

    const chatSent = await sendChatMessage(displayText);
    if (chatSent) {
      eventBus.emit('tts2:speak', { text: displayText, voice: '24', origin: 'bot' })
    }

    res.json({
      ok: true,
      text: displayText,
      usage: result.usage,
      elapsed,
      chatSent
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

// -- VTS HTTP handlers --

function handleVTSConnect(req, res) {
  if (!vtube || vtube.connected) {
    return res.json({ ok: true, connected: vtube ? vtube.connected : false });
  }
  vtube.connect();
  res.json({ ok: true, message: 'Conectando...' });
}

function handleVTSDisconnect(req, res) {
  if (vtube) vtube.disconnect();
  res.json({ ok: true, message: 'Desconectado' });
}

function handleVTSStatus(req, res) {
  res.json({
    connected: vtube ? vtube.connected : false,
    authenticated: vtube ? vtube.authenticated : false,
    host: cfg.VTS_HOST,
    port: cfg.VTS_PORT,
    pluginName: cfg.VTS_PLUGIN_NAME,
    modelName: cfg.VTS_MODEL_NAME,
  });
}

async function handleVTSExpression(req, res) {
  const { emotion, active, fadeTime } = req.body || {};
  if (!emotion) return res.status(400).json({ ok: false, message: 'emotion requerida' });
  if (!vtube || !vtube.authenticated) return res.status(400).json({ ok: false, message: 'VTS no conectado' });
  const file = vtubeModel ? vtubeModel.expressionFile(emotion) : emotion;
  if (!file) return res.status(400).json({ ok: false, message: `Emoción "${emotion}" no mapeada` });
  try {
    await vtube.setExpression(file, active !== false, fadeTime || 0.3);
    res.json({ ok: true, emotion, file, active: active !== false });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
}

async function handleVTSHotkey(req, res) {
  const { hotkeyID } = req.body || {};
  if (!hotkeyID) return res.status(400).json({ ok: false, message: 'hotkeyID requerida' });
  if (!vtube || !vtube.authenticated) return res.status(400).json({ ok: false, message: 'VTS no conectado' });
  try {
    await vtube.triggerHotkey(hotkeyID);
    res.json({ ok: true, hotkeyID });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
}

async function handleClearMemory(req, res) {
  const { username } = req.body || {};
  try {
    if (username) {
      await clearConversation(username);
      console.log(`[VTUBER-AI] Memoria limpiada para ${username}`);
    } else {
      await clearAllConversations();
      console.log('[VTUBER-AI] Memoria global limpiada');
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
}

async function handleVTSParams(req, res) {
  if (!vtube || !vtube.authenticated) return res.status(400).json({ ok: false, message: 'VTS no conectado' });
  try {
    const r = await vtube.getParameterList();
    res.json({ ok: true, params: r.data?.parameterList || [] });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
}

async function handleVTSInjectParam(req, res) {
  const { name, value } = req.body || {};
  if (!name || value == null) return res.status(400).json({ ok: false, message: 'name y value requeridos' });
  if (!vtube || !vtube.authenticated) return res.status(400).json({ ok: false, message: 'VTS no conectado' });
  try {
    await vtube.injectParameters([{ name, value: parseFloat(value) }]);
    res.json({ ok: true, name, value: parseFloat(value) });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
}

// -- Shutdown --

function shutdown() {
  initialized = false;
  if (vtube) { vtube.disconnect(); vtube = null; }
  console.log('[VTUBER-AI] Apagado');
}

init();

module.exports = {
  processMessage, shutdown,
  handleGetStatus, handleGetConfig, handleSaveConfig, handleTest,
  handleVTSConnect, handleVTSDisconnect, handleVTSStatus,
  handleVTSExpression, handleVTSHotkey,
  handleVTSParams, handleVTSInjectParam,
  handleClearMemory,
};
