
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  collection,
  getDocs,
  query,
  where,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Replace with your actual deployed backend URL.
const AI_API_URL = "https://grades-app-6qgy.onrender.com/api/ai/chat";

const $ = (id) => document.getElementById(id);

const form = $("chatForm");
const input = $("promptInput");
const sendBtn = $("sendBtn");
const sendLabel = $("sendLabel");
const messagesEl = $("messages");
const welcomeEl = $("welcome");
const errorBanner = $("errorBanner");

let currentUser = null;
let busy = false;
let conversation = [];
let academicContext = { history: [], goals: [] };

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
}

function clearError() {
  errorBanner.textContent = "";
  errorBanner.hidden = true;
}

function setBusy(value) {
  busy = value;
  sendBtn.disabled = value;
  input.disabled = value;
  sendLabel.textContent = value ? "Thinking…" : "Send";
}

function addMessage(role, text) {
  const row = document.createElement("div");
  row.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "Y" : "G";

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = text;

  row.append(avatar, body);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function loadAcademicContext(user) {
  academicContext = { history: [], goals: [] };

  try {
    const q = query(
      collection(db, "history"),
      where("uid", "==", user.uid),
      limit(8)
    );

    const snapshot = await getDocs(q);

    academicContext.history = snapshot.docs.map((doc) => {
      const data = doc.data();

      return {
        gpa: data.gpa ?? null,
        gpaScale: data.gpaScale ?? null,
        percentage: data.percentage ?? null,
        subjects: Array.isArray(data.subjects)
          ? data.subjects.slice(0, 20)
          : [],
        time: data.time ?? null,
        date: data.date ?? null
      };
    });
  } catch (error) {
    console.warn("Could not load GradeFlow history:", error.message);
  }

  try {
    const q = query(
      collection(db, "goals"),
      where("uid", "==", user.uid),
      limit(8)
    );

    const snapshot = await getDocs(q);

    academicContext.goals = snapshot.docs.map((doc) => {
      const data = doc.data();

      return {
        title: data.title ?? data.name ?? "Study goal",
        description: data.description ?? "",
        target: data.target ?? null,
        progress: data.progress ?? null,
        status: data.status ?? null
      };
    });
  } catch (error) {
    console.warn("Could not load GradeFlow goals:", error.message);
  }
}

async function askGemini(message) {
  if (!currentUser) {
    throw new Error("Please sign in to GradeFlow first.");
  }

  const token = await currentUser.getIdToken();

  const response = await fetch(AI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({
      message,
      history: conversation.slice(-12),
      academicContext
    })
  });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("The backend returned an invalid response.");
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }

  if (typeof data.reply !== "string" || !data.reply.trim()) {
    throw new Error("Gemini returned an empty response.");
  }

  return data.reply.trim();
}

async function sendMessage(text) {
  const message = text.trim();

  if (!message || busy) return;

  if (message.length > 4000) {
    showError("Keep your message under 4,000 characters.");
    return;
  }

  clearError();
  welcomeEl.hidden = true;
  messagesEl.hidden = false;

  conversation.push({ role: "user", text: message });
  addMessage("user", message);

  input.value = "";
  input.style.height = "auto";
  setBusy(true);

  const typing = document.createElement("div");
  typing.className = "message";
  typing.id = "typingIndicator";

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = "G";

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = "Gemini is thinking…";

  typing.append(avatar, body);
  messagesEl.appendChild(typing);

  try {
    const reply = await askGemini(message);

    typing.remove();
    conversation.push({ role: "assistant", text: reply });
    addMessage("assistant", reply);
  } catch (error) {
    typing.remove();
    console.error("GradeFlow AI error:", error);
    showError(error.message || "Could not contact Gemini. Try again.");
  } finally {
    setBusy(false);
    input.focus();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

$("newChatBtn").addEventListener("click", () => {
  if (busy) return;

  conversation = [];
  messagesEl.replaceChildren();
  messagesEl.hidden = true;
  welcomeEl.hidden = false;
  input.value = "";
  clearError();
  input.focus();
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    sendMessage(button.dataset.prompt || "");
  });
});

$("menuBtn").addEventListener("click", () => {
  $("sidebar").classList.toggle("sidebar-open");
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    $("connectionStatus").textContent = "Sign-in required";

    const loginUrl = new URL("../login.html", window.location.href);
    loginUrl.searchParams.set("redirect", "../pages/ai-assistant.html");
    window.location.replace(loginUrl.href);
    return;
  }

  const name = user.displayName || "GradeFlow student";

  $("userName").textContent = name;
  $("userEmail").textContent = user.email || "Signed-in account";
  $("userAvatar").textContent = name.charAt(0).toUpperCase();
  $("connectionStatus").textContent = "Signed in";

  await loadAcademicContext(user);
});
