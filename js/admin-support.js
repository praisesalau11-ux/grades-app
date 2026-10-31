
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
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

let currentAdmin = null;
let ticketsCache = [];
let selectedTicketId = null;

let stopTicketsListener = null;
let stopMessagesListener = null;

function showNotice(message, type = "success") {
  adminNotice.textContent = message;
  adminNotice.className = `notice ${type}`;
  adminNotice.hidden = false;
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "Just now";
  return timestamp.toDate().toLocaleString();
}

function validStatus(status) {
  return ["open", "in-progress", "resolved"].includes(status)
    ? status
    : "open";
}

function updateStats() {
  totalTickets.textContent = ticketsCache.length;

  openTickets.textContent = ticketsCache.filter(
    (ticket) => validStatus(ticket.status) === "open"
  ).length;

  progressTickets.textContent = ticketsCache.filter(
    (ticket) => validStatus(ticket.status) === "in-progress"
  ).length;

  resolvedTickets.textContent = ticketsCache.filter(
    (ticket) => validStatus(ticket.status) === "resolved"
  ).length;
}

function getFilteredTickets() {
  const search = adminSearch.value.trim().toLowerCase();
  const status = statusFilter.value;
  const priority = priorityFilter.value;

  return ticketsCache.filter((ticket) => {
    const matchesSearch =
      !search ||
      (ticket.subject || "").toLowerCase().includes(search) ||
      (ticket.userEmail || "").toLowerCase().includes(search) ||
      (ticket.category || "").toLowerCase().includes(search);

    const matchesStatus =
      status === "all" || ticket.status === status;

    const matchesPriority =
      priority === "all" || ticket.priority === priority;

    return matchesSearch && matchesStatus && matchesPriority;
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

  tickets.forEach((ticket) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ticket-card";

    if (ticket.id === selectedTicketId) {
      button.classList.add("selected");
    }

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
  if (stopTicketsListener) stopTicketsListener();

  const ticketsQuery = query(
    collection(db, "supportTickets"),
    orderBy("updatedAt", "desc")
  );

  stopTicketsListener = onSnapshot(
    ticketsQuery,
    (snapshot) => {
      ticketsCache = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      renderAdminTickets();

      if (selectedTicketId) {
        const selected = ticketsCache.find(
          (ticket) => ticket.id === selectedTicketId
        );

        if (selected) {
          conversationMeta.textContent =
            `${selected.userEmail || selected.userId} · ${selected.category}`;
        } else {
          closeAdminConversation();
        }
      }
    },
    (error) => {
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
    (item) => item.id === ticketId
  );

  if (!ticket) return;

  selectedTicketId = ticketId;

  conversationTitle.textContent = ticket.subject;
  conversationMeta.textContent =
    `${ticket.userEmail || ticket.userId} · ${ticket.category}`;

  adminStatus.value = validStatus(ticket.status);
  adminPriority.value = ticket.priority || "normal";

  ticketControls.hidden = false;
  adminReplyForm.hidden = false;

  renderAdminTickets();

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
        empty.textContent = "No messages in this conversation.";
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
            ? "You · GradeFlow Support"
            : `Student · ${ticket.userEmail || "User"}`;

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
      console.error("Admin message listener error:", error);
      showNotice("Could not load this conversation.", "error");
    }
  );

  messageList.scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });
}

function closeAdminConversation() {
  selectedTicketId = null;

  if (stopMessagesListener) {
    stopMessagesListener();
    stopMessagesListener = null;
  }

  conversationTitle.textContent = "Select a ticket";
  conversationMeta.textContent = "Choose a ticket to view its conversation.";

  ticketControls.hidden = true;
  adminReplyForm.hidden = true;

  messageList.innerHTML =
    '<p class="empty-state">Select a ticket to view its messages.</p>';

  renderAdminTickets();
}

// Filters.
adminSearch.addEventListener("input", renderAdminTickets);
statusFilter.addEventListener("change", renderAdminTickets);
priorityFilter.addEventListener("change", renderAdminTickets);

// Save ticket status and priority.
saveTicketChanges.addEventListener("click", async () => {
  if (!currentAdmin || !selectedTicketId) return;

  saveTicketChanges.disabled = true;
  saveTicketChanges.textContent = "Saving...";

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
adminReplyForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = adminReplyMessage.value.trim();

  if (!currentAdmin || !selectedTicketId || !message) return;

  adminSendReply.disabled = true;
  adminSendReply.textContent = "Sending...";

  try {
    await addDoc(
      collection(db, "supportTickets", selectedTicketId, "messages"),
      {
        senderId: currentAdmin.uid,
        senderRole: "admin",
        message,
        createdAt: serverTimestamp()
      }
    );

    await updateDoc(
      doc(db, "supportTickets", selectedTicketId),
      {
        updatedAt: serverTimestamp()
      }
    );

    adminReplyMessage.value = "";

  } catch (error) {
    console.error("Admin reply failed:", error);
    showNotice(
      "Could not send the reply. Check your admin permissions.",
      "error"
    );
  } finally {
    adminSendReply.disabled = false;
    adminSendReply.textContent = "Send reply";
  }
});

// Authentication and admin verification.
onAuthStateChanged(auth, async (user) => {
  currentAdmin = null;

  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  try {
    const token = await user.getIdToken(true);

    const adminResponse = await fetch(
      `https://firestore.googleapis.com/v1/projects/grades-calculator-72499/databases/(default)/documents/admins/${encodeURIComponent(user.uid)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!adminResponse.ok) {
      if (adminResponse.status === 404 || adminResponse.status === 403) {
        document.querySelector(".admin-layout").innerHTML =
          "<section class='support-panel'><h2>Access denied</h2><p>Your account is not authorised to manage GradeFlow support tickets.</p><a href='../dashboard.html'>Return to dashboard</a></section>";
        return;
      }

      throw new Error(`Admin verification failed: ${adminResponse.status}`);
    }

    const adminDocument = await adminResponse.json();

    const fields = adminDocument.fields || {};
    const role = fields.role?.stringValue;
    const active = fields.active?.booleanValue;

    if (role !== "admin" || active !== true) {
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
});
