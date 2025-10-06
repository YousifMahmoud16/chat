// === Supabase Setup ===
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://yhesmmrmtmeeznvvsbhm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InloZXNtbXJtdG1lZXpudnZzYmhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTMxMzIsImV4cCI6MjA3NTI2OTEzMn0.SD7IGNyEj-YCTEHX-xyfVAJ3WKxCeqT26ywv3a0qiXg";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// === Local state ===
let me = JSON.parse(localStorage.getItem("me") || "null");
let currentChat = null;

// Helper to hash password (simple, not bcrypt)
async function hashPassword(pw) {
  const msgUint8 = new TextEncoder().encode(pw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// === Auth ===
async function register(username, displayName, password) {
  const hashed = await hashPassword(password);
  const { data, error } = await supabase.from("users").insert([{ username, display_name: displayName, password: hashed }]).select().single();
  if (error) throw error;
  localStorage.setItem("me", JSON.stringify(data));
  me = data;
  loadContacts();
}

async function login(username, password) {
  const hashed = await hashPassword(password);
  const { data, error } = await supabase.from("users").select("*").eq("username", username).eq("password", hashed).single();
  if (error || !data) throw new Error("Invalid credentials");
  localStorage.setItem("me", JSON.stringify(data));
  me = data;
  loadContacts();
}

function logout() {
  localStorage.removeItem("me");
  me = null;
  document.getElementById("overlay").style.display = "flex";
}

// === Contacts ===
async function loadContacts() {
  const { data, error } = await supabase.from("users").select("id, username, display_name");
  if (error) return console.error(error);
  renderContacts(data.filter(u => u.id !== me.id));
}

function renderContacts(users) {
  const ul = document.getElementById("contacts");
  ul.innerHTML = "";
  users.forEach(u => {
    const li = document.createElement("li");
    li.innerHTML = `<div class="avatar"></div>
      <div style="flex:1">
        <div class="name">${u.display_name}</div>
        <div class="sub">@${u.username}</div>
      </div>`;
    li.onclick = () => openChat(u);
    ul.appendChild(li);
  });
}

// === Messages ===
async function loadMessages(otherId) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .or(`and(sender.eq.${me.id},receiver.eq.${otherId}),and(sender.eq.${otherId},receiver.eq.${me.id})`)
    .order("created_at", { ascending: true });
  if (error) return console.error(error);
  renderMessages(data);
}

async function sendMessage(content) {
  if (!currentChat) return;
  const { error } = await supabase.from("messages").insert([{ sender: me.id, receiver: currentChat.id, content }]);
  if (error) console.error(error);
}

// === Realtime messages ===
supabase
  .channel("public:messages")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
    const msg = payload.new;
    if ((msg.sender === me.id && msg.receiver === currentChat.id) || (msg.receiver === me.id && msg.sender === currentChat.id)) {
      renderMessage(msg);
    }
  })
  .subscribe();

// === UI ===
function openChat(user) {
  currentChat = user;
  document.getElementById("chatWith").innerText = user.display_name;
  loadMessages(user.id);
}

function renderMessages(messages) {
  const box = document.getElementById("messages");
  box.innerHTML = "";
  messages.forEach(renderMessage);
  box.scrollTop = box.scrollHeight;
}

function renderMessage(m) {
  const box = document.getElementById("messages");
  const div = document.createElement("div");
  div.className = "msg " + (m.sender === me.id ? "me" : "other");
  div.innerHTML = `<div>${m.content}</div>
    <div class="meta">${new Date(m.created_at).toLocaleString()}</div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

// === Event listeners ===
document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("overlay");
  const sendBtn = document.getElementById("sendBtn");
  const messageInput = document.getElementById("messageInput");

  if (me) {
    overlay.style.display = "none";
    loadContacts();
  }

  document.getElementById("loginBtn").onclick = async () => {
    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;
    try {
      await login(username, password);
      overlay.style.display = "none";
    } catch {
      alert("Invalid login");
    }
  };

  document.getElementById("registerBtn").onclick = async () => {
    const username = document.getElementById("regUsername").value.trim();
    const displayName = document.getElementById("regDisplay").value.trim();
    const password = document.getElementById("regPassword").value;
    try {
      await register(username, displayName, password);
      overlay.style.display = "none";
    } catch (e) {
      alert("Error registering: " + e.message);
    }
  };

  document.getElementById("btnLogout").onclick = logout;

  sendBtn.onclick = async () => {
    const txt = messageInput.value.trim();
    if (!txt) return;
    await sendMessage(txt);
    messageInput.value = "";
  };

  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendBtn.click();
    }
  });
});
