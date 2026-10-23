import { auth, db, storage } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  collection,
  getDocs,
  query,
  where,
  limit,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

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
let currentChatId = null;
let historyUnsubscribe = null;
let messagesUnsubscribe = null;
let pendingFiles = [];
let loadingChat = false;

const MAX_FILES = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_TOTAL_SIZE = 15 * 1024 * 1024;

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/mp4",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/mpeg"
];

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

  if (sendLabel) {
    sendLabel.textContent = value ? "Thinking…" : "Send";
  }

  if (uploadButton) {
    uploadButton.disabled = value;
  }
}

function scrollMessages() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(role, text, attachments = []) {
  const row = document.createElement("div");
  row.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "Y" : "G";

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = text || "";

  for (const attachment of attachments) {
    if (!attachment.url) continue;

    const link = document.createElement("a");
    link.href = attachment.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = attachment.name || "Open attachment";
    link.style.display = "block";
    link.style.marginTop = "8px";

    if (attachment.type?.startsWith("image/")) {
      const image = document.createElement("img");
      image.src = attachment.url;
      image.alt = attachment.name || "Uploaded image";
      image.loading = "lazy";
      image.style.display = "block";
      image.style.maxWidth = "min(100%, 320px)";
      image.style.maxHeight = "260px";
      image.style.objectFit = "contain";
      image.style.marginTop = "8px";
      image.style.borderRadius = "10px";
      body.appendChild(image);
    } else if (attachment.type?.startsWith("audio/")) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = attachment.url;
      audio.style.display = "block";
      audio.style.maxWidth = "100%";
      audio.style.marginTop = "8px";
      body.appendChild(audio);
    } else if (attachment.type?.startsWith("video/")) {
      const video = document.createElement("video");
      video.controls = true;
      video.src = attachment.url;
      video.style.display = "block";
      video.style.maxWidth = "100%";
      video.style.maxHeight = "280px";
      video.style.marginTop = "8px";
      body.appendChild(video);
    }

    body.appendChild(link);
  }

  row.append(avatar, body);
  messagesEl.appendChild(row);
  scrollMessages();
}

