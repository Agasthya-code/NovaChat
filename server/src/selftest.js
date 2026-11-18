import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { unlinkSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import Database from 'better-sqlite3'
import { io as createSocket } from 'socket.io-client'

const here = dirname(fileURLToPath(import.meta.url))
const suffix = randomUUID().slice(0, 8)
const password = `T-${randomUUID()}-aA9!`
const testDbPath = join(tmpdir(), `novachat-selftest-${suffix}.sqlite`)
const clients = []
const processes = []

async function freePort() {
  const listener = createNetServer()
  await new Promise((resolveListen, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolveListen))
  const port = listener.address().port
  await new Promise(resolveClose => listener.close(resolveClose))
  return port
}

async function waitForHttp(url, process, label) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (process.exitCode !== null) throw new Error(`${label} exited with code ${process.exitCode}`)
    try { const response = await fetch(url); if (response.ok) return response } catch { /* process is still starting */ }
    await delay(200)
  }
  throw new Error(`${label} did not become ready at ${url}`)
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...options.headers } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${body.error ?? 'unknown error'}`)
  return body
}

function connect(baseUrl, token) {
  return new Promise((resolveConnect, reject) => {
    const socket = createSocket(baseUrl, { auth: { token }, reconnection: false, timeout: 5000 })
    clients.push(socket)
    socket.once('connect', () => resolveConnect(socket))
    socket.once('connect_error', reject)
  })
}

function waitFor(socket, event, predicate = () => true) {
  return new Promise((resolveEvent, reject) => {
    const timeout = setTimeout(() => { socket.off(event, listener); reject(new Error(`Timed out waiting for ${event}`)) }, 5000)
    const listener = value => { if (predicate(value)) { clearTimeout(timeout); socket.off(event, listener); resolveEvent(value) } }
    socket.on(event, listener)
  })
}

try {
  const backendPort = await freePort()
  const frontendPort = await freePort()
  const backendUrl = `http://127.0.0.1:${backendPort}`
  const clientUrl = `http://127.0.0.1:${frontendPort}`
  const serverProcess = spawn(process.execPath, ['src/server.js'], { cwd: resolve(here, '..'), stdio: 'inherit', env: { ...process.env, PORT: String(backendPort), HOST: '127.0.0.1', DB_PATH: testDbPath, JWT_SECRET: randomUUID() } })
  processes.push(serverProcess)
  const healthResponse = await waitForHttp(`${backendUrl}/api/health`, serverProcess, 'API server')
  const health = await healthResponse.json()
  if (health.status !== 'ok' || health.service !== 'novachat-api') throw new Error(`Unexpected health response: ${JSON.stringify(health)}`)

  const viteCli = resolve(here, '../../client/node_modules/vite/bin/vite.js')
  const viteProcess = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], { cwd: resolve(here, '../../client'), stdio: 'inherit', env: { ...process.env, VITE_API_URL: '/api', VITE_API_PROXY_TARGET: backendUrl, VITE_SOCKET_URL: '' } })
  processes.push(viteProcess)
  await waitForHttp(clientUrl, viteProcess, 'Vite server')
  const proxiedHealth = await request(clientUrl, '/api/health')
  if (proxiedHealth.service !== 'novachat-api') throw new Error('Vite API proxy did not reach the NovaChat backend')
  const corsResponse = await fetch(`${backendUrl}/api/health`, { headers: { origin: clientUrl } })
  if (corsResponse.headers.get('access-control-allow-origin') !== clientUrl) throw new Error('Backend CORS did not allow the local Vite origin')

  const a = await request(clientUrl, '/api/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Test User A', username: `usera_${suffix}`, email: `usera-${suffix}@test.invalid`, password }) })
  const b = await request(clientUrl, '/api/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Test User B', username: `userb_${suffix}`, email: `userb-${suffix}@test.invalid`, password }) })
  if (a.user.password_hash || a.user.passwordHash) throw new Error('Registration response exposed a password hash')
  const testDb = new Database(testDbPath, { readonly: true })
  const storedHash = testDb.prepare('SELECT password_hash AS passwordHash FROM users WHERE id = ?').get(a.user.id)?.passwordHash
  testDb.close()
  if (!storedHash?.startsWith('$2') || storedHash === password) throw new Error('The password was not stored as a bcrypt hash')

  const duplicate = await fetch(`${clientUrl}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Duplicate User', username: `other_${suffix}`, email: `usera-${suffix}@test.invalid`, password }) })
  if (duplicate.status !== 409) throw new Error(`Duplicate email should return 409, got ${duplicate.status}`)
  const login = await request(clientUrl, '/api/auth/login', { method: 'POST', body: JSON.stringify({ email: `usera-${suffix}@test.invalid`, password }) })
  if (login.user.id !== a.user.id || !login.token) throw new Error('Login did not return the registered account and an authenticated token')

  const search = await request(clientUrl, `/api/users/search?q=userb_${suffix}`, { token: a.token })
  if (!search.users.some(person => person.id === b.user.id) || search.users.some(person => person.id === a.user.id)) throw new Error('Account search did not return only the other account')
  const created = await request(clientUrl, '/api/conversations', { method: 'POST', token: a.token, body: JSON.stringify({ userId: b.user.id }) })
  const conversationId = created.conversation.id
  const socketA = await connect(clientUrl, a.token)
  const socketB = await connect(clientUrl, b.token)

  const receivedByA = waitFor(socketA, 'message:new', message => message.conversationId === conversationId && message.senderId === a.user.id)
  const receivedByB = waitFor(socketB, 'message:new', message => message.conversationId === conversationId && message.senderId === a.user.id)
  await new Promise((resolveAck, reject) => socketA.emit('message:send', { conversationId, content: 'Hello from account A', senderId: b.user.id }, result => result?.error ? reject(new Error(result.error)) : resolveAck(result)))
  const firstAtA = await receivedByA
  const firstAtB = await receivedByB
  if (firstAtA.id !== firstAtB.id) throw new Error('The two sockets received different message IDs')

  const readReceipt = waitFor(socketA, 'message:status', status => status.conversationId === conversationId && status.status === 'read')
  socketB.emit('message:read', { conversationId })
  await readReceipt
  const replyAtA = waitFor(socketA, 'message:new', message => message.conversationId === conversationId && message.senderId === b.user.id)
  const sentReply = await new Promise((resolveAck, reject) => socketB.emit('message:send', { conversationId, content: 'Hello back from account B' }, result => result?.error ? reject(new Error(result.error)) : resolveAck(result)))
  await replyAtA
  await request(clientUrl, `/api/conversations/${conversationId}/read`, { method: 'POST', token: a.token })
  const history = await request(clientUrl, `/api/conversations/${conversationId}/messages`, { token: login.token })
  if (history.messages.length !== 2 || history.messages[1].id !== sentReply.message.id) throw new Error('Conversation history did not persist after re-authentication')
  console.log('PASS: health, Vite proxy/CORS, registration, bcrypt, duplicate rejection, login, search, conversation creation, live two-way messaging, read receipts, and persisted history.')
} catch (error) {
  console.error('FAIL:', error.message, error.cause?.message ?? '')
  process.exitCode = 1
} finally {
  for (const socket of clients) socket.disconnect()
  for (const child of processes) if (child.exitCode === null) child.kill()
  await Promise.all(processes.map(child => new Promise(resolveExit => {
    if (child.exitCode !== null) resolveExit()
    else { const timeout = setTimeout(resolveExit, 2000); child.once('exit', () => { clearTimeout(timeout); resolveExit() }) }
  })))
  for (const ending of ['', '-shm', '-wal']) { try { unlinkSync(`${testDbPath}${ending}`) } catch { /* temporary database file may not exist */ } }
}
