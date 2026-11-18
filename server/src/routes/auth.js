import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { db } from '../config/database.js'
import { authenticate, signToken } from '../middleware/auth.js'

const router = Router()
const publicUser = ({ id, name, username, email, avatar, created_at }) => ({ id, name, username, email, avatar, createdAt: created_at })

router.post('/register', async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
  const username = typeof req.body.username === 'string' ? req.body.username.trim().toLowerCase() : ''
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body.password === 'string' ? req.body.password : ''
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Name must be between 2 and 60 characters.' })
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–24 characters using letters, numbers, or underscores.' })
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' })
  if (password.length < 8 || password.length > 72) return res.status(400).json({ error: 'Password must be between 8 and 72 characters.' })
  const existing = db.prepare('SELECT email, username FROM users WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE').get(email, username)
  if (existing) return res.status(409).json({ error: existing.email.toLowerCase() === email ? 'That email is already registered.' : 'That username is already taken.' })
  const id = randomUUID()
  const avatar = name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()
  const passwordHash = await bcrypt.hash(password, 12)
  try {
    db.prepare('INSERT INTO users (id, name, username, email, password_hash, avatar) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, username, email, passwordHash, avatar)
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That email or username is already registered.' })
    throw error
  }
  const user = db.prepare('SELECT id, name, username, email, avatar, created_at FROM users WHERE id = ?').get(id)
  res.status(201).json({ token: signToken(id), user: publicUser(user) })
})

router.post('/login', async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body.password === 'string' ? req.body.password : ''
  const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email)
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' })
  res.json({ token: signToken(user.id), user: publicUser(user) })
})

router.get('/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT id, name, username, email, avatar, created_at FROM users WHERE id = ?').get(req.userId)
  if (!user) return res.status(401).json({ error: 'Account not found.' })
  res.json({ user: publicUser(user) })
})

export default router
