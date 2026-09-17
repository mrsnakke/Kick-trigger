const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { cosine, vecToBytes, bytesToVec } = require('./embed');

const DB_PATH = path.join(__dirname, '../../../data/grim-memory.db');
const LOG_DIR = process.env.VTUBER_LOG_DIR || './logs/vtuber-ai';
const SCHEMA_VERSION = 2;

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function truncate(content, max) {
  max = max || 300;
  if (!content || content.length <= max) return content;
  return content.slice(0, max).trimEnd() + '…';
}

function now() {
  return Date.now();
}

const STOPWORDS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'que', 'de', 'en', 'y', 'a', 'es', 'se', 'no', 'por', 'con', 'para', 'como', 'pero', 'si', 'yo', 'tu', 'su', 'me', 'te', 'le', 'lo', 'del', 'al', 'más', 'muy', 'todo', 'nada', 'algo', 'cuando', 'como', 'the', 'and', 'for']);

function termsOf(text) {
  return String(text || '').toLowerCase()
    .replace(/[¿?¡!.,;:()[\]"'"“”]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

class GrimMemory {
  constructor(dbPath) {
    this.db = new Database(dbPath || DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.ftsAvailable = true;
    this.init();
    this.migrate();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER
      );
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
      CREATE TABLE IF NOT EXISTS daily_summaries (
        day TEXT PRIMARY KEY,
        summary TEXT,
        key_topics TEXT DEFAULT '[]',
        active_users TEXT DEFAULT '[]',
        total_messages INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        kind TEXT NOT NULL DEFAULT 'thing',
        created_at INTEGER,
        last_seen INTEGER
      );
      CREATE TABLE IF NOT EXISTS relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_id INTEGER NOT NULL,
        predicate TEXT NOT NULL,
        object_id INTEGER NOT NULL,
        confidence REAL DEFAULT 1.0,
        source_user TEXT,
        created_at INTEGER,
        last_seen INTEGER,
        access_count INTEGER DEFAULT 0,
        last_accessed INTEGER,
        is_pinned INTEGER DEFAULT 0,
        soft_deleted INTEGER DEFAULT 0,
        UNIQUE(subject_id, predicate, object_id)
      );
      CREATE INDEX IF NOT EXISTS idx_rel_subject ON relations(subject_id);
      CREATE INDEX IF NOT EXISTS idx_rel_object ON relations(object_id);
      CREATE TABLE IF NOT EXISTS vectors (
        kind TEXT NOT NULL,
        ref_id INTEGER NOT NULL,
        vector BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(kind, ref_id)
      );
      CREATE INDEX IF NOT EXISTS idx_vectors_kind ON vectors(kind);
      CREATE TABLE IF NOT EXISTS episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        summary TEXT,
        keywords TEXT DEFAULT '[]',
        participants TEXT DEFAULT '[]',
        start_time INTEGER,
        end_time INTEGER,
        created_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_episodes_end ON episodes(end_time);
    `);

    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(username, content, tokenize='unicode61');
        CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, username, content) VALUES (new.id, new.username, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
          DELETE FROM messages_fts WHERE rowid = old.id;
        END;
        CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
          DELETE FROM messages_fts WHERE rowid = old.id;
          INSERT INTO messages_fts(rowid, username, content) VALUES (new.id, new.username, new.content);
        END;
      `);
    } catch (e) {
      this.ftsAvailable = false;
      console.warn('[GrimMemory] FTS5 no disponible, búsqueda por LIKE: ' + e.message);
    }
  }

  migrate() {
    const row = this.db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get();
    const current = row ? row.version : 0;
    if (current >= SCHEMA_VERSION) return;

    const hasOld = this.db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='knowledge'").get().c > 0;
    if (hasOld) {
      const oldRows = this.db.prepare('SELECT * FROM knowledge').all();
      const tx = this.db.transaction(rows => {
        for (const r of rows) {
          this._insertRelation(r.entity, r.relation, r.value, {
            confidence: r.confidence != null ? r.confidence : 1,
            sourceUser: r.source_user,
            createdAt: r.created_at || now(),
            lastSeen: r.last_seen || now(),
          });
        }
      });
      tx(oldRows);
      this.db.exec('DROP TABLE IF EXISTS knowledge');
    }

    if (this.ftsAvailable) {
      try {
        this.db.exec("INSERT INTO messages_fts(rowid, username, content) SELECT id, username, content FROM messages WHERE id NOT IN (SELECT rowid FROM messages_fts)");
      } catch {}
    }

    this.db.prepare('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(SCHEMA_VERSION, now());
    console.log('[GrimMemory] Migrado a esquema v' + SCHEMA_VERSION);
  }

  // ─── entities ───

  _getEntity(name) {
    return this.db.prepare('SELECT * FROM entities WHERE name = ?').get(String(name || '').trim().toLowerCase());
  }

  _entityKind(name) {
    const n = String(name || '').trim();
    if (this.db.prepare('SELECT 1 FROM user_profiles WHERE LOWER(username) = ?').get(n.toLowerCase())) return 'user';
    return 'thing';
  }

  _ensureEntity(name, kind) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    let e = this._getEntity(n);
    if (!e) {
      const info = this.db.prepare('INSERT INTO entities (name, kind, created_at, last_seen) VALUES (?, ?, ?, ?)').run(n, kind || 'thing', now(), now());
      e = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(info.lastInsertRowid);
    } else {
      this.db.prepare('UPDATE entities SET last_seen = ? WHERE id = ?').run(now(), e.id);
    }
    return e;
  }

  // ─── relations / grafo ───

  _insertRelation(subject, predicate, object, opts) {
    opts = opts || {};
    const sub = this._ensureEntity(subject, this._entityKind(subject));
    const obj = this._ensureEntity(object, 'thing');
    if (!sub || !obj || !predicate) return null;
    const pred = String(predicate).trim().toLowerCase();
    const conf = Math.min(1, Math.max(0, opts.confidence != null ? opts.confidence : 1));
    const ts = opts.createdAt || now();
    const seen = opts.lastSeen || now();

    let rel = this.db.prepare(
      'SELECT * FROM relations WHERE subject_id = ? AND predicate = ? AND object_id = ?'
    ).get(sub.id, pred, obj.id);

    if (rel) {
      this.db.prepare(
        'UPDATE relations SET last_seen = ?, confidence = MAX(confidence, ?), soft_deleted = 0, is_pinned = CASE WHEN MAX(confidence, ?) >= 0.95 THEN 1 ELSE is_pinned END WHERE id = ?'
      ).run(seen, conf, conf, rel.id);
      return rel.id;
    }

    const info = this.db.prepare(
      'INSERT INTO relations (subject_id, predicate, object_id, confidence, source_user, created_at, last_seen, is_pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(sub.id, pred, obj.id, conf, opts.sourceUser || null, ts, seen, conf >= 0.95 ? 1 : 0);
    return info.lastInsertRowid;
  }

  rememberMemory({ subject, predicate, object, confidence, sourceUser }) {
    if (!subject || !predicate || !object) throw new Error('remember_memory: subject/predicate/object requeridos');
    return this._insertRelation(subject, predicate, object, { confidence, sourceUser, createdAt: now(), lastSeen: now() });
  }

  reinforceRelation(id) {
    this.db.prepare(
      'UPDATE relations SET access_count = access_count + 1, last_accessed = ?, confidence = MIN(1, confidence + 0.03) WHERE id = ?'
    ).run(now(), id);
  }

  _graphRelations(username, sinceMs, boost) {
    if (!username) return [];
    const e = this._getEntity(username);
    if (!e) return [];
    const where = ['r.soft_deleted = 0', '(r.subject_id = ? OR r.object_id = ?)'];
    const params = [e.id, e.id];
    if (sinceMs) {
      where.push('r.last_seen >= ?');
      params.push(sinceMs);
    }
    params.push(200);
    return this.db.prepare(
      'SELECT r.id, r.confidence, r.last_seen, r.predicate, r.source_user, s.name AS subject, o.name AS object ' +
      'FROM relations r JOIN entities s ON s.id = r.subject_id JOIN entities o ON o.id = r.object_id ' +
      'WHERE ' + where.join(' AND ') + ' ORDER BY r.last_seen DESC LIMIT ?'
    ).all(...params).map(r => ({ ...r, base: (boost == null ? 1 : boost) * 0.5 * r.confidence }));
  }

  // ─── búsqueda por keywords ───

  _likeMessages(terms, { username, sinceMs, top }) {
    const conditions = terms.map(() => 'content LIKE ?').join(' OR ');
    const where = ['(' + conditions + ')'];
    const params = terms.map(t => '%' + t + '%');
    if (username) {
      where.push('username = ?');
      params.push(username);
    }
    if (sinceMs) {
      where.push('timestamp >= ?');
      params.push(sinceMs);
    }
    params.push(top);
    return this.db.prepare(
      'SELECT id, content AS text, username, role, timestamp FROM messages WHERE ' + where.join(' AND ') + ' ORDER BY timestamp DESC LIMIT ?'
    ).all(...params);
  }

  _keywordsFromMessages(terms, { username, sinceMs, top }) {
    if (this.ftsAvailable) {
      const match = terms.map(t => '"' + t.replace(/"/g, '""') + '"').join(' AND ');
      const where = ['messages_fts MATCH ?'];
      const params = [match];
      if (username) {
        where.push('m.username = ?');
        params.push(username);
      }
      if (sinceMs) {
        where.push('m.timestamp >= ?');
        params.push(sinceMs);
      }
      params.push(top);
      let rows;
      try {
        rows = this.db.prepare(
          'SELECT m.id, m.content AS text, m.username, m.role, m.timestamp, -bm25(messages_fts) AS k ' +
          'FROM messages m JOIN messages_fts ON messages_fts.rowid = m.id ' +
          'WHERE ' + where.join(' AND ') + ' ORDER BY k DESC LIMIT ?'
        ).all(...params);
        if (rows.length) {
          const maxK = Math.max(...rows.map(r => r.k));
          const minK = Math.min(...rows.map(r => r.k));
          return rows.map(r => ({ id: r.id, text: r.text, username: r.username, role: r.role, timestamp: r.timestamp, kw: 1 - 0.01 * (maxK === minK ? 0 : (maxK - r.k) / (maxK - minK)) }));
        }
        return [];
      } catch {
        return this._likeMessages(terms, { username, sinceMs, top }).map(r => ({ ...r, kw: 1 }));
      }
    }
    return this._likeMessages(terms, { username, sinceMs, top }).map(r => ({ ...r, kw: 1 }));
  }

  _keywordsRelations(terms, { username, sinceMs, top }) {
    const conds = terms.map(() => '(s.name LIKE ? OR o.name LIKE ? OR r.predicate LIKE ?)').join(' OR ');
    const where = ['r.soft_deleted = 0', '(' + conds + ')'];
    const params = [];
    for (const t of terms) params.push('%' + t + '%', '%' + t + '%', '%' + t + '%');
    if (sinceMs) {
      where.push('r.last_seen >= ?');
      params.push(sinceMs);
    }
    params.push(top);
    const rows = this.db.prepare(
      'SELECT r.id, r.confidence, r.last_seen, r.predicate, r.source_user, s.name AS subject, o.name AS object ' +
      'FROM relations r JOIN entities s ON s.id = r.subject_id JOIN entities o ON o.id = r.object_id ' +
      'WHERE ' + where.join(' AND ') + ' ORDER BY r.last_seen DESC LIMIT ?'
    ).all(...params);
    return rows.map(r => {
      const line = (r.subject + ' ' + r.predicate + ' ' + r.object).toLowerCase();
      const hits = terms.filter(t => line.includes(t)).length;
      return { ...r, kw: hits / terms.length };
    });
  }

  _keywordsEpisodes(terms, { sinceMs, top }) {
    const conds = terms.map(() => '(title LIKE ? OR summary LIKE ? OR keywords LIKE ?)').join(' OR ');
    const where = ['(' + conds + ')'];
    const params = [];
    for (const t of terms) params.push('%' + t + '%', '%' + t + '%', '%' + t + '%');
    if (sinceMs) {
      where.push('end_time >= ?');
      params.push(sinceMs);
    }
    params.push(top);
    const rows = this.db.prepare(
      'SELECT * FROM episodes WHERE ' + where.join(' AND ') + ' ORDER BY end_time DESC LIMIT ?'
    ).all(...params);
    return rows.map(r => {
      const line = ((r.title || '') + ' ' + (r.summary || '')).toLowerCase();
      const hits = terms.filter(t => line.includes(t)).length;
      return { ...r, kw: hits / terms.length };
    });
  }

  // ─── búsqueda semántica (vectores) ───

  _vectorsBy(kind, qvec, { username, sinceMs, top }) {
    if (!qvec) return [];
    let sql, rows;
    if (kind === 'message') {
      const where = ["v.kind = 'message'"];
      const params = [];
      if (username) {
        where.push('m.username = ?');
        params.push(username);
      }
      if (sinceMs) {
        where.push('m.timestamp >= ?');
        params.push(sinceMs);
      }
      rows = this.db.prepare(
        'SELECT v.ref_id AS id, v.vector, m.content AS text, m.username, m.role, m.timestamp FROM vectors v ' +
        'JOIN messages m ON m.id = v.ref_id WHERE ' + where.join(' AND ')
      ).all(...params);
    } else if (kind === 'relation') {
      const where = ["v.kind = 'relation'", 'r.soft_deleted = 0'];
      const params = [];
      if (sinceMs) {
        where.push('r.last_seen >= ?');
        params.push(sinceMs);
      }
      rows = this.db.prepare(
        'SELECT v.ref_id AS id, v.vector, r.confidence, r.last_seen, r.predicate, r.source_user, s.name AS subject, o.name AS object ' +
        'FROM vectors v JOIN relations r ON r.id = v.ref_id ' +
        'JOIN entities s ON s.id = r.subject_id JOIN entities o ON o.id = r.object_id ' +
        'WHERE ' + where.join(' AND ')
      ).all(...params);
    } else {
      const where = ["v.kind = 'episode'"];
      const params = [];
      if (sinceMs) {
        where.push('e.end_time >= ?');
        params.push(sinceMs);
      }
      rows = this.db.prepare(
        'SELECT v.ref_id AS id, v.vector, e.title, e.summary, e.end_time FROM vectors v ' +
        'JOIN episodes e ON e.id = v.ref_id WHERE ' + where.join(' AND ')
      ).all(...params);
    }
    const out = [];
    for (const r of rows) {
      const score = cosine(qvec, bytesToVec(r.vector));
      if (score > 0.02) out.push({ ...r, vec: Math.max(0, score) });
    }
    out.sort((a, b) => b.vec - a.vec);
    return out.slice(0, top || 80);
  }

  // ─── búsqueda pública (híbrida) ───

  async searchMemory(query, opts) {
    opts = opts || {};
    const { username, sinceDays, kinds = ['message', 'relation', 'episode'], limit = 8, embedder } = opts;
    const sinceMs = sinceDays ? now() - sinceDays * 86400000 : null;
    const qtext = String(query || '').trim();
    if (!qtext) return { results: [], text: 'Sin consulta.' };

    let qvec = null;
    if (embedder && embedder.enabled) qvec = await embedder.embedSingle(qtext);

    const terms = termsOf(qtext);
    const cand = new Map();
    const add = (key, partial) => {
      const prev = cand.get(key);
      if (prev) Object.assign(prev, partial);
      else cand.set(key, partial);
    };

    if (kinds.includes('message')) {
      for (const r of this._vectorsBy('message', qvec, { username, sinceMs, top: 80 })) {
        add('message:' + r.id, { kind: 'message', ref: r.id, vec: r.vec, text: r.text, username: r.username, role: r.role, timestamp: r.timestamp });
      }
      if (terms.length) {
        for (const r of this._keywordsFromMessages(terms, { username, sinceMs, top: 40 })) {
          add('message:' + r.id, { kind: 'message', ref: r.id, kw: r.kw, text: r.text, username: r.username, role: r.role, timestamp: r.timestamp });
        }
      }
    }

    if (kinds.includes('relation')) {
      for (const r of this._vectorsBy('relation', qvec, { sinceMs, top: 60 })) {
        add('relation:' + r.id, { kind: 'relation', ref: r.id, vec: r.vec, relation: r });
      }
      if (terms.length) {
        for (const r of this._keywordsRelations(terms, { sinceMs, top: 40 })) {
          add('relation:' + r.id, { kind: 'relation', ref: r.id, kw: r.kw, relation: r });
        }
      }
      for (const r of this._graphRelations(username, sinceMs, username ? 1 : 0.5)) {
        add('relation:' + r.id, { kind: 'relation', ref: r.id, base: r.base, relation: r });
      }
    }

    if (kinds.includes('episode')) {
      for (const r of this._vectorsBy('episode', qvec, { sinceMs, top: 40 })) {
        add('episode:' + r.id, { kind: 'episode', ref: r.id, vec: r.vec, episode: r });
      }
      if (terms.length) {
        for (const r of this._keywordsEpisodes(terms, { sinceMs, top: 20 })) {
          add('episode:' + r.id, { kind: 'episode', ref: r.id, kw: r.kw, episode: r });
        }
      }
    }

    let results = [];
    for (const c of cand.values()) {
      const score = 0.7 * (c.vec || 0) + 0.3 * (c.kw || 0) + (c.base || 0);
      if (score > 0.01) {
        results.push({
          key: c.kind + ':' + c.ref,
          kind: c.kind,
          ref: c.ref,
          score,
          relation: c.relation,
          episode: c.episode,
          message: c.text != null ? { text: c.text, username: c.username, role: c.role, timestamp: c.timestamp } : null,
        });
      }
    }
    results.sort((a, b) => b.score - a.score);
    results = results.slice(0, limit);

    for (const r of results) {
      if (r.relation) this.reinforceRelation(r.relation.id);
    }

    const lines = results.map(r => {
      if (r.kind === 'relation') {
        const rel = r.relation;
        return '- ' + rel.subject + ' ' + rel.predicate + ' ' + rel.object + ' (confianza ' + Math.round(rel.confidence * 100) + '%, del usuario: ' + (rel.source_user || 'desconocido') + ')';
      }
      if (r.kind === 'episode') {
        return '- [episodio: ' + r.episode.title + '] ' + (r.episode.summary || '');
      }
      const m = r.message;
      return '- ' + (m.username || '?') + ': "' + truncate(m.text, 140) + '"';
    });

    return { results, text: lines.join('\n') };
  }

  getGraphContext(username, limit) {
    limit = limit || 12;
    const rels = this._graphRelations(username, null);
    const out = [];
    for (const r of rels) {
      const line = r.subject + ' ' + r.predicate + ' ' + r.object;
      out.push({ subject: r.subject, predicate: r.predicate, object: r.object, relation: r.predicate, value: r.object, line });
      if (out.length >= limit) break;
    }
    return out;
  }

  // ─── vectores (cola de embedding) ───

  getPendingVectors(limit) {
    limit = limit || 20;
    const out = [];
    const msgs = this.db.prepare(
      'SELECT id, content AS text FROM messages WHERE NOT EXISTS (SELECT 1 FROM vectors WHERE kind = ? AND ref_id = messages.id) LIMIT ?'
    ).all('message', limit);
    for (const r of msgs) out.push({ ...r, kind: 'message' });
    if (out.length >= limit) return out;
    const rels = this.db.prepare(
      `SELECT r.id, (s.name || ' ' || r.predicate || ' ' || o.name) AS text FROM relations r ` +
      'JOIN entities s ON s.id = r.subject_id JOIN entities o ON o.id = r.object_id ' +
      'WHERE r.soft_deleted = 0 AND NOT EXISTS (SELECT 1 FROM vectors WHERE kind = ? AND ref_id = r.id) LIMIT ?'
    ).all('relation', limit - out.length);
    for (const r of rels) out.push({ ...r, kind: 'relation' });
    if (out.length >= limit) return out;
    const eps = this.db.prepare(
      `SELECT id, (COALESCE(title, '') || '. ' || COALESCE(summary, '')) AS text FROM episodes ` +
      'WHERE NOT EXISTS (SELECT 1 FROM vectors WHERE kind = ? AND ref_id = episodes.id) LIMIT ?'
    ).all('episode', limit - out.length);
    for (const r of eps) out.push({ ...r, kind: 'episode' });
    return out;
  }

  setVector(kind, refId, vec) {
    const b = vec instanceof Float32Array ? vecToBytes(vec) : vec;
    if (!b || !b.length) return;
    this.db.prepare('INSERT OR REPLACE INTO vectors (kind, ref_id, vector, created_at) VALUES (?, ?, ?, ?)').run(kind, refId, b, now());
  }

  // ─── contexto para el chat ───

  getSmartContext(username, currentMessage, maxTurns) {
    maxTurns = maxTurns || 15;
    return {
      recentHistory: this._getRecentHistory(username, maxTurns),
      userProfile: this._getUserProfile(username),
      relevantMemory: this._searchRelevant(username, currentMessage),
      userKnowledge: this._getUserKnowledge(username),
      todaySummary: this._getTodaySummary(),
      recentEpisodes: this.getRecentEpisodes(3),
    };
  }

  _getRecentHistory(username, maxTurns) {
    const messages = this.db.prepare(
      'SELECT role, content, username, timestamp FROM messages WHERE username = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(username, maxTurns * 2).reverse();
    for (const m of messages) m.content = truncate(m.content);
    return messages;
  }

  _searchRelevant(username, query) {
    if (!query) return [];
    const terms = termsOf(query);
    if (!terms.length) return [];
    if (this.ftsAvailable) {
      const match = terms.map(t => '"' + t.replace(/"/g, '""') + '"').join(' AND ');
      try {
        return this.db.prepare(
          'SELECT content, username, timestamp, role FROM messages JOIN messages_fts ON messages_fts.rowid = messages.id ' +
          'WHERE messages_fts MATCH ? AND username = ? ORDER BY bm25(messages_fts) ASC LIMIT 10'
        ).all(match, username).map(m => ({ ...m, content: truncate(m.content) }));
      } catch {
        /* cae a LIKE */
      }
    }
    return this._likeMessages(terms, { username, top: 10 }).map(m => ({ ...m, content: truncate(m.text) }));
  }

  _getUserKnowledge(username) {
    const rels = this._graphRelations(username, null);
    const out = [];
    for (const r of rels) {
      out.push({ relation: r.predicate, value: r.object, subject: r.subject, line: r.subject + ' ' + r.predicate + ' ' + r.object });
      if (out.length >= 10) break;
    }
    return out;
  }

  _getUserProfile(username) {
    return this.db.prepare('SELECT * FROM user_profiles WHERE username = ?').get(username);
  }

  _updateUserProfile(username) {
    const existing = this._getUserProfile(username);
    const ts = now();
    if (!existing) {
      this.db.prepare('INSERT INTO user_profiles (username, first_seen, last_seen, message_count) VALUES (?, ?, ?, 1)').run(username, ts, ts);
    } else {
      this.db.prepare('UPDATE user_profiles SET last_seen = ?, message_count = message_count + 1 WHERE username = ?').run(ts, username);
    }
  }

  logMessage(username, role, content, streamId) {
    const ts = now();
    const day = new Date().toISOString().slice(0, 10);
    this.db.prepare(
      'INSERT INTO messages (username, role, content, timestamp, day, stream_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(username, role, content, ts, day, streamId || null);
    if (role === 'user') {
      this._updateUserProfile(username);
      this._extractKnowledge(username, content);
    }
  }

  _extractKnowledge(username, content) {
    const patterns = [
      /(?:a\s+)?(\w+)\s+le\s+(?:gusta|encanta|ama|odia|disgusta)\s+(.+?)(?:\.|,|!|$)/gi,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const subject = match[1].trim().toLowerCase();
        let object = match[2].trim();
        if (!subject || object.length < 2) continue;
        object = object.toLowerCase();
        const predicate = /odio|disgusta/.test(content) ? 'disgusta' : 'le gusta';
        this.rememberMemory({ subject, predicate, object, confidence: 0.9, sourceUser: username });
      }
    }
  }

  _getTodaySummary() {
    const today = new Date().toISOString().slice(0, 10);
    return this.db.prepare('SELECT * FROM daily_summaries WHERE day = ?').get(today);
  }

  // ─── episodios ───

  addEpisode({ title, summary, keywords, participants, startTime, endTime }) {
    const info = this.db.prepare(
      'INSERT INTO episodes (title, summary, keywords, participants, start_time, end_time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(title || 'Stream', summary || '', JSON.stringify(keywords || []), JSON.stringify(participants || []), startTime || now(), endTime || now(), now());
    return info.lastInsertRowid;
  }

  getRecentEpisodes(n) {
    n = n || 3;
    const rows = this.db.prepare('SELECT * FROM episodes ORDER BY end_time DESC LIMIT ?').all(n);
    for (const r of rows) {
      r.keywords = JSON.parse(r.keywords || '[]');
      r.participants = JSON.parse(r.participants || '[]');
    }
    return rows;
  }

  lastEpisodeEnd() {
    return this.db.prepare('SELECT COALESCE(MAX(end_time), 0) AS t FROM episodes').get().t;
  }

  pendingMessagesCount(sinceMs) {
    return this.db.prepare('SELECT COUNT(*) AS c FROM messages WHERE role = ? AND timestamp >= ?').get('user', sinceMs || 0).c;
  }

  getWindowMessages(start, end, limit) {
    limit = limit || 400;
    return this.db.prepare(
      'SELECT username, content FROM messages WHERE role = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC LIMIT ?'
    ).all('user', start || 0, end || now(), limit);
  }

  // ─── utilidades legadas ───

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
      "SELECT username, content, role FROM messages WHERE day = ? AND role = 'user' ORDER BY timestamp ASC"
    ).all(day);
    const activeUsers = [...new Set(messages.map(m => m.username))];
    const allContent = messages.map(m => m.content).join(' ');
    const words = allContent.toLowerCase().replace(/[¿?¡!.,;:]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOPWORDS.has(w));
    const freq = {};
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    const keyTopics = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
    const summary = 'Stream del día ' + day + '. ' + messages.length + ' mensajes de ' + activeUsers.length + ' usuarios. Temas: ' + keyTopics.slice(0, 5).join(', ') + '.';
    this.db.prepare(
      'INSERT OR REPLACE INTO daily_summaries (day, summary, key_topics, active_users, total_messages) VALUES (?, ?, ?, ?, ?)'
    ).run(day, summary, JSON.stringify(keyTopics), JSON.stringify(activeUsers), messages.length);
    return { day, summary, keyTopics, activeUsers, totalMessages: messages.length };
  }

  // ─── decay / refuerzo ───

  runDecay() {
    const cutoff = now() - 7 * 86400000;
    const decayed = this.db.prepare(
      'UPDATE relations SET confidence = MAX(0.05, confidence * 0.95) ' +
      'WHERE is_pinned = 0 AND soft_deleted = 0 AND COALESCE(last_accessed, last_seen) < ?'
    ).run(cutoff).changes;
    const pruned = this.db.prepare(
      'UPDATE relations SET soft_deleted = 1 WHERE is_pinned = 0 AND soft_deleted = 0 AND confidence < 0.2'
    ).run().changes;
    return { decayed, pruned };
  }

  // ─── limpieza ───

  clearUser(username) {
    const tx = this.db.transaction((u) => {
      const e = this._getEntity(u);
      if (e) {
        this.db.prepare('DELETE FROM vectors WHERE kind = ? AND ref_id IN (SELECT id FROM relations WHERE subject_id = ? OR object_id = ? OR source_user = ?)').run('relation', e.id, e.id, u);
        this.db.prepare('DELETE FROM relations WHERE subject_id = ? OR object_id = ? OR source_user = ?').run(e.id, e.id, u);
        this.db.prepare('DELETE FROM entities WHERE id = ?').run(e.id);
      }
      this.db.prepare('DELETE FROM vectors WHERE kind = ? AND ref_id IN (SELECT id FROM messages WHERE username = ?)').run('message', u);
      this.db.prepare('DELETE FROM messages WHERE username = ?').run(u);
      this.db.prepare('DELETE FROM user_profiles WHERE username = ?').run(u);
    });
    tx(username);
  }

  clearAll() {
    this.db.prepare('DELETE FROM vectors').run();
    this.db.prepare('DELETE FROM relations').run();
    this.db.prepare('DELETE FROM entities').run();
    this.db.prepare('DELETE FROM episodes').run();
    this.db.prepare('DELETE FROM messages').run();
    this.db.prepare('DELETE FROM user_profiles').run();
    this.db.prepare('DELETE FROM daily_summaries').run();
  }

  stats() {
    const count = (t) => this.db.prepare('SELECT COUNT(*) AS c FROM ' + t).get().c;
    const messages = count('messages');
    const vectors = count('vectors');
    return {
      totalMessages: messages,
      totalUsers: this.db.prepare('SELECT COUNT(DISTINCT username) AS c FROM messages').get().c,
      totalDays: this.db.prepare('SELECT COUNT(DISTINCT day) AS c FROM messages').get().c,
      totalKnowledge: count('relations'),
      totalRelations: count('relations'),
      totalEntities: count('entities'),
      totalEpisodes: count('episodes'),
      totalVectors: vectors,
      vectorCoverage: messages > 0 ? Math.round((vectors / messages) * 100) / 100 : 0,
      pendingVectors: this.db.prepare('SELECT COUNT(*) AS c FROM messages WHERE NOT EXISTS (SELECT 1 FROM vectors WHERE kind = ? AND ref_id = messages.id)').get('message').c,
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
            ).run(entry.username || username, entry.role, entry.content, entry.timestamp || now(), day);
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