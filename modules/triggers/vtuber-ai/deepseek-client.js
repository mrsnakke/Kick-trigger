const OpenAI = require('openai');
const vision = require('../iA Vision/server');

const VISION_PROMPT = 'Actúas como los ojos de Grim, una VTuber tsundere transmitiendo en vivo en Kick. Describe en español, en presente y con estilo de narración en vivo TODO lo relevante que ves en la pantalla, sea lo que sea que esté mostrando: un juego si hay gameplay, un video, un meme (lee su texto tal cual si se ve), una página web, el modelo VTuber, textos del chat, overlays, menús, errores o momentos graciosos. Sé específico y factual: NO inventes nada que no esté realmente en la pantalla. Si el contenido es un meme o video, describe lo que se ve con detalle para poder identificarlo después.'

function createDeepSeekClient(apiKey, searchApiKey) {
  if (!apiKey) throw new Error('VTUBER_API_KEY no configurada');

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com',
    maxRetries: 3,
    fetch: (url, init) => fetch(url, init),
  });

  async function executeToolCall(toolCall) {
    if (toolCall.function.name === 'web_search') {
      const { query } = JSON.parse(toolCall.function.arguments);
      if (!searchApiKey) {
        return 'La búsqueda en internet no está configurada. Pide al streamer que configure una API key de búsqueda.';
      }
      try {
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: searchApiKey,
            query,
            search_depth: 'basic',
            include_answer: true,
            max_results: 5,
          }),
        });
        if (!res.ok) return `Error en la búsqueda: ${res.status}`;
        const data = await res.json();
        if (data.answer) return data.answer;
        if (data.results?.length) {
          return data.results.map(r => `${r.title}: ${r.content}`).join('\n');
        }
        return 'No se encontraron resultados.';
      } catch {
        return 'Error al realizar la búsqueda web.';
      }
    }
    if (toolCall.function.name === 'get_current_time') {
      const now = new Date();
      const tijuana = new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Tijuana',
        dateStyle: 'full',
        timeStyle: 'long',
        hour12: false,
      }).format(now);
      return tijuana;
    }
    if (toolCall.function.name === 'take_screenshot') {
      try {
        const { focus = '' } = JSON.parse(toolCall.function.arguments || '{}');
        const prompt = VISION_PROMPT + (focus ? ` Contexto de lo que se pregunta o quiere verificar: ${focus}` : '');
        const description = await vision.analyze(apiKey, prompt);
        return `ESTO ES LO QUE VES AHORA EN PANTALLA:\n${description}`;
      } catch (e) {
        return `No pude capturar o analizar la pantalla: ${e.message}`;
      }
    }
    if (toolCall.function.name === 'get_running_apps') {
      try {
        const apps = await vision.getRunningApps();
        if (!apps.length) return 'No hay aplicaciones con ventana abierta detectadas.';
        return 'APLICACIONES ABIERTAS EN EL PC:\n' + apps.map(a => `- ${a.name}: "${a.title}"`).join('\n');
      } catch (e) {
        return `No pude obtener la lista de aplicaciones: ${e.message}`;
      }
    }
    return `Función '${toolCall.function.name}' no disponible.`;
  }

  function toUsage(u) {
    return {
      prompt: u?.prompt_tokens ?? 0,
      completion: u?.completion_tokens ?? 0,
      total: u?.total_tokens ?? 0,
      cacheHit: u?.prompt_cache_hit_tokens ?? 0,
    };
  }

  return {
    async complete({ messages, temperature = 1.3, maxTokens = 512, userId }) {
      const tools = [
        {
          type: 'function',
          function: {
            name: 'web_search',
            description: 'Busca información actualizada en internet. Úsala solo cuando necesites datos recientes, verificar hechos o acceder a contenido que no está en tu conocimiento.',
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'La consulta de búsqueda',
                },
              },
              required: ['query'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'get_current_time',
            description: 'Obtiene la fecha y hora actual en Tijuana, Baja California (UTC-8 / UTC-7 en horario de verano).',
            parameters: {
              type: 'object',
              properties: {},
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'take_screenshot',
            description: 'Toma un screenshot de la pantalla del stream y lo analiza, devolviéndote una descripción de lo que está pasando. Úsala cuando necesites saber qué hay en pantalla para responder mejor: si el chat menciona algo visual del stream (un juego, un video, un meme, una web), si te preguntan por el juego, el modelo VTuber, un error, o si simplemente sientes que necesitas ver la pantalla para dar una buena respuesta. Usa web_search después si el contenido que viste necesita ser identificado o verificado. No la uses en preguntas generales que no requieren contexto visual.',
            parameters: {
              type: 'object',
              properties: {
                focus: {
                  type: 'string',
                  description: 'Qué quieres ver o verificar en la pantalla. Opcional.',
                },
              },
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'get_running_apps',
            description: 'Lista las aplicaciones con ventana abierta en el PC del streamer (nombre del proceso y título de ventana). Úsala para saber qué juego o aplicación está usando, cuándo el chat pregunte qué está jugando, o cuando necesites identificar algo que corre en el PC sin tomar screenshot.',
            parameters: {
              type: 'object',
              properties: {},
            },
          },
        },
      ];

      async function call(msg, withTools) {
        const p = {
          model: 'deepseek-flash',
          messages: msg,
          temperature,
          max_tokens: maxTokens,
          stream: false,
          extra_body: { thinking: { type: 'disabled' } },
        };
        if (userId) p.extra_body.user_id = userId;
        if (withTools) p.tools = tools;
        return client.chat.completions.create(p);
      }

      const response = await call(messages, true);

      if (!response.choices?.length) {
        throw new Error('DeepSeek API: respuesta vacía');
      }

      const choice = response.choices[0];
      const usage = toUsage(response.usage);

      if (choice.finish_reason === 'tool_calls' && choice.message?.tool_calls) {
        const allMessages = [...messages];
        let lastChoice = choice;
        let totalUsage = usage;

        for (let round = 0; round < 2; round++) {
          allMessages.push(lastChoice.message);
          const toolResults = [];
          for (const tc of lastChoice.message.tool_calls) {
            toolResults.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: await executeToolCall(tc),
            });
          }
          allMessages.push(...toolResults);

          const followUp = await call(allMessages, true);
          if (!followUp.choices?.length) {
            throw new Error('DeepSeek API: respuesta vacía tras tool call');
          }
          totalUsage = toUsage(followUp.usage);
          lastChoice = followUp.choices[0];

          if (lastChoice.finish_reason !== 'tool_calls' || !lastChoice.message?.tool_calls) {
            return {
              text: lastChoice.message.content,
              usage: {
                prompt: usage.prompt + totalUsage.prompt,
                completion: usage.completion + totalUsage.completion,
                total: usage.total + totalUsage.total,
                cacheHit: usage.cacheHit + totalUsage.cacheHit,
              },
            };
          }
        }

        const finalResponse = await call([...allMessages], false);
        if (!finalResponse.choices?.length) {
          throw new Error('DeepSeek API: respuesta vacía tras tool calls');
        }
        const finalUsage = toUsage(finalResponse.usage);
        return {
          text: finalResponse.choices[0].message.content,
          usage: {
            prompt: usage.prompt + finalUsage.prompt,
            completion: usage.completion + finalUsage.completion,
            total: usage.total + finalUsage.total,
            cacheHit: usage.cacheHit + finalUsage.cacheHit,
          },
        };
      }

      return { text: choice.message.content, usage };
    },
  };
}

module.exports = { createDeepSeekClient };
