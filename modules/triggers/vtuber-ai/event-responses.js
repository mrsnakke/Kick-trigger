const eventResponseTemplates = {
  firstMessage: [
    '¡{username} acaba de llegar! ¿Qué onda, bienvenido al caos.',
    'Oye, {username} pasó por aquí. ¿Ya te preparaste para Grim?',
    '{username} se unió. Prepárate, porque no somos teamwork.',
    'Mira quién llegó, {username}. Espero que traigas buen humor porque yo no.',
    '¿{username} por fin apareció? Ya te estábamos esperando... bueno, yo no, pero el chat sí.',
  ],
  follow: [
    '¡{username} me siguió! Ahora eres parte de la familia disfuncional.',
    'Follow de {username}. Espero que tengas buen gusto, porque aquí no hay marcha atrás.',
    '{username} dio follow. ¡Bienvenido al lado oscuro del stream!',
    '¿{username} me siguió? Por fin alguien con clase. Te quiero un poco más.',
    'Follow de {username}. Eso espero que signifique que te gustó, porque si no, qué awkward.',
  ],
  sub: [
    '¡{username} se suscribió! Eso significa que ahora me debes un café.',
    'Suscripción de {username}. Por fin alguien con clase. Te quiero un poco más.',
    '{username} se unió a los suscriptores. Prepárate, porque ahora te conozco personalmente.',
    '¡{username} pagó por verme! Espero que valga la pena, porque yo no planeo mejorar.',
    'Suscripción de {username}. Ahora eres oficialmente mi favorito... no le digas a los demás.',
  ],
  subRenewal: [
    '{username} renovó su suscripción. ¡Otro mes más conmigo! Ya ni sé si felicitarte o consolarte.',
    'Renovación de {username}. Llevas {months} meses. ¿Ya te acostumbraste a mi actitud o qué onda?',
    '{username} sigue aquí después de {months} meses. Eso es o muy valiente o muy raro.',
  ],
  gift: [
    '¡{username} mandó {gift_name}! ¿Eso es para mí? Claro que sí, qué detalle.',
    '{gift_name} de {username}. ¡Estás exagerando! Pero no pares.',
    'Regalito de {username}: {gift_name}. Te debo una, pero no cuentes con que la pago.',
    '¿{gift_name} de {username}? Ay, no sabía que te importaba tanto. Gracias.',
    '{username} mandó {gift_name}. ¡Esto cada vez se pone mejor! No sabía que tenía fans así.',
  ],
  reward: [
    '{username} canjeó: {reward_title}. ¡Algo se va a poner interesante!',
    'Recompensa de {username}: {reward_title}. Prepárate porque esto va a ser good.',
    '{username} activó {reward_title}. No sé qué esperar, pero tensa los abdominales.',
  ],
  raid: [
    '¡{username} trajo {viewer_count} personas! Preparada para el caos, ¿o no?',
    'Raider de {username} con {viewer_count} almas. Bienvenidos al circo.',
    '{username} trajo su ejército de {viewer_count}. Ojalá tengan buen humor.',
  ],
};

function getEventResponse(eventType, data) {
  const templates = eventResponseTemplates[eventType];
  if (!templates) return null;

  const template = templates[Math.floor(Math.random() * templates.length)];
  return template
    .replace(/\{username\}/g, (data && data.username) || 'alguien')
    .replace(/\{gift_name\}/g, (data && data.giftName) || 'algo chido')
    .replace(/\{reward_title\}/g, (data && data.rewardTitle) || 'una recompensa')
    .replace(/\{viewer_count\}/g, (data && data.viewerCount) || 'unos cuantos')
    .replace(/\{months\}/g, (data && data.months) || 'unos');
}

module.exports = { getEventResponse, eventResponseTemplates };
