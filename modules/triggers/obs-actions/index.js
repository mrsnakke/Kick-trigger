const express = require('express');
const path = require('path');
const obs = require('./obs');
const engine = require('./engine');
const store = require('./store');
const eventBus = require('../../../lib/event-bus');
const sse = require('../../sse');
const auth = require('../../auth');
const state = require('../../../lib/state');

let pairingState = null;

const router = express.Router();
router.use(express.json());
router.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// OBS
// ---------------------------------------------------------------------------

router.get('/api/obs/status', (req, res) => {
  res.json(obs.getStatus());
});

router.post('/api/obs/connect', async (req, res) => {
  const { host, port, password } = req.body || {};
  try {
    await obs.connect(host, port, password);
    if (host || port || password) store.updateConfig({ host, port, password });
    res.json({ ok: true, status: obs.getStatus() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/api/obs/disconnect', async (req, res) => {
  try {
    await obs.disconnect();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/api/obs/scenes', (req, res) => {
  res.json(obs.getScenes());
});

router.post('/api/obs/refresh-cache', async (req, res) => {
  try {
    await obs.refreshCache();
    res.json({ ok: true, cache: obs.getScenes() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/api/obs/test-sub-action', async (req, res) => {
  const subAction = req.body;
  if (!subAction || !subAction.type) {
    return res.status(400).json({ ok: false, error: 'subAction invalida' });
  }
  try {
    await engine.executeSubAction(subAction);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

router.get('/api/actions', (req, res) => {
  res.json(store.getActions());
});

router.get('/api/actions/:id', (req, res) => {
  const action = store.getAction(req.params.id);
  if (!action) return res.status(404).json({ error: 'Not found' });
  res.json(action);
});

router.post('/api/actions', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const action = store.createAction({ name, subActions: req.body.subActions });
  res.status(201).json(action);
});

router.put('/api/actions/batch', (req, res) => {
  const { updates } = req.body;
  if (!Array.isArray(updates)) return res.status(400).json({ error: 'updates array required' });
  store.batchActions(updates);
  res.json({ ok: true });
});

router.put('/api/actions/:id', (req, res) => {
  const action = store.updateAction(req.params.id, req.body);
  if (!action) return res.status(404).json({ error: 'Not found' });
  res.json(action);
});

router.delete('/api/actions/:id', (req, res) => {
  store.deleteAction(req.params.id);
  res.json({ ok: true });
});

router.post('/api/actions/:id/execute', async (req, res) => {
  const action = store.getAction(req.params.id);
  if (!action) return res.status(404).json({ error: 'Not found' });
  try {
    await engine.execute(action.subActions);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Disparadores (Triggers)
// ---------------------------------------------------------------------------

router.get('/api/triggers', (req, res) => {
  res.json(store.getTriggers());
});

router.get('/api/triggers/:id', (req, res) => {
  const trigger = store.getTrigger(req.params.id);
  if (!trigger) return res.status(404).json({ error: 'Not found' });
  res.json(trigger);
});

router.post('/api/triggers', (req, res) => {
  const { type, pattern, actionId } = req.body;
  if (!pattern) return res.status(400).json({ error: 'pattern required' });
  const trigger = store.createTrigger({ name: pattern, type, pattern, actionId });
  res.status(201).json(trigger);
});

router.put('/api/triggers/:id', (req, res) => {
  const trigger = store.updateTrigger(req.params.id, req.body);
  if (!trigger) return res.status(404).json({ error: 'Not found' });
  res.json(trigger);
});

router.delete('/api/triggers/:id', (req, res) => {
  store.deleteTrigger(req.params.id);
  res.json({ ok: true });
});

router.post('/api/triggers/:id/test', async (req, res) => {
  const trigger = store.getTrigger(req.params.id);
  if (!trigger) return res.status(404).json({ error: 'Not found' });
  if (!trigger.actionId) return res.status(400).json({ error: 'Sin accion vinculada' });

  const action = store.getAction(trigger.actionId);
  if (!action) return res.status(404).json({ error: 'Accion no encontrada' });

  console.log(`[Trigger:TEST] "${trigger.name}" dispara "${action.name}"`);
  try {
    await engine.execute(action.subActions);
    res.json({ ok: true, trigger: trigger.name, action: action.name });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Pairing de rewards
// ---------------------------------------------------------------------------

router.post('/api/triggers/pair', async (req, res) => {
  if (pairingState) {
    return res.status(409).json({ ok: false, error: 'Ya hay un emparejamiento activo' });
  }
  try {
    const title = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pairingState = null;
        reject(new Error('Tiempo agotado'));
      }, 30000);
      pairingState = { resolve, timer };
    });
    res.json({ ok: true, title });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Grupos de acciones
// ---------------------------------------------------------------------------

router.get('/api/groups', (req, res) => { res.json(store.getGroups()); });

router.post('/api/groups', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const group = store.createGroup({ name });
  res.status(201).json(group);
});

router.put('/api/groups/:id', (req, res) => {
  const group = store.updateGroup(req.params.id, req.body);
  if (!group) return res.status(404).json({ error: 'Not found' });
  res.json(group);
});

router.delete('/api/groups/:id', (req, res) => {
  store.deleteGroup(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Datos combinados (carga inicial UI)
// ---------------------------------------------------------------------------

router.get('/api/data', (req, res) => {
  res.json({
    config: store.getConfig(),
    actions: store.getActions(),
    triggers: store.getTriggers(),
    groups: store.getGroups(),
    obsStatus: obs.getStatus(),
    scenes: obs.getScenes()
  });
});

// ---------------------------------------------------------------------------
// Rewards de Kick
// ---------------------------------------------------------------------------

router.get('/api/rewards', async (req, res) => {
  try {
    await auth.ensureValidToken();
    const channelResp = await fetch('https://api.kick.com/public/v1/channels', {
      headers: { Authorization: `Bearer ${state.tokens.access_token}` }
    });
    const channelData = await channelResp.json();
    const channelId = channelData.data?.[0]?.broadcaster_user_id;

    if (!channelId) {
      return res.json({ ok: false, error: 'No se pudo obtener el canal', manual: true });
    }

    const rewardsResp = await fetch(`https://api.kick.com/public/v1/channels/${channelId}/rewards`, {
      headers: { Authorization: `Bearer ${state.tokens.access_token}` }
    });

    if (!rewardsResp.ok) {
      return res.json({ ok: false, error: `API rewards no disponible (${rewardsResp.status})`, manual: true });
    }

    const rewardsData = await rewardsResp.json();
    const rewards = (rewardsData.data || []).map(r => ({
      id: r.id,
      title: r.name || r.title,
      cost: r.cost,
      enabled: r.is_enabled !== false
    }));

    res.json({ ok: true, rewards });
  } catch (err) {
    res.json({ ok: false, error: err.message, manual: true });
  }
});

// ---------------------------------------------------------------------------
// Event bus triggers
// ---------------------------------------------------------------------------

function executeTrigger(trigger) {
  if (!trigger.enabled || !trigger.actionId) return;
  const action = store.getAction(trigger.actionId);
  if (!action || action.enabled === false) return;
  console.log(`[OBS] Trigger "${trigger.name}" → "${action.name}"`);
  engine.execute(action.subActions).catch(err => {
    console.error(`[OBS] Error ejecutando "${trigger.name}":`, err.message);
  });
}

function handleChatMessage(data) {
  const msg = (data.payload.message?.content || '').trim().toLowerCase();
  if (!msg) return;
  const triggers = store.getTriggers().filter(t => t.enabled && t.type === 'chat_command');
  for (const trigger of triggers) {
    if (msg.startsWith(trigger.pattern.toLowerCase())) {
      executeTrigger(trigger);
    }
  }
}

function handleRewardRedemption(data) {
  const title = data.payload.reward?.title;
  if (!title) return;

  if (pairingState) {
    clearTimeout(pairingState.timer);
    pairingState.resolve(title);
    pairingState = null;
    return;
  }

  const triggers = store.getTriggers().filter(t => t.enabled && t.type === 'reward');
  for (const trigger of triggers) {
    if (trigger.pattern.toLowerCase() === title.toLowerCase()) {
      executeTrigger(trigger);
    }
  }
}

function init() {
  eventBus.on('chat.message.sent', handleChatMessage);
  eventBus.on('channel.reward.redemption.updated', handleRewardRedemption);

  obs.on('connected', () => {
    sse.broadcast({ _source: 'obs', type: 'obs:status', connected: true });
  });
  obs.on('disconnected', () => {
    sse.broadcast({ _source: 'obs', type: 'obs:status', connected: false });
  });

  // Auto-conectar a OBS al arrancar
  const cfg = store.getConfig();
  if (cfg.host && cfg.port) {
    setImmediate(() => {
      obs.connect(cfg.host, cfg.port, cfg.password).catch(err => {
        console.log(`[OBS] No se pudo conectar: ${err.message}. Reintentando...`);
      });
    });
  }

  console.log('[OBS-Actions] Modulo cargado — triggers conectados al event bus');
}

module.exports = { router, obs, engine, store, init };
