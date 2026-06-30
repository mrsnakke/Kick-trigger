const fs = require('fs');
const path = require('path');

let cachedPrompt = null;

function loadSystemPrompt() {
  if (cachedPrompt) return cachedPrompt;
  const promptPath = path.join(__dirname, 'prompts', 'vtuber-system.es.md');
  if (fs.existsSync(promptPath)) {
    cachedPrompt = fs.readFileSync(promptPath, 'utf-8').trim();
    return cachedPrompt;
  }
  cachedPrompt = 'Eres una VTuber carismática y divertida. Tu objetivo es entretener y conversar con tu audiencia en vivo.';
  return cachedPrompt;
}

function setSystemPrompt(content) {
  cachedPrompt = content;
}

function resetSystemPrompt() {
  cachedPrompt = null;
}

module.exports = { loadSystemPrompt, setSystemPrompt, resetSystemPrompt };
