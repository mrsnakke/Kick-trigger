# Documentación Técnica a Medida — Integración con Kick

Documentación extraída y filtrada exclusivamente para los requerimientos del **Plan.md**: leer eventos de chat, suscripciones y canjes de puntos, y enviar/responder mensajes al chat mediante webhooks + Localtunnel.

---

## 1. Registro de la App en Kick

Pasos necesarios para obtener las credenciales de OAuth:

1. Crear una cuenta en Kick (si no se tiene).
2. Activar **2FA** (Autenticación de Doble Factor) en Ajustes de la cuenta.
3. Ir a `https://kick.com/settings/developer` (pestaña Developer).
4. Crear una nueva App. Esto genera:
   - **Client ID** (público)
   - **Client Secret** (confidencial)
   - **Redirect URL** (la URL de callback, ej. `http://localhost:3000/auth/callback`)
5. Aceptar los Términos de Desarrollador de Kick.

> La Redirect URL debe coincidir **exactamente** con la que uses en el flujo OAuth.

---

## 2. Autenticación OAuth 2.1 (Authorization Code Flow con PKCE)

**Servidor OAuth:** `https://id.kick.com`

El streamer debe autorizar la app para que esta pueda actuar en su nombre.

### Scopes Requeridos

| Scope | Propósito |
|---|---|
| `events:subscribe` | Suscribirse a eventos del canal (chat, suscripciones, canjes) |
| `chat:write` | Enviar y responder mensajes al chat |
| `channel:read` | Leer información del canal |
| `channel:rewards:read` | Leer información de recompensas de puntos |
| `user:read` | Leer información del usuario autenticado |

### 2.1 Solicitar Autorización (GET)

Redirige al streamer a la siguiente URL:

```
GET https://id.kick.com/oauth/authorize?
    response_type=code&
    client_id=<CLIENT_ID>&
    redirect_uri=<REDIRECT_URI>&
    scope=events:subscribe chat:write channel:read channel:rewards:read user:read&
    code_challenge=<CODE_CHALLENGE>&
    code_challenge_method=S256&
    state=<RANDOM_STATE>
```

** Parámetros:**

| Parámetro | Descripción |
|---|---|
| `client_id` | Client ID de tu app |
| `response_type` | Siempre `code` |
| `redirect_uri` | URL de callback registrada en la app |
| `scope` | Scopes separados por espacio |
| `code_challenge` | SHA256 del `code_verifier`, codificado en Base64 URL-safe |
| `code_challenge_method` | Siempre `S256` |
| `state` | Cadena aleatoria para prevenir CSRF |

**Workaround 127.0.0.1:** Si usas `127.0.0.1` en la redirect_uri (en vez de `localhost`), añade un parámetro `redirect=127.0.0.1` **antes** de `redirect_uri` para evitar un bug en NextJS:

```
GET https://id.kick.com/oauth/authorize?
    response_type=code&
    client_id=<CLIENT_ID>&
    redirect=127.0.0.1&
    redirect_uri=http://127.0.0.1:3000/auth/callback&
    scope=events:subscribe chat:write channel:read channel:rewards:read user:read&
    code_challenge=<CODE_CHALLENGE>&
    code_challenge_method=S256&
    state=<RANDOM_STATE>
```

**Respuesta exitosa:** Redirección a `redirect_uri?code=<CODE>&state=<RANDOM_STATE>`

### 2.2 Intercambiar Código por Tokens (POST)

```
POST https://id.kick.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
client_id=<CLIENT_ID>
client_secret=<CLIENT_SECRET>
redirect_uri=<REDIRECT_URI>
code_verifier=<CODE_VERIFIER>
code=<CODE_RECIBIDO>
```

**Respuesta exitosa (200):**

```json
{
  "access_token": "u_at_...",
  "token_type": "Bearer",
  "refresh_token": "u_rt_...",
  "expires_in": 3600,
  "scope": "events:subscribe chat:write channel:read channel:rewards:read user:read"
}
```

### 2.3 Renovar Token (Refresh)

Cuando el `access_token` expire (tras 1 hora), usa el `refresh_token`:

```
POST https://id.kick.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
client_id=<CLIENT_ID>
client_secret=<CLIENT_SECRET>
refresh_token=<REFRESH_TOKEN>
```

**Respuesta exitosa (200):**

```json
{
  "access_token": "u_at_...",
  "token_type": "Bearer",
  "refresh_token": "u_rt_...",
  "expires_in": 3600,
  "scope": "events:subscribe chat:write channel:read channel:rewards:read user:read"
}
```

### 2.4 Verificar Token (Introspect, opcional)

```
POST https://id.kick.com/oauth/token/introspect
Authorization: Bearer <ACCESS_TOKEN>
```

**Respuesta:**

