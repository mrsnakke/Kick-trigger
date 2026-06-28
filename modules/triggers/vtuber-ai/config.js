const fs = require('fs');
const path = require('path');

function loadSystemPrompt() {
  const promptPath = path.join(__dirname, 'prompts', 'vtuber-system.es.md');
  if (fs.existsSync(promptPath)) {
    return fs.readFileSync(promptPath, 'utf-8').trim();
  }
  return 'Eres una VTuber carismática y divertida. Tu objetivo es entretener y conversar con tu audiencia en vivo.';
}

module.exports = { loadSystemPrompt };
