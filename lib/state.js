// ponytail: estado compartido mutable entre módulos, plano y sin getters
module.exports = {
  tokens: null,
  broadcasterUserId: null,
  channelSlug: null,
  tunnelUrl: null,
  sseClients: [],
  eventsCounter: 0,
  authFailCount: 0,
}
