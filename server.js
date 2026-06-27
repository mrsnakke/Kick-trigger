const express = require('express');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

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
let tunnelIntentionalStop = false;
let authFailCount = 0;
const sseClients = [];
const processedIds = new Set();
let eventsCounter = 0;
const TEN_MINUTES = 10 * 60 * 1000;
const TOKENS_PATH = path.join(__dirname, 'tokens.json');

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
    const json = await resp.json();
    kickPublicKey = json.data?.public_key || kickPublicKey;
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
    saveTokens();
    // auto-flow en background, no bloquea el response
    autoFlow().catch(() => {});
    res.send(`<script>window.opener.postMessage({type:'oauth-success'},'*');window.close()</script>`);
  } catch (err) {
    res.send(`<script>window.opener.postMessage({type:'oauth-error',error:'${err.message}'},'*');window.close()</script>`);
  }
});

// -- Webhook (acepta GET y POST para verificación) --
app.all('/webhook/kick', async (req, res) => {
  console.log('[WH]', req.method, 'desde', req.ip, 'type:', req.headers['kick-event-type'] || '(ninguno)');
  // ponytail: Kick podría enviar GET de verificación/healthcheck
  if (req.method === 'GET') {
    console.log('[WH] GET de verificación recibido, respondiendo 200');
    return res.status(200).send('OK');
  }
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const sig = req.headers['kick-event-signature'];
  const msgId = req.headers['kick-event-message-id'];
  const ts = req.headers['kick-event-message-timestamp'];
  const evType = req.headers['kick-event-type'];

  console.log('[WH] sig:', !!sig, 'msgId:', !!msgId, 'ts:', !!ts);

  if (!sig || !msgId || !ts) {
    console.log('[WH] FALTAN cabeceras');
    return res.status(401).send('Cabeceras faltantes');
  }

  const tsDiff = Math.abs(Date.now() - new Date(ts).getTime());
  if (tsDiff > 300000) {
    console.log('[WH] TIMESTAMP fuera de ventana:', tsDiff);
    return res.status(401).send('Timestamp fuera de ventana');
  }
  console.log('[WH] timestamp OK, diff:', tsDiff);

  if (processedIds.has(msgId)) {
    console.log('[WH] DUPLICADO');
    return res.status(200).send('Duplicado');
  }

  processedIds.add(msgId);
  setTimeout(() => processedIds.delete(msgId), TEN_MINUTES);

  const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '';
  console.log('[WH] rawBody length:', rawBody.length, 'rawBody:', rawBody.slice(0, 100));

  try {
    const v = crypto.createVerify('sha256');
    v.update(`${msgId}.${ts}.${rawBody}`);
    if (!v.verify(kickPublicKey, sig, 'base64')) {
      console.log('[WH] FIRMA INVÁLIDA');
      await fetchPublicKey();
      return res.status(401).send('Firma inválida');
    }
  } catch (err) {
    console.log('[WH] Error verificación:', err.message);
    return res.status(500).send('Error verificación');
  }

  console.log('[WH] EVENTO VÁLIDO:', evType);
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
  if (!broadcasterUserId) await fetchChannelInfo();
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

// -- Debug: listar suscripciones activas --
app.get('/api/events/subscriptions', async (req, res) => {
  if (!tokens) return res.status(401).json({ error: 'No autenticado' });
  const subs = await listSubscriptions();
  res.json(subs);
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
    const list = await cfExec('tunnel --output json list');
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
  try {
    const out = await cfExec(`tunnel --output json info ${CF_TUNNEL_NAME}`);
    const t = JSON.parse(out);
    if (t.conns && t.conns.length > 0) {
      tunnelUrl = `https://${CF_DOMAIN}`;
      broadcast({ type: 'tunnel', status: 'open', url: tunnelUrl });
      return true;
    }
  } catch {}
  return false;
}

async function startTunnel() {
  if (tunnelProcess || tunnelUrl) return { url: tunnelUrl };
  if (!CF_TUNNEL_NAME || !CF_DOMAIN) return { error: 'Falta CF_TUNNEL_NAME o CF_DOMAIN en .env' };
  if (!fs.existsSync(CF_BIN)) return { error: 'cloudflared no instalado' };
  if (await tunnelAlreadyRunning()) return { url: tunnelUrl };

  const credsFile = await findTunnelCredentials();
  if (!credsFile) return { error: `No hay credenciales para ${CF_TUNNEL_NAME}` };

  const yml = `tunnel: ${CF_TUNNEL_NAME}
credentials-file: ${credsFile.replace(/\\/g, '/')}
ingress:
  - service: http://localhost:${PORT}
`;
  fs.writeFileSync(CF_CONFIG, yml);
  tunnelUrl = `https://${CF_DOMAIN}`;

  tunnelProcess = spawn(CF_BIN, ['tunnel', '--config', CF_CONFIG, 'run', CF_TUNNEL_NAME], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  broadcast({ type: 'tunnel', status: 'open', url: tunnelUrl });

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
    const wasIntentional = tunnelIntentionalStop;
    tunnelIntentionalStop = false;
    if (errLog) console.error('[CF] Exit:', code);
    broadcast({ type: 'tunnel', status: 'closed', exitCode: code, log: errLog.slice(0, 1000) });
    // auto-restart si no fue intencional y hay tokens
    if (!wasIntentional && tokens) {
      broadcast({ type: 'subscription', event: 'tunnel', status: 'reconnecting' });
      setTimeout(async () => {
        const r = await startTunnel();
        if (r.url) setTimeout(() => subscribeToEvents(), 3000);
      }, 10000);
    }
  });

  return { url: tunnelUrl };
}

app.post('/api/tunnel/start', async (req, res) => {
  const result = await startTunnel();
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/tunnel/stop', (_req, res) => {
  tunnelIntentionalStop = true;
  if (tunnelProcess) { tunnelProcess.kill(); tunnelProcess = null; tunnelUrl = null; }
  res.json({ ok: true });
});

app.post('/api/shutdown', (_req, res) => {
  res.json({ ok: true });
  tunnelIntentionalStop = true;
  if (tunnelProcess) tunnelProcess.kill();
  setTimeout(() => process.exit(0), 500);
});

// -- Persistencia de tokens --
function saveTokens() {
  if (!tokens) return;
  fs.writeFileSync(TOKENS_PATH, JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: tokens.expires_at }));
}

