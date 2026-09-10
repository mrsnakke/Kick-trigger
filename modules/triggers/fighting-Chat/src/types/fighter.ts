export type AnimationType =
  | 'idle'
  | 'walk'
  | 'jump'
  | 'crouch'
  | 'guard'
  | 'attack_rapid'
  | 'attack_heavy'
  | 'attack_low'
  | 'hit'
  | 'fall'
  | 'get_up'
  | 'skill'
  | 'finish'
  | 'victory'
  | 'fail'
  // Compatibility aliases
  | 'attack'
  | 'dance'
  | 'sit'
  | 'intro'
  | 'ko';

export interface Hitbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnimationConfig {
  name: AnimationType;
  label: string;
  row: number; // Row index in sprite sheet (0 to 12)
  startFrame?: number; // Starting frame in row (default 0)
  frameCount: number; // Number of frames
  fps: number; // Target animation speed
  loop: boolean;
  attackFrame?: number; // Frame index that lands hit
  damage?: number; // Damage dealt if attack
  hitbox?: Hitbox;
  delays?: number[];
  offsetX?: number; // Optional horizontal pixel shift for frame window
  offsetY?: number; // Optional vertical pixel shift for frame window (e.g. adjust up/down to prevent row bleeding)
}

export interface FighterStats {
  level: number;
  exp: number;
  expToNextLevel: number;
  baseMaxHp: number;
  attackPower: number;
  defense: number;
  evasion: number;
  accuracy: number;
  critChance: number;
  attributePoints: number;
  allocated: { hp: number; attack: number; defense: number; evasion: number; accuracy: number; crit: number };
  wins: number;
  losses: number;
}

export interface CharacterConfig {
  id: string;
  name: string;
  spriteUrl: string; // Image src or canvas data URL
  isCustomImage?: boolean;
  frameWidth: number; // e.g. 128
  frameHeight: number; // e.g. 128
  scale: number; // e.g. 1.2
  speed: number; // movement velocity e.g. 10
  acceleration: boolean;
  originX: number; // Anchor X (0-1), default 0.5
  originY: number; // Anchor Y (0-1), default 0.95
  colorTheme: string;
  animations: Record<string, AnimationConfig>;
  stats?: FighterStats;
}

export type FighterActionState =
  | 'intro'
  | 'idle'
  | 'approaching'
  | 'retreating'
  | 'jumping'
  | 'crouching'
  | 'guarding'
  | 'attacking'
  | 'skill'
  | 'hit'
  | 'fall'
  | 'get_up'
  | 'ko'
  | 'victory'
  | 'fail';

export interface FighterEntity {
  id: 'p1' | 'p2';
  name: string;
  config: CharacterConfig;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  displayHp: number; // for smooth damage lag bar
  energy: number; // 0 to 100 for Skill / Ultimate
  maxEnergy: number; // 100
  facing: 1 | -1; // 1 = right, -1 = left
  currentAnim: AnimationType;
  currentFrame: number;
  frameTimer: number;
  state: FighterActionState;
  stateTimer: number;
  attackLanded: boolean;
  wins: number; // max 3
  roundHistory: ('w' | 'l')[];
  comboCount: number;
  isGrounded: boolean;
  activeAttackType?: 'rapid' | 'heavy' | 'low' | 'finish' | 'skill';
  guardTimer?: number;
  skillCooldown?: number;
  skillTriggered?: boolean;
  stats: FighterStats;
}

export interface HitEffect {
  id: string;
  x: number;
  y: number;
  text?: string;
  type: 'hit' | 'crit' | 'slash' | 'spark' | 'heal' | 'shield' | 'damage_num';
  size: number;
  color: string;
  createdAt: number;
  duration: number;
  vy?: number;
  isCrit?: boolean;
  isHeal?: boolean;
  isDodged?: boolean;
}

export type BackgroundMode = 'transparent' | 'green' | 'magenta' | 'stage-dark' | 'stage-dojo';
export type ViewLayout = 'bottom-stream' | 'full-arena';
