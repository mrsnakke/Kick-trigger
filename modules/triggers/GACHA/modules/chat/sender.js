// ponytail: sends messages directly through the main backend's chat module
const chat = require('../../../../chat')
const logger = require('../../lib/logger')

const TAG = 'CHAT'

async function send(message) {
  try {
    const mockRes = { json: () => {}, status: () => mockRes }
    await chat.send({ body: { content: message } }, mockRes)
  } catch (e) {
    logger.error(TAG, `Failed to send chat message: ${e.message}`)
  }
}

module.exports = { send }
