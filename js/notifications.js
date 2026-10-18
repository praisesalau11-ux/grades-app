// ============================================
// GRADEFLOW NOTIFICATIONS
// File: js/notifications.js
// Firebase JS SDK v10.12.0
// ============================================

import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ============================================
// ELEMENTS
// ============================================

const statusBox = document.getElementById("notificationStatus");
const loadingState = document.getElementById("notificationLoading");
const notificationList = document.getElementById("notificationList");
const emptyState = document.getElementById("notificationEmpty");

const emptyTitle = document.getElementById("emptyTitle");
const emptyMessage = document.getElementById("emptyMessage");

const totalCount = document.getElementById("totalCount");
const unreadCount = document.getElementById("unreadCount");
const readCount = document.getElementById("readCount");

const markAllReadButton = document.getElementById("markAllReadButton");
const clearAllButton = document.getElementById("clearAllButton");

const filterButtons = document.querySelectorAll("[data-filter]");

// ============================================
// STATE
// ============================================

let currentUser = null;
let notificationRecords = [];
let activeFilter = "all";
let unsubscribeNotifications = null;
let actionInProgress = false;

// ============================================
// NOTIFICATION COLLECTION
// users/{uid}/notifications/{notificationId}
// ============================================

function getNotificationsCollection(user) {
  return collection(
    db,
    "users",
    user.uid,
    "notifications"
  );
}

// ============================================
// STATUS MESSAGE
// ============================================

function showStatus(message, kind = "success") {
  statusBox.textContent = message;
  statusBox.dataset.kind = kind;
  statusBox.hidden = false;
}

function hideStatus() {
  statusBox.hidden = true;
  statusBox.textContent = "";
}

// ============================================
// SAFE TEXT AND DATE HELPERS
// ============================================

