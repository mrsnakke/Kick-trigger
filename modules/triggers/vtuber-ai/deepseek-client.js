const BASE_URL = 'https://api.deepseek.com/v1/chat/completions';

function createDeepSeekClient(apiKey) {
  if (!apiKey) throw new Error('VTUBER_API_KEY no configurada');

  return {
    async complete({ messages, temperature = 1.3, maxTokens = 512 }) {
      const body = {
        model: 'deepseek-v4-flash',
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
        extra_body: { thinking: { type: 'disabled' } }
      };

      const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`DeepSeek API error ${res.status}: ${err}`);
      }

      const data = await res.json();
      const choice = data.choices[0];

      return {
        text: choice.message.content,
        usage: {
          prompt: data.usage?.prompt_tokens ?? 0,
          completion: data.usage?.completion_tokens ?? 0,
          total: data.usage?.total_tokens ?? 0,
          cacheHit: data.usage?.prompt_cache_hit_tokens ?? 0
        }
      };
    }
  };
}

module.exports = { createDeepSeekClient };
