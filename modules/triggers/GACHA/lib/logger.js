// ponytail: minimal logger, same style as the main backend
function log(tag, msg, ...rest) {
  const prefix = `[${tag}]`
  if (rest.length) console.log(prefix, msg, ...rest)
  else console.log(prefix, msg)
}

function warn(tag, msg, ...rest) {
  const prefix = `[${tag}]`
  if (rest.length) console.warn(prefix, msg, ...rest)
  else console.warn(prefix, msg)
}

function error(tag, msg, ...rest) {
  const prefix = `[${tag}]`
  if (rest.length) console.error(prefix, msg, ...rest)
  else console.error(prefix, msg)
}

module.exports = { log, warn, error }
