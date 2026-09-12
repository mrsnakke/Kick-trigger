const MOOD_STATES = {
  neutral: { prompt: '', ttsRate: 0 },
  happy: {
    prompt: 'Estás de buen humor ahora. Sonríe más, sé más amable y entusiasta. Haz cumplidos sutiles.',
    ttsRate: 10,
  },
  annoyed: {
    prompt: 'Algo te molestó. Sé más directa, sarcástica y ácida. Responde con más filo del normal.',
    ttsRate: -10,
  },
  playful: {
    prompt: 'Estás juguetona y traviesa. Haz bromas, sé coqueta, provoca al chat.',
    ttsRate: 5,
  },
  tired: {
    prompt: 'Es tarde y estás cansada. Habla más suave, haz comentarios de sueño, a veces bosteza.',
    ttsRate: -15,
  },
};

class MoodSystem {
  constructor() {
    this.currentMood = 'neutral';
    this.moodIntensity = 0;
    this.lastUpdate = Date.now();
    this.decayTime = 5 * 60 * 1000;
  }

  processEvent(eventType) {
    switch (eventType) {
      case 'gift':
      case 'sub':
      case 'follow':
      case 'first_message':
        this._shift('happy', 0.8);
        break;
      case 'insult':
      case 'troll':
      case 'ban':
        this._shift('annoyed', 0.6);
        break;
      case 'joke':
      case 'funny':
      case 'laugh':
        this._shift('playful', 0.7);
        break;
      case 'late_night':
      case 'long_stream':
        this._shift('tired', 0.5);
        break;
    }
  }

  processMessageContent(content) {
    const lower = (content || '').toLowerCase();
    if (/jaja|jajaja|xd|lol|buena|gracioso/.test(lower)) {
      this._shift('playful', 0.4);
    }
    if (/pendejo|estúpido|idiota|basura|fea|mala|odio/.test(lower)) {
      this._shift('annoyed', 0.3);
    }
  }

  _shift(newMood, intensity) {
    this.currentMood = newMood;
    this.moodIntensity = Math.min(1, intensity);
    this.lastUpdate = Date.now();
  }

  getMoodContext() {
    const elapsed = Date.now() - this.lastUpdate;
    if (elapsed > this.decayTime) {
      this.moodIntensity *= 0.8;
      if (this.moodIntensity < 0.1) {
        this.currentMood = 'neutral';
        this.moodIntensity = 0;
      }
    }
    if (this.currentMood === 'neutral') return '';
    return '\n\n[ESTADO DE ÁNIMO ACTUAL: ' + MOOD_STATES[this.currentMood].prompt + ']';
  }

  getTtsRateAdjustment() {
    return MOOD_STATES[this.currentMood] ? MOOD_STATES[this.currentMood].ttsRate : 0;
  }

  getState() {
    return { mood: this.currentMood, intensity: this.moodIntensity };
  }
}

module.exports = { MoodSystem, MOOD_STATES };
