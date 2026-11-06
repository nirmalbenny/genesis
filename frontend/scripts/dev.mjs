// `npm run dev`: opens a Cloudflare quick tunnel to the functions emulator, then starts Vite pointed at it.
// Why: Chrome's Local Network Access blocks the Sandpack preview (a public origin) from calling 127.0.0.1,
// so in local dev the functions must be reached over a public HTTPS URL. Quick-tunnel URLs change on every
// start, so the URL is read from cloudflared and handed to Vite via VITE_FUNCTIONS_BASE_URL (process env
// overrides .env.local; nothing is written to disk). Ctrl+C stops both.
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const FUNCTIONS_PORT = 5001
const VITE_PORT = 5173 // must match APP_URL in functions/.env (the OAuth callback redirects there)
const READY_TIMEOUT_MS = 90_000

const root = new URL('../../', import.meta.url)
const projectId = JSON.parse(readFileSync(new URL('.firebaserc', root), 'utf8')).projects.default
const vite = new URL('../node_modules/.bin/vite', import.meta.url).pathname
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function startVite(env = {}) {
  const child = spawn(vite, ['--port', String(VITE_PORT), '--strictPort'], { stdio: 'inherit', env: { ...process.env, ...env } })
  child.on('exit', (code) => process.exit(code ?? 0))
  return child
}

async function reachable(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(4000) })
    return true // any HTTP response (even 401/404) means DNS and the tunnel work
  } catch {
    return false
  }
}

if (spawnSync('cloudflared', ['--version']).error) {
  console.warn('\n⚠  cloudflared not found (brew install cloudflared). Starting Vite without a tunnel;')
  console.warn('   the live preview cannot reach the local functions in Chrome.\n')
  startVite()
} else {
  if (!(await reachable(`http://127.0.0.1:${FUNCTIONS_PORT}`))) {
    console.warn(`\n⚠  Nothing on port ${FUNCTIONS_PORT} yet. Start the emulators in another terminal: firebase emulators:start\n`)
  }

  const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${FUNCTIONS_PORT}`, '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let viteChild = null
  const stop = () => {
    tunnel.kill()
    viteChild?.kill()
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  tunnel.on('exit', (code) => {
    console.error(`\n✖  cloudflared exited (code ${code}). Stopping the dev server.`)
    viteChild?.kill()
    process.exit(1)
  })

  // cloudflared prints the quick-tunnel URL on stderr.
  const tunnelUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('cloudflared did not report a tunnel URL')), READY_TIMEOUT_MS)
    const onData = (chunk) => {
      const match = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (match) {
        clearTimeout(timer)
        resolve(match[0])
      }
    }
    tunnel.stdout.on('data', onData)
    tunnel.stderr.on('data', onData)
  }).catch((e) => {
    console.error(`\n✖  ${e.message}`)
    stop()
    process.exit(1)
  })

  // A new quick tunnel takes a few seconds before its hostname resolves.
  const base = `${tunnelUrl}/${projectId}/us-central1`
  process.stdout.write(`\n⏳ Waiting for ${tunnelUrl} to come online`)
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (!(await reachable(`${base}/api`))) {
    if (Date.now() > deadline) {
      console.error('\n✖  The tunnel did not come online in time. Try again.')
      stop()
      process.exit(1)
    }
    process.stdout.write('.')
    await sleep(2000)
  }

  console.log(`\n\n✔  Tunnel ready: ${tunnelUrl}`)
  console.log(`   Functions base: ${base}\n`)
  viteChild = startVite({ VITE_FUNCTIONS_BASE_URL: base })
}
