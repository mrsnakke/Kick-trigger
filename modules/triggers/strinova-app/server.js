const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 3231;
const PUBLIC = path.join(__dirname, 'public');

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

const STATE_FILE = path.join(__dirname, 'state.json');

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

loadState();

function send(ws, msg) { ws.send(JSON.stringify(msg)); }
function broadcast(wss, msg) { const d = JSON.stringify(msg); wss.clients.forEach(c => { if (c.readyState === 1) c.send(d); }); }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = path.join(PUBLIC, url.pathname === '/' ? 'control.html' : decodeURI(url.pathname));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
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
        broadcast(wss, { type: 'show_roulette', show: true });
        broadcast(wss, { type: 'spin', result: msg.result });
        broadcast(wss, { type: 'history_update', history: state.history });
        saveState();
        break;
      case 'clear_history':
        state.history = [];
        broadcast(wss, { type: 'history_update', history: state.history });
        saveState();
        break;
      case 'remove_from_history':
        if (msg.index >= 0 && msg.index < state.history.length) {
          state.history.splice(msg.index, 1);
          broadcast(wss, { type: 'history_update', history: state.history });
          saveState();
        }
        break;
      case 'toggle_list':
        state.listVisible = msg.visible;
        broadcast(wss, { type: 'toggle_list', visible: state.listVisible });
        saveState();
        break;
      case 'toggle_rank':
        state.rankVisible = msg.visible;
        broadcast(wss, { type: 'toggle_rank', visible: state.rankVisible });
        saveState();
        break;
      case 'show_roulette':
        state.showRoulette = msg.show;
        broadcast(wss, { type: 'show_roulette', show: msg.show });
        saveState();
        break;
      case 'roulette_pos':
        Object.assign(state.roulettePos, msg.data);
        broadcast(wss, { type: 'roulette_pos', data: { ...state.roulettePos } });
        saveState();
        break;
      case 'rank_pos':
        Object.assign(state.rankPos, msg.data);
        broadcast(wss, { type: 'rank_pos', data: { ...state.rankPos } });
        saveState();
        break;
      case 'rank_update':
        Object.assign(state.rank, msg.data);
        broadcast(wss, { type: 'rank_update', data: { ...state.rank } });
        saveState();
        break;
      case 'panel_pos':
        Object.assign(state.panelPos, msg.data);
        broadcast(wss, { type: 'panel_pos', data: { ...state.panelPos } });
        saveState();
        break;
    }
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Server: http://0.0.0.0:${PORT}`));
