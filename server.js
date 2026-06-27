const express = require('express');
const crypto = require('crypto');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// ponytail: cargar .env manual sin dotenv
try {
  fs.readFileSync('.env', 'utf8').split('\n').forEach(l => {
    const i = l.indexOf('=');
    if (i > 0) process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  });
} catch {}

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.KICK_CLIENT_ID;
const CLIENT_SECRET = process.env.KICK_CLIENT_SECRET;
const REDIRECT_URI = process.env.KICK_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;

// -- Cloudflare Tunnel --
const CF_TUNNEL_NAME = process.env.CF_TUNNEL_NAME;
const CF_DOMAIN = process.env.CF_DOMAIN;
const CF_BIN = path.join(process.env.LOCALAPPDATA || '', 'cloudflared', 'cloudflared.exe');
const CF_CREDENTIALS_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.cloudflared');
const CF_CONFIG = path.join(__dirname, 'cloudflared.yml');

let tokens = null;
let oauthSession = null;
let tunnelProcess = null;
let tunnelUrl = null;
let broadcasterUserId = null;
let channelSlug = null;
const sseClients = [];
const processedIds = new Set();
let eventsCounter = 0;
const TEN_MINUTES = 10 * 60 * 1000;

// ponytail: hardcodeada, refresh dinámico si falla verificación
let kickPublicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8
6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2
MZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ
L/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY
6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF
BEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e
twIDAQAB
-----END PUBLIC KEY-----`;

async function fetchPublicKey() {
  try {
    const resp = await fetch('https://api.kick.com/public/v1/public-key');
    kickPublicKey = await resp.text();
    console.log('[PK] Clave pública actualizada');
  } catch {
    console.warn('[PK] Usando clave hardcodeada');
  }
}

// -- PKCE --
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}
function generateCodeChallenge(v) {
  return crypto.createHash('sha256').update(v).digest('base64url');
}

// -- Express: raw body preservation --
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));
app.use(express.static(path.join(__dirname, 'public')));

// -- OAuth login --
app.get('/auth/login', (req, res) => {
  if (!CLIENT_ID) return res.status(400).json({ error: 'KICK_CLIENT_ID no configurado' });
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  oauthSession = { state: crypto.randomBytes(16).toString('hex'), verifier };

  const q = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'events:subscribe chat:write channel:read channel:rewards:read user:read',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: oauthSession.state
  });
  res.redirect(`https://id.kick.com/oauth/authorize?${q}`);
});

// -- OAuth callback --
app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send(`<script>window.opener.postMessage({type:'oauth-error',error:'${error}'},'*');window.close()</script>`);
  if (state !== oauthSession?.state) return res.status(401).send('State inválido');

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code_verifier: oauthSession.verifier,
      code
    });
    const resp = await fetch('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error token');

    tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in * 1000)
    };
    oauthSession = null;
    await fetchChannelInfo();
    broadcast({ type: 'auth', status: 'connected', slug: channelSlug });
    res.send(`<script>window.opener.postMessage({type:'oauth-success'},'*');window.close()</script>`);
  } catch (err) {
    res.send(`<script>window.opener.postMessage({type:'oauth-error',error:'${err.message}'},'*');window.close()</script>`);
  }
});

// -- Webhook --
app.post('/webhook/kick', (req, res) => {
  const sig = req.headers['kick-event-signature'];
  const msgId = req.headers['kick-event-message-id'];
  const ts = req.headers['kick-event-message-timestamp'];
  const evType = req.headers['kick-event-type'];

  if (!sig || !msgId || !ts) return res.status(401).send('Cabeceras faltantes');
  if (Math.abs(Date.now() - new Date(ts).getTime()) > 300000) return res.status(401).send('Timestamp fuera de ventana');
  if (processedIds.has(msgId)) return res.status(200).send('Duplicado');

  processedIds.add(msgId);
  setTimeout(() => processedIds.delete(msgId), TEN_MINUTES);

  const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '';
  try {
    const v = crypto.createVerify('sha256');
    v.update(`${msgId}.${ts}.${rawBody}`);
    if (!v.verify(kickPublicKey, sig, 'base64')) return res.status(401).send('Firma inválida');
  } catch {
    return res.status(500).send('Error verificación');
  }

  eventsCounter++;
  broadcast({ type: 'event', eventType: evType, payload: req.body, ts });
  res.status(200).send('OK');
});

