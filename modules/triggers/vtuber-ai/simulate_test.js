const { VTubeClient } = require('./vtube-client');
const { VTubeModel } = require('./vtube-model');
const { createDeepSeekClient } = require('./deepseek-client');
const { loadSystemPrompt, setSystemPrompt, resetSystemPrompt } = require('./config');
const { logMessage, getConversation } = require('./logger');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const host = process.argv[2] || 'localhost';
const port = parseInt(process.argv[3] || '8001');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'simula> ' });

let client = null;
let model = null;
let deepseek = null;
let cfg = {};
let _exprTimers = [];
const TEMP_DURATION = 3000; // ms antes de auto-deactivate

function loadAPIKey() {
  try {
    const p = path.join(__dirname, 'vtuber-data.json');
    const d = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return d.API_KEY || process.env.DEEPSEEK_API_KEY || process.env.VTUBER_API_KEY || '';
  } catch { return process.env.DEEPSEEK_API_KEY || process.env.VTUBER_API_KEY || ''; }
}

function log(prefix, msg) {
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  console.log(`${prefix} ${msg}`);
  rl.prompt(true);
}

async function processWithAI(username, content) {
  if (!deepseek) {
    log('❌', 'Sin API key — modo solo VTS');
    return content;
  }
  log('🤖', 'Pensando...');
  try {
    const history = await getConversation(username, 5);
    const messages = [
      { role: 'system', content: loadSystemPrompt().replace('{name}', 'Grim') },
      ...history.map(e => ({
        role: e.role,
        content: e.role === 'user' ? `${e.username}: ${e.content}` : e.content
      })),
      { role: 'user', content: `${username}: ${content}` }
    ];
    await logMessage({ username, role: 'user', content });

    const result = await deepseek.complete({ messages, temperature: 0.85, maxTokens: 300, userId: username });

    log('📊', `${result.usage.total} tokens (cache_hit:${result.usage.cacheHit})`);
    await logMessage({ username, role: 'assistant', content: result.text });

    return result.text;
  } catch (e) {
    log('❌', `Error AI: ${e.message}`);
    return content;
  }
}

function _clearTimers() {
  for (const t of _exprTimers) clearTimeout(t);
  _exprTimers = [];
}

async function deactivateAll() {
  if (!client?.authenticated) return;
  try {
    _clearTimers();
    const r = await client.getExpressionState();
    if (r.data?.expressions) {
      for (const ex of r.data.expressions) {
        if (ex.active) await client.setExpression(ex.file, false, 0.2);
      }
    }
    log('😐', 'Expresiones desactivadas (neutral)');
  } catch {}
}

async function activateTemp(file) {
  if (!client?.authenticated) return;
  _clearTimers();
  await deactivateAll();
  try {
    await client.setExpression(file, true, 0.3);
    log('  →', `${file} activada (${TEMP_DURATION}ms)`);
    _exprTimers.push(setTimeout(() => {
      if (client?.authenticated) {
        client.setExpression(file, false, 0.3).catch(() => {});
      }
    }, TEMP_DURATION));
  } catch {}
}

async function simulateEmotion(text) {
  log('📝', `Original: ${text}`);
  const emotions = model.extractEmotion(text);
  if (emotions.length) {
    log('😊', `Emociones: ${emotions.join(', ')}`);
    if (client && client.authenticated) {
      log('🔄', 'Enviando a VTS...');
      for (const em of emotions) {
        const file = model.expressionFile(em);
        if (file) await activateTemp(file);
      }
    }
  } else {
    log('😐', 'Sin emociones detectadas');
  }
  log('💬', `Limpio: ${model.removeEmotion(text)}`);
}

async function showModels() {
  if (!client || !client.authenticated) { log('❌', 'VTS no conectado'); return; }
  try {
    const r = await client.getAvailableModels();
    if (r.data?.availableModels?.length) {
      for (const m of r.data.availableModels) {
        log('  ', `${m.modelName}${m.modelLoaded ? ' [cargado]' : ''}`);
      }
    } else {
      log('  ', 'Sin modelos disponibles');
    }
  } catch (e) { log('❌', e.message); }
}

async function showExpressions() {
  if (!client || !client.authenticated) { log('❌', 'VTS no conectado'); return; }
  try {
    const r = await client.getExpressionState();
    if (r.data?.expressions?.length) {
      for (const ex of r.data.expressions) {
        log('  ', `${ex.active ? '🟢' : '⚪'} ${ex.file} (${ex.name})`);
      }
    } else {
      log('  ', 'Sin expresiones en el modelo actual');
    }
    if (r.data?.modelLoaded) log('📋', `Modelo: ${r.data.modelName}`);
  } catch (e) { log('❌', e.message); }
}

async function showParams() {
  if (!client || !client.authenticated) { log('❌', 'VTS no conectado'); return; }
  try {
    const r = await client.getParameterList();
    if (r.data?.parameterList?.length) {
      for (const p of r.data.parameterList) {
        log('  ', `${p.name} (${p.type})`);
      }
    } else {
      log('  ', 'Sin parámetros disponibles');
    }
  } catch (e) { log('❌', e.message); }
}

