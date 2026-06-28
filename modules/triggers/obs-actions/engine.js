const obs = require('./obs');

async function executeSubAction(subAction) {
  if (subAction.type === 'visibility') {
    if (!obs.connected) {
      console.warn('[Engine] OBS desconectado, saltando visibility:', subAction.sourceName);
      return;
    }
    const enabled = subAction.state === 'Visible';
    if (subAction.isGroup) {
      // OBS no soporta SetSceneItemEnabled en grupos directamente,
      // toggleamos los items hijos individualmente
      const scenes = obs.getScenes();
      const items = scenes.itemsByScene[subAction.scene] || [];
      const children = items.filter(item => item.groupName === subAction.sourceName);
      for (const child of children) {
        await obs.setVisibility(subAction.sourceName, child.id, enabled);
      }
    } else {
      const targetScene = subAction.groupName || subAction.scene;
      await obs.setVisibility(targetScene, subAction.sourceId, enabled);
    }
  } else if (subAction.type === 'delay') {
    await new Promise(resolve => setTimeout(resolve, subAction.duration));
  }
}

async function execute(subActions) {
  for (const step of subActions) {
    await executeSubAction(step);
  }
}

module.exports = { execute, executeSubAction };
