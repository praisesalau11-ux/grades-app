
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
  deleteDoc,
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

const voiceBtn = $("voiceBtn");
const voiceLabel = $("voiceLabel");
const voiceStatus = $("voiceStatus");

const SpeechRecognition =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition;

let recognition = null;
let isListening = false;
let voiceSubmitted = false;

if (SpeechRecognition && voiceBtn) {
  recognition = new SpeechRecognition();

  recognition.lang = navigator.language || "en-US";
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = () => {
    isListening = true;
    voiceSubmitted = false;

    voiceBtn.classList.add("listening");
    voiceBtn.setAttribute("aria-pressed", "true");
    voiceLabel.textContent = "Listening…";

    voiceStatus.textContent =
      "Speak now. Your message will be sent when you finish.";
    clearError();
  };

  recognition.onresult = (event) => {
    let finalTranscript = "";
    let interimTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;

      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    if (finalTranscript.trim()) {
      const message = finalTranscript.trim();

      if (!voiceSubmitted) {
        voiceSubmitted = true;
        input.value = message;
        recognition.stop();

        // Uses the existing Gemini chat and message-saving logic.
        sendMessage(message);
      }
    } else if (interimTranscript.trim()) {
      input.value = interimTranscript.trim();
    }
  };

  recognition.onerror = (event) => {
    if (event.error === "aborted") return;

    if (event.error === "not-allowed" ||
        event.error === "service-not-allowed") {
      showError(
        "Microphone access was denied. Allow microphone access in Chrome site settings."
      );
    } else if (event.error === "no-speech") {
      voiceStatus.textContent = "No speech detected. Tap Voice to try again.";
    } else {
      showError(
        `Voice input failed: ${event.error}. You can still type your message.`
      );
    }
  };

  recognition.onend = () => {
    isListening = false;

    voiceBtn.classList.remove("listening");
    voiceBtn.setAttribute("aria-pressed", "false");
    voiceLabel.textContent = "Voice";

    if (!busy) {
      voiceStatus.textContent =
        "Enter to send · Shift + Enter for a new line";
    }
  };

  voiceBtn.addEventListener("click", () => {
    if (busy) return;

    if (isListening) {
      recognition.stop();
      return;
    }

    input.value = "";
    clearError();

    try {
      recognition.start();
    } catch (error) {
      console.error("Could not start voice input:", error);
      showError(
        "Could not start the microphone. Wait a moment and try again."
      );
    }
  });
} else if (voiceBtn) {
  voiceBtn.addEventListener("click", () => {
    showError(
      "Voice input is not supported in this browser. Try an updated version of Chrome."
    );
  });
}

const chatHistoryList = $("savedChatList");

let currentUser = null;
let busy = false;
let conversation = [];
let academicContext = { history: [], goals: [] };
let currentChatId = null;
let historyUnsubscribe = null;
let messagesUnsubscribe = null;
let pendingFiles = [];

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

/* =========================================
   ERROR AND LOADING HELPERS
========================================= */

function showError(message) {
  if (!errorBanner) return;

  errorBanner.textContent = message;
  errorBanner.hidden = false;
}

function clearError() {
  if (!errorBanner) return;

  errorBanner.textContent = "";
  errorBanner.hidden = true;
}

function setBusy(value) {
  busy = value;

  if (sendBtn) sendBtn.disabled = value;
  if (input) input.disabled = value;
  if (uploadButton) uploadButton.disabled = value;

  if (sendLabel) {
    sendLabel.textContent = value ? "Thinking…" : "Send";
  }
}

function scrollMessages() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function makeButton(label, className, title) {
  const button = document.createElement("button");

  button.type = "button";
  button.textContent = label;
  button.className = className;
  button.title = title;
  button.setAttribute("aria-label", title);

  return button;
}

/* =========================================
   DISPLAY CHAT MESSAGES
========================================= */

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

 
  // Add text-to-speech controls to every AI response.
  if (role === "assistant" && text && "speechSynthesis" in window) {
    const speakButton = document.createElement("button");
    speakButton.type = "button";
    speakButton.className = "speak-reply-btn";
    speakButton.textContent = "🔊 Speak";
    speakButton.setAttribute("aria-label", "Read this AI reply aloud");

    speakButton.addEventListener("click", () => {
      // Stop the current speech if this button is already speaking.
      if (speakButton.dataset.speaking === "true") {
        window.speechSynthesis.cancel();
        return;
      }

      // Stop any other reply currently being spoken.
      window.speechSynthesis.cancel();

      // Reset all speech buttons.
      document.querySelectorAll(".speak-reply-btn").forEach((button) => {
        button.dataset.speaking = "false";
        button.textContent = "🔊 Speak";
      });

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 1;
      utterance.pitch = 1;

      speakButton.dataset.speaking = "true";
      speakButton.textContent = "⏹ Stop";

      const resetButton = () => {
        speakButton.dataset.speaking = "false";
        speakButton.textContent = "🔊 Speak";
      };

      utterance.onend = resetButton;
      utterance.onerror = resetButton;

      window.speechSynthesis.speak(utterance);
    });

    body.appendChild(speakButton);
  }

  row.append(avatar, body);
  messagesEl.appendChild(row);
  scrollMessages();

}

