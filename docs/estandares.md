# Reglas y estándares de desarrollo

Estas reglas existen para que un desarrollador nuevo pueda **añadir y modificar código
sin romper nada**. Léelas antes de tocar código.

## 1. Regla de oro: no toques el core

El **core** está en `lib/` y en `modules/*.js` del nivel superior (auth, webhook, chat,
tunnel, sse, events, forwarder, config, state). **No lo modifiques a menos que sea
estrictamente necesario.** Los triggers se conectan al
[Event Bus](arquitectura.md#event-bus--el-sistema-nervioso-central) sin tocar nada del
core. Si crees que necesitas tocar el core, primero pregunta — probablemente hay una
forma de hacerlo desde un módulo nuevo.

## 2. Cada trigger es autocontenido

- Cada `modules/triggers/<modulo>/` es una carpeta independiente con su propia lógica,
  persistencia y (si aplica) `package.json`.
- Todo lo que necesite publicar se hace vía **Event Bus** o **SSE** con `_source`.
- No dependas de detalles internos de otro módulo: escucha sus eventos públicos.

## 3. Los eventos pueden llegar DUPLICADOS — sé idempotente

El webhook deduplica por `message-id` con una ventana de **10 minutos**, pero ante
reinicios o re-subscripciones puedes recibir el mismo evento más de una vez. **Tu lógica
debe tolerar duplicados** (por ejemplo, un "give" no debe ejecutarse dos veces). Usa
flags en memoria o persistencia para evitarlo.

## 4. Manejo de errores

- **Cada módulo/trigger es responsable de su propio `try/catch`.** Un error en un trigger
  NUNCA debe tumbar el server.
- `server.js` ya captura `uncaughtException` y `unhandledRejection` como red de seguridad
  (los loguea como `[FATAL]`), pero **no confíes en eso**: captura tus errores.
- No dejes promesas sin `catch`; si escuchas un evento y llamas a un `async`, envuélvelo.
  Ejemplo correcto:
  ```js
  eventBus.on('chat.message.sent', (data) => {
    Promise.resolve(handle(data)).catch(err => console.error('[MI-MODULO]', err.message))
  })
  ```

## 5. Enrutado

- Usa **sub-paths únicos** por módulo: `/api/<modulo>/...` o `/<modulo>/...` (ej.
  `/gacha/*`, `/obs-actions/*`). No colisionen con rutas del core.
- Los handlers HTTP reciben `(req, res)` y deben responder siempre (`res.json(...)`),
  incluso en error (con el status adecuado, ej. `res.status(400).json({ error })`).

## 6. Persistencia

- Guarda datos en archivos JSON dentro de tu propio módulo (con `fs.writeFileSync`).
- Lee con un `try/catch` por si el archivo no existe (vuelve a defaults).
- **Sé cuidadoso con lo que entra en git** (tokens, claves, datos de usuarios no).
- No escribas en archivos de otros módulos ni en `tokens.json`.

## 7. SSE — tipos reservados

- **EL tipo `status` está reservado** para el estado del servidor (auth, túnel, bot).
- Si necesitas enviar estado periódico de tu módulo al dashboard, usa un `type` propio
  (ej: `music-status`) o incluye `_source: '<modulo>'` y manéjalo aparte en el frontend.
- El frontend `updateStatus()` **ignora** eventos `status` que no traigan los campos
  `authenticated`, `botAuthenticated` o `tunnelUrl`.

## 8. Convenciones y estilo

- **CommonJS** (`require` / `module.exports`). No `import/export` ES modules.
- Rutas relativas para requerir el event bus: desde `modules/triggers/<m>/` →
  `require('../../../lib/event-bus')`.
- Mensajes de consola con prefijo del módulo: `[MI-MODULO] ...` para facilitar el debug.
- Errores: captura e imprime `err.message` (nunca el objeto completo al log, salvo debug).
- Nombres de archivos de persistencia: `<modulo>-data.json` / `config.json`.

## 9. Añadir un comando de chat → no olvides el dashboard

Cuando añadas un comando `!x` a un módulo, debes **también** mostrarlo en la pestaña
"Comandos" del dashboard. Caminos típicos:

- Endpoint `GET /api/commands` del módulo (los dinámicos, como Gacha) que el dashboard
  consume, **y/o**
- la lista hardcoded en `public/index.html` (pestaña `#tab-comandos`) para TTS, VTuber,
  Music.

## 10. Checklist al crear/modificar un módulo

Al **crear**:
- [ ] Carpeta en `modules/triggers/` con su `index.js`.
- [ ] Si tiene dependencias extra → `package.json` dentro (con `npm install`).
- [ ] Escucha eventos del bus.
- [ ] UI web → sirve estáticos con `router.use(express.static(...))`.
- [ ] Sub-path único.
- [ ] Exporta `{ router, init }` (y `initWs(server)` si usa WebSocket).
- [ ] Engánchalo en `server.js` (orden: `initWs` antes de `server.listen`).
- [ ] try/catch propio e idempotencia ante duplicados.
- [ ] Comandos de chat reflejados en el dashboard.

Al **modificar**: los mismos puntos, más "No rompas la API pública del módulo" (otros
módulos pueden estar escuchando tus eventos o llamando tus funciones exportadas).

## 11. Verificación

- Corre `node server.js` y mira la consola de arranque (sin `[FATAL]`).
- Prueba el endpoint de estado de tu módulo.
- Comprueba `GET /api/status` y el dashboard.
- El proyecto **no tiene suite de tests automatizados**; verifica manualmente.

## 12. Comentarios y el estilo "ponytail"

El repo usa un estilo deliberadamente minimalista ("ponytail"): código corto, sin
abstracciones especulativas, stdlib primero. Cuando veas un comentario `// ponytail: ...`,
indica una simplificación intencional con su límite conocido. Mantén ese espíritu: **menos
código, código claro**.
