

Este manual integra las especificaciones técnicas vigentes, incluidos los modelos **DeepSeek V4** (`deepseek-v4-pro` y `deepseek-v4-flash`), detalles de precios, guías de uso de las APIs y referencias técnicas completas.

***

```markdown
# Documentación Oficial de la API de DeepSeek

> **Fecha de consulta/actualización:** 27 de junio de 2026
> **Servidor Base (OpenAI):** `https://api.deepseek.com`
> **Servidor Base (Anthropic):** `https://api.deepseek.com/anthropic`
> **Servidor Base (Beta):** `https://api.deepseek.com/beta`

---

## 1. Inicio Rápido (Quick Start)

### Tu primera llamada a la API
La API de DeepSeek utiliza un formato compatible con los SDK oficiales de OpenAI y Anthropic. Al modificar únicamente la configuración de la dirección base (`base_url`) y la clave de la API (`api_key`), puede integrar los modelos de DeepSeek en cualquier software compatible.

| Parámetro | Valor |
| :--- | :--- |
| **base_url (OpenAI)** | `https://api.deepseek.com` |
| **base_url (Anthropic)** | `https://api.deepseek.com/anthropic` |
| **api_key** | Solicite una clave en [DeepSeek Platform](https://platform.deepseek.com/api_keys) |
| **model** | `deepseek-v4-flash`, `deepseek-v4-pro` (los alias antiguos `deepseek-chat` y `deepseek-reasoner` están programados para desactivarse el 2026-07-24) |

#### Ejemplo de invocación (formato OpenAI)

##### Comando cURL (no estructurado):
```bash
curl https://api.deepseek.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <DEEPSEEK_API_KEY>" \
  -d '{
        "model": "deepseek-v4-flash",
        "messages": [
          {"role": "system", "content": "Eres un asistente de ayuda."},
          {"role": "user", "content": "¡Hola!"}
        ],
        "stream": false
      }'
```

##### Python SDK:
```python
from openai import OpenAI

client = OpenAI(
    api_key="<DEEPSEEK_API_KEY>",
    base_url="https://api.deepseek.com"
)

response = client.chat.completions.create(
    model="deepseek-v4-flash",
    messages=[
        {"role": "system", "content": "Eres un asistente de ayuda."},
        {"role": "user", "content": "Explica la teoría de la relatividad en una frase."}
    ],
    stream=False
)

print(response.choices[0].message.content)
```

##### Node.js:
```javascript
const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: "<DEEPSEEK_API_KEY>",
  baseURL: "https://api.deepseek.com"
});

async function main() {
  const completion = await openai.chat.completions.create({
    messages: [{ role: "user", content: "Hola, DeepSeek" }],
    model: "deepseek-v4-flash",
  });

  console.log(completion.choices[0].message.content);
}

main();
```

---

## 2. Modelos y Precios (Models & Pricing)

Los precios de DeepSeek se basan en la cantidad de tokens consumidos, medidos por cada millón (1M) de tokens. El sistema aplica automáticamente tecnología de **Context Caching** (Caché de contexto en disco), reduciendo drásticamente el precio de los tokens de entrada que coinciden con peticiones anteriores.

### Detalle de los Modelos

| Propiedad / Modelo | deepseek-v4-flash | deepseek-v4-pro |
| :--- | :--- | :--- |
| **Versión del Modelo** | DeepSeek-V4-Flash | DeepSeek-V4-Pro |
| **Ventana de Contexto** | 1M de tokens | 1M de tokens |
| **Máximo Output** | 384K tokens | 384K tokens |
| **Modo Thinking (Razonamiento)**| Soportado (Por defecto activado) | Soportado (Por defecto activado) |
| **Json Output** | Sí | Sí |
| **Tool Calls (Llamada a herramientas)**| Sí | Sí |
| **Chat Prefix Completion** | Sí (Beta) | Sí (Beta) |
| **FIM Completion (Fill-in-the-Middle)**| Sí (Solo en modo sin razonamiento) | Sí (Solo en modo sin razonamiento) |
| **Límite de Concurrencia** | 2500 | 500 |

### Tabla de Precios (Por 1 Millón de Tokens)

| Concepto | deepseek-v4-flash | deepseek-v4-pro |
| :--- | :--- | :--- |
| **Input (Acierto de caché - Cache Hit)** | **$0.0028** | **$0.003625** |
| **Input (Fallo de caché - Cache Miss)** | **$0.14** | **$0.435** |
| **Output (Tokens generados)** | **$0.28** | **$0.87** |

> ⚠️ **Nota sobre compatibilidad:** Los modelos heredados `deepseek-chat` y `deepseek-reasoner` dejarán de funcionar por completo el **24 de julio de 2026**. Actualmente se redirigen al modelo de alto rendimiento `deepseek-v4-flash`.

---

## 3. Parámetro de Temperatura Recomendado

El valor predeterminado de `temperature` es `1.0`. Se recomienda ajustarlo según la tarea a realizar:

| Caso de Uso | Temperatura Recomendada |
| :--- | :--- |
| Programación / Matemáticas | `0.0` |
| Limpieza y Análisis de Datos | `1.0` |
| Conversación General | `1.3` |
| Traducción | `1.3` |
| Escritura Creativa / Poesía | `1.5` |

---

## 4. Guías de la API (API Guides)

### Modo Thinking (Razonamiento)
Los modelos DeepSeek soportan la generación de una cadena de pensamiento (Chain-of-Thought - CoT) antes de ofrecer la respuesta final, lo cual incrementa notablemente la precisión de los resultados.

#### Control del Modo Thinking (OpenAI vs. Anthropic)
*   **Alternar Modo (Thinking Toggle):** Se realiza en el cuerpo de la petición.
    *   Formato OpenAI (dentro de `extra_body`): `{"thinking": {"type": "enabled"}}`
    *   Formato Anthropic: Soportado nativamente según sus esquemas.
*   **Control del nivel de esfuerzo (Effort Control):**
    *   Formato OpenAI: `{"reasoning_effort": "high"}` o `"max"`
    *   Formato Anthropic: `{"output_config": {"effort": "high"}}` o `"max"`

#### Particularidades Técnicas del Modo Thinking:
1.  **Parámetros excluidos:** El modo de razonamiento **no es compatible** con los parámetros `temperature`, `top_p`, `presence_penalty` ni `frequency_penalty`. Si se configuran, la API los ignorará para evitar interrupciones en la compatibilidad.
2.  **Parámetro de respuesta:** El contenido de razonamiento intermedio se devuelve en el campo **`reasoning_content`**, expuesto al mismo nivel estructural que `content`.

##### Ejemplo de código con SDK de OpenAI (con stream para capturar el razonamiento):
```python
from openai import OpenAI

client = OpenAI(
    api_key="<DEEPSEEK_API_KEY>",
    base_url="https://api.deepseek.com"
)

response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=[
        {"role": "user", "content": "¿Cuántas 'r' tiene la palabra 'strawberry'?"}
    ],
    reasoning_effort="high",
    extra_body={"thinking": {"type": "enabled"}},
    stream=True
)

reasoning_content = ""
content = ""

for chunk in response:
    # Capturar tokens de razonamiento (CoT)
    if chunk.choices[0].delta.reasoning_content:
        reasoning_content += chunk.choices[0].delta.reasoning_content
        print(chunk.choices[0].delta.reasoning_content, end="", flush=True)
    # Capturar respuesta final
    elif chunk.choices[0].delta.content:
        content += chunk.choices[0].delta.content
        print(chunk.choices[0].delta.content, end="", flush=True)
```

---

### Conversaciones de Múltiples Rondas (Multi-round Conversation)
La API de DeepSeek es "stateless" (sin estado), lo que significa que el servidor no recuerda el contexto de llamadas previas. Debe concatenar el historial completo de la conversación en cada petición subsiguiente.

#### Flujo de Concatenación en modo estándar:
```python
from openai import OpenAI

client = OpenAI(api_key="<DEEPSEEK_API_KEY>", base_url="https://api.deepseek.com")

# Ronda 1
messages = [{"role": "user", "content": "¿Cuál es la montaña más alta del mundo?"}]
response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=messages
)
messages.append(response.choices[0].message)

# Ronda 2
messages.append({"role": "user", "content": "¿Y la segunda más alta?"})
response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=messages
)
messages.append(response.choices[0].message)
```

---

### Completado con Prefijo de Chat (Chat Prefix Completion)
Esta función permite preestablecer el inicio de la respuesta del asistente (`assistant`), útil para forzar formatos específicos o guiar el tono del modelo.

*   **Endpoint:** Requiere utilizar `base_url="https://api.deepseek.com/beta"`.
*   **Parámetro clave:** Añadir `prefix: True` dentro del último mensaje con rol de asistente.

#### Ejemplo de Código:
```python
from openai import OpenAI

client = OpenAI(
    api_key="<DEEPSEEK_API_KEY>",
    base_url="https://api.deepseek.com/beta"
)

messages = [
    {"role": "user", "content": "Escribe una función rápida de ordenamiento en Python"},
    {"role": "assistant", "content": "```python\ndef quick_sort", "prefix": True}
]

