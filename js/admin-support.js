import { auth, db, storage } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  MAX_ATTACHMENT_SIZE,
  validateSupportFile,
  sendSupportMessage,
  renderSupportMessages,
  formatDate
} from "./support-messaging.js";

const adminNotice = document.getElementById("adminNotice");
const adminTicketList = document.getElementById("adminTicketList");

const totalTickets = document.getElementById("totalTickets");
const openTickets = document.getElementById("openTickets");
const progressTickets = document.getElementById("progressTickets");
const resolvedTickets = document.getElementById("resolvedTickets");

const adminSearch = document.getElementById("adminSearch");
const statusFilter = document.getElementById("statusFilter");
const priorityFilter = document.getElementById("priorityFilter");

const conversationTitle = document.getElementById("adminConversationTitle");
const conversationMeta = document.getElementById("adminConversationMeta");
const messageList = document.getElementById("adminMessageList");

const ticketControls = document.getElementById("ticketControls");
const adminStatus = document.getElementById("adminStatus");
const adminPriority = document.getElementById("adminPriority");
const saveTicketChanges = document.getElementById("saveTicketChanges");

const adminReplyForm = document.getElementById("adminReplyForm");
const adminReplyMessage = document.getElementById("adminReplyMessage");
const adminSendReply = document.getElementById("adminSendReply");

const imageInput = document.getElementById("adminImageAttachment");
const fileInput = document.getElementById("adminFileAttachment");
const audioInput = document.getElementById("adminAudioAttachment");

const recordButton = document.getElementById("adminRecordVoice");
const recordingState = document.getElementById("adminRecordingState");
const attachmentPreview = document.getElementById("adminAttachmentPreview");

let currentAdmin = null;
let ticketsCache = [];
let selectedTicketId = null;

let stopTicketsListener = null;
let stopMessagesListener = null;

let selectedFile = null;
let mediaRecorder = null;
let mediaStream = null;
let recordedChunks = [];

function showNotice(message, type = "success") {
  adminNotice.textContent = message;
  adminNotice.className = `notice ${type}`;
  adminNotice.hidden = false;
}

function validStatus(status) {
  return ["open", "in-progress", "resolved"].includes(status)
    ? status
    : "open";
}

function updateStats() {
  totalTickets.textContent = ticketsCache.length;

  openTickets.textContent = ticketsCache.filter(
    ticket => validStatus(ticket.status) === "open"
  ).length;

  progressTickets.textContent = ticketsCache.filter(
    ticket => validStatus(ticket.status) === "in-progress"
  ).length;

  resolvedTickets.textContent = ticketsCache.filter(
    ticket => validStatus(ticket.status) === "resolved"
  ).length;
}

function getFilteredTickets() {
  const search = adminSearch.value.trim().toLowerCase();
  const status = statusFilter.value;
  const priority = priorityFilter.value;

  return ticketsCache.filter(ticket => {
    const matchesSearch =
      !search ||
      (ticket.subject || "").toLowerCase().includes(search) ||
      (ticket.userEmail || "").toLowerCase().includes(search) ||
      (ticket.category || "").toLowerCase().includes(search);

    return (
      matchesSearch &&
      (status === "all" || ticket.status === status) &&
      (priority === "all" || ticket.priority === priority)
    );
  });
}

function renderAdminTickets() {
  updateStats();

  const tickets = getFilteredTickets();

  adminTicketList.replaceChildren();

  if (!tickets.length) {
    const empty = document.createElement("p");

    empty.className = "empty-state";

    empty.textContent = ticketsCache.length
      ? "No tickets match these filters."
      : "There are no support tickets yet.";

    adminTicketList.appendChild(empty);
    return;
  }

  tickets.forEach(ticket => {
    const button = document.createElement("button");

    button.type = "button";
    button.className =
      `ticket-card${ticket.id === selectedTicketId ? " selected" : ""}`;

    const top = document.createElement("div");
    top.className = "ticket-card-top";

    const subject = document.createElement("strong");
    subject.textContent = ticket.subject || "Untitled ticket";

    const status = document.createElement("span");
    const state = validStatus(ticket.status);

    status.className = `status status-${state}`;
    status.textContent = state.replace("-", " ");

    top.append(subject, status);

    const email = document.createElement("small");
    email.textContent = ticket.userEmail || ticket.userId;

    const category = document.createElement("small");
    category.textContent = ticket.category || "Other";

    const date = document.createElement("small");
    date.textContent = formatDate(ticket.updatedAt);

    const priority = document.createElement("span");
    priority.className = "priority";
    priority.textContent = `Priority: ${ticket.priority || "normal"}`;

    button.append(top, email, category, priority, date);

    button.addEventListener("click", () => {
      openAdminConversation(ticket.id);
    });

    adminTicketList.appendChild(button);
  });
}

