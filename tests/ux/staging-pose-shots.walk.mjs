// 站位姿势多视角回归截图（R13 子 agent 审查的素材源）。零额度：纯本地 3D 离屏渲染，不碰任何生成 API。
// 启 vite dev server（devlab 页是 dev-only 入口，不进 prod 构建）+ playwright chromium，
// 逐例（staging-shots.html?case=N）等 window.__shotsReady，把 __shots 各视角存成 PNG。
// 用法：node tests/ux/staging-pose-shots.walk.mjs   （可选 CASES=01,07 只跑指定例）
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, 'tests/ux/_stagingshot')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

// 用例数（与 stagingTestCases.ts 同步——直接数文件里的 id）
const casesSrc = fs.readFileSync(path.join(repoRoot, 'src/devlab/stagingTestCases.ts'), 'utf8')
const caseIds = [...casesSrc.matchAll(/id:\s*'(\d\d-[^']+)'/g)].map((m) => m[1])
const onlyFilter = (process.env.CASES || '').split(',').map((s) => s.trim()).filter(Boolean)

const PORT = 5191
const HOST = '127.0.0.1'
const BASE = `http://${HOST}:${PORT}`

function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url)
        if (res.ok || res.status === 404) return resolve()
      } catch { /* not up yet */ }
      if (Date.now() - start > timeoutMs) return reject(new Error('vite dev server 启动超时'))
      setTimeout(tick, 400)
    }
    tick()
  })
}

console.log('▶ 启动 vite dev server…')
const vite = spawn('npx', ['vite', '--host', HOST, '--port', String(PORT), '--strictPort'], {
  cwd: repoRoot,
  env: { ...process.env },
  stdio: ['ignore', 'pipe', 'pipe'],
})
vite.stdout.on('data', () => {})
vite.stderr.on('data', (d) => { const s = String(d); if (/error/i.test(s)) process.stderr.write(s) })

let browser
let exitCode = 0
try {
  await waitForServer(`${BASE}/staging-shots.html`)
  console.log(`  ✓ dev server up @ ${BASE}`)

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  const summary = []
  for (let i = 0; i < caseIds.length; i += 1) {
    const id = caseIds[i]
    if (onlyFilter.length && !onlyFilter.some((f) => id.startsWith(f))) continue
    await page.goto(`${BASE}/staging-shots.html?case=${i}`, { waitUntil: 'domcontentloaded' })
    let shots = null
    try {
      await page.waitForFunction(() => window.__shotsReady === true, { timeout: 30000 })
      shots = await page.evaluate(() => window.__shots)
    } catch (err) {
      console.log(`  ✗ ${id}: 渲染超时/无 __shots (${err.message})`)
      summary.push({ id, ok: false, views: 0 })
      continue
    }
    const views = Object.keys(shots || {})
    for (const v of views) {
      const b64 = String(shots[v]).replace(/^data:image\/png;base64,/, '')
      fs.writeFileSync(path.join(outDir, `${id}__${v}.png`), Buffer.from(b64, 'base64'))
    }
    console.log(`  ✓ ${id}: ${views.length} 视角 [${views.join(', ')}]`)
    summary.push({ id, ok: views.length >= 5, views: views.length })
  }

  fs.writeFileSync(path.join(outDir, '_summary.json'), JSON.stringify(summary, null, 2))
  const bad = summary.filter((s) => !s.ok)
  console.log(`\n═══ ${summary.length} 例，每例多视角 PNG → ${path.relative(repoRoot, outDir)} ═══`)
  if (errors.length) console.log(`console errors:\n  ${[...new Set(errors)].slice(0, 8).join('\n  ')}`)
  if (bad.length) { console.log(`✗ 渲染不全：${bad.map((b) => b.id).join(', ')}`); exitCode = 1 }
  else console.log('✓ 全部用例多视角渲染成功')
} catch (err) {
  console.log(`FAIL: ${err?.message || err}`)
  exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  vite.kill('SIGTERM')
}
process.exit(exitCode)