function loadTokens() {
  try {
    const raw = fs.readFileSync(TOKENS_PATH, 'utf8');
    tokens = JSON.parse(raw);
    if (!tokens?.access_token) { tokens = null; return false; }
    console.log('[TOKENS] Cargados');
    return true;
  } catch { return false; }
}

// -- Auto-flow: auth → túnel → suscripción --
async function autoFlow() {
  if (!tokens) return;
  try {
    await ensureValidToken();
    saveTokens();
    await fetchChannelInfo();
    broadcast({ type: 'auth', status: 'connected', slug: channelSlug });
    // si el túnel no está corriendo, iniciarlo
    const tunnelResp = await startTunnel();
    if (tunnelResp?.url) {
      // esperar un momento para que cloudflared levante
      setTimeout(() => subscribeToEvents(), 3000);
    }
  } catch (err) {
    authFailCount++;
    console.log('[AUTO]', err.message, `(intento ${authFailCount}/3)`);
    if (authFailCount >= 3) {
      tokens = null;
      try { fs.unlinkSync(TOKENS_PATH); } catch {}
      broadcast({ type: 'auth', status: 'disconnected' });
    }
  }
}

// -- Heartbeat: verificar suscripciones cada 5 min y reparar --
async function heartbeat() {
  if (!tokens) return;
  try {
    await ensureValidToken();
    if (!tunnelUrl || !tunnelProcess) {
      const r = await startTunnel();
      if (r.url) setTimeout(() => subscribeToEvents(), 3000);
      return;
    }
    const subs = await listSubscriptions();
    if (!subs || subs.length < 10) {
      console.log('[HEARTBEAT] suscripciones perdidas, re-subscribiendo...');
      broadcast({ type: 'subscription', event: 'all', status: 'error', message: 'Re-subscribiendo...' });
      await subscribeToEvents();
    } else {
      console.log('[HEARTBEAT] OK');
    }
    authFailCount = 0;
  } catch (err) {
    console.log('[HEARTBEAT]', err.message);
  }
}

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
  let data = await resp.json();
  if (!resp.ok) {
    // ponytail: un reintento tras 2s
    await new Promise(r => setTimeout(r, 2000));
    const resp2 = await fetch('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    data = await resp2.json();
    if (!resp2.ok) throw new Error('Error refresh token');
  }
  tokens.access_token = data.access_token;
  tokens.refresh_token = data.refresh_token;
  tokens.expires_at = Date.now() + (data.expires_in * 1000);
  saveTokens();
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

async function listSubscriptions() {
  await ensureValidToken();
  const resp = await fetch('https://api.kick.com/public/v1/events/subscriptions', {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });
  return resp.ok ? (await resp.json()).data || [] : [];
}

async function subscribeToEvents() {
  if (!broadcasterUserId) await fetchChannelInfo();
  const results = [];
  await ensureValidToken();
  // limpiar suscripciones viejas
  try { for (const s of await listSubscriptions()) await fetch(`https://api.kick.com/public/v1/events/subscriptions?id=${s.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokens.access_token}` } }); } catch {}
  const webhookUrl = tunnelUrl ? `${tunnelUrl}/webhook/kick` : null;
  if (!webhookUrl) {
    broadcast({ type: 'subscription', event: 'all', status: 'error', message: 'Iniciá el túnel antes de subscribir' });
    return [{ name: 'all', ok: false, error: 'No tunnel URL' }];
  }
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
          { name: 'channel.followed', version: 1 },
          { name: 'channel.subscription.new', version: 1 },
          { name: 'channel.subscription.renewal', version: 1 },
          { name: 'channel.subscription.gifts', version: 1 },
          { name: 'channel.reward.redemption.updated', version: 1 },
          { name: 'livestream.status.updated', version: 1 },
          { name: 'livestream.metadata.updated', version: 1 },
          { name: 'moderation.banned', version: 1 },
          { name: 'kicks.gifted', version: 1 }
        ],
        method: 'webhook',
        webhook_url: webhookUrl
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

// -- Arranque --
app.listen(PORT, async () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   Kick Backend                      ║`);
  console.log(`║   http://localhost:${PORT}              ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
  if (!CLIENT_ID) console.warn('⚠  Configura KICK_CLIENT_ID y KICK_CLIENT_SECRET en .env o variables de entorno');
  await fetchPublicKey();
  if (loadTokens()) autoFlow().catch(() => {});
  setInterval(heartbeat, 300000);
  console.log(`\n  Abrí http://localhost:${PORT} en tu navegador\n`);
});
