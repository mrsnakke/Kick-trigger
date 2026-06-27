A continuación, se detalla el canvas de diseño, el diagrama de flujo y la guía práctica adaptados para el desarrollo del servidor de Webhooks utilizando **Localtunnel** como solución de tunelización local

---
la idea es poder ver eventos, leer chat leer canjes de puntos de canal el usuario. y tambien poder Responer o mandar mensajes al chat desde esta erramienta.
# Sección 1: Arquitectura de Webhooks de Kick (Modelo Oficial)

Para que tu aplicación reciba webhooks de Kick de forma segura y consistente, debes considerar tres pilares fundamentales: la firma criptográfica, la validación de eventos y el registro de suscripciones.

### 1. Cabeceras HTTP de Seguridad
Cada petición de webhook enviada por Kick incluye cabeceras específicas que permiten autenticar el mensaje:
*   `Kick-Event-Signature`: La firma digital del payload codificada en Base64, generada con la clave privada de Kick.
*   `Kick-Event-Message-Id`: Un identificador UUID exclusivo para cada mensaje. Sirve para evitar el procesamiento duplicado de eventos (deduplicación).
*   `Kick-Event-Message-Timestamp`: Marca de tiempo en formato ISO 8601. Permite verificar que el evento no sea una reemisión antigua (mitigación de ataques de repetición).
*   `Kick-Event-Type`: Define qué tipo de evento estás recibiendo (ej: `chat.message.sent`, `channel.subscription.new` o `channel.reward.redemption.updated`).

### 2. Flujo de Validación de Firma
Kick firma los payloads de manera asimétrica mediante RSA. Para verificarla de forma local:
1.  **Obtener Clave Pública:** Debes descargar la clave pública oficial de Kick desde su endpoint público `https://api.kick.com/public/v1/public-key` (o guardarla en producción si no cambia con frecuencia).
2.  **Construir Cadena de Firma:** Concatenas el ID del mensaje, la marca de tiempo y el cuerpo en bruto (raw JSON body) de la petición separados por un punto (`.`):
    $$\text{Cadena} = \text{Kick-Event-Message-Id} + \text{"."} + \text{Kick-Event-Message-Timestamp} + \text{"."} + \text{RawBody}$$
3.  **Verificación RSA-SHA256:** Verificas criptográficamente la firma recibida contra la cadena generada utilizando la clave pública de Kick.

---

# Sección 2: Canvas de Implementación (Enfoque Localtunnel)

```
+---------------------------------------------------------------------------------------------------------+
|                                CANVAS DE IMPLEMENTACIÓN DE WEBHOOKS (KICK)                               |
+---------------------------------------------------------------------------------------------------------+
| 1. INFRAESTRUCTURA DE RED                                                                               |
| * Servidor de entrada: Puerto local (ej. 3000) corriendo sobre Node.js + Express.                       |
| * Túnel de desarrollo: Localtunnel (lt). Permite exponer el puerto local a internet con HTTPS           |
|   de forma rápida y sin necesidad de crear cuentas o registrar tokens obligatoriamente.                 |
+---------------------------------------------------------------------------------------------------------+
| 2. AUTENTICACIÓN Y REGISTRO (OAuth 2.1)                                                                 |
| * Paso 1: Obtener Client ID y Secret en dev.kick.com.                                                   |
| * Paso 2: Flujo de autorización para que el Streamer apruebe scopes como chat:read y channel:read.      |
| * Paso 3: Registrar la suscripción enviando un POST a api.kick.com/public/v1/events/subscriptions.      |
+---------------------------------------------------------------------------------------------------------+
| 3. EVENTOS CLAVE A MONITOREAR                                                                           |
| * chat.message.sent -> Para ver quién envía mensajes y qué contienen.                                   |
| * channel.subscription.new -> Para alertas de nuevas suscripciones al canal.                            |
| * channel.reward.redemption.updated -> Para canjes de puntos de canal (Custom Rewards).                  |
+---------------------------------------------------------------------------------------------------------+
| 4. CONTROL DE ERRORES Y RETRIES                                                                         |
| * Si tu servidor devuelve un código diferente de 200 OK, Kick reintentará el envío hasta 3 veces.       |
| * Si tu servidor está inaccesible de forma persistente, Kick cancelará automáticamente la suscripción  |
|   al evento.                                                                                            |
+---------------------------------------------------------------------------------------------------------+
```

---

# Sección 3: Diagrama de Secuencia de Eventos con Localtunnel

