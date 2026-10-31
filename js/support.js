
import { auth, db } from "./firebase.js";

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
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

let currentUser = null;
let selectedTicketId = null;
let ticketsCache = [];
let stopTicketsListener = null;
let stopMessagesListener = null;

function showNotice(message, type = "success") {
  supportMessage.textContent = message;
  supportMessage.className = `notice ${type}`;
  supportMessage.hidden = false;

  supportMessage.scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "Just now";

  return timestamp.toDate().toLocaleString();
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

    button.className = "ticket-card";

    if (ticket.id === selectedTicketId) {
      button.classList.add("selected");
    }

    const top = document.createElement("div");
    top.className = "ticket-card-top";

    const title = document.createElement("strong");
    title.textContent = ticket.subject || "Untitled ticket";

    const status = document.createElement("span");
    const statusValue = safeStatus(ticket.status);

    status.className = `status status-${statusValue}`;
    status.textContent = statusValue.replace("-", " ");

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
  if (stopTicketsListener) {
    stopTicketsListener();
  }

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
        const dateA = a.updatedAt?.toMillis?.() || 0;
        const dateB = b.updatedAt?.toMillis?.() || 0;
        return dateB - dateA;
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
  conversationTitle.textContent = ticket.subject;
  conversationMeta.textContent =
    `${ticket.category} · ${safeStatus(ticket.status)} · ${ticket.priority} priority`;

  renderTickets();

  if (stopMessagesListener) {
    stopMessagesListener();
  }

  messageList.innerHTML =
    '<p class="empty-state">Loading conversation...</p>';

  const messagesQuery = query(
    collection(db, "supportTickets", ticketId, "messages"),
    orderBy("createdAt", "asc")
  );

  stopMessagesListener = onSnapshot(
    messagesQuery,
    (snapshot) => {
      messageList.replaceChildren();

      if (snapshot.empty) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No messages yet.";
        messageList.appendChild(empty);
        return;
      }

      snapshot.docs.forEach((messageDoc) => {
        const message = messageDoc.data();

        const bubble = document.createElement("div");
        bubble.className =
          message.senderRole === "admin"
            ? "message admin"
            : "message user";

        const author = document.createElement("span");
        author.className = "message-author";
        author.textContent =
          message.senderRole === "admin"
            ? "GradeFlow Support"
            : "You";

        const text = document.createElement("p");
        text.className = "message-text";
        text.textContent = message.message || "";

        const time = document.createElement("span");
        time.className = "message-time";
        time.textContent = formatDate(message.createdAt);

        bubble.append(author, text, time);
        messageList.appendChild(bubble);
      });

      messageList.scrollTop = messageList.scrollHeight;
    },
    (error) => {
      console.error("Message listener error:", error);
      showNotice(
        "Could not load this conversation.",
        "error"
      );
    }
  );

  conversationPanel.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function closeCurrentConversation() {
  selectedTicketId = null;

  if (stopMessagesListener) {
    stopMessagesListener();
    stopMessagesListener = null;
  }

  conversationPanel.hidden = true;
  renderTickets();
}

closeConversation.addEventListener("click", closeCurrentConversation);

// Create a ticket.
ticketForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) {
    showNotice("You must be signed in to submit a ticket.", "error");
    return;
  }

  const subject = document.getElementById("ticketSubject").value.trim();
  const category = document.getElementById("ticketCategory").value;
  const priority = document.getElementById("ticketPriority").value;
  const description = document.getElementById("ticketDescription").value.trim();

  if (subject.length < 4 || description.length < 10) {
    showNotice(
      "Enter a subject of at least 4 characters and a description of at least 10 characters.",
      "error"
    );
    return;
  }

  submitTicket.disabled = true;
  submitTicket.textContent = "Submitting...";

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

    showNotice("Your support ticket was submitted successfully.");

    // The realtime listener will receive the new ticket.
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

// Send a reply.
replyForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = replyMessage.value.trim();

  if (!currentUser || !selectedTicketId || !message) return;

  sendReply.disabled = true;
  sendReply.textContent = "Sending...";

  try {
    const ticketRef = doc(db, "supportTickets", selectedTicketId);

    await addDoc(
      collection(db, "supportTickets", selectedTicketId, "messages"),
      {
        senderId: currentUser.uid,
        senderRole: "user",
        message,
        createdAt: serverTimestamp()
      }
    );

    await updateDoc(ticketRef, {
      updatedAt: serverTimestamp()
    });

    replyMessage.value = "";

  } catch (error) {
    console.error("Reply failed:", error);
    showNotice(
      "Your reply could not be sent. Please try again.",
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
});
