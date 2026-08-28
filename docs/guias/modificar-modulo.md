# Cómo modificar / extender un módulo existente

Guía práctica para añadir funciones a un módulo que ya existe, sin romper lo que ya
funciona.

---

## Índice rápido

- [Antes de tocar nada](#antes-de-tocar-nada)
- [1. Añadir un comando de chat nuevo a un módulo](#1-añadir-un-comando-de-chat-nuevo-a-un-módulo)
- [2. Añadir un endpoint HTTP nuevo](#2-añadir-un-endpoint-http-nuevo)
- [3. Añadir un listener de un evento del bus](#3-añadir-un-listener-de-un-evento-del-bus)
- [4. Añadir un evento nuevo propio (comunicar con otros módulos)](#4-añadir-un-evento-nuevo-propio)
- [5. Modificar un miniprompt / texto configurable](#5-modificar-un-miniprompt--texto-configurable)
- [6. Añadir una sub-acción nueva (caso OBS Actions)](#6-añadir-una-sub-acción-nueva-caso-obs-actions)
- [Cambios que rompen (¡evítalos!)](#cambios-que-rompen-evítalos)

---

## Antes de tocar nada

1. **Identifica el módulo** que quieres modificar en `modules/triggers/` (o el archivo del
   core si es del nivel superior).
2. Lee su `index.js` — ahí está la lógica, los listeners del bus y los endpoints.
3. Revisa **qué expone**: `module.exports = { ... }`. Lo que otros módulos importan de él
   es su "API pública". Cambiarlo puede romper llamadas en otro sitio.
   - Usa `grep` para ver quién importa ese módulo antes de renombrar/eliminar exports.
4. Aplica el cambio en **el mínimo punto** (raíz del problema, no el síntoma).

---

## 1. Añadir un comando de chat nuevo a un módulo

Todos los triggers filtran `chat.message.sent`. Busca en el `index.js` del módulo el
handler que ya procesa comandos (normalmente un `if (content.startsWith('!...'))`) y
añade tu rama.

```js
eventBus.on('chat.message.sent', async (data) => {
  const content = data.payload?.message?.content || ''
  const user = data.payload?.sender?.username
  if (!content.startsWith('!miNuevoCmd')) return
  const arg = content.replace('!miNuevoCmd', '').trim()

  // tu lógica...
  try { await chat.sendAsBot(`@${user} resultado`) } catch (e) { console.error(e.message) }
})
```

- Un comando por rama `if`. Mantén el estilo del archivo.
- Recuerda: puede llegar duplicado → sé idempotente.
- ⚠️ **Refleja el comando en el dashboard** (pestaña Comandos), ya sea en el
  `GET /api/commands` del módulo o hardcoded en `public/index.html`. Ver
  [estandares.md §9](../estandares.md#9-añadir-un-comando-de-chat--no-olvides-el-dashboard).

---

## 2. Añadir un endpoint HTTP nuevo

Añade una ruta al `router` del módulo:

```js
router.get('/api/contador', (req, res) => {
  res.json({ total: contador })
})
```

Montado bajo el sub-path del módulo (ej: si el módulo está en `/gacha`, queda
`GET /gacha/api/contador`). No repitas el prefijo en la ruta.

Para rutas con cuerpo JSON:
```js
router.post('/api/accion', express.json(), (req, res) => { ... })
```

> Añade también un `router.get('/api/status', ...)` de cortesía para que el dashboard y la
> depuración tengan de dónde mirar. (Ya lo tienen la mayoría.)

---

## 3. Añadir un listener de un evento del bus

Escuchar otro evento se hace igual que un módulo nuevo — dentro de tu `init()` (o del
handler existente):

```js
function init() {
  eventBus.on('channel.followed', (data) => {
    const username = data.payload?.followed?.username
    // reaccionar a nuevo follow
  })
  eventBus.on('chat.message.sent', ...)  // el que ya existía
}
```

Lista de qué evento emite cada cosa: [referencia/eventos.md](../referencia/eventos.md).

---

## 4. Añadir un evento nuevo propio

Si quieres que **otros** módulos reaccionen a algo tuyo, emite un evento con nombre
único:

```js
eventBus.emit('mi-modulo:ganador', { user: 'alguien', premio: 'x' })
```

- Usa el prefijo `minombre:` para evitar colisiones (`tts2:speak`, `strinova:spin`, etc.
  siguen ese patrón).
- Documenta el evento en [referencia/eventos.md](../referencia/eventos.md).

---

## 5. Modificar un miniprompt / texto configurable

Muchos textos viven en `*-config.json` editable desde el dashboard (ej. miniprompts de
`event-actions`). Si solo quieres cambiar texto:

1. Cámbialo desde el **dashboard** (recomendado, se guarda solo).
2. O edita el JSON directamente y reinicia / recarga.

Si quieres **añadir una nueva variable** interpolable a un miniprompt (el repo ya usa
`{username}`, `{reward_title}`, `{title}`):

- Busca dónde se hace el reemplazo (p. ej. en `event-actions/index.js`) y añade tu
  variable al `template.replace(...)`.
- Documenta la nueva variable en `modules/event-actions.md`.

---

## 6. Añadir una sub-acción nueva (caso OBS Actions)

`obs-actions/` usa un `engine.js` que ejecuta "sub-acciones" (`visibility`, `delay`,
`event`). Para añadir un tipo nuevo:

1. En `store.js`/`index.js`: añade el tipo a la UI/validación de acciones.
2. En `engine.js`: añade un `case 'miTipo': ...` en el ejecutor.
3. Prueba con `POST /obs-actions/api/obs/test-sub-action`.

---

## Cambios que rompen (¡evítalos!)

- **Renombrar/eliminar exports** que otros módulos importan. Antes de tocar, grepea quién
  usa tu módulo.
- **Cambiar el payload** de un evento que otros escuchan (ej. quitar un campo que otro
  lee). Si debes cambiar el formato, hazlo en **versiones** (`miEvento` + `miEventoV2`)
  mientras migras.
- **Rutas con contenido JSON** sin `express.json()` (daría `undefined` en `req.body`).
- **Enviar `type: 'status'`** por SSE (rompe los badges de auth del dashboard).
- **Meter dependencias nuevas** si no hacen falta — usa stdlib/nativo primero (ver
  [estandares.md §12](../estandares.md#12-comentarios-y-el-estilo-ponytail)).

### Verificación tras modificar

1. `node server.js` — sin `[FATAL]` en la consola.
2. Prueba el endpoint/acción nueva.
3. Prueba que lo **relacionado** siga funcionando (nada se rompió por el cambio).
