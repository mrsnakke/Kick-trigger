/* GACHA — Controlador del overlay view.html
   Carta de personaje (!pj) e inventario (!Sinv).
   Sin interacción: cada evento se muestra en cola y se oculta solo. */

const WS_PATH = '/ws/gacha';

const TIMING = {
    IN: 1050,          // debe coincidir con la animación overlay-in (view.css)
    OUT: 700,          // debe coincidir con overlay-out
    CARD_DWELL: 5000,  // tiempo de permanencia de la carta
    CARD_DWELL_SHORT: 4200,
    INV_CYCLE: 20000,  // duración objetivo del ciclo de destacados del inventario
    INV_ITEM_MIN: 500, // tiempo mínimo por personaje
    INV_ITEM_MAX: 1400,// tiempo máximo por personaje
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Escala opcional del overlay: view.html?scale=1.2
const scaleParam = new URLSearchParams(window.location.search).get('scale');
if (scaleParam) {
    const s = parseFloat(scaleParam);
    if (s > 0) document.documentElement.style.setProperty('--scale', String(s));
}

const els = {
    card: document.getElementById('card-flipper'),
    cardStage: document.getElementById('character-card'),
    image: document.getElementById('character-image'),
    name: document.getElementById('character-name'),
    stars: document.getElementById('character-stars'),
    badge: document.getElementById('character-ownership'),
    total: document.getElementById('total-in-inventories'),
    owners: document.getElementById('character-owners'),

    invStage: document.getElementById('inventory-view'),
    invPanel: document.getElementById('inv-panel'),
    invTitle: document.getElementById('inv-title'),
    invHud: document.getElementById('inv-hud'),
    invStageEl: document.getElementById('inv-stage'),
    invPreview: document.getElementById('inv-preview'),
    invImage: document.getElementById('inv-image'),
    invFallback: document.getElementById('inv-fallback'),
    invName: document.getElementById('inv-name'),
    invStars: document.getElementById('inv-stars'),
    invNote: document.getElementById('inv-note'),
    invProgFill: document.getElementById('inv-prog-fill'),
    invProgCount: document.getElementById('inv-prog-count'),
    invMissing: document.getElementById('inv-missing'),
    invMissingCount: document.getElementById('inv-missing-count'),

    wsStatus: document.getElementById('websocket-status-indicator'),
};

/* ===================== Utilidades ===================== */
const STAR_PATH = 'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.538 1.118l-2.8-2.034a1 1 0 00-1.176 0l-2.8 2.034c-.783.57-1.838-.197-1.538-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.381-1.81.588-1.81h3.462a1 1 0 00.95-.69l1.07-3.292z';

function starSvg() {
    return `<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`;
}

function preload(src) {
    return new Promise((resolve) => {
        if (!src) return resolve();
        const img = new Image();
        img.onload = () => {
            if (typeof img.decode === 'function') img.decode().then(resolve, resolve);
            else resolve();
        };
        img.onerror = resolve;
        img.src = src;
    });
}

function ownerNames(owners) {
    return (owners || [])
        .map((o) => {
            const raw = String((o && o.userName) || '').trim();
            const m = raw.match(/\(([^)]+)\)/);
            return (m && m[1] ? m[1] : raw).trim();
        })
        .filter((n) => n && n.toLowerCase() !== '%user%');
}

/* ===================== Carta de personaje ===================== */
function setStars(quality) {
    const n = Math.max(0, Math.min(6, parseInt(quality, 10) || 0));
    els.stars.innerHTML = n > 0 ? starSvg().repeat(n) : '';
    els.stars.classList.remove('r3', 'r4', 'r5');
    els.stars.classList.add(n >= 5 ? 'r5' : n === 4 ? 'r4' : 'r3');
    els.stars.style.display = n > 0 ? '' : 'none';
}

function renderOwners(names) {
    const track = els.owners;
    track.innerHTML = '';
    track.classList.remove('is-marquee', 'is-static');
    track.style.removeProperty('--marquee-duration');

    if (!names.length) {
        track.classList.add('is-static');
        const empty = document.createElement('span');
        empty.className = 'owner owner--empty';
        empty.textContent = 'Nadie tiene este personaje aún';
        track.appendChild(empty);
        return;
    }

    const buildGroup = () => {
        const group = document.createElement('span');
        group.className = 'owners__group';
        for (const n of names) {
            const owner = document.createElement('span');
            owner.className = 'owner';
            owner.textContent = n;
            group.appendChild(owner);
        }
        return group;
    };

    if (names.length <= 3) {
        track.classList.add('is-static');
        track.appendChild(buildGroup());
    } else {
        track.classList.add('is-marquee');
        track.appendChild(buildGroup());
        track.appendChild(buildGroup()); // segunda copia para el loop continuo
        track.style.setProperty('--marquee-duration', `${Math.max(14, names.length * 1.8)}s`);
    }
}