/* =========================================
   LOAD GRADEFLOW ACADEMIC CONTEXT
========================================= */

async function loadAcademicContext(user) {
  academicContext = {
    history: [],
    goals: []
  };

  try {
    const snapshot = await getDocs(
      query(
        collection(db, "history"),
        where("uid", "==", user.uid),
        limit(8)
      )
    );

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
    console.warn(
      "Could not load GradeFlow history:",
      error.message
    );
  }

  try {
    const snapshot = await getDocs(
      query(
        collection(db, "goals"),
        where("uid", "==", user.uid),
        limit(8)
      )
    );

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
    console.warn(
      "Could not load GradeFlow goals:",
      error.message
    );
  }
}

/* =========================================
   FILE ATTACHMENTS
========================================= */

const uploadButton = document.createElement("button");

uploadButton.type = "button";
uploadButton.textContent = "＋ Attach files";
uploadButton.className = "attach-files-btn";

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
attachmentPreview.className = "attachment-preview";

if (form) {
  form.prepend(fileInput, uploadButton, attachmentPreview);
}

uploadButton.addEventListener("click", () => {
  if (!busy) fileInput.click();
});

fileInput.addEventListener("change", () => {
  clearError();

  const selected = Array.from(fileInput.files || []);

  if (selected.length + pendingFiles.length > MAX_FILES) {
    showError(`You can attach up to ${MAX_FILES} files per message.`);
    fileInput.value = "";
    return;
  }

  const totalSize = [...pendingFiles, ...selected].reduce(
    (sum, file) => sum + file.size,
    0
  );

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
    item.className = "attachment-preview-item";

    const label = document.createElement("span");

    label.textContent =
      `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;

    const remove = document.createElement("button");

    remove.type = "button";
    remove.textContent = "Remove";
    remove.className = "remove-attachment-btn";
    remove.addEventListener("click", () => {
      pendingFiles.splice(index, 1);
      renderPendingFiles();
    });

    item.append(label, remove);
    attachmentPreview.appendChild(item);
  });
}

function createChatId() {
  return doc(
    collection(db, "users", currentUser.uid, "aiChats")
  ).id;
}

async function ensureChat(message) {
  if (currentChatId) return currentChatId;

  const chatId = createChatId();
  const title = (message || "New chat").slice(0, 60);

  await setDoc(
    doc(db, "users", currentUser.uid, "aiChats", chatId),
    {
      title,
      preview: (message || "New chat").slice(0, 120),
      pinned: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }
  );

  currentChatId = chatId;

  return chatId;
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

    reader.onerror = () => {
      reject(new Error(`Could not read ${file.name}.`));
    };

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

/* =========================================
   SAVE CHAT MESSAGES
========================================= */

async function saveChatMessage(role, text, attachments = []) {
  if (!currentUser || !currentChatId) return;

  const messagesRef = collection(
    db,
    "users",
    currentUser.uid,
    "aiChats",
    currentChatId,
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
    doc(
      db,
      "users",
      currentUser.uid,
      "aiChats",
      currentChatId
    ),
    {
      preview: (text || "Attachment").slice(0, 120),
      updatedAt: serverTimestamp()
    }
  );
}

/* =========================================
   SEND MESSAGE TO THE AI BACKEND
========================================= */

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
    throw new Error(
      data.error || `Request failed (${response.status}).`
    );
  }

  if (typeof data.reply !== "string" || !data.reply.trim()) {
    throw new Error("The AI returned an empty response.");
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

  let typing = null;

  try {
    const chatId = await ensureChat(
      message || filesToSend[0]?.name || "File attachment"
    );

    const messageId = doc(
      collection(
        db,
        "users",
        currentUser.uid,
        "aiChats",
        chatId,
        "messages"
      )
    ).id;

    const attachments = await uploadAttachments(
      filesToSend,
      chatId,
      messageId
    );

    conversation.push({
      role: "user",
      text: message
    });

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
        attachments: attachments.map(
          ({ name, type, size, url, path }) => ({
            name,
            type,
            size,
            url,
            path
          })
        ),
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
    body.textContent = "GradeFlow AI is thinking…";

    typing.append(avatar, body);
    messagesEl.appendChild(typing);
    scrollMessages();

    const reply = await askGemini(message, attachments);

    typing.remove();
    typing = null;

    conversation.push({
      role: "assistant",
      text: reply
    });

    addMessage("assistant", reply);

    await saveChatMessage("assistant", reply);

  } catch (error) {
    typing?.remove();

    console.error("GradeFlow AI error:", error);

    showError(
      error.message ||
      "Could not contact the AI. Check your connection and try again."
    );
  } finally {
    setBusy(false);
    input.focus();
  }
}

/* =========================================
   STOP FIREBASE LISTENERS
========================================= */

function stopMessageListenerOnly() {
  if (messagesUnsubscribe) {
    messagesUnsubscribe();
  }

  messagesUnsubscribe = null;
}

function stopChatListeners() {
  if (historyUnsubscribe) {
    historyUnsubscribe();
  }

  stopMessageListenerOnly();

  historyUnsubscribe = null;
}

/* =========================================
   OPEN A SAVED CHAT
========================================= */

async function openSavedChat(chatId) {
  if (busy || !currentUser) return;

  clearError();

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

    const snapshot = await getDocs(
      query(messagesRef, orderBy("createdAt", "asc"))
    );

    snapshot.forEach((messageDoc) => {
      const data = messageDoc.data();

      const role = data.role === "assistant"
        ? "assistant"
        : "user";

      const text = typeof data.text === "string"
        ? data.text
        : "";

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

    showError(
      error.message || "Could not open that saved chat."
    );
  }
}

/* =========================================
   PIN, RENAME AND DELETE CHAT ACTIONS
========================================= */

async function togglePinChat(chatId, currentlyPinned, button) {
  if (!currentUser) return;

  button.disabled = true;
  clearError();

  try {
    const chatRef = doc(
      db,
      "users",
      currentUser.uid,
      "aiChats",
      chatId
    );

    await updateDoc(chatRef, {
      pinned: !currentlyPinned,
      updatedAt: serverTimestamp()
    });

  } catch (error) {
    console.error("Could not pin chat:", error);

    showError("Could not update the pin. Check your Firebase rules.");

    button.disabled = false;
  }
}

async function renameChat(chatId, oldTitle, button) {
  if (!currentUser) return;

  const enteredTitle = window.prompt(
    "Enter a new name for this chat:",
    oldTitle
  );

  if (enteredTitle === null) return;

  const cleanTitle = enteredTitle.trim();

  if (!cleanTitle) {
    showError("Chat names cannot be empty.");
    return;
  }

  if (cleanTitle.length > 80) {
    showError("Keep chat names under 80 characters.");
    return;
  }

  button.disabled = true;
  clearError();

  try {
    await updateDoc(
      doc(
        db,
        "users",
        currentUser.uid,
        "aiChats",
        chatId
      ),
      {
        title: cleanTitle,
        updatedAt: serverTimestamp()
      }
    );

  } catch (error) {
    console.error("Could not rename chat:", error);

    showError("Could not rename this chat. Check your Firebase rules.");

    button.disabled = false;
  }
}

async function deleteChat(chatId, button) {
  if (!currentUser) return;

  const confirmed = window.confirm(
    "Delete this chat and all its saved messages? This cannot be undone."
  );

  if (!confirmed) return;

  button.disabled = true;
  clearError();

  try {
    const chatRef = doc(
      db,
      "users",
      currentUser.uid,
      "aiChats",
      chatId
    );

    // Firestore does not automatically delete subcollection documents.
    const messagesRef = collection(chatRef, "messages");
    const snapshot = await getDocs(messagesRef);

    // Delete all saved messages belonging to this chat.
    await Promise.all(
      snapshot.docs.map((messageDoc) => deleteDoc(messageDoc.ref))
    );

    // Delete the parent chat after its messages have been deleted.
    await deleteDoc(chatRef);

    if (currentChatId === chatId) {
      stopMessageListenerOnly();

      currentChatId = null;
      conversation = [];

      messagesEl.replaceChildren();
      messagesEl.hidden = true;
      welcomeEl.hidden = false;

      input.value = "";
      attachmentPreview.replaceChildren();

      pendingFiles = [];
      fileInput.value = "";
    }

  } catch (error) {
    console.error("Could not delete chat:", error);

    showError(
      "Could not delete this chat. Check your Firebase rules and try again."
    );

    button.disabled = false;
  }
}

/* =========================================
   RENDER SAVED CHATS
========================================= */

function renderSavedChats(snapshot, list) {
  list.replaceChildren();

  if (snapshot.empty) {
    const empty = document.createElement("p");

    empty.className = "saved-chats-empty";
    empty.textContent = "No saved chats yet.";

    list.appendChild(empty);
    return;
  }

  const chats = snapshot.docs.map((chatDoc) => ({
    id: chatDoc.id,
    data: chatDoc.data()
  }));

  // Pinned chats appear first. Within each group, newest chats appear first.
  chats.sort((a, b) => {
    const pinDifference =
      Number(Boolean(b.data.pinned)) -
      Number(Boolean(a.data.pinned));

    if (pinDifference !== 0) return pinDifference;

    const aTime = a.data.updatedAt?.toMillis?.() || 0;
    const bTime = b.data.updatedAt?.toMillis?.() || 0;

    return bTime - aTime;
  });

  for (const chat of chats) {
    const { id: chatId, data } = chat;

    const item = document.createElement("div");
    item.className = "saved-chat-item";

    if (chatId === currentChatId) {
      item.classList.add("current");
    }

    const openButton = makeButton(
      `${data.pinned ? "📌 " : ""}${data.title || data.preview || "Saved chat"}`,
      "saved-chat-open",
      data.preview || data.title || "Open chat"
    );

    openButton.title = data.title || data.preview || "Open chat";

    if (chatId === currentChatId) {
      openButton.setAttribute("aria-current", "true");
    }

    openButton.addEventListener("click", () => {
      openSavedChat(chatId);
    });

    const actions = document.createElement("div");
    actions.className = "saved-chat-actions";

    const pinButton = makeButton(
      data.pinned ? "📌" : "⌖",
      "saved-chat-action",
      data.pinned ? "Unpin chat" : "Pin chat"
    );

    pinButton.addEventListener("click", () => {
      togglePinChat(
        chatId,
        Boolean(data.pinned),
        pinButton
      );
    });

    const renameButton = makeButton(
      "✎",
      "saved-chat-action",
      "Rename chat"
    );

    renameButton.addEventListener("click", () => {
      renameChat(
        chatId,
        data.title || data.preview || "Saved chat",
        renameButton
      );
    });

    const deleteButton = makeButton(
      "×",
      "saved-chat-action delete",
      "Delete chat"
    );

    deleteButton.addEventListener("click", () => {
      deleteChat(chatId, deleteButton);
    });

    actions.append(pinButton, renameButton, deleteButton);
    item.append(openButton, actions);
    list.appendChild(item);
  }
}

function listenForSavedChats() {
  if (!currentUser || !chatHistoryList) return;

  if (historyUnsubscribe) {
    historyUnsubscribe();
  }

  const chatsRef = collection(
    db,
    "users",
    currentUser.uid,
    "aiChats"
  );

  historyUnsubscribe = onSnapshot(
    query(
      chatsRef,
      orderBy("updatedAt", "desc"),
      limit(50)
    ),
    (snapshot) => {
      renderSavedChats(snapshot, chatHistoryList);
    },
    (error) => {
      console.error("Could not load saved chats:", error);

      showError(
        "Could not load saved chats. Check your Firebase rules."
      );
    }
  );
}

/* =========================================
   FORM EVENTS
========================================= */

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

/* =========================================
   NEW CHAT
========================================= */

$("newChatBtn")?.addEventListener("click", () => {
  if (busy) return;

  stopMessageListenerOnly();

  currentChatId = null;
  conversation = [];
  pendingFiles = [];

  messagesEl.replaceChildren();
  messagesEl.hidden = true;
  welcomeEl.hidden = false;

  input.value = "";
  input.style.height = "auto";

  attachmentPreview.replaceChildren();
  fileInput.value = "";

  clearError();
  listenForSavedChats();

  $("sidebar")?.classList.remove("sidebar-open");

  input.focus();
});

/* =========================================
   SUGGESTED PROMPTS
========================================= */

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    sendMessage(button.dataset.prompt || "");
  });
});

/* =========================================
   MOBILE SIDEBAR
========================================= */

$("menuBtn")?.addEventListener("click", () => {
  $("sidebar")?.classList.toggle("sidebar-open");
});

/* =========================================
   FIREBASE AUTHENTICATION
========================================= */

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    stopChatListeners();

    if ($("connectionStatus")) {
      $("connectionStatus").textContent = "Sign-in required";
    }

    const loginUrl = new URL(
      "../login.html",
      window.location.href
    );

    loginUrl.searchParams.set(
      "redirect",
      "../pages/ai-assistant.html"
    );

    window.location.replace(loginUrl.href);
    return;
  }

  const name = user.displayName || "GradeFlow student";

  if ($("userName")) {
    $("userName").textContent = name;
  }

  if ($("userEmail")) {
    $("userEmail").textContent = user.email || "Signed-in account";
  }

  if ($("userAvatar")) {
    $("userAvatar").textContent = name.charAt(0).toUpperCase();
  }

  if ($("connectionStatus")) {
    $("connectionStatus").textContent = "Signed in";
  }

  await loadAcademicContext(user);

  // Avoid leaving a previous user's listener active.
  listenForSavedChats();
});
