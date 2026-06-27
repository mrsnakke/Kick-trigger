const crypto = require('crypto')
const config = require('../lib/config')
const eventBus = require('../lib/event-bus')
const state = require('../lib/state')
const sse = require('./sse')

// ponytail: hardcodeada, refresh dinámico si falla verificación
let kickPublicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8
6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2
MZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ
L/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY
6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF
BEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e
twIDAQAB
-----END PUBLIC KEY-----`

async function fetchPublicKey() {
  try {
    const resp = await fetch('https://api.kick.com/public/v1/public-key')
    const json = await resp.json()
    kickPublicKey = json.data?.public_key || kickPublicKey
    console.log('[PK] Clave pública actualizada')
  } catch {
    console.warn('[PK] Usando clave hardcodeada')
  }
}

const processedIds = new Set()

async function handle(req, res) {
  console.log('[WH]', req.method, 'desde', req.ip, 'type:', req.headers['kick-event-type'] || '(ninguno)')
  if (req.method === 'GET') {
    console.log('[WH] GET de verificación recibido, respondiendo 200')
    return res.status(200).send('OK')
  }
  if (req.method !== 'POST') return res.status(405).send('Method not allowed')

  const sig = req.headers['kick-event-signature']
  const msgId = req.headers['kick-event-message-id']
  const ts = req.headers['kick-event-message-timestamp']
  const evType = req.headers['kick-event-type']

  console.log('[WH] sig:', !!sig, 'msgId:', !!msgId, 'ts:', !!ts)

  if (!sig || !msgId || !ts) {
    console.log('[WH] FALTAN cabeceras')
    return res.status(401).send('Cabeceras faltantes')
  }

  const tsDiff = Math.abs(Date.now() - new Date(ts).getTime())
  if (tsDiff > 300000) {
    console.log('[WH] TIMESTAMP fuera de ventana:', tsDiff)
    return res.status(401).send('Timestamp fuera de ventana')
  }
  console.log('[WH] timestamp OK, diff:', tsDiff)

  if (processedIds.has(msgId)) {
    console.log('[WH] DUPLICADO')
    return res.status(200).send('Duplicado')
  }

  processedIds.add(msgId)
  setTimeout(() => processedIds.delete(msgId), config.TEN_MINUTES)

  const rawBody = req.rawBody ? req.rawBody.toString('utf8') : ''
  console.log('[WH] rawBody length:', rawBody.length, 'rawBody:', rawBody.slice(0, 100))

  try {
    const v = crypto.createVerify('sha256')
    v.update(`${msgId}.${ts}.${rawBody}`)
    if (!v.verify(kickPublicKey, sig, 'base64')) {
      console.log('[WH] FIRMA INVÁLIDA')
      await fetchPublicKey()
      return res.status(401).send('Firma inválida')
    }
  } catch (err) {
    console.log('[WH] Error verificación:', err.message)
    return res.status(500).send('Error verificación')
  }

  console.log('[WH] EVENTO VÁLIDO:', evType)
  state.eventsCounter++

  // Emitir al bus de eventos interno para triggers, forwarders, etc.
  eventBus.emit(evType, { payload: req.body, ts })

  // Notificar al frontend via SSE
  sse.broadcast({ type: 'event', eventType: evType, payload: req.body, ts })

  res.status(200).send('OK')
}

module.exports = { handle, fetchPublicKey }
