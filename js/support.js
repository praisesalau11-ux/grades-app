import { auth, db, storage } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  MAX_ATTACHMENT_SIZE,
  validateSupportFile,
  sendSupportMessage,
  renderSupportMessages,
  formatDate
} from "./support-messaging.js";

const ticketForm = document.getElementById("ticketForm");
const ticketList = document.getElementById("ticketList");
const ticketCount = document.getElementById("ticketCount");
const supportMessage = document.getElementById("supportMessage");

const conversationPanel = document.getElementById("conversationPanel");
const conversationTitle = document.getElementById("conversationTitle");
const conversationMeta = document.getElementById("conversationMeta");
const messageList = document.getElementById("messageList");

const replyForm = document.getElementById("replyForm");
const replyMessage = document.getElementById("replyMessage");

const submitTicket = document.getElementById("submitTicket");
const sendReply = document.getElementById("sendReply");
const closeConversation = document.getElementById("closeConversation");

const imageInput = document.getElementById("imageAttachment");
const fileInput = document.getElementById("fileAttachment");
const audioInput = document.getElementById("audioAttachment");
const recordButton = document.getElementById("recordVoice");
const recordingState = document.getElementById("recordingState");
const attachmentPreview = document.getElementById("attachmentPreview");

let currentUser = null;
let selectedTicketId = null;
let ticketsCache = [];

let stopTicketsListener = null;
let stopMessagesListener = null;

let selectedFile = null;
let mediaRecorder = null;
let mediaStream = null;
let recordedChunks = [];

function showNotice(message, type = "success") {
  supportMessage.textContent = message;
  supportMessage.className = `notice ${type}`;
  supportMessage.hidden = false;
}

function safeStatus(status) {
  return ["open", "in-progress", "resolved"].includes(status)
    ? status
    : "open";
}

function renderTickets() {
  ticketCount.textContent = ticketsCache.length;

  if (!ticketsCache.length) {
    ticketList.innerHTML =
      '<p class="empty-state">You have not submitted any support tickets yet.</p>';
    return;
  }

  ticketList.replaceChildren();

  ticketsCache.forEach((ticket) => {
    const button = document.createElement("button");

    button.type = "button";
    button.className =
      `ticket-card${ticket.id === selectedTicketId ? " selected" : ""}`;

    const top = document.createElement("div");
    top.className = "ticket-card-top";

    const title = document.createElement("strong");
    title.textContent = ticket.subject || "Untitled ticket";

    const status = document.createElement("span");
    const state = safeStatus(ticket.status);

    status.className = `status status-${state}`;
    status.textContent = state.replace("-", " ");

    top.append(title, status);

    const category = document.createElement("small");
    category.textContent = ticket.category || "Other";

    const date = document.createElement("small");
    date.textContent = formatDate(ticket.updatedAt);

    const priority = document.createElement("span");
    priority.className = "priority";
    priority.textContent = `Priority: ${ticket.priority || "normal"}`;

    button.append(top, category, priority, date);

    button.addEventListener("click", () => {
      openConversation(ticket.id);
    });

    ticketList.appendChild(button);
  });
}

function listenToTickets(user) {
  stopTicketsListener?.();

  const ticketsQuery = query(
    collection(db, "supportTickets"),
    where("userId", "==", user.uid)
  );

  stopTicketsListener = onSnapshot(
    ticketsQuery,
    (snapshot) => {
      ticketsCache = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      ticketsCache.sort((a, b) => {
        return (
          (b.updatedAt?.toMillis?.() || 0) -
          (a.updatedAt?.toMillis?.() || 0)
        );
      });

      renderTickets();

      if (selectedTicketId) {
        const selected = ticketsCache.find(
          (ticket) => ticket.id === selectedTicketId
        );

        if (selected) {
          conversationMeta.textContent =
            `${selected.category} · ${safeStatus(selected.status)} · ${selected.priority} priority`;
        } else {
          closeCurrentConversation();
        }
      }
    },
    (error) => {
      console.error("Ticket listener error:", error);

      showNotice(
        "Could not load your tickets. Check your connection or contact support.",
        "error"
      );
    }
  );
}

