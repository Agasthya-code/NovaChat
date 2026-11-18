# NovaChat

NovaChat keeps its existing React, TypeScript, and Vite client and adds an Express, SQLite, JWT, and Socket.IO service for private one-to-one messaging.

## Run locally

Use two terminals.

### Backend

```powershell
cd E:\NovaChat\server
Copy-Item .env.example .env
```

Set `JWT_SECRET` in `server\.env` to a long, random secret. In local development the backend binds only to `127.0.0.1`; set `HOST=0.0.0.0` only when you need other devices on your network to reach it. Then start the API:

```powershell
npm install
npm run dev
```

The API and Socket.IO server listen on `http://127.0.0.1:3001`. SQLite initializes before the server accepts requests and creates `server\data\novachat.sqlite` automatically. The health check is `GET /api/health` and returns `{"status":"ok","service":"novachat-api"}`.

### Frontend

```powershell
cd E:\NovaChat\client
npm install
npm run dev
```

Open the Vite URL, normally `http://localhost:5173` or `http://127.0.0.1:5173`. HTTP requests under `/api` and Socket.IO under `/socket.io` use Vite's same-origin proxy to reach the backend, including when Vite selects port 5174. Set `VITE_API_PROXY_TARGET` in `client\.env` if the backend uses another port. For direct connections, set `VITE_API_URL` and `VITE_SOCKET_URL`; in that mode, add the exact frontend origin to `CLIENT_ORIGIN` in `server\.env`.

## Database

- `users`: account profile fields, unique case-insensitive email and username, and bcrypt password hash.
- `conversations`: one-to-one conversation rows with a unique, sorted participant pair key.
- `conversation_participants`: conversation membership with foreign keys and a composite primary key.
- `messages`: sender, content, creation time, delivery time, and read time. Conversation and timestamp indexes support history retrieval.

SQLite foreign keys and WAL mode are enabled. User passwords are bcrypt-hashed and never returned by the API.

## HTTP API

All private routes require `Authorization: Bearer <JWT>`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Server health |
| POST | `/api/auth/register` | Register and sign in a new user |
| POST | `/api/auth/login` | Sign in with email and password |
| GET | `/api/auth/me` | Get the authenticated profile |
| GET | `/api/users/search?q=...` | Search other registered users by name or username |
| GET | `/api/conversations` | List the user's conversations |
| POST | `/api/conversations` | Create or retrieve a one-to-one conversation (`{ "userId": "..." }`) |
| GET | `/api/conversations/:id/messages` | Load conversation history; supports `limit` and `before` |
| POST | `/api/conversations/:id/read` | Mark received messages as read |

Socket.IO also requires the JWT in the handshake auth payload (`{ token }`). Client events are `message:send`, `message:read`, and `typing:set`; server events include `message:new`, `message:status`, `typing:update`, and `presence:update`. Conversation membership is checked before private message and typing events are accepted.

## Verification

```powershell
cd E:\NovaChat\client
npm run build

cd E:\NovaChat\server
npm run selftest
```

The self-test starts an isolated backend and Vite server with a temporary SQLite database, creates two accounts with generated test passwords, checks the health endpoint and local proxy/CORS, rejects a duplicate email, logs in, searches users, creates a conversation, exchanges messages over two authenticated sockets, checks a read receipt, and confirms persisted history after re-authentication. It does not add test accounts to the normal application database.

## Current scope

Registration, login, persistent sessions, user search, one-to-one conversations, message history, live delivery, online presence, typing status, delivery/read checks, and logout are connected to the backend. File/image attachments, voice/video calls, and notification preferences are not implemented yet; their UI actions report that they are coming soon.
