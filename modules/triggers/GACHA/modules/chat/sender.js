// ponytail: sends bot messages using the bot account token
const chat = require('../../../../chat')
const logger = require('../../lib/logger')

const TAG = 'CHAT'

async function send(message) {
  try {
    await chat.sendAsBot(message)
  } catch (e) {
    logger.error(TAG, `Failed to send chat message: ${e.message}`)
  }
}

module.exports = { send }
