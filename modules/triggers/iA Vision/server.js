const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const os = require("node:os");

const MODEL = process.env.VISION_MODEL || "deepseek-v4-flash-vision-exp";
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

module.exports = { capture, analyze };