import dotenv from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve configuration from server/.env regardless of which directory starts Node.
const here = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(here, '../.env') })

const [expressModule, corsModule, httpModule, socketModule, authModule, userModule, conversationModule, middlewareModule, messagingModule, databaseModule] = await Promise.all([
  import('express'), import('cors'), import('node:http'), import('socket.io'),
  import('./routes/auth.js'), import('./routes/users.js'), import('./routes/conversations.js'),
  import('./middleware/auth.js'), import('./sockets/messaging.js'), import('./config/database.js'),
])

const express = expressModule.default
const cors = corsModule.default
const { createServer } = httpModule
const { Server } = socketModule
const app = express()
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('Set JWT_SECRET before starting NovaChat in production.')

const configuredOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174')
  .split(',').map(origin => origin.trim()).filter(Boolean)
function isAllowedOrigin(origin) {
  if (!origin || configuredOrigins.includes(origin)) return true
  if (process.env.NODE_ENV === 'production') return false
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
  } catch { return false }
}
const checkOrigin = (origin, callback) => callback(null, isAllowedOrigin(origin))
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: checkOrigin, methods: ['GET', 'POST'] } })
const onlineUsers = new Map()
app.set('io', io)
app.set('onlineUsers', onlineUsers)
app.use(cors({ origin: checkOrigin }))
app.use(express.json({ limit: '16kb' }))
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'novachat-api' }))
app.use('/api/auth', authModule.default)
app.use('/api/users', userModule.default)
app.use('/api/conversations', conversationModule.default)
app.use((error, _req, res, _next) => {
  console.error('[NovaChat] Request failed:', error)
  res.status(500).json({ error: 'Something went wrong. Please try again.' })
})
io.use(middlewareModule.authenticateSocket)
messagingModule.installMessaging(io, onlineUsers)

const port = Number(process.env.PORT) || 3001
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1')
httpServer.on('error', error => {
  if (error.code === 'EADDRINUSE') console.error(`[NovaChat] Port ${port} is already in use. Stop the process using it or set PORT to another available port.`)
  else console.error('[NovaChat] Server startup error:', error)
  process.exit(1)
})
httpServer.listen(port, host, () => console.log(`[NovaChat] API and Socket.IO listening at http://${host}:${port}; SQLite initialized.`))

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => httpServer.close(() => process.exit(0)))
