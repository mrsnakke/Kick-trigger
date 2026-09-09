import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { FighterStats } from './types/fighter';
import { refreshConfig } from './utils/storage';
import { allocatePoint, startMatch, setMatchPlayers } from './utils/api';
import { Swords, Trophy, Zap, Dices, Users } from 'lucide-react';

type StatKey = 'hp' | 'attack' | 'defense' | 'evasion' | 'accuracy' | 'speed' | 'crit';

const STAT_LABELS: Record<StatKey, string> = {
  hp: 'Vida',
  attack: 'Ataque',
  defense: 'Defensa',
  evasion: 'Evasión',
  accuracy: 'Puntería',
  speed: 'Velocidad',
  crit: 'Crítico',
};

const STAT_ICONS: Record<StatKey, string> = {
  hp: '❤️',
  attack: '⚔️',
  defense: '🛡️',
  evasion: '💨',
  accuracy: '🎯',
  speed: '👟',
  crit: '💥',
};

// ponytail: tope de EXP TOTAL por jugador y por sesión; se resetea al reiniciar el server.
const SESSION_EXP_CAP = 300;

function statValue(stats: FighterStats, key: StatKey): string {
  switch (key) {
    case 'hp': return String(stats.baseMaxHp);
    case 'attack': return `${Math.round(stats.attackPower * 100)}%`;
    case 'defense': return `${Math.round(stats.defense * 100)}%`;
    case 'evasion': return `${Math.round(stats.evasion * 100)}%`;
    case 'accuracy': return `${Math.round(stats.accuracy * 100)}%`;
    case 'speed': return `${Math.round(stats.speed * 100)}%`;
    case 'crit': return `${Math.round(stats.critChance * 100)}%`;
  }
}

// El encantamiento ya no tira dado: SIEMPRE mejora un poquito el atributo.
interface EnchantState {
  playerName: string;
  stat: StatKey;
}

function PlayerCard({
  id,
  name,
  stats,
  accent,
  expLeft,
  onAllocate,
  disabled,
}: {
  id: string;
  name: string;
  stats: FighterStats;
  accent: string;
  expLeft: number;
  onAllocate: (stat: StatKey) => void;
  disabled: boolean;
}) {
  const expRatio = Math.min(1, stats.exp / stats.expToNextLevel);
  const allocated = stats.allocated ?? { hp: 0, attack: 0, defense: 0, evasion: 0, accuracy: 0, speed: 0, crit: 0 };
  const statList = Object.keys(STAT_LABELS) as StatKey[];

  return (
    <div
      className="rounded-2xl bg-white/5 border border-white/10 p-6 flex flex-col gap-4 shadow-xl"
      style={{ boxShadow: `0 0 40px -12px ${accent}66` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg"
            style={{ background: `${accent}22`, color: accent }}
          >
            {id === 'local-p1' ? '1' : id === 'local-p2' ? '2' : '🎮'}
          </div>
          <div>
            <h2 className="font-fighter text-xl font-bold text-white">{name}</h2>
            <p className="text-white/40 text-xs">
              W:{stats.wins ?? 0} · L:{stats.losses ?? 0} · ⚡ {expLeft}/{SESSION_EXP_CAP} EXP hoy
            </p>
          </div>
        </div>
        <div className="px-4 py-1.5 rounded-full font-arcade text-sm" style={{ background: accent, color: '#fff' }}>
          NIVEL {stats.level}
        </div>
      </div>

      <div>
        <div className="flex justify-between text-xs text-white/50 mb-1">
          <span>EXP</span>
          <span>{stats.exp} / {stats.expToNextLevel}</span>
        </div>
        <div className="h-3 bg-black/40 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${expRatio * 100}%`, background: accent }} />
        </div>
      </div>

      <div className="rounded-xl bg-black/30 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-white/50 flex items-center gap-1"><Dices size={12} /> Puntos de atributo</span>
          <span className={`font-arcade text-lg ${stats.attributePoints > 0 ? 'text-yellow-300 animate-pulse' : 'text-white/30'}`}>
            {stats.attributePoints}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {statList.map((key) => (
            <button
              key={key}
              disabled={stats.attributePoints <= 0 || disabled}
              onClick={() => onAllocate(key)}
              className="group rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed p-3 text-left border border-white/10 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/60">{STAT_ICONS[key]} {STAT_LABELS[key]}</span>
                <span className="text-[10px] text-emerald-400">+{allocated[key] ?? 0} pts</span>
              </div>
              <div className="font-arcade text-base text-white mt-1">{statValue(stats, key)}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function EnchantOverlay({ enchant }: { enchant: EnchantState }) {
  const label = STAT_LABELS[enchant.stat];
  const icon = STAT_ICONS[enchant.stat];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="text-center px-8">
        <div className="relative flex items-center justify-center mb-6">
          <div className="enchant-ring absolute w-44 h-44 rounded-full enchant-success" />
          <div className="enchant-core w-28 h-28 rounded-full flex items-center justify-center text-5xl enchant-glow-green">
            {icon}
          </div>
        </div>
        <h2 className="font-fighter text-2xl font-extrabold tracking-wide text-emerald-400">
          ¡MEJORÓ!
        </h2>
        <p className="text-white/50 mt-2 text-sm">
          {enchant.playerName} · {label} +1
        </p>
      </div>
      <style>{`
        @keyframes enchant-pop { 0%,100% { transform: scale(1); } 50% { transform: scale(1.35); } }
        .enchant-success { border: 4px solid #34d399; box-shadow: 0 0 32px #34d399; animation: enchant-pop 0.6s ease-in-out infinite; }
        .enchant-glow-green { background: radial-gradient(circle, #065f46, #022c22); border: 2px solid #34d399; box-shadow: 0 0 40px #34d39988; animation: enchant-pop 0.6s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

interface PlayerRow {
  id: string;
  username: string;
  level: number;
  wins: number;
  expLeft: number;
  accent: string;
  isInMatch: boolean;
  stats?: FighterStats;
}

function PlayersPage() {
  const [config, setConfig] = useState<Awaited<ReturnType<typeof refreshConfig>> | null>(null);
  const [enchant, setEnchant] = useState<EnchantState | null>(null);
  const [starting, setStarting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    refreshConfig().then(setConfig);
  }, []);

  function norm(s?: FighterStats): FighterStats | undefined {
    if (!s) return s;
    return {
      ...s,
      speed: s.speed ?? 1,
      critChance: s.critChance ?? 0,
      allocated: { hp: 0, attack: 0, defense: 0, evasion: 0, accuracy: 0, speed: 0, crit: 0, ...(s.allocated || {}) },
    };
  }

  function handleAllocate(playerId: string, playerName: string, stat: StatKey) {
    if (enchant) return;
    const base = { playerName, stat };
    setEnchant(base);
    setTimeout(async () => {
      try {
        await allocatePoint(playerId, stat);
        await refreshConfig().then(setConfig);
        setToast(`¡+1 ${STAT_LABELS[stat]}!`);
      } catch (err) {
        setToast(err instanceof Error ? err.message : 'El servidor rechazó el intento');
      } finally {
        setTimeout(() => {
          setEnchant(null);
          setTimeout(() => setToast(null), 2500);
        }, 2000);
      }
    }, 1600);
  }

  async function handleStart() {
    setStarting(true);
    try {
      await startMatch();
      await refreshConfig().then(setConfig);
      setToast('Combate iniciado. El escenario OBS ya está mostrando la pelea.');
    } catch {
      setToast('No se pudo iniciar el combate');
    } finally {
      setStarting(false);
      setTimeout(() => setToast(null), 2500);
    }
  }

  async function handleSetSlot(slot: 'p1' | 'p2', playerId: string) {
    if (!config) return;
    const next = {
      p1: slot === 'p1' ? playerId : config.match.p1,
      p2: slot === 'p2' ? playerId : config.match.p2,
    };
    try {
      await setMatchPlayers(next.p1, next.p2);
      await refreshConfig().then(setConfig);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'No se pudo cambiar de peleador');
      setTimeout(() => setToast(null), 2500);
    }
  }

  if (!config) {
    return <div className="h-screen flex items-center justify-center text-white/40">Cargando…</div>;
  }

  const p1Id = config.match.p1 || 'local-p1';
  const p2Id = config.match.p2 || 'local-p2';
  const p1Rec = config.players?.[p1Id];
  const p2Rec = config.players?.[p2Id];
  const battles = config.session?.exp ?? {};
  const p1Stats = norm(p1Rec?.stats);
  const p2Stats = norm(p2Rec?.stats);

  const roster: PlayerRow[] = (Object.entries(config.players || {}) as [string, { username: string; stats?: FighterStats }][])
    .map(([id, p]) => ({
      id,
      username: p.username || id,
      level: p.stats?.level ?? 1,
      wins: p.stats?.wins ?? 0,
      expLeft: Math.max(0, SESSION_EXP_CAP - (battles[id] ?? 0)),
      accent: id === p1Id ? '#38BDF8' : id === p2Id ? '#FB7185' : '#94A3B8',
      isInMatch: id === p1Id || id === p2Id,
    }))
    .sort((a, b) => b.level - a.level || b.wins - a.wins);

  const p1Name = p1Rec?.username || config.p1?.name || 'Player 1';
  const p2Name = p2Rec?.username || config.p2?.name || 'Player 2';

  return (
    <div className="min-h-screen p-6 font-fighter">
      {enchant && <EnchantOverlay enchant={enchant} />}
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-wide flex items-center gap-3">
              <Trophy className="text-yellow-400" /> Jugadores
            </h1>
            <p className="text-white/40 text-sm mt-1">
              EXP y puntos se guardan en data/players.json · Los espectadores pueden retar con !retar en tu chat
            </p>
          </div>
          <button
            onClick={handleStart}
            disabled={starting || !p1Stats || !p2Stats}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 text-white font-bold shadow-lg shadow-emerald-500/30 hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            <Swords size={18} /> {starting ? 'Iniciando…' : 'Iniciar combate'}
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {p1Stats && (
            <PlayerCard
              id={p1Id}
              name={p1Name}
              stats={p1Stats}
              accent="#38BDF8"
              expLeft={Math.max(0, SESSION_EXP_CAP - (battles[p1Id] ?? 0))}
              onAllocate={(s) => handleAllocate(p1Id, p1Name, s)}
              disabled={enchant !== null}
            />
          )}
          {p2Stats && (
            <PlayerCard
              id={p2Id}
              name={p2Name}
              stats={p2Stats}
              accent="#FB7185"
              expLeft={Math.max(0, SESSION_EXP_CAP - (battles[p2Id] ?? 0))}
              onAllocate={(s) => handleAllocate(p2Id, p2Name, s)}
              disabled={enchant !== null}
            />
          )}
        </div>

        <div className="rounded-2xl bg-white/5 border border-white/10 overflow-hidden">
          <div className="flex items-center gap-2 px-6 py-4 border-b border-white/10">
            <Users size={16} className="text-white/50" />
            <h2 className="font-bold text-white tracking-wide">Liga — todos los jugadores</h2>
          </div>
          <div className="divide-y divide-white/5">
            {roster.map((row) => (
              <div key={row.id} className="flex items-center gap-4 px-6 py-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: `${row.accent}22`, color: row.accent }}>
                  {row.level}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-bold truncate">{row.username}</p>
                  <p className="text-white/40 text-xs">
                    Nv {row.level} · W:{row.wins} · ⚡ {row.expLeft}/{SESSION_EXP_CAP} EXP hoy
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleSetSlot('p1', row.id)}
                    disabled={row.isInMatch && row.id === p1Id || config.match.active}
                    className="px-3 py-1.5 rounded-lg bg-sky-500/20 text-sky-300 text-xs font-bold hover:bg-sky-500/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    → P1
                  </button>
                  <button
                    onClick={() => handleSetSlot('p2', row.id)}
                    disabled={row.isInMatch && row.id === p2Id || config.match.active}
                    className="px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 text-xs font-bold hover:bg-rose-500/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    → P2
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 text-white/30 text-sm">
          <Zap size={14} /> Cada punto de atributo SIEMPRE mejora un poquito el stat elegido: no hay dado, nadie pierde puntos a la suerte.
        </div>

        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-white/10 backdrop-blur border border-white/20 rounded-lg text-white text-sm shadow-xl">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<PlayersPage />);