function safeText(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function getNotificationDate(notification) {
  const value = notification.createdAt;

  if (value && typeof value.toDate === "function") {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

function formatNotificationDate(notification) {
  const date = getNotificationDate(notification);

  if (!date) return "Recently";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function getNotificationIcon(type) {
  const icons = {
    academic: "⌗",
    grade: "▤",
    goal: "◎",
    reminder: "◷",
    system: "✦",
    welcome: "G"
  };

  return icons[type] || "♧";
}

// ============================================
// FILTERS
// ============================================

function getFilteredNotifications() {
  if (activeFilter === "unread") {
    return notificationRecords.filter(
      (item) => item.read !== true
    );
  }

  if (activeFilter === "read") {
    return notificationRecords.filter(
      (item) => item.read === true
    );
  }

  return notificationRecords;
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter || "all";

    filterButtons.forEach((filterButton) => {
      const selected = filterButton === button;

      filterButton.classList.toggle("active", selected);
      filterButton.setAttribute(
        "aria-pressed",
        String(selected)
      );
    });

    hideStatus();
    renderNotifications();
  });
});

// ============================================
// SUMMARY COUNTS
// ============================================

function renderCounts() {
  const total = notificationRecords.length;

  const unread = notificationRecords.filter(
    (item) => item.read !== true
  ).length;

  totalCount.textContent = String(total);
  unreadCount.textContent = String(unread);
  readCount.textContent = String(total - unread);

  // Update the existing dashboard sidebar badge
  // when this page is displayed.
  const sidebarBadge = document.getElementById("notificationCount");

  if (sidebarBadge) {
    sidebarBadge.textContent = String(unread);
    sidebarBadge.hidden = unread === 0;
  }

  markAllReadButton.disabled =
    actionInProgress || unread === 0;

  clearAllButton.disabled =
    actionInProgress || total === 0;
}

// ============================================
// EMPTY STATE
// ============================================

function renderEmptyState() {
  notificationList.hidden = true;
  notificationList.replaceChildren();
  emptyState.hidden = false;

  if (notificationRecords.length === 0) {
    emptyTitle.textContent = "You're all caught up";
    emptyMessage.textContent =
      "New notifications will appear here when GradeFlow creates them.";
    return;
  }

  emptyTitle.textContent = "No matching notifications";

  if (activeFilter === "unread") {
    emptyMessage.textContent =
      "You have no unread notifications. Try the All filter.";
  } else {
    emptyMessage.textContent =
      "There are no notifications in this filter.";
  }
}

// ============================================
// CREATE A NOTIFICATION CARD
// ============================================

function createNotificationCard(notification) {
  const card = document.createElement("article");

  card.className = "notification-item";

  if (notification.read !== true) {
    card.classList.add("unread");
  }

  const icon = document.createElement("div");
  icon.className = "notification-symbol";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = getNotificationIcon(notification.type);

  const content = document.createElement("div");
  content.className = "notification-content";

  const type = document.createElement("span");
  type.className = "notification-type";
  type.textContent = safeText(notification.type, "update");

  const title = document.createElement("h3");
  title.textContent = safeText(
    notification.title,
    "GradeFlow notification"
  );

  const message = document.createElement("p");
  message.textContent = safeText(
    notification.message,
    "Open GradeFlow to review this update."
  );

  const time = document.createElement("span");
  time.className = "notification-time";
  time.textContent = formatNotificationDate(notification);

  content.append(type, title, message, time);

  const actions = document.createElement("div");
  actions.className = "notification-actions";

  const readButton = document.createElement("button");
  readButton.type = "button";

  readButton.textContent =
    notification.read === true
      ? "Mark unread"
      : "Mark read";

  readButton.addEventListener("click", () => {
    changeReadStatus(
      notification.id,
      notification.read !== true
    );
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-notification";
  deleteButton.textContent = "Delete";

  deleteButton.addEventListener("click", () => {
    deleteNotification(notification.id);
  });

  actions.append(readButton, deleteButton);

  card.append(icon, content, actions);

  return card;
}

// ============================================
// RENDER NOTIFICATIONS
// ============================================

function renderNotifications() {
  renderCounts();

  const filtered = getFilteredNotifications();

  if (filtered.length === 0) {
    renderEmptyState();
    return;
  }

  emptyState.hidden = true;
  notificationList.hidden = false;
  notificationList.replaceChildren();

  const fragment = document.createDocumentFragment();

  filtered.forEach((notification) => {
    fragment.appendChild(
      createNotificationCard(notification)
    );
  });

  notificationList.appendChild(fragment);
}

// ============================================
// MARK ONE NOTIFICATION READ / UNREAD
// ============================================

async function changeReadStatus(notificationId, isRead) {
  if (!currentUser || actionInProgress) return;

  hideStatus();
  actionInProgress = true;
  renderCounts();

  try {
    const notificationRef = doc(
      db,
      "users",
      currentUser.uid,
      "notifications",
      notificationId
    );

    await updateDoc(notificationRef, {
      read: isRead,
      updatedAt: serverTimestamp()
    });

    showStatus(
      isRead
        ? "Notification marked as read."
        : "Notification marked as unread."
    );
  } catch (error) {
    console.error("Notification update failed:", error);

    showStatus(
      "Could not update this notification. Check your connection and Firestore rules.",
      "error"
    );
  } finally {
    actionInProgress = false;
    renderCounts();
  }
}

// ============================================
// MARK ALL AS READ
// ============================================

markAllReadButton?.addEventListener("click", async () => {
  if (!currentUser || actionInProgress) return;

  const unread = notificationRecords.filter(
    (item) => item.read !== true
  );

  if (unread.length === 0) return;

  actionInProgress = true;
  hideStatus();
  renderCounts();

  try {
    // Firestore batches support at most 500 writes.
    for (let start = 0; start < unread.length; start += 400) {
      const chunk = unread.slice(start, start + 400);
      const batch = writeBatch(db);

      chunk.forEach((notification) => {
        const notificationRef = doc(
          db,
          "users",
          currentUser.uid,
          "notifications",
          notification.id
        );

        batch.update(notificationRef, {
          read: true,
          updatedAt: serverTimestamp()
        });
      });

      await batch.commit();
    }

    showStatus("All notifications marked as read.");
  } catch (error) {
    console.error("Mark-all-read failed:", error);

    showStatus(
      "Some notifications could not be updated. Check Firestore permissions.",
      "error"
    );
  } finally {
    actionInProgress = false;
    renderCounts();
  }
});

// ============================================
// DELETE ONE NOTIFICATION
// ============================================

async function deleteNotification(notificationId) {
  if (!currentUser || actionInProgress) return;

  const confirmed = window.confirm(
    "Delete this notification? This cannot be undone."
  );

  if (!confirmed) return;

  actionInProgress = true;
  hideStatus();
  renderCounts();

  try {
    await deleteDoc(
      doc(
        db,
        "users",
        currentUser.uid,
        "notifications",
        notificationId
      )
    );

    showStatus("Notification deleted.");
  } catch (error) {
    console.error("Notification deletion failed:", error);

    showStatus(
      "Could not delete this notification. Check Firestore permissions.",
      "error"
    );
  } finally {
    actionInProgress = false;
    renderCounts();
  }
}

// ============================================
// CLEAR ALL NOTIFICATIONS
// ============================================

clearAllButton?.addEventListener("click", async () => {
  if (!currentUser || actionInProgress) return;
  if (notificationRecords.length === 0) return;

  const confirmed = window.confirm(
    `Permanently delete all ${notificationRecords.length} notifications?`
  );

  if (!confirmed) return;

  actionInProgress = true;
  hideStatus();
  renderCounts();

  try {
    // Use chunks to avoid Firestore's 500-write batch limit.
    for (let start = 0; start < notificationRecords.length; start += 400) {
      const chunk = notificationRecords.slice(start, start + 400);
      const batch = writeBatch(db);

      chunk.forEach((notification) => {
        const notificationRef = doc(
          db,
          "users",
          currentUser.uid,
          "notifications",
          notification.id
        );

        batch.delete(notificationRef);
      });

      await batch.commit();
    }

    showStatus("All notifications deleted.");
  } catch (error) {
    console.error("Clear-all failed:", error);

    showStatus(
      "Some notifications could not be deleted. Refresh the page and try again.",
      "error"
    );
  } finally {
    actionInProgress = false;
    renderCounts();
  }
});

// ============================================
// LIVE FIRESTORE LISTENER
// ============================================

function startNotificationListener(user) {
  if (unsubscribeNotifications) {
    unsubscribeNotifications();
    unsubscribeNotifications = null;
  }

  loadingState.hidden = false;
  emptyState.hidden = true;
  notificationList.hidden = true;

  const notificationsQuery = query(
    getNotificationsCollection(user),
    orderBy("createdAt", "desc")
  );

  unsubscribeNotifications = onSnapshot(
    notificationsQuery,
    (snapshot) => {
      notificationRecords = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      loadingState.hidden = true;
      renderNotifications();
    },
    (error) => {
      console.error("Notifications listener failed:", error);

      loadingState.hidden = true;
      notificationList.hidden = true;
      emptyState.hidden = false;
      emptyTitle.textContent = "Notifications could not load";
      emptyMessage.textContent =
        error.code === "permission-denied"
          ? "Firestore denied access. Add the notifications rules shown in the setup instructions."
          : "Check your internet connection, then reload this page.";

      showStatus(
        "Could not load notifications. Check the browser console for details.",
        "error"
      );
    }
  );
}

// ============================================
// AUTHENTICATION
// ============================================

onAuthStateChanged(auth, (user) => {
  if (!user) {
    if (unsubscribeNotifications) {
      unsubscribeNotifications();
      unsubscribeNotifications = null;
    }

    window.location.replace("../login.html");
    return;
  }

  currentUser = user;
  startNotificationListener(user);
});

// ============================================
// CLEANUP
// ============================================

window.addEventListener("pagehide", () => {
  if (unsubscribeNotifications) {
    unsubscribeNotifications();
    unsubscribeNotifications = null;
  }
});