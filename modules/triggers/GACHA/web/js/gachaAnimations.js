/* Lógica de Animaciones del Gachapon - Refactorizada con Anime.js */

// --- Elementos del DOM ---
const gashaponAnimation = document.getElementById('gashapon-animation');
const gashaponMachineImg = document.getElementById('gashapon-machine-img');
const singlePullDisplay = document.getElementById('single-pull-display');
const singlePullRedeemer = document.getElementById('single-pull-redeemer');
const singleCharacterImage = document.getElementById('single-character-image');
const singleCharacterName = document.getElementById('single-character-name');
const multiPullDisplay = document.getElementById('multi-pull-display');
const multiPullGrid = document.getElementById('multi-pull-grid');
const multiRarityRevealDisplay = document.getElementById('multi-rarity-reveal-display'); // Nuevo elemento
const testMessageDisplay = document.getElementById('test-message-display');

// --- Configuración ---
const GASHAPON_ANIMATION_DURATION = 500;
const SINGLE_PULL_DISPLAY_DURATION = 4200;
const MULTI_PULL_CLOSE_DELAY = 3800;
const MULTI_RARITY_REVEAL_DURATION = 4000; // Duración para la animación de revelado de raros

let queue = [];
let isRunning = false;

// --- Utilidades ---
function hideAllDisplays() {
    gashaponAnimation.classList.add('hidden');
    singlePullDisplay.classList.add('hidden');
    multiPullDisplay.classList.add('hidden');
    multiRarityRevealDisplay.classList.add('hidden'); // Ocultar el nuevo display
    multiRarityRevealDisplay.classList.remove('active'); // Desactivar clase activa
    testMessageDisplay.classList.add('hidden');
    
    const singleBubble = singlePullDisplay.querySelector('.single-bubble');
    if (singleBubble) {
        singleBubble.className = 'single-bubble';
        anime.set(singleBubble, { scale: 0, opacity: 0 });
    }
    
    multiPullGrid.innerHTML = '';
    multiRarityRevealDisplay.innerHTML = ''; // Limpiar el nuevo display
    singleCharacterImage.src = '';
    singlePullRedeemer.textContent = '';
    singleCharacterName.textContent = '';

    const existingRedeemer = multiPullDisplay.querySelector('.redeemer-name');
    if (existingRedeemer) existingRedeemer.remove();
}

function getNumericRarity(rarity) {
    if (typeof rarity === 'number') return rarity;
    if (typeof rarity === 'string') {
        const match = rarity.match(/^(\d+)_star$/);
        return match ? parseInt(match[1], 10) : 0;
    }
    return 0;
}

async function playSound(audioElement) {
    try {
        audioElement.currentTime = 0;
        await audioElement.play();
    } catch (error) {
        console.warn("Error al reproducir sonido:", error.message);
    }
}

