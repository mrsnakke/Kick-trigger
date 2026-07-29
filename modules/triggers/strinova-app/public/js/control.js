let ws, connected = false;
const state = {
  history: [], listVisible: true, rankVisible: true, showRoulette: false,
  roulettePos: { scale: 100, x: 0, y: 0 },
  rankPos: { scale: 100, x: 0, y: 0 },
  rank: { rankIndex: 0, tierIndex: 0, score: 1000, wins: 0, losses: 0 }
};

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onopen = () => { connected = true; document.getElementById('status').className = 'online'; document.getElementById('status').textContent = 'Conectado'; document.getElementById('btn-spin').disabled = false; };
  ws.onclose = () => { connected = false; document.getElementById('status').className = 'offline'; document.getElementById('status').textContent = 'Desconectado'; document.getElementById('btn-spin').disabled = true; setTimeout(connect, 3000); };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'init') { Object.assign(state, msg.state); renderAll(); }
    if (msg.type === 'history_update') { state.history = msg.history; renderHistory(); }
  };
  ws.onerror = () => ws.close();
}
connect();

function send(msg) { if (connected) ws.send(JSON.stringify(msg)); }

/* ── Rank Grid ── */
const rankGrid = document.getElementById('rank-grid');
const tierSelect = document.getElementById('tier-select');

function initRankGrid() {
  rankGrid.innerHTML = '';
  RANKS.forEach((r, i) => {
    const item = document.createElement('div');
    item.className = `rank-item${state.rank.rankIndex === i ? ' active' : ''}`;
    item.innerHTML = `<img src="assets/ranks/${r.image}" alt="${r.name}"><span>${r.name}</span>`;
    item.onclick = () => selectRank(i);
    rankGrid.appendChild(item);
  });
}

function selectRank(index) {
  state.rank.rankIndex = index;
  state.rank.tierIndex = 0;
  document.querySelectorAll('.rank-item').forEach((el, i) => el.classList.toggle('active', i === index));
  updateTierOptions();
  sendRank();
}

function updateTierOptions() {
  const tiers = RANKS[state.rank.rankIndex].tiers;
  tierSelect.innerHTML = '';
  tiers.forEach((t, i) => {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = t || 'NO TIER';
    tierSelect.appendChild(opt);
  });
  tierSelect.value = state.rank.tierIndex;
}
tierSelect.addEventListener('change', () => { state.rank.tierIndex = parseInt(tierSelect.value); sendRank(); });

/* ── Score / W / L ── */
const scoreInput = document.getElementById('score-input');
const winsInput = document.getElementById('wins-input');
const lossesInput = document.getElementById('losses-input');
scoreInput.addEventListener('input', sendRank);
winsInput.addEventListener('input', sendRank);
lossesInput.addEventListener('input', sendRank);

function sendRank() {
  state.rank.score = parseInt(scoreInput.value) || 0;
  state.rank.wins = parseInt(winsInput.value) || 0;
  state.rank.losses = parseInt(lossesInput.value) || 0;
  send({ type: 'rank_update', data: { ...state.rank } });
}

document.querySelectorAll('.counter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    const delta = parseInt(btn.dataset.delta);
    const input = document.getElementById(`${target}-input`);
    let val = parseInt(input.value) + delta;
    if (val < 0) val = 0;
    input.value = val;
    sendRank();
  });
});

/* ── Reset ── */
document.getElementById('reset-btn').addEventListener('click', () => {
  if (!confirm('Reset all statistics?')) return;
  state.rank.rankIndex = 0; state.rank.tierIndex = 0; state.rank.score = 1000; state.rank.wins = 0; state.rank.losses = 0;
  scoreInput.value = 1000; winsInput.value = 0; lossesInput.value = 0;
  initRankGrid(); updateTierOptions(); sendRank();
});

/* ── Spin ── */
document.getElementById('btn-spin').addEventListener('click', () => {
  if (!connected) return;
  const result = spinRoulette();
  const L = result.left, R = result.right;
  send({ type: 'spin', result: { left: { name: L.name, displayName: L.name.toUpperCase(), faction: L.faction, file: L.file }, right: { name: R.name, displayName: R.name.toUpperCase(), faction: R.faction, file: R.file } } });
  document.getElementById('last-result').classList.remove('hidden');
  document.getElementById('result-name').textContent = L.faction === 'urbino' ? L.name.toUpperCase() : `${L.name.toUpperCase()} + ${R.name.toUpperCase()}`;
  const fc = document.getElementById('result-faction');
  fc.textContent = L.faction === 'urbino' ? FACTIONS[L.faction].label : `${FACTIONS[L.faction].label} + ${FACTIONS[R.faction].label}`;
  fc.style.background = L.faction === 'urbino' ? FACTIONS[L.faction].color : `linear-gradient(90deg, ${FACTIONS[L.faction].color}, ${FACTIONS[R.faction].color})`;
});

/* ── History ── */
document.getElementById('btn-clear').addEventListener('click', () => send({ type: 'clear_history' }));