async function setParam(name, value) {
  if (!client || !client.authenticated) { log('❌', 'VTS no conectado'); return; }
  try {
    await client.injectParameters([{ name, value: parseFloat(value) }]);
    log('✅', `${name} = ${value}`);
  } catch (e) { log('❌', e.message); }
}

const HELP = `
  <texto>                Envía a la IA (si hay API key) y luego procesa emociones → VTS
  !<texto>               Modo raw: solo emotion parsing, sin AI (ej: "![joy] hola")
  expressions            Lista expresiones del modelo actual (archivos .exp3.json)
  params                 Lista parámetros Live2D disponibles
  param <name> <val>     Inyecta un parámetro (ej: "param 吐舌 1")
  refresh                Recarga el model_dict.json desde disco
  help                   Esta ayuda
  models                 Lista modelos VTS
  hotkey <id>            Ejecuta hotkey por ID
  expr <emotion>         Activa expresión temporal (3s). "--hold" para permanente
  neutral                Desactiva todas las expresiones
  [emotion] <texto>      Modo raw directo si no hay API key
  exit                   Salir
`;

async function main() {
  console.log('\n═══ VTube Simulation — Pipeline Completo ═══\n');

  model = new VTubeModel('Grim', path.join(__dirname, 'model_dict.json'));
  log('📋', `Modelo cargado: ${model.emotions.join(', ')}`);

  const apiKey = loadAPIKey();
  if (apiKey) {
    deepseek = createDeepSeekClient(apiKey);
    log('🤖', 'DeepSeek listo (con API key)');
  } else {
    log('⚠️', 'Sin API key — solo emotion parsing manual. Usá tags como [joy] texto');
  }

  let savedToken = null;
  try { const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'vtuber-data.json'), 'utf-8')); savedToken = d.VTS_TOKEN; } catch {}
  client = new VTubeClient({ host, port, token: savedToken });
  client.on('connected', () => log('✅', 'Conectado a VTS'));
  client.on('token', (token) => {
    try {
      const p = path.join(__dirname, 'vtuber-data.json');
      const d = JSON.parse(fs.readFileSync(p, 'utf-8'));
      d.VTS_TOKEN = token;
      fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf-8');
      log('💾', 'Token VTS guardado');
    } catch {}
  });
  client.on('authenticated', () => { log('✅', 'Autenticado en VTS'); });
  client.on('error', msg => log('❌', msg));
  client.connect();

  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) return;
    if (text === 'exit' || text === 'quit') { cleanup(); return; }
    if (text === 'help') { console.log(HELP); return; }
    if (text === 'models') { await showModels(); return; }
    if (text === 'expressions') { await showExpressions(); return; }
    if (text === 'params') { await showParams(); return; }
    if (text.startsWith('param ')) {
      const parts = text.slice(6).trim().split(/\s+/);
      if (parts.length < 2) { log('❌', 'Uso: param <nombre> <valor>'); return; }
      await setParam(parts[0], parts[1]);
      return;
    }
    if (text === 'refresh') {
      model = new VTubeModel('Grim', path.join(__dirname, 'model_dict.json'));
      log('📋', `Modelo recargado: ${model.emotions.join(', ')}`);
      return;
    }
    if (text.startsWith('hotkey ')) {
      const id = text.slice(7).trim();
      if (!client?.authenticated) { log('❌', 'VTS no conectado'); return; }
      try { await client.triggerHotkey(id); log('✅', `Hotkey ${id} ejecutada`); }
      catch (e) { log('❌', e.message); }
      return;
    }
    if (text.startsWith('expr ')) {
      const parts = text.slice(5).trim().split(/\s+/);
      const em = parts[0];
      const hold = parts.includes('--hold');
      const file = model.expressionFile(em);
      if (!file) { log('❌', `"${em}" no mapeada`); return; }
      if (hold) {
        try { await client.setExpression(file, true, 0.3); log('✅', `${em} → ${file} (permanente)`); }
        catch (e) { log('❌', e.message); }
      } else {
        await activateTemp(file);
      }
      return;
    }
    if (text === 'neutral') { await deactivateAll(); return; }

    if (text.startsWith('!')) {
      // Modo raw: solo emotion parsing, sin AI
      await simulateEmotion(text.slice(1).trim());
      return;
    }

    // Pipeline completo: AI → emotions → VTS → cleaned text
    const username = 'test_user';
    const aiText = await processWithAI(username, text);
    if (aiText) await simulateEmotion(aiText);
  });

  rl.on('close', cleanup);
  log('💡', deepseek
    ? 'Escribe cualquier mensaje → IA responde → emociones → VTS. Usá "!texto" para solo emotions.'
    : 'Sin API key — escribí "[joy] hola" para probar emotions manualmente.');
  log('💡', '"help" para comandos.\n');
}

function cleanup() {
  log('👋', 'Cerrando...');
  if (client) client.disconnect();
  rl.close();
  process.exit(0);
}

main();