async function showStage(stage, panel, dwell) {
    stage.classList.remove('hidden');
    panel.classList.remove('is-in', 'is-out');
    void panel.offsetWidth; // reinicia la animación
    panel.classList.add('is-in');
    await wait(TIMING.IN + dwell);
    panel.classList.replace('is-in', 'is-out');
    await wait(TIMING.OUT);
    panel.classList.remove('is-out');
    stage.classList.add('hidden');
}

async function showCharacter(data) {
    const c = (data && data.character) || {};
    await preload(c.image);

    els.name.textContent = String(c.name || '').toUpperCase();
    els.image.src = c.image || '';
    els.image.alt = c.name || '';
    els.image.style.objectPosition = c.imagePosition || 'center top';
    setStars(c.quality);

    const owns = !!(data && data.userOwnsCharacter);
    els.badge.textContent = owns ? '¡Lo tienes!' : '¡No lo tienes!';
    els.badge.classList.toggle('badge--own', owns);
    els.badge.classList.toggle('badge--miss', !owns);
    els.total.textContent = Number((data && data.totalInInventories) || 0).toLocaleString('es');

    const names = ownerNames(data && data.owners);
    renderOwners(names);

    const dwell = names.length > 3 ? TIMING.CARD_DWELL : TIMING.CARD_DWELL_SHORT;
    await showStage(els.cardStage, els.card, dwell);
}

