const { OBSWebSocket } = require('obs-websocket-js');
const { EventEmitter } = require('events');

class OBSManager extends EventEmitter {
  constructor() {
    super();
    this.client = new OBSWebSocket();
    this.connected = false;
    this.reconnectTimer = null;
    this.reconnectInterval = 5000;
    this.config = { host: '', port: '', password: '' };
    this.cache = { scenes: [], itemsByScene: {} };

    this.client.on('ConnectionClosed', () => {
      this.connected = false;
      this.emit('disconnected');
      this.scheduleReconnect();
    });
  }

  getStatus() {
    return { connected: this.connected, host: this.config.host, port: this.config.port };
  }

  async connect(host, port, password) {
    if (host) this.config.host = host;
    if (port) this.config.port = port;
    if (password) this.config.password = password;

    try {
      await this.client.connect(`ws://${this.config.host}:${this.config.port}`, this.config.password);
      this.connected = true;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      await this.refreshCache();
      this.emit('connected');
      return true;
    } catch (err) {
      this.connected = false;
      throw err;
    }
  }

  async disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try { await this.client.disconnect(); } catch {}
    this.connected = false;
    this.emit('disconnected');
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        this.scheduleReconnect();
      }
    }, this.reconnectInterval);
  }

  async refreshCache() {
    try {
      const listRes = await this.client.call('GetSceneList');
      this.cache.scenes = listRes.scenes.map(s => s.sceneName);
      this.cache.itemsByScene = {};
      for (const sceneName of this.cache.scenes) {
        const itemsRes = await this.client.call('GetSceneItemList', { sceneName });
        const flatItems = [];
        for (const item of itemsRes.sceneItems) {
          flatItems.push({
            id: item.sceneItemId,
            name: item.sourceName,
            isGroup: item.isGroup,
            groupName: null
          });
          if (item.isGroup) {
            try {
              const groupRes = await this.client.call('GetGroupSceneItemList', { sceneName: item.sourceName });
              for (const child of groupRes.sceneItems) {
                flatItems.push({
                  id: child.sceneItemId,
                  name: child.sourceName,
                  isGroup: false,
                  groupName: item.sourceName
                });
              }
            } catch (err) {
              console.warn(`[OBS] Error fetching items for group "${item.sourceName}":`, err.message);
            }
          }
        }
        this.cache.itemsByScene[sceneName] = flatItems;
      }
      return this.cache;
    } catch (err) {
      console.error('[OBS] Error refreshing cache:', err.message);
      throw err;
    }
  }

  getScenes() { return this.cache; }

  async setVisibility(sceneName, sceneItemId, enabled) {
    return this.client.call('SetSceneItemEnabled', {
      sceneName,
      sceneItemId: parseInt(sceneItemId),
      sceneItemEnabled: enabled
    });
  }
}

module.exports = new OBSManager();
