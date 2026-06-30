const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const DATA_PATH = path.join(__dirname, 'chatbot-data.json')

function uid() { return crypto.randomBytes(4).toString('hex') }

const data = { commands: [], timers: [] }

function load() {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf-8')
    const saved = JSON.parse(raw)
    data.commands = saved.commands || []
    data.timers = (saved.timers || []).map(t => ({ ...t, lastSent: Date.now() }))
  } catch { save() }
}

function save() {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

load()

function getCommands() { return data.commands }
function getTimers() { return data.timers }

function addCommand(cmd) {
  const entry = { id: uid(), ...cmd, enabled: cmd.enabled !== false }
  data.commands.push(entry)
  save()
  return entry
}

function updateCommand(id, patch) {
  const idx = data.commands.findIndex(c => c.id === id)
  if (idx === -1) return null
  data.commands[idx] = { ...data.commands[idx], ...patch }
  save()
  return data.commands[idx]
}

function deleteCommand(id) {
  const idx = data.commands.findIndex(c => c.id === id)
  if (idx === -1) return false
  data.commands.splice(idx, 1)
  save()
  return true
}

function addTimer(t) {
  const entry = { id: uid(), ...t, enabled: t.enabled !== false, lastSent: null }
  data.timers.push(entry)
  save()
  return entry
}

function updateTimer(id, patch) {
  const idx = data.timers.findIndex(t => t.id === id)
  if (idx === -1) return null
  data.timers[idx] = { ...data.timers[idx], ...patch }
  save()
  return data.timers[idx]
}

function deleteTimer(id) {
  const idx = data.timers.findIndex(t => t.id === id)
  if (idx === -1) return false
  data.timers.splice(idx, 1)
  save()
  return true
}

module.exports = { getCommands, getTimers, addCommand, updateCommand, deleteCommand, addTimer, updateTimer, deleteTimer }
