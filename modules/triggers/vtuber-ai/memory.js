const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../../data/grim-memory.db');
const LOG_DIR = process.env.VTUBER_LOG_DIR || './logs/vtuber-ai';

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

class GrimMemory {
  constructor(dbPath) {
    this.db = new Database(dbPath || DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        day TEXT NOT NULL,
        stream_id TEXT,
        tags TEXT DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_msg_user ON messages(username);
      CREATE INDEX IF NOT EXISTS idx_msg_day ON messages(day);
      CREATE INDEX IF NOT EXISTS idx_msg_time ON messages(timestamp);
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        username TEXT PRIMARY KEY,
        display_name TEXT,
        first_seen INTEGER,
        last_seen INTEGER,
        message_count INTEGER DEFAULT 0,
        interests TEXT DEFAULT '{}',
        relationship TEXT DEFAULT 'viewer',
        notes TEXT DEFAULT ''
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_summaries (
        day TEXT PRIMARY KEY,
        summary TEXT,
        key_topics TEXT DEFAULT '[]',
        active_users TEXT DEFAULT '[]',
        total_messages INTEGER DEFAULT 0
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL,
        relation TEXT NOT NULL,
        value TEXT NOT NULL,
        source_user TEXT,
        confidence REAL DEFAULT 1.0,
        created_at INTEGER,
        last_seen INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_know_entity ON knowledge(entity);
    `);
  }

  logMessage(username, role, content, streamId) {
    const now = Date.now();
    const day = new Date().toISOString().slice(0, 10);
    this.db.prepare(
      'INSERT INTO messages (username, role, content, timestamp, day, stream_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(username, role, content, now, day, streamId || null);
    if (role === 'user') this._updateUserProfile(username, content);
    this._extractKnowledge(username, content);
  }

  getSmartContext(username, currentMessage, maxTurns) {
    maxTurns = maxTurns || 15;
    return {
      recentHistory: this._getRecentHistory(username, maxTurns),
      userProfile: this._getUserProfile(username),
      relevantMemory: this._searchRelevant(currentMessage),
      todaySummary: this._getTodaySummary(),
    };
  }

  _getRecentHistory(username, maxTurns) {
    let messages = this.db.prepare(
      'SELECT role, content, username, timestamp FROM messages WHERE username = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(username, maxTurns * 2);

    if (messages.length < maxTurns) {
      const general = this.db.prepare(
        'SELECT role, content, username, timestamp FROM messages WHERE username != ? ORDER BY timestamp DESC LIMIT ?'
      ).all(username, maxTurns - messages.length);
      messages = [...general.reverse(), ...messages.reverse()];
    } else {
      messages = messages.reverse();
    }
    return messages;
  }

  _searchRelevant(query) {
    if (!query) return [];
    const keywords = query.toLowerCase()
      .replace(/[¿?¡!.,;:]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3);
    if (keywords.length === 0) return [];

    const conditions = keywords.map(() => 'LOWER(content) LIKE ?').join(' OR ');
    const params = keywords.map(k => '%' + k + '%');
    return this.db.prepare(
      'SELECT content, username, timestamp, role FROM messages WHERE ' + conditions + ' ORDER BY timestamp DESC LIMIT 10'
    ).all(...params);
  }

  _getUserProfile(username) {
    return this.db.prepare('SELECT * FROM user_profiles WHERE username = ?').get(username);
  }

  _updateUserProfile(username) {
    const existing = this._getUserProfile(username);
    const now = Date.now();
    if (!existing) {
      this.db.prepare(
        'INSERT INTO user_profiles (username, first_seen, last_seen, message_count) VALUES (?, ?, ?, 1)'
      ).run(username, now, now);
    } else {
      this.db.prepare(
        'UPDATE user_profiles SET last_seen = ?, message_count = message_count + 1 WHERE username = ?'
      ).run(now, username);
    }
  }

  _extractKnowledge(username, content) {
    const patterns = [
      /(?:a\s+)?(\w+)\s+le\s+(?:gusta|encanta|ama|odia|disgusta)\s+(.+?)(?:\.|,|!|$)/gi,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const entity = match[1].toLowerCase();
        const value = match[2].trim().toLowerCase();
        if (entity.length < 2 || value.length < 2) continue;
        const relation = /odio|disgusta/.test(content) ? 'dislikes' : 'likes';
        const exists = this.db.prepare(
          'SELECT id FROM knowledge WHERE entity = ? AND relation = ? AND value = ?'
        ).get(entity, relation, value);
        if (!exists) {
          this.db.prepare(
            'INSERT INTO knowledge (entity, relation, value, source_user, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(entity, relation, value, username, Date.now(), Date.now());
        }
      }
    }
  }

  _getTodaySummary() {
    const today = new Date().toISOString().slice(0, 10);
    return this.db.prepare('SELECT * FROM daily_summaries WHERE day = ?').get(today);
  }

  getConversationSummary(daysBack) {
    daysBack = daysBack || 3;
    const summaries = [];
    for (let i = 0; i < daysBack; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const day = d.toISOString().slice(0, 10);
      const s = this.db.prepare('SELECT summary, key_topics, active_users FROM daily_summaries WHERE day = ?').get(day);
      if (s) summaries.push(s);
    }
    return summaries;
  }

  generateDailySummary(day) {
    const messages = this.db.prepare(
      'SELECT username, content, role FROM messages WHERE day = ? AND role = \'user\' ORDER BY timestamp ASC'
    ).all(day);
    const activeUsers = [...new Set(messages.map(m => m.username))];
    const allContent = messages.map(m => m.content).join(' ');
    const stopwords = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'que', 'de', 'en', 'y', 'a', 'es', 'se', 'no', 'por', 'con', 'para', 'como', 'pero', 'si', 'yo', 'tu', 'más', 'muy', 'todo', 'nada', 'algo']);
    const words = allContent.toLowerCase().replace(/[¿?¡!.,;:]/g, '').split(/\s+/).filter(w => w.length > 3 && !stopwords.has(w));
    const freq = {};
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    const keyTopics = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
    const summary = 'Stream del día ' + day + '. ' + messages.length + ' mensajes de ' + activeUsers.length + ' usuarios. Temas: ' + keyTopics.slice(0, 5).join(', ') + '.';
    this.db.prepare(
      'INSERT OR REPLACE INTO daily_summaries (day, summary, key_topics, active_users, total_messages) VALUES (?, ?, ?, ?, ?)'
    ).run(day, summary, JSON.stringify(keyTopics), JSON.stringify(activeUsers), messages.length);
    return { day, summary, keyTopics, activeUsers, totalMessages: messages.length };
  }

  clearUser(username) {
    this.db.prepare('DELETE FROM messages WHERE username = ?').run(username);
    this.db.prepare('DELETE FROM user_profiles WHERE username = ?').run(username);
  }

  clearAll() {
    this.db.prepare('DELETE FROM messages').run();
    this.db.prepare('DELETE FROM user_profiles').run();
    this.db.prepare('DELETE FROM daily_summaries').run();
    this.db.prepare('DELETE FROM knowledge').run();
  }

  stats() {
    return {
      totalMessages: this.db.prepare('SELECT COUNT(*) as c FROM messages').get().c,
      totalUsers: this.db.prepare('SELECT COUNT(DISTINCT username) as c FROM messages').get().c,
      totalDays: this.db.prepare('SELECT COUNT(DISTINCT day) as c FROM messages').get().c,
      totalKnowledge: this.db.prepare('SELECT COUNT(*) as c FROM knowledge').get().c,
    };
  }

  migrateFromJsonl() {
    if (!fs.existsSync(LOG_DIR)) return 0;
    const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl'));
    let migrated = 0;
    for (const file of files) {
      const parts = file.replace('.jsonl', '').split('_');
      const day = parts.pop();
      const username = parts.join('_');
      try {
        const content = fs.readFileSync(path.join(LOG_DIR, file), 'utf-8');
        const lines = content.trim().split('\n');
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            this.db.prepare(
              'INSERT OR IGNORE INTO messages (username, role, content, timestamp, day) VALUES (?, ?, ?, ?, ?)'
            ).run(entry.username || username, entry.role, entry.content, entry.timestamp || Date.now(), day);
            migrated++;
          } catch {}
        }
      } catch {}
    }
    console.log('[GrimMemory] Migrados ' + migrated + ' mensajes desde JSONL');
    return migrated;
  }

  close() {
    this.db.close();
  }
}

module.exports = { GrimMemory };
