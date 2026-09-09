import { CharacterConfig, FighterStats, BackgroundMode, ViewLayout } from '../types/fighter';

export interface PlayerRecord {
  kick_id: number | null;
  username: string;
  stats: FighterStats;
}

export interface MatchState {
  background: BackgroundMode;
  layout: ViewLayout;
  maxWins: number;
  p1?: string;
  p2?: string;
  active?: boolean;
  expEligible?: { p1: boolean; p2: boolean } | null;
  enchant?: { player: string; stat: string; success: boolean; at: number };
  updatedAt?: string;
}

export interface StreamConfigData {
  version: number;
  p1: CharacterConfig | null;
  p2: CharacterConfig | null;
  players: Record<string, PlayerRecord>;
  match: MatchState;
  session?: { exp: Record<string, number> };
  updatedAt?: string;
}

const API_BASE = '';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `API ${url} falló: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function post(url: string, body?: unknown): Promise<unknown> {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function loadConfig(): Promise<StreamConfigData> {
  return request<StreamConfigData>('/api/config');
}

export async function saveConfig(cfg: Partial<StreamConfigData>): Promise<StreamConfigData> {
  return post('/api/config', cfg) as Promise<StreamConfigData>;
}

export async function uploadSprite(id: string, dataUrl: string): Promise<{ url: string }> {
  return post(`/api/sprites/${id}`, { dataUrl }) as Promise<{ url: string }>;
}

export async function exportConfig(): Promise<StreamConfigData> {
  return request<StreamConfigData>('/api/export');
}

export async function resetConfig(): Promise<StreamConfigData> {
  return post('/api/reset') as Promise<StreamConfigData>;
}

export async function allocatePoint(
  player: string,
  stat: string
): Promise<{ ok: boolean; success: boolean; player: string; stats: FighterStats }> {
  return post('/api/allocate', { player, stat }) as Promise<{ ok: boolean; success: boolean; player: string; stats: FighterStats }>;
}

export async function setMatchPlayers(p1: string, p2: string): Promise<StreamConfigData> {
  return post('/api/set-match', { p1, p2 }) as Promise<StreamConfigData>;
}

export async function startMatch(): Promise<{ ok: boolean }> {
  return post('/api/start') as Promise<{ ok: boolean }>;
}

export async function endMatch(score: { p1: number; p2: number }): Promise<{ ok: boolean }> {
  return post('/api/end', score) as Promise<{ ok: boolean }>;
}