document.addEventListener('DOMContentLoaded', () => {
    const cardContainer = document.getElementById('character-card-container');
    const overlay = document.getElementById('overlay');
    const cardFlipper = document.getElementById('card-flipper');
    const charNameElem = document.getElementById('character-name');
    const charImageElem = document.getElementById('character-image');
    const charStarsElem = document.getElementById('character-stars'); // Nuevo elemento para las estrellas
    const userOwnsCharStatusElem = document.getElementById('user-owns-character-status'); // Contenedor del estado de posesión
    const userOwnsCharTextElem = document.getElementById('user-owns-character-text'); // Texto del estado de posesión
    const totalInInventoriesElem = document.getElementById('total-in-inventories');
    const characterOwnersList = document.getElementById('character-owners');

    const NAMES_PER_PAGE = 4; // Mostrar 4 nombres a la vez en la lista de propietarios
    const PAGE_DURATION_MS = 2500; // Duración de cada página de propietarios
    const ANIMATION_DURATION_MS = 1800; // Debe coincidir con la duración de la animación CSS

    let hideTimeout;
    let paginationInterval;
    let currentPage = 0;
    let currentOwnerNames = [];

    function connectWebSocket() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}/ws/gacha`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('Conectado al servidor de WebSocket.');
        };

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'showCharacter') {
                displayCharacterData(message.data);
            } else if (message.type === 'showInventory') {
                displayInventoryData(message.data);
            }
        };

        ws.onclose = () => {
            console.log('Desconectado del servidor de WebSocket. Intentando reconectar en 3 segundos...');
            setTimeout(connectWebSocket, 3000);
        };

        ws.onerror = (error) => {
            console.error('Error de WebSocket:', error);
            ws.close();
        };
    }

    function displayCharacterData(data) {
        if (!data || !data.character) {
            console.error('Datos del personaje inválidos recibidos por WebSocket.');
            return;
        }

        // Limpiar timeouts e intervalos anteriores
        if (hideTimeout) clearTimeout(hideTimeout);
        if (paginationInterval) clearInterval(paginationInterval);

        // Resetear estados
        currentPage = 0;
        currentOwnerNames = data.owners
            ? data.owners
                .map(owner => {
                    const match = owner.userName.match(/\(([^)]+)\)/);
                    return match && match[1] ? match[1] : owner.userName; // Extrae el contenido dentro de los paréntesis o usa el nombre original
                })
                .filter(name => name.toLowerCase() !== '%user%') // Filtra los nombres que sean "%User%" (ignorando mayúsculas/minúsculas)
            : [];

        // Rellenar datos del personaje
        console.log('Character Data received:', data.character);
        charNameElem.textContent = data.character.name.toUpperCase(); // Asegurar mayúsculas en el frontend
        charImageElem.src = data.character.image;
        charImageElem.alt = data.character.name;
        
        // Renderizar estrellas
        charStarsElem.innerHTML = '';
        const characterQuality = parseInt(data.character.quality); // Convertir la calidad a número
        console.log('Character Quality (parsed):', characterQuality); // Añadido para depuración
        if (characterQuality && typeof characterQuality === 'number' && characterQuality > 0) {
            for (let i = 0; i < characterQuality; i++) {
                const starSvg = `
                <svg class="w-8 h-8 text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.538 1.118l-2.8-2.034a1 1 0 00-1.176 0l-2.8 2.034c-.783.57-1.838-.197-1.538-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.381-1.81.588-1.81h3.462a1 1 0 00.95-.69l1.07-3.292z"></path>
                </svg>
            `;
            charStarsElem.insertAdjacentHTML('beforeend', starSvg);
        }
        } else {
            console.log('No stars to render or invalid quality after parsing:', data.character.quality); // Añadido para depuración
        }

        // Estado de posesión
        userOwnsCharStatusElem.classList.remove('owns-character', 'not-owns-character');
        if (data.userOwnsCharacter) {
            userOwnsCharTextElem.textContent = '¡Lo tienes!';
            userOwnsCharStatusElem.classList.add('owns-character');
        } else {
            userOwnsCharTextElem.textContent = '¡No lo tienes!';
            userOwnsCharStatusElem.classList.add('not-owns-character');
        }

        totalInInventoriesElem.textContent = data.totalInInventories.toLocaleString();

        // Mostrar la tarjeta con animaciones
        cardContainer.classList.remove('hidden');
        overlay.classList.add('opacity-100');
        cardFlipper.classList.remove('animate-fly-flip-out', 'float-animation'); // Asegurarse de que no haya animaciones de salida o flotantes activas
        cardFlipper.classList.add('animate-fly-flip-in');

        // Iniciar animación flotante después de la animación de entrada
        setTimeout(() => {
            cardFlipper.classList.add('float-animation');
        }, ANIMATION_DURATION_MS);

        // Iniciar paginación de propietarios después de la animación de entrada
        setTimeout(() => {
            updateOwnersList(); // Mostrar la primera página
            const totalPages = currentOwnerNames.length > 0 ? Math.ceil(currentOwnerNames.length / NAMES_PER_PAGE) : 1;
            if (totalPages > 1) {
                paginationInterval = setInterval(() => {
                    currentPage = (currentPage + 1) % totalPages;
                    updateOwnersList();
                }, PAGE_DURATION_MS);
            }
        }, ANIMATION_DURATION_MS);


        // Ocultar la tarjeta después de un tiempo total (ANIMATION_DURATION_MS + (totalPages * PAGE_DURATION_MS) + ANIMATION_DURATION_MS)
        // Para simplificar, usaremos un tiempo fijo o calcularemos un tiempo dinámico más robusto.
        // Por ahora, un tiempo fijo que permita ver varias páginas de propietarios.
        const displayDuration = ANIMATION_DURATION_MS + (Math.max(1, Math.ceil(currentOwnerNames.length / NAMES_PER_PAGE)) * PAGE_DURATION_MS) + ANIMATION_DURATION_MS;
        hideTimeout = setTimeout(() => {
            overlay.classList.remove('opacity-100');
            cardFlipper.classList.remove('animate-fly-flip-in', 'float-animation');
            cardFlipper.classList.add('animate-fly-flip-out');

            // Ocultar completamente después de la animación de salida
            setTimeout(() => {
                cardContainer.classList.add('hidden');
            }, ANIMATION_DURATION_MS);
        }, displayDuration);
    }

    function displayInventoryData(data) {
        if (!data) return;
        if (hideTimeout) clearTimeout(hideTimeout);
        if (paginationInterval) clearInterval(paginationInterval);
        currentPage = 0;

        const lines = [];
        lines.push(`🔑 Keys: ${data.keys}`);
        lines.push(`📊 Tiradas: ${data.totalPulls}`);
        lines.push(`🎯 Pity 4★: ${data.pity4} | 5★: ${data.pity5}/${data.hardPity} (${data.pullsLeft} falta)`);
        lines.push(`📦 3★: ${data.charCounts['3_star']} | 4★: ${data.charCounts['4_star']} | 5★: ${data.charCounts['5_star']} | 6★: ${data.charCounts['6_star']}`);

        charNameElem.textContent = `INVENTARIO — ${data.userName.toUpperCase()}`;
        charImageElem.src = '';
        charImageElem.alt = 'Inventory';
        charStarsElem.innerHTML = '';

        userOwnsCharStatusElem.classList.remove('owns-character', 'not-owns-character');
        userOwnsCharStatusElem.className = 'my-3 px-4 py-2 bg-black/40 rounded-lg border text-center';
        userOwnsCharTextElem.innerHTML = lines.join('<br>');
        userOwnsCharTextElem.className = 'text-sm font-mono leading-relaxed';

        totalInInventoriesElem.textContent = `${data.owned.length} obtenidos / ${data.missing.length + data.owned.length} total`;

        currentOwnerNames = [];
        if (data.owned.length > 0) {
            const withStars = data.owned.map(n => {
                const c = data.charCounts;
                return n;
            });
            currentOwnerNames = withStars;
        }
        if (data.missing.length > 0) {
            currentOwnerNames.push('── Faltantes ──');
            currentOwnerNames.push(...data.missing.slice(0, 50));
            if (data.missing.length > 50) currentOwnerNames.push(`... y ${data.missing.length - 50} más`);
        }

        cardContainer.classList.remove('hidden');
        overlay.classList.add('opacity-100');
        cardFlipper.classList.remove('animate-fly-flip-out', 'float-animation');
        cardFlipper.classList.add('animate-fly-flip-in');

        setTimeout(() => {
            cardFlipper.classList.add('float-animation');
        }, ANIMATION_DURATION_MS);

        setTimeout(() => {
            updateOwnersList();
            const totalPages = currentOwnerNames.length > 0 ? Math.ceil(currentOwnerNames.length / NAMES_PER_PAGE) : 1;
            if (totalPages > 1) {
                paginationInterval = setInterval(() => {
                    currentPage = (currentPage + 1) % totalPages;
                    updateOwnersList();
                }, PAGE_DURATION_MS);
            }
        }, ANIMATION_DURATION_MS);

        const displayDuration = ANIMATION_DURATION_MS + (Math.max(1, Math.ceil(currentOwnerNames.length / NAMES_PER_PAGE)) * PAGE_DURATION_MS) + ANIMATION_DURATION_MS;
        hideTimeout = setTimeout(() => {
            overlay.classList.remove('opacity-100');
            cardFlipper.classList.remove('animate-fly-flip-in', 'float-animation');
            cardFlipper.classList.add('animate-fly-flip-out');
            setTimeout(() => {
                cardContainer.classList.add('hidden');
            }, ANIMATION_DURATION_MS);
        }, displayDuration);
    }

    function updateOwnersList() {
        characterOwnersList.innerHTML = '';
        const start = currentPage * NAMES_PER_PAGE;
        const end = start + NAMES_PER_PAGE;
        const namesToShow = currentOwnerNames.slice(start, end);

        if (namesToShow.length > 0) {
            namesToShow.forEach(name => {
                const li = document.createElement('li');
                li.className = 'w-1/2 text-md text-gray-100 truncate py-1 font-medium'; // Clases de Tailwind
                li.textContent = name;
                characterOwnersList.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.className = 'w-full text-sm text-gray-400 italic'; // Clases de Tailwind
            li.textContent = 'Nadie tiene este personaje aún.';
            characterOwnersList.appendChild(li);
        }
        // Reiniciar la animación de fade-in-out para la lista de propietarios
        characterOwnersList.classList.remove('animate-fade-in-out');
        void characterOwnersList.offsetWidth; // Trigger reflow
        characterOwnersList.classList.add('animate-fade-in-out');
    }

    // Iniciar la conexión WebSocket
    connectWebSocket();
});