Este diagrama ilustra el camino que recorre un mensaje de chat o un canje de puntos desde que ocurre en la plataforma hasta que es procesado y mostrado en tu consola local, utilizando la infraestructura de proxy de Localtunnel:

```
+--------------+          +---------------+          +---------------+          +--------------------+
|  Usuario /   |          |  Servidor de  |          |  Localtunnel  |          | App de Consola     |
|  Streamer    |          |     Kick      |          |   (loca.lt)   |          | (Express Server)   |
+------+-------+          +-------+-------+          +-------+-------+          +---------+----------+
       |                          |                          |                            |
       |  Escribe en Chat /       |                          |                            |
       |  Canjea puntos           |                          |                            |
       |------------------------->|                          |                            |
       |                          | Genera Firma RSA         |                            |
       |                          | de forma asimétrica      |                            |
       |                          |----------------->        |                            |
       |                          |                          |                            |
       |                          | Envía POST HTTP          |                            |
       |                          | con Cabeceras de firma   |                            |
       |                          |------------------------->|                            |
       |                          |                          | Reenvía petición           |
       |                          |                          | localmente                 |
       |                          |                          |--------------------------->|
       |                          |                          |                            | [Procesamiento]
       |                          |                          |                            | 1. Lee Raw Body
       |                          |                          |                            | 2. Valida Firma RSA
       |                          |                          |                            | 3. Imprime en consola
       |                          |                          |                            | 4. Responde 200 OK
       |                          |                          |                            |<------------------
       |                          |<-------------------------|                            |
       |                          | (Confirmación recibida)  |                            |
```

---

# Sección 4: Código de la Aplicación de Consola (Node.js)

Este archivo (`server.js`) levanta un servidor Express preparado para recibir y validar las peticiones provenientes del túnel. Utiliza el módulo nativo `crypto` de Node.js para realizar la verificación criptográfica RSA-SHA256 utilizando la clave pública oficial de Kick.

Un detalle técnico crucial es **preservar el formato original del cuerpo del mensaje (raw body)**. Si Express parsea el JSON antes de la verificación criptográfica, la firma fallará inevitablemente debido a variaciones en los espacios en blanco o el orden de las propiedades.

```javascript
// npm install express
const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Reemplazar con la clave pública real obtenida de https://api.kick.com/public/v1/public-key
const KICK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8
6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2
MZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ
L/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY
6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF
BEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e
twIDAQAB
-----END PUBLIC KEY-----`;

// Almacén en memoria para prevenir ataques de replay (Deduplicación)
const processedMessageIds = new Set();
const TEN_MINUTES_IN_MS = 10 * 60 * 1000;

// Configurar Express para guardar el raw body intacto como Buffer en req.rawBody
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Endpoint receptor de Webhooks
app.post('/webhook/kick', (req, res) => {
  const signature = req.headers['kick-event-signature'];
  const messageId = req.headers['kick-event-message-id'];
  const timestamp = req.headers['kick-event-message-timestamp'];
  const eventType = req.headers['kick-event-type'];

  // 1. Validaciones básicas de cabeceras
  if (!signature || !messageId || !timestamp) {
    console.warn('[ALERTA] Petición rechazada: Faltan cabeceras de firma necesarias.');
    return res.status(401).send('Faltan cabeceras de seguridad requeridas');
  }

  // 2. Mitigar ataques de replay (Deduplicación)
  if (processedMessageIds.has(messageId)) {
    console.log(`[DEDUPLICADOR] Evento duplicado omitido: ${messageId}`);
    return res.status(200).send('Mensaje ya procesado');
  }

  // 3. Validar la vigencia del timestamp (tolerancia de 5 minutos)
  const eventTime = new Date(timestamp).getTime();
  const currentTime = Date.now();
  const fiveMinutesInMs = 5 * 60 * 1000;
  if (Math.abs(currentTime - eventTime) > fiveMinutesInMs) {
    console.warn('[ALERTA] El mensaje excede la tolerancia de tiempo establecida.');
    return res.status(401).send('Firma expirada');
  }

  // 4. Reconstruir cadena de firma y verificar criptográficamente
  const rawBodyString = req.rawBody ? req.rawBody.toString('utf8') : '';
  const dataToVerify = `${messageId}.${timestamp}.${rawBodyString}`;

  try {
    const verifier = crypto.createVerify('sha256');
    verifier.update(dataToVerify);
    
    const isSignatureVerified = verifier.verify(
      KICK_PUBLIC_KEY,
      signature,
      'base64'
    );

    if (!isSignatureVerified) {
      console.warn('[SEGURIDAD] Firma criptográfica inválida.');
      return res.status(401).send('Firma no válida');
    }
  } catch (error) {
    console.error('[CRÍTICO] Error al procesar la verificación RSA:', error.message);
    return res.status(500).send('Error interno durante la validación');
  }

  // Guardar mensaje procesado para la deduplicación
  processedMessageIds.add(messageId);
  setTimeout(() => processedMessageIds.delete(messageId), TEN_MINUTES_IN_MS);

  // 5. Enrutamiento de los Eventos del Canal
  const payload = req.body;

  switch (eventType) {
    case 'chat.message.sent':
      handleChatMessage(payload);
      break;

    case 'channel.subscription.new':
      handleSubscription(payload);
      break;

    case 'channel.reward.redemption.updated':
      handleChannelPointsRedemption(payload);
      break;

    default:
      console.log(`[OTRO EVENTO] Recibido evento no mapeado: ${eventType}`);
  }

  // Siempre responder con un código HTTP 200 OK rápidamente
  res.status(200).send('Event Received');
});

