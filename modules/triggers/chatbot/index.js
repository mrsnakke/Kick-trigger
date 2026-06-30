const express = require('express')
const path = require('path')
const eventBus = require('../../../lib/event-bus')
const sse = require('../../sse')
const chat = require('../../chat')
const store = require('./store')

const router = express.Router()
router.use(express.json())
router.use(express.static(path.join(__dirname, 'public')))

let timerInterval = null
const CHECK_INTERVAL = 5000

function broadcast(data) {
  sse.broadcast({ ...data, _source: 'chatbot' })
}

function handleChatMessage(data) {
  const { payload } = data
  const user = payload.sender?.username
  const message = (payload.content || '').trim()
  if (!user || !message) return

  const commands = store.getCommands()
  for (const cmd of commands) {
    if (!cmd.enabled) continue
    const prefix = cmd.command.toLowerCase()
    if (message.toLowerCase().startsWith(prefix)) {
      const response = cmd.response.replace(/\{user\}/g, user)
      chat.sendAsBot(response).catch(err => console.error('[CHATBOT] Error send:', err.message))
      if (cmd.trigger) {
        eventBus.emit(cmd.trigger, { user, message, command: cmd.command, response })
      }
      break
    }
  }
}

function timerTick() {
  const timers = store.getTimers()
  const now = Date.now()
  for (const t of timers) {
    if (!t.enabled) continue
    if (t.lastSent && now - t.lastSent < t.intervalMs) continue
    chat.sendAsBot(t.message).catch(err => console.error('[CHATBOT] Timer error:', err.message))
    t.lastSent = now
  }
}

function startTimers() {
  if (timerInterval) return
  timerInterval = setInterval(timerTick, CHECK_INTERVAL)
}

function stopTimers() {
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
}

router.get('/api/commands', (req, res) => {
  res.json(store.getCommands())
})

router.post('/api/commands', (req, res) => {
  const { command, response, trigger, enabled } = req.body
  if (!command || !response) return res.status(400).json({ error: 'Faltan command o response' })
  const entry = store.addCommand({ command, response, trigger: trigger || '', enabled })
  broadcast({ type: 'chatbot:updated' })
  res.status(201).json(entry)
})

router.put('/api/commands/:id', (req, res) => {
  const updated = store.updateCommand(req.params.id, req.body)
  if (!updated) return res.status(404).json({ error: 'No encontrado' })
  broadcast({ type: 'chatbot:updated' })
  res.json(updated)
})

router.delete('/api/commands/:id', (req, res) => {
  if (!store.deleteCommand(req.params.id)) return res.status(404).json({ error: 'No encontrado' })
  broadcast({ type: 'chatbot:updated' })
  res.json({ ok: true })
})

router.patch('/api/commands/:id/toggle', (req, res) => {
  const cmd = store.getCommands().find(c => c.id === req.params.id)
  if (!cmd) return res.status(404).json({ error: 'No encontrado' })
  const updated = store.updateCommand(req.params.id, { enabled: !cmd.enabled })
  broadcast({ type: 'chatbot:updated' })
  res.json(updated)
})

router.get('/api/timers', (req, res) => {
  res.json(store.getTimers())
})

router.post('/api/timers', (req, res) => {
  const { message, intervalMin, enabled } = req.body
  if (!message || !intervalMin || intervalMin < 1) return res.status(400).json({ error: 'Faltan message o intervalMin (min 1)' })
  const entry = store.addTimer({ message, intervalMs: intervalMin * 60000, enabled })
  broadcast({ type: 'chatbot:updated' })
  res.status(201).json(entry)
})

router.put('/api/timers/:id', (req, res) => {
  const patch = { ...req.body }
  if (patch.intervalMin) {
    patch.intervalMs = patch.intervalMin * 60000
    delete patch.intervalMin
  }
  const updated = store.updateTimer(req.params.id, patch)
  if (!updated) return res.status(404).json({ error: 'No encontrado' })
  broadcast({ type: 'chatbot:updated' })
  res.json(updated)
})

router.delete('/api/timers/:id', (req, res) => {
  if (!store.deleteTimer(req.params.id)) return res.status(404).json({ error: 'No encontrado' })
  broadcast({ type: 'chatbot:updated' })
  res.json({ ok: true })
})

router.patch('/api/timers/:id/toggle', (req, res) => {
  const t = store.getTimers().find(t => t.id === req.params.id)
  if (!t) return res.status(404).json({ error: 'No encontrado' })
  const updated = store.updateTimer(req.params.id, { enabled: !t.enabled })
  broadcast({ type: 'chatbot:updated' })
  res.json(updated)
})

router.get('/api/status', (req, res) => {
  res.json({
    commands: store.getCommands().length,
    timers: store.getTimers().length,
    timersActive: timerInterval !== null
  })
})

function init() {
  eventBus.on('chat.message.sent', handleChatMessage)
  startTimers()
  console.log('[CHATBOT] Inicializado')
}

module.exports = { router, init }
