import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRoutes } from './server/api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

app.use((req, res, next) => {
  if (req.url.startsWith('/api/')) {
    const handled = apiRoutes(req, res);
    if (!handled) {
      res.status(404).json({ error: 'Not found' });
    }
    return;
  }
  next();
});

const dist = path.join(__dirname, 'dist');
app.use(express.static(dist));

app.get('/calibrate.html', (_req, res) => {
  res.sendFile(path.join(dist, 'calibrate.html'));
});
app.get('/calibrate', (_req, res) => {
  res.sendFile(path.join(dist, 'calibrate.html'));
});
app.get('/players.html', (_req, res) => {
  res.sendFile(path.join(dist, 'players.html'));
});
app.get('/players', (_req, res) => {
  res.sendFile(path.join(dist, 'players.html'));
});
app.get('*', (_req, res) => {
  res.sendFile(path.join(dist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`👊 Stream 1v1 server corriendo en http://localhost:${PORT}`);
  console.log(`   Escenario (OBS):      http://localhost:${PORT}/`);
  console.log(`   Calibración (panel):  http://localhost:${PORT}/calibrate`);
  console.log(`   Jugadores (panel):    http://localhost:${PORT}/players`);
});
