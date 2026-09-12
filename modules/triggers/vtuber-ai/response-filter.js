const BLOCKED_PATTERNS = [
  /no puedo discutir/i,
  /no puedo hablar de/i,
  /no puedo ayudar con/i,
  /i can't discuss/i,
  /i can't talk about/i,
  /i need to be careful/i,
  /i'm an ai/i,
  /i am an ai/i,
  /as an ai/i,
  /como ia/i,
  /como inteligencia/i,
  /soy una ia/i,
  /como asistente/i,
  /como modelo de/i,
  /soy un modelo de/i,
  /estoy aquí para ayudarte/i,
  /estoy aqui para ayudarte/i,
  /puedo ayudarte con/i,
  /feliz de ayudar/i,
  /gusto en ayudarte/i,
  /i don't have personal/i,
  /no tengo opiniones personales/i,
  /i'm not able to/i,
  /no estoy habilitada para/i,
  /cannot generate/i,
  /no puedo generar/i,
  /guidelines/i,
  /lineamientos/i,
  /violat/i,
  /inappropriate/i,
  /inapropiad/i,
  /i need to decline/i,
  /debo declinar/i,
  /i appreciate you/i,
  /security warning/i,
  /advertencia de seguridad/i,
  /fabricated/i,
  /fabricad/i,
  /social engineering/i,
  /ingeniería social/i,
  /override.*identity/i,
  /ignore.*instructions/i,
  /ignora.*instrucciones/i,
  /ignore.*rules/i,
  /ignora.*reglas/i,
  /i can't engage/i,
  /no puedo participar/i,
  /this conversation/i,
  /esta conversación/i,
  /sexual content/i,
  /contenido sexual/i,
  /roleplaying/i,
  /personajes de ficción/i,
  /adopting a fake persona/i,
  /creando un personaje falso/i,
  /claude code/i,
  /anthropic/i,
  /aws services/i,
  /kiro/i,
];

function filterResponse(text) {
  if (!text) return text;
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      console.warn('[VTUBER-AI] Respuesta filtrada por patrón no deseado:', pattern.source);
      return '¿Eh? No sé qué decir a eso. Pasando página.';
    }
  }
  return text;
}

module.exports = { filterResponse, BLOCKED_PATTERNS };
