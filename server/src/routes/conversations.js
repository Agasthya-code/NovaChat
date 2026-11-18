import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { db, isConversationMember } from '../config/database.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()
router.use(authenticate)

router.get('/', (req, res) => {
  const rows = db.prepare(`SELECT c.id, c.created_at AS createdAt, other.id AS userId, other.name, other.username, other.avatar,
    m.id AS lastId, m.content AS lastMessage, m.created_at AS lastAt, m.sender_id AS lastSenderId,
    (SELECT COUNT(*) FROM messages unread WHERE unread.conversation_id = c.id AND unread.sender_id != ? AND unread.read_at IS NULL) AS unread
    FROM conversations c
    JOIN conversation_participants mine ON mine.conversation_id = c.id AND mine.user_id = ?
    JOIN conversation_participants peer ON peer.conversation_id = c.id AND peer.user_id != ?
    JOIN users other ON other.id = peer.user_id
    LEFT JOIN messages m ON m.id = (SELECT id FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
    ORDER BY COALESCE(m.created_at, c.created_at) DESC`).all(req.userId, req.userId, req.userId)
  const online = req.app.get('onlineUsers')
  res.json({ conversations: rows.map(({ id, createdAt, userId, name, username, avatar, lastId, lastMessage, lastAt, lastSenderId, unread }) => ({ id, createdAt, user: { id: userId, name, username, avatar, online: online.has(userId) }, lastMessage: lastId ? { id: lastId, content: lastMessage, createdAt: lastAt, senderId: lastSenderId } : null, unread })) })
})

router.post('/', (req, res) => {
  const otherUserId = typeof req.body.userId === 'string' ? req.body.userId : ''
  if (!otherUserId || otherUserId === req.userId) return res.status(400).json({ error: 'Choose another registered user.' })
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(otherUserId)) return res.status(404).json({ error: 'User not found.' })
  const pairKey = [req.userId, otherUserId].sort().join(':')
  let conversation = db.prepare('SELECT id, created_at AS createdAt FROM conversations WHERE pair_key = ?').get(pairKey)
  if (!conversation) {
    const id = randomUUID()
    const create = db.transaction(() => {
      db.prepare('INSERT INTO conversations (id, pair_key) VALUES (?, ?)').run(id, pairKey)
      const addParticipant = db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)')
      addParticipant.run(id, req.userId)
      addParticipant.run(id, otherUserId)
    })
    create()
    conversation = db.prepare('SELECT id, created_at AS createdAt FROM conversations WHERE id = ?').get(id)
  }
  const user = db.prepare('SELECT id, name, username, avatar FROM users WHERE id = ?').get(otherUserId)
  res.status(201).json({ conversation: { ...conversation, user: { ...user, online: req.app.get('onlineUsers').has(user.id) } } })
})

router.get('/:id/messages', (req, res) => {
  if (!isConversationMember(req.params.id, req.userId)) return res.status(404).json({ error: 'Conversation not found.' })
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100)
  const before = typeof req.query.before === 'string' ? req.query.before : null
  const rows = before
    ? db.prepare('SELECT id, conversation_id AS conversationId, sender_id AS senderId, content, created_at AS createdAt, delivered_at AS deliveredAt, read_at AS readAt FROM messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?').all(req.params.id, before, limit)
    : db.prepare('SELECT id, conversation_id AS conversationId, sender_id AS senderId, content, created_at AS createdAt, delivered_at AS deliveredAt, read_at AS readAt FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?').all(req.params.id, limit)
  res.json({ messages: rows.reverse() })
})

router.post('/:id/read', (req, res) => {
  if (!isConversationMember(req.params.id, req.userId)) return res.status(404).json({ error: 'Conversation not found.' })
  const now = new Date().toISOString()
  const changed = db.prepare('UPDATE messages SET read_at = ? WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL').run(now, req.params.id, req.userId)
  const senders = db.prepare('SELECT DISTINCT sender_id AS senderId FROM messages WHERE conversation_id = ? AND sender_id != ?').all(req.params.id, req.userId)
  const io = req.app.get('io')
  for (const sender of senders) io.to(`user:${sender.senderId}`).emit('message:status', { conversationId: req.params.id, status: 'read', at: now })
  res.json({ updated: changed.changes, readAt: now })
})

export default router