async function loadAcademicContext(user) {
  academicContext = { history: [], goals: [] };

  try {
    const snapshot = await getDocs(query(
      collection(db, "history"),
      where("uid", "==", user.uid),
      limit(8)
    ));

    academicContext.history = snapshot.docs.map((item) => {
      const data = item.data();

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
    const snapshot = await getDocs(query(
      collection(db, "goals"),
      where("uid", "==", user.uid),
      limit(8)
    ));

    academicContext.goals = snapshot.docs.map((item) => {
      const data = item.data();

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

// Add upload and saved-chat controls without requiring new HTML IDs.
const uploadButton = document.createElement("button");
uploadButton.type = "button";
uploadButton.textContent = "＋ Attach files";
uploadButton.style.margin = "6px";

const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.multiple = true;
fileInput.accept = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  ".csv",
  "audio/*",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/mpeg"
].join(",");
fileInput.hidden = true;

const attachmentPreview = document.createElement("div");
attachmentPreview.style.padding = "4px 8px";

const chatHistoryList = $("savedChatList");

if (form) {
  form.prepend(fileInput, uploadButton, attachmentPreview);
}

uploadButton.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  clearError();

  const selected = Array.from(fileInput.files || []);

  if (selected.length + pendingFiles.length > MAX_FILES) {
    showError(`You can attach up to ${MAX_FILES} files per message.`);
    fileInput.value = "";
    return;
  }

  const totalSize = [...pendingFiles, ...selected]
    .reduce((sum, file) => sum + file.size, 0);

  if (totalSize > MAX_TOTAL_SIZE) {
    showError("Attachments must total 15 MB or less.");
    fileInput.value = "";
    return;
  }

  for (const file of selected) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      showError(`Unsupported file type: ${file.name}`);
      fileInput.value = "";
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      showError(`${file.name} exceeds the 5 MB per-file limit.`);
      fileInput.value = "";
      return;
    }
  }

  pendingFiles.push(...selected);
  renderPendingFiles();
  fileInput.value = "";
});

function renderPendingFiles() {
  attachmentPreview.replaceChildren();

  pendingFiles.forEach((file, index) => {
    const item = document.createElement("div");
    item.style.display = "flex";
    item.style.gap = "8px";
    item.style.alignItems = "center";
    item.style.marginBottom = "5px";

    const label = document.createElement("span");
    label.textContent =
      `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      pendingFiles.splice(index, 1);
      renderPendingFiles();
    });

    item.append(label, remove);
    attachmentPreview.appendChild(item);
  });
}

function createChatId() {
  return doc(collection(db, "users", currentUser.uid, "aiChats")).id;
}

async function ensureChat(message) {
  if (currentChatId) return currentChatId;

  currentChatId = createChatId();

  await setDoc(
    doc(db, "users", currentUser.uid, "aiChats", currentChatId),
    {
      title: message.slice(0, 60) || "New chat",
      preview: message.slice(0, 120),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }
  );

  return currentChatId;
}

async function saveChatMessage(role, text, attachments = []) {
  if (!currentUser) return;

  const chatId = await ensureChat(text || "File attachment");

  const messagesRef = collection(
    db,
    "users",
    currentUser.uid,
    "aiChats",
    chatId,
    "messages"
  );

  await addDoc(messagesRef, {
    role,
    text: text || "",
    attachments: attachments.map((file) => ({
      name: file.name,
      type: file.type,
      size: file.size,
      url: file.url,
      path: file.path
    })),
    createdAt: serverTimestamp()
  });

  await updateDoc(
    doc(db, "users", currentUser.uid, "aiChats", chatId),
    {
      preview: (text || "Attachment").slice(0, 120),
      updatedAt: serverTimestamp()
    }
  );
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");

      if (comma < 0) {
        reject(new Error(`Could not read ${file.name}.`));
        return;
      }

      resolve(result.slice(comma + 1));
    };

    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function uploadAttachments(files, chatId, messageId) {
  const uploaded = [];

  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path =
      `users/${currentUser.uid}/ai-chats/${chatId}/${messageId}/${safeName}`;

    const storageRef = ref(storage, path);

    await uploadBytes(storageRef, file, {
      contentType: file.type
    });

    const url = await getDownloadURL(storageRef);
    const base64 = await fileToBase64(file);

    uploaded.push({
      name: file.name,
      type: file.type,
      size: file.size,
      url,
      path,
      base64
    });
  }

  return uploaded;
}

async function askGemini(message, attachments = []) {
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
      history: conversation.slice(-12).map(({ role, text }) => ({
        role,
        text
      })),
      academicContext,
      attachments: attachments.map((file) => ({
        name: file.name,
        mimeType: file.type,
        data: file.base64
      }))
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

  if ((!message && pendingFiles.length === 0) || busy) return;

  if (message.length > 4000) {
    showError("Keep your message under 4,000 characters.");
    return;
  }

  if (!currentUser) {
    showError("Please sign in to use GradeFlow AI.");
    return;
  }

  clearError();
  welcomeEl.hidden = true;
  messagesEl.hidden = false;

  setBusy(true);

  const filesToSend = [...pendingFiles];
  pendingFiles = [];
  renderPendingFiles();

  let typing;

  try {
    const chatId = await ensureChat(
      message || filesToSend[0]?.name || "File attachment"
    );

    const messageId = doc(
      collection(db, "users", currentUser.uid, "aiChats", chatId, "messages")
    ).id;

    const attachments = await uploadAttachments(
      filesToSend,
      chatId,
      messageId
    );

    conversation.push({ role: "user", text: message });
    addMessage("user", message, attachments);

    input.value = "";
    input.style.height = "auto";

    await setDoc(
      doc(
        db,
        "users",
        currentUser.uid,
        "aiChats",
        chatId,
        "messages",
        messageId
      ),
      {
        role: "user",
        text: message,
        attachments: attachments.map(({ name, type, size, url, path }) => ({
          name,
          type,
          size,
          url,
          path
        })),
        createdAt: serverTimestamp()
      }
    );

    await updateDoc(
      doc(db, "users", currentUser.uid, "aiChats", chatId),
      {
        preview: (message || "Attachment").slice(0, 120),
        updatedAt: serverTimestamp()
      }
    );

    typing = document.createElement("div");
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

    // The backend must support the attachments field for file analysis.
    const reply = await askGemini(message, attachments);

    typing.remove();
    typing = null;

    conversation.push({ role: "assistant", text: reply });
    addMessage("assistant", reply);
    await saveChatMessage("assistant", reply);
  } catch (error) {
    typing?.remove();
    console.error("GradeFlow AI error:", error);
    showError(
      error.message ||
      "Could not contact Gemini. Check your connection and try again."
    );
  } finally {
    setBusy(false);
    input.focus();
  }
}

function stopChatListeners() {
  if (historyUnsubscribe) historyUnsubscribe();
  if (messagesUnsubscribe) messagesUnsubscribe();

  historyUnsubscribe = null;
  messagesUnsubscribe = null;
}

function listenForSavedChats() {
  if (!currentUser) return;

  if (historyUnsubscribe) historyUnsubscribe();

  const chatsRef = collection(
    db,
    "users",
    currentUser.uid,
    "aiChats"
  );

  historyUnsubscribe = onSnapshot(
    query(chatsRef, orderBy("updatedAt", "desc"), limit(50)),
    (snapshot) => {
      chatHistoryList.replaceChildren();

      if (snapshot.empty) {
        const empty = document.createElement("p");
        empty.textContent = "No saved chats yet.";
        empty.style.padding = "12px";
        chatHistoryList.appendChild(empty);
        return;
      }

      snapshot.forEach((chatDoc) => {
        const data = chatDoc.data();

        const button = document.createElement("button");
        button.type = "button";
        button.textContent = data.title || data.preview || "Saved chat";
        button.title = data.preview || data.title || "Open chat";
        button.style.display = "block";
        button.style.width = "100%";
        button.style.textAlign = "left";
        button.style.padding = "10px";
        button.style.marginBottom = "4px";
        button.style.overflowWrap = "anywhere";

        if (chatDoc.id === currentChatId) {
          button.setAttribute("aria-current", "true");
        }

        button.addEventListener("click", () => openSavedChat(chatDoc.id));
        chatHistoryList.appendChild(button);
      });
    },
    (error) => {
      console.error("Could not load saved chats:", error);
      showError("Could not load saved chats. Check your Firebase rules.");
    }
  );
}

async function openSavedChat(chatId) {
  if (busy || !currentUser) return;

  clearError();
  loadingChat = true;

  try {
    stopMessageListenerOnly();

    currentChatId = chatId;
    conversation = [];
    messagesEl.replaceChildren();
    messagesEl.hidden = false;
    welcomeEl.hidden = true;

    const chatRef = doc(
      db,
      "users",
      currentUser.uid,
      "aiChats",
      chatId
    );

    const chatSnapshot = await getDoc(chatRef);

    if (!chatSnapshot.exists()) {
      throw new Error("This saved chat no longer exists.");
    }

    const messagesRef = collection(chatRef, "messages");
    const snapshot = await getDocs(query(messagesRef, orderBy("createdAt", "asc")));

    snapshot.forEach((messageDoc) => {
      const data = messageDoc.data();
      const role = data.role === "assistant" ? "assistant" : "user";
      const text = typeof data.text === "string" ? data.text : "";
      const attachments = Array.isArray(data.attachments)
        ? data.attachments
        : [];

      conversation.push({ role, text });
      addMessage(role, text, attachments);
    });

    listenForSavedChats();
    $("sidebar")?.classList.remove("sidebar-open");
  } catch (error) {
    console.error("Could not open saved chat:", error);
    showError(error.message || "Could not open that saved chat.");
  } finally {
    loadingChat = false;
  }
}

function stopMessageListenerOnly() {
  if (messagesUnsubscribe) messagesUnsubscribe();
  messagesUnsubscribe = null;
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

  stopMessageListenerOnly();
  currentChatId = null;
  conversation = [];
  pendingFiles = [];

  messagesEl.replaceChildren();
  messagesEl.hidden = true;
  welcomeEl.hidden = false;

  input.value = "";
  attachmentPreview.replaceChildren();
  clearError();
  listenForSavedChats();
  input.focus();
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    sendMessage(button.dataset.prompt || "");
  });
});

$("menuBtn")?.addEventListener("click", () => {
  $("sidebar")?.classList.toggle("sidebar-open");
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    stopChatListeners();

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
  listenForSavedChats();
});