async function putStars(rarity, targetDiv) {
    if (!targetDiv) return;
    targetDiv.innerHTML = '';
    const numericRarity = getNumericRarity(rarity);
    const starSounds = {
        common: new Audio("sounds/ping estrella.mp3"),
        rare: new Audio("sounds/chime estrella.mp3"),
        legendary: new Audio("sounds/swell estrella.mp3")
    };

    const totalStars = numericRarity;
    const startAngle = -90 - (totalStars - 1) * 15 / 2; // Ajustar el ángulo inicial para centrar las estrellas

    // Obtener el tamaño de la burbuja padre para calcular el radio dinámicamente
    const parentBubble = targetDiv.parentElement;
    let bubbleSize = 0;
    if (parentBubble) {
        // Usar offsetWidth para obtener el tamaño real en píxeles
        bubbleSize = parentBubble.offsetWidth; 
    }
    // El star-container es 120% de la burbuja, así que su radio es 0.6 * bubbleSize
    // Queremos que las estrellas estén justo fuera de la burbuja, así que el radio de traslación
    // debería ser aproximadamente la mitad del tamaño de la burbuja + un pequeño margen.
    // O, más directamente, el radio del star-container.
    const translationRadius = (bubbleSize * 0.9); // Aumentar el radio de traslación para separar las estrellas
    const angleIncrement = 15; // Incremento de ángulo entre estrellas

    for (let i = 0; i < totalStars; i++) {
        const star_icon = document.createElement('span');
        star_icon.textContent = '✮'; // Carácter de estrella
        star_icon.className = `star-icon rarity-${numericRarity}`;
        targetDiv.append(star_icon);

        const currentAngle = startAngle + i * angleIncrement; // Ángulo para cada estrella en grados
        const angleRadians = currentAngle * (Math.PI / 180); // Convertir a radianes

        // Calcular las coordenadas X e Y para posicionar la estrella en el arco
        // El centro del star-container es (0,0) para estas transformaciones
        const x = translationRadius * Math.sin(angleRadians);
        const y = -translationRadius * Math.cos(angleRadians); // Negativo para mover hacia arriba

        // Establecer la posición y rotación inicial (final) de la estrella
        // El CSS ya centra el elemento con translate(-50%, -50%)
        // Para que las estrellas se distribuyan en un arco, necesitamos que la rotación del arco
        // se aplique alrededor del centro del star-container, y luego la estrella se traslade radialmente.
        // La rotación del carácter de estrella se aplica para enderezarlo.
        anime.set(star_icon, {
            transform: `translateY(${-translationRadius}px) rotate(${currentAngle}deg) rotate(${-currentAngle}deg)`
        });

        // Animar solo la escala y opacidad
        anime({
            targets: star_icon,
            scale: [0, 1.18, 1],
            opacity: [0, 1],
            duration: 700,
            delay: i * 120,
            easing: 'easeOutElastic(1, .8)'
        });

        try {
            if (i === numericRarity && numericRarity >= 5) await playSound(starSounds.legendary);
            else if (i === 4) await playSound(starSounds.rare);
            else if (i <= 3) await playSound(starSounds.common.cloneNode());
        } catch (e) { console.warn("No se pudo reproducir el sonido de estrella:", e.message); }
        
        await new Promise(r => setTimeout(r, 150));
    }
}

// --- SINGLE PULL ---
async function displaySinglePull(redeemer, character) {
    singlePullRedeemer.textContent = `Tirada de: ${redeemer}`;
    singleCharacterName.textContent = character.name;

    let singleBubble = singlePullDisplay.querySelector('.single-bubble');
    if (!singleBubble) {
        singleBubble = document.createElement('div');
        singleBubble.className = 'single-bubble';
        singlePullDisplay.insertBefore(singleBubble, singlePullRedeemer);
        
        // Añadir los 5 spans para el efecto de borde
        for (let i = 0; i < 5; i++) {
            singleBubble.appendChild(document.createElement('span'));
        }

        const imageWrapper = document.createElement('div');
        imageWrapper.className = 'character-image-wrapper';
        imageWrapper.appendChild(singleCharacterImage);
        singleBubble.appendChild(imageWrapper);
        const starCtn = document.createElement('div');
        starCtn.className = 'star-container';
        singleBubble.appendChild(starCtn);
    }
    
    singleBubble.className = 'single-bubble'; // Reset classes
    singleCharacterImage.src = character.image_url;
    singleCharacterImage.alt = character.name;

    singlePullDisplay.classList.remove('hidden');

    const timeline = anime.timeline({
        easing: 'easeOutExpo',
    });

    timeline.add({
        targets: singleBubble,
        scale: [0, 1],
        opacity: [0, 1],
        duration: 600,
        begin: () => {
            singleBubble.classList.add(`rarity-${character.rarity}`);
            singleBubble.classList.add('is-revealed'); // Activar glow exterior e interior
        }
    }).add({
        targets: [singlePullRedeemer, singleCharacterName],
        translateY: [16, 0],
        opacity: [0, 1],
        duration: 1000,
        delay: anime.stagger(150),
        begin: async () => {
            const starContainer = singleBubble.querySelector('.star-container');
            await putStars(character.rarity, starContainer);
            await playSound(new Audio("sounds/character_appearance.ogg"));
        }
    }, '-=400');

    await timeline.finished;
    await new Promise(r => setTimeout(r, SINGLE_PULL_DISPLAY_DURATION));
}

