const REPETITIONS = 20;
const CARD_HEIGHT = 439;

let ws, connected = false;
let state = {
  history: [], lastResult: null, listVisible: false, rankVisible: true, showRoulette: false,
  roulettePos: { scale: 100, x: 0, y: 0, frontY: 0 },
  rankPos: { scale: 100, x: 0, y: 0 },
  panelPos: { scale: 100, x: 0, y: 0 },
  rank: { rankIndex: 0, tierIndex: 0, score: 1000, wins: 0, losses: 0 }
};
let spinning = false;

const listaEl = document.getElementById('lista-contenido');
const listaCount = document.getElementById('lista-count');
const reelL = document.getElementById('reel-left');
const reelR = document.getElementById('reel-right');
const slotL = document.getElementById('slot-left');
const slotR = document.getElementById('slot-right');
const flashL = document.getElementById('flash-left');
const flashR = document.getElementById('flash-right');
const nameL = document.getElementById('name-left');
const nameR = document.getElementById('name-right');
const sfx = document.getElementById('sfx-slot');
const rouletteArea = document.getElementById('roulette-area');
const rouletteTransform = document.getElementById('roulette-transform');
const rankTransform = document.getElementById('rank-transform');
const panelTransform = document.getElementById('panel-transform');
const rankCard = document.getElementById('rank-card');

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onopen = () => { connected = true; };
  ws.onclose = () => { connected = false; setTimeout(connect, 3000); };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case 'init': state = msg.state; renderAll(); break;
      case 'spin': if (!spinning) handleSpin(msg.result); break;
      case 'history_update': state.history = msg.history; renderLista(); break;
      case 'toggle_list': state.listVisible = msg.visible; toggleLista(); break;
      case 'toggle_rank': state.rankVisible = msg.visible; toggleRank(); break;
      case 'show_roulette': state.showRoulette = msg.show; toggleRoulette(); break;
      case 'roulette_pos': Object.assign(state.roulettePos, msg.data); applyPosition('roulette'); break;
      case 'rank_pos': Object.assign(state.rankPos, msg.data); applyPosition('rank'); break;
      case 'panel_pos': Object.assign(state.panelPos, msg.data); applyPosition('panel'); break;
      case 'rank_update': state.rank = msg.data; renderRank(); break;
    }
  };
  ws.onerror = () => ws.close();
}
connect();