function openConversation(ticketId) {
  selectedTicketId = ticketId;

  const ticket = ticketsCache.find(
    (item) => item.id === ticketId
  );

  if (!ticket) return;

  conversationPanel.hidden = false;
  conversationTitle.textContent = ticket.subject || "Ticket conversation";

  conversationMeta.textContent =
    `${ticket.category} · ${safeStatus(ticket.status)} · ${ticket.priority} priority`;

  renderTickets();

  stopMessagesListener?.();

  messageList.innerHTML =
    '<p class="empty-state">Loading conversation...</p>';

  const messagesQuery = query(
    collection(db, "supportTickets", ticketId, "messages"),
    orderBy("createdAt", "asc")
  );

  stopMessagesListener = onSnapshot(
    messagesQuery,
    (snapshot) => {
      renderSupportMessages({
        snapshot,
        container: messageList,
        storage,
        currentUser,
        currentRole: "user",
        otherAuthor: "GradeFlow Support",
        db,
        ticketId,
        onNotice: (message, type) => {
          showNotice(message, type || "success");
        }
      });
    },
    (error) => {
      console.error("Message listener error:", error);
      showNotice("Could not load this conversation.", "error");
    }
  );

  conversationPanel.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function clearSelectedAttachment() {
  selectedFile = null;

  [imageInput, fileInput, audioInput].forEach((input) => {
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

    mediaRecorder.addEventListener("dataavailable", (event) => {
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

      mediaStream?.getTracks().forEach((track) => {
        track.stop();
      });

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

    mediaStream?.getTracks().forEach((track) => {
      track.stop();
    });

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

function closeCurrentConversation() {
  selectedTicketId = null;

  stopMessagesListener?.();
  stopMessagesListener = null;

  conversationPanel.hidden = true;

  renderTickets();
  clearSelectedAttachment();
}

closeConversation.addEventListener(
  "click",
  closeCurrentConversation
);

// Create a ticket and its first message.
ticketForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) {
    showNotice(
      "You must be signed in to submit a ticket.",
      "error"
    );
    return;
  }

  const subject =
    document.getElementById("ticketSubject").value.trim();

  const category =
    document.getElementById("ticketCategory").value;

  const priority =
    document.getElementById("ticketPriority").value;

  const description =
    document.getElementById("ticketDescription").value.trim();

  if (subject.length < 4 || description.length < 10) {
    showNotice(
      "Enter a subject of at least 4 characters and a description of at least 10 characters.",
      "error"
    );
    return;
  }

  submitTicket.disabled = true;
  submitTicket.textContent = "Submitting…";

  try {
    const ticketRef = await addDoc(
      collection(db, "supportTickets"),
      {
        userId: currentUser.uid,
        userEmail: currentUser.email || "",
        subject,
        category,
        priority,
        status: "open",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }
    );

    await addDoc(
      collection(db, "supportTickets", ticketRef.id, "messages"),
      {
        senderId: currentUser.uid,
        senderRole: "user",
        message: description,
        createdAt: serverTimestamp()
      }
    );

    ticketForm.reset();

    showNotice(
      "Your support ticket was submitted successfully."
    );

    setTimeout(() => {
      openConversation(ticketRef.id);
    }, 500);

  } catch (error) {
    console.error("Ticket submission failed:", error);

    showNotice(
      error.code === "permission-denied"
        ? "Permission denied. Check your Firestore security rules."
        : "Ticket submission failed. Please try again.",
      "error"
    );

  } finally {
    submitTicket.disabled = false;
    submitTicket.textContent = "Submit support ticket";
  }
});

// Send a text message or attachment.
replyForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = replyMessage.value.trim();

  if (
    !currentUser ||
    !selectedTicketId ||
    (!message && !selectedFile)
  ) {
    showNotice(
      "Write a reply or attach a file first.",
      "error"
    );
    return;
  }

  sendReply.disabled = true;
  sendReply.textContent = "Sending…";

  try {
    await sendSupportMessage({
      db,
      storage,
      ticketId: selectedTicketId,
      user: currentUser,
      role: "user",
      message,
      file: selectedFile
    });

    replyMessage.value = "";
    clearSelectedAttachment();

    showNotice("Reply sent.");

  } catch (error) {
    console.error("Reply failed:", error);

    showNotice(
      error.message || "Your reply could not be sent. Please try again.",
      "error"
    );

  } finally {
    sendReply.disabled = false;
    sendReply.textContent = "Send reply";
  }
});

// Authentication.
onAuthStateChanged(auth, (user) => {
  currentUser = user;

  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  listenToTickets(user);
});

window.addEventListener("beforeunload", () => {
  stopTicketsListener?.();
  stopMessagesListener?.();

  mediaStream?.getTracks().forEach((track) => {
    track.stop();
  });
});