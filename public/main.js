/* Client-side: login/register, fetch contacts, Socket.IO realtime messages.
   Stores JWT in localStorage under "token" and currentUser under "me".
*/

const API_BASE = '/api';

let socket = null;
let me = null;
let token = localStorage.getItem('token') || null;
const state = { contacts: [], currentChat: null, messages: {} };

function $(sel){ return document.querySelector(sel); }
function $all(sel){ return document.querySelectorAll(sel); }

async function api(path, opts = {}) {
  opts.headers = opts.headers || {};
  opts.headers['Content-Type'] = 'application/json';
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, opts);
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw data;
  return data;
}

function showOverlay(show) {
  document.getElementById('overlay').style.display = show ? 'flex' : 'none';
}

function renderContacts() {
  const ul = $('#contacts');
  ul.innerHTML = '';
  state.contacts.forEach(u => {
    const li = document.createElement('li');
    li.dataset.id = u.id;
    li.innerHTML = `<div class="avatar"></div>
      <div style="flex:1">
        <div class="name">${escapeHtml(u.displayName || u.username)}</div>
        <div class="sub">@${escapeHtml(u.username)}</div>
      </div>`;
    li.addEventListener('click', () => openChat(u));
    ul.appendChild(li);
  });
}

function escapeHtml(s){ return (s||'').toString().replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }

function setMe(u) {
  me = u;
  if (me) {
    $('#meName').innerText = me.displayName || me.username;
    $('#btnLogout').style.display = 'inline-block';
  } else {
    $('#meName').innerText = 'Not logged';
    $('#btnLogout').style.display = 'none';
  }
}

async function fetchContacts() {
  try {
    const users = await api(API_BASE + '/users');
    state.contacts = users;
    renderContacts();
  } catch (e) {
    console.warn('fetchContacts', e);
  }
}

async function openChat(user) {
  state.currentChat = user;
  $('#chatWith').innerText = user.displayName || user.username;
  const cid = chatId(me.id, user.id);
  if (!state.messages[cid]) {
    const msgs = await api(API_BASE + '/messages/' + cid);
    state.messages[cid] = msgs;
  }
  renderMessages();
}

