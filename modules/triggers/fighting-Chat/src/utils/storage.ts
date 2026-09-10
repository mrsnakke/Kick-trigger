import { CharacterConfig, FighterStats } from '../types/fighter';
import { loadConfig, saveConfig, uploadSprite, StreamConfigData } from './api';

/**
 * Config & Persistence.
 * El server guarda DOS archivos: `config.json` (sprites/layout/match) y `players.json`
 * (inventario: stats, W/L, puntos). El API los sirve fusionados bajo la misma shape.
 */

let configCache: StreamConfigData | null = null;

export function getCachedConfig(): StreamConfigData | null {
  return configCache;
}

export async function refreshConfig(): Promise<StreamConfigData> {
  const cfg = await loadConfig();
  configCache = cfg;
  return cfg;
}

function persist(partial: Partial<StreamConfigData>) {
  if (!configCache) return;
  configCache = { ...configCache, ...partial };
  saveConfig(partial).catch(() => {
    /* offline / server gone — keep in-memory state */
  });
}

/**
 * Balanced Fighter Stats Calculation
 * Scales smoothly with level without breaking game balance.
 * Lazy-guarded so a "#ponytail: hard level cap of 99 keeps year-long streams bounded"
 */
export function calcStatsForLevel(level: number, baseHp = 200): Omit<FighterStats, 'attributePoints' | 'allocated' | 'wins' | 'losses' | 'exp'> {
  const safeLevel = Math.max(1, Math.min(99, Math.floor(level)));
  // Mismo umbral que el server (kick.mjs expForLevel): curva polinómica suave para largo plazo.
  const expToNextLevel = Math.floor(50 * Math.pow(safeLevel, 1.2));

  return {
    level: safeLevel,
    expToNextLevel,
    baseMaxHp: Math.round(baseHp + (safeLevel - 1) * 10),
    attackPower: Number((1.0 + (safeLevel - 1) * 0.02).toFixed(3)),
    defense: Number(Math.min(0.22, (safeLevel - 1) * 0.012).toFixed(3)),
    evasion: Number(Math.min(0.10, (safeLevel - 1) * 0.006).toFixed(3)),
    accuracy: Number(Math.min(0.98, 0.94 + (safeLevel - 1) * 0.004).toFixed(3)),
    critChance: 0,
  };
}

const EMPTY_ALLOC = { hp: 0, attack: 0, defense: 0, evasion: 0, accuracy: 0, crit: 0 };

function normalizeAllocated(a: Partial<FighterStats['allocated']> | undefined): FighterStats['allocated'] {
  return { ...EMPTY_ALLOC, ...a };
}

export function zeroStats(level = 1): FighterStats {
  return { ...calcStatsForLevel(level), exp: 0, attributePoints: 0, allocated: { ...EMPTY_ALLOC }, wins: 0, losses: 0 };
}

export function getFighterStats(id: string): FighterStats {
  const stored = configCache?.players?.[id]?.stats;
  if (stored && typeof stored.level === 'number') {
    const formula = calcStatsForLevel(stored.level, stored.baseMaxHp || 200);
    return {
      ...formula,
      ...stored,
      critChance: stored.critChance ?? 0,
      expToNextLevel: formula.expToNextLevel,
      attributePoints: stored.attributePoints ?? 0,
      allocated: normalizeAllocated(stored.allocated),
      wins: stored.wins ?? 0,
      losses: stored.losses ?? 0,
    };
  }
  return zeroStats(1);
}

/**
 * Sprite sheets are uploaded to the server and stored as PNG on disk.
 * Returns the server URL to store in the CharacterConfig.
 */
export async function saveCustomSpriteImage(id: string, dataUrl: string): Promise<string> {
  const { url } = await uploadSprite(id, dataUrl);
  return url;
}

export async function clearCustomSpriteImage(id: string): Promise<void> {
  return Promise.resolve();
}

export async function getCustomSpriteImage(id: string): Promise<string | null> {
  if (configCache?.p1) {
    const c = id === 'p1' ? configCache.p1 : configCache.p2;
    if (c?.spriteUrl) return c.spriteUrl;
  }
  return null;
}

/**
 * Save a full CharacterConfig back to the disk config.
 */
export function saveCharacterConfig(id: 'p1' | 'p2', cfg: CharacterConfig): void {
  const patch = id === 'p1' ? { p1: cfg } : { p2: cfg };
  const next = {
    p1: configCache?.p1 ?? null,
    p2: configCache?.p2 ?? null,
    ...patch,
  };
  persist(next);
}

/**
 * Export Fighter Configurations to JSON file download
 */
export function exportConfigToJson(
  data: CharacterConfig | { p1: CharacterConfig; p2: CharacterConfig },
  filename = 'fighter-config.json'
): void {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Read and parse JSON file from user input
 */
export function importConfigFromJson(
  file: File
): Promise<CharacterConfig | { p1: CharacterConfig; p2: CharacterConfig }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('El archivo JSON no es un objeto válido');
        }
        resolve(parsed);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Error al parsear el JSON'));
      }
    };
    reader.onerror = () => reject(new Error('Error al leer el archivo JSON'));
    reader.readAsText(file);
  });
}