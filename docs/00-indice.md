# Kick Backend — Documentación

Guía técnica para entender, modificar y ampliar este backend sin romper nada.
Diseñada para que un desarrollador nuevo pueda ponerse al día en poco tiempo.

## Cómo navegar esta documentación

| Necesito... | Lee... |
|---|---|
| Ponerlo en marcha por primera vez | [setup.md](setup.md) |
| Entender cómo está armado y por dónde fluyen los datos | [arquitectura.md](arquitectura.md) |
| Añadir una funcionalidad/módulo nuevo de principio a fin | [guias/crear-modulo.md](guias/crear-modulo.md) |
| Modificar o extender algo que ya existe | [guias/modificar-modulo.md](guias/modificar-modulo.md) |
| Ver qué hace un módulo concreto | [modulos/](modulos/) |
| Consultar la lista completa de endpoints / eventos / comandos | [referencia/](referencia/) |
| Conocer las convenciones y reglas de desarrollo | [estandares.md](estandares.md) |

## Índice completo

### Puesta en marcha y concepto
- [Setup — puesta en marcha](setup.md)
- [Arquitectura y estructura del proyecto](arquitectura.md)

### Guías prácticas (paso a paso)
- [Cómo añadir un módulo nuevo](guias/crear-modulo.md)
- [Cómo modificar / extender un módulo existente](guias/modificar-modulo.md)

### Módulos del core (`modules/`)
- [Core — auth, webhook, chat, tunnel, sse, events, forwarder, state, config](modulos/core.md)

### Módulos de reacción (`modules/triggers/`)
- [TTS2 — texto a voz con SAPI](modulos/tts.md)
- [VTuber AI — IA conversacional + VTube Studio (+ iA Vision)](modulos/vtuber-ai.md)
- [GACHA — sistema de gacha](modulos/gacha.md)
- [OBS Actions — control de OBS](modulos/obs-actions.md)
- [Music — control de reproductor YouTube](modulos/music.md)
- [Chatbot — comandos personalizados + timers](modulos/chatbot.md)
- [Strinova — ruleta + overlay OBS](modulos/strinova.md)
- [Event Actions — primer mensaje + miniprompts](modulos/event-actions.md)

### Referencias consolidadas
- [Eventos del bus (Kick + internos + de cada módulo)](referencia/eventos.md)
- [Endpoints HTTP de todos los módulos](referencia/endpoints.md)
- [Comandos de chat (`!comando`)](referencia/comandos.md)

### Reglas
- [Reglas y estándares de desarrollo](estandares.md)

### Referencias de APIs de terceros (solo lectura, externas)
- [API de Kick (OAuth, endpoints, webhooks)](referencias/kick-api.md)
- [API de DeepSeek (modelos, tool calls, visión)](referencias/deepseek-api.md)
- [Cloudflare Tunnel](referencias/cloudflare-tunnel.md)
- [TTS standalone (servidor independiente)](referencias/tts-standalone.md)

---

## Regla de oro

**No modifiques los archivos del core (`lib/`, `modules/auth.js`, `modules/webhook.js`,
`modules/chat.js`, `modules/tunnel.js`, `modules/sse.js`, `modules/events.js`) a menos que
sea estrictamente necesario.** La arquitectura está pensada para que los triggers se
conecten al [Event Bus](arquitectura.md#event-bus) sin tocar nada del core. Si crees que
necesitas tocar el core, primero pregunta — casi siempre hay una forma de hacerlo desde
un módulo nuevo.
