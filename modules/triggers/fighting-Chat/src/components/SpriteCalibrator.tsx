import React, { useState, useRef, useEffect } from 'react';
import { CharacterConfig, AnimationType, AnimationConfig } from '../types/fighter';
import { saveCustomSpriteImage, clearCustomSpriteImage } from '../utils/storage';
import { FELICIA_CONFIG, ASSET_MAID_CONFIG } from '../utils/defaultSprites';
import {
  Play,
  Pause,
  Upload,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Sliders,
  Check,
  Eye,
  Crosshair,
  FileCode,
  X,
  Sparkles,
  Users,
  MoveVertical,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';

interface SpriteCalibratorProps {
  config?: CharacterConfig;
  onUpdateConfig?: (newConfig: CharacterConfig) => void;
  p1Config?: CharacterConfig;
  p2Config?: CharacterConfig;
  initialFighter?: 'p1' | 'p2';
  onUpdateP1Config?: (newConfig: CharacterConfig) => void;
  onUpdateP2Config?: (newConfig: CharacterConfig) => void;
  onApplyToBoth?: (config: CharacterConfig) => void;
  onClose: () => void;
  embedded?: boolean;
}

export const SpriteCalibrator: React.FC<SpriteCalibratorProps> = ({
  config,
  onUpdateConfig,
  p1Config,
  p2Config,
  initialFighter = 'p1',
  onUpdateP1Config,
  onUpdateP2Config,
  onApplyToBoth,
  onClose,
  embedded = false,
}) => {
  const [activeFighter, setActiveFighter] = useState<'p1' | 'p2'>(initialFighter);
  const activeInitialConfig = activeFighter === 'p1' ? (p1Config || config!) : (p2Config || config!);
  const [currentConfig, setCurrentConfig] = useState<CharacterConfig>(activeInitialConfig);
  const [selectedAnim, setSelectedAnim] = useState<AnimationType>('idle');
  const [previewZoom, setPreviewZoom] = useState<number>(1.2);
  const [stripZoom, setStripZoom] = useState<number>(0.5);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [previewFrame, setPreviewFrame] = useState<number>(0);
  const [showHitbox, setShowHitbox] = useState<boolean>(true);
  const [uploadStatus, setUploadStatus] = useState<string>('');

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spriteImageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync external config if changed
  useEffect(() => {
    const cfg = activeFighter === 'p1' ? (p1Config || config!) : (p2Config || config!);
    if (cfg) {
      setCurrentConfig(cfg);
    }
  }, [p1Config, p2Config, config, activeFighter]);

  // Load Sprite Sheet image for preview canvas
  useEffect(() => {
    if (!currentConfig.spriteUrl) return;
    const img = new Image();
    img.src = currentConfig.spriteUrl;
    img.onload = () => {
      spriteImageRef.current = img;
    };
  }, [currentConfig.spriteUrl]);

  // Live Animation Loop in Inspector
  useEffect(() => {
    if (!isPlaying) return;

    const animConfig = currentConfig.animations[selectedAnim] || currentConfig.animations.idle;
    const fps = Math.max(1, animConfig.fps || 15);
    const interval = 1000 / fps;

    const timer = setInterval(() => {
      setPreviewFrame((prev) => {
        if (prev >= animConfig.frameCount - 1) {
          return animConfig.loop ? 0 : prev;
        }
        return prev + 1;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [isPlaying, selectedAnim, currentConfig.animations]);

  // Draw Live Inspector Canvas
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const fw = currentConfig.frameWidth || 200;
    const fh = currentConfig.frameHeight || 200;

    canvas.width = 300;
    canvas.height = 260;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Checkerboard transparent pattern
    const patternSize = 12;
    for (let x = 0; x < canvas.width; x += patternSize) {
      for (let y = 0; y < canvas.height; y += patternSize) {
        const isEven = ((x / patternSize) + (y / patternSize)) % 2 === 0;
        ctx.fillStyle = isEven ? '#1e293b' : '#0f172a';
        ctx.fillRect(x, y, patternSize, patternSize);
      }
    }

    // Ground reference line
    const groundY = canvas.height * 0.85;
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(canvas.width, groundY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw Character Frame
    const img = spriteImageRef.current;
    const animConfig = currentConfig.animations[selectedAnim] || currentConfig.animations.idle;
    const frameRow = animConfig.row ?? 0;
    const frameCol = (animConfig.startFrame ?? 0) + (previewFrame % Math.max(1, animConfig.frameCount));

    if (img && img.complete && img.naturalWidth > 0) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;

      const drawScale = previewZoom * currentConfig.scale;
      const dw = fw * drawScale;
      const dh = fh * drawScale;
      const dx = canvas.width / 2 - dw * currentConfig.originX;
      const dy = groundY - dh * currentConfig.originY;

      // Draw shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.ellipse(canvas.width / 2, groundY, 32 * drawScale, 8 * drawScale, 0, 0, Math.PI * 2);
      ctx.fill();

      // Draw slice with offset Y / X adjustment
      const animOffsetX = animConfig.offsetX ?? 0;
      const animOffsetY = animConfig.offsetY ?? 0;
      const sx = Math.max(0, frameCol * fw + animOffsetX);
      const sy = Math.max(0, frameRow * fh + animOffsetY);

      ctx.drawImage(
        img,
        sx,
        sy,
        fw,
        fh,
        dx,
        dy,
        dw,
        dh
      );

      // Hitbox / bounding box overlay
      if (showHitbox) {
        ctx.strokeStyle = '#22C55E';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(dx, dy, dw, dh);

        // Center crosshair
        ctx.strokeStyle = '#F59E0B';
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2 - 8, groundY);
        ctx.lineTo(canvas.width / 2 + 8, groundY);
        ctx.moveTo(canvas.width / 2, groundY - 8);
        ctx.lineTo(canvas.width / 2, groundY + 8);
        ctx.stroke();
      }

      ctx.restore();
    }
  }, [previewFrame, selectedAnim, previewZoom, currentConfig, showHitbox]);

  // Emit config update to parent
  const emitConfigUpdate = (updated: CharacterConfig) => {
    setCurrentConfig(updated);
    if (activeFighter === 'p1') {
      if (onUpdateP1Config) onUpdateP1Config(updated);
      else if (onUpdateConfig) onUpdateConfig(updated);
    } else {
      if (onUpdateP2Config) onUpdateP2Config(updated);
      else if (onUpdateConfig) onUpdateConfig(updated);
    }
  };

  // Switch between P1 and P2 in Calibrator
  const handleSwitchFighter = (target: 'p1' | 'p2') => {
    setActiveFighter(target);
    const cfg = target === 'p1' ? (p1Config || config!) : (p2Config || config!);
    if (cfg) {
      setCurrentConfig(cfg);
    }
    setUploadStatus(`Editando: ${target === 'p1' ? 'PJ1 (Jugador)' : 'PJ2 (Rival)'}`);
  };

  // Copy current sprite and calibration to BOTH fighters (P1 and P2)
  const handleApplyToBothFighters = async () => {
    if (onApplyToBoth) {
      onApplyToBoth(currentConfig);
    } else {
      if (onUpdateP1Config) onUpdateP1Config({ ...currentConfig, id: 'p1' });
      if (onUpdateP2Config) onUpdateP2Config({ ...currentConfig, id: 'p2' });
      if (currentConfig.spriteUrl) {
        await saveCustomSpriteImage('p1', currentConfig.spriteUrl);
        await saveCustomSpriteImage('p2', currentConfig.spriteUrl);
      }
    }
    setUploadStatus('✨ ¡Sprite y calibración copiados exitosamente a PJ1 y PJ2!');
  };

  // Handle Drag & Drop / File Upload
  const handleFileUpload = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setUploadStatus('Por favor sube un archivo de imagen (PNG recomendado).');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) {
        const url = await saveCustomSpriteImage(activeFighter, dataUrl);
        const updated: CharacterConfig = {
          ...currentConfig,
          spriteUrl: url,
          isCustomImage: true,
        };
        emitConfigUpdate(updated);
        setUploadStatus(`¡Imagen cargada en ${activeFighter.toUpperCase()}! Usa "Aplicar a Ambos" si deseas el mismo sprite para P1 y P2.`);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUpdateAnimation = (
    animName: AnimationType,
    updates: Partial<AnimationConfig>
  ) => {
    const updated: CharacterConfig = {
      ...currentConfig,
      animations: {
        ...currentConfig.animations,
        [animName]: {
          ...currentConfig.animations[animName],
          ...updates,
        },
      },
    };
    emitConfigUpdate(updated);
  };

  // Nudge frame offset for currently selected animation
  const handleNudgeOffset = (deltaX: number, deltaY: number) => {
    const anim = currentConfig.animations[selectedAnim];
    if (!anim) return;
    const newOffsetX = (anim.offsetX ?? 0) + deltaX;
    const newOffsetY = (anim.offsetY ?? 0) + deltaY;
    handleUpdateAnimation(selectedAnim, { offsetX: newOffsetX, offsetY: newOffsetY });
  };

  // Reset offset for currently selected animation
  const handleResetOffset = () => {
    handleUpdateAnimation(selectedAnim, { offsetX: 0, offsetY: 0 });
  };

  // Apply current animation's offsetY to all animations with row >= targetRow (e.g. from row 8 onwards)
  const handleApplyOffsetYToRowAndAbove = (minRow: number) => {
    const anim = currentConfig.animations[selectedAnim];
    if (!anim) return;
    const targetOffsetY = anim.offsetY ?? 0;
    const updatedAnimations: Record<string, AnimationConfig> = { ...currentConfig.animations };

    Object.keys(updatedAnimations).forEach((key) => {
      if (updatedAnimations[key].row >= minRow) {
        updatedAnimations[key] = {
          ...updatedAnimations[key],
          offsetY: targetOffsetY,
        };
      }
    });

    const updated: CharacterConfig = {
      ...currentConfig,
      animations: updatedAnimations,
    };
    emitConfigUpdate(updated);
    setUploadStatus(`Ajuste Y de ${targetOffsetY}px aplicado a todas las filas desde la fila ${minRow} en adelante.`);
  };

  const handleApplyDimensions = (w: number, h: number) => {
    const updated: CharacterConfig = {
      ...currentConfig,
      frameWidth: Math.max(16, w),
      frameHeight: Math.max(16, h),
    };
    emitConfigUpdate(updated);
  };

  const handleApplyAsset128Preset = () => {
    const preset = {
      ...ASSET_MAID_CONFIG,
      id: activeFighter,
      name: currentConfig.name || (activeFighter === 'p1' ? 'PJ1 Maid' : 'PJ2 Rival'),
    };
    if (currentConfig.spriteUrl) {
      preset.spriteUrl = currentConfig.spriteUrl;
      preset.isCustomImage = currentConfig.isCustomImage;
    }
    emitConfigUpdate(preset);
    setUploadStatus(`¡Preset asset.png (128x128) aplicado a ${activeFighter.toUpperCase()}!`);
  };

  const handleResetToFeliciaDefaults = async () => {
    const reset = {
      ...FELICIA_CONFIG,
      id: activeFighter,
      name: activeFighter === 'p1' ? 'Felicia P1' : 'Felicia P2',
    };
    if (currentConfig.spriteUrl) {
      reset.spriteUrl = currentConfig.spriteUrl;
      reset.isCustomImage = currentConfig.isCustomImage;
    }
    emitConfigUpdate(reset);
    setUploadStatus(`Configuración de Felicia restablecida para ${activeFighter.toUpperCase()}.`);
  };

  return (
    <div
      id="sprite-calibrator-modal"
      className={`${embedded ? 'absolute inset-0 z-10' : 'fixed inset-0 z-50'} flex items-center justify-center p-3 bg-black/85 backdrop-blur-md overflow-hidden`}
    >
      <div className="relative w-full max-w-6xl max-h-[95vh] bg-[#121824] border border-emerald-500/40 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.9)] flex flex-col overflow-hidden text-slate-200 text-sm">
        {/* MODAL HEADER */}
        <div className="px-5 py-3.5 bg-[#0e141f] border-b border-emerald-500/30 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
            <h2 className="font-fighter font-bold text-lg text-emerald-400 tracking-wider uppercase flex items-center gap-2">
              <Sliders className="w-5 h-5" /> Calibrador de Sprite Sheet 1vs1
            </h2>

            {/* FIGHTER SELECTOR TABS (PJ1 vs PJ2) */}
            <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-lg border border-slate-700/60 font-mono">
              <button
                id="calibrator-select-p1-tab"
                onClick={() => handleSwitchFighter('p1')}
                className={`px-3 py-1 rounded text-xs font-bold font-fighter uppercase transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeFighter === 'p1'
                    ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.5)]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-blue-300" /> PJ1 (Jugador)
              </button>
              <button
                id="calibrator-select-p2-tab"
                onClick={() => handleSwitchFighter('p2')}
                className={`px-3 py-1 rounded text-xs font-bold font-fighter uppercase transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeFighter === 'p2'
                    ? 'bg-rose-600 text-white shadow-[0_0_10px_rgba(225,29,72,0.5)]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-rose-300" /> PJ2 (Rival)
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* APPLY TO BOTH BUTTON */}
            <button
              id="apply-to-both-btn"
              onClick={handleApplyToBothFighters}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-xs text-white font-bold rounded border border-amber-400 flex items-center gap-1.5 transition-all cursor-pointer shadow-[0_0_12px_rgba(245,158,11,0.3)]"
              title="Aplica este sprite y todas las configuraciones a PJ1 y PJ2 simultáneamente"
            >
              <Users className="w-3.5 h-3.5" /> Aplicar a Ambos (P1 y P2)
            </button>

            <button
              id="preset-asset-128-btn"
              onClick={handleApplyAsset128Preset}
              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-xs text-white font-bold rounded border border-emerald-400 flex items-center gap-1.5 transition-colors cursor-pointer shadow-[0_0_10px_rgba(16,185,129,0.3)]"
            >
              <Sparkles className="w-3.5 h-3.5" /> Preset asset.png (128x128)
            </button>

            <button
              id="reset-felicia-btn"
              onClick={handleResetToFeliciaDefaults}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-amber-300 rounded border border-amber-500/40 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset Felicia (200x200)
            </button>

            <button
              id="close-calibrator-btn"
              onClick={onClose}
              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* TOP CONFIGURATION BAR (Matches user's Stream Avatars UI!) */}
        <div className="px-5 py-3 bg-[#151c2a] border-b border-slate-800 flex flex-wrap items-center gap-4 text-xs font-mono">
          {/* Avatar Name */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Avatar:</span>
            <input
              type="text"
              value={currentConfig.name}
              onChange={(e) => {
                const updated = { ...currentConfig, name: e.target.value };
                emitConfigUpdate(updated);
              }}
              className="w-28 px-2 py-1 bg-slate-900 border border-emerald-500/40 rounded text-emerald-300 font-bold focus:outline-none focus:border-emerald-400"
            />
          </div>

          {/* Ancho / Altura */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Ancho:</span>
            <input
              type="number"
              value={currentConfig.frameWidth}
              onChange={(e) => handleApplyDimensions(Number(e.target.value), currentConfig.frameHeight)}
              className="w-16 px-2 py-1 bg-slate-900 border border-emerald-500/40 rounded text-center text-white focus:outline-none focus:border-emerald-400"
            />
            <span className="text-slate-400">Altura:</span>
            <input
              type="number"
              value={currentConfig.frameHeight}
              onChange={(e) => handleApplyDimensions(currentConfig.frameWidth, Number(e.target.value))}
              className="w-16 px-2 py-1 bg-slate-900 border border-emerald-500/40 rounded text-center text-white focus:outline-none focus:border-emerald-400"
            />
          </div>

          {/* Escala */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Escala:</span>
            <input
              type="number"
              step="0.05"
              value={currentConfig.scale}
              onChange={(e) => {
                const scale = Math.max(0.1, Number(e.target.value));
                const updated = { ...currentConfig, scale };
                emitConfigUpdate(updated);
              }}
              className="w-16 px-2 py-1 bg-slate-900 border border-emerald-500/40 rounded text-center text-emerald-400 font-bold focus:outline-none focus:border-emerald-400"
            />
          </div>

          {/* Velocidad de Movimiento */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Velocidad:</span>
            <input
              type="number"
              value={currentConfig.speed}
              onChange={(e) => {
                const speed = Math.max(1, Number(e.target.value));
                const updated = { ...currentConfig, speed };
                emitConfigUpdate(updated);
              }}
              className="w-14 px-2 py-1 bg-slate-900 border border-emerald-500/40 rounded text-center text-white focus:outline-none focus:border-emerald-400"
            />
          </div>

          {/* Aceleración Checkbox */}
          <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
            <input
              type="checkbox"
              checked={currentConfig.acceleration}
              onChange={(e) => {
                const updated = { ...currentConfig, acceleration: e.target.checked };
                setCurrentConfig(updated);
                onUpdateConfig(updated);
              }}
              className="accent-emerald-500 rounded"
            />
            Aceleración
          </label>

          {/* Upload Custom Sprite Sheet Button */}
          <div className="ml-auto flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
              }}
            />
            <button
              id="upload-sprite-btn"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium flex items-center gap-1.5 transition-colors shadow cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" /> Subir sprite (PNG)
            </button>
          </div>
        </div>

        {uploadStatus && (
          <div className="px-5 py-1.5 bg-emerald-950/80 border-b border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
            <span>{uploadStatus}</span>
            <button onClick={() => setUploadStatus('')} className="text-emerald-400 hover:text-white">✕</button>
          </div>
        )}

        {/* MAIN BODY: 2 COLUMNS (LEFT: ANIMATION ROWS; RIGHT: LIVE INSPECTOR & DROPZONE) */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* LEFT: ANIMATION ROWS (75% WIDTH) */}
          <div className="lg:col-span-8 p-4 overflow-y-auto space-y-4 border-r border-slate-800/80 bg-[#0f1521]">
            <div className="flex items-center justify-between pb-1 border-b border-slate-800">
              <span className="text-xs font-mono text-slate-400">
                Seleccione animación para previsualizar y ajustar fila / FPS / fotogramas
              </span>
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="text-slate-400">Zoom tiras:</span>
                <input
                  type="range"
                  min="0.3"
                  max="0.8"
                  step="0.05"
                  value={stripZoom}
                  onChange={(e) => setStripZoom(Number(e.target.value))}
                  className="w-20 accent-emerald-500"
                />
              </div>
            </div>

            {/* Animation Cards matching user screenshots */}
            {(Object.keys(currentConfig.animations) as AnimationType[]).map((animKey) => {
              const anim = currentConfig.animations[animKey];
              const isSelected = selectedAnim === animKey;

              return (
                <div
                  key={animKey}
                  onClick={() => setSelectedAnim(animKey)}
                  className={`p-3 rounded-lg border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-slate-900/90 border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                      : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-fighter font-bold text-sm tracking-wider text-emerald-400 uppercase">
                        {animKey}
                      </span>
                      <span className="text-xs text-slate-400 font-sans">
                        ({anim.label})
                      </span>
                      {isSelected && (
                        <span className="text-[10px] px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/40">
                          ACTIVA
                        </span>
                      )}
                      {animKey === 'jump' && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-950/60 text-amber-300 rounded border border-amber-500/40 font-mono">
                          Salto / Evasión (0 Daño)
                        </span>
                      )}
                      {animKey === 'skill' && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-emerald-950/60 text-emerald-300 rounded border border-emerald-500/40 font-mono">
                          Curación (+25 HP)
                        </span>
                      )}
                      {animKey === 'guard' && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-sky-950/60 text-sky-300 rounded border border-sky-500/40 font-mono">
                          Escudo (-75% Daño)
                        </span>
                      )}
                    </div>

                    {/* Controls: Fila, Col Inicio, FPS, Frames, Daño, Frame Impacto */}
                    <div className="flex flex-wrap items-center gap-3 text-xs font-mono" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5" title="Fila en el sprite sheet (0-index)">
                        <span className="text-slate-400">Fila:</span>
                        <input
                          type="number"
                          min="0"
                          max="20"
                          value={anim.row}
                          onChange={(e) =>
                            handleUpdateAnimation(animKey, { row: Number(e.target.value) })
                          }
                          className="w-12 px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-center text-white"
                        />
                      </div>

                      <div className="flex items-center gap-1.5" title="Columna de inicio del primer frame">
                        <span className="text-slate-400">Col. Ini:</span>
                        <input
                          type="number"
                          min="0"
                          max="20"
                          value={anim.startFrame ?? 0}
                          onChange={(e) =>
                            handleUpdateAnimation(animKey, { startFrame: Number(e.target.value) })
                          }
                          className="w-12 px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-center text-amber-300"
                        />
                      </div>

                      <div className="flex items-center gap-1.5" title="Fotogramas por segundo">
                        <span className="text-slate-400">FPS:</span>
                        <input
                          type="number"
                          min="1"
                          max="60"
                          value={anim.fps}
                          onChange={(e) =>
                            handleUpdateAnimation(animKey, { fps: Number(e.target.value) })
                          }
                          className="w-12 px-1.5 py-0.5 bg-slate-950 border border-emerald-500/50 rounded text-center text-emerald-400 font-bold"
                        />
                      </div>

                      <div className="flex items-center gap-1.5" title="Cantidad total de frames en la fila">
                        <span className="text-slate-400">Frames:</span>
                        <input
                          type="number"
                          min="1"
                          max="30"
                          value={anim.frameCount}
                          onChange={(e) =>
                            handleUpdateAnimation(animKey, { frameCount: Number(e.target.value) })
                          }
                          className="w-12 px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-center text-white"
                        />
                      </div>

                      {/* Attack Damage & Hit Frame controls */}
                      {(animKey.includes('attack') || animKey === 'finish' || anim.attackFrame !== undefined) && (
                        <>
                          <div className="flex items-center gap-1.5" title="Frame donde impacta el golpe">
                            <span className="text-rose-400">Golpe Fr:</span>
                            <input
                              type="number"
                              min="0"
                              max={Math.max(0, anim.frameCount - 1)}
                              value={anim.attackFrame ?? 1}
                              onChange={(e) =>
                                handleUpdateAnimation(animKey, { attackFrame: Number(e.target.value) })
                              }
                              className="w-12 px-1.5 py-0.5 bg-slate-950 border border-rose-500/50 rounded text-center text-rose-300 font-bold"
                            />
                          </div>

                           <div className="flex items-center gap-1.5" title="Puntos de daño que inflige este ataque">
                            <span className="text-red-400">Daño:</span>
                            <input
                              type="number"
                              min="1"
                              max="100"
                              value={anim.damage ?? 15}
                              onChange={(e) =>
                                handleUpdateAnimation(animKey, { damage: Number(e.target.value) })
                              }
                              className="w-12 px-1.5 py-0.5 bg-slate-950 border border-red-500/50 rounded text-center text-red-300 font-bold"
                            />
                          </div>
                        </>
                      )}

                      {/* Offset Y (Mover cuadro 128x128 arriba o abajo) */}
                      <div className="flex items-center gap-1" title="Mover cuadro arriba o abajo (px). Sube el cuadro con ▲ si se ve la fila inferior">
                        <span className="text-cyan-400 font-bold flex items-center gap-0.5">
                          <MoveVertical className="w-3 h-3" /> Ajuste Y:
                        </span>
                        <div className="flex items-center bg-slate-950 border border-cyan-500/50 rounded overflow-hidden">
                          <button
                            type="button"
                            onClick={() => handleUpdateAnimation(animKey, { offsetY: (anim.offsetY ?? 0) - 1 })}
                            className="px-1.5 py-0.5 hover:bg-cyan-900/50 text-cyan-300 font-bold text-xs cursor-pointer"
                            title="Subir cuadro 1px"
                          >
                            ▲
                          </button>
                          <input
                            type="number"
                            min="-64"
                            max="64"
                            value={anim.offsetY ?? 0}
                            onChange={(e) =>
                              handleUpdateAnimation(animKey, { offsetY: Number(e.target.value) })
                            }
                            className="w-11 px-1 py-0.5 bg-transparent text-center text-cyan-300 font-mono font-bold focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleUpdateAnimation(animKey, { offsetY: (anim.offsetY ?? 0) + 1 })}
                            className="px-1.5 py-0.5 hover:bg-cyan-900/50 text-cyan-300 font-bold text-xs cursor-pointer"
                            title="Bajar cuadro 1px"
                          >
                            ▼
                          </button>
                        </div>
                        <span className="text-[10px] text-slate-400">px</span>
                      </div>
                    </div>
                  </div>

                  {/* Frame Strip Row (Matches user screenshots with 0, 1, 2, 3, 4, 5...) */}
                  <div className="relative overflow-x-auto pb-2 flex gap-2 items-end">
                    {Array.from({ length: anim.frameCount }).map((_, fIdx) => {
                      const isCurrentPlayingFrame = isSelected && previewFrame === fIdx;

                      return (
                        <div
                          key={fIdx}
                          onClick={() => {
                            setSelectedAnim(animKey);
                            setPreviewFrame(fIdx);
                            setIsPlaying(false);
                          }}
                          className={`flex-shrink-0 flex flex-col items-center gap-1 p-1 rounded border transition-colors ${
                            isCurrentPlayingFrame
                              ? 'bg-emerald-950/60 border-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                              : 'bg-slate-950/60 border-slate-800 hover:border-slate-600'
                          }`}
                        >
                          {/* Mini frame thumbnail */}
                          <div
                            className="bg-slate-900 border border-slate-800 rounded flex items-center justify-center overflow-hidden"
                            style={{
                              width: `${currentConfig.frameWidth * stripZoom}px`,
                              height: `${currentConfig.frameHeight * stripZoom}px`,
                            }}
                          >
                            <div
                              style={{
                                width: `${currentConfig.frameWidth}px`,
                                height: `${currentConfig.frameHeight}px`,
                                transform: `scale(${stripZoom})`,
                                transformOrigin: 'top left',
                                backgroundImage: `url(${currentConfig.spriteUrl})`,
                                backgroundPosition: `-${((anim.startFrame ?? 0) + fIdx) * currentConfig.frameWidth + (anim.offsetX ?? 0)}px -${anim.row * currentConfig.frameHeight + (anim.offsetY ?? 0)}px`,
                                backgroundRepeat: 'no-repeat',
                                imageRendering: 'pixelated',
                              }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-slate-400">{fIdx}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Green progress bar like user screenshot */}
                  <div className="w-full h-1 bg-slate-800 rounded overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-75"
                      style={{
                        width: isSelected
                          ? `${((previewFrame + 1) / anim.frameCount) * 100}%`
                          : '0%',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* RIGHT: LIVE INSPECTOR & SPRITE CONTROLS (25% WIDTH) */}
          <div className="lg:col-span-4 p-4 bg-[#111724] flex flex-col justify-between overflow-y-auto space-y-4">
            {/* Live Inspector Preview Box */}
            <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="font-fighter font-bold text-xs uppercase text-emerald-400 flex items-center gap-1.5">
                  <Eye className="w-4 h-4" /> Vista Previa En Vivo
                </span>
                <button
                  onClick={() => setShowHitbox(!showHitbox)}
                  className={`text-xs px-2 py-0.5 rounded font-mono flex items-center gap-1 border ${
                    showHitbox
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  <Crosshair className="w-3 h-3" /> Caja
                </button>
              </div>

              {/* Canvas viewport */}
              <div className="relative w-full flex items-center justify-center rounded-lg border border-slate-700/60 overflow-hidden shadow-inner bg-slate-950">
                <canvas ref={previewCanvasRef} className="max-w-full h-auto pixelated" />
              </div>

              {/* Inspector Controls */}
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="p-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors"
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <span className="text-xs font-mono text-slate-300">
                    Frame: <strong className="text-emerald-400">{previewFrame}</strong>
                  </span>
                </div>

                <div className="flex items-center gap-1 font-mono text-xs text-slate-400">
                  <ZoomOut className="w-3 h-3" />
                  <input
                    type="range"
                    min="0.5"
                    max="2.5"
                    step="0.1"
                    value={previewZoom}
                    onChange={(e) => setPreviewZoom(Number(e.target.value))}
                    className="w-16 accent-emerald-500"
                  />
                  <ZoomIn className="w-3 h-3" />
                </div>
              </div>
            </div>

            {/* FINE TUNING OFFSET CONTROLS (MOVER CUADRO ARRIBA / ABAJO / IZQ / DER) */}
            <div className="p-3 bg-slate-900/90 rounded-xl border border-cyan-500/40 text-slate-200">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                <span className="font-fighter font-bold text-xs uppercase text-cyan-400 flex items-center gap-1.5">
                  <MoveVertical className="w-4 h-4" /> Ajuste del Cuadro 128x128
                </span>
                <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-500/30 font-bold">
                  {currentConfig.animations[selectedAnim]?.label?.split(' ')[0] || selectedAnim} (Fila {currentConfig.animations[selectedAnim]?.row ?? 0})
                </span>
              </div>

              <p className="text-[11px] text-slate-400 mb-2 leading-snug">
                Si se asoma la fila inferior (ej. después de fila 8), pulsa <strong className="text-cyan-300">Subir</strong> para encuadrar más arriba:
              </p>

              {/* D-Pad Buttons for Shifting Frame */}
              <div className="grid grid-cols-3 gap-1.5 font-mono text-xs">
                {/* Row 1: Sube 4px */}
                <div />
                <button
                  type="button"
                  onClick={() => handleNudgeOffset(0, -4)}
                  className="py-1 px-2 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/50 rounded text-cyan-300 font-bold text-center transition-colors cursor-pointer"
                  title="Subir cuadro 4 píxeles"
                >
                  ▲▲ Sube 4px
                </button>
                <div />

                {/* Row 2: Izq 1px, Sube 1px, Der 1px */}
                <button
                  type="button"
                  onClick={() => handleNudgeOffset(-1, 0)}
                  className="py-1 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-slate-300 font-bold text-center transition-colors cursor-pointer"
                  title="Mover cuadro 1px a la izquierda"
                >
                  ◀ Izq 1px
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeOffset(0, -1)}
                  className="py-1 px-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-bold text-center shadow transition-colors cursor-pointer"
                  title="Subir cuadro 1 píxel"
                >
                  ▲ Sube 1px
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeOffset(1, 0)}
                  className="py-1 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-slate-300 font-bold text-center transition-colors cursor-pointer"
                  title="Mover cuadro 1px a la derecha"
                >
                  ▶ Der 1px
                </button>

                {/* Row 3: Baja 1px */}
                <div />
                <button
                  type="button"
                  onClick={() => handleNudgeOffset(0, 1)}
                  className="py-1 px-2 bg-cyan-900/60 hover:bg-cyan-800 border border-cyan-500/40 rounded text-cyan-300 font-bold text-center transition-colors cursor-pointer"
                  title="Bajar cuadro 1 píxel"
                >
                  ▼ Baja 1px
                </button>
                <div />

                {/* Row 4: Baja 4px */}
                <div />
                <button
                  type="button"
                  onClick={() => handleNudgeOffset(0, 4)}
                  className="py-1 px-2 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/50 rounded text-cyan-300 font-bold text-center transition-colors cursor-pointer"
                  title="Bajar cuadro 4 píxeles"
                >
                  ▼▼ Baja 4px
                </button>
                <div />
              </div>

              {/* Offset readout & Reset */}
              <div className="mt-2.5 pt-2 border-t border-slate-800 flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Y:</span>
                  <span className={`font-bold ${((currentConfig.animations[selectedAnim]?.offsetY ?? 0) !== 0) ? 'text-cyan-300' : 'text-slate-500'}`}>
                    {(currentConfig.animations[selectedAnim]?.offsetY ?? 0)} px
                  </span>
                  <span className="text-slate-400 ml-2">X:</span>
                  <span className={`font-bold ${((currentConfig.animations[selectedAnim]?.offsetX ?? 0) !== 0) ? 'text-cyan-300' : 'text-slate-500'}`}>
                    {(currentConfig.animations[selectedAnim]?.offsetX ?? 0)} px
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleResetOffset}
                  className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded border border-slate-700 text-[10px] cursor-pointer"
                  title="Reiniciar desplazamiento a 0"
                >
                  ↺ Reset (0,0)
                </button>
              </div>

              {/* Copy offset to rows >= 8 */}
              {(currentConfig.animations[selectedAnim]?.offsetY ?? 0) !== 0 && (
                <div className="mt-2 pt-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => handleApplyOffsetYToRowAndAbove(currentConfig.animations[selectedAnim]?.row ?? 8)}
                    className="w-full py-1 px-2 bg-cyan-950/90 hover:bg-cyan-900 border border-cyan-500/50 rounded text-cyan-300 text-[10px] font-mono text-center transition-colors cursor-pointer"
                  >
                    Copiar Y ({currentConfig.animations[selectedAnim]?.offsetY}px) a filas ≥ {currentConfig.animations[selectedAnim]?.row ?? 8}
                  </button>
                </div>
              )}
            </div>

            {/* DRAG & DROP FILE ZONE FOR FELICIA.PNG */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) handleFileUpload(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              className="p-4 border-2 border-dashed border-emerald-500/40 hover:border-emerald-400 bg-slate-900/50 rounded-xl flex flex-col items-center justify-center text-center cursor-pointer transition-colors group"
            >
              <Upload className="w-8 h-8 text-emerald-400 group-hover:scale-110 transition-transform mb-2" />
              <p className="font-fighter font-bold text-xs uppercase text-slate-200">
                Arrastra aquí tu sprite sheet PNG
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Compatible con felicia.png o cualquier archivo de 200x200
              </p>
            </div>

            {/* Quick Calibration Guide */}
            <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1.5">
              <span className="font-fighter font-bold text-amber-400 uppercase text-[11px] flex items-center gap-1">
                <FileCode className="w-3.5 h-3.5" /> Calibración Rápida
              </span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                • <strong>Ancho/Altura:</strong> 200 x 200 píxeles por casilla.
                <br />
                • <strong>Escala:</strong> 0.6 recomendada para stream overlay.
                <br />
                • <strong>Filas estándar de Felicia:</strong> 0=Idle (14f), 1=Walk (12f), 3=Jump (8f), 4=Intro (18f), 5=Attack (12f), 6=Dance (6f).
              </p>
            </div>

            {/* CLOSE & SAVE ACTION */}
            <button
              onClick={onClose}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-fighter font-bold text-sm uppercase rounded-lg shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Check className="w-4 h-4" /> Guardar y Regresar a la Pelea
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
