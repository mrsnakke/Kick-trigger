const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { GrimMemory } = require('./memory');

async function main() {
  const dbPath = path.join(os.tmpdir(), 'grim-mem-check-' + Date.now() + '.db');
  const mem = new GrimMemory(dbPath);

  const tables = mem.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  assert(tables.includes('relations'), 'falta tabla relations');
  assert(tables.includes('vectors'), 'falta tabla vectors');
  assert(tables.includes('episodes'), 'falta tabla episodes');
  assert(!tables.includes('knowledge'), 'knowledge debería haberse migrado');

  mem.logMessage('marco', 'user', 'a marco le encanta el anime de los ochenta', null);
  assert.strictEqual(mem.db.prepare('SELECT COUNT(*) AS c FROM messages').get().c, 1, 'mensaje insertado');
  const autoRel = mem.db.prepare('SELECT * FROM relations').get();
  assert(autoRel, 'relación auto-extraída');

  mem.rememberMemory({ subject: 'marco', predicate: 'le gusta', object: 'el anime' });
  mem.rememberMemory({ subject: 'marco', predicate: 'le gusta', object: 'el anime' });
  const dupCount = mem.db.prepare("SELECT COUNT(*) AS c FROM relations WHERE predicate = 'le gusta' AND object_id = (SELECT id FROM entities WHERE name = 'el anime') AND soft_deleted = 0").get().c;
  assert.strictEqual(dupCount, 1, 'upsert debe ser idempotente (sin duplicados)');

  const res = await mem.searchMemory('anime ochenta', { username: 'marco' });
  assert(res.results.length >= 1, 'búsqueda por keywords debería encontrar el mensaje');

  const pending = mem.getPendingVectors(10);
  assert(pending.some(p => p.kind === 'message'), 'mensaje pendiente de vector');
  mem.setVector('message', pending.find(p => p.kind === 'message').id, new Float32Array([1, 0, 0, 1]));
  assert(mem.getPendingVectors(1).filter(p => p.kind === 'message' && p.id === 1).length === 0, 'vector almacenado, no debe reaparecer pendiente');

  mem.addEpisode({ title: 'Test', summary: 'Resumen de prueba', keywords: ['a'], participants: ['marco'], startTime: Date.now() - 1000, endTime: Date.now() });
  assert.strictEqual(mem.getRecentEpisodes(1).length, 1, 'episodio creado');

  const relId = mem.db.prepare("SELECT id FROM relations WHERE predicate = 'le gusta'").get().id;
  mem.db.prepare('UPDATE relations SET last_seen = ?, last_accessed = NULL, is_pinned = 0, confidence = 0.8 WHERE id = ?').run(Date.now() - 8 * 86400000, relId);
  const beforeDecay = mem.db.prepare('SELECT confidence FROM relations WHERE id = ?').get(relId).confidence;
  mem.runDecay();
  const afterDecay = mem.db.prepare('SELECT confidence FROM relations WHERE id = ?').get(relId).confidence;
  assert(afterDecay < beforeDecay, 'decay debe bajar la confianza');

  mem.reinforceRelation(relId);
  const afterReinforce = mem.db.prepare('SELECT confidence, access_count FROM relations WHERE id = ?').get(relId);
  assert(afterReinforce.confidence > afterDecay, 'refuerzo debe subir la confianza');
  assert(afterReinforce.access_count >= 1, 'refuerzo debe sumar acceso');

  mem.clearUser('marco');
  assert.strictEqual(mem.db.prepare('SELECT COUNT(*) AS c FROM messages').get().c, 0, 'mensajes limpiados');
  assert.strictEqual(mem.db.prepare('SELECT COUNT(*) AS c FROM relations WHERE soft_deleted = 0').get().c, 0, 'relaciones limpiadas');
  assert.strictEqual(mem.db.prepare('SELECT COUNT(*) AS c FROM vectors').get().c, 0, 'vectores limpiados');

  mem.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch {}
  }
  console.log('memory-check OK');
}

main().catch(e => {
  console.error('memory-check FAIL:', e.message);
  process.exit(1);
});