function listenToAllTickets() {
  stopTicketsListener?.();

  const ticketsQuery = query(
    collection(db, "supportTickets"),
    orderBy("updatedAt", "desc")
  );

  stopTicketsListener = onSnapshot(
    ticketsQuery,
    snapshot => {
      ticketsCache = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      renderAdminTickets();

      if (selectedTicketId) {
        const selected = ticketsCache.find(
          ticket => ticket.id === selectedTicketId
        );

        if (selected) {
          conversationMeta.textContent =
            `${selected.userEmail || selected.userId} · ${selected.category}`;
        } else {
          closeAdminConversation();
        }
      }
    },
    error => {
      console.error("Admin ticket listener error:", error);

      showNotice(
        "Could not load tickets. Check your admin permissions and Firestore rules.",
        "error"
      );
    }
  );
}

function openAdminConversation(ticketId) {
  const ticket = ticketsCache.find(
    item => item.id === ticketId
  );

  if (!ticket) return;

  selectedTicketId = ticketId;

  conversationTitle.textContent =
    ticket.subject || "Support ticket";

  conversationMeta.textContent =
    `${ticket.userEmail || ticket.userId} · ${ticket.category}`;

  adminStatus.value = validStatus(ticket.status);
  adminPriority.value = ticket.priority || "normal";

  ticketControls.hidden = false;
  adminReplyForm.hidden = false;

  renderAdminTickets();

  stopMessagesListener?.();

  messageList.innerHTML =
    '<p class="empty-state">Loading conversation...</p>';

  const messagesQuery = query(
    collection(db, "supportTickets", ticketId, "messages"),
    orderBy("createdAt", "asc")
  );

  stopMessagesListener = onSnapshot(
    messagesQuery,
    snapshot => {
      renderSupportMessages({
        snapshot,
        container: messageList,
        storage,
        currentUser: currentAdmin,
        currentRole: "admin",
        otherAuthor: `Student · ${ticket.userEmail || "User"}`,
        db,
        ticketId,
        onNotice: (message, type) => {
          showNotice(message, type || "success");
        }
      });
    },
    error => {
      console.error("Admin message listener error:", error);
      showNotice("Could not load this conversation.", "error");
    }
  );

  messageList.scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });
}

function clearSelectedAttachment() {
  selectedFile = null;

  [imageInput, fileInput, audioInput].forEach(input => {
    input.value = "";
  });

  attachmentPreview.hidden = true;
  attachmentPreview.replaceChildren();
}

