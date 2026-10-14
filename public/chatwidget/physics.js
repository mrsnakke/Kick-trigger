/*!
 * EmotePhysics — motor de partículas reutilizable para overlays de emotes.
 *
 * Uso:
 *   const layer = EmotePhysics.create(canvas, { gravity:0.6, bounce:0.62, size:96 })
 *   layer.spawn(['https://cdn.7tv.app/emote/xxx/2x.webp'])  // 1 partícula por url
 *   layer.setOptions({ size:120 })   // cambios en vivo
 *   layer.clear() / layer.pause() / layer.resume() / layer.destroy()
 *
 * Pensado para caer sobre imagen de stream (fondo transparente), con delta-time
 * normalizado para que la velocidad sea igual a 60/120/144Hz.
 */
(function (global) {
  'use strict'

  const DEFAULTS = {
    mode: 'rain',        // rain | fountain | burst
    gravity: 0.6,        // px por frame@60fps
    bounce: 0.62,        // restitución al chocar el piso (0..1)
    friction: 0.99,      // rozamiento del aire
    wind: 0,             // fuerza lateral constante (px/frame@60)
    spin: 1,             // multiplicador de rotación
    size: 96,            // lado mayor objetivo en px
    sizeVariance: 0.25,  // variación aleatoria de tamaño (+/- %)
    maxParticles: 24,    // tope duro de emotes simultáneos
    life: 6,             // vida base en segundos
    maxBounces: 4,       // rebotes antes de quedarse quieto
    fadeIn: 0.25,        // segundos de aparición (pop + alpha)
    fadeOut: 0.6,        // segundos de desvanecimiento al final
    shadow: true,        // sombra suave bajo el emote
    preserveAspect: true,// respeta la proporción real (no deforma)
    originX: 0.5,        // 0..1 — x de origen para fountain/burst
    originY: 1,          // 0..1 — y de origen para fountain/burst
    spread: 0.5,         // 0..1 — ancho de aparición para fountain
    launchPower: 14,     // impulso vertical inicial (fountain)
    margin: 20           // margen lateral mínimo en rain
  }

  /* ─── Caché de imágenes (con fallback 2x→1x y fullsize→src) ─── */
  const imgCache = new Map()

  function fallbackUrl(url) {
    if (url.indexOf('/2x.webp') !== -1) return url.replace('/2x.webp', '/1x.webp')
    if (url.indexOf('/fullsize') !== -1) return url.replace('/fullsize', '/src')
    if (url.indexOf('/2x.gif') !== -1) return url.replace('/2x.gif', '/1x.gif')
    return null
  }

  function flush(entry) {
    const subs = entry.subs
    entry.subs = []
    for (const fn of subs) { try { fn(entry) } catch (e) {} }
  }

  function loadImage(url) {
    let entry = imgCache.get(url)
    if (entry) return entry
    entry = { state: 'loading', img: null, triedFallback: false, subs: [] }
    imgCache.set(url, entry)
    start(url, entry)
    return entry
  }

  function start(src, entry) {
    const img = new Image()
    img.decoding = 'async'
    img.referrerPolicy = 'no-referrer'
    // No usamos crossOrigin: solo dibujamos, leer píxeles no es necesario y
    // evita que el emote falle si el CDN no manda cabeceras CORS.
    img.onload = function () { entry.state = 'ok'; entry.img = img; flush(entry) }
    img.onerror = function () {
      const fb = entry.triedFallback ? null : fallbackUrl(src)
      if (fb) { entry.triedFallback = true; start(fb, entry); return }
      entry.state = 'error'; flush(entry)
    }
    img.src = src
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3) }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2)
    if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return }
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  function create(canvas, opts) {
    if (!canvas) throw new Error('EmotePhysics.create: canvas requerido')
    const ctx = canvas.getContext('2d')
    let o = Object.assign({}, DEFAULTS, opts || {})
    let particles = []
    let raf = 0
    let last = 0
    let running = false
    let W = 0
    let H = 0
    let dpr = 1

    function resize() {
      const cw = canvas.clientWidth || canvas.width || 0
      const ch = canvas.clientHeight || canvas.height || 0
      dpr = Math.min(global.devicePixelRatio || 1, 2.5)
      const nw = Math.max(1, Math.round(cw * dpr))
      const nh = Math.max(1, Math.round(ch * dpr))
      if (canvas.width !== nw || canvas.height !== nh) { canvas.width = nw; canvas.height = nh }
      W = cw
      H = ch
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function applyNaturalSize(p, img) {
      p.img = img
      const nw = img.naturalWidth || 1
      const nh = img.naturalHeight || 1
      const ratio = nw / nh
      if (o.preserveAspect) {
        if (ratio >= 1) { p.w = p.size; p.h = p.size / ratio }
        else { p.h = p.size; p.w = p.size * ratio }
      } else { p.w = p.size; p.h = p.size }
    }

    function spawnOne(url, over) {
      if (!url || !W || !H) return null
      over = over || {}
      const size = over.size || o.size
      const disp = size * (1 + (Math.random() * 2 - 1) * o.sizeVariance)
      const mode = over.mode || o.mode

      let x, y, vx, vy
      if (mode === 'fountain') {
        const ox = W * o.originX
        const sp = W * o.spread
        x = ox + (Math.random() - 0.5) * sp
        y = H - disp * 0.6
        vx = (Math.random() - 0.5) * 4 + o.wind
        vy = -(o.launchPower * (0.75 + Math.random() * 0.5))
      } else if (mode === 'burst') {
        x = W * o.originX
        y = H * o.originY
        const a = Math.random() * Math.PI * 2
        const s = 6 + Math.random() * 10
        vx = Math.cos(a) * s + o.wind
        vy = Math.sin(a) * s
      } else { // rain
        const room = Math.max(10, W - disp - o.margin * 2)
        x = o.margin + Math.random() * room
        y = -disp
        vx = o.wind + (Math.random() - 0.5) * 1.2
        vy = 1 + Math.random() * 2
      }

      const p = {
        url: url, img: null,
        x: x, y: y, vx: vx, vy: vy,
        size: disp, w: disp, h: disp,
        rot: (Math.random() * 2 - 1) * 0.5,
        vRot: (Math.random() * 2 - 1) * 0.09 * o.spin,
        life: 0,
        maxLife: o.life + Math.random() * 1.5,
        bounces: 0,
        resting: false
      }

      const entry = loadImage(url)
      if (entry.state === 'ok') applyNaturalSize(p, entry.img)
      else if (entry.state === 'error') return null
      else entry.subs.push(function (e) { if (e.state === 'ok' && p.img == null) applyNaturalSize(p, e.img) })

      particles.push(p)
      if (particles.length > o.maxParticles) particles.splice(0, particles.length - o.maxParticles)
      return p
    }

    function spawn(urls, over) {
      if (!urls) return 0
      const list = Array.isArray(urls) ? urls : [urls]
      let n = 0
      for (const u of list) { if (spawnOne(u, over)) n++ }
      return n
    }

    function draw(p) {
      const tIn = o.fadeIn > 0 ? Math.min(1, p.life / o.fadeIn) : 1
      const tOut = o.fadeOut > 0 ? Math.min(1, (p.maxLife - p.life) / o.fadeOut) : 1
      const alpha = Math.max(0, Math.min(tIn, tOut))
      if (alpha <= 0) return
      const scale = 0.6 + 0.4 * easeOutCubic(tIn)
      const sw = p.w * scale
      const sh = p.h * scale

      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(p.x + p.w / 2, p.y + p.h / 2)
      ctx.rotate(p.rot)
      if (o.shadow) { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4 }
      if (p.img && p.img.complete && p.img.naturalWidth > 0) {
        ctx.drawImage(p.img, -sw / 2, -sh / 2, sw, sh)
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.15)'
        roundRect(ctx, -sw / 2, -sh / 2, sw, sh, Math.min(sw, sh) * 0.2)
        ctx.fill()
      }
      ctx.restore()
    }

    function frame(now) {
      if (!running) return
      raf = requestAnimationFrame(frame)
      if (!last) last = now
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      const f = dt * 60 // factor normalizado a 60fps
      ctx.clearRect(0, 0, W, H)
      if (!particles.length) { return }

      const fr = Math.pow(o.friction, f)
      const alive = []
      for (const p of particles) {
        p.life += dt
        if (p.life >= p.maxLife) continue

        if (!p.resting) {
          p.vy += o.gravity * f
          p.vx *= fr
          p.vy *= fr
          p.x += p.vx * f
          p.y += p.vy * f
          p.rot += p.vRot * f

          if (p.y + p.h > H) {
            p.y = H - p.h
            p.vy = -p.vy * o.bounce
            p.vx *= 0.86
            p.vRot *= 0.8
            p.bounces++
            if (Math.abs(p.vy) < 1.4 || p.bounces >= o.maxBounces) { p.vy = 0; p.resting = true }
          }
          if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx) * o.bounce }
          else if (p.x + p.w > W) { p.x = W - p.w; p.vx = -Math.abs(p.vx) * o.bounce }
          if (p.y > H + 40 && p.vy > 0) continue // nunca debería pasar, pero por si acaso
        } else {
          p.vx *= fr
          p.x += p.vx * f
          p.rot += p.vRot * f
          p.vRot *= fr
        }

        draw(p)
        alive.push(p)
      }
      particles = alive
    }

    function start_() {
      if (running) return
      running = true
      last = 0
      resize()
      raf = requestAnimationFrame(frame)
    }
    function pause() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0 }
    function destroy() {
      pause()
      if (ro) ro.disconnect()
      global.removeEventListener('resize', onWinResize)
      particles = []
    }

    let ro = null
    function onWinResize() { resize() }
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(resize)
      ro.observe(canvas)
    } else {
      global.addEventListener('resize', onWinResize)
    }

    resize()
    start_()

    return {
      spawn: spawn,
      spawnOne: spawnOne,
      setOptions: function (patch) { o = Object.assign({}, o, patch || {}) },
      getOptions: function () { return Object.assign({}, o) },
      clear: function () { particles = [] },
      resize: resize,
      start: start_,
      pause: pause,
      resume: function () { start_() },
      destroy: destroy,
      count: function () { return particles.length },
      defaults: DEFAULTS
    }
  }

  global.EmotePhysics = { create: create, DEFAULTS: DEFAULTS, loadImage: loadImage }
})(window)
