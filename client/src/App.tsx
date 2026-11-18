import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { io, type Socket } from 'socket.io-client'
import { ArrowLeft, Bell, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Info, LogOut, MessageCircle, MoreHorizontal, Moon, PanelRightClose, Plus, Search, Send, Settings, Smile, Sparkles, Sun, X } from 'lucide-react'
import { api, socketBase } from './services/api'
import type { AuthResponse, Conversation, Message, SearchResponseUser, User } from './services/types'
import './App.css'

const TOKEN_KEY = 'novachat-token'
const formatTime = (value?: string | null) => value ? new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : ''
const initials = (name: string) => name.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()
const colorFor = (id: string) => ['rose', 'blue', 'amber', 'mint', 'violet'][Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5]

function Avatar({ user, size = 'normal' }: { user: User; size?: 'small' | 'normal' | 'large' }) {
  return <span className={`avatar ${colorFor(user.id)} ${size}`}>{user.avatar || initials(user.name)}<i className={user.online ? 'online' : ''} /></span>
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (data: AuthResponse) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (mode === 'register') {
      if (password !== confirmPassword) return setError('Passwords do not match.')
      if (password.length < 8) return setError('Password must be at least 8 characters.')
    }
    setBusy(true)
    try {
      const result = await api<AuthResponse>(`/auth/${mode}`, undefined, { method: 'POST', body: JSON.stringify(mode === 'register' ? { name, username, email, password } : { email, password }) })
      onAuthenticated(result)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to sign in.') }
    finally { setBusy(false) }
  }

  const switchMode = () => { setMode(value => value === 'login' ? 'register' : 'login'); setError('') }
  return <main className="auth-screen"><div className="auth-glow" /><section className="auth-card">
    <div className="auth-brand"><span className="brand-mark"><Sparkles size={18} fill="currentColor" /></span><span className="brand-name">nova<span>chat</span></span></div>
    <span className="auth-eyebrow">YOUR SPACE, YOUR PEOPLE</span><h1>{mode === 'login' ? 'Welcome back.' : 'Find your people.'}</h1><p>{mode === 'login' ? 'A little closer, wherever you are.' : 'Create your private NovaChat account.'}</p>
    <form onSubmit={submit} className="auth-form">
      {mode === 'register' && <><label htmlFor="register-name">Full name</label><input id="register-name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={60} placeholder="Alex Rivera" />
        <label htmlFor="register-username">Username</label><input id="register-username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value.toLowerCase())} required minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]+" placeholder="alexrivera" /><span className="auth-field-hint">3–24 letters, numbers, or underscores</span></>}
      <label htmlFor="auth-email">Email</label><input id="auth-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} placeholder="you@example.com" />
      <label htmlFor="auth-password">Password</label><input id="auth-password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={mode === 'register' ? 8 : 1} maxLength={72} placeholder="••••••••••" />
      {mode === 'register' && <><label htmlFor="auth-confirm">Confirm password</label><input id="auth-confirm" type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required maxLength={72} placeholder="••••••••••" /></>}
      {error && <div className="auth-error" role="alert">{error}</div>}
      <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'} <ChevronRight size={15} /></button>
    </form>
    <div className="auth-switch">{mode === 'login' ? 'New to NovaChat?' : 'Already have an account?'} <button onClick={switchMode}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></div>
    <div className="auth-privacy"><Check size={13} /> Your conversations are private and secure</div>
  </section><div className="auth-decoration"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="welcome-logo"><Sparkles size={30} fill="currentColor" /></div></div></main>
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '')
  const [user, setUser] = useState<User | null>(null)
  const [authChecked, setAuthChecked] = useState(() => !localStorage.getItem(TOKEN_KEY))
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<SearchResponseUser[]>([])
  const [message, setMessage] = useState('')
  const [infoOpen, setInfoOpen] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [light, setLight] = useState(false)
  const [toast, setToast] = useState('')
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [newQuery, setNewQuery] = useState('')
  const [newPeople, setNewPeople] = useState<SearchResponseUser[]>([])
  const [typingUser, setTypingUser] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<Socket | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const typingTimer = useRef<number | undefined>(undefined)
  const active = conversations.find(conversation => conversation.id === activeId) ?? null
  const filteredConversations = useMemo(() => conversations.filter(conversation => `${conversation.user.name} ${conversation.user.username} ${conversation.lastMessage?.content ?? ''}`.toLowerCase().includes(query.toLowerCase())), [conversations, query])

  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(''), 3000); return () => window.clearTimeout(id) }, [toast])
  useEffect(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight }, [activeId, messages.length, typingUser])

  const logout = useCallback(() => {
    socketRef.current?.disconnect(); socketRef.current = null
    localStorage.removeItem(TOKEN_KEY); setToken(''); setUser(null); setConversations([]); setMessages([]); setActiveId(null); setPeople([]); setQuery(''); setAuthChecked(true)
  }, [])

  const handleAuthenticated = (data: AuthResponse) => { localStorage.setItem(TOKEN_KEY, data.token); setToken(data.token); setUser(data.user); setAuthChecked(true) }

  useEffect(() => {
    if (!token) return
    let activeEffect = true
    api<{ user: User }>('/auth/me', token).then(result => { if (activeEffect) setUser(result.user) }).catch(() => { if (activeEffect) logout() }).finally(() => { if (activeEffect) setAuthChecked(true) })
    return () => { activeEffect = false }
  }, [token, logout])

  const refreshConversations = useCallback(async () => {
    if (!token) return
    try { const result = await api<{ conversations: Conversation[] }>('/conversations', token); setConversations(result.conversations) }
    catch (reason) { setToast(reason instanceof Error ? reason.message : 'Could not load conversations.') }
  }, [token])

  useEffect(() => {
    if (!user || !token) return
    let activeEffect = true
    api<{ conversations: Conversation[] }>('/conversations', token).then(result => { if (activeEffect) setConversations(result.conversations) }).catch(reason => { if (activeEffect) setToast(reason instanceof Error ? reason.message : 'Could not load conversations.') })
    return () => { activeEffect = false }
  }, [user, token])

  useEffect(() => {
    if (!token || !user) return
    const socket = io(socketBase, { auth: { token }, transports: ['websocket', 'polling'] })
    socketRef.current = socket
    socket.on('connect_error', error => setToast(error.message || 'Real-time connection failed.'))
    socket.on('message:new', (incoming: Message) => {
      setConversations(prev => {
        const found = prev.some(conversation => conversation.id === incoming.conversationId)
        if (!found) { void refreshConversations(); return prev }
        return prev.map(conversation => conversation.id === incoming.conversationId ? { ...conversation, lastMessage: incoming, unread: incoming.senderId !== user.id && activeIdRef.current !== incoming.conversationId ? conversation.unread + 1 : 0 } : conversation).sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(a.lastMessage?.createdAt ?? a.createdAt))
      })
      if (activeIdRef.current === incoming.conversationId) {
        setMessages(prev => prev.some(messageItem => messageItem.id === incoming.id) ? prev : [...prev, incoming])
        if (incoming.senderId !== user.id) { socket.emit('message:read', { conversationId: incoming.conversationId }); void api(`/conversations/${incoming.conversationId}/read`, token, { method: 'POST' }) }
      }
    })
    socket.on('message:status', ({ conversationId, messageId, status, at }: { conversationId: string; messageId?: string; status: 'delivered' | 'read'; at: string }) => {
      setMessages(prev => prev.map(item => item.conversationId === conversationId && item.senderId === user.id && (!messageId || item.id === messageId) ? { ...item, deliveredAt: at, readAt: status === 'read' ? at : item.readAt } : item))
    })
    socket.on('presence:update', ({ userId, online }: { userId: string; online: boolean }) => {
      setConversations(prev => prev.map(conversation => conversation.user.id === userId ? { ...conversation, user: { ...conversation.user, online } } : conversation))
      setPeople(prev => prev.map(person => person.id === userId ? { ...person, online } : person))
      setNewPeople(prev => prev.map(person => person.id === userId ? { ...person, online } : person))
    })
    socket.on('typing:update', (event: { conversationId: string; userId: string; typing: boolean }) => { if (event.conversationId === activeIdRef.current && event.userId !== user.id) setTypingUser(event.typing) })
    return () => { socket.disconnect(); socketRef.current = null }
  }, [token, user, refreshConversations])

  const searchUsers = useCallback(async (search: string, setResults: (users: SearchResponseUser[]) => void) => {
    const normalized = search.trim()
    if (!token || normalized.length < 2) { setResults([]); return }
    try { const result = await api<{ users: SearchResponseUser[] }>(`/users/search?q=${encodeURIComponent(normalized)}`, token); setResults(result.users) }
    catch (reason) { setToast(reason instanceof Error ? reason.message : 'User search failed.') }
  }, [token])

  useEffect(() => { const timer = window.setTimeout(() => { void searchUsers(query, setPeople) }, 250); return () => window.clearTimeout(timer) }, [query, searchUsers])
  useEffect(() => { const timer = window.setTimeout(() => { void searchUsers(newQuery, setNewPeople) }, 250); return () => window.clearTimeout(timer) }, [newQuery, searchUsers])

  const openConversation = async (conversation: Conversation) => {
    setActiveId(conversation.id); activeIdRef.current = conversation.id; setMobileView('chat'); setTypingUser(false)
    setConversations(prev => prev.map(item => item.id === conversation.id ? { ...item, unread: 0 } : item))
    try {
      const result = await api<{ messages: Message[] }>(`/conversations/${conversation.id}/messages`, token)
      if (activeIdRef.current === conversation.id) setMessages(result.messages)
      await api(`/conversations/${conversation.id}/read`, token, { method: 'POST' })
      socketRef.current?.emit('message:read', { conversationId: conversation.id })
    } catch (reason) { setToast(reason instanceof Error ? reason.message : 'Could not load this conversation.') }
  }

  const startConversation = async (person: SearchResponseUser) => {
    try {
      const result = await api<{ conversation: Conversation }>('/conversations', token, { method: 'POST', body: JSON.stringify({ userId: person.id }) })
      setConversations(previous => previous.some(item => item.id === result.conversation.id) ? previous : [{ ...result.conversation, lastMessage: null, unread: 0 }, ...previous])
      await refreshConversations()
      setNewChatOpen(false); setNewQuery(''); setPeople([]); setQuery('')
      await openConversation(result.conversation)
    } catch (reason) { setToast(reason instanceof Error ? reason.message : 'Could not start this conversation.') }
  }

  const sendMessage = () => {
    const content = message.trim()
    if (!content || !active || !socketRef.current?.connected) { if (!socketRef.current?.connected) setToast('Reconnecting to NovaChat…'); return }
    socketRef.current.emit('typing:set', { conversationId: active.id, typing: false })
    socketRef.current.emit('message:send', { conversationId: active.id, content }, (result: { error?: string }) => { if (result?.error) setToast(result.error) })
    setMessage(''); setTypingUser(false)
  }

  const onComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage() } }
  const updateMessage = (value: string) => {
    setMessage(value)
    if (!active || !socketRef.current) return
    socketRef.current.emit('typing:set', { conversationId: active.id, typing: Boolean(value.trim()) })
    window.clearTimeout(typingTimer.current)
    typingTimer.current = window.setTimeout(() => socketRef.current?.emit('typing:set', { conversationId: active.id, typing: false }), 1600)
  }

  if (!authChecked) return <main className="auth-loading"><span className="brand-mark"><Sparkles size={18} fill="currentColor" /></span><span>Connecting to NovaChat…</span></main>
  if (!token || !user) return <AuthScreen onAuthenticated={handleAuthenticated} />

  return <main className={`app-shell ${light ? 'light' : ''}`}>
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileView === 'chat' ? 'mobile-hidden' : ''}`}>
      <div className="brand" role="button" tabIndex={0} title="Show welcome screen" onClick={() => { setActiveId(null); activeIdRef.current = null; setMobileView('list') }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { setActiveId(null); activeIdRef.current = null; setMobileView('list') } }}><div className="brand-mark"><Sparkles size={17} fill="currentColor" /></div>{!collapsed && <><span className="brand-name">nova<span>chat</span></span><button className="icon-button collapse-btn" aria-label="Collapse sidebar" onClick={event => { event.stopPropagation(); setCollapsed(true) }}><ChevronDown size={15} /></button></>}</div>
      {collapsed && <button className="icon-button expand-btn" aria-label="Expand sidebar" onClick={() => setCollapsed(false)}><ChevronRight size={15} /></button>}
      <button className="new-chat" onClick={() => { setNewChatOpen(true); setNewQuery('') }}><Plus size={17} />{!collapsed && <span>New message</span>}{!collapsed && <kbd>⌘ K</kbd>}</button>
      {!collapsed && <div className="search-box"><Search size={15} /><input placeholder="Search people & chats" value={query} onChange={event => setQuery(event.target.value)} /><kbd>⌘ F</kbd></div>}
      {!collapsed && <div className="section-heading"><span>{query.trim().length >= 2 ? 'PEOPLE' : 'MESSAGES'}</span><button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><MoreHorizontal size={17} /></button></div>}
      {collapsed && <div className="side-icons"><button title="Search" className="icon-button" onClick={() => setCollapsed(false)}><Search size={18} /></button><button title="Chats" className="icon-button"><MessageCircle size={18} /></button></div>}
      {!collapsed && query.trim().length >= 2 && people.length > 0 && <div className="people-results">{people.map(person => <button key={person.id} className="conversation" onClick={() => void startConversation(person)}><Avatar user={person} /><div className="conversation-copy"><div className="conversation-top"><b>{person.name}</b><span className="search-online">{person.online ? 'Online' : ''}</span></div><div className="conversation-bottom"><span>@{person.username}</span></div></div></button>)}</div>}
      <nav className="conversation-list" aria-label="Conversations">{filteredConversations.map(conversation => <button key={conversation.id} className={`conversation ${activeId === conversation.id ? 'selected' : ''}`} onClick={() => void openConversation(conversation)} title={collapsed ? conversation.user.name : undefined}>
        <Avatar user={conversation.user} /><div className="conversation-copy"><div className="conversation-top"><b>{conversation.user.name}</b><time>{formatTime(conversation.lastMessage?.createdAt ?? conversation.createdAt)}</time></div><div className="conversation-bottom"><span>{conversation.lastMessage ? `${conversation.lastMessage.senderId === user.id ? 'You: ' : ''}${conversation.lastMessage.content}` : 'Start a conversation'}</span>{conversation.unread > 0 && <i className="unread">{conversation.unread}</i>}</div></div>
      </button>)}</nav>
      {!collapsed && filteredConversations.length === 0 && query.trim().length < 2 && <div className="no-results">No conversations yet.<br />Search for someone to say hello.</div>}
      {!collapsed && query.trim().length >= 2 && people.length === 0 && filteredConversations.length === 0 && <div className="no-results">No people found</div>}
      <div className="sidebar-bottom"><button className="settings-link" onClick={() => setLight(value => !value)}>{light ? <Moon size={17} /> : <Sun size={17} />}{!collapsed && (light ? 'Dark appearance' : 'Light appearance')}<span className="settings-dot" /></button><div className="user-card"><Avatar user={user} /><div className="user-copy"><b>{user.name}</b><span>@{user.username}</span></div><button className="icon-button" title="Log out" aria-label="Log out" onClick={logout}><LogOut size={16} /></button></div></div>
    </aside>

    <section className={`chat-area ${mobileView === 'list' ? 'mobile-hidden' : ''}`}>
      {active ? <>
        <header className="chat-header"><button className="icon-button mobile-back" aria-label="Back to conversations" onClick={() => setMobileView('list')}><ArrowLeft size={19} /></button><Avatar user={active.user} /><div className="header-person"><b>{active.user.name}</b><span><i className={active.user.online ? 'status-online' : 'status-offline'} />{typingUser ? 'Typing…' : active.user.online ? 'Active now' : 'Offline'}</span></div><div className="header-actions"><span className="encrypted"><span>●</span> Private conversation</span><button className="icon-button" title={light ? 'Switch to dark theme' : 'Switch to light theme'} onClick={() => setLight(value => !value)}>{light ? <Moon size={17} /> : <Sun size={17} />}</button><button className="icon-button" title="Notifications" onClick={() => setToast('Notifications are enabled')}><Bell size={17} /></button><button className="icon-button" title="Contact info" onClick={() => setInfoOpen(value => !value)}>{infoOpen ? <PanelRightClose size={17} /> : <Info size={17} />}</button></div></header>
        <div className="message-feed" ref={feedRef}><div className="day-divider"><span />MESSAGES<span /></div><div className="messages">{messages.length ? messages.map((item, index) => <div key={item.id} className={`message-row ${item.senderId === user.id ? 'outgoing' : ''}`}><div className="message-content">{item.senderId !== user.id && index === 0 && <Avatar user={active.user} size="small" />}<div className="bubble-wrap"><div className="bubble">{item.content}</div><div className="message-meta"><time>{formatTime(item.createdAt)}</time>{item.senderId === user.id && (item.readAt ? <CheckCheck size={14} className="read-check" /> : item.deliveredAt ? <CheckCheck size={14} /> : <Check size={14} />)}</div></div></div></div>) : <div className="empty-chat"><div className="empty-icon"><MessageCircle size={23} /></div><b>It starts with a hello</b><span>Send a message to begin your conversation.</span></div>}{typingUser && <div className="typing-indicator"><span /><span /><span />{active.user.name.split(' ')[0]} is typing</div>}</div></div>
        <div className="composer-area"><div className="composer"><div className="composer-tools"><button className="icon-button" title="Attachments are not available yet" onClick={() => setToast('Attachments are coming soon.')}><Plus size={18} /></button></div><textarea rows={1} value={message} onChange={event => updateMessage(event.target.value)} onKeyDown={onComposerKey} placeholder={`Message ${active.user.name.split(' ')[0]}…`} /><div className="composer-end"><div className="emoji-wrap"><button className="icon-button" title="Add emoji" onClick={() => setEmojiOpen(value => !value)}><Smile size={18} /></button>{emojiOpen && <div className="emoji-popover">{['✨', '😊', '❤️', '👋', '🔥', '🙌', '🎉', '😂'].map(emoji => <button key={emoji} onClick={() => { updateMessage(message + emoji); setEmojiOpen(false) }}>{emoji}</button>)}</div>}</div><button className={`send-button ${message.trim() ? 'ready' : ''}`} onClick={sendMessage} aria-label="Send message"><Send size={16} fill="currentColor" /></button></div></div><div className="composer-hint"><span><kbd>↵</kbd> to send</span><span><kbd>⇧ ↵</kbd> for new line</span></div></div>
      </> : <div className="welcome"><div className="welcome-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="welcome-logo"><Sparkles size={30} fill="currentColor" /></div><span className="float-dot dot-one" /><span className="float-dot dot-two" /><span className="float-dot dot-three" /></div><span className="eyebrow">YOUR SPACE, YOUR PEOPLE</span><h1>Good conversations<br />start <em>here.</em></h1><p>A quieter, more thoughtful place to stay close<br />to the people who matter.</p><button className="primary-button" onClick={() => { setNewChatOpen(true); setNewQuery('') }}><Plus size={16} /> Start a conversation</button><div className="welcome-foot"><span><Check size={13} /> Private by design</span><span><Sparkles size={13} /> Made for meaningful moments</span></div></div>}
    </section>

    {active && infoOpen && <aside className="info-panel"><div className="info-heading"><span>CONTACT DETAILS</span><button className="icon-button info-close" onClick={() => setInfoOpen(false)} aria-label="Close contact details"><X size={17} /></button></div><div className="profile-block"><Avatar user={active.user} size="large" /><h2>{active.user.name}</h2><span className="handle">@{active.user.username}</span><div className="profile-status"><i className={active.user.online ? 'status-online' : 'status-offline'} />{active.user.online ? 'Online now' : 'Offline'}</div><div className="profile-actions"><button onClick={() => setToast('Voice and video calls are coming soon.')}>Call</button><button onClick={() => setToast(`You are chatting with ${active.user.name}.`)}><span><Info size={15} /></span> Profile</button><button onClick={() => setToast('More options are coming soon.')}><MoreHorizontal size={17} /></button></div></div><div className="info-divider" /><div className="info-section"><div className="info-section-title"><span>SHARED MEDIA</span></div><div className="info-empty">Media shared in this conversation will appear here.</div></div><div className="info-section files-section"><div className="info-section-title"><span>SHARED FILES</span></div><div className="info-empty">No files shared yet.</div></div><div className="info-divider" /><button className="chat-settings" onClick={() => setToast('Chat settings are coming soon.')}><Settings size={16} /><span>Chat settings</span><ChevronRight size={15} /></button><button className="chat-settings muted" onClick={() => setToast('Mute notifications are coming soon.')}><Bell size={16} /><span>Mute notifications</span><ChevronRight size={15} /></button></aside>}

    {toast && <div className="toast"><span className="toast-check"><Check size={13} /></span>{toast}<button onClick={() => setToast('')} aria-label="Dismiss notification"><X size={14} /></button></div>}
    {newChatOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setNewChatOpen(false) }}><div className="new-chat-modal"><div className="modal-icon"><MessageCircle size={20} /></div><button className="icon-button modal-close" onClick={() => setNewChatOpen(false)} aria-label="Close"><X size={17} /></button><h2>Find someone</h2><p>Search registered NovaChat users by name or username.</p><div className="new-chat-search"><Search size={15} /><input autoFocus value={newQuery} onChange={event => setNewQuery(event.target.value)} placeholder="Name or username" /></div><div className="new-chat-results">{newPeople.map(person => <button key={person.id} className="conversation" onClick={() => void startConversation(person)}><Avatar user={person} /><div className="conversation-copy"><div className="conversation-top"><b>{person.name}</b><span className="search-online">{person.online ? 'Online' : 'Offline'}</span></div><div className="conversation-bottom"><span>@{person.username}</span></div></div><ChevronRight size={15} /></button>)}{newQuery.trim().length >= 2 && newPeople.length === 0 && <span className="new-chat-empty">No matching users found.</span>}{newQuery.trim().length < 2 && <span className="new-chat-empty">Type at least 2 characters to search.</span>}</div><div className="modal-foot"><CircleHelp size={13} /> Only registered users can be messaged</div></div></div>}
  </main>
}

export default App
