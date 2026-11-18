export interface User {
  id: string
  name: string
  username: string
  email?: string
  avatar: string
  online?: boolean
}

export interface Message {
  id: string
  conversationId: string
  senderId: string
  content: string
  createdAt: string
  deliveredAt: string | null
  readAt: string | null
}

export interface Conversation {
  id: string
  createdAt: string
  user: User
  lastMessage: Message | null
  unread: number
}

export interface AuthResponse {
  token: string
  user: User
}

export interface SearchResponseUser extends User {
  online: boolean
}
