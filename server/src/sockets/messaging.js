import { randomUUID } from 'node:crypto'
import { db, isConversationMember } from '../config/database.js'

export function installMessaging(io, onlineUsers) {
  io.on('connection', socket => {
    const userId = socket.userId
    socket.join(`user:${userId}`)
    const userSockets = onlineUsers.get(userId) ?? new Set()
    userSockets.add(socket.id)
    onlineUsers.set(userId, userSockets)
    io.emit('presence:update', { userId, online: true })

    socket.on('message:send', (payload, acknowledge = () => {}) => {
      const conversationId = typeof payload?.conversationId === 'string' ? payload.conversationId : ''
      const content = typeof payload?.content === 'string' ? payload.content.trim() : ''
      if (!conversationId || !content || content.length > 4000) return acknowledge({ error: 'Message must contain 1–4000 characters.' })
      if (!isConversationMember(conversationId, userId)) return acknowledge({ error: 'Conversation not found.' })
      const participant = db.prepare('SELECT user_id AS userId FROM conversation_participants WHERE conversation_id = ? AND user_id != ?').get(conversationId, userId)
      if (!participant) return acknowledge({ error: 'Conversation recipient not found.' })
      const id = randomUUID()
      const createdAt = new Date().toISOString()
      const deliveredAt = onlineUsers.has(participant.userId) ? createdAt : null
      db.prepare('INSERT INTO messages (id, conversation_id, sender_id, content, created_at, delivered_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, conversationId, userId, content, createdAt, deliveredAt)
      const message = { id, conversationId, senderId: userId, content, createdAt, deliveredAt, readAt: null }
      io.to(`user:${userId}`).to(`user:${participant.userId}`).emit('message:new', message)
      if (deliveredAt) io.to(`user:${userId}`).emit('message:status', { conversationId, messageId: id, status: 'delivered', at: deliveredAt })
      acknowledge({ message })
    })

    socket.on('message:read', payload => {
      const conversationId = typeof payload?.conversationId === 'string' ? payload.conversationId : ''
      if (!conversationId || !isConversationMember(conversationId, userId)) return
      const readAt = new Date().toISOString()
      db.prepare('UPDATE messages SET read_at = ?, delivered_at = COALESCE(delivered_at, ?) WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL').run(readAt, readAt, conversationId, userId)
      const senderIds = db.prepare('SELECT DISTINCT sender_id AS userId FROM messages WHERE conversation_id = ? AND sender_id != ?').all(conversationId, userId)
      for (const sender of senderIds) io.to(`user:${sender.userId}`).emit('message:status', { conversationId, status: 'read', at: readAt })
    })

    socket.on('typing:set', payload => {
      const conversationId = typeof payload?.conversationId === 'string' ? payload.conversationId : ''
      if (!conversationId || !isConversationMember(conversationId, userId)) return
      const recipient = db.prepare('SELECT user_id AS userId FROM conversation_participants WHERE conversation_id = ? AND user_id != ?').get(conversationId, userId)
      if (recipient) io.to(`user:${recipient.userId}`).emit('typing:update', { conversationId, userId, typing: Boolean(payload.typing) })
    })

    socket.on('disconnect', () => {
      const sockets = onlineUsers.get(userId)
      sockets?.delete(socket.id)
      if (sockets?.size === 0) {
        onlineUsers.delete(userId)
        io.emit('presence:update', { userId, online: false })
      }
    })
  })
}
