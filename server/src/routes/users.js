import { Router } from 'express'
import { db } from '../config/database.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()
router.get('/search', authenticate, (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (query.length < 2) return res.json({ users: [] })
  const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`
  const users = db.prepare(`SELECT id, name, username, avatar FROM users WHERE id != ? AND (username LIKE ? ESCAPE '\\' COLLATE NOCASE OR name LIKE ? ESCAPE '\\' COLLATE NOCASE) ORDER BY username LIMIT 20`).all(req.userId, like, like)
  res.json({ users: users.map(user => ({ ...user, online: req.app.get('onlineUsers').has(user.id) })) })
})
export default router