// -- SSE --
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  const client = { id: Date.now(), res };
  sseClients.push(client);
  res.write(`data: ${JSON.stringify({
    type: 'status',
    authenticated: !!tokens,
    tunnelUrl,
    channelSlug,
    eventsCounter
  })}\n\n`);
  req.on('close', () => {
    const i = sseClients.indexOf(client);
    if (i !== -1) sseClients.splice(i, 1);
  });
});

// -- Enviar chat --
app.post('/api/chat/send', express.json(), async (req, res) => {
  if (!tokens) return res.status(401).json({ error: 'No autenticado' });
  const { content, reply_to_message_id } = req.body;
  if (!content || content.length > 500) return res.status(400).json({ error: 'Máx 500 caracteres' });

  await ensureValidToken();
  try {
    const body = { broadcaster_user_id: broadcasterUserId, content, type: 'user' };
    if (reply_to_message_id) body.reply_to_message_id = reply_to_message_id;
    const resp = await fetch('https://api.kick.com/public/v1/chat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (data.data?.is_sent) broadcast({ type: 'sent', content, message_id: data.data.message_id });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -- Estado --
app.get('/api/status', (req, res) => {
  res.json({
    authenticated: !!tokens,
    clientId: !!CLIENT_ID,
    tunnelUrl,
    broadcasterUserId,
    channelSlug,
    eventsCounter,
    sseClients: sseClients.length
  });
});

// -- Suscripción manual a eventos --
app.post('/api/events/subscribe', async (req, res) => {
  if (!tokens) return res.status(401).json({ error: 'No autenticado' });
  const results = await subscribeToEvents();
  const allOk = results.every(r => r.ok);
  res.json({ ok: allOk, results });
});



function cfExec(args) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(CF_BIN)) return reject('cloudflared no instalado');
    exec(`"${CF_BIN}" ${args}`, (err, stdout) => {
      if (err) reject(err.message); else resolve(stdout);
    });
  });
}

async function findTunnelCredentials() {
  if (!fs.existsSync(CF_CREDENTIALS_DIR)) return null;
  const all = fs.readdirSync(CF_CREDENTIALS_DIR).filter(f => f.endsWith('.json') && f !== 'cert.pem');
  if (!all.length) return null;
  try {
    const list = await cfExec('tunnel list --output json');
    const tunnels = JSON.parse(list);
    const t = tunnels.find(t => t.name === CF_TUNNEL_NAME);
    if (t) {
      const f = all.find(f => f.startsWith(t.id));
      if (f) return path.join(CF_CREDENTIALS_DIR, f);
    }
  } catch {}
  return path.join(CF_CREDENTIALS_DIR, all[0]);
}

async function tunnelAlreadyRunning() {
  // ponytail: si el túnel ya tiene conexiones activas, usarlo
  try {
    const out = await cfExec(`tunnel info ${CF_TUNNEL_NAME} --output json`);
    const t = JSON.parse(out);
    if (t.connections && t.connections.length > 0) {
      tunnelUrl = `https://${CF_DOMAIN}`;
      broadcast({ type: 'tunnel', status: 'open', url: tunnelUrl });
      return true;
    }
  } catch {}
  return false;
}