// --- MULTI PULL ---
async function displayMultiPull(redeemer, characters) {
    const redeemerNameEl = document.createElement('div');
    redeemerNameEl.className = 'redeemer-name';
    redeemerNameEl.textContent = `Tirada de: ${redeemer}`;
    multiPullDisplay.insertBefore(redeemerNameEl, multiPullGrid);

    multiPullGrid.innerHTML = `<div class="multi-row top-row"></div><div class="multi-row bottom-row"></div>`;
    const [topRow, bottomRow] = multiPullGrid.querySelectorAll('.multi-row');

    const bubbles = [];
    const rareCharacters = []; // Para la animación adicional
    for (let i = 0; i < 10; i++) {
        const cardData = characters[i] || { rarity: '3_star', image_url: '', name: '' };
        const bubbleWrapper = createBubbleCard(cardData);
        if (i < 5) topRow.appendChild(bubbleWrapper);
        else bottomRow.appendChild(bubbleWrapper);
        bubbles.push(bubbleWrapper.querySelector('.bubble-card'));

        if (getNumericRarity(cardData.rarity) >= 4) { // 4, 5, 6 estrellas
            rareCharacters.push(cardData);
        }
    }

    multiPullDisplay.classList.remove('hidden');
    
    const timeline = anime.timeline({
        easing: 'easeOutExpo',
        complete: () => console.log("Animación de tirada múltiple completada.")
    });

    timeline.add({
        targets: redeemerNameEl,
        translateY: [16, 0],
        opacity: [0, 1],
        duration: 900
    }).add({
        targets: bubbles,
        scale: [0, 1],
        opacity: [0, 1],
        delay: anime.stagger(90, { start: 100 }),
        duration: 450
    }, '-=500');

    const revealOrder = ['3_star', '4_star', '5_star', '6_star'];
    revealOrder.forEach(rarity => {
        const targets = bubbles.filter(b => b.dataset.rarity === rarity);
        if (targets.length === 0) return;

        const isSpecial = getNumericRarity(rarity) >= 5;
        
        timeline.add({
            targets: targets,
            scale: isSpecial ? [1, 1.32, 1] : [1, 1.15, 1],
            duration: isSpecial ? 850 : 350,
            delay: anime.stagger(isSpecial ? 380 : 150),
            begin: (anim) => {
                anim.animatables.forEach(async (a) => {
                    const bubble = a.target;
                    if (!bubble.classList.contains('is-revealed')) {
                        bubble.classList.add('is-revealed');
                        const starContainer = bubble.querySelector('.star-container');
                        await putStars(bubble.dataset.rarity, starContainer);
                    }
                });
            }
        });
    });

    await timeline.finished;
    await new Promise(r => setTimeout(r, MULTI_PULL_CLOSE_DELAY));

    return rareCharacters; // Devolver los personajes raros
}

