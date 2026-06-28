const OpenAI = require('openai');

function createDeepSeekClient(apiKey) {
  if (!apiKey) throw new Error('VTUBER_API_KEY no configurada');

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com',
    maxRetries: 3,
  });

  async function executeToolCall(toolCall) {
    if (toolCall.function.name === 'web_search') {
      const { query } = JSON.parse(toolCall.function.arguments);
      try {
        const res = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
          { headers: { 'User-Agent': 'Kick-VTuber/1.0' } }
        );
        const data = await res.json();
        return data.AbstractText
          || data.RelatedTopics?.slice(0, 3).map(t => t.Text || t.Result).join('\n')
          || 'No se encontraron resultados.';
      } catch {
        return 'Error al realizar la búsqueda web.';
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
    async complete({ messages, temperature = 1.3, maxTokens = 512 }) {
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
