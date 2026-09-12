const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const os = require("node:os");

const MODEL = process.env.VISION_MODEL || "deepseek-flash";
const DETAIL = process.env.VISION_DETAIL || "high";
const CAPTURE = path.join(__dirname, "capture.ps1");
const SHOT = path.join(os.tmpdir(), "ia-see-shot.jpg");

function capture() {
  return new Promise((resolve, reject) => {
    const ps = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    execFile(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", CAPTURE, "-OutFile", SHOT],
      (err) => err ? reject(err) : resolve(SHOT));
  });
}

async function analyze(apiKey, prompt) {
  await capture();
  const b64 = fs.readFileSync(SHOT).toString("base64");
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}`, detail: DETAIL } },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

const SYSTEM_PROCESSES = new Set([
  'svchost', 'csrss', 'dwm', 'sihost', 'ctfmon', 'conhost',
  'RuntimeBroker', 'dllhost', 'taskhostw', 'SearchIndexer',
  'fontdrvhost', 'Memory Compression', 'WmiPrvSE', 'dismhost',
  'SearchHost', 'ShellExperienceHost', 'TextInputHost',
  'ApplicationFrameHost', 'StartMenuExperienceHost', 'UserOOBEBroker',
  'xwcservices', 'BthSIRemote', 'juccsvr', 'NisSrv',
  'SecurityHealthService', 'MsMpEng', 'SearchProtocolHost',
  'SearchFilterHost', 'SgrmBroker', 'SgrmBroker.exe',
  'audiodg', 'lsass', 'services', 'smss', 'wininit', 'winlogon',
  'Idle', 'System', 'Registry', 'VBoxService', 'VBoxTray',
  'PowerToys', 'PowerToys.Run', 'SportingIndexer',
  'ShellInfrastructureHost', 'CompPkgSrv', 'GameBarServer',
  'OpenWith', 'PickerHost', 'SubmitReqReview',
  'chrome', 'opera', 'Code', 'YouTube Music',
  'Microsoft.Notes', 'NVIDIA Overlay', 'PowerToys.QuickAccess',
  'RazerAppEngine', 'SystemSettings',
]);

function parseRunningApps(raw) {
  try {
    let procs = JSON.parse(raw.trim());
    if (!Array.isArray(procs)) procs = [procs];
    const seen = new Set();
    const apps = [];
    for (const p of procs || []) {
      const name = (p.ProcessName || '').replace(/\.exe$/i, '');
      if (!name || SYSTEM_PROCESSES.has(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      apps.push({ name, title: p.MainWindowTitle });
    }
    return apps;
  } catch { return []; }
}

function getRunningApps() {
  return new Promise((resolve, reject) => {
    const ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const cmd = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object ProcessName, MainWindowTitle | ConvertTo-Json -Compress';
    execFile(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { encoding: 'utf8' }, (err, stdout) => {
      if (err) return reject(err);
      resolve(parseRunningApps(stdout));
    });
  });
}

if (require.main === module) {
  const raw = '[{"ProcessName":"svchost","MainWindowTitle":""},{"ProcessName":"VALORANT.exe","MainWindowTitle":"VALORANT"},{"ProcessName":"VALORANT.exe","MainWindowTitle":"VALORANT"},{"ProcessName":"cs2","MainWindowTitle":"Counter-Strike 2"},{"ProcessName":"GameBarServer","MainWindowTitle":"Xbox Game Bar"}]';
  const apps = parseRunningApps(raw);
  const names = apps.map(a => a.name);
  console.assert(apps.length === 2, 'esperaba 2 apps, hay ' + apps.length);
  console.assert(names.includes('VALORANT'), 'VALORANT filtrado');
  console.assert(names.includes('cs2'), 'cs2 faltante');
  console.assert(!names.includes('svchost'), 'svchost no filtrado');
  console.assert(apps.filter(a => a.name === 'VALORANT').length === 1, 'duplicado no eliminado');
  console.assert(apps.find(a => a.name === 'cs2').title === 'Counter-Strike 2', 'título incorrecto');
  console.log('OK: ' + JSON.stringify(apps));
}

module.exports = { capture, analyze, getRunningApps };