// --- REVELADO DE PERSONAJES RAROS (MULTI PULL) ---
async function displayMultiRarityReveal(redeemer, characters) {
    if (characters.length === 0) return;

    multiRarityRevealDisplay.classList.remove('hidden');
    multiRarityRevealDisplay.classList.add('active');

    const revealBubbles = [];
    characters.forEach(character => {
        const singleBubble = document.createElement('div');
        singleBubble.className = `single-bubble rarity-${character.rarity}`;
        singleBubble.dataset.rarity = character.rarity; // Añadir dataset.rarity
        
        // Añadir los 5 spans para el efecto de borde
        for (let i = 0; i < 5; i++) {
            singleBubble.appendChild(document.createElement('span'));
        }

        const charImage = document.createElement('img');
        charImage.src = character.image_url;
        charImage.alt = character.name;
        // charImage.id = 'single-character-image'; // No reutilizar ID
        const imageWrapper = document.createElement('div');
        imageWrapper.className = 'character-image-wrapper';
        imageWrapper.appendChild(charImage);
        singleBubble.appendChild(imageWrapper);

        const starCtn = document.createElement('div');
        starCtn.className = 'star-container';
        singleBubble.appendChild(starCtn);

        const charName = document.createElement('div');
        charName.textContent = character.name;
        charName.className = 'bubble-name'; // Usar clase genérica, no ID
        
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.alignItems = 'center';
        wrapper.appendChild(singleBubble);
        wrapper.appendChild(charName);

        multiRarityRevealDisplay.appendChild(wrapper);
        revealBubbles.push(singleBubble);
    });

    const timeline = anime.timeline({
        easing: 'easeOutExpo',
        complete: () => console.log("Animación de revelado de raros completada.")
    });

    timeline.add({
        targets: revealBubbles,
        scale: [0, 1],
        opacity: [0, 1],
        duration: 600,
        delay: anime.stagger(200),
        begin: (anim) => {
            anim.animatables.forEach(async (a) => {
                const bubble = a.target;
                bubble.classList.add('is-revealed');
                const starContainer = bubble.querySelector('.star-container');
                await putStars(bubble.dataset.rarity, starContainer);
                await playSound(new Audio("sounds/character_appearance.ogg"));
            });
        }
    });

    await timeline.finished;
    await new Promise(r => setTimeout(r, MULTI_RARITY_REVEAL_DURATION));
}


function createBubbleCard(characterData) {
    const rarityClass = characterData?.rarity || '3_star';
    const card = document.createElement('div');
    card.className = `bubble-card rarity-${rarityClass}`;
    card.dataset.rarity = rarityClass;

    // Añadir los 5 spans para el efecto de borde
    for (let i = 0; i < 5; i++) {
        card.appendChild(document.createElement('span'));
    }

    const img = document.createElement('img');
    img.alt = characterData?.name || '';
    img.src = characterData?.image_url || '';

    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'character-image-wrapper';
    imageWrapper.appendChild(img);

    const stars = document.createElement('div');
    stars.className = 'star-container';
    const name = document.createElement('div');
    name.className = 'bubble-name';
    name.textContent = characterData?.name || '';

    card.appendChild(imageWrapper);
    card.appendChild(stars);

    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.alignItems = 'center';
    wrapper.appendChild(card);
    wrapper.appendChild(name);
    
    anime.set(card, { scale: 0, opacity: 0 }); // Estado inicial para Anime.js

    return wrapper;
}

// --- Orquestador principal ---
const wishAnimation = (data) => new Promise(async (resolve) => {
    hideAllDisplays();

    gashaponMachineImg.src = "img/gashapon.gif?t=" + new Date().getTime();
    gashaponAnimation.classList.remove('hidden');
    await new Promise(r => setTimeout(r, GASHAPON_ANIMATION_DURATION));
    gashaponAnimation.classList.add('hidden');

    if (data.pull_type === 'single' && data.character) {
        await displaySinglePull(data.redeemer, data.character);
    } else if (data.pull_type === 'multi' && data.characters) {
        const rareCharacters = await displayMultiPull(data.redeemer, data.characters);
        if (rareCharacters && rareCharacters.length > 0) {
            await displayMultiRarityReveal(data.redeemer, rareCharacters);
        }
    } else {
        console.warn("Datos de tirada incompletos o tipo desconocido:", data);
    }

    setTimeout(() => {
        hideAllDisplays();
        resolve('gacha_wish_completed');
    }, 300);
});

// --- Gestión de cola ---
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
            console.error("Error en wishAnimation:", error);
        }
    }
    isRunning = false;
}

// --- API exportada ---
export function handleSinglePullRequest(redeemer, character) {
    addToQueue({ pull_type: 'single', redeemer, character });
}
export function handleMultiPullRequest(redeemer, characters) {
    addToQueue({ pull_type: 'multi', redeemer, characters });
}
export function displayTestMessage(text) {
    testMessageDisplay.textContent = text;
    testMessageDisplay.classList.remove('hidden');
    setTimeout(() => testMessageDisplay.classList.add('hidden'), 5000);
}

// --- Inicialización ---
document.addEventListener('DOMContentLoaded', () => {
    hideAllDisplays();
});
