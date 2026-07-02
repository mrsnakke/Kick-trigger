const fs = require('fs');
const path = require('path');

class VTubeModel {
  constructor(modelName, dictPath) {
    this.modelName = modelName;
    this.dictPath = dictPath || path.join(__dirname, 'model_dict.json');
    this.emotionMap = {};
    this._load();
  }

  _load() {
    const raw = fs.readFileSync(this.dictPath, 'utf-8');
    const models = JSON.parse(raw);
    const model = models.find(m => m.name === this.modelName);
    if (!model) throw new Error(`Modelo "${this.modelName}" no encontrado en ${this.dictPath}`);
    this.emotionMap = model.emotionMap || {};
  }

  extractEmotion(text) {
    const found = [];
    const lower = text.toLowerCase();
    for (const emotion of Object.keys(this.emotionMap)) {
      const tag = `[${emotion}]`;
      if (lower.includes(tag)) found.push(emotion);
    }
    return found;
  }

  removeEmotion(text) {
    let result = text;
    for (const emotion of Object.keys(this.emotionMap)) {
      result = result.replace(new RegExp(`\\[${emotion}\\]`, 'gi'), '').trim();
    }
    return result;
  }

  expressionFile(emotion) {
    return this.emotionMap[emotion] || null;
  }

  get emotions() {
    return Object.keys(this.emotionMap).filter(e => this.emotionMap[e]);
  }
}

module.exports = { VTubeModel };
