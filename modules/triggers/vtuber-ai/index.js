const fs = require('fs');
const path = require('path');
const { loadSystemPrompt, setSystemPrompt, resetSystemPrompt } = require('./config');
const { createDeepSeekClient } = require('./deepseek-client');
const { VTubeClient } = require('./vtube-client');
const { VTubeModel } = require('./vtube-model');
const { GrimMemory } = require('./memory');
const { filterMessage, BotRateLimiter, updateConfig: updateFilterConfig, getConfig: getFilterConfig } = require('./chat-filter');
const { TopicManager } = require('./topics');
const { MoodSystem } = require('./mood');
const { getEventResponse } = require('./event-responses');
const { filterResponse } = require('./response-filter');
const eventBus = require('../../../lib/event-bus');
const sse = require('../../sse');
const chat = require('../../chat');

const CONFIG_PATH = path.join(__dirname, 'vtuber-data.json');
const { env } = process;

const defaults = {
  TEMPERATURE: parseFloat(env.VTUBER_TEMPERATURE || '1.0'),
  MAX_HISTORY_TURNS: parseInt(env.VTUBER_MAX_HISTORY || '15', 10),
  MAX_TOKENS: parseInt(env.VTUBER_MAX_TOKENS || '500', 10),
  VTUBER_NAME: env.VTUBER_NAME || 'Grim',
  COMMAND: (env.VTUBER_COMMAND || '!grim').toLowerCase(),
  VTS_HOST: env.VTS_HOST || '192.168.1.119',
  VTS_PORT: parseInt(env.VTS_PORT || '8002', 10),
  VTS_PLUGIN_NAME: env.VTS_PLUGIN_NAME || 'GrimAI',
  VTS_PLUGIN_DEV: env.VTS_PLUGIN_DEV || 'MrsnakeVT',
  VTS_MODEL_NAME: env.VTS_MODEL_NAME || 'Grim',
  VTS_AUTO_CONNECT: env.VTS_AUTO_CONNECT !== 'false',
  MEMORY_ENABLED: env.VTUBER_MEMORY_ENABLED !== 'false',
  MOOD_ENABLED: true,
  TOPICS_ENABLED: true,
  RESPONSE_FILTER_ENABLED: true,
};

let cfg = { ...defaults };
cfg.API_KEY = env.DEEPSEEK_API_KEY || env.VTUBER_API_KEY || '';
cfg.SEARCH_API_KEY = env.SEARCH_API_KEY || '';
cfg.SYSTEM_PROMPT_BASE = null;
cfg.SYSTEM_PROMPT_CUSTOM = null;

let deepseek = null;
let vtube = null;
let vtubeModel = null;
let memory = null;
let topicManager = null;
let moodSystem = null;
let rateLimiter = null;
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
    if (saved.MOOD_ENABLED != null) cfg.MOOD_ENABLED = saved.MOOD_ENABLED;
    if (saved.TOPICS_ENABLED != null) cfg.TOPICS_ENABLED = saved.TOPICS_ENABLED;
    if (saved.RESPONSE_FILTER_ENABLED != null) cfg.RESPONSE_FILTER_ENABLED = saved.RESPONSE_FILTER_ENABLED;
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
    MOOD_ENABLED: cfg.MOOD_ENABLED,
    TOPICS_ENABLED: cfg.TOPICS_ENABLED,
    RESPONSE_FILTER_ENABLED: cfg.RESPONSE_FILTER_ENABLED,
  }, null, 2), 'utf-8');
}

const VISION_HINT = /mira la pantalla|miren la pantalla|ves la pantalla|vean la pantalla|ves eso|ves esa|vean eso|que ves|que estas viendo|que está pasando|que esta pasando|screenshot|captura de pantalla|como me veo|como se ve mi modelo|mira el juego|mira como juego|mira como voy|mira la partida/i;

