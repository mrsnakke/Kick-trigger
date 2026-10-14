/* GACHA — Lógica de animaciones de tiradas (single + multi) con Anime.js.
   Overlay transparente, sin interacción: reproduce en cola y se oculta solo. */

const $ = (id) => document.getElementById(id);

const gashaponAnimation = $('gashapon-animation');
const gashaponMachineImg = $('gashapon-machine-img');
const singlePullDisplay = $('single-pull-display');
const singlePullRedeemer = $('single-pull-redeemer');
const singlePullCard = $('single-pull-card');
const singleCharacterName = $('single-character-name');
const multiPullDisplay = $('multi-pull-display');
const multiPullGrid = $('multi-pull-grid');
const multiRarityRevealDisplay = $('multi-rarity-reveal-display');
const testMessageDisplay = $('test-message-display');

const anime = window.anime;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? Math.min(ms, 200) : ms));

const DUR = {
    gashapon: 500,
    single: 3600,
    multiClose: 3600,
    rarityReveal: 3600,
};

const STAR_PATH = 'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.538 1.118l-2.8-2.034a1 1 0 00-1.176 0l-2.8 2.034c-.783.57-1.838-.197-1.538-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.381-1.81.588-1.81h3.462a1 1 0 00.95-.69l1.07-3.292z';
const starSvg = () => `<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`;

function normRarity(rarity) {
    return (typeof rarity === 'string' && /^\d+_star$/.test(rarity)) ? rarity : '3_star';
}

function numericRarity(rarity) {
    const m = String(rarity || '').match(/^(\d+)_star$/);
    return m ? parseInt(m[1], 10) : 0;
}

/* ===================== Sonidos ===================== */
const SOUNDS = {
    common: 'sounds/ping estrella.mp3',
    rare: 'sounds/chime estrella.mp3',
    legendary: 'sounds/swell estrella.mp3',
    appear: 'sounds/character_appearance.ogg',
    flip: 'sounds/flipcard.mp3',
};

function playSound(src) {
    if (!src || reduceMotion) return;
    try {
        const audio = new Audio(src);
        audio.volume = 0.9;
        const p = audio.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) { /* ignora bloqueos de autoplay */ }
}

function playRaritySound(rarity) {
    const n = numericRarity(rarity);
    playSound(n >= 5 ? SOUNDS.legendary : n === 4 ? SOUNDS.rare : SOUNDS.common);
}

/* ===================== Construcción de cartas ===================== */
function createPullCard(data) {
    const rarity = normRarity(data && data.rarity);
    const n = numericRarity(rarity);

    const card = document.createElement('article');
    card.className = `pull-card rarity-${rarity}`;
    card.dataset.rarity = rarity;

    const frame = document.createElement('div');
    frame.className = 'pull-card__frame';
    const img = document.createElement('img');
    img.alt = (data && data.name) || '';
    img.loading = 'eager';
    if (data && data.image_url) img.src = data.image_url;
    frame.appendChild(img);

    const meta = document.createElement('div');
    meta.className = 'pull-card__meta';

    const name = document.createElement('div');
    name.className = 'pull-card__name';
    name.textContent = (data && data.name) || '';

    const stars = document.createElement('div');
    stars.className = 'pull-card__stars';
    stars.innerHTML = n > 0 ? starSvg().repeat(n) : '';

    meta.append(name, stars);
    card.append(frame, meta);
    return card;
}

/* ===================== Limpieza ===================== */
function hideAllDisplays() {
    [gashaponAnimation, singlePullDisplay, multiPullDisplay, multiRarityRevealDisplay, testMessageDisplay]
        .forEach((el) => el && el.classList.add('hidden'));

    if (multiRarityRevealDisplay) {
        multiRarityRevealDisplay.classList.remove('active');
        multiRarityRevealDisplay.innerHTML = '';
    }
    if (singlePullCard) singlePullCard.innerHTML = '';
    if (multiPullGrid) multiPullGrid.innerHTML = '';
    if (singlePullRedeemer) singlePullRedeemer.textContent = '';
    if (singleCharacterName) singleCharacterName.textContent = '';
}

/* ===================== Tirada simple ===================== */
async function displaySinglePull(redeemer, character) {
    singlePullRedeemer.textContent = `Tirada de: ${redeemer}`;
    singleCharacterName.textContent = (character && character.name) || '';

    singlePullCard.innerHTML = '';
    const card = createPullCard(character);
    singlePullCard.appendChild(card);

    singlePullDisplay.classList.remove('hidden');

    anime.set(card, { opacity: 0, scale: 0.6, rotateY: -35 });
    anime.set([singlePullRedeemer, singleCharacterName], { opacity: 0, translateY: 14 });

    await anime({
        targets: card,
        opacity: [0, 1],
        scale: [0.6, 1],
        rotateY: [-35, 0],
        duration: reduceMotion ? 300 : 900,
        easing: 'easeOutBack',
    }).finished;

    card.classList.add('is-revealed');
    playRaritySound(character && character.rarity);
    playSound(SOUNDS.appear);

    await anime({
        targets: [singlePullRedeemer, singleCharacterName],
        opacity: [0, 1],
        translateY: [14, 0],
        duration: reduceMotion ? 200 : 700,
        delay: anime.stagger(120),
    }).finished;

    await wait(DUR.single);
}

