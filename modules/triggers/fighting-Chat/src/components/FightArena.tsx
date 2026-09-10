import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  CharacterConfig,
  FighterEntity,
  FighterStats,
  HitEffect,
  BackgroundMode,
  ViewLayout,
} from '../types/fighter';
import { soundEngine } from '../utils/sound';
import {
  getFighterStats,
} from '../utils/storage';

interface FightArenaProps {
  player1Config: CharacterConfig;
  player2Config: CharacterConfig;
  player1Id: string;
  player2Id: string;
  player1Name?: string;
  player2Name?: string;
  player1Stats?: FighterStats;
  player2Stats?: FighterStats;
  backgroundMode: BackgroundMode;
  viewLayout: ViewLayout;
  isPaused: boolean;
  gameSpeed: number;
  showHitboxes: boolean;
  resetTrigger?: number;
  onMatchEnd?: (score: { p1: number; p2: number }) => void;
}

export const FightArena: React.FC<FightArenaProps> = ({
  player1Config,
  player2Config,
  player1Id,
  player2Id,
  player1Name,
  player2Name,
  player1Stats,
  player2Stats,
  backgroundMode,
  viewLayout,
  isPaused,
  gameSpeed,
  showHitboxes,
  resetTrigger,
  onMatchEnd,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Loaded image cache
  const imagesRef = useRef<Record<string, HTMLImageElement>>({});

  // Fighting State
  const [round, setRound] = useState(1);
  const [roundState, setRoundState] = useState<'intro' | 'fight' | 'ko' | 'resetting'>('intro');
  const [roundBanner, setRoundBanner] = useState<string>('ROUND 1');
  const [p1Hp, setP1Hp] = useState(180);
  const [p2Hp, setP2Hp] = useState(180);
  const [p1MaxHp, setP1MaxHp] = useState(180);
  const [p2MaxHp, setP2MaxHp] = useState(180);
  const [p1Energy, setP1Energy] = useState(0);
  const [p2Energy, setP2Energy] = useState(0);
  const [p1Combo, setP1Combo] = useState(0);
  const [p2Combo, setP2Combo] = useState(0);

  // Hit effects list
  const hitEffectsRef = useRef<HitEffect[]>([]);

  // Fighters state ref for 60fps loop
  const fightersRef = useRef<{ p1: FighterEntity; p2: FighterEntity } | null>(null);

  // Rounds won in THIS match (0-3). Ref, not state: survive stale closures so
  // initFighters/resetRound re-create fighters with the stars already earned.
  // ponytail: reset on remount (each match remounts FightArena), per-match pips only.
  const winsRef = useRef({ p1: 0, p2: 0 });

  // Screen shake ref
  const screenShakeRef = useRef(0);
  // Hit-stop freeze frames
  const hitStopRef = useRef(0);

  // Initialize Fighters
  const initFighters = useCallback(
    (width: number, groundY: number) => {
      const p1Stats = player1Config.stats || player1Stats || getFighterStats(player1Id);
      const p2Stats = player2Config.stats || player2Stats || getFighterStats(player2Id);
      const p1BaseHp = p1Stats.baseMaxHp || 180;
      const p2BaseHp = p2Stats.baseMaxHp || 180;

      const p1: FighterEntity = {
        id: 'p1',
        name: player1Name || player1Config.name,
        config: player1Config,
        x: width * 0.32,
        y: groundY,
        vx: 0,
        vy: 0,
        hp: p1BaseHp,
        maxHp: p1BaseHp,
        displayHp: p1BaseHp,
        energy: 0,
        maxEnergy: 100,
        facing: 1,
        currentAnim: 'intro',
        currentFrame: 0,
        frameTimer: 0,
        state: 'intro',
        stateTimer: 0,
        attackLanded: false,
        wins: winsRef.current.p1,
        roundHistory: [],
        comboCount: 0,
        isGrounded: true,
        stats: p1Stats,
      };

      const p2: FighterEntity = {
        id: 'p2',
        name: player2Name || player2Config.name,
        config: player2Config,
        x: width * 0.68,
        y: groundY,
        vx: 0,
        vy: 0,
        hp: p2BaseHp,
        maxHp: p2BaseHp,
        displayHp: p2BaseHp,
        energy: 0,
        maxEnergy: 100,
        facing: -1,
        currentAnim: 'intro',
        currentFrame: 0,
        frameTimer: 0,
        state: 'intro',
        stateTimer: 0,
        attackLanded: false,
        wins: winsRef.current.p2,
        roundHistory: [],
        comboCount: 0,
        isGrounded: true,
        stats: p2Stats,
      };

      fightersRef.current = { p1, p2 };
      setP1Hp(p1BaseHp);
      setP2Hp(p2BaseHp);
      setP1MaxHp(p1BaseHp);
      setP2MaxHp(p2BaseHp);
      setP1Energy(0);
      setP2Energy(0);
      setP1Combo(0);
      setP2Combo(0);
    },
    [player1Config, player2Config, player1Id, player2Id, player1Name, player2Name, player1Stats, player2Stats]
  );

  // Preload Images
  useEffect(() => {
    const loadImg = (id: string, url: string) => {
      if (!url) return;
      const img = new Image();
      img.src = url;
      img.onload = () => {
        imagesRef.current[id] = img;
      };
    };

    loadImg('p1', player1Config.spriteUrl);
    loadImg('p2', player2Config.spriteUrl);
  }, [player1Config.spriteUrl, player2Config.spriteUrl]);

  // Handle Round Reset
  const resetRound = useCallback((roundNo?: number) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const groundY = canvas.height * (viewLayout === 'bottom-stream' ? 0.94 : 0.88);
    initFighters(canvas.width, groundY);
    setRoundState('intro');
    setRoundBanner(`ROUND ${roundNo ?? round}`);
    soundEngine.playRoundBell();

    setTimeout(() => {
      setRoundBanner('FIGHT!');
      soundEngine.playWhoosh();
      setTimeout(() => {
        setRoundBanner('');
        setRoundState('fight');
        if (fightersRef.current) {
          fightersRef.current.p1.state = 'idle';
          fightersRef.current.p1.currentAnim = 'idle';
          fightersRef.current.p1.currentFrame = 0;
          fightersRef.current.p2.state = 'idle';
          fightersRef.current.p2.currentAnim = 'idle';
          fightersRef.current.p2.currentFrame = 0;
        }
      }, 1000);
    }, 1500);
  }, [round, viewLayout, initFighters]);

  // Setup Initial Canvas Size & Fighters
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current || !canvasRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const canvas = canvasRef.current;
      canvas.width = Math.floor(rect.width);
      canvas.height = Math.floor(rect.height);
      const groundY = canvas.height * (viewLayout === 'bottom-stream' ? 0.94 : 0.88);
      initFighters(canvas.width, groundY);
    };

    handleResize();
    const observer = new ResizeObserver(handleResize);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    resetRound();

    return () => observer.disconnect();
  }, [viewLayout]);

  // Update fighter configs if props change
  useEffect(() => {
    if (fightersRef.current) {
      fightersRef.current.p1.config = player1Config;
      fightersRef.current.p2.config = player2Config;
    }
  }, [player1Config, player2Config]);

  // Reset Fight on demand via trigger
  useEffect(() => {
    if (resetTrigger && resetTrigger > 0) {
      resetRound();
    }
  }, [resetTrigger, resetRound]);

  // Main 60FPS Game Loop
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const loop = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1) * gameSpeed;
      lastTime = now;

      if (!isPaused && canvasRef.current) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          updateGame(dt, canvas.width, canvas.height);
          renderGame(ctx, canvas.width, canvas.height);
        }
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPaused, gameSpeed, roundState, backgroundMode, viewLayout, showHitboxes]);

  // Combat & AI update step
  const updateGame = (dt: number, width: number, height: number) => {
    if (!fightersRef.current) return;
    const { p1, p2 } = fightersRef.current;
    const groundY = height * (viewLayout === 'bottom-stream' ? 0.94 : 0.88);

    // Hit-stop freeze frames
    if (hitStopRef.current > 0) {
      hitStopRef.current -= dt;
      return;
    }

    // Screen shake decay
    if (screenShakeRef.current > 0) {
      screenShakeRef.current = Math.max(0, screenShakeRef.current - dt * 25);
    }

    // Facing direction
    if (p1.state !== 'ko' && p2.state !== 'ko') {
      p1.facing = p1.x < p2.x ? 1 : -1;
      p2.facing = p2.x < p1.x ? 1 : -1;
    }

    // Ground pushbox: prevent fighters from phasing through each other
    if (p1.isGrounded && p2.isGrounded && p1.state !== 'ko' && p2.state !== 'ko') {
      const minDistance = Math.max(
        50,
        (p1.config.frameWidth * (p1.config.scale || 1.2) * 0.4) +
        (p2.config.frameWidth * (p2.config.scale || 1.2) * 0.4)
      );
      const currentDist = p2.x - p1.x;
      if (Math.abs(currentDist) < minDistance) {
        const overlap = (minDistance - Math.abs(currentDist)) / 2;
        if (currentDist >= 0) {
          p1.x = Math.max(40, p1.x - overlap);
          p2.x = Math.min(width - 40, p2.x + overlap);
        } else {
          p1.x = Math.min(width - 40, p1.x + overlap);
          p2.x = Math.max(40, p2.x - overlap);
        }
      }
    }

    // Update individual fighters
    [p1, p2].forEach((fighter) => {
      const opponent = fighter.id === 'p1' ? p2 : p1;
      updateFighter(fighter, opponent, dt, width, groundY);
    });

    // Update Hit Effects
    hitEffectsRef.current = hitEffectsRef.current.filter((effect) => {
      const age = (performance.now() - effect.createdAt) / 1000;
      return age < effect.duration;
    });

    // Smooth HP catching bar
    if (p1.displayHp > p1.hp) {
      p1.displayHp = Math.max(p1.hp, p1.displayHp - dt * 25);
    }
    if (p2.displayHp > p2.hp) {
      p2.displayHp = Math.max(p2.hp, p2.displayHp - dt * 25);
    }

    // Check K.O.
    if (roundState === 'fight') {
      if ((p1.hp <= 0 || p2.hp <= 0) && p1.state !== 'ko' && p2.state !== 'ko') {
        setRoundState('ko');
        soundEngine.playKO();
        screenShakeRef.current = 14;

        if (p1.hp <= 0 && p2.hp > 0) {
          p1.state = 'ko';
          p1.currentAnim = p1.config.animations.fail ? 'fail' : (p1.config.animations.fall ? 'fall' : 'ko');
          p1.currentFrame = 0;
          p2.state = 'victory';
          p2.currentAnim = p2.config.animations.victory ? 'victory' : (p2.config.animations.dance ? 'dance' : 'idle');
          p2.currentFrame = 0;

          const updatedWins = (winsRef.current.p2 += 1);
          p2.wins = updatedWins;

          // Winner stats (W/L/EXP) los aplica el server en /api/end — aquí solo lo visual.
          p2.roundHistory.push('w');
          p1.roundHistory.push('l');

          setTimeout(() => soundEngine.playVictory(), 600);

          if (updatedWins >= 3) {
            // Match Won by P2!
            setRoundBanner(`🏆 ¡${(player2Name || p2.config.name).toUpperCase()} CAMPEÓN DEL MATCH! (3 VICTORIAS) 🏆`);

            setTimeout(() => {
              setRoundBanner('');
              onMatchEnd?.({ p1: winsRef.current.p1, p2: winsRef.current.p2 });
            }, 5500);
          } else {
            setRoundBanner(`K.O. - ${(player2Name || p2.config.name).toUpperCase()} GANA EL ROUND! (${updatedWins}/3)`);
            setTimeout(() => {
              setRound((r) => r + 1);
              resetRound(round + 1);
            }, 4000);
          }
        } else if (p2.hp <= 0 && p1.hp > 0) {
          p2.state = 'ko';
          p2.currentAnim = p2.config.animations.fail ? 'fail' : (p2.config.animations.fall ? 'fall' : 'ko');
          p2.currentFrame = 0;
          p1.state = 'victory';
          p1.currentAnim = p1.config.animations.victory ? 'victory' : (p1.config.animations.dance ? 'dance' : 'idle');
          p1.currentFrame = 0;

          const updatedWins = (winsRef.current.p1 += 1);
          p1.wins = updatedWins;

          // Winner stats (W/L/EXP) los aplica el server en /api/end — aquí solo lo visual.
          p1.roundHistory.push('w');
          p2.roundHistory.push('l');

          setTimeout(() => soundEngine.playVictory(), 600);

          if (updatedWins >= 3) {
            // Match Won by P1!
            setRoundBanner(`🏆 ¡${(player1Name || p1.config.name).toUpperCase()} CAMPEÓN DEL MATCH! (3 VICTORIAS) 🏆`);

            setTimeout(() => {
              setRoundBanner('');
              onMatchEnd?.({ p1: winsRef.current.p1, p2: winsRef.current.p2 });
            }, 5500);
          } else {
            setRoundBanner(`K.O. - ${(player1Name || p1.config.name).toUpperCase()} GANA EL ROUND! (${updatedWins}/3)`);
            setTimeout(() => {
              setRound((r) => r + 1);
              resetRound(round + 1);
            }, 4000);
          }
        } else {
          p1.state = 'ko';
          p2.state = 'ko';
          p1.roundHistory.push('l');
          p2.roundHistory.push('l');
          setRoundBanner('¡DOUBLE K.O.!');
          setTimeout(() => {
            setRound((r) => r + 1);
            resetRound(round + 1);
          }, 4000);
        }
      }
    }
  };

  // Fighter State Machine & Autonomous AI
  const updateFighter = (
    fighter: FighterEntity,
    opponent: FighterEntity,
    dt: number,
    stageWidth: number,
    groundY: number
  ) => {
    fighter.stateTimer += dt;
    if (fighter.skillCooldown && fighter.skillCooldown > 0) {
      fighter.skillCooldown -= dt;
    }
    if (fighter.guardTimer && fighter.guardTimer > 0) {
      fighter.guardTimer -= dt;
      if (fighter.guardTimer <= 0 && fighter.state === 'guarding') {
        fighter.state = 'idle';
        fighter.currentAnim = 'idle';
        fighter.currentFrame = 0;
      }
    }

    // Animation frame advancement
    const animConfig = fighter.config.animations[fighter.currentAnim] || fighter.config.animations.idle;
    const fps = animConfig.fps || 10;
    const frameInterval = 1 / fps;

    fighter.frameTimer += dt;
    if (fighter.frameTimer >= frameInterval) {
      fighter.frameTimer -= frameInterval;
      if (fighter.currentFrame < animConfig.frameCount - 1) {
        fighter.currentFrame++;
      } else {
        if (animConfig.loop) {
          fighter.currentFrame = 0;
        } else {
          // Non-looping animation finished
          if (fighter.state === 'attacking') {
            fighter.state = 'idle';
            fighter.currentAnim = 'idle';
            fighter.currentFrame = 0;
            fighter.attackLanded = false;
          } else if (fighter.state === 'skill') {
            fighter.state = 'idle';
            fighter.currentAnim = 'idle';
            fighter.currentFrame = 0;
            fighter.skillTriggered = false;
          } else if (fighter.state === 'hit') {
            fighter.state = 'idle';
            fighter.currentAnim = 'idle';
            fighter.currentFrame = 0;
          } else if (fighter.state === 'fall') {
            if (fighter.hp > 0 && fighter.config.animations.get_up) {
              fighter.state = 'get_up';
              fighter.currentAnim = 'get_up';
              fighter.currentFrame = 0;
            } else if (fighter.hp > 0) {
              fighter.state = 'idle';
              fighter.currentAnim = 'idle';
              fighter.currentFrame = 0;
            }
          } else if (fighter.state === 'get_up') {
            fighter.state = 'idle';
            fighter.currentAnim = 'idle';
            fighter.currentFrame = 0;
          } else if (fighter.state === 'crouching') {
            fighter.state = 'idle';
            fighter.currentAnim = 'idle';
            fighter.currentFrame = 0;
          }
        }
      }
    }

    // Physics (Gravity & Movement)
    if (!fighter.isGrounded) {
      fighter.vy += 850 * dt; // gravity
      fighter.y += fighter.vy * dt;
      if (fighter.y >= groundY) {
        fighter.y = groundY;
        fighter.vy = 0;
        fighter.isGrounded = true;
        if (fighter.state === 'jumping') {
          fighter.state = 'idle';
          fighter.currentAnim = 'idle';
          fighter.currentFrame = 0;
        }
      }
    }

    fighter.x += fighter.vx * dt;

    // Arena boundary clamps
    const margin = 40;
    fighter.x = Math.max(margin, Math.min(stageWidth - margin, fighter.x));

    // Continuous locomotion & smooth velocity interpolation
    const walkSpeed = Math.max(80, (fighter.config.speed || 10) * 15);
    if (fighter.state === 'approaching') {
      // Maintain smooth continuous forward walk speed
      const targetVx = fighter.facing * walkSpeed;
      fighter.vx += (targetVx - fighter.vx) * Math.min(1, 14 * dt);
    } else if (fighter.state === 'retreating') {
      // Maintain smooth continuous backward walk speed
      const targetVx = -fighter.facing * (walkSpeed * 0.72);
      fighter.vx += (targetVx - fighter.vx) * Math.min(1, 14 * dt);
    } else if (fighter.state === 'idle' || fighter.state === 'guarding' || fighter.state === 'crouching') {
      // Smooth deceleration to stop naturally
      fighter.vx *= Math.pow(0.005, dt * 5);
    } else if (fighter.state === 'attacking') {
      // Attack forward steps glide smoothly and settle
      fighter.vx *= Math.pow(0.08, dt * 4);
    } else if (fighter.state !== 'hit' && fighter.state !== 'fall') {
      // Air movement damping
      fighter.vx *= 0.94;
    }

    // Check Attack Collisions (Only attacks, NEVER jump)
    if (fighter.state === 'attacking') {
      const hitFrame = animConfig.attackFrame ?? Math.floor(animConfig.frameCount / 2);
      if (
        fighter.currentFrame >= hitFrame &&
        !fighter.attackLanded &&
        opponent.state !== 'ko' &&
        opponent.state !== 'fall' &&
        opponent.state !== 'skill'
      ) {
        // Distance check: Half of attacker + half of defender + attack reach bonus
        const dist = Math.abs(fighter.x - opponent.x);
        const fScale = fighter.config.scale || 1.2;
        const oScale = opponent.config.scale || 1.2;
        const baseReach = (fighter.config.frameWidth * fScale * 0.45) +
                          (opponent.config.frameWidth * oScale * 0.45);

        let attackReachBonus = 40; // light rapid jab
        if (fighter.activeAttackType === 'heavy') attackReachBonus = 70; // heavy kick/lunge
        else if (fighter.activeAttackType === 'low') attackReachBonus = 48; // low sweep
        else if (fighter.activeAttackType === 'finish') attackReachBonus = 85; // finisher

        const reach = baseReach + attackReachBonus;

        if (dist <= reach) {
          fighter.attackLanded = true;
          const baseDamage = animConfig.damage || (
            fighter.activeAttackType === 'heavy' ? 22 :
            fighter.activeAttackType === 'low' ? 14 :
            fighter.activeAttackType === 'finish' ? 30 : 10
          );
          const isGuarding = opponent.state === 'guarding' || opponent.currentAnim === 'guard';

          // Leveled stats: attacker accuracy vs defender evasion
          const missChance = Math.max(0, (opponent.stats?.evasion || 0) - (1 - (fighter.stats?.accuracy || 0.94)));
          const dodged = !isGuarding && Math.random() < missChance;

          if (dodged) {
            hitEffectsRef.current.push({
              id: `dodge-${Date.now()}-${Math.random()}`,
              x: (fighter.x + opponent.x) / 2,
              y: opponent.y - 65,
              text: '¡ESQUIVÓ!',
              type: 'shield',
              size: 32,
              color: '#38BDF8',
              createdAt: performance.now(),
              duration: 0.6,
            });
          } else {
            // Damage scaled by attacker attackPower, reduced by defender defense
            const scaled = Math.round(baseDamage * (fighter.stats?.attackPower || 1) * (1 - (opponent.stats?.defense || 0)));
            const isCrit = !isGuarding && Math.random() < (fighter.stats?.critChance ?? 0);
            const damage = isGuarding ? Math.max(2, Math.round(scaled * 0.25)) : Math.round(scaled * (isCrit ? 1.5 : 1));
            opponent.hp = Math.max(0, opponent.hp - damage);
            if (opponent.id === 'p1') setP1Hp(opponent.hp);
            if (opponent.id === 'p2') setP2Hp(opponent.hp);

            // Energy (ultimate meter): attacker gains when landing, defender gains when tanking
            const energyGain = fighter.activeAttackType === 'rapid' ? 8 :
              fighter.activeAttackType === 'low' ? 10 :
              fighter.activeAttackType === 'heavy' ? 14 :
              fighter.activeAttackType === 'finish' ? 20 : 8;
            fighter.energy = Math.min(fighter.maxEnergy, fighter.energy + energyGain);
            opponent.energy = Math.min(opponent.maxEnergy, opponent.energy + 6);

            if (!isGuarding) {
              fighter.comboCount++;
              if (fighter.id === 'p1') setP1Combo(fighter.comboCount);
              if (fighter.id === 'p2') setP2Combo(fighter.comboCount);

              // Knockdown if heavy or finish combo
              if (fighter.activeAttackType === 'heavy' || fighter.activeAttackType === 'finish') {
                opponent.state = 'fall';
                opponent.currentAnim = opponent.config.animations.fall ? 'fall' : 'hit';
                opponent.currentFrame = 0;
                opponent.vx = fighter.facing * 240;
                hitStopRef.current = 0.09;
                screenShakeRef.current = 12;
                soundEngine.playHit('heavy');
              } else {
                opponent.state = 'hit';
                opponent.currentAnim = opponent.config.animations.hit ? 'hit' : 'hit';
                opponent.currentFrame = 0;
                opponent.vx = fighter.facing * 160;
                hitStopRef.current = 0.05;
                screenShakeRef.current = 6;
                soundEngine.playHit('light');
              }

              opponent.comboCount = 0;
              if (opponent.id === 'p1') setP1Combo(0);
              if (opponent.id === 'p2') setP2Combo(0);
            } else {
              // Guard Blocked!
              opponent.vx = fighter.facing * 70;
              hitStopRef.current = 0.04;
              screenShakeRef.current = 3;
              soundEngine.playHit('light');
            }

            // Spawn Hit Effect
            const hitX = (fighter.x + opponent.x) / 2;
            const hitY = opponent.y - 65;
            hitEffectsRef.current.push({
              id: `hit-${Date.now()}-${Math.random()}`,
              x: hitX,
              y: hitY,
              text: isCrit ? `💥 ¡CRÍTICO! -${damage}` : isGuarding ? `🛡️ -${damage}` : `-${damage}`,
              type: isCrit || !isGuarding && (fighter.activeAttackType === 'heavy' || fighter.activeAttackType === 'finish')
                ? 'crit'
                : 'slash',
              size: isCrit ? 42 : 32,
              color: isCrit ? '#FACC15' : isGuarding ? '#38BDF8' : fighter.config.colorTheme,
              createdAt: performance.now(),
              duration: 0.55,
            });
          }
        }
      }
    }

    // Handle Skill Activation (habilidad: cura al personaje un 30% de su vida máxima; los ataques
    // enemigos no lo bloquean mientras dura la animación — invencible durante el skill)
    if (fighter.state === 'skill') {
      const animConfig = fighter.config.animations[fighter.currentAnim] || fighter.config.animations.skill;
      const totalFrames = animConfig?.frameCount || 6;
      const hitFrame = Math.min(2, totalFrames - 1);

      if (fighter.currentFrame >= hitFrame && !fighter.skillTriggered) {
        fighter.skillTriggered = true;

        const heal = Math.round((fighter.stats?.baseMaxHp || fighter.maxHp) * 0.10);
        const before = fighter.hp;
        fighter.hp = Math.min(fighter.maxHp, fighter.hp + heal);
        if (fighter.id === 'p1') setP1Hp(fighter.hp);
        if (fighter.id === 'p2') setP2Hp(fighter.hp);

        const healed = fighter.hp - before;
        hitEffectsRef.current.push({
          id: `heal-${Date.now()}-${Math.random()}`,
          x: fighter.x,
          y: fighter.y - 110,
          text: `💚 +${healed > 0 ? healed : '…'} CURA!`,
          type: 'shield',
          size: 40,
          color: '#34D399',
          createdAt: performance.now(),
          duration: 1.0,
        });

        fighter.energy = 0; // consume ultimate meter
        fighter.skillCooldown = 9;
      }
    }

    // AUTONOMOUS FIGHTING AI
    if (
      roundState !== 'fight' ||
      fighter.state === 'hit' ||
      fighter.state === 'fall' ||
      fighter.state === 'get_up' ||
      fighter.state === 'ko' ||
      fighter.state === 'victory' ||
      fighter.state === 'skill'
    ) {
      return;
    }

    const dist = Math.abs(fighter.x - opponent.x);
    const speed = fighter.config.speed * 20;

    // React to opponent attack: chance to raise guard!
    if (
      opponent.state === 'attacking' &&
      dist < (opponent.config.frameWidth * opponent.config.scale * 0.9) &&
      fighter.state !== 'guarding' &&
      Math.random() < 0.35 &&
      fighter.config.animations.guard
    ) {
      fighter.state = 'guarding';
      fighter.currentAnim = 'guard';
      fighter.currentFrame = 0;
      fighter.guardTimer = 0.7;
      fighter.vx = 0;
      return;
    }

    // State Decision Logic
    if (
      fighter.state === 'idle' ||
      fighter.state === 'approaching' ||
      fighter.state === 'retreating' ||
      fighter.state === 'crouching'
    ) {
      // Dynamic strike range based on character sizes
      const fScale = fighter.config.scale || 1.2;
      const oScale = opponent.config.scale || 1.2;
      const bodySpacing = (fighter.config.frameWidth * fScale * 0.45) + (opponent.config.frameWidth * oScale * 0.45);
      const strikeRange = bodySpacing + 42; // ~145-165px
      const maxRange = strikeRange + 90;    // ~235-255px

      // Decision trigger: walk continuously until in range, retreat for full step, or idle breath pause
      const canDecide =
        (fighter.state === 'idle' && fighter.stateTimer > (0.2 + Math.random() * 0.15)) ||
        (fighter.state === 'crouching' && fighter.stateTimer > 0.4) ||
        (fighter.state === 'retreating' && (fighter.stateTimer > 0.5 || fighter.x <= 50 || fighter.x >= stageWidth - 50)) ||
        (fighter.state === 'approaching' && (dist <= strikeRange || fighter.stateTimer > 1.4));

      if (canDecide) {
        fighter.stateTimer = 0;
        const roll = Math.random();

        // Skill: when the bar (below HP) is full and cooldown is ready, heals 30% max HP.
        // Only fires if the fighter actually needs to heal (no point burning it at full HP).
        if (
          fighter.energy >= fighter.maxEnergy &&
          (!fighter.skillCooldown || fighter.skillCooldown <= 0) &&
          fighter.hp < (fighter.stats?.baseMaxHp || fighter.maxHp) * 0.9 &&
          roll < 0.75
        ) {
          fighter.state = 'skill';
          fighter.currentAnim = fighter.config.animations.finish
            ? 'finish'
            : fighter.config.animations.skill
            ? 'skill'
            : 'attack_heavy';
          fighter.currentFrame = 0;
          fighter.attackLanded = false;
          fighter.skillTriggered = false;
          fighter.vx = 0;
          soundEngine.playWhoosh();
          return;
        }

        if (dist > strikeRange) {
          // Outside strike range: approach smoothly to close distance!
          if (roll < 0.2 && dist > strikeRange + 50) {
            // Evasive Jump forward
            fighter.state = 'jumping';
            fighter.currentAnim = 'jump';
            fighter.currentFrame = 0;
            fighter.vy = -340;
            fighter.vx = fighter.facing * (speed * 0.7);
            fighter.isGrounded = false;
            fighter.activeAttackType = undefined;
            fighter.attackLanded = false;
            soundEngine.playJump();
          } else {
            // Continuous forward walk
            fighter.state = 'approaching';
            if (fighter.currentAnim !== 'walk') {
              fighter.currentAnim = 'walk';
              fighter.currentFrame = 0;
              fighter.frameTimer = 0;
            }
          }
        } else {
          // Inside strike range! Execute attacks or tactical footsies
          if (roll < 0.38) {
            // AtkRap (Ataque rápido mopa) - Light attack
            fighter.state = 'attacking';
            fighter.currentAnim = fighter.config.animations.attack_rapid ? 'attack_rapid' : 'attack';
            fighter.currentFrame = 0;
            fighter.attackLanded = false;
            fighter.activeAttackType = 'rapid';
            fighter.vx = fighter.facing * (speed * 0.32); // Light forward step
            soundEngine.playWhoosh();
          } else if (roll < 0.68) {
            // AtkFte (Ataque fuerte patada ígnea) - Heavy attack
            fighter.state = 'attacking';
            fighter.currentAnim = fighter.config.animations.attack_heavy ? 'attack_heavy' : (fighter.config.animations.attack ? 'attack' : 'idle');
            fighter.currentFrame = 0;
            fighter.attackLanded = false;
            fighter.activeAttackType = 'heavy';
            fighter.vx = fighter.facing * (speed * 0.52); // Forward lunge
            soundEngine.playWhoosh();
          } else if (roll < 0.82) {
            // AtkBjo (Ataque bajo barrido) - Low attack
            fighter.state = 'attacking';
            fighter.currentAnim = fighter.config.animations.attack_low ? 'attack_low' : (fighter.config.animations.attack ? 'attack' : 'idle');
            fighter.currentFrame = 0;
            fighter.attackLanded = false;
            fighter.activeAttackType = 'low';
            fighter.vx = fighter.facing * (speed * 0.28);
            soundEngine.playWhoosh();
          } else if (roll < 0.90) {
            // Finish (Super combo remate)
            fighter.state = 'attacking';
            fighter.currentAnim = fighter.config.animations.finish
              ? 'finish'
              : fighter.config.animations.attack_heavy
              ? 'attack_heavy'
              : 'attack';
            fighter.currentFrame = 0;
            fighter.attackLanded = false;
            fighter.activeAttackType = 'finish';
            fighter.vx = fighter.facing * (speed * 0.45);
            soundEngine.playWhoosh();
          } else {
            // Tactical retreat step
            fighter.state = 'retreating';
            if (fighter.currentAnim !== 'walk') {
              fighter.currentAnim = 'walk';
              fighter.currentFrame = 0;
              fighter.frameTimer = 0;
            }
          }
        }
      }
    }
  };

  // Rendering graphics engine
  const renderGame = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.save();

    // Clear Canvas
    ctx.clearRect(0, 0, width, height);

    // Render background if not transparent
    if (backgroundMode === 'green') {
      ctx.fillStyle = '#00FF00';
      ctx.fillRect(0, 0, width, height);
    } else if (backgroundMode === 'magenta') {
      ctx.fillStyle = '#FF00FF';
      ctx.fillRect(0, 0, width, height);
    } else if (backgroundMode === 'stage-dark') {
      // Dark cyber stage
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, '#0F172A');
      grad.addColorStop(0.75, '#1E293B');
      grad.addColorStop(1, '#0B0F19');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Floor line
      const groundY = height * (viewLayout === 'bottom-stream' ? 0.94 : 0.88);
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(width, groundY);
      ctx.stroke();

      // Neon grid floor lines
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.15)';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 60) {
        ctx.beginPath();
        ctx.moveTo(x, groundY);
        ctx.lineTo(x + (x - width / 2) * 0.4, height);
        ctx.stroke();
      }
    } else if (backgroundMode === 'stage-dojo') {
      // Midnight Dojo Stage
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, '#1a0d24');
      grad.addColorStop(0.7, '#2d153b');
      grad.addColorStop(1, '#110917');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Full Moon
      ctx.fillStyle = 'rgba(255, 230, 180, 0.2)';
      ctx.beginPath();
      ctx.arc(width * 0.5, height * 0.35, 70, 0, Math.PI * 2);
      ctx.fill();

      // Floor
      const groundY = height * (viewLayout === 'bottom-stream' ? 0.94 : 0.88);
      ctx.fillStyle = '#1e1424';
      ctx.fillRect(0, groundY, width, height - groundY);
      ctx.strokeStyle = 'rgba(234, 179, 8, 0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(width, groundY);
      ctx.stroke();
    }

    // Screen Shake effect on impact
    if (screenShakeRef.current > 0) {
      const shakeX = (Math.random() - 0.5) * screenShakeRef.current;
      const shakeY = (Math.random() - 0.5) * screenShakeRef.current;
      ctx.translate(shakeX, shakeY);
    }

    // Render Ground Shadows & Fighters
    if (fightersRef.current) {
      const { p1, p2 } = fightersRef.current;

      // Draw P1
      renderFighter(ctx, p1, imagesRef.current['p1']);
      renderFighterHud(ctx, p1);
      // Draw P2
      renderFighter(ctx, p2, imagesRef.current['p2']);
      renderFighterHud(ctx, p2);
    }

    // Render Hit Effects & Slash Trails
    renderHitEffects(ctx);

    ctx.restore();
  };

  // Render HUD above fighter's head: HP bar + skill (ultimate) bar + win pips
  const renderFighterHud = (
    ctx: CanvasRenderingContext2D,
    fighter: FighterEntity
  ) => {
    const config = fighter.config;
    const frameWidth = config.frameWidth || 128;
    const frameHeight = config.frameHeight || 128;
    const scale = config.scale || 1.2;
    const drawW = frameWidth * scale;
    const drawH = frameHeight * scale;

    const headTop = fighter.y - drawH * (config.originY ?? 0.95);

    const barW = Math.round(drawW * 1.05);
    const barH = 9;
    const barX = Math.round(fighter.x - barW / 2);
    const barY = headTop - barH - 30;
    const radius = 5;

    if (barY < 2 || barY > fighter.y - 4) return;

    const hpRatio = Math.max(0, Math.min(1, fighter.hp / fighter.maxHp));
    const energyRatio = Math.max(0, Math.min(1, fighter.energy / fighter.maxEnergy));
    const isP1 = fighter.id === 'p1';
    const accent = isP1 ? '#38BDF8' : '#FB7185';

    ctx.save();

    // Player name above bar (big & bold with outline for readability)
    const lvl = fighter.stats?.level ?? 0;
    const displayName = `NV.${String(lvl).padStart(3, '0')} ${fighter.name || (isP1 ? 'Player 1' : 'Player 2')}`;
    ctx.textAlign = 'center';
    ctx.font = 'bold 17px "Segoe UI", "Chakra Petch", monospace';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.strokeText(displayName.toUpperCase(), fighter.x, barY - 6);
    ctx.fillStyle = isP1 ? '#7DD3FC' : '#FDA4AF';
    ctx.fillText(displayName.toUpperCase(), fighter.x, barY - 6);

    // Backdrop with rounded rect
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    roundRect(ctx, barX - 4, barY - 4, barW + 8, barH + 8, 6);
    ctx.fill();

    // HP bar background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    roundRect(ctx, barX, barY, barW, barH, radius);
    ctx.fill();

    // Delayed damage trail (yellow)
    const displayLedger = Math.max(fighter.hp, fighter.displayHp);
    const ledgerRatio = Math.max(0, Math.min(1, displayLedger / fighter.maxHp));
    const ledgerW = Math.round(barW * ledgerRatio);
    if (ledgerW > 0) {
      ctx.fillStyle = 'rgba(234, 179, 8, 0.85)';
      if (isP1) roundRectClip(ctx, barX + barW - ledgerW, barY, ledgerW, barH, radius);
      else roundRectClip(ctx, barX, barY, ledgerW, barH, radius);
      ctx.fill();
    }

    // Active HP
    const hpW = Math.round(barW * hpRatio);
    if (hpW > 0) {
      ctx.fillStyle = accent;
      if (isP1) roundRectClip(ctx, barX + barW - hpW, barY, hpW, barH, radius);
      else roundRectClip(ctx, barX, barY, hpW, barH, radius);
      ctx.fill();
    }

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    roundRect(ctx, barX, barY, barW, barH, radius);
    ctx.stroke();

    // Skill / Ultimate bar
    const skillH = 4;
    const skillY = barY + barH + 3;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    roundRect(ctx, barX - 2, skillY - 1, barW + 4, skillH + 2, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    roundRect(ctx, barX, skillY, barW, skillH, 2);
    ctx.fill();
    const skillColor = energyRatio >= 1 ? '#F59E0B' : '#22C55E';
    const skillW = Math.round(barW * energyRatio);
    if (skillW > 0) {
      ctx.fillStyle = skillColor;
      roundRect(ctx, barX, skillY, skillW, skillH, 2);
      ctx.fill();
    }

    // Win stars (bigger) + lifetime W/L below
    const starSize = 12;
    const pipsY = skillY + skillH + 8;
    for (let i = 0; i < 3; i++) {
      const cx = barX + starSize / 2 + 2 + i * (starSize + 6);
      const earned = fighter.wins > i;
      drawStar(ctx, cx, pipsY + starSize / 2, starSize / 2, earned ? '#FACC15' : 'rgba(255,255,255,0.15)', earned ? '#FDE047' : 'rgba(255,255,255,0.3)');
    }

    // Lifetime W/L text
    ctx.font = 'bold 12px "Segoe UI", monospace';
    ctx.textAlign = 'left';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    const wlText = `W:${fighter.stats?.wins ?? 0} L:${fighter.stats?.losses ?? 0}`;
    ctx.strokeText(wlText, barX + 3 * (starSize + 6) + 6, pipsY + starSize);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(wlText, barX + 3 * (starSize + 6) + 6, pipsY + starSize);

    // Per-round result dots: green for won round, red for lost
    const roundDots = (fighter.roundHistory ?? []).slice(0, 3);
    const dotSize = 7;
    const dotY = pipsY + starSize + 9;
    roundDots.forEach((r, i) => {
      const dx = barX + i * (dotSize + 5);
      ctx.beginPath();
      ctx.arc(dx + dotSize / 2, dotY, dotSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = r === 'w' ? '#22C55E' : '#EF4444';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    ctx.restore();
  };

  function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, stroke: string) {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const outer = { x: cx + r * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / 5), y: cy + r * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / 5) };
      const inner = { x: cx + r * 0.5 * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI + Math.PI) / 5), y: cy + r * 0.5 * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI + Math.PI) / 5) };
      if (i === 0) ctx.moveTo(outer.x, outer.y);
      else ctx.lineTo(outer.x, outer.y);
      ctx.lineTo(inner.x, inner.y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ponytail: helper to draw rounded rects on canvas, canvas API roundRect not universally supported
  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function roundRectClip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // Render individual fighter from sprite sheet
  const renderFighter = (
    ctx: CanvasRenderingContext2D,
    fighter: FighterEntity,
    spriteImg?: HTMLImageElement
  ) => {
    const config = fighter.config;
    const animConfig = config.animations[fighter.currentAnim] || config.animations.idle;

    const frameWidth = config.frameWidth || 128;
    const frameHeight = config.frameHeight || 128;
    const scale = config.scale || 1.2;
    const drawW = frameWidth * scale;
    const drawH = frameHeight * scale;

    const maxFrames = Math.max(1, animConfig.frameCount);
    const safeCol = fighter.currentFrame % maxFrames;
    const frameCol = (animConfig.startFrame ?? 0) + safeCol;
    const frameRow = animConfig.row ?? 0;

    ctx.save();
    ctx.translate(Math.round(fighter.x), Math.round(fighter.y));

    // Ground contact shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 32 * scale, 9 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Flip horizontal based on facing direction
    if (fighter.facing === -1) {
      ctx.scale(-1, 1);
    }

    // Draw Sprite Slice
    if (spriteImg && spriteImg.complete && spriteImg.naturalWidth > 0) {
      const animOffsetX = animConfig.offsetX ?? 0;
      const animOffsetY = animConfig.offsetY ?? 0;
      const sx = Math.max(0, frameCol * frameWidth + animOffsetX);
      const sy = Math.max(0, frameRow * frameHeight + animOffsetY);

      // Crisp pixel art
      ctx.imageSmoothingEnabled = false;

      ctx.drawImage(
        spriteImg,
        sx,
        sy,
        frameWidth,
        frameHeight,
        -drawW * (config.originX ?? 0.5),
        -drawH * (config.originY ?? 0.95),
        drawW,
        drawH
      );
    }

    // Guard Energy Shield Barrier
    if (fighter.state === 'guarding' || fighter.currentAnim === 'guard') {
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
      ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#38BDF8';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(drawW * 0.2, -drawH * 0.5, drawH * 0.42, -0.8, 0.8);
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }

    // Skill (Ultimate) Aura
    if (fighter.state === 'skill' || fighter.currentAnim === 'finish') {
      ctx.save();
      ctx.fillStyle = '#F59E0B';
      ctx.shadowColor = '#F59E0B';
      ctx.shadowBlur = 12;
      const time = performance.now() / 200;
      for (let p = 0; p < 3; p++) {
        const px = ((p * 24 + time * 10) % 50) - 25;
        const py = -((p * 20 + time * 20) % 60) - 30;
        ctx.fillRect(px - 1, py - 4, 2, 8);
        ctx.fillRect(px - 4, py - 1, 8, 2);
      }
      ctx.restore();
    }

    // Debug Hitbox overlay if enabled
    if (showHitboxes) {
      ctx.strokeStyle = fighter.state === 'attacking' ? 'rgba(239, 68, 68, 0.8)' : 'rgba(34, 197, 94, 0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        -drawW * 0.35,
        -drawH * 0.9,
        drawW * 0.7,
        drawH * 0.9
      );
    }

    ctx.restore();
  };

  // Render floating damage numbers and hit spark particles
  const renderHitEffects = (ctx: CanvasRenderingContext2D) => {
    hitEffectsRef.current.forEach((fx) => {
      const age = (performance.now() - fx.createdAt) / 1000;
      const progress = age / fx.duration;
      const alpha = Math.max(0, 1 - progress);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(fx.x, fx.y - progress * 40);

      if (fx.type === 'shield') {
        // Shield impact ripple
        ctx.strokeStyle = '#38BDF8';
        ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 22 * (1 - progress * 0.2), -0.8, 0.8);
        ctx.stroke();
        ctx.fill();
      } else {
        // Hit Spark starburst
        ctx.strokeStyle = fx.color || '#F59E0B';
        ctx.lineWidth = 3;
        for (let i = 0; i < 6; i++) {
          const angle = (i * Math.PI) / 3 + progress * 2;
          const len = 12 + (1 - progress) * 14;
          ctx.beginPath();
          ctx.moveTo(Math.cos(angle) * 4, Math.sin(angle) * 4);
          ctx.lineTo(Math.cos(angle) * len, Math.sin(angle) * len);
          ctx.stroke();
        }
      }

      // Damage Text
      if (fx.text) {
        ctx.font = 'bold 18px "Segoe UI", "Chakra Petch", monospace';
        ctx.fillStyle = fx.type === 'shield' ? '#38BDF8' : '#FFFFFF';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 6;
        ctx.textAlign = 'center';
        ctx.fillText(fx.text, 0, -10);
      }

      ctx.restore();
    });
  };

  return (
    <div
      ref={containerRef}
      id="fight-arena-container"
      className="relative w-full h-full overflow-hidden"
    >
      {/* CENTER DRAMATIC ROUND BANNER */}
      {roundBanner && (
        <div
          id="round-banner"
          className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none"
        >
          <div className="px-8 py-3 bg-black/85 border-y-4 border-yellow-400 shadow-[0_0_30px_rgba(250,204,21,0.6)] backdrop-blur-sm animate-pulse">
            <h1 className="font-fighter text-3xl md:text-5xl font-extrabold italic tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-amber-200 to-yellow-400 drop-shadow-[0_4px_8px_rgba(0,0,0,1)] text-center">
              {roundBanner}
            </h1>
          </div>
        </div>
      )}

      {/* MAIN FIGHT GRAPHICS CANVAS (HUD incluido: se dibuja sobre las cabezas) */}
      <canvas
        ref={canvasRef}
        id="fight-canvas"
        className="absolute inset-0 w-full h-full pointer-events-none pixelated"
      />
    </div>
  );
};