function setSelectedAttachment(file) {
  const problem = validateSupportFile(file);

  if (problem) {
    showNotice(problem, "error");
    clearSelectedAttachment();
    return;
  }

  selectedFile = file;
  attachmentPreview.replaceChildren();

  const label = document.createElement("span");

  label.textContent =
    `${file.name || "Voice recording"} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;

  const remove = document.createElement("button");

  remove.type = "button";
  remove.textContent = "Remove";

  remove.addEventListener("click", clearSelectedAttachment);

  attachmentPreview.append(label, remove);
  attachmentPreview.hidden = false;
}

imageInput.addEventListener("change", () => {
  fileInput.value = audioInput.value = "";

  if (imageInput.files[0]) {
    setSelectedAttachment(imageInput.files[0]);
  }
});

fileInput.addEventListener("change", () => {
  imageInput.value = audioInput.value = "";

  if (fileInput.files[0]) {
    setSelectedAttachment(fileInput.files[0]);
  }
});

audioInput.addEventListener("change", () => {
  imageInput.value = fileInput.value = "";

  if (audioInput.files[0]) {
    setSelectedAttachment(audioInput.files[0]);
  }
});

async function startVoiceRecording() {
  if (
    !navigator.mediaDevices?.getUserMedia ||
    !window.MediaRecorder
  ) {
    showNotice(
      "Voice recording is not supported by this browser. Try a current browser over HTTPS.",
      "error"
    );
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });

    const preferred =
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "";

    mediaRecorder = new MediaRecorder(
      mediaStream,
      preferred ? { mimeType: preferred } : undefined
    );

    recordedChunks = [];

    mediaRecorder.addEventListener("dataavailable", event => {
      if (event.data.size) {
        recordedChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("stop", () => {
      const rawType = mediaRecorder.mimeType || "audio/webm";
      const type = rawType.split(";")[0].toLowerCase();

      const blob = new Blob(recordedChunks, { type });

      const extension = type.includes("mp4")
        ? "m4a"
        : type.includes("ogg")
          ? "ogg"
          : "webm";

      const file = new File(
        [blob],
        `voice-message-${Date.now()}.${extension}`,
        { type }
      );

      mediaStream?.getTracks().forEach(track => track.stop());
      mediaStream = null;

      recordButton.textContent = "Record voice";
      recordingState.textContent = "";

      if (file.size > MAX_ATTACHMENT_SIZE) {
        showNotice(
          "Recording exceeded 10 MB. Record a shorter message.",
          "error"
        );
      } else {
        setSelectedAttachment(file);
      }
    });

    mediaRecorder.start();

    recordButton.textContent = "Stop recording";
    recordingState.textContent = "Recording…";

  } catch (error) {
    console.error("Voice recording error:", error);

    mediaStream?.getTracks().forEach(track => track.stop());
    mediaStream = null;

    showNotice(
      "Microphone access failed. Allow microphone permission and try again.",
      "error"
    );
  }
}

recordButton.addEventListener("click", () => {
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
  } else {
    startVoiceRecording();
  }
});

// Ticket filters.
adminSearch.addEventListener("input", renderAdminTickets);
statusFilter.addEventListener("change", renderAdminTickets);
priorityFilter.addEventListener("change", renderAdminTickets);

// Save ticket status and priority.
saveTicketChanges.addEventListener("click", async () => {
  if (!currentAdmin || !selectedTicketId) return;

  saveTicketChanges.disabled = true;
  saveTicketChanges.textContent = "Saving…";

  try {
    await updateDoc(
      doc(db, "supportTickets", selectedTicketId),
      {
        status: adminStatus.value,
        priority: adminPriority.value,
        updatedAt: serverTimestamp()
      }
    );

    showNotice("Ticket updated successfully.");

  } catch (error) {
    console.error("Ticket update failed:", error);
    showNotice("Could not update this ticket.", "error");

  } finally {
    saveTicketChanges.disabled = false;
    saveTicketChanges.textContent = "Save changes";
  }
});

// Send an admin reply.
adminReplyForm.addEventListener("submit", async event => {
  event.preventDefault();

  const message = adminReplyMessage.value.trim();

  if (
    !currentAdmin ||
    !selectedTicketId ||
    (!message && !selectedFile)
  ) {
    showNotice(
      "Write a reply or attach a file first.",
      "error"
    );
    return;
  }

  adminSendReply.disabled = true;
  adminSendReply.textContent = "Sending…";

  try {
    await sendSupportMessage({
      db,
      storage,
      ticketId: selectedTicketId,
      user: currentAdmin,
      role: "admin",
      message,
      file: selectedFile
    });

    adminReplyMessage.value = "";
    clearSelectedAttachment();

    showNotice("Reply sent to the student.");

  } catch (error) {
    console.error("Admin reply failed:", error);

    showNotice(
      error.message ||
      "Could not send the reply. Check your admin permissions.",
      "error"
    );

  } finally {
    adminSendReply.disabled = false;
    adminSendReply.textContent = "Send reply";
  }
});

function closeAdminConversation() {
  selectedTicketId = null;

  stopMessagesListener?.();
  stopMessagesListener = null;

  conversationTitle.textContent = "Select a ticket";

  conversationMeta.textContent =
    "Choose a ticket to view its conversation.";

  ticketControls.hidden = true;
  adminReplyForm.hidden = true;

  messageList.innerHTML =
    '<p class="empty-state">Select a ticket to view its messages.</p>';

  clearSelectedAttachment();
  renderAdminTickets();
}

// Admin authentication and verification.
onAuthStateChanged(auth, async user => {
  currentAdmin = null;

  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  try {
    const token = await user.getIdToken(true);

    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/grades-calculator-72499/databases/(default)/documents/admins/${encodeURIComponent(user.uid)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!response.ok) {
      if (response.status === 404 || response.status === 403) {
        document.querySelector(".admin-layout").innerHTML =
          "<section class='support-panel'><h2>Access denied</h2><p>Your account is not authorised to manage GradeFlow support tickets.</p><a href='../dashboard.html'>Return to dashboard</a></section>";

        return;
      }

      throw new Error(
        `Admin verification failed: ${response.status}`
      );
    }

    const adminDocument = await response.json();
    const fields = adminDocument.fields || {};

    if (
      fields.role?.stringValue !== "admin" ||
      fields.active?.booleanValue !== true
    ) {
      document.querySelector(".admin-layout").innerHTML =
        "<section class='support-panel'><h2>Access denied</h2><p>Your account is not authorised to manage GradeFlow support tickets.</p><a href='../dashboard.html'>Return to dashboard</a></section>";

      return;
    }

    currentAdmin = user;
    listenToAllTickets();

  } catch (error) {
    console.error("Admin verification error:", error);

    showNotice(
      "Admin verification failed. Check your connection and administrator setup.",
      "error"
    );
  }
});

window.addEventListener("beforeunload", () => {
  stopTicketsListener?.();
  stopMessagesListener?.();

  mediaStream?.getTracks().forEach(track => track.stop());
});