function renderHistory() {
  const list = document.getElementById('history-list');
  document.getElementById('history-count').textContent = state.history.length;
  document.getElementById('btn-clear').disabled = state.history.length === 0;
  list.innerHTML = '';
  state.history.forEach((entry, i) => {
    const div = document.createElement('div');
    div.className = 'history-item';
    const isUrbino = entry.left.faction === 'urbino' && entry.right.faction === 'urbino';
    div.style.borderLeftColor = FACTIONS[entry.left.faction]?.color || '#555';
    let names = '';
    if (isUrbino) {
      names = `<span class="char-name" style="color:${FACTIONS[entry.left.faction]?.color || '#fff'}">${entry.left.displayName}</span>`;
    } else {
      names = `<span class="char-name" style="color:${FACTIONS[entry.left.faction]?.color || '#fff'}">${entry.left.displayName}</span><span class="char-sep">+</span><span class="char-name" style="color:${FACTIONS[entry.right.faction]?.color || '#fff'}">${entry.right.displayName}</span>`;
    }
    div.innerHTML = `<span class="item-num">#${i + 1}</span><span class="item-names">${names}</span><button class="item-del" data-index="${i}">✕</button>`;
    div.querySelector('.item-del').addEventListener('click', () => send({ type: 'remove_from_history', index: i }));
    list.appendChild(div);
  });
}

/* ── Toggles ── */
document.getElementById('toggle-list').addEventListener('click', (e) => {
  state.listVisible = !state.listVisible;
  e.target.textContent = state.listVisible ? 'Visible' : 'Oculto';
  e.target.className = 'toggle ' + (state.listVisible ? 'on' : 'off');
  send({ type: 'toggle_list', visible: state.listVisible });
});
document.getElementById('toggle-rank').addEventListener('click', (e) => {
  state.rankVisible = !state.rankVisible;
  e.target.textContent = state.rankVisible ? 'Visible' : 'Oculto';
  e.target.className = 'toggle ' + (state.rankVisible ? 'on' : 'off');
  send({ type: 'toggle_rank', visible: state.rankVisible });
});
document.getElementById('toggle-roulette').addEventListener('click', (e) => {
  state.showRoulette = !state.showRoulette;
  e.target.textContent = state.showRoulette ? 'Visible' : 'Oculto';
  e.target.className = 'toggle ' + (state.showRoulette ? 'on' : 'off');
  send({ type: 'show_roulette', show: state.showRoulette });
});

/* ── Position sliders ── */
const POS_KEYS = { roulette_pos: 'roulettePos', rank_pos: 'rankPos', panel_pos: 'panelPos' };
function setupPositionSlider(id, valId, msgType, key) {
  const slider = document.getElementById(id);
  const valEl = document.getElementById(valId);
  slider.addEventListener('input', () => {
    const v = parseInt(slider.value);
    valEl.textContent = key === 'scale' ? `${v}%` : v;
    state[POS_KEYS[msgType]][key] = v;
    send({ type: msgType, data: { ...state[POS_KEYS[msgType]] } });
  });
}
setupPositionSlider('roulette-scale', 'roulette-scale-val', 'roulette_pos', 'scale');
setupPositionSlider('roulette-x', 'roulette-x-val', 'roulette_pos', 'x');
setupPositionSlider('roulette-y', 'roulette-y-val', 'roulette_pos', 'y');
setupPositionSlider('roulette-front-y', 'roulette-front-y-val', 'roulette_pos', 'frontY');
setupPositionSlider('rank-scale', 'rank-scale-val', 'rank_pos', 'scale');
setupPositionSlider('rank-x', 'rank-x-val', 'rank_pos', 'x');
setupPositionSlider('rank-y', 'rank-y-val', 'rank_pos', 'y');
setupPositionSlider('panel-scale', 'panel-scale-val', 'panel_pos', 'scale');
setupPositionSlider('panel-x', 'panel-x-val', 'panel_pos', 'x');
setupPositionSlider('panel-y', 'panel-y-val', 'panel_pos', 'y');

/* ── Copy URL ── */
document.getElementById('copy-url').addEventListener('click', () => {
  const url = `${location.protocol}//${location.hostname}:${location.port}/overlay.html`;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('copy-url');
    const t = btn.textContent;
    btn.textContent = '✓ Copiado';
    setTimeout(() => btn.textContent = t, 2000);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  });
});

function setSlider(id, valId, val, key) {
  document.getElementById(id).value = val;
  document.getElementById(valId).textContent = key === 'scale' ? `${val}%` : val;
}

function renderAll() {
  initRankGrid(); updateTierOptions();
  scoreInput.value = state.rank.score; winsInput.value = state.rank.wins; lossesInput.value = state.rank.losses;
  renderHistory();
  document.getElementById('toggle-list').textContent = state.listVisible ? 'Visible' : 'Oculto';
  document.getElementById('toggle-list').className = 'toggle ' + (state.listVisible ? 'on' : 'off');
  document.getElementById('toggle-rank').textContent = state.rankVisible ? 'Visible' : 'Oculto';
  document.getElementById('toggle-rank').className = 'toggle ' + (state.rankVisible ? 'on' : 'off');
  document.getElementById('toggle-roulette').textContent = state.showRoulette ? 'Visible' : 'Oculto';
  document.getElementById('toggle-roulette').className = 'toggle ' + (state.showRoulette ? 'on' : 'off');
  setSlider('roulette-scale', 'roulette-scale-val', state.roulettePos.scale, 'scale');
  setSlider('roulette-x', 'roulette-x-val', state.roulettePos.x, 'x');
  setSlider('roulette-y', 'roulette-y-val', state.roulettePos.y, 'y');
  setSlider('roulette-front-y', 'roulette-front-y-val', state.roulettePos.frontY || 0, 'frontY');
  setSlider('rank-scale', 'rank-scale-val', state.rankPos.scale, 'scale');
  setSlider('rank-x', 'rank-x-val', state.rankPos.x, 'x');
  setSlider('rank-y', 'rank-y-val', state.rankPos.y, 'y');
  setSlider('panel-scale', 'panel-scale-val', state.panelPos.scale, 'scale');
  setSlider('panel-x', 'panel-x-val', state.panelPos.x, 'x');
  setSlider('panel-y', 'panel-y-val', state.panelPos.y, 'y');
}
