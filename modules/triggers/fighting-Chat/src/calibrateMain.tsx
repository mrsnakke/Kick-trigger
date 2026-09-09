import { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { CharacterConfig, BackgroundMode, ViewLayout } from './types/fighter';
import { SpriteCalibrator } from './components/SpriteCalibrator';
import {
  refreshConfig,
  saveCharacterConfig,
  saveCustomSpriteImage,
  exportConfigToJson,
  importConfigFromJson,
} from './utils/storage';
import { saveConfig } from './utils/api';
import { ASSET_MAID_CONFIG, generateMaidSpriteSheet } from './utils/defaultSprites';
import { Download, Upload, RotateCcw, Save, ArrowLeft } from 'lucide-react';

function defaultP1(): CharacterConfig {
  return {
    ...ASSET_MAID_CONFIG,
    id: 'p1',
    name: 'PJ1 Maid',
    spriteUrl: generateMaidSpriteSheet('red'),
    isCustomImage: false,
  };
}

function defaultP2(): CharacterConfig {
  return {
    ...ASSET_MAID_CONFIG,
    id: 'p2',
    name: 'PJ2 Rival',
    spriteUrl: generateMaidSpriteSheet('blue'),
    isCustomImage: false,
    colorTheme: '#3B82F6',
  };
}

/**
 * Página independiente de calibración: ajusta imágenes, animaciones,
 * escenario y exporta/importa la configuración en JSON.
 */
export default function CalibrationPage() {
  const [p1Config, setP1Config] = useState<CharacterConfig | null>(null);
  const [p2Config, setP2Config] = useState<CharacterConfig | null>(null);
  const [background, setBackground] = useState<BackgroundMode>('transparent');
  const [layout, setLayout] = useState<ViewLayout>('full-arena');
  const [status, setStatus] = useState('Configuración local en data/config.json');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    refreshConfig()
      .then((cfg) => {
        // Un config parcial (p.ej. {name:'X'}) no debe tumbar al personaje: se rellenan los campos que falten con los defaults.
        setP1Config(cfg.p1 ? { ...defaultP1(), ...cfg.p1 } : defaultP1());
        setP2Config(cfg.p2 ? { ...defaultP2(), ...cfg.p2 } : defaultP2());
        if (cfg.match) {
          setBackground(cfg.match.background || 'transparent');
          setLayout(cfg.match.layout || 'full-arena');
        }
      })
      .catch(() => {
        setP1Config(defaultP1());
        setP2Config(defaultP2());
      });
  }, []);

  const handleUpdateCfg = async (id: 'p1' | 'p2', cfg: CharacterConfig) => {
    let spriteUrl = cfg.spriteUrl;
    if (cfg.spriteUrl?.startsWith('data:')) {
      spriteUrl = await saveCustomSpriteImage(id, cfg.spriteUrl);
    }
    const saved = { ...cfg, spriteUrl };
    if (id === 'p1') setP1Config(saved);
    else setP2Config(saved);
    saveConfig({ [id]: saved }).catch(() => {});
    setStatus('Configuración guardada en data/config.json');
  };

  const handleApplyToBoth = async (cfg: CharacterConfig) => {
    let spriteUrl = cfg.spriteUrl;
    if (cfg.spriteUrl?.startsWith('data:')) {
      const url1 = await saveCustomSpriteImage('p1', cfg.spriteUrl);
      const url2 = await saveCustomSpriteImage('p2', cfg.spriteUrl);
      spriteUrl = url1;
      const _ = url2;
    }
    const p1 = { ...cfg, id: 'p1', spriteUrl, name: cfg.name || 'PJ1' };
    const p2 = { ...cfg, id: 'p2', spriteUrl, name: cfg.name ? `${cfg.name} (Rival)` : 'PJ2', colorTheme: '#60A5FA' };
    setP1Config(p1);
    setP2Config(p2);
    saveConfig({ p1, p2 }).catch(() => {});
    setStatus('Sprite y calibración aplicados a PJ1 y PJ2');
  };

  const handleExportJson = () => {
    exportConfigToJson(
      {
        p1: { ...(p1Config || defaultP1()), stats: undefined },
        p2: { ...(p2Config || defaultP2()), stats: undefined },
        match: { background, layout },
      } as never,
      'stream-fighter-config.json'
    );
    setStatus('Configuración exportada a JSON');
  };

  const handleImportJson = async (file: File) => {
    try {
      const parsed = await importConfigFromJson(file);
      const data = parsed as unknown as {
        p1: CharacterConfig;
        p2: CharacterConfig;
        match?: { background: BackgroundMode; layout: ViewLayout; maxWins?: number };
      };
      if (!data.p1 || !data.p2) throw new Error('JSON inválido: necesita p1 y p2');
      if (data.p1.spriteUrl?.startsWith('data:')) {
        const url = await saveCustomSpriteImage('p1', data.p1.spriteUrl);
        data.p1.spriteUrl = url;
      }
      if (data.p2.spriteUrl?.startsWith('data:')) {
        const url = await saveCustomSpriteImage('p2', data.p2.spriteUrl);
        data.p2.spriteUrl = url;
      }
      setP1Config({ ...data.p1, id: 'p1' });
      setP2Config({ ...data.p2, id: 'p2' });
      await saveConfig({
        p1: { ...data.p1, id: 'p1', stats: undefined },
        p2: { ...data.p2, id: 'p2', stats: undefined },
        match: data.match ? { ...data.match, maxWins: data.match.maxWins || 3 } : { background, layout, maxWins: 3 },
      });
      setStatus('Configuración importada desde JSON');
    } catch (err) {
      setStatus(`Error al importar: ${err instanceof Error ? err.message : 'JSON inválido'}`);
    }
  };

  const handleReset = async () => {
    location.reload();
  };

  const changeBackground = (mode: BackgroundMode) => {
    setBackground(mode);
    saveConfig({ match: { background: mode, layout, maxWins: 3 } }).catch(() => {});
  };

  const changeLayout = (ly: ViewLayout) => {
    setLayout(ly);
    saveConfig({ match: { background, layout: ly, maxWins: 3 } }).catch(() => {});
  };

  if (!p1Config || !p2Config) return null;

  return (
    <div className="h-screen w-screen bg-[#0a0e17] flex flex-col overflow-hidden">
      {/* HEADER: título + match settings + JSON actions */}
      <header className="px-4 py-2 bg-[#0b101b] border-b border-slate-800 flex flex-wrap items-center gap-3 z-20">
        <a
          href="/"
          className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 font-mono text-xs font-bold"
          title="Volver al escenario OBS"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Escenario
        </a>
        <span className="font-fighter font-bold text-sm tracking-wider text-slate-100 uppercase">
          Calibración 1v1
        </span>

        <div className="hidden md:flex items-center gap-1.5 mx-auto text-[11px] font-mono text-slate-400">
          <span className="text-slate-400">Fondo:</span>
          <button
            onClick={() => changeBackground('transparent')}
            className={`px-2 py-0.5 rounded cursor-pointer ${
              background === 'transparent' ? 'bg-blue-600 text-white font-bold' : 'bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            Transparente
          </button>
          <button
            onClick={() => changeBackground('stage-dojo')}
            className={`px-2 py-0.5 rounded cursor-pointer ${
              background === 'stage-dojo' ? 'bg-purple-700 text-white font-bold' : 'bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            Dojo
          </button>
          <button
            onClick={() => changeBackground('stage-dark')}
            className={`px-2 py-0.5 rounded cursor-pointer ${
              background === 'stage-dark' ? 'bg-slate-700 text-white font-bold' : 'bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            Cyber
          </button>
          <button
            onClick={() => changeBackground('green')}
            className={`px-2 py-0.5 rounded cursor-pointer ${
              background === 'green' ? 'bg-green-600 text-white font-bold' : 'bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            Croma
          </button>

          <span className="text-slate-400 ml-3">Diseño:</span>
          <button
            onClick={() => changeLayout('full-arena')}
            className={`px-2 py-0.5 rounded cursor-pointer ${
              layout === 'full-arena' ? 'bg-emerald-600 text-white font-bold' : 'bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            Completo
          </button>
          <button
            onClick={() => changeLayout('bottom-stream')}
            className={`px-2 py-0.5 rounded cursor-pointer ${
              layout === 'bottom-stream' ? 'bg-emerald-600 text-white font-bold' : 'bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            Barra
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={handleExportJson}
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-300 font-mono text-xs rounded flex items-center gap-1.5 cursor-pointer"
            title="Descargar configuración como JSON"
          >
            <Download className="w-3.5 h-3.5" /> Exportar JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportJson(file);
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-sky-300 font-mono text-xs rounded flex items-center gap-1.5 cursor-pointer"
            title="Importar configuración desde JSON"
          >
            <Upload className="w-3.5 h-3.5" /> Importar JSON
          </button>
          <button
            onClick={handleReset}
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 font-mono text-xs rounded flex items-center gap-1.5 cursor-pointer"
            title="Recargar desde disco"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Recargar
          </button>
          <span className="hidden lg:inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-400">
            <Save className="w-3 h-3" /> {status}
          </span>
        </div>
      </header>

      {/* CALIBRATOR (ocupa el resto de la pantalla) */}
      <div className="flex-1 min-h-0 relative">
        <SpriteCalibrator
          p1Config={p1Config}
          p2Config={p2Config}
          initialFighter="p1"
          onUpdateP1Config={(cfg) => handleUpdateCfg('p1', cfg)}
          onUpdateP2Config={(cfg) => handleUpdateCfg('p2', cfg)}
          onApplyToBoth={handleApplyToBoth}
          onClose={() => (window.location.href = '/')}
          embedded
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<CalibrationPage />);