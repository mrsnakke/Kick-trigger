// websocket.js - Gacha WebSocket client for overlays

import { handleSinglePullRequest, handleMultiPullRequest, displayTestMessage } from './gachaAnimations.js';

const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_ADDRESS = `${WS_PROTOCOL}//${window.location.host}/ws/gacha`;

let ws;

function connectWebSocket() {
    ws = new WebSocket(WS_ADDRESS);

    ws.onopen = () => {
        console.log('[WS] Connected');
        const el = document.getElementById('websocket-status-indicator');
        if (el) el.classList.add('connected');
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);

            if (message.event === 'test_message' && message.data) {
                if (typeof displayTestMessage === 'function') displayTestMessage(message.data.text);
            } else if (message.event === 'gacha_wish' && message.data) {
                if (message.data.pull_type === 'single' && message.data.character) {
                    handleSinglePullRequest(message.data.userName, message.data.character);
                } else if (message.data.pull_type === 'multi' && message.data.characters) {
                    handleMultiPullRequest(message.data.userName, message.data.characters);
                }
            }
        } catch (e) {
            console.error('[WS] Parse error:', e);
        }
    };

    ws.onclose = () => {
        console.log('[WS] Disconnected, reconnecting in 3s...');
        const el = document.getElementById('websocket-status-indicator');
        if (el) el.classList.remove('connected');
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (error) => {
        console.error('[WS] Error:', error);
        ws.close();
    };
}

document.addEventListener('DOMContentLoaded', connectWebSocket);