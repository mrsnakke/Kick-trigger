import { useEffect, useState, useCallback, useRef } from 'react';
import { CharacterConfig, BackgroundMode, ViewLayout, FighterStats } from './types/fighter';
import {
  ASSET_MAID_CONFIG,
  generateMaidSpriteSheet,
} from './utils/defaultSprites';
import { FightArena } from './components/FightArena';
import { refreshConfig } from './utils/storage';
import { endMatch } from './utils/api';

const ENCHANT_LABELS: Record<string, { name: string; icon: string }> = {
  hp: { name: 'Vida', icon: '❤️' },
  attack: { name: 'Ataque', icon: '⚔️' },
  defense: { name: 'Defensa', icon: '🛡️' },
  evasion: { name: 'Evasión', icon: '💨' },
  accuracy: { name: 'Puntería', icon: '🎯' },
  crit: { name: 'Crítico', icon: '💥' },
};

function defaultP1(): CharacterConfig {
  return {
    ...ASSET_MAID_CONFIG,
    id: 'p1',
    name: 'Player 1',
    spriteUrl: generateMaidSpriteSheet('red'),
    isCustomImage: false,
  };
}

function defaultP2(): CharacterConfig {
  return {
    ...ASSET_MAID_CONFIG,
    id: 'p2',
    name: 'Player 2',
    spriteUrl: generateMaidSpriteSheet('blue'),
    isCustomImage: false,
    colorTheme: '#3B82F6',
  };
}

interface ArenaPlayer {
  id: string;
  name: string;
  stats?: FighterStats;
}

/**
 * Página principal para OBS: escenario limpio, sin paneles.
 * Los peleadores salen de `players[match.p1/p2]`; los sprites de p1/p2 (calibrable en /calibrate).
 */
export default function App() {
  const [p1Config, setP1Config] = useState<CharacterConfig | null>(null);
  const [p2Config, setP2Config] = useState<CharacterConfig | null>(null);
  const [p1Player, setP1Player] = useState<ArenaPlayer | null>(null);
  const [p2Player, setP2Player] = useState<ArenaPlayer | null>(null);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('transparent');
  const [viewLayout, setViewLayout] = useState<ViewLayout>('full-arena');
  const [isPaused, setIsPaused] = useState(false);
  const [gameSpeed, setGameSpeed] = useState(1);
  const [resetCount, setResetCount] = useState(0);
  const [isFightActive, setIsFightActive] = useState(false);
  const [enchantFx, setEnchantFx] = useState<{ playerName: string; stat: string; success: boolean } | null>(null);
  const lastEnchantAt = useRef(0);
  const enchantTimer = useRef<number | undefined>(undefined);

  const applyConfig = useCallback((cfg: Awaited<ReturnType<typeof refreshConfig>>) => {
    // Un config parcial (p.ej. {name:'X'}) no debe tumbar al personaje: se rellenan los campos que falten con los defaults.
    setP1Config(cfg.p1 ? { ...defaultP1(), ...cfg.p1 } : defaultP1());
    setP2Config(cfg.p2 ? { ...defaultP2(), ...cfg.p2 } : defaultP2());
    if (cfg.match) {
      setBackgroundMode(cfg.match.background || 'transparent');
      setViewLayout(cfg.match.layout || 'full-arena');
      setIsFightActive(!!cfg.match.active);

      const p1Rec = cfg.players?.[cfg.match.p1 || ''];
      const p2Rec = cfg.players?.[cfg.match.p2 || ''];
      setP1Player({
        id: cfg.match.p1 || (cfg.p1 ? 'local-p1' : ''),
        name: p1Rec?.username || cfg.p1?.name || 'Player 1',
        stats: p1Rec?.stats,
      });
      setP2Player({
        id: cfg.match.p2 || (cfg.p2 ? 'local-p2' : ''),
        name: p2Rec?.username || cfg.p2?.name || 'Player 2',
        stats: p2Rec?.stats,
      });

      // Broadcast a new enchant attempt (done from /players) into the OBS scene
      const en = cfg.match.enchant;
      if (en && en.at && en.at !== lastEnchantAt.current) {
        lastEnchantAt.current = en.at;
        setEnchantFx({
          playerName: cfg.players?.[en.player]?.username || 'Jugador',
          stat: en.stat,
          success: en.success,
        });
        window.clearTimeout(enchantTimer.current);
        enchantTimer.current = window.setTimeout(() => setEnchantFx(null), 3800);
      }
    }
  }, []);

  useEffect(() => {
    refreshConfig().then(applyConfig).catch(() => {
      setP1Config(defaultP1());
      setP2Config(defaultP2());
    });

    // ponytail: poll every 2s so the OBS scene reacts to /players remote control without reload
    const interval = setInterval(() => {
      refreshConfig().then(applyConfig).catch(() => {});
    }, 2000);

    return () => {
      clearInterval(interval);
      window.clearTimeout(enchantTimer.current);
    };
  }, [applyConfig]);

  const handleMatchEnd = useCallback((score: { p1: number; p2: number }) => {
    setIsFightActive(false);
    endMatch(score);
  }, []);

  const togglePause = useCallback(() => setIsPaused((p) => !p), []);
  const resetFight = useCallback(() => setResetCount((c) => c + 1), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePause();
      } else if (e.key.toLowerCase() === 'r') {
        resetFight();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePause, resetFight]);

  if (!p1Config || !p2Config) return null;

  const enchantInfo = enchantFx ? ENCHANT_LABELS[enchantFx.stat] : null;

  return (
    <div className="relative w-screen h-screen bg-transparent overflow-hidden select-none">
      {isFightActive ? (
        <FightArena
          player1Config={p1Config}
          player2Config={p2Config}
          player1Id={p1Player?.id ?? 'local-p1'}
          player2Id={p2Player?.id ?? 'local-p2'}
          player1Name={p1Player?.name}
          player2Name={p2Player?.name}
          player1Stats={p1Player?.stats}
          player2Stats={p2Player?.stats}
          backgroundMode={backgroundMode}
          viewLayout={viewLayout}
          isPaused={isPaused}
          gameSpeed={gameSpeed}
          showHitboxes={false}
          resetTrigger={resetCount}
          onMatchEnd={handleMatchEnd}
        />
      ) : null}

      {enchantFx && enchantInfo && (
        <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="relative flex items-center justify-center mb-4">
              <div className={`enchant-ring absolute w-40 h-40 rounded-full ${enchantFx.success ? 'enchant-success' : 'enchant-fail'}`} />
              <div className={`enchant-core w-28 h-28 rounded-full flex items-center justify-center text-6xl ${enchantFx.success ? 'enchant-glow-green' : 'enchant-glow-red'}`}>
                {enchantInfo.icon}
              </div>
            </div>
            <h2 className={`font-fighter text-3xl font-extrabold tracking-wide drop-shadow-[0_2px_6px_rgba(0,0,0,1)] ${enchantFx.success ? 'text-emerald-400' : 'text-red-400'}`}>
              {enchantFx.success ? '¡ENCANTAMIENTO EXITOSO!' : '¡ENCANTAMIENTO FALLIDO!'}
            </h2>
            <p className="text-white/90 mt-2 font-fighter text-xl drop-shadow-[0_2px_4px_rgba(0,0,0,1)]">
              {enchantFx.playerName} intentó mejorar {enchantInfo.name}
              {enchantFx.success ? '  (+1)' : '  (−1 punto)'}
            </p>
          </div>
          <style>{`
            @keyframes enchant-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            @keyframes enchant-pop { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); } }
            .enchant-success { border: 4px solid #34d399; box-shadow: 0 0 48px #34d399; animation: enchant-pop 0.6s ease-in-out infinite; }
            .enchant-fail { border: 4px solid #ef4444; box-shadow: 0 0 48px #ef4444; animation: enchant-pop 0.7s ease-in-out infinite; }
            .enchant-glow-green { background: radial-gradient(circle, #065f46, #022c22); border: 2px solid #34d399; box-shadow: 0 0 48px #34d39988; }
            .enchant-glow-red { background: radial-gradient(circle, #7f1d1d, #450a0a); border: 2px solid #ef4444; box-shadow: 0 0 48px #ef444488; }
          `}</style>
        </div>
      )}
    </div>
  );
}