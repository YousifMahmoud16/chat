/* Minimal Express + Socket.IO server with JSON persistence.
   - API: /api/register, /api/login, /api/users, /api/me, /api/messages/:chatId
   - Realtime: Socket.IO authenticated with JWT (handshake query token)
   - Data files: ./data/users.json and ./data/messages.json
*/

// Load environment variables (if .env exists locally)

const express = require('express');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { Server } = require('socket.io');

// --- Configuration ---
const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const JWT_SECRET = process.env.JWT_SECRET || 'very_secret_demo_key_change_me';
const PORT = process.env.PORT || 3000;


async function ensureDataFiles() {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch(e) {}
  try { await fs.access(USERS_FILE); } catch(e) { await fs.writeFile(USERS_FILE, '[]', 'utf8'); }
  try { await fs.access(MESSAGES_FILE); } catch(e) { await fs.writeFile(MESSAGES_FILE, '{}', 'utf8'); }
}

async function readUsers() {
  const txt = await fs.readFile(USERS_FILE, 'utf8');
  return JSON.parse(txt || '[]');
}
async function writeUsers(users) {
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}
async function readMessages() {
  const txt = await fs.readFile(MESSAGES_FILE, 'utf8');
  return JSON.parse(txt || '{}');
}
async function writeMessages(msgs) {
  await fs.writeFile(MESSAGES_FILE, JSON.stringify(msgs, null, 2), 'utf8');
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function chatIdFor(a, b) {
  return [a, b].sort().join('_');
}

(async () => {
  await ensureDataFiles();

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public'))); // serve client files from public/

  function authMiddleware(req, res, next) {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
    const token = h.slice(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      next();
    } catch (e) { return res.status(401).json({ error: 'Invalid token' }); }
  }

  // Register
  app.post('/api/register', async (req, res) => {
    const { username, displayName, password } = req.body || {};
    if (!username || !password || !displayName) return res.status(400).json({ error: 'username, displayName, password required' });
    const users = await readUsers();
    if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Username already taken' });
    const hash = await bcrypt.hash(password, 10);
    const user = { id: genId(), username, displayName, passwordHash: hash, createdAt: Date.now() };
    users.push(user);
    await writeUsers(users);
    const token = jwt.sign({ id: user.id, username: user.username, displayName: user.displayName }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, displayName: user.displayName } });
  });

  // Login
  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const users = await readUsers();
    const user = users.find(u => u.username === username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, username: user.username, displayName: user.displayName }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, displayName: user.displayName } });
  });

  // Get current user
  app.get('/api/me', authMiddleware, async (req, res) => {
    const users = await readUsers();
    const u = users.find(x => x.id === req.user.id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json({ id: u.id, username: u.username, displayName: u.displayName });
  });

  // List users (contacts)
  app.get('/api/users', authMiddleware, async (req, res) => {
    const users = await readUsers();
    const others = users.filter(u => u.id !== req.user.id).map(u => ({ id: u.id, username: u.username, displayName: u.displayName }));
    res.json(others);
  });

  // Get messages for a chatId
  app.get('/api/messages/:chatId', authMiddleware, async (req, res) => {
    const chatId = req.params.chatId;
    const messages = await readMessages();
    res.json(messages[chatId] || []);
  });

  // Start server + socket.io
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*' }
  });

  // map userId -> socket.id
  const online = new Map();

  io.use((socket, next) => {
    const token = socket.handshake.query && socket.handshake.query.token;
    if (!token) return next(new Error('Authentication error'));
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (e) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    online.set(userId, socket.id);
    console.log('user connected', socket.user.username, userId);

    // send list of online user IDs (simple)
    io.emit('presence', Array.from(online.keys()));

    socket.on('private_message', async (data) => {
      try {
        const { to, content } = data;
        if (!to || !content) return;
        const from = userId;
        const chatId = chatIdFor(from, to);
        const message = { id: genId(), chatId, from, to, content, ts: Date.now() };

        const allMsgs = await readMessages();
        if (!allMsgs[chatId]) allMsgs[chatId] = [];
        allMsgs[chatId].push(message);
        await writeMessages(allMsgs);

        // emit to recipient if online
        const toSocketId = online.get(to);
        if (toSocketId) io.to(toSocketId).emit('message', message);

        // emit to sender as confirmation
        socket.emit('message', message);
      } catch (e) {
        console.error('pm error', e);
      }
    });

    socket.on('disconnect', () => {
      online.delete(userId);
      io.emit('presence', Array.from(online.keys()));
      console.log('user disconnected', socket.user.username);
    });
  });
const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Open that URL in your browser and register/login.');
  });

})();
