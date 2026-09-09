import { CharacterConfig, AnimationConfig } from '../types/fighter';

/**
 * Procedural Sprite Sheet Generator for the 128x128 Maid Character (asset.png grid layout).
 * Exact dimensions: 6 Columns x 13 Rows of 128x128 pixels (768px x 1664px).
 *
 * Layout mapped directly from user specification:
 * Fila 0:  Idle_1, Idle_2, Idle_3 (Cols 0-2)
 * Fila 1:  Walk_1 to Walk_6 (Cols 0-5)
 * Fila 2:  Jump_1, Jump_2 (Cols 0-1) | Crouch_1 (Col 2) | Guard_1, Guard_2 (Cols 3-4)
 * Fila 3:  AtkRap_1 to AtkRap_3 (Cols 0-2) - Ataque Rápido Mopa
 * Fila 4:  AtkFte_1 to AtkFte_4 (Cols 0-3) - Ataque Fuerte Patada Ígnea
 * Fila 5:  AtkBjo_1 to AtkBjo_4 (Cols 0-3) - Ataque Bajo Barrido Mopa
 * Fila 6:  Hit_1 to Hit_3 (Cols 0-2) - Impacto
 * Fila 7:  Fall_1 to Fall_4 (Cols 0-3) - Caída / K.O.
 * Fila 8:  GetUp_1 to GetUp_3 (Cols 0-2) - Levantarse
 * Fila 9:  Skill_1 to Skill_6 (Cols 0-5) - Bandeja / Curación HEAL
 * Fila 10: Finish_1 to Finish_6 (Cols 0-5) - Super Remate Combo
 * Fila 11: Vict_1 to Vict_4 (Cols 0-3) - Victoria ✌️
 * Fila 12: Fail_1 to Fail_4 (Cols 0-3) - Derrota Cómica
 */

