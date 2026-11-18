import jwt from 'jsonwebtoken'

export function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET || 'dev-only-change-me', { expiresIn: '7d' })
}

export function authenticate(req, res, next) {
  const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return res.status(401).json({ error: 'Authentication required.' })
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-me')
    req.userId = payload.sub
    next()
  } catch {
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
  }
}

export function authenticateSocket(socket, next) {
  try {
    const token = socket.handshake.auth?.token
    if (!token) return next(new Error('Authentication required'))
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-only-change-me')
    socket.userId = payload.sub
    next()
  } catch {
    next(new Error('Invalid or expired session'))
  }
}