```json
{
  "data": {
    "active": true,
    "client_id": "<CLIENT_ID>",
    "token_type": "user",
    "scope": "events:subscribe chat:write channel:read",
    "exp": 1771046347
  },
  "message": "OK"
}
```

---

## 3. Suscripción a Eventos Webhook

### 3.1 Obtener el ID del Streamer

Para suscribirte a eventos, necesitas el `broadcaster_user_id`. Puedes obtenerlo consultando el canal del usuario autenticado:

```
GET https://api.kick.com/public/v1/channels
Authorization: Bearer <ACCESS_TOKEN>
```

**Respuesta:**

```json
{
  "data": [
    {
      "broadcaster_user_id": 123456789,
      "slug": "nombre_streamer",
      "stream_title": "..."
    }
  ],
  "message": "OK"
}
```

### 3.2 Registrar Suscripción a un Evento (POST)

```
POST https://api.kick.com/public/v1/events/subscriptions
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "broadcaster_user_id": 123456789,
  "name": "<EVENT_NAME>",
  "version": 1
}
```

Donde `<EVENT_NAME>` es uno de:
- `chat.message.sent`
- `channel.subscription.new`
- `channel.reward.redemption.updated`

> Si usas un User Access Token, `broadcaster_user_id` se infiere del token y es ignorado/opcional.

### 3.3 Consultar Suscripciones Activas (GET)

```
GET https://api.kick.com/public/v1/events/subscriptions
Authorization: Bearer <ACCESS_TOKEN>
```

### 3.4 Eliminar una Suscripción (DELETE)

```
DELETE https://api.kick.com/public/v1/events/subscriptions?id=<SUBSCRIPTION_ID>
Authorization: Bearer <ACCESS_TOKEN>
```

### 3.5 Nota sobre Webhooks

La URL que registres en tu app (en dev.kick.com) debe ser la URL pública expuesta por Localtunnel, apuntando a tu endpoint:

```
https://<subdominio>.loca.lt/webhook/kick
```

---

## 4. Validación de Firmas de Webhooks

Kick firma cada webhook con RSA-SHA256. Tu servidor debe validar la firma para asegurar que el evento es legítimo.

### 4.1 Cabeceras HTTP del Webhook

| Cabecera | Descripción |
|---|---|
| `Kick-Event-Signature` | Firma digital Base64 del payload |
| `Kick-Event-Message-Id` | UUID único del mensaje (para deduplicación) |
| `Kick-Event-Message-Timestamp` | Timestamp ISO 8601 del evento |
| `Kick-Event-Type` | Tipo de evento (ej: `chat.message.sent`) |

### 4.2 Flujo de Validación

1. **Obtener la clave pública de Kick** desde `https://api.kick.com/public/v1/public-key`, o almacenarla localmente.
2. **Construir cadena de firma** concatenando con punto:
   ```
   cadena = Kick-Event-Message-Id + "." + Kick-Event-Message-Timestamp + "." + RawBody
   ```
   > El `RawBody` debe ser el cuerpo JSON **exactamente como se recibió** (sin parsear ni reformatear).
3. **Verificar** la `Kick-Event-Signature` (Base64) contra la cadena usando RSA-SHA256 y la clave pública de Kick.
4. **Deduplicación**: guardar `Kick-Event-Message-Id` en memoria para evitar procesar el mismo evento dos veces (ventana típica: 10 min).
5. **Anti-replay**: rechazar eventos con timestamp con diferencia mayor a **5 minutos** respecto a la hora local.

### 4.3 Reintentos

Si tu servidor responde con código distinto a `200 OK`, Kick reintenta hasta **3 veces**. Si el servidor está constantemente caído, Kick **cancela la suscripción** automáticamente.

---

## 5. Payloads de Eventos

### 5.1 Mensaje de Chat (`chat.message.sent`)

```json
{
  "message_id": "unique_message_id_123",
  "replies_to": {
    "message_id": "unique_message_id_456",
    "content": "Mensaje original",
    "sender": {
      "user_id": 12345,
      "username": "usuario_original"
    }
  },
  "broadcaster": {
    "user_id": 123456789,
    "username": "streamer_username"
  },
  "sender": {
    "user_id": 987654321,
    "username": "nombre_espectador",
    "identity": {
      "color": "#FF5733"
    }
  },
  "content": "¡Hola streamer!",
  "created_at": "2026-06-27T16:08:06Z"
}
```

### 5.2 Nueva Suscripción (`channel.subscription.new`)

```json
{
  "broadcaster": {
    "user_id": 123456789,
    "username": "streamer_username"
  },
  "subscriber": {
    "user_id": 987654321,
    "username": "nuevo_suscriptor"
  },
  "duration": 1,
  "created_at": "2026-06-27T16:08:06Z",
  "expires_at": "2026-07-27T16:08:06Z"
}
```

### 5.3 Canje de Puntos de Canal (`channel.reward.redemption.updated`)

