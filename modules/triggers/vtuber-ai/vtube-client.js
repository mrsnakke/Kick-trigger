const WebSocket = require('ws');
const { EventEmitter } = require('events');

class VTubeClient extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.host = opts.host || 'localhost';
    this.port = opts.port || 8001;
    this.pluginName = opts.pluginName || 'VTubePlugin';
    this.pluginDeveloper = opts.pluginDeveloper || 'developer';
    this.token = opts.token || null;
    this.reconnectBase = opts.reconnectBase || 3000;
    this.reconnectMax = opts.reconnectMax || 30000;

    this.socket = null;
    this.connected = false;
    this.authenticated = false;
    this._pending = {};
    this._reqId = 0;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._watchTimer = null;
    this._closing = false;
  }

  _genId() {
    return String(++this._reqId);
  }

  request(messageType, data) {
    const msg = {
      apiName: 'VTubeStudioPublicAPI',
      apiVersion: '1.0',
      messageType,
      requestID: this._genId(),
    };
    if (data !== undefined) msg.data = data;

    return new Promise((resolve, reject) => {
      this._pending[msg.requestID] = resolve;
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        delete this._pending[msg.requestID];
        reject(new Error('Socket not open'));
        return;
      }
      try {
        this.socket.send(JSON.stringify(msg));
      } catch (e) {
        delete this._pending[msg.requestID];
        reject(e);
      }
      setTimeout(() => {
        if (this._pending[msg.requestID]) {
          delete this._pending[msg.requestID];
          reject(new Error('Timeout'));
        }
      }, 10000);
    });
  }

  _resolveAllPending(errMsg) {
    for (const id of Object.keys(this._pending)) {
      this._pending[id]({ error: true, message: errMsg || 'Connection closed' });
    }
    this._pending = {};
  }

  _startWatchdog() {
    clearInterval(this._watchTimer);
    this._watchTimer = setInterval(() => {
      if (this.socket && this.socket.readyState !== WebSocket.OPEN) {
        this.connected = false;
        this.authenticated = false;
        clearInterval(this._watchTimer);
        this._resolveAllPending('Connection lost');
        this.emit('disconnected');
        this._startReconnect();
      }
    }, 3000);
  }

  _startReconnect() {
    if (this._closing) return;
    clearInterval(this._reconnectTimer);
    const delay = Math.min(
      this.reconnectBase * Math.pow(2, this._reconnectAttempts),
      this.reconnectMax
    );
    this._reconnectAttempts++;
    this._reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  connect() {
    if (this._closing) return;
    const url = `ws://${this.host}:${this.port}`;

    try {
      this.socket = new WebSocket(url);
    } catch (e) {
      this.emit('error', e.message);
      this._startReconnect();
      return;
    }

    this.socket.on('message', (raw) => {
      let r;
      try { r = JSON.parse(raw.toString()); } catch { return; }
      const cb = this._pending[r.requestID];
      if (cb) {
        delete this._pending[r.requestID];
        cb(r);
        return;
      }
      if (r.messageType && r.messageType.endsWith('Event')) {
        this.emit('event', r.messageType, r.data || {}, r);
      }
    });

    this.socket.on('open', () => {
      this._reconnectAttempts = 0;
      this.connected = true;
      clearTimeout(this._reconnectTimer);
      this._startWatchdog();
      this.emit('connected');
      this._authenticate();
    });

    this.socket.on('error', (err) => {
      this.emit('error', err.message);
    });

    this.socket.on('close', () => {
      this.connected = false;
      this.authenticated = false;
      clearInterval(this._watchTimer);
      this._resolveAllPending('Connection closed');
      this.emit('disconnected');
      if (!this._closing) this._startReconnect();
    });
  }

  async _authenticateWithToken(token) {
    try {
      const r = await this.request('AuthenticationRequest', {
        pluginName: this.pluginName,
        pluginDeveloper: this.pluginDeveloper,
        authenticationToken: token,
      });
      if (r.data && r.data.authenticated) {
        this.authenticated = true;
        this.token = token;
        this.emit('authenticated');
      } else {
        this.emit('error', 'Token rechazado: ' + (r.data ? r.data.reason : 'desconocido'));
        if (r.data && r.data.authenticationToken) this._authenticateWithToken(r.data.authenticationToken);
        else this._requestNewToken();
      }
    } catch (e) {
      this.emit('error', 'Error de autenticación: ' + e.message);
    }
  }

  async _requestNewToken() {
    try {
      const r = await this.request('AuthenticationTokenRequest', {
        pluginName: this.pluginName,
        pluginDeveloper: this.pluginDeveloper,
      });
      if (r.data && r.data.authenticationToken) {
        const token = r.data.authenticationToken;
        this.emit('token', token);
        this._authenticateWithToken(token);
      } else {
        this.emit('error', 'No se pudo obtener token');
      }
    } catch (e) {
      this.emit('error', 'Error solicitando token: ' + e.message);
    }
  }

  _authenticate() {
    if (this.token) {
      this._authenticateWithToken(this.token);
    } else {
      this._requestNewToken();
    }
  }

  // --- High-level helpers ---

  async getAPIState() {
    return this.request('APIStateRequest');
  }

  async getStatistics() {
    return this.request('StatisticsRequest');
  }

  async getCurrentModel() {
    return this.request('CurrentModelRequest');
  }

  async getAvailableModels() {
    return this.request('AvailableModelsRequest');
  }

  async loadModel(modelID) {
    return this.request('ModelLoadRequest', { modelID });
  }

  async moveModel(pos = {}, timeInSeconds = 0.5) {
    const data = { timeInSeconds, valuesAreRelativeToModel: false, ...pos };
    return this.request('MoveModelRequest', data);
  }

  async getHotkeys(modelID, live2DItemFileName) {
    const data = {};
    if (modelID) data.modelID = modelID;
    if (live2DItemFileName) data.live2DItemFileName = live2DItemFileName;
    return this.request('HotkeysInCurrentModelRequest', data);
  }

  async triggerHotkey(hotkeyID, itemInstanceID) {
    const data = { hotkeyID };
    if (itemInstanceID) data.itemInstanceID = itemInstanceID;
    return this.request('HotkeyTriggerRequest', data);
  }

  async getExpressionState(expressionFile, details = true) {
    const data = { details };
    if (expressionFile) data.expressionFile = expressionFile;
    return this.request('ExpressionStateRequest', data);
  }

  async setExpression(expressionFile, active, fadeTime = 0.3) {
    return this.request('ExpressionActivationRequest', {
      expressionFile,
      active,
      fadeTime,
    });
  }

  async getParameterList() {
    return this.request('InputParameterListRequest');
  }

  async getParameterValue(name) {
    return this.request('ParameterValueRequest', { name });
  }

  async injectParameters(params, opts = {}) {
    return this.request('InjectParameterDataRequest', {
      faceFound: opts.faceFound || false,
      mode: opts.mode || 'set',
      parameterValues: params,
    });
  }

  async getArtMeshList() {
    return this.request('ArtMeshListRequest');
  }

  async tintArtMeshes(colorTint, artMeshMatcher) {
    return this.request('ColorTintRequest', { colorTint, artMeshMatcher });
  }

  async getItemList(opts = {}) {
    return this.request('ItemListRequest', {
      includeAvailableSpots: opts.includeAvailableSpots || false,
      includeItemInstancesInScene: opts.includeItemInstancesInScene || false,
      includeAvailableItemFiles: opts.includeAvailableItemFiles || false,
      onlyItemsWithFileName: opts.onlyItemsWithFileName || '',
      onlyItemsWithInstanceID: opts.onlyItemsWithInstanceID || '',
    });
  }

  async loadItem(data) {
    return this.request('ItemLoadRequest', data);
  }

  async unloadItem(instanceIDs) {
    return this.request('ItemUnloadRequest', { instanceIDs });
  }

  async subscribeEvent(eventName, config = {}) {
    return this.request('EventSubscriptionRequest', {
      eventName,
      subscribe: true,
      config,
    });
  }

  async unsubscribeEvent(eventName) {
    return this.request('EventSubscriptionRequest', {
      eventName,
      subscribe: false,
      config: {},
    });
  }

  async unsubscribeAllEvents() {
    return this.request('EventSubscriptionRequest', {
      eventName: '',
      subscribe: false,
      config: {},
    });
  }

  async requestPermission(permission) {
    return this.request('PermissionRequest', { requestedPermission: permission });
  }

  disconnect() {
    this._closing = true;
    clearInterval(this._watchTimer);
    clearTimeout(this._reconnectTimer);
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
    this.authenticated = false;
    this._resolveAllPending('Disconnected');
  }
}

module.exports = { VTubeClient };
