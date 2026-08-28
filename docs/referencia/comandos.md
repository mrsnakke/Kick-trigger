# Comandos de chat (referencia)

La mayoría de módulos reaccionan a `chat.message.sent` y filtran por mensajes que
empiezan con `!`. Esta es la lista consolidada.

## TTS2

| Comando | Descripción | Permiso |
|---|---|---|
| `!sp <texto>` | Reproduce con la voz asignada del usuario | User |
| `!sp <alias> <texto>` | Reproduce con una voz específica (ej: `!sp 21 hola`) | User |
| `!<nombre_voz>` | Asigna voz permanentemente (ej: `!sabina`) | User |
| `!voz` | Lista voces disponibles | User |
| `!bonk` | Lanza un bonk | User |
| `!bonks` | Ráfaga de bonks | User |

## VTuber AI

| Comando | Descripción | Permiso |
|---|---|---|
| `!grim <pregunta>` | Grim responde con IA (chat + voz) | User |

## GACHA

| Comando | Descripción | Permiso |
|---|---|---|
| `!daily` | 10 llaves diarias | User |
| `!pull` / `!single` / `!tirada` | 1 pull = 1 llave | User |
| `!multi` / `!x10` | 10 pulls = 10 llaves | User |
| `!inventario` / `!inventory` / `!inv` | Inventario en el chat | User |
| `!Sinv` | Inventario en overlay | User |
| `!pj <personaje>` | Carta del personaje en overlay | User |
| `!lista` | Personajes disponibles del banner | User |
| `!top` | Top 3 coleccionistas | User |
| `!trade <tu_pj> por <su_pj> @usuario` | Crear intercambio 5★ | User |
| `!aceptar_trade` / `!accept_trade <ID>` | Aceptar trade | User |
| `!rechazar_trade` / `!reject_trade <ID>` | Rechazar/cancelar trade | User |
| `!keys @usuario <n>` | Dar llaves | Mod |
| `!givechar @usuario <pj>` | Dar personaje | Mod |
| `!takechar @usuario <pj>` | Quitar personaje | Mod |
| `!resetpity [@u] [4\|5]` | Resetear pity | Mod |
| `!setprob <rareza> <valor>` | Cambiar probabilidad | Mod |
| `!setstock <pj> <n>` | Cambiar stock | Mod |
| `!banner <standard\|seasonal>` | Ver banner | Mod |
| `!seasonal add/remove <pj>` | Gestionar seasonal | Mod |
| `!reload` | Recargar datos | Mod |
| `!cleardata confirm` | Borrar datos | Mod |
| `!gachaconfig` | Ver config | Mod |
| `!charinfo <pj>` | Info personaje | Mod |
| `!announce <msg>` | Anunciar en el chat | Mod |

## Strinova

| Comando | Descripción | Permiso |
|---|---|---|
| `!rank` | Tarjeta de rango en overlay (20s) | User |
| `!rulet` | Historial de personajes en overlay (20s) | User |

## Music

| Comando | Descripción | Permiso |
|---|---|---|
| `!song` | Canción actual | User |
| `!addsong` / `!sr <nombre/URL>` | Añadir a la cola | User |
| `!skip` | Saltar | User |
| `!stop` | Pausa/reanuda | User |
| `!volume <0-100>` | Volumen | User |
| `!like` | Like | User |

## OBS Actions

- **Dinámicos**: cualquier trigger de tipo `chat_command` con su `!comando` configurado
  desde el dashboard. No hay comandos fijos. Permiso: Mod.

## Chatbot

- **Personalizados**: comandos definidos desde el dashboard (soporta `{user}`).
  Permiso: User/Mod según configuración.

---

## Cómo registrar un comando nuevo en el dashboard

1. Añade el manejador en el módulo (escuchando `chat.message.sent`).
2. Refleja el comando en el dashboard:
   - Endpoint `GET /api/commands` del módulo (dinámicos, como Gacha), **y/o**
   - Lista hardcoded en `public/index.html` (pestaña `#tab-comandos`) para TTS, VTuber, Music.

Ver [estandares.md §9](../estandares.md#9-añadir-un-comando-de-chat--no-olvides-el-dashboard).