export function generateMaidSpriteSheet(theme: 'red' | 'blue' = 'red'): string {
  if (typeof document === 'undefined') return '';

  const canvas = document.createElement('canvas');
  const cols = 6;
  const rows = 13;
  const fw = 128;
  const fh = 128;
  canvas.width = cols * fw;
  canvas.height = rows * fh;

  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.imageSmoothingEnabled = false;

  const isRed = theme === 'red';
  const hairColor = isRed ? '#E53E3E' : '#3182CE';
  const hairHighlight = isRed ? '#FC8181' : '#63B3ED';
  const dressColor = isRed ? '#1A202C' : '#232D3F';
  const apronColor = '#F7FAFC';
  const skinColor = '#FBD38D';
  const glassesColor = '#2B6CB0';
  const auraColor = isRed ? 'rgba(239, 68, 68, 0.4)' : 'rgba(66, 153, 225, 0.4)';

  function drawMaidBase(
    cx: number,
    cy: number,
    pose: {
      headY?: number;
      bodyY?: number;
      tilt?: number;
      armL?: number;
      armR?: number;
      legL?: number;
      legR?: number;
      hasMop?: boolean;
      mopAngle?: number;
      mopX?: number;
      mopY?: number;
      hasTray?: boolean;
      crouch?: boolean;
      knocked?: boolean;
      faceType?: 'normal' | 'wink' | 'hurt' | 'happy' | 'fierce' | 'crying';
      specialEffect?: 'slash' | 'fire' | 'heal' | 'shield' | 'combo' | 'star';
      healStep?: number;
      comboStep?: number;
    }
  ) {
    if (!ctx) return;
    ctx.save();
    ctx.translate(cx, cy);

    if (pose.knocked) {
      ctx.rotate(Math.PI * 0.45);
      ctx.translate(15, -20);
    }

    if (pose.tilt) {
      ctx.rotate(pose.tilt);
    }

    const by = pose.bodyY ?? 0;
    const hy = (pose.headY ?? 0) + by;

    // Ground shadow
    if (!pose.knocked) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.beginPath();
      ctx.ellipse(0, 0, pose.crouch ? 28 : 22, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Legs / Shoes
    ctx.fillStyle = '#1A202C'; // Black maid shoes
    const legLeftX = -8 + (pose.legL ?? 0);
    const legRightX = 8 + (pose.legR ?? 0);
    const legY = pose.crouch ? -12 : -18;
    ctx.fillRect(legLeftX - 3, legY + by, 6, -legY);
    ctx.fillRect(legRightX - 3, legY + by, 6, -legY);

    // White frill socks
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(legLeftX - 4, legY + by, 8, 4);
    ctx.fillRect(legRightX - 4, legY + by, 8, 4);

    // Maid Dress Skirt
    ctx.fillStyle = dressColor;
    ctx.beginPath();
    const skirtTopY = pose.crouch ? -28 + by : -40 + by;
    const skirtBottomY = pose.crouch ? -12 + by : -20 + by;
    ctx.moveTo(-10, skirtTopY);
    ctx.lineTo(10, skirtTopY);
    ctx.lineTo(18, skirtBottomY);
    ctx.lineTo(-18, skirtBottomY);
    ctx.closePath();
    ctx.fill();

    // White Apron Front
    ctx.fillStyle = apronColor;
    ctx.beginPath();
    ctx.moveTo(-7, skirtTopY);
    ctx.lineTo(7, skirtTopY);
    ctx.lineTo(11, skirtBottomY);
    ctx.lineTo(-11, skirtBottomY);
    ctx.closePath();
    ctx.fill();

    // Torso / Maid Vest
    const torsoY = pose.crouch ? -38 + by : -52 + by;
    ctx.fillStyle = dressColor;
    ctx.fillRect(-8, torsoY, 16, 14);

    // White Apron Bib & Straps
    ctx.fillStyle = apronColor;
    ctx.fillRect(-5, torsoY, 10, 13);
    // Red bow on chest
    ctx.fillStyle = isRed ? '#E53E3E' : '#3182CE';
    ctx.beginPath();
    ctx.arc(0, torsoY + 3, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Long Red Hair (Back)
    ctx.fillStyle = hairColor;
    const hairY = pose.crouch ? -48 + hy : -62 + hy;
    ctx.beginPath();
    ctx.moveTo(-14, hairY);
    ctx.quadraticCurveTo(-24, hairY + 24, -16, hairY + 44);
    ctx.lineTo(16, hairY + 44);
    ctx.quadraticCurveTo(24, hairY + 24, 14, hairY);
    ctx.closePath();
    ctx.fill();

    // Head / Face
    const headCenterY = pose.crouch ? -52 + hy : -66 + hy;
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.arc(0, headCenterY, 11, 0, Math.PI * 2);
    ctx.fill();

    // Red Hair (Bangs & Sides)
    ctx.fillStyle = hairColor;
    ctx.beginPath();
    ctx.arc(0, headCenterY - 2, 12, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-12, headCenterY - 4, 4, 14);
    ctx.fillRect(8, headCenterY - 4, 4, 14);

    // Hair Highlight
    ctx.fillStyle = hairHighlight;
    ctx.beginPath();
    ctx.arc(0, headCenterY - 6, 8, Math.PI * 1.1, Math.PI * 1.9);
    ctx.fill();

    // White Maid Headband (Frill Bonnet)
    ctx.fillStyle = apronColor;
    ctx.beginPath();
    ctx.ellipse(0, headCenterY - 10, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#CBD5E0';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Glasses
    ctx.strokeStyle = glassesColor;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-8, headCenterY - 2, 5, 4);
    ctx.strokeRect(3, headCenterY - 2, 5, 4);
    ctx.beginPath();
    ctx.moveTo(-3, headCenterY);
    ctx.lineTo(3, headCenterY);
    ctx.stroke();

    // Eyes
    if (pose.faceType === 'wink') {
      ctx.fillStyle = '#2D3748';
      ctx.beginPath();
      ctx.arc(5, headCenterY, 1.5, 0, Math.PI * 2);
      ctx.fill();
      // Wink left eye
      ctx.strokeStyle = '#2D3748';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-7, headCenterY);
      ctx.lineTo(-4, headCenterY);
      ctx.stroke();
    } else if (pose.faceType === 'hurt') {
      ctx.strokeStyle = '#9B2C2C';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-7, headCenterY - 1);
      ctx.lineTo(-4, headCenterY + 1);
      ctx.moveTo(4, headCenterY - 1);
      ctx.lineTo(7, headCenterY + 1);
      ctx.stroke();
    } else if (pose.faceType === 'crying') {
      // Comic tear streams
      ctx.fillStyle = '#63B3ED';
      ctx.fillRect(-6, headCenterY + 1, 2, 8);
      ctx.fillRect(4, headCenterY + 1, 2, 8);
    } else {
      // Normal cute eyes
      ctx.fillStyle = isRed ? '#742A2A' : '#2B6CB0';
      ctx.beginPath();
      ctx.arc(-5.5, headCenterY, 1.5, 0, Math.PI * 2);
      ctx.arc(5.5, headCenterY, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cute Smile / Expression
    ctx.strokeStyle = '#9B2C2C';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (pose.faceType === 'happy') {
      ctx.arc(0, headCenterY + 3, 2.5, 0, Math.PI);
    } else if (pose.faceType === 'crying') {
      ctx.arc(0, headCenterY + 5, 2.5, Math.PI, 0);
    } else {
      ctx.moveTo(-2, headCenterY + 4);
      ctx.lineTo(2, headCenterY + 4);
    }
    ctx.stroke();

    // Mop Weapon
    if (pose.hasMop) {
      ctx.save();
      const mopX = pose.mopX ?? 10;
      const mopY = pose.mopY ?? (pose.crouch ? -30 : -45);
      ctx.translate(mopX, mopY);
      ctx.rotate(pose.mopAngle ?? 0.3);

      // Wooden handle
      ctx.fillStyle = '#B7791F';
      ctx.fillRect(-2, -35, 4, 70);

      // Silver metal socket
      ctx.fillStyle = '#A0AEC0';
      ctx.fillRect(-4, 30, 8, 6);

      // White cotton mop head
      ctx.fillStyle = '#EDF2F7';
      ctx.beginPath();
      ctx.roundRect(-8, 35, 16, 16, 4);
      ctx.fill();
      ctx.restore();
    }

    // Serving Tray (Skill)
    if (pose.hasTray) {
      ctx.save();
      ctx.translate(12, -45 + by);
      // Silver tray
      ctx.fillStyle = '#E2E8F0';
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#CBD5E0';
      ctx.stroke();

      // Tea cup / ramen / treats
      ctx.fillStyle = '#DD6B20';
      ctx.beginPath();
      ctx.arc(0, -4, 4, 0, Math.PI);
      ctx.fill();
      ctx.restore();
    }

    // Special Effects Overlays
    if (pose.specialEffect === 'shield') {
      ctx.save();
      ctx.strokeStyle = 'rgba(66, 153, 225, 0.8)';
      ctx.fillStyle = 'rgba(66, 153, 225, 0.2)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(10, -42, 34, -0.6, 0.6);
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    } else if (pose.specialEffect === 'slash') {
      ctx.save();
      ctx.strokeStyle = '#63B3ED';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.shadowColor = '#3182CE';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(25, -35, 36, -0.8, 0.8);
      ctx.stroke();
      ctx.restore();
    } else if (pose.specialEffect === 'fire') {
      ctx.save();
      ctx.strokeStyle = '#F56565';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.shadowColor = '#E53E3E';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(28, -48, 42, -1.1, 0.6);
      ctx.stroke();
      // Fiery sparks
      ctx.fillStyle = '#FAF089';
      for (let s = 0; s < 4; s++) {
        ctx.fillRect(32 + s * 4, -58 + s * 8, 3, 3);
      }
      ctx.restore();
    } else if (pose.specialEffect === 'heal') {
      ctx.save();
      const step = pose.healStep ?? 1;
      // Green heal plus crosses & sparkles
      ctx.fillStyle = '#48BB78';
      ctx.shadowColor = '#38A169';
      ctx.shadowBlur = 8;
      const positions = [
        [-16, -70],
        [18, -68],
        [0, -84],
        [24, -40],
      ];
      positions.forEach(([hx, hy], i) => {
        if (i <= step) {
          ctx.fillRect(hx - 2, hy - 6, 4, 12);
          ctx.fillRect(hx - 6, hy - 2, 12, 4);
        }
      });
      // "HEAL!" banner if later frame
      if (step >= 3) {
        ctx.fillStyle = '#38A169';
        ctx.font = 'bold 9px monospace';
        ctx.fillText('HEAL+20', -18, -88);
      }
      ctx.restore();
    } else if (pose.specialEffect === 'star') {
      ctx.save();
      ctx.fillStyle = '#ECC94B';
      ctx.shadowColor = '#D69E2E';
      ctx.shadowBlur = 8;
      // Sparkle star near hand
      const sx = 18;
      const sy = -75;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 8);
      ctx.lineTo(sx + 3, sy - 3);
      ctx.lineTo(sx + 8, sy);
      ctx.lineTo(sx + 3, sy + 3);
      ctx.lineTo(sx, sy + 8);
      ctx.lineTo(sx - 3, sy + 3);
      ctx.lineTo(sx - 8, sy);
      ctx.lineTo(sx - 3, sy - 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  // Generate each row matching user's spec:
  const groundY = fh * 0.94;

  // Fila 0: Idle (3 frames)
  for (let c = 0; c < 3; c++) {
    const cx = c * fw + fw / 2;
    const cy = 0 * fh + groundY;
    const breathe = Math.sin(c * 1.5) * 2;
    drawMaidBase(cx, cy, {
      bodyY: breathe,
      hasMop: true,
      mopAngle: 0.15 + c * 0.05,
    });
  }

  // Fila 1: Walk (6 frames)
  for (let c = 0; c < 6; c++) {
    const cx = c * fw + fw / 2;
    const cy = 1 * fh + groundY;
    const stride = Math.sin((c / 6) * Math.PI * 2) * 8;
    const bob = Math.abs(Math.cos((c / 6) * Math.PI * 2)) * 3;
    drawMaidBase(cx, cy, {
      bodyY: -bob,
      tilt: 0.08,
      legL: stride,
      legR: -stride,
      hasMop: true,
      mopAngle: 0.25 - stride * 0.02,
    });
  }

  // Fila 2: Jump (Cols 0-1) | Crouch (Col 2) | Guard (Cols 3-4)
  // Jump_1: rising
  drawMaidBase(0 * fw + fw / 2, 2 * fh + groundY - 24, {
    legL: -4,
    legR: 4,
    hasMop: true,
    mopAngle: 0.4,
  });
  // Jump_2: tuck in air
  drawMaidBase(1 * fw + fw / 2, 2 * fh + groundY - 42, {
    crouch: true,
    hasMop: true,
    mopAngle: 0.6,
  });
  // Crouch_1
  drawMaidBase(2 * fw + fw / 2, 2 * fh + groundY, {
    crouch: true,
    hasMop: true,
    mopAngle: 0.8,
  });
  // Guard_1
  drawMaidBase(3 * fw + fw / 2, 2 * fh + groundY, {
    tilt: -0.06,
    hasMop: true,
    mopAngle: -0.4,
    specialEffect: 'shield',
  });
  // Guard_2
  drawMaidBase(4 * fw + fw / 2, 2 * fh + groundY, {
    tilt: -0.06,
    hasMop: true,
    mopAngle: -0.4,
    specialEffect: 'shield',
  });

  // Fila 3: AtkRap (3 frames) - Ataque Rápido Mopa
  for (let c = 0; c < 3; c++) {
    const cx = c * fw + fw / 2;
    const cy = 3 * fh + groundY;
    const swingAngles = [-0.6, 0.4, 0.8];
    drawMaidBase(cx, cy, {
      tilt: 0.12,
      hasMop: true,
      mopAngle: swingAngles[c],
      mopX: c === 1 ? 22 : 12,
      specialEffect: c === 1 ? 'slash' : undefined,
      faceType: 'fierce',
    });
  }

  // Fila 4: AtkFte (4 frames) - Ataque Fuerte Patada Ígnea
  for (let c = 0; c < 4; c++) {
    const cx = c * fw + fw / 2;
    const cy = 4 * fh + groundY;
    if (c === 0) {
      drawMaidBase(cx, cy, { tilt: -0.1, legL: -6, faceType: 'fierce' });
    } else if (c === 1) {
      drawMaidBase(cx, cy, { tilt: 0.1, legL: 12, faceType: 'fierce' });
    } else if (c === 2) {
      // High Fiery Kick!
      drawMaidBase(cx, cy, {
        tilt: 0.2,
        legL: 24,
        bodyY: -10,
        specialEffect: 'fire',
        faceType: 'fierce',
      });
    } else {
      drawMaidBase(cx, cy, { tilt: 0.05, legL: 8 });
    }
  }

  // Fila 5: AtkBjo (4 frames) - Ataque Bajo Barrido
  for (let c = 0; c < 4; c++) {
    const cx = c * fw + fw / 2;
    const cy = 5 * fh + groundY;
    drawMaidBase(cx, cy, {
      crouch: true,
      hasMop: true,
      mopAngle: 1.2 - c * 0.4,
      mopX: 16 + c * 4,
      specialEffect: c === 2 ? 'slash' : undefined,
      faceType: 'fierce',
    });
  }

  // Fila 6: Hit (3 frames) - Impacto
  for (let c = 0; c < 3; c++) {
    const cx = c * fw + fw / 2;
    const cy = 6 * fh + groundY;
    drawMaidBase(cx, cy, {
      tilt: -0.25,
      bodyY: -4,
      faceType: 'hurt',
      hasMop: true,
      mopAngle: -0.5,
    });
  }

  // Fila 7: Fall (4 frames) - Caída / K.O.
  drawMaidBase(0 * fw + fw / 2, 7 * fh + groundY - 20, { tilt: -0.4, faceType: 'hurt' });
  drawMaidBase(1 * fw + fw / 2, 7 * fh + groundY - 26, { tilt: -0.8, faceType: 'hurt' });
  drawMaidBase(2 * fw + fw / 2, 7 * fh + groundY, { knocked: true, faceType: 'hurt' });
  drawMaidBase(3 * fw + fw / 2, 7 * fh + groundY, { knocked: true, faceType: 'hurt' });

  // Fila 8: GetUp (3 frames) - Levantarse
  drawMaidBase(0 * fw + fw / 2, 8 * fh + groundY, { crouch: true, faceType: 'hurt' });
  drawMaidBase(1 * fw + fw / 2, 8 * fh + groundY, { crouch: true, tilt: -0.1 });
  drawMaidBase(2 * fw + fw / 2, 8 * fh + groundY, { bodyY: 0, hasMop: true });

  // Fila 9: Skill (6 frames) - Bandeja / Curación HEAL
  for (let c = 0; c < 6; c++) {
    const cx = c * fw + fw / 2;
    const cy = 9 * fh + groundY;
    drawMaidBase(cx, cy, {
      hasTray: true,
      faceType: c >= 3 ? 'happy' : 'normal',
      specialEffect: 'heal',
      healStep: c,
    });
  }

  // Fila 10: Finish (6 frames) - Super Remate Combo
  for (let c = 0; c < 6; c++) {
    const cx = c * fw + fw / 2;
    const cy = 10 * fh + groundY;
    drawMaidBase(cx, cy, {
      tilt: (c % 2 === 0 ? 0.15 : -0.15),
      specialEffect: c >= 3 ? 'fire' : 'slash',
      faceType: 'fierce',
      legL: c * 4,
    });
  }

  // Fila 11: Vict (4 frames) - Victoria ✌️
  for (let c = 0; c < 4; c++) {
    const cx = c * fw + fw / 2;
    const cy = 11 * fh + groundY;
    drawMaidBase(cx, cy, {
      faceType: 'wink',
      specialEffect: 'star',
      bodyY: Math.sin(c) * 2,
    });
  }

  // Fila 12: Fail (4 frames) - Derrota Cómica
  for (let c = 0; c < 4; c++) {
    const cx = c * fw + fw / 2;
    const cy = 12 * fh + groundY;
    drawMaidBase(cx, cy, {
      crouch: true,
      faceType: 'crying',
      tilt: 0.15,
    });
  }

  return canvas.toDataURL('image/png');
}

/**
 * Default Character Config for the 128x128 Maid (matching user's asset.png layout)
 */
export const ASSET_MAID_CONFIG: CharacterConfig = {
  id: 'maid',
  name: 'Maid Striker',
  spriteUrl: '/asset.png', // Priority to asset.png!
  isCustomImage: false,
  frameWidth: 128,
  frameHeight: 128,
  scale: 1.25,
  speed: 10,
  acceleration: true,
  originX: 0.5,
  originY: 0.95,
  colorTheme: '#EF4444',
  animations: {
    idle: {
      name: 'idle',
      label: 'Reposo (Fila 0)',
      row: 0,
      startFrame: 0,
      frameCount: 3,
      fps: 6,
      loop: true,
    },
    walk: {
      name: 'walk',
      label: 'Caminar (Fila 1)',
      row: 1,
      startFrame: 0,
      frameCount: 6,
      fps: 12,
      loop: true,
    },
    jump: {
      name: 'jump',
      label: 'Salto / Evasión (Fila 2)',
      row: 2,
      startFrame: 0,
      frameCount: 2,
      fps: 6,
      loop: false,
    },
    crouch: {
      name: 'crouch',
      label: 'Agacharse (Fila 2)',
      row: 2,
      startFrame: 2,
      frameCount: 1,
      fps: 6,
      loop: true,
    },
    guard: {
      name: 'guard',
      label: 'Guardia Escudo (Fila 2)',
      row: 2,
      startFrame: 3,
      frameCount: 2,
      fps: 6,
      loop: true,
    },
    attack_rapid: {
      name: 'attack_rapid',
      label: 'Ataque Rápido Mopa (Fila 3)',
      row: 3,
      startFrame: 0,
      frameCount: 3,
      fps: 10,
      loop: false,
      attackFrame: 1,
      damage: 10,
    },
    attack_heavy: {
      name: 'attack_heavy',
      label: 'Ataque Fuerte Patada Ígnea (Fila 4)',
      row: 4,
      startFrame: 0,
      frameCount: 4,
      fps: 9,
      loop: false,
      attackFrame: 2,
      damage: 22,
    },
    attack_low: {
      name: 'attack_low',
      label: 'Ataque Bajo Barrido Mopa (Fila 5)',
      row: 5,
      startFrame: 0,
      frameCount: 4,
      fps: 9,
      loop: false,
      attackFrame: 1,
      damage: 14,
    },
    hit: {
      name: 'hit',
      label: 'Impacto / Daño (Fila 6)',
      row: 6,
      startFrame: 0,
      frameCount: 3,
      fps: 8,
      loop: false,
    },
    fall: {
      name: 'fall',
      label: 'Caída / Derribo (Fila 7)',
      row: 7,
      startFrame: 0,
      frameCount: 4,
      fps: 7,
      loop: false,
    },
    get_up: {
      name: 'get_up',
      label: 'Levantarse (Fila 8)',
      row: 8,
      startFrame: 0,
      frameCount: 3,
      fps: 7,
      loop: false,
    },
    skill: {
      name: 'skill',
      label: 'Habilidad Bandeja / Curación (Fila 9)',
      row: 9,
      startFrame: 0,
      frameCount: 6,
      fps: 8,
      loop: false,
    },
    finish: {
      name: 'finish',
      label: 'Super Remate Combo (Fila 10)',
      row: 10,
      startFrame: 0,
      frameCount: 6,
      fps: 10,
      loop: false,
      attackFrame: 4,
      damage: 30,
    },
    victory: {
      name: 'victory',
      label: 'Victoria Paz ✌️ (Fila 11)',
      row: 11,
      startFrame: 0,
      frameCount: 4,
      fps: 7,
      loop: true,
    },
    fail: {
      name: 'fail',
      label: 'Derrota Cómica (Fila 12)',
      row: 12,
      startFrame: 0,
      frameCount: 4,
      fps: 7,
      loop: false,
    },
    // Compatibility aliases:
    attack: {
      name: 'attack',
      label: 'Ataque Rápido',
      row: 3,
      startFrame: 0,
      frameCount: 3,
      fps: 10,
      loop: false,
      attackFrame: 1,
      damage: 10,
    },
    dance: {
      name: 'dance',
      label: 'Pose Victoria',
      row: 11,
      startFrame: 0,
      frameCount: 4,
      fps: 7,
      loop: true,
    },
    sit: {
      name: 'sit',
      label: 'Agacharse',
      row: 2,
      startFrame: 2,
      frameCount: 1,
      fps: 6,
      loop: true,
    },
    intro: {
      name: 'intro',
      label: 'Entrada en Escena',
      row: 0,
      startFrame: 0,
      frameCount: 3,
      fps: 6,
      loop: true,
    },
    ko: {
      name: 'ko',
      label: 'Derrota / K.O.',
      row: 7,
      startFrame: 0,
      frameCount: 4,
      fps: 7,
      loop: false,
    },
  },
};

/**
 * Opponent Configuration with matching 128x128 grid
 */
export const OPPONENT_MAID_CONFIG: CharacterConfig = {
  ...ASSET_MAID_CONFIG,
  id: 'rival',
  name: 'Shadow Maid',
  colorTheme: '#3B82F6',
  spriteUrl: '',
};

// Aliases for backward compatibility:
export const FELICIA_CONFIG = ASSET_MAID_CONFIG;
export const OPPONENT_CONFIG = OPPONENT_MAID_CONFIG;
export const generateFighterSpriteSheet = generateMaidSpriteSheet;