response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=messages,
    stop=["```"]
)

print(response.choices[0].message.content)
```

---

### Completado de En medio (FIM Completion - Beta)
El endpoint de *Fill In the Middle* (FIM) permite que el modelo complete texto o código faltante a partir de un fragmento inicial (`prompt`) y un fragmento final (`suffix`).

*   **Restricción:** Solo disponible con el modelo en modo de no razonamiento (no-thinking).
*   **Límites:** El límite de generación es de 4K tokens.
*   **Endpoint:** Debe apuntar a `https://api.deepseek.com/beta`.

#### Ejemplo de Código:
```python
from openai import OpenAI

client = OpenAI(
    api_key="<DEEPSEEK_API_KEY>",
    base_url="https://api.deepseek.com/beta"
)

response = client.completions.create(
    model="deepseek-v4-pro",
    prompt="def fib(a):",
    suffix="    return fib(a-1) + fib(a-2)",
    max_tokens=128
)

print(response.choices[0].text)
```

---

### Salida JSON Estructurada (JSON Output)
Fuerza al modelo a devolver exclusivamente un objeto JSON válido. Es ideal para flujos de análisis de datos e integraciones automatizadas con bases de datos.

*   **Requisito 1:** Se debe configurar el campo `response_format` con `{"type": "json_object"}`.
*   **Requisito 2:** Es obligatorio solicitar explícitamente en el prompt de sistema o usuario que la respuesta sea en formato JSON.

```python
from openai import OpenAI

client = OpenAI(api_key="<DEEPSEEK_API_KEY>", base_url="https://api.deepseek.com")

response = client.chat.completions.create(
    model="deepseek-v4-flash",
    messages=[
        {"role": "system", "content": "Devuelve la información solicitada en formato JSON, con los campos 'nombre' y 'edad'."},
        {"role": "user", "content": "Me llamo Juan y tengo 28 años."}
    ],
    response_format={"type": "json_object"}
)

print(response.choices[0].message.content)
```

---

### Llamada a Funciones (Tool Calls)
Permite al modelo interactuar de forma segura con APIs externas. DeepSeek es compatible con llamadas paralelas y ejecución de funciones complejas en entornos de desarrollo.

```python
from openai import OpenAI

client = OpenAI(
    api_key="<DEEPSEEK_API_KEY>",
    base_url="https://api.deepseek.com",
)

tools = [
    {
        "type": "function",
        "function": {
            "name": "obtener_clima",
            "description": "Obtiene la temperatura actual de una ubicación geográfica.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ubicacion": {
                        "type": "string",
                        "description": "Ciudad, por ejemplo, Madrid, España",
                    }
                },
                "required": ["ubicacion"]
            },
        }
    }
]

messages = [{"role": "user", "content": "¿Cómo está el clima en Madrid?"}]

response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=messages,
    tools=tools
)

print(response.choices[0].message.tool_calls)
```

---

### Compatibilidad con el Ecosistema de Anthropic
Para proyectos construidos en torno al SDK de Anthropic o herramientas como **Claude Code**, la API de DeepSeek ofrece un endpoint dedicado compatible con Anthropic:

*   **Base URL:** `https://api.deepseek.com/anthropic`
*   **API Key:** Se envía en el encabezado mediante `x-api-key`.

#### Mapeo automático de nombres de modelos de Claude a DeepSeek:
*   Cualquier modelo que inicie con `claude-opus` se redirige automáticamente a `deepseek-v4-pro`.
*   Cualquier modelo que inicie con `claude-sonnet` o `claude-haiku` se mapea a `deepseek-v4-flash`.

---

## 5. Referencia Técnica de la API (API Reference)

### Esquema de Autenticación
La API utiliza autenticación basada en Bearer Tokens estándar en la cabecera HTTP.

```http
Authorization: Bearer <DEEPSEEK_API_KEY>
```

---

### Endpoint: Crear Chat Completion
Genera una respuesta basada en una lista previa de mensajes de conversación.

*   **Método:** `POST`
*   **URL:** `https://api.deepseek.com/v1/chat/completions`

#### Parámetros Principales del Body (JSON):
*   `model` *(string, requerido)*: `deepseek-v4-pro` o `deepseek-v4-flash`.
*   `messages` *(array, requerido)*: Lista de objetos de mensaje (`role` y `content`).
*   `stream` *(boolean, opcional)*: Envío de respuestas progresivas en formato *Server-Sent Events* (`text/event-stream`). Por defecto `false`.
*   `max_tokens` *(integer, opcional)*: Límite máximo de generación.
*   `response_format` *(object, opcional)*: Define el formato de la salida (ej. `{"type": "json_object"}`).

---

### Endpoint: Obtener Modelos Disponibles
Lista los modelos activos y sus propiedades básicas.

*   **Método:** `GET`
*   **URL:** `https://api.deepseek.com/models`

#### Ejemplo de Respuesta (200 OK):
```json
{
  "object": "list",
  "data": [
    {
      "id": "deepseek-v4-flash",
      "object": "model",
      "owned_by": "deepseek"
    },
    {
      "id": "deepseek-v4-pro",
      "object": "model",
      "owned_by": "deepseek"
    }
  ]
}
```

---

### Endpoint: Obtener Saldo del Usuario (Get User Balance)
Permite consultar de forma programática el saldo disponible en la cuenta del desarrollador.

*   **Método:** `GET`
*   **URL:** `https://api.deepseek.com/user/balance`

#### Ejemplo de Respuesta (200 OK):
```json
{
  "is_available": true,
  "balance_infos": [
    {
      "currency": "USD",
      "total_balance": "110.00",
      "granted_balance": "10.00",
      "topped_up_balance": "100.00"
    }
  ]
}
```

---

## 6. Códigos de Error Comunes

| Código HTTP | Causa Principal | Solución Sugerida |
| :--- | :--- | :--- |
| **400 - Invalid Format** | El cuerpo de la solicitud JSON contiene errores de formato. | Corrija el cuerpo de la petición siguiendo el esquema oficial. |
| **401 - Authentication Fails**| La clave de API es inválida o no ha sido enviada. | Verifique el encabezado `Authorization` y su API key. |
| **402 - Insufficient Balance**| Su cuenta se ha quedado sin saldo disponible. | Realice una recarga de saldo en el panel de control de DeepSeek. |
| **422 - Invalid Parameters**| Los parámetros de la petición no son válidos (ej. exceso de tokens).| Corrija la configuración de parámetros específicos. |
| **429 - Rate Limit Reached** | Exceso de peticiones concurrentes por segundo. | Implemente lógica de reintentos exponenciales o reduzca la frecuencia. |
| **500 / 503** | Error o sobrecarga temporal de los servidores. | Aguarde unos instantes e intente la solicitud de nuevo. |

***
*Copyright © 2026 DeepSeek, Inc. Todos los derechos reservados.*
```