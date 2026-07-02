const http = require('http');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

let config;
function loadConfig() {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
}
loadConfig();

let sseClients = [];
let queue = [];
let processing = false;
let msgIdCounter = 0;
let currentId = null;

function runPS(script, { timeout = 30000, maxBuffer } = {}) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const opts = { encoding: 'utf8', timeout };
    if (maxBuffer) opts.maxBuffer = maxBuffer;
    exec(`powershell -NoProfile -EncodedCommand "${encoded}"`, opts, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout ? stdout.trim().split('\r\n').filter(Boolean) : []);
    });
  });
}

function speakPS(voiceIndex, outputIndex, text) {
  const s = `$v = New-Object -ComObject SAPI.SpVoice
$v.Voice = $v.GetVoices().Item(${voiceIndex})
$v.AudioOutput = $v.GetAudioOutputs().Item(${outputIndex})
$v.Speak('${text.replace(/'/g, "''")}')`;
  return runPS(s, { timeout: 120000 });
}

function resolve(key, map) {
  if (map && map[key] !== undefined) return map[key];
  const n = parseInt(key);
  if (!isNaN(n)) return n;
  return 0;
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients = sseClients.filter(c => {
    try { c.write(msg); return true; }
    catch (e) { return false; }
  });
}

function qState(q, sid) { return q.map(i => ({ id: i.id, text: i.text, origin: i.origin || null, status: i.id === sid ? 'speaking' : 'waiting' })); }

function enqueue(text, voiceIndex, outputIndex, origin, explicitOutput) {
  const id = ++msgIdCounter;
  queue.push({ id, text, voiceIndex, outputIndex, origin, explicitOutput });
  broadcast('queue-update', { queue: qState(queue, currentId) });
  processQueue();
  return id;
}

function resolveOutput(item) {
  if (!item.explicitOutput && item.origin && config.originOutputs) {
    const alias = config.originOutputs[item.origin];
    if (alias !== undefined) return resolve(String(alias), config.outputAliases);
  }
  return item.outputIndex;
}

async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;
  const item = queue.shift();
  currentId = item.id;
  broadcast('queue-update', { queue: [{ id: item.id, text: item.text, origin: item.origin || null, status: 'speaking' }, ...qState(queue, null)] });
  try {
    await speakPS(item.voiceIndex, resolveOutput(item), item.text);
  } catch (e) {
    console.error('Error speaking queued msg:', e.message);
  }
  currentId = null;
  broadcast('queue-update', { queue: qState(queue, null) });
  processing = false;
  processQueue();
}

const indexHTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');

function sendJSON(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const key = `${req.method} ${url.pathname}`;

  try {
    switch (key) {
      case 'GET /api/voices': {
        const voices = await runPS(`$v = New-Object -ComObject SAPI.SpVoice; if ($v.GetVoices().Count -gt 0) { 0..($v.GetVoices().Count-1) | % { '{0}||{1}' -f $_, $v.GetVoices().Item($_).GetDescription() } }`);
        const list = voices.map(v => { const [idx, ...name] = v.split('||'); return { index: parseInt(idx), name: name.join('||') }; });
        sendJSON(res, list);
        break;
      }
      case 'GET /api/outputs': {
        const outputs = await runPS(`$v = New-Object -ComObject SAPI.SpVoice; if ($v.GetAudioOutputs().Count -gt 0) { 0..($v.GetAudioOutputs().Count-1) | % { '{0}||{1}' -f $_, $v.GetAudioOutputs().Item($_).GetDescription() } }`);
        const list = outputs.map(o => { const [idx, ...name] = o.split('||'); return { index: parseInt(idx), name: name.join('||') }; });
        sendJSON(res, list);
        break;
      }
      case 'POST /api/speak-now': {
        const { text, voice, output } = await parseBody(req);
        if (!text) return sendJSON(res, { error: 'text required' }, 400);
        const vi = resolve(voice ?? "1", config.voiceAliases);
        const oi = resolve(output ?? "0", config.outputAliases);
        speakPS(vi, oi, text).catch(e => console.error('speak-now error:', e.message));
        sendJSON(res, { ok: true });
        break;
      }
      case 'POST /api/speak-queue': {
        const { text, voice, output, origin } = await parseBody(req);
        if (!text) return sendJSON(res, { error: 'text required' }, 400);
        const vi = resolve(voice ?? "1", config.voiceAliases);
        const hasOutput = output !== undefined;
        const oi = hasOutput ? resolve(output, config.outputAliases) : 0;
        const id = enqueue(text, vi, oi, origin, hasOutput);
        sendJSON(res, { id });
        break;
      }
      case 'GET /api/queue':
        sendJSON(res, { queue: qState(queue, currentId), currentId });
        break;
      case 'DELETE /api/queue':
        queue = [];
        broadcast('queue-update', { queue: [] });
        sendJSON(res, { ok: true });
        break;
      case 'GET /api/config':
        sendJSON(res, { voiceAliases: config.voiceAliases || {}, outputAliases: config.outputAliases || {}, originOutputs: config.originOutputs || {} });
        break;
      case 'POST /api/config/reload':
        loadConfig();
        sendJSON(res, { ok: true });
        break;
      case 'GET /api/events':
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        sseClients.push(res);
        req.on('close', () => {
          sseClients = sseClients.filter(c => c !== res);
        });
        break;
      default:
        if (req.method === 'GET' && url.pathname === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(indexHTML);
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
    }
  } catch (e) {
    console.error('Error handling request:', e.message);
    if (!res.headersSent) sendJSON(res, { error: e.message }, 500);
  }
}

const server = http.createServer(handle);
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`TTS App running at http://localhost:${PORT}`);
});
