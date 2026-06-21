// 复用 Nomi app **已配置的文本模型**发 LLM 请求(给 loop 的查/修 agent 用)。
// 机制(照 tests/ux/r1-upload-verify.mjs 自解密范式):key 是 safeStorage 加密、绑 app 身份,
// 纯 Node 解不开 → 启动真 Nomi app(electron),密文传进主进程 safeStorage 解密 + 主进程内 fetch,
// 明文 key 不回传 Node。⚠️ 启的是真 app,会撞单实例锁 → **运行时 Nomi 必须关着**。
// 不让用户手填任何 env(effect-first):自动从 model-catalog.json 挑 enabled 文本模型。
import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readTextModelConfig() {
  const catalogPath = path.join(os.homedir(), "Library", "Application Support", "nomi", "model-catalog.json");
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const m = (catalog.models || []).find((x) => x.kind === "text" && x.enabled);
  if (!m) return null;
  const vendorKey = m.vendorKey ?? m.vendor;
  const vendor = (catalog.vendors || []).find((v) => v.key === vendorKey);
  const rec = (catalog.apiKeysByVendor || {})[vendorKey];
  if (!rec || !rec.apiKey || !vendor) return null;
  return {
    modelKey: m.modelKey ?? m.key,
    vendorKey,
    baseUrl: String(vendor.baseUrlHint || "").replace(/\/$/, ""),
    cipher: rec.apiKey,
    enc: rec.enc,
  };
}

let _app = null;
let _cfg = null;

export function loopAppLlmAvailable() {
  return readTextModelConfig() != null;
}
export function configuredModelLabel() {
  return _cfg ? `${_cfg.vendorKey}/${_cfg.modelKey}` : (readTextModelConfig() ? `${readTextModelConfig().vendorKey}/${readTextModelConfig().modelKey}` : "?");
}

async function ensureApp() {
  if (_app) return;
  _cfg = readTextModelConfig();
  if (!_cfg) throw new Error("model-catalog.json 里没有 enabled 的文本模型");
  _app = await electron.launch({ executablePath: require("electron"), args: ["."], cwd: repoRoot, env: { ...process.env } });
  await _app.firstWindow();
  await new Promise((r) => setTimeout(r, 1200));
}

/** 发一次 chat(主进程内解密+fetch)。返回 {content} 或 {error}。 */
export async function chatViaApp(system, user) {
  await ensureApp();
  return _app.evaluate(
    async ({ safeStorage }, a) => {
      let key = "";
      try {
        key = a.enc === "safeStorage" ? safeStorage.decryptString(Buffer.from(a.cipher, "base64")) : a.cipher;
      } catch (e) {
        return { error: "decrypt: " + String(e) };
      }
      if (!key) return { error: "decrypted empty (safeStorage 不可用?)" };
      try {
        const resp = await fetch(`${a.baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer " + key },
          body: JSON.stringify({
            model: a.modelKey,
            messages: [
              { role: "system", content: a.system },
              { role: "user", content: a.user },
            ],
            temperature: 0,
            response_format: { type: "json_object" },
          }),
        });
        if (!resp.ok) return { error: `${resp.status}: ${(await resp.text()).slice(0, 300)}` };
        const data = await resp.json();
        return { content: data.choices?.[0]?.message?.content ?? "" };
      } catch (e) {
        return { error: "fetch: " + String(e) };
      }
    },
    { cipher: _cfg.cipher, enc: _cfg.enc, baseUrl: _cfg.baseUrl, modelKey: _cfg.modelKey, system, user },
  );
}

export async function closeApp() {
  if (_app) {
    await _app.close();
    _app = null;
  }
}
