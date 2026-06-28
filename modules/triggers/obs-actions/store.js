const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'obs-data.json');

const uid = crypto.randomUUID;

function defaultData() {
  return {
    config: { host: '192.168.50.246', port: '4456', password: '123456' },
    actions: [],
    triggers: [],
    groups: []
  };
}

let data = null;

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      data = JSON.parse(raw);
    } else {
      data = defaultData();
      save();
    }
  } catch (err) {
    console.error('[Store] Error loading data, using defaults:', err.message);
    data = defaultData();
  }
  // Migracion: asegurar campos nuevos en datos existentes
  if (!data.groups) data.groups = [];
  data.actions.forEach(a => { if (a.sortOrder === undefined) a.sortOrder = 0; if (a.groupId === undefined) a.groupId = null; });
  return data;
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Store] Error saving data:', err.message);
  }
}

function getConfig() { return data.config; }
function updateConfig(partial) {
  if (partial.host !== undefined) data.config.host = partial.host;
  if (partial.port !== undefined) data.config.port = partial.port;
  if (partial.password !== undefined) data.config.password = partial.password;
  save();
}

function getActions() { return data.actions; }
function getAction(id) { return data.actions.find(a => a.id === id); }
function createAction(input) {
  const action = { id: uid(), name: input.name, subActions: input.subActions || [], sortOrder: data.actions.length, groupId: null };
  data.actions.push(action);
  save();
  return action;
}
function updateAction(id, input) {
  const idx = data.actions.findIndex(a => a.id === id);
  if (idx === -1) return null;
  Object.assign(data.actions[idx], input);
  save();
  return data.actions[idx];
}
function deleteAction(id) {
  data.actions = data.actions.filter(a => a.id !== id);
  data.triggers.forEach(t => { if (t.actionId === id) t.actionId = ''; });
  save();
}

function getTriggers() { return data.triggers; }
function getTrigger(id) { return data.triggers.find(t => t.id === id); }
function createTrigger(input) {
  const trigger = {
    id: uid(),
    name: input.name,
    type: input.type || 'chat_command',
    pattern: input.pattern || '',
    actionId: input.actionId || '',
    enabled: input.enabled !== false
  };
  data.triggers.push(trigger);
  save();
  return trigger;
}
function updateTrigger(id, input) {
  const idx = data.triggers.findIndex(t => t.id === id);
  if (idx === -1) return null;
  Object.assign(data.triggers[idx], input);
  save();
  return data.triggers[idx];
}
function deleteTrigger(id) {
  data.triggers = data.triggers.filter(t => t.id !== id);
  save();
}

load();

function getGroups() { return data.groups; }
function createGroup(input) {
  const group = { id: uid(), name: input.name, collapsed: false };
  data.groups.push(group);
  save();
  return group;
}
function updateGroup(id, input) {
  const idx = data.groups.findIndex(g => g.id === id);
  if (idx === -1) return null;
  Object.assign(data.groups[idx], input);
  save();
  return data.groups[idx];
}
function deleteGroup(id) {
  data.groups = data.groups.filter(g => g.id !== id);
  data.actions.forEach(a => { if (a.groupId === id) a.groupId = null; });
  save();
}

function batchActions(updates) {
  updates.forEach(u => {
    const a = data.actions.find(x => x.id === u.id);
    if (a) Object.assign(a, u);
  });
  save();
}

module.exports = {
  getConfig, updateConfig,
  getActions, getAction, createAction, updateAction, deleteAction,
  getTriggers, getTrigger, createTrigger, updateTrigger, deleteTrigger,
  getGroups, createGroup, updateGroup, deleteGroup,
  batchActions,
  uid
};