const VISION_TAG = '\n\n[PERCEPCIÓN VISUAL: El usuario te pide explícitamente VER la pantalla. Usa la herramienta take_screenshot y responde en tu tono con lo que veas.]';

const GAME_HINT = /que juego|que estas jugando|que juegas|que juego es|estas jugando|que andas jugando|que te toca|que vas a jugar|que vamos a jugar/i;

const GAME_TAG = '\n\n[CONTEXTO: El usuario pregunta qué estás jugando o qué juego es. Usa la herramienta get_running_apps para ver qué hay abierto en el PC, identifica el juego y responde con lo que encuentres. Después usa web_search con el nombre del juego para buscar un dato curioso reciente: última actualización, parche, evento o polémica. Combina el dato del juego con eso para dar una respuesta más interesante.]';

function timeTag() {
  const now = new Date().toLocaleString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return '\n\n[HORA ACTUAL: ' + now + ']';
}

function getSystemPrompt(message) {
  const base = loadSystemPrompt().replace('{name}', cfg.VTUBER_NAME);
  const custom = cfg.SYSTEM_PROMPT_CUSTOM || '';
  const vts = cfg.VTS_PROMPT || '';

  let topicContext = '';
  if (cfg.TOPICS_ENABLED && topicManager && message) {
    const topic = topicManager.detectTopic(message);
    if (topic) {
      topicContext = '\n\n[CONTEXTO ESPECIAL - "' + topic.title + '"]\n' + topic.payload.system;
      if (topic.payload.fewShots && topic.payload.fewShots.length > 0) {
        topicContext += '\n\nEjemplos de cómo responder en este contexto:';
        for (const fs of topic.payload.fewShots) {
          topicContext += '\nUsuario: ' + fs.user + '\nTú: ' + fs.assistant;
        }
      }
    }
  }

  let moodContext = '';
  if (cfg.MOOD_ENABLED && moodSystem) {
    moodContext = moodSystem.getMoodContext();
  }

  const tools = '\n\nHerramientas: web_search (internet), get_current_time (hora), take_screenshot (ver pantalla cuando te lo piden), get_running_apps (saber qué juegos/apps están abiertos en el PC).';

  return base + (custom ? '\n\n' + custom : '') + topicContext + moodContext + tools + (vts ? '\n\n' + vts : '');
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
    vtsAuthenticated: vtube ? vtube.authenticated : false,
    mood: moodSystem ? moodSystem.getState() : null,
  });
}

