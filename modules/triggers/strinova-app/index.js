const express = require('express');
const path = require('path');
const fs = require('fs');
const url = require('url');
const { WebSocketServer } = require('ws');
const eventBus = require('../../../lib/event-bus');

const PUBLIC = path.join(__dirname, 'public');
const STATE_FILE = path.join(__dirname, 'state.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

const FACTIONS = {
  cizalla: { label: 'Cizalla', color: '#e74c3c' },
  sup: { label: 'S.U.P', color: '#3498db' },
  urbino: { label: 'Urbino', color: '#f1c40f' },
};

const CHARACTERS = {
  cizalla: [
    { name: 'Eika', file: 'Eika.png' },
    { name: 'Fragrans', file: 'Fragrans.png' },
    { name: 'Kanami', file: 'Kanami.png' },
    { name: 'Lawine', file: 'Lawine.png' },
    { name: 'Mara', file: 'Mara.png' },
    { name: 'Meredith', file: 'Meredith.png' },
    { name: 'Ming', file: 'Ming.png' },
    { name: 'Nora', file: 'Nora.png' },
    { name: 'Reiichi', file: 'Reiichi.png' },
  ],
  sup: [
    { name: 'Chiyo', file: 'Chiyo.png' },
    { name: 'Flavia', file: 'Flavia.png' },
    { name: 'Kokona', file: 'Kokona.png' },
    { name: 'Leona', file: 'Leona.png' },
    { name: 'Michele', file: 'Michele.png' },
    { name: 'Nobunaga', file: 'Nobunaga.png' },
    { name: 'Yugiri', file: 'Yugiri.png' },
    { name: 'Yvette', file: 'Yvette.png' },
  ],
  urbino: [
    { name: 'Audrey', file: 'Audrey.png' },
    { name: 'Bai Mo', file: 'BaiMo.png' },
    { name: 'Celestia', file: 'Celestia.png' },
    { name: 'Cielle', file: 'Cielle.png' },
    { name: 'Fuchsia', file: 'Fuchsia.png' },
    { name: 'Galatea', file: 'Galatea.png' },
    { name: 'Maddelena', file: 'Maddelena.png' },
  ],
};

const ALL_CHARS = Object.entries(CHARACTERS).flatMap(([faction, chars]) =>
  chars.map(c => ({ ...c, faction }))
);

function getRandomChar(faction) {
  const pool = CHARACTERS[faction];
  return { ...pool[Math.floor(Math.random() * pool.length)], faction };
}

function spinRoulette() {
  const winner = ALL_CHARS[Math.floor(Math.random() * ALL_CHARS.length)];
  let left, right;
  if (winner.faction === 'urbino') {
    left = right = winner;
  } else if (winner.faction === 'cizalla') {
    left = winner;
    right = getRandomChar('sup');
  } else {
    left = getRandomChar('cizalla');
    right = winner;
  }
  return { left, right };
}

let wss = null;
let showListTimeout = null, showRankTimeout = null;

const state = {
  history: [],
  listVisible: false,
  rankVisible: true,
  showRoulette: false,
  roulettePos: { scale: 100, x: 0, y: 0, frontY: 0 },
  rankPos: { scale: 100, x: 0, y: 0 },
  panelPos: { scale: 100, x: 0, y: 0 },
  rank: { rankIndex: 0, tierIndex: 0, score: 1000, wins: 0, losses: 0 }
};

function saveState() {
  fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), () => {});
}

function loadState() {
  try {
    const data = fs.readFileSync(STATE_FILE, 'utf8');
    const saved = JSON.parse(data);
    if (saved.roulettePos) Object.assign(state.roulettePos, saved.roulettePos);
    if (saved.rankPos) Object.assign(state.rankPos, saved.rankPos);
    if (saved.panelPos) Object.assign(state.panelPos, saved.panelPos);
    if (saved.rank) Object.assign(state.rank, saved.rank);
    state.history = saved.history || [];
    if (saved.listVisible !== undefined) state.listVisible = saved.listVisible;
    if (saved.rankVisible !== undefined) state.rankVisible = saved.rankVisible;
  } catch {}
}

function send(ws, msg) { ws.send(JSON.stringify(msg)); }
function broadcast(data) {
  if (!wss) return;
  const d = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(d); });
}