app.post('/api/tunnel/start', async (req, res) => {
  if (tunnelProcess) return res.json({ url: tunnelUrl });
  if (!CF_TUNNEL_NAME || !CF_DOMAIN) return res.status(400).json({ error: 'Falta CF_TUNNEL_NAME o CF_DOMAIN en .env' });

  if (!fs.existsSync(CF_BIN))
    return res.status(400).json({ error: 'cloudflared no instalado', guide: 'winget install cloudflare.cloudflared' });

  // si ya está corriendo, solo anunciar la URL
  if (await tunnelAlreadyRunning())
    return res.json({ url: tunnelUrl });

  const credsFile = await findTunnelCredentials();
  if (!credsFile)
    return res.status(400).json({
      error: `No hay credenciales para el túnel ${CF_TUNNEL_NAME}`,
      guide: `Ejecutá:\n  cloudflared tunnel login\n  cloudflared tunnel create ${CF_TUNNEL_NAME}\n  cloudflared tunnel route dns ${CF_TUNNEL_NAME} ${CF_DOMAIN}`
    });

  const yml = `tunnel: ${CF_TUNNEL_NAME}
credentials-file: ${credsFile.replace(/\\/g, '/')}
ingress:
  - service: http://localhost:${PORT}
`;
  fs.writeFileSync(CF_CONFIG, yml);
  tunnelUrl = `https://${CF_DOMAIN}`;

  tunnelProcess = spawn(CF_BIN, ['tunnel', 'run', '--config', CF_CONFIG], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  broadcast({ type: 'tunnel', status: 'open', url: tunnelUrl });
  res.json({ url: tunnelUrl });

  let errLog = '';
  tunnelProcess.stderr.on('data', d => {
    errLog += d.toString();
    const line = d.toString().trim();
    if (line) console.log('[CF]', line);
  });
  tunnelProcess.on('error', err => {
    tunnelProcess = null; tunnelUrl = null;
    broadcast({ type: 'tunnel', status: 'closed', error: err.message });
  });
  tunnelProcess.on('exit', code => {
    tunnelProcess = null; tunnelUrl = null;
    broadcast({ type: 'tunnel', status: 'closed', exitCode: code });
    if (code !== 0) console.error('[CF] Exit code:', code, errLog);
  });
});

app.post('/api/tunnel/stop', (_req, res) => {
  if (tunnelProcess) { tunnelProcess.kill(); tunnelProcess = null; tunnelUrl = null; }
  res.json({ ok: true });
});

// -- Helpers --
function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(c => { try { c.res.write(msg); } catch {} });
}

async function ensureValidToken() {
  if (!tokens) throw new Error('No autenticado');
  if (Date.now() < tokens.expires_at - 60000) return;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: tokens.refresh_token
  });
  const resp = await fetch('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error('Error refresh token');
  tokens.access_token = data.access_token;
  tokens.refresh_token = data.refresh_token;
  tokens.expires_at = Date.now() + (data.expires_in * 1000);
}

async function fetchChannelInfo() {
  await ensureValidToken();
  const resp = await fetch('https://api.kick.com/public/v1/channels', {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });
  const data = await resp.json();
  if (data.data?.[0]) {
    broadcasterUserId = data.data[0].broadcaster_user_id;
    channelSlug = data.data[0].slug;
  }
}

async function subscribeToEvents() {
  if (!broadcasterUserId) await fetchChannelInfo();
  const results = [];
  await ensureValidToken();
  try {
    const resp = await fetch('https://api.kick.com/public/v1/events/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        events: [
          { name: 'chat.message.sent', version: 1 },
          { name: 'channel.subscription.new', version: 1 },
          { name: 'channel.reward.redemption.updated', version: 1 }
        ],
        method: 'webhook'
      })
    });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    const ok = resp.ok && (resp.status === 200 || resp.status === 201 || resp.status === 204);
    console.log(`[SUB] ${resp.status} — ${ok ? 'OK' : text}`);
    if (data.data) {
      data.data.forEach(sub => {
        const s = sub.status || sub.error || 'active';
        console.log(`  ${sub.name || sub.event}: ${sub.subscription_id || s}`);
        broadcast({ type: 'subscription', event: sub.name || sub.event, status: sub.error ? 'error' : 'active', subscriptionId: sub.subscription_id });
        results.push({ name: sub.name || sub.event, ok: !sub.error, subscriptionId: sub.subscription_id, error: sub.error });
      });
    } else {
      broadcast({ type: 'subscription', event: 'all', status: 'error', statusCode: resp.status, message: data.message || data.error || text });
      results.push({ name: 'all', ok: false, status: resp.status, body: data });
    }
  } catch (err) {
    console.error(`[SUB] ${err.message}`);
    broadcast({ type: 'subscription', event: 'all', status: 'error', message: err.message });
    results.push({ name: 'all', ok: false, error: err.message });
  }
  return results;
}

// -- Auto-open en modo app --
function openAppMode(url) {
  // ponytail: solo Windows, prueba Edge luego Chrome
  const cmds = [
    `start msedge --app="${url}" --no-first-run`,
    `start chrome --app="${url}" --no-first-run`
  ];
  let i = 0;
  (function tryNext() { if (i < cmds.length) exec(cmds[i++], err => { if (err) tryNext(); }); })();
}

// -- Arranque --
app.listen(PORT, async () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   Kick Backend                      ║`);
  console.log(`║   http://localhost:${PORT}              ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
  if (!CLIENT_ID) console.warn('⚠  Configura KICK_CLIENT_ID y KICK_CLIENT_SECRET en .env o variables de entorno');
  await fetchPublicKey();
  openAppMode(`http://localhost:${PORT}`);
});