function renderMessages() {
  const box = $('#messages'); box.innerHTML = '';
  if (!state.currentChat) return;
  const cid = chatId(me.id, state.currentChat.id);
  const msgs = state.messages[cid] || [];
  msgs.forEach(m => {
    const div = document.createElement('div');
    div.className = 'msg ' + (m.from === me.id ? 'me' : 'other');
    div.innerHTML = `<div>${escapeHtml(m.content)}</div>
      <div class="meta">${new Date(m.ts).toLocaleString()}</div>`;
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

function chatId(a,b){ return [a,b].sort().join('_'); }

function connectSocket() {
  if (!token) return;
  if (socket) socket.disconnect();
  socket = io({ query: { token } });
  socket.on('connect', () => {
    console.log('socket connected');
  });
  socket.on('message', (m) => {
    // add to state and render if in current chat
    const cid = chatId(m.from, m.to);
    state.messages[cid] = state.messages[cid] || [];
    state.messages[cid].push(m);
    // if chatting with this user or from this user, refresh
    if (state.currentChat && (state.currentChat.id === m.from || state.currentChat.id === m.to)) renderMessages();
    else {
      // optionally show a small notification (console)
      console.log('New message from', m.from, m.content);
    }
  });
  socket.on('presence', (onlineIds) => {
    // TODO: could show online indicator
    console.log('online now', onlineIds);
  });
  socket.on('connect_error', (err) => {
    console.warn('socket error', err);
  });
}

async function tryAutoLogin() {
  if (!token) return showOverlay(true);
  try {
    const meRes = await api(API_BASE + '/me');
    setMe(meRes);
    showOverlay(false);
    await fetchContacts();
    connectSocket();
  } catch (e) {
    console.log('token invalid', e);
    localStorage.removeItem('token');
    token = null;
    showOverlay(true);
  }
}

// UI event wiring
document.addEventListener('DOMContentLoaded', () => {
  // Auth toggles
  $('#toggleToRegister').addEventListener('click', () => {
    $('#authTitle').innerText = 'Register';
    $('#loginForm').style.display = 'none';
    $('#registerForm').style.display = 'block';
    $('#toggleToRegister').style.display = 'none';
    $('#toggleToLogin').style.display = 'inline';
  });
  $('#toggleToLogin').addEventListener('click', () => {
    $('#authTitle').innerText = 'Login';
    $('#loginForm').style.display = 'block';
    $('#registerForm').style.display = 'none';
    $('#toggleToRegister').style.display = 'inline';
    $('#toggleToLogin').style.display = 'none';
  });

  // Register
  $('#registerBtn').addEventListener('click', async () => {
    const username = $('#regUsername').value.trim();
    const displayName = $('#regDisplay').value.trim();
    const password = $('#regPassword').value;
    try {
      const res = await fetch(API_BASE + '/register', {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username, displayName, password })
      }).then(r=>r.json());
      if (res.token) {
        token = res.token; localStorage.setItem('token', token);
        setMe(res.user); localStorage.setItem('me', JSON.stringify(res.user));
        showOverlay(false);
        await fetchContacts();
        connectSocket();
      } else {
        alert('Register failed: ' + (res.error || 'unknown'));
      }
    } catch (e) { alert('Error: ' + JSON.stringify(e)); }
  });

  // Login
  $('#loginBtn').addEventListener('click', async () => {
    const username = $('#loginUsername').value.trim();
    const password = $('#loginPassword').value;
    try {
      const res = await fetch(API_BASE + '/login', {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username, password })
      }).then(r=>r.json());
      if (res.token) {
        token = res.token; localStorage.setItem('token', token);
        setMe(res.user); localStorage.setItem('me', JSON.stringify(res.user));
        showOverlay(false);
        await fetchContacts();
        connectSocket();
      } else {
        alert('Login failed: ' + (res.error || 'unknown'));
      }
    } catch (e) { alert('Error: ' + JSON.stringify(e)); }
  });

  // Logout
  $('#btnLogout').addEventListener('click', () => {
    token = null; me = null;
    localStorage.removeItem('token'); localStorage.removeItem('me');
    setMe(null);
    if (socket) { socket.disconnect(); socket = null; }
    showOverlay(true);
  });

  // Send message
  $('#sendBtn').addEventListener('click', () => {
    const txt = $('#messageInput').value.trim();
    if (!txt || !state.currentChat) return;
    socket.emit('private_message', { to: state.currentChat.id, content: txt });
    $('#messageInput').value = '';
  });

  // quick send on enter
  $('#messageInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#sendBtn').click(); }
  });

  // search contacts
  $('#searchContacts').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = state.contacts.filter(u => (u.displayName||u.username).toLowerCase().includes(q) || (u.username||'').toLowerCase().includes(q));
    const old = state.contacts;
    state.contacts = filtered;
    renderContacts();
    state.contacts = old;
  });

  // Try auto-login
  tryAutoLogin();
});
// === 🌙 Dark Mode Toggle ===
const toggleBtn = document.createElement("button");
toggleBtn.innerText = "🌚";
toggleBtn.style.position = "fixed";
toggleBtn.style.top = "60px";
toggleBtn.style.right = "20px";
toggleBtn.style.fontSize = "20px";
toggleBtn.style.border = "none";
toggleBtn.style.background = "#1e293b";
toggleBtn.style.color = "white";
toggleBtn.style.padding = "10px 14px";
toggleBtn.style.borderRadius = "45%";
toggleBtn.style.cursor = "pointer";
toggleBtn.style.boxShadow = "0 4px 10px rgba(0,0,0,0.2)";
toggleBtn.style.transition = "0.3s";
toggleBtn.title = "Toggle Dark Mode";

toggleBtn.addEventListener("mouseenter", () => {
  toggleBtn.style.background = "#1e293b";
});
toggleBtn.addEventListener("mouseleave", () => {
  toggleBtn.style.background = "#455d83";
});

toggleBtn.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  const mode = document.body.classList.contains("dark") ? "dark" : "light";
  toggleBtn.innerText = mode === "dark" ? "🌞" : "🌚";
  localStorage.setItem("theme", mode);
});

// Remember user’s preference
window.addEventListener("load", () => {
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "dark") {
    document.body.classList.add("dark");
    toggleBtn.innerText = "🌞";
  }
  document.body.appendChild(toggleBtn);
});