```json
{
  "id": "01KBHE78QE4HZY1617DK5FC7YD",
  "user_input": "Mensaje personalizado opcional del usuario",
  "status": "pending",
  "redeemed_at": "2026-12-02T22:54:19.323Z",
  "reward": {
    "id": "01KBHE7RZNHB0SKDV1H86CD4F3",
    "title": "Pedir Canción",
    "cost": 1000,
    "description": "Elige tu canción favorita"
  },
  "redeemer": {
    "user_id": 987654321,
    "username": "espectador_canjeador"
  },
  "broadcaster": {
    "user_id": 123456789,
    "username": "streamer_username"
  }
}
```

Posibles valores de `status`: `pending`, `accepted`, `rejected`.

---

## 6. Chat API — Enviar y Responder Mensajes

### 6.1 Enviar Mensaje (POST)

```
POST https://api.kick.com/public/v1/chat
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "broadcaster_user_id": 123456789,
  "content": "Texto del mensaje (máx. 500 caracteres)",
  "type": "user"
}
```

- `type: "user"` → envía como el streamer (requiere `broadcaster_user_id`).
- `type: "bot"` → envía como bot (el `broadcaster_user_id` se ignora).

### 6.2 Responder a un Mensaje (en hilo)

Añade el campo `reply_to_message_id` con el `message_id` del mensaje recibido:

```json
{
  "broadcaster_user_id": 123456789,
  "content": "¡Gracias por el mensaje!",
  "type": "user",
  "reply_to_message_id": "unique_message_id_123"
}
```

### 6.3 Respuesta Exitosa

```json
{
  "data": {
    "is_sent": true,
    "message_id": "b3e390c9-9524-4f51-b8fe-98365a6f20b3"
  },
  "message": "OK"
}
```

---

## 7. Arquitectura con Localtunnel

```
+--------------+          +---------------+          +---------------+          +--------------------+
|  Usuario /   |          |  Servidor de  |          |  Localtunnel  |          | App de Consola     |
|  Streamer    |          |     Kick      |          |   (loca.lt)   |          | (Express Server)   |
+------+-------+          +-------+-------+          +-------+-------+          +---------+----------+
       |                          |                          |                            |
       |  Escribe en Chat /       |                          |                            |
       |  Canjea puntos           |                          |                            |
       |------------------------->|                          |                            |
       |                          | Envía POST con firma RSA |                            |
       |                          |------------------------->|                            |
       |                          |                          | Reenvía petición           |
       |                          |                          | al puerto local             |
       |                          |                          |--------------------------->|
       |                          |                          |                            | Valida firma,
       |                          |                          |                            | procesa evento,
       |                          |                          |                            | responde 200 OK
       |                          |                          |<---------------------------|
       |                          |<-------------------------|                            |
```

### Comandos de Ejecución

```bash
# Terminal 1: Iniciar servidor Express
node server.js

# Terminal 2: Exponer con Localtunnel
npx localtunnel --port 3000
# Devuelve: https://<subdominio>.loca.lt

# URL del webhook a configurar en Kick:
# https://<subdominio>.loca.lt/webhook/kick
```

> Las peticiones de servidor de Kick no pasan por la pantalla de advertencia de Localtunnel, llegan directamente al servidor local.

---

## 8. Resumen de Endpoints Utilizados

| Propósito | Método | URL |
|---|---|---|
| Autorización OAuth | GET | `https://id.kick.com/oauth/authorize` |
| Intercambio de código | POST | `https://id.kick.com/oauth/token` |
| Refresh token | POST | `https://id.kick.com/oauth/token` |
| Obtener info del canal | GET | `https://api.kick.com/public/v1/channels` |
| Suscribirse a evento | POST | `https://api.kick.com/public/v1/events/subscriptions` |
| Listar suscripciones | GET | `https://api.kick.com/public/v1/events/subscriptions` |
| Eliminar suscripción | DELETE | `https://api.kick.com/public/v1/events/subscriptions` |
| Clave pública Kick | GET | `https://api.kick.com/public/v1/public-key` |
| Enviar mensaje chat | POST | `https://api.kick.com/public/v1/chat` |
| Webhook receptor | POST | `/webhook/kick` (local) |

---

## 9. Scopes Necesarios (Resumen)

| Scope | ¿Para qué? |
|---|---|
| `events:subscribe` | Suscribirse a webhooks de eventos del canal |
| `chat:write` | Enviar y responder mensajes al chat |
| `channel:read` | Obtener ID del canal del streamer |
| `channel:rewards:read` | Leer información de recompensas de puntos |
| `user:read` | Leer información del usuario autenticado |

---

*Documentación generada exclusivamente a partir de la documentación oficial de Kick (Documentacion.md) filtrada para los requerimientos del Plan.md. Ningún endpoint, scope o proceso inventado.*