function applyPosition(type) {
  let el, pos;
  if (type === 'roulette') { el = rouletteTransform; pos = state.roulettePos; }
  else if (type === 'rank') { el = rankTransform; pos = state.rankPos; }
  else if (type === 'panel') { el = panelTransform; pos = state.panelPos; }

  if (type === 'panel') {
    el.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${pos.scale / 100})`;
  } else {
    el.style.transform = `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px)) scale(${pos.scale / 100})`;
  }

  if (type === 'roulette') {
    document.getElementById('overlay-front').style.transform = `translateX(-50%) translateY(${state.roulettePos.frontY || 0}px)`;
  }
}

/* ── ROULETTE ── */

function setupReel(reel, faction, items) {
  reel.innerHTML = '';
  for (let i = 0; i < REPETITIONS; i++) {
    items.forEach(c => {
      const card = document.createElement('div');
      card.className = 'card';
      const img = document.createElement('img');
      img.src = `assets/characters/${faction}/${c.file}`;
      card.appendChild(img);
      reel.appendChild(card);
    });
  }
}

function handleSpin(result) {
  spinning = true;
  const { left, right } = result;

  nameL.classList.remove('show');
  nameR.classList.remove('show');
  nameL.className = 'character-name';
  nameR.className = 'character-name';
  nameL.textContent = '';
  nameR.textContent = '';
  slotL.classList.remove('urbino');
  slotR.classList.remove('urbino');
  rouletteArea.classList.remove('fade-out', 'hidden');
  flashL.classList.remove('active');
  flashR.classList.remove('active');

  const lChars = CHARACTERS[left.faction];
  const rChars = CHARACTERS[right.faction];
  const lIdx = lChars.findIndex(c => c.name === left.name);
  const rIdx = rChars.findIndex(c => c.name === right.name);

  setupReel(reelL, left.faction, lChars);
  setupReel(reelR, right.faction, rChars);

  reelL.style.transition = 'none';
  reelR.style.transition = 'none';
  reelL.style.transform = 'translateY(0)';
  reelR.style.transform = 'translateY(0)';
  void reelL.offsetHeight;

  sfx.currentTime = 0;
  sfx.play().catch(() => {});

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const totalL = lChars.length * REPETITIONS;
      const totalR = rChars.length * REPETITIONS;
      const finalL = (totalL - lChars.length + lIdx) * CARD_HEIGHT;
      const finalR = (totalR - rChars.length + rIdx) * CARD_HEIGHT;
      reelL.style.transition = 'transform 5s cubic-bezier(0.1, 0, 0.1, 1)';
      reelR.style.transition = 'transform 5s cubic-bezier(0.1, 0, 0.1, 1)';
      reelL.style.transform = `translateY(-${finalL}px)`;
      reelR.style.transform = `translateY(-${finalR}px)`;
    });
  });

  setTimeout(() => {
    flashL.classList.remove('active'); void flashL.offsetHeight; flashL.classList.add('active');
    flashR.classList.remove('active'); void flashR.offsetHeight; flashR.classList.add('active');
  }, 5000);

  setTimeout(() => {
    nameL.textContent = left.displayName;
    nameR.textContent = right.displayName;
    nameL.classList.add('show', `faction-${left.faction}`);
    nameR.classList.add('show', `faction-${right.faction}`);
  }, 5600);

  setTimeout(() => {
    rouletteArea.classList.add('fade-out');
    setTimeout(() => {
      rouletteArea.classList.add('hidden');
      rouletteArea.classList.remove('fade-out');
      spinning = false;
    }, 2200);
  }, 16000);
}

/* ── LIST ── */

function renderLista() {
  listaCount.textContent = state.history.length;
  listaEl.innerHTML = '';
  state.history.forEach((entry, i) => {
    const div = document.createElement('div');
    div.className = 'lista-item';
    const isUrbino = entry.left.faction === 'urbino';
    let names = '';
    if (isUrbino) {
      names = `<span class="char-name" style="color:${FACTIONS[entry.left.faction]?.color || '#fff'}">${entry.left.displayName}</span>`;
    } else {
      names = `<span class="char-name" style="color:${FACTIONS[entry.left.faction]?.color || '#fff'}">${entry.left.displayName}</span><span class="char-sep">+</span><span class="char-name" style="color:${FACTIONS[entry.right.faction]?.color || '#fff'}">${entry.right.displayName}</span>`;
    }
    div.innerHTML = `<span class="item-num">#${i + 1}</span><span class="item-names">${names}</span>`;
    listaEl.appendChild(div);
  });
}

function toggleLista() {
  document.getElementById('panel-lista').classList.toggle('hidden', !state.listVisible);
}

function toggleRoulette() {
  if (state.showRoulette) {
    rouletteArea.classList.remove('hidden');
  } else if (!spinning) {
    rouletteArea.classList.add('hidden');
  }
}

/* ── RANK (matches original kala elo overlay) ── */

function renderRank() {
  const rank = RANKS[state.rank.rankIndex];
  if (!rank) return;
  const tier = rank.tiers[state.rank.tierIndex] || '';

  rankCard.className = rankCard.className.split(' ').filter(c => !c.startsWith('theme-')).join(' ') + ` theme-${rank.id}`;

  document.getElementById('rank-image').src = `assets/ranks/${rank.image}`;
  document.getElementById('rank-name').textContent = rank.name.toUpperCase();
  document.getElementById('rank-tier').textContent = tier;
  document.getElementById('current-score').textContent = state.rank.score;
  document.getElementById('wins-count').textContent = state.rank.wins;
  document.getElementById('losses-count').textContent = state.rank.losses;

  const isSpecial = rank.id === 'superstring' || rank.id === 'singularity';
  rankCard.classList.toggle('no-progress', isSpecial);

  if (!isSpecial) {
    const points = (state.rank.score || 0) % 100;
    document.getElementById('points-val').textContent = `${points}/100`;
    for (let i = 0; i < 5; i++) {
      const fill = document.getElementById(`fill-${i}`);
      const min = i * 20;
      const max = (i + 1) * 20;
      let pct = 0;
      if (points >= max) pct = 100;
      else if (points > min) pct = ((points - min) / 20) * 100;
      fill.style.width = `${pct}%`;
    }
  }
}

function toggleRank() {
  rankTransform.classList.toggle('hidden', !state.rankVisible);
}

/* ── ALL ── */

function renderAll() {
  renderLista();
  renderRank();
  toggleLista();
  toggleRank();
  applyPosition('roulette');
  applyPosition('rank');
  applyPosition('panel');
  toggleRoulette();
}

renderAll();