/* ===================== Inventario (vitrina de colección) ===================== */
function numericRarity(rarity) {
    if (typeof rarity === 'number') return rarity;
    const m = String(rarity || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
}

function rarityClass(rarity) {
    const n = numericRarity(rarity);
    return n >= 5 ? 'r5' : n === 4 ? 'r4' : 'r3';
}

function hudChip(label, value) {
    const wrap = document.createElement('div');
    wrap.className = 'hud';
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('b');
    v.textContent = String(value);
    wrap.append(l, v);
    return wrap;
}

function hudPity(pity5, hardPity) {
    const wrap = document.createElement('div');
    wrap.className = 'hud';
    const l = document.createElement('span');
    l.textContent = 'Pity 5★';
    const v = document.createElement('b');
    v.textContent = `${pity5}/${hardPity}`;

    const bar = document.createElement('span');
    bar.className = 'mini-prog';
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(0, Math.min(100, (pity5 / (hardPity || 90)) * 100))}%`;
    bar.appendChild(fill);

    wrap.append(l, v, bar);
    return wrap;
}

function renderMissing(missing) {
    const strip = els.invMissing;
    strip.innerHTML = '';

    if (!missing.length) {
        const empty = document.createElement('span');
        empty.className = 'inv__note';
        empty.textContent = '¡Tienes todo lo obtenible!';
        strip.appendChild(empty);
        els.invMissingCount.textContent = '';
        return;
    }

    const MAX = 30;
    const frag = document.createDocumentFragment();
    for (const item of missing.slice(0, MAX)) {
        const thumb = document.createElement('div');
        thumb.className = 'missing-thumb';
        thumb.title = item.name;
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = item.name;
        if (item.image) img.src = item.image;
        thumb.appendChild(img);
        frag.appendChild(thumb);
    }
    if (missing.length > MAX) {
        const more = document.createElement('div');
        more.className = 'missing-more';
        more.textContent = `+${missing.length - MAX}`;
        frag.appendChild(more);
    }
    strip.appendChild(frag);
    els.invMissingCount.textContent = String(missing.length);
}

function setInvStars(rarity) {
    const n = Math.max(0, Math.min(6, numericRarity(rarity)));
    els.invStars.innerHTML = n > 0 ? starSvg().repeat(n) : '';
    els.invStars.classList.remove('r3', 'r4', 'r5');
    els.invStars.classList.add(rarityClass(rarity));
}

function renderHighlight(item) {
    const name = (item && item.name) || '';

    els.invPreview.classList.remove('r3', 'r4', 'r5');
    els.invPreview.classList.add(rarityClass(item && item.rarity));
    els.invFallback.textContent = (name[0] || '?').toUpperCase();

    if (item && item.image) {
        els.invFallback.style.display = 'none';
        els.invImage.style.visibility = 'visible';
        els.invImage.src = item.image;
        els.invImage.alt = name;
    } else {
        els.invImage.style.visibility = 'hidden';
        els.invFallback.style.display = 'grid';
    }

    els.invName.textContent = name.toUpperCase();
    setInvStars(item && item.rarity);

    els.invStageEl.classList.remove('is-swap');
    void els.invStageEl.offsetWidth; // reinicia la animación de cambio
    els.invStageEl.classList.add('is-swap');
}

async function showInventory(data) {
    const user = String((data && data.userName) || 'jugador').toUpperCase();
    els.invTitle.textContent = `Inventario — ${user}`;

    els.invHud.innerHTML = '';
    els.invHud.appendChild(hudChip('Llaves', (data && data.keys) ?? 0));
    els.invHud.appendChild(hudChip('Tiradas', (data && data.totalPulls) ?? 0));
    const hardPity = Number((data && data.hardPity) || 90);
    els.invHud.appendChild(hudPity(Number((data && data.pity5) || 0), hardPity));

    const obt = (data && data.obtainable) || { total: 0, owned: 0, missing: [] };
    const pct = obt.total ? Math.max(0, Math.min(100, (obt.owned / obt.total) * 100)) : 0;
    els.invProgFill.style.width = `${pct}%`;
    els.invProgCount.textContent = `${obt.owned} / ${obt.total}`;
    renderMissing(obt.missing || []);

    els.invNote.textContent = '';

    els.invStage.classList.remove('hidden');
    els.invPanel.classList.remove('is-in', 'is-out');
    void els.invPanel.offsetWidth;
    els.invPanel.classList.add('is-in');
    await wait(TIMING.IN);

    const highlights = (data && data.highlights) || [];
    if (highlights.length) {
        const per = Math.max(
            TIMING.INV_ITEM_MIN,
            Math.min(TIMING.INV_ITEM_MAX, Math.round(TIMING.INV_CYCLE / highlights.length))
        );

        for (let i = 0; i < highlights.length; i++) {
            await preload(highlights[i].image);
            renderHighlight(highlights[i]);
            const next = highlights[i + 1];
            if (next) preload(next.image); // precarga el siguiente mientras se muestra este
            await wait(per);
        }
    } else {
        els.invPreview.classList.remove('r3', 'r4', 'r5');
        els.invPreview.classList.add('r5');
        els.invImage.style.visibility = 'hidden';
        els.invFallback.style.display = 'grid';
        els.invFallback.textContent = '★';
        els.invName.textContent = 'AÚN NO TIENES 4★ NI 5★';
        els.invStars.innerHTML = '';
        els.invNote.textContent = 'Sigue tirando para conseguirlos';
        await wait(3000);
    }

    els.invPanel.classList.replace('is-in', 'is-out');
    await wait(TIMING.OUT);
    els.invPanel.classList.remove('is-out');
    els.invStage.classList.add('hidden');
}

/* ===================== Cola ===================== */
const queue = [];
let running = false;

function enqueue(job) {
    queue.push(job);
    if (!running) drain();
}

async function drain() {
    running = true;
    while (queue.length) {
        const job = queue.shift();
        try {
            await job();
        } catch (err) {
            console.error('[view] error en el trabajo de overlay:', err);
        }
    }
    running = false;
}

/* ===================== WebSocket ===================== */
function connect() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}${WS_PATH}`);

    ws.onopen = () => {
        console.log('[view] WebSocket conectado');
        if (els.wsStatus) els.wsStatus.classList.add('connected');
    };

    ws.onmessage = (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch (err) {
            console.error('[view] JSON inválido:', err);
            return;
        }

        // Tolerante a los dos formatos de envelope usados en el módulo: {type} y {event}
        const kind = msg.type || msg.event;
        const data = msg.data || msg;

        if (kind === 'showCharacter' || kind === 'show_character') {
            enqueue(() => showCharacter(data));
        } else if (kind === 'showInventory' || kind === 'show_inventory') {
            enqueue(() => showInventory(data));
        }
    };

    ws.onclose = () => {
        console.log('[view] WebSocket desconectado, reintentando en 3s...');
        if (els.wsStatus) els.wsStatus.classList.remove('connected');
        setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
        console.error('[view] WebSocket error:', err);
        ws.close();
    };
}

/* ===================== Arranque ===================== */
els.invImage.addEventListener('load', () => {
    els.invImage.style.visibility = 'visible';
    els.invFallback.style.display = 'none';
});

els.invImage.addEventListener('error', () => {
    els.invImage.style.visibility = 'hidden';
    els.invFallback.style.display = 'grid';
});

connect();