function initVTS() {
  if (vtube?.connected && vtube?.authenticated) return;
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

let _vtsPoller = null;
function startVTSPoller() {
  if (_vtsPoller) return;
  _vtsPoller = setInterval(() => {
    if (!vtube?.connected || !vtube?.authenticated) initVTS();
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

async function isHeld() {
  if (!vtube?.authenticated || !vtubeModel) return false;
  const file = vtubeModel.expressionFile('atadas');
  if (!file) return false;
  try {
    const r = await vtube.getExpressionState(file);
    return !!r.data?.expressions?.find((ex) => ex.file === file)?.active;
  } catch {}
  return false;
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

  memory = new GrimMemory();
  topicManager = new TopicManager();
  moodSystem = new MoodSystem();
  rateLimiter = new BotRateLimiter();

  console.log('[VTUBER-AI] Memoria SQLite cargada ✅');
  console.log('[VTUBER-AI] Topics cargados (' + require('./topics').topics.length + ' topics) ✅');
  console.log('[VTUBER-AI] Sistema de mood activo ✅');

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
    const data = await chat.sendAsBot(content);
    if (data.data?.is_sent) return true;
    console.error('[VTUBER-AI] Kick API rechazó el mensaje:', JSON.stringify(data));
    return false;
  } catch (err) {
    console.error('[VTUBER-AI] Error enviando chat:', err.message);
    return false;
  }
}

async function processMessage(username, content, skipLog, extraContext, skipChat) {
  if (!deepseek) return { error: 'No inicializado' };

  console.log('[VTUBER-AI] ' + username + ': ' + content);

  let history = [];
  let profileContext = '';
  let knowledgeContext = '';
  let summaryContext = '';

  if (cfg.MEMORY_ENABLED && memory) {
    const smart = memory.getSmartContext(username, content, cfg.MAX_HISTORY_TURNS);
    history = smart.recentHistory.map(e => ({
      role: e.role,
      content: e.role === 'user' ? e.username + ': ' + e.content : e.content,
    }));
    if (smart.userProfile) {
      const p = smart.userProfile;
      profileContext = '\n\nCONTEXTO DEL USUARIO "' + username + '": messages totales: ' + p.message_count + ', relación: ' + p.relationship;
      if (p.notes) profileContext += ', notas: ' + p.notes;
    }
    if (smart.relevantMemory && smart.relevantMemory.length > 0) {
      knowledgeContext = '\n\nCONOCIMIENTO RELEVANTE DE CONVERSACIONES PASADAS:\n' +
        smart.relevantMemory.slice(0, 5).map(function(m) {
          return '- ' + m.username + ': "' + m.content + '"';
        }).join('\n');
    }
    const pastSummaries = memory.getConversationSummary(3);
    if (pastSummaries.length > 0) {
      summaryContext = '\n\nRESÚMENES DE STREAMS ANERIORES:\n' +
        pastSummaries.map(function(s) { return '- ' + s.summary; }).join('\n');
    }
  }

  let userContent = username + ': ' + content + timeTag();
  if (VISION_HINT.test(content)) {
    userContent += VISION_TAG;
  }
  if (GAME_HINT.test(content)) {
    userContent += GAME_TAG;
  }

  const systemPrompt = getSystemPrompt(content) + profileContext + knowledgeContext + summaryContext;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userContent },
  ];

  if (cfg.MEMORY_ENABLED && !skipLog && memory) {
    memory.logMessage(username, 'user', content);
  }

  if (cfg.MOOD_ENABLED && moodSystem) {
    moodSystem.processMessageContent(content);
  }

  try {
    const start = Date.now();
    const result = await deepseek.complete({
      messages,
      temperature: cfg.TEMPERATURE,
      maxTokens: cfg.MAX_TOKENS,
      userId: sanitizeUserId(username),
    });
    const elapsed = Date.now() - start;

    const promptMiss = Math.max(0, result.usage.prompt - result.usage.cacheHit);
    const cost = (result.usage.cacheHit * 0.0028 + promptMiss * 0.14 + result.usage.completion * 0.28) / 1000000;
    console.log(
      '[VTUBER-AI] ✅ ' + result.usage.total + ' tokens ' +
      '(prompt:' + result.usage.prompt + ', completion:' + result.usage.completion + ', ' +
      'cache_hit:' + result.usage.cacheHit + ') en ' + elapsed + 'ms ' +
      '~$' + cost.toFixed(6)
    );

    let finalText = result.text;
    if (cfg.RESPONSE_FILTER_ENABLED) {
      finalText = filterResponse(finalText);
    }

    if (cfg.MEMORY_ENABLED && !skipLog && memory) {
      memory.logMessage(cfg.VTUBER_NAME, 'assistant', finalText);
    }

    let displayText = finalText;
    if (vtubeModel) {
      const emotions = vtubeModel.extractEmotion(finalText);
      if (emotions.length) {
        console.log('[VTUBER-AI] Emociones detectadas: ' + emotions.join(', '));
        for (const em of emotions) {
          await triggerVTSExpression(em);
          await new Promise(r => setTimeout(r, 100));
        }
      }
      displayText = vtubeModel.removeEmotion(finalText) || finalText;
    }

    const maxLen = 400;
    const chunks = [];
    for (let i = 0; i < displayText.length;) {
      if (i + maxLen >= displayText.length) {
        chunks.push(displayText.slice(i));
        break;
      }
      let end = displayText.lastIndexOf(' ', i + maxLen);
      if (end <= i) end = i + maxLen;
      chunks.push(displayText.slice(i, end));
      i = end + 1;
    }
    let chatSent = false;
    if (skipChat) {
      console.log('[VTUBER-AI] Modo voz privado — sin envío a chat');
    } else {
      if (chunks.length > 1) console.warn('[VTUBER-AI] Respuesta larga (' + displayText.length + ' chars), dividiendo en ' + chunks.length + ' mensajes');
      for (const chunk of chunks) {
        const sent = await sendChatMessage(chunk);
        if (sent) chatSent = true;
        else break;
      }
      console.log('[VTUBER-AI] Chat ' + (chatSent ? 'enviado ✅' : 'falló ❌') + ' (' + chunks.length + ' parte(s))');
    }

    if (chatSent || skipChat) {
      eventBus.emit('tts2:speak', { text: displayText, voice: '24', origin: 'bot' });
    }

    return { ok: true, text: displayText, usage: result.usage, chatSent };
  } catch (err) {
    console.error('[VTUBER-AI] Error:', err.message);
    return { error: err.message };
  }
}

async function onChatMessage(data) {
  const { payload } = data;

  const filter = filterMessage(payload);
  if (!filter.shouldProcess) {
    return;
  }

  const rateCheck = rateLimiter.canRespond();
  if (!rateCheck.allowed) {
    return;
  }

  const content = (payload.content || '').trim();
  if (!content.toLowerCase().startsWith(cfg.COMMAND)) return;

  const message = content.slice(cfg.COMMAND.length).trim();
  if (!message.length) return;

  const username = (payload.sender && payload.sender.username) || 'anon';
  const result = await processMessage(username, message);

  if (result.ok && result.chatSent) {
    rateLimiter.recordResponse();
  }
}

function handleGetStatus(req, res) {
  res.json({
    connected: !!(cfg.API_KEY && deepseek),
    apiKeySet: !!cfg.API_KEY,
    command: cfg.COMMAND,
    vtsConnected: vtube ? vtube.connected : false,
    vtsAuthenticated: vtube ? vtube.authenticated : false,
    vtsHost: cfg.VTS_HOST,
    vtsPort: cfg.VTS_PORT,
    mood: moodSystem ? moodSystem.getState() : null,
    memoryStats: memory ? memory.stats() : null,
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
    MOOD_ENABLED: cfg.MOOD_ENABLED,
    TOPICS_ENABLED: cfg.TOPICS_ENABLED,
    RESPONSE_FILTER_ENABLED: cfg.RESPONSE_FILTER_ENABLED,
    chatFilter: getFilterConfig(),
  });
}

function handleSaveConfig(req, res) {
  const body = req.body || {};
  const { API_KEY, SEARCH_API_KEY, TEMPERATURE, MAX_TOKENS, MAX_HISTORY_TURNS, VTUBER_NAME, COMMAND, SYSTEM_PROMPT_BASE, SYSTEM_PROMPT_CUSTOM, VTS_HOST, VTS_PORT, VTS_PLUGIN_NAME, VTS_PLUGIN_DEV, VTS_MODEL_NAME, VTS_AUTO_CONNECT, VTS_TOKEN, MEMORY_ENABLED, MOOD_ENABLED, TOPICS_ENABLED, RESPONSE_FILTER_ENABLED, chatFilter } = body;

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

  if (SYSTEM_PROMPT_CUSTOM !== undefined) cfg.SYSTEM_PROMPT_CUSTOM = SYSTEM_PROMPT_CUSTOM || null;
  if (VTS_HOST) cfg.VTS_HOST = VTS_HOST;
  if (VTS_PORT != null) cfg.VTS_PORT = parseInt(VTS_PORT, 10);
  if (VTS_PLUGIN_NAME) cfg.VTS_PLUGIN_NAME = VTS_PLUGIN_NAME;
  if (VTS_PLUGIN_DEV) cfg.VTS_PLUGIN_DEV = VTS_PLUGIN_DEV;
  if (VTS_MODEL_NAME) cfg.VTS_MODEL_NAME = VTS_MODEL_NAME;
  if (VTS_AUTO_CONNECT != null) cfg.VTS_AUTO_CONNECT = !!VTS_AUTO_CONNECT;
  if (VTS_TOKEN) cfg.VTS_TOKEN = VTS_TOKEN;
  if (MEMORY_ENABLED != null) cfg.MEMORY_ENABLED = !!MEMORY_ENABLED;
  if (MOOD_ENABLED != null) cfg.MOOD_ENABLED = !!MOOD_ENABLED;
  if (TOPICS_ENABLED != null) cfg.TOPICS_ENABLED = !!TOPICS_ENABLED;
  if (RESPONSE_FILTER_ENABLED != null) cfg.RESPONSE_FILTER_ENABLED = !!RESPONSE_FILTER_ENABLED;

  if (chatFilter) updateFilterConfig(chatFilter);

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
  const content = (req.body && req.body.content) || 'Hola!';
  try {
    const start = Date.now();
    const result = await deepseek.complete({
      messages: [
        { role: 'system', content: getSystemPrompt(content) },
        { role: 'user', content },
      ],
      temperature: cfg.TEMPERATURE,
      maxTokens: cfg.MAX_TOKENS,
      userId: 'test',
    });
    const elapsed = Date.now() - start;

    let finalText = result.text;
    if (cfg.RESPONSE_FILTER_ENABLED) finalText = filterResponse(finalText);

    let displayText = finalText;
    if (vtubeModel) {
      const emotions = vtubeModel.extractEmotion(finalText);
      if (emotions.length) {
        for (const em of emotions) {
          await triggerVTSExpression(em);
          await new Promise(r => setTimeout(r, 100));
        }
      }
      displayText = vtubeModel.removeEmotion(finalText) || finalText;
    }

    const chatSent = await sendChatMessage(displayText);
    if (chatSent) {
      eventBus.emit('tts2:speak', { text: displayText, voice: '24', origin: 'bot' });
    }

    res.json({ ok: true, text: displayText, usage: result.usage, elapsed, chatSent });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

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
  if (!file) return res.status(400).json({ ok: false, message: 'Emoción "' + emotion + '" no mapeada' });
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

function handleClearMemory(req, res) {
  const { username } = req.body || {};
  try {
    if (memory) {
      if (username) {
        memory.clearUser(username);
        console.log('[VTUBER-AI] Memoria limpiada para ' + username);
      } else {
        memory.clearAll();
        console.log('[VTUBER-AI] Memoria global limpiada');
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
}

function handleMemoryStats(req, res) {
  if (!memory) return res.json({ ok: false, message: 'Memoria no disponible' });
  res.json({ ok: true, stats: memory.stats() });
}

function handleMoodStatus(req, res) {
  if (!moodSystem) return res.json({ ok: false, message: 'Mood system no disponible' });
  res.json({ ok: true, mood: moodSystem.getState() });
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

function shutdown() {
  initialized = false;
  if (vtube) { vtube.disconnect(); vtube = null; }
  if (memory) { memory.close(); memory = null; }
  console.log('[VTUBER-AI] Apagado');
}

init();

module.exports = {
  processMessage, isHeld, shutdown,
  handleGetStatus, handleGetConfig, handleSaveConfig, handleTest,
  handleVTSConnect, handleVTSDisconnect, handleVTSStatus,
  handleVTSExpression, handleVTSHotkey,
  handleVTSParams, handleVTSInjectParam,
  handleClearMemory, handleMemoryStats, handleMoodStatus,
};