function initWs(server) {
  wss = new WebSocketServer({ noServer: true });
  wss.on('error', err => console.error('[Strinova] WS error:', err.message));

  // ws v8 abortHandshake destroys the socket on path mismatch, so GACHA's
  // handler kills /ws/strinova connections before we see them.
  // Intercept the upgrade event to route first.
  const existingUpgrade = server.rawListeners('upgrade');
  console.log('[Strinova] Intercepting WS upgrade — moving', existingUpgrade.length, 'existing listener(s) behind /ws/strinova');
  server.removeAllListeners('upgrade');
  server.on('upgrade', (req, socket, head) => {
    const pathname = url.parse(req.url).pathname;
    if (pathname === '/ws/strinova') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
      return;
    }
    for (const fn of existingUpgrade) fn(req, socket, head);
  });

  wss.on('connection', (ws) => {
    send(ws, { type: 'init', state });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.type) {
        case 'spin':
          state.showRoulette = true;
          state.history.push({
            left: { name: msg.result.left.name, displayName: msg.result.left.displayName, faction: msg.result.left.faction },
            right: { name: msg.result.right.name, displayName: msg.result.right.displayName, faction: msg.result.right.faction },
            timestamp: Date.now()
          });
          broadcast({ type: 'show_roulette', show: true });
          broadcast({ type: 'spin', result: msg.result });
          broadcast({ type: 'history_update', history: state.history });
          saveState();
          break;
        case 'clear_history':
          state.history = [];
          broadcast({ type: 'history_update', history: state.history });
          saveState();
          break;
        case 'remove_from_history':
          if (msg.index >= 0 && msg.index < state.history.length) {
            state.history.splice(msg.index, 1);
            broadcast({ type: 'history_update', history: state.history });
            saveState();
          }
          break;
        case 'toggle_list':
          state.listVisible = msg.visible;
          broadcast({ type: 'toggle_list', visible: state.listVisible });
          saveState();
          break;
        case 'toggle_rank':
          state.rankVisible = msg.visible;
          broadcast({ type: 'toggle_rank', visible: state.rankVisible });
          saveState();
          break;
        case 'show_roulette':
          state.showRoulette = msg.show;
          broadcast({ type: 'show_roulette', show: msg.show });
          saveState();
          break;
        case 'roulette_pos':
          Object.assign(state.roulettePos, msg.data);
          broadcast({ type: 'roulette_pos', data: { ...state.roulettePos } });
          saveState();
          break;
        case 'rank_pos':
          Object.assign(state.rankPos, msg.data);
          broadcast({ type: 'rank_pos', data: { ...state.rankPos } });
          saveState();
          break;
        case 'rank_update':
          Object.assign(state.rank, msg.data);
          broadcast({ type: 'rank_update', data: { ...state.rank } });
          saveState();
          break;
        case 'panel_pos':
          Object.assign(state.panelPos, msg.data);
          broadcast({ type: 'panel_pos', data: { ...state.panelPos } });
          saveState();
          break;
      }
    });
  });
  console.log('[Strinova] WS attached at /ws/strinova');
}

function doSpin() {
  const result = spinRoulette();
  const L = result.left, R = result.right;
  const spinResult = {
    left: { name: L.name, displayName: L.name.toUpperCase(), faction: L.faction, file: L.file },
    right: { name: R.name, displayName: R.name.toUpperCase(), faction: R.faction, file: R.file }
  };

  state.showRoulette = true;
  state.history.push({
    left: { name: L.name, displayName: L.name.toUpperCase(), faction: L.faction },
    right: { name: R.name, displayName: R.name.toUpperCase(), faction: R.faction },
    timestamp: Date.now()
  });
  broadcast({ type: 'show_roulette', show: true });
  broadcast({ type: 'spin', result: spinResult });
  broadcast({ type: 'history_update', history: state.history });
  showListTemporarily();
  saveState();
}

function showRankTemporarily() {
  if (showRankTimeout) clearTimeout(showRankTimeout);
  state.rankVisible = true;
  broadcast({ type: 'toggle_rank', visible: true });
    showRankTimeout = setTimeout(() => {
    state.rankVisible = false;
    broadcast({ type: 'toggle_rank', visible: false });
    saveState();
    showRankTimeout = null;
  }, 20000);
  saveState();
}

function showListTemporarily() {
  if (showListTimeout) clearTimeout(showListTimeout);
  state.listVisible = true;
  broadcast({ type: 'toggle_list', visible: true });
    showListTimeout = setTimeout(() => {
    state.listVisible = false;
    broadcast({ type: 'toggle_list', visible: false });
    saveState();
    showListTimeout = null;
  }, 20000);
  saveState();
}

function handleChatMessage(data) {
  const payload = data.payload;
  const content = (payload.content || '').trim().toLowerCase();
  if (!content) return;

  if (content === '!rank') {
    showRankTemporarily();
  } else if (content === '!rulet') {
    showListTemporarily();
  }
}

function init() {
  loadState();
  eventBus.on('chat.message.sent', handleChatMessage);
  eventBus.on('strinova:spin', () => doSpin());
  console.log('[Strinova] Modulo cargado — event bus conectado');
}

const router = express.Router();

router.use(express.static(PUBLIC));

router.get('/api/status', (_req, res) => res.json({ ok: true }));

router.get('*', (req, res) => {
  let filePath = path.join(PUBLIC, req.path === '/' ? 'control.html' : decodeURI(req.path));
  if (!filePath.startsWith(PUBLIC)) { res.status(403).end(); return; }
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.status(404).send('Not found'); return; }
    res.set('Content-Type', MIME[ext] || 'application/octet-stream');
    res.send(data);
  });
});

module.exports = { router, initWs, init, state, doSpin };