// --- Manejadores de Eventos Específicos (Salida por Consola) ---

function handleChatMessage(payload) {
  const sender = payload.sender?.username || 'Usuario Desconocido';
  const content = payload.content || '';
  const sentAt = payload.created_at || new Date().toISOString();
  
  console.log(`\x1b[36m[CHAT - ${sentAt}]\x1b[0m \x1b[1m${sender}:\x1b[0m ${content}`);
}

function handleSubscription(payload) {
  const subscriber = payload.user?.username || 'Alguien';
  const tier = payload.tier || 'Tier 1';
  
  console.log(`\x1b[32m[SUSCRIPCIÓN] ⭐ ¡${subscriber} se ha suscrito al canal usando ${tier}!\x1b[0m`);
}

function handleChannelPointsRedemption(payload) {
  const redeemer = payload.redeemer?.username || 'Espectador';
  const rewardName = payload.reward?.title || 'Recompensa';
  const cost = payload.reward?.cost || 0;
  const status = payload.status || 'UNFULFILLED';

  if (status === 'UNFULFILLED' || status === 'FULFILLED') {
    console.log(`\x1b[35m[CANJE DE PUNTOS] 💎 ¡${redeemer} canjeó "${rewardName}" por ${cost} puntos de canal! Estado: ${status}\x1b[0m`);
  }
}

app.listen(PORT, () => {
  console.log(`Servidor de Webhooks activo en puerto: ${PORT}`);
  console.log('Esperando eventos firmados desde Kick...');
});
```

---

# Sección 5: Guía de Ejecución de Pruebas con Localtunnel

Localtunnel te permite exponer el servidor local a internet sin configurar puertos en el router o lidiar con registros previos obligatorios.

### Paso 1: Instalar dependencias del proyecto
Asegúrate de inicializar tu proyecto de Node.js e instalar Express:
```bash
npm init -y
npm install express
```

### Paso 2: Iniciar tu servidor local
Guarda el código de la sección anterior en un archivo llamado `server.js` y ejecútalo:
```bash
node server.js
```
El servidor quedará a la escucha en el puerto `3000`.

### Paso 3: Iniciar Localtunnel
En una segunda pestaña de tu terminal, puedes ejecutar Localtunnel de forma directa usando `npx` (o instalarlo globalmente con `npm install -g localtunnel`):

```bash
npx localtunnel --port 3000
```

Tras unos segundos, Localtunnel devolverá una URL pública con HTTPS similar a esta:
```text
your url is: https://chatty-dogs-swim.loca.lt
```

### Paso 4: Configurar la URL del Webhook en Kick
Toma la URL proporcionada por Localtunnel, agrégale tu endpoint `/webhook/kick`, y úsala para registrar tu suscripción en el portal de desarrolladores de Kick:

```text
https://chatty-dogs-swim.loca.lt/webhook/kick
```

> **Nota técnica sobre Localtunnel:**
> Las peticiones automatizadas de servidores externos (como los webhooks enviados por Kick) utilizan "User-Agents" no relacionados con navegadores web convencionales. Debido a esto, las peticiones HTTP directas enviadas por Kick **no se ven afectadas** por la pantalla de advertencia ("Friendly Reminder") que Localtunnel muestra a los usuarios cuando entran desde un navegador por primera vez. Los payloads llegarán directamente a tu servidor local Express listo para ser procesados y mostrados por consola.