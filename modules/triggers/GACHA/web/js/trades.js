document.addEventListener('DOMContentLoaded', () => {
    const loadTradesBtn = document.getElementById('loadTradesBtn');
    const playerNameInput = document.getElementById('playerName');
    const receivedTradesList = document.getElementById('received-trades-list');
    const sentTradesList = document.getElementById('sent-trades-list');

    loadTradesBtn.addEventListener('click', async () => {
        const playerName = playerNameInput.value.trim();
        if (!playerName) {
            alert('Por favor, introduce tu nombre de usuario.');
            return;
        }
        loadAndRenderTrades(playerName);
    });

    async function loadAndRenderTrades(playerName) {
        try {
            const response = await fetch(`/gacha/api/trades/${playerName}`);
            if (!response.ok) {
                throw new Error('No se pudieron cargar los trades.');
            }
            const trades = await response.json();
            renderTrades(trades, playerName);
        } catch (error) {
            console.error('Error:', error);
            alert(error.message);
        }
    }

    function renderTrades(trades, playerName) {
        receivedTradesList.innerHTML = '';
        sentTradesList.innerHTML = '';

        // Renderizar trades recibidos
        if (trades.received && trades.received.length > 0) {
            trades.received.forEach(trade => {
                const tradeElement = createTradeElement(trade, 'received', playerName);
                receivedTradesList.appendChild(tradeElement);
            });
        } else {
            receivedTradesList.innerHTML = '<p>No tienes trades recibidos.</p>';
        }

        // Renderizar trades enviados
        if (trades.sent && trades.sent.length > 0) {
            trades.sent.forEach(trade => {
                const tradeElement = createTradeElement(trade, 'sent', playerName);
                sentTradesList.appendChild(tradeElement);
            });
        } else {
            sentTradesList.innerHTML = '<p>No has enviado ningún trade.</p>';
        }
    }

    function createTradeElement(trade, type, playerName) {
        const div = document.createElement('div');
        div.classList.add('trade-item');
        div.dataset.tradeId = trade.id;

        let html = `
            <p><strong>Personaje:</strong> ${trade.characterName}</p>
            <p><strong>De:</strong> ${trade.offeringPlayer}</p>
            <p><strong>Para:</strong> ${trade.receivingPlayer}</p>
            <p><strong>Estado:</strong> ${trade.status}</p>
        `;

        if (trade.status === 'pending') {
            if (type === 'received') {
                html += `<button class="accept-btn">Aceptar</button>`;
            }
            html += `<button class="cancel-btn">Cancelar</button>`;
        }

        div.innerHTML = html;

        // Añadir event listeners a los botones
        const acceptBtn = div.querySelector('.accept-btn');
        if (acceptBtn) {
            acceptBtn.addEventListener('click', () => handleAcceptTrade(trade.id, playerName));
        }

        const cancelBtn = div.querySelector('.cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => handleCancelTrade(trade.id, playerName));
        }

        return div;
    }

    async function handleAcceptTrade(tradeId, playerName) {
        try {
            const response = await fetch(`/gacha/api/trade/${tradeId}/accept`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ acceptingPlayer: playerName })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Error al aceptar el trade.');
            }
            alert('¡Trade aceptado con éxito!');
            loadAndRenderTrades(playerName);
        } catch (error) {
            console.error('Error:', error);
            alert(error.message);
        }
    }

    async function handleCancelTrade(tradeId, playerName) {
        try {
            const response = await fetch(`/gacha/api/trade/${tradeId}/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cancellingPlayer: playerName })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Error al cancelar el trade.');
            }
            alert('Trade cancelado.');
            loadAndRenderTrades(playerName);
        } catch (error) {
            console.error('Error:', error);
            alert(error.message);
        }
    }
});