/* ===================== Tirada múltiple (x10) ===================== */
async function displayMultiPull(redeemer, characters) {
    const redeemerEl = document.createElement('div');
    redeemerEl.className = 'redeemer-name';
    redeemerEl.textContent = `Tirada de: ${redeemer}`;
    multiPullDisplay.insertBefore(redeemerEl, multiPullGrid);

    multiPullGrid.innerHTML = '';

    const cards = [];
    const rareCharacters = [];
    for (let i = 0; i < 10; i++) {
        const data = (characters && characters[i]) || { rarity: '3_star', name: '', image_url: '' };
        const card = createPullCard(data);
        multiPullGrid.appendChild(card);
        cards.push(card);
        if (numericRarity(data.rarity) >= 4) rareCharacters.push(data);
    }

    multiPullDisplay.classList.remove('hidden');
    anime.set(redeemerEl, { opacity: 0, translateY: 16 });
    anime.set(cards, { opacity: 0, scale: 0.7, translateY: 24 });

    await anime({
        targets: redeemerEl,
        opacity: [0, 1],
        translateY: [16, 0],
        duration: reduceMotion ? 200 : 700,
    }).finished;

    // Aparición escalonada por columna (izquierda → derecha, fila por fila)
    await Promise.all(cards.map((card, i) => {
        const col = i % 5;
        const row = Math.floor(i / 5);
        return anime({
            targets: card,
            opacity: [0, 1],
            scale: [0.7, 1],
            translateY: [24, 0],
            duration: reduceMotion ? 200 : 520,
            easing: 'easeOutBack',
            delay: reduceMotion ? 0 : col * 110 + row * 70,
        }).finished;
    }));

    // Reveal por rareza: las raras laten más fuerte y suenan
    for (const rarity of ['3_star', '4_star', '5_star']) {
        const group = cards.filter((c) => c.dataset.rarity === rarity);
        if (!group.length) continue;
        const big = numericRarity(rarity) >= 5;

        await anime({
            targets: group,
            scale: big ? [1, 1.18, 1] : [1, 1.07, 1],
            duration: reduceMotion ? 200 : (big ? 700 : 360),
            delay: reduceMotion ? 0 : anime.stagger(big ? 240 : 110),
            begin: () => {
                group.forEach((c) => c.classList.add('is-revealed'));
                playRaritySound(rarity);
            },
        }).finished;
    }

    await wait(DUR.multiClose);
    return rareCharacters;
}

/* ===================== Revelado ampliado de raros ===================== */
async function displayMultiRarityReveal(redeemer, characters) {
    if (!characters || !characters.length) return;

    multiRarityRevealDisplay.innerHTML = '';
    multiRarityRevealDisplay.classList.remove('hidden');
    multiRarityRevealDisplay.classList.add('active');

    const cards = characters.map((character) => {
        const card = createPullCard(character);
        multiRarityRevealDisplay.appendChild(card);
        return card;
    });

    anime.set(cards, { opacity: 0, scale: 0.5, translateY: 30 });

    await anime({
        targets: cards,
        opacity: [0, 1],
        scale: [0.5, 1],
        translateY: [30, 0],
        duration: reduceMotion ? 250 : 800,
        easing: 'easeOutBack',
        delay: reduceMotion ? 0 : anime.stagger(180),
    }).finished;

    for (let i = 0; i < cards.length; i++) {
        cards[i].classList.add('is-revealed');
        playRaritySound(characters[i] && characters[i].rarity);
        await wait(220);
    }

    await wait(DUR.rarityReveal);
    multiRarityRevealDisplay.classList.remove('active');
}

/* ===================== Orquestador ===================== */
const wishAnimation = (data) => new Promise(async (resolve) => {
    hideAllDisplays();

    gashaponMachineImg.src = `img/gashapon.gif?t=${Date.now()}`;
    gashaponAnimation.classList.remove('hidden');
    await wait(DUR.gashapon);
    gashaponAnimation.classList.add('hidden');

    if (data.pull_type === 'single' && data.character) {
        await displaySinglePull(data.redeemer, data.character);
    } else if (data.pull_type === 'multi' && data.characters) {
        const rareCharacters = await displayMultiPull(data.redeemer, data.characters);
        if (rareCharacters && rareCharacters.length > 0) {
            await displayMultiRarityReveal(data.redeemer, rareCharacters);
        }
    } else {
        console.warn('[gacha] datos de tirada incompletos o tipo desconocido:', data);
    }

    hideAllDisplays();
    resolve('gacha_wish_completed');
});

/* ===================== Cola ===================== */
const queue = [];
let isRunning = false;

function addToQueue(data) {
    queue.push(data);
    if (!isRunning) processQueue();
}

async function processQueue() {
    isRunning = true;
    while (queue.length > 0) {
        const data = queue.shift();
        try {
            await wishAnimation(data);
        } catch (error) {
            console.error('[gacha] error en wishAnimation:', error);
        }
    }
    isRunning = false;
}

/* ===================== API exportada ===================== */
export function handleSinglePullRequest(redeemer, character) {
    addToQueue({ pull_type: 'single', redeemer, character });
}

export function handleMultiPullRequest(redeemer, characters) {
    addToQueue({ pull_type: 'multi', redeemer, characters });
}

export function displayTestMessage(text) {
    if (!testMessageDisplay) return;
    testMessageDisplay.textContent = text;
    testMessageDisplay.classList.remove('hidden');
    setTimeout(() => testMessageDisplay.classList.add('hidden'), 5000);
}

/* ===================== Inicialización ===================== */
document.addEventListener('DOMContentLoaded', hideAllDisplays);
