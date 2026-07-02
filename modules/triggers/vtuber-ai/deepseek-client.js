const OpenAI = require('openai');

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
      ];

      async function call(msg, withTools) {
        const p = {
          model: 'deepseek-v4-flash',
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
        const toolResults = [];
        for (const tc of choice.message.tool_calls) {
          toolResults.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: await executeToolCall(tc),
          });
        }

        const followUp = await call([...messages, choice.message, ...toolResults], false);

        if (!followUp.choices?.length) {
          throw new Error('DeepSeek API: respuesta vacía tras tool call');
        }

        const finalUsage = toUsage(followUp.usage);
        return {
          text: followUp.choices[0].message.content,
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
