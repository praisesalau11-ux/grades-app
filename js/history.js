// ============================================
// GRADEFLOW — HISTORY PAGE
// File: js/history.js
// Firebase SDK: 10.12.0
// ============================================

import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ============================================
// DOM ELEMENTS
// ============================================

const $ = (id) => document.getElementById(id);

const elements = {
  totalCalculations: $("totalCalculations"),
  averageGpa: $("averageGpa"),
  averagePercentage: $("averagePercentage"),

  historyFilters: $("historyFilters"),
  historySearch: $("historySearch"),
  dateFrom: $("dateFrom"),
  dateTo: $("dateTo"),
  clearFilters: $("clearFilters"),

  historyMessage: $("historyMessage"),
  historyList: $("historyList"),
  resultCount: $("resultCount"),

  sidebar: $("sidebar"),
  sidebarBackdrop: $("sidebarBackdrop"),
  menuToggle: $("menuToggle"),

  sidebarAvatar: $("sidebarAvatar"),
  sidebarUserName: $("sidebarUserName"),
  sidebarUserEmail: $("sidebarUserEmail"),

  headerAvatar: $("headerAvatar"),
  headerUserName: $("headerUserName"),

  todayLabel: $("todayLabel"),
  refreshHistory: $("refreshHistory"),

  accountSwitcher: $("accountSwitcher"),
  profileButton: $("profileButton"),

  mobileMoreButton: $("mobileMoreButton"),
  mobileMoreMenu: $("mobileMoreMenu")
};

// ============================================
// STATE
// ============================================

let currentUser = null;
let allHistory = [];
let unsubscribeHistory = null;
let historyRequestVersion = 0;
let isLoading = true;

// ============================================
// GENERAL HELPERS
// ============================================

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
}

function getInitials(name, email) {
  const source = String(name || email || "G").trim();

  if (!source) return "G";

  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  return source.substring(0, 2).toUpperCase();
}

function setAvatar(element, user, displayName) {
  if (!element) return;

  const name = displayName || user?.displayName || "";
  const email = user?.email || "";
  const photoURL = user?.photoURL || "";

  if (photoURL) {
    element.innerHTML = `
      <img
        src="${escapeHTML(photoURL)}"
        alt="Profile photo"
        referrerpolicy="no-referrer"
      >
    `;

    const image = element.querySelector("img");

    image?.addEventListener("error", () => {
      element.textContent = getInitials(name, email);
    }, { once: true });
  } else {
    element.textContent = getInitials(name, email);
  }
}

function formatDate(value) {
  let date = null;

  if (value?.toDate && typeof value.toDate === "function") {
    date = value.toDate();
  } else if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number" || typeof value === "string") {
    date = new Date(value);
  }

  if (!date || Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getDateForFilter(value) {
  let date = null;

  if (value?.toDate && typeof value.toDate === "function") {
    date = value.toDate();
  } else if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number" || typeof value === "string") {
    date = new Date(value);
  }

  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function formatNumber(value, decimals = 2) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "—";
  }

  return number.toFixed(decimals);
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// ============================================
// STATUS MESSAGES
// ============================================

function showMessage(message, type = "info") {
  const element = elements.historyMessage;

  if (!element) return;

  element.textContent = message;
  element.className = `history-message ${type}`;
  element.hidden = false;
}

function hideMessage() {
  const element = elements.historyMessage;

  if (!element) return;

  element.hidden = true;
  element.textContent = "";
  element.className = "history-message";
}

// ============================================
// LOADING AND EMPTY STATES
// ============================================

function showLoading() {
  if (!elements.historyList) return;

  elements.historyList.innerHTML = `
    <div class="history-loading">
      <div class="loading-spinner" aria-hidden="true"></div>
      <p>Loading your calculation history...</p>
    </div>
  `;

  if (elements.resultCount) {
    elements.resultCount.textContent = "Loading...";
  }
}

function showEmptyState(message, showCalculatorLink = true) {
  if (!elements.historyList) return;

  const action = showCalculatorLink
    ? `
      <a class="btn btn-gold" href="./calculator.html">
        Calculate GPA
      </a>
    `
    : "";

  elements.historyList.innerHTML = `
    <div class="history-empty">
      <div class="history-empty-icon" aria-hidden="true">◷</div>

      <h3>No calculations found</h3>

      <p>${escapeHTML(message)}</p>

      ${action}
    </div>
  `;
}

function showErrorState(message) {
  if (!elements.historyList) return;

  elements.historyList.innerHTML = `
    <div class="history-empty">
      <div class="history-empty-icon" aria-hidden="true">!</div>
      <h3>Unable to load history</h3>
      <p>${escapeHTML(message)}</p>
      <button class="btn btn-primary" id="retryHistory" type="button">
        Try again
      </button>
    </div>
  `;

  $("retryHistory")?.addEventListener("click", startHistoryListener);
}

// ============================================
// USER PROFILE
// ============================================

async function loadUserProfile(user) {
  if (!user) return;

  const requestVersion = historyRequestVersion;

  let displayName = user.displayName || "";

  try {
    const userRef = doc(db, "users", user.uid);
    const userSnapshot = await getDoc(userRef);

    if (requestVersion !== historyRequestVersion) return;

    if (userSnapshot.exists()) {
      const profile = userSnapshot.data();

      displayName =
        profile.name ||
        profile.displayName ||
        profile.username ||
        displayName;
    }
  } catch (error) {
    console.warn("Could not load GradeFlow profile:", error);
  }

  if (requestVersion !== historyRequestVersion) return;

  displayName = displayName || user.email?.split("@")[0] || "Student";

  if (elements.sidebarUserName) {
    elements.sidebarUserName.textContent = displayName;
  }

  if (elements.sidebarUserEmail) {
    elements.sidebarUserEmail.textContent = user.email || "";
  }

  if (elements.headerUserName) {
    elements.headerUserName.textContent = displayName;
  }

  setAvatar(elements.sidebarAvatar, user, displayName);
  setAvatar(elements.headerAvatar, user, displayName);

  if (elements.accountSwitcher) {
    elements.accountSwitcher.setAttribute(
      "aria-label",
      `Signed in as ${displayName}`
    );
  }
}

// ============================================
// CALCULATION DATA
// ============================================

function getSubjects(record) {
  return Array.isArray(record.subjects) ? record.subjects : [];
}

function getRecordGpa(record) {
  return normalizeNumber(record.gpa);
}

function getRecordPercentage(record) {
  const storedPercentage = normalizeNumber(record.percentage);

  if (storedPercentage !== null) {
    return storedPercentage;
  }

  const subjects = getSubjects(record);

  if (!subjects.length) return null;

  const scores = subjects
    .map((subject) => normalizeNumber(subject.score))
    .filter((score) => score !== null);

  if (!scores.length) return null;

  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

// ============================================
// SUMMARY CARDS
// ============================================

function updateSummary(records) {
  const total = records.length;

  const gpas = records
    .map(getRecordGpa)
    .filter((value) => value !== null);

  const percentages = records
    .map(getRecordPercentage)
    .filter((value) => value !== null);

  const averageGpa = gpas.length
    ? gpas.reduce((sum, value) => sum + value, 0) / gpas.length
    : null;

  const averagePercentage = percentages.length
    ? percentages.reduce((sum, value) => sum + value, 0) /
      percentages.length
    : null;

  if (elements.totalCalculations) {
    elements.totalCalculations.textContent = String(total);
  }

  if (elements.averageGpa) {
    elements.averageGpa.textContent =
      averageGpa === null ? "—" : formatNumber(averageGpa);
  }

  if (elements.averagePercentage) {
    elements.averagePercentage.textContent =
      averagePercentage === null
        ? "—"
        : `${formatNumber(averagePercentage)}%`;
  }
}

// ============================================
// FILTERING
// ============================================

function getFilteredHistory() {
  const searchTerm = (
    elements.historySearch?.value || ""
  ).trim().toLowerCase();

  const fromDate = elements.dateFrom?.value || "";
  const toDate = elements.dateTo?.value || "";

  return allHistory.filter((record) => {
    const subjects = getSubjects(record);

    if (searchTerm) {
      const subjectMatches = subjects.some((subject) => {
        const name = String(subject.name || "").toLowerCase();
        const grade = String(subject.grade || "").toLowerCase();

        return (
          name.includes(searchTerm) ||
          grade.includes(searchTerm)
        );
      });

      const gpa = String(record.gpa ?? "").toLowerCase();

      if (!subjectMatches && !gpa.includes(searchTerm)) {
        return false;
      }
    }

    const recordDate = getDateForFilter(record.time);

    if (fromDate && (!recordDate || recordDate < fromDate)) {
      return false;
    }

    if (toDate && (!recordDate || recordDate > toDate)) {
      return false;
    }

    return true;
  });
}

function clearFilters() {
  if (elements.historySearch) {
    elements.historySearch.value = "";
  }

  if (elements.dateFrom) {
    elements.dateFrom.value = "";
  }

  if (elements.dateTo) {
    elements.dateTo.value = "";
  }

  renderHistory();
}

// ============================================
// SUBJECT DETAILS
// ============================================

function getGradeClass(grade) {
  const normalized = String(grade || "").trim().toUpperCase();

  if (["A", "A+", "A-", "B", "B+", "B-"].includes(normalized)) {
    return "grade-good";
  }

  if (["F", "E", "D", "F9"].includes(normalized)) {
    return "grade-low";
  }

  return "";
}

function renderSubjects(subjects) {
  if (!subjects.length) {
    return `
      <div class="history-item-details">
        <p>No subject details were saved for this calculation.</p>
      </div>
    `;
  }

  const subjectRows = subjects.map((subject) => {
    const name = escapeHTML(subject.name || "Unnamed subject");
    const grade = escapeHTML(subject.grade || "—");
    const score = normalizeNumber(subject.score);
    const scoreText = score === null
      ? "Score unavailable"
      : `${formatNumber(score, 1)} marks`;

    const gradeClass = getGradeClass(subject.grade);

    return `
      <div class="subject-row">
        <span class="subject-name">${name}</span>
        <span class="subject-score">${scoreText}</span>
        <span class="grade-badge ${gradeClass}">
          ${grade}
        </span>
      </div>
    `;
  }).join("");

  return `
    <div class="history-item-details" hidden>
      <h4 class="subjects-heading">Subject breakdown</h4>
      <div class="subject-list">
        ${subjectRows}
      </div>
    </div>
  `;
}

// ============================================
// HISTORY CARD
// ============================================

function renderHistoryCard(record) {
  const subjects = getSubjects(record);

  const gpa = getRecordGpa(record);
  const percentage = getRecordPercentage(record);

  const gpaText = gpa === null ? "—" : formatNumber(gpa);
  const percentageText = percentage === null
    ? "—"
    : `${formatNumber(percentage)}%`;

  const dateText = formatDate(record.time);
  const subjectCount = subjects.length;

  const subjectSummary = subjectCount
    ? subjects
        .slice(0, 3)
        .map((subject) => String(subject.name || "Unnamed subject"))
        .join(", ") +
      (subjectCount > 3 ? ` +${subjectCount - 3} more` : "")
    : "No subject names saved";

  const safeDate = escapeHTML(dateText);
  const safeSummary = escapeHTML(subjectSummary);

  return `
    <article class="history-item">
      <div class="history-item-top">
        <div class="history-item-main">
          <h3 class="history-item-title">
            GPA Calculation
          </h3>

          <p class="history-item-date">${safeDate}</p>

          <p class="history-item-subtitle">${safeSummary}</p>
        </div>

        <div class="history-item-metrics">
          <div class="history-metric">
            <span class="history-metric-label">GPA</span>
            <span class="history-metric-value">${gpaText}</span>
          </div>

          <div class="history-metric">
            <span class="history-metric-label">Percentage</span>
            <span class="history-metric-value">${percentageText}</span>
          </div>
        </div>
      </div>

      <div class="history-item-footer">
        <span class="history-item-subject-count">
          ${subjectCount} subject${subjectCount === 1 ? "" : "s"}
        </span>

        <div class="history-item-actions">
          <button
            class="btn btn-secondary btn-small details-toggle"
            type="button"
            aria-expanded="false"
          >
            View details
          </button>
        </div>
      </div>

      ${renderSubjects(subjects)}
    </article>
  `;
}

// ============================================
// RENDER HISTORY
// ============================================

function renderHistory() {
  if (!elements.historyList) return;

  const filteredRecords = getFilteredHistory();

  if (elements.resultCount) {
    const count = filteredRecords.length;
    const total = allHistory.length;

    elements.resultCount.innerHTML = `
      <strong>${count}</strong>
      result${count === 1 ? "" : "s"}
      ${count !== total ? ` of ${total} calculations` : ""}
    `;
  }

  if (!filteredRecords.length) {
    if (!allHistory.length) {
      showEmptyState(
        "Your saved GPA calculations will appear here. Open the calculator and save a result to get started."
      );
    } else {
      showEmptyState(
        "Try changing your search term or date range.",
        false
      );
    }

    return;
  }

  elements.historyList.innerHTML = filteredRecords
    .map(renderHistoryCard)
    .join("");

  // Attach detail buttons after rendering.
  elements.historyList
    .querySelectorAll(".details-toggle")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const card = button.closest(".history-item");
        const details = card?.querySelector(".history-item-details");

        if (!details) return;

        const willOpen = details.hidden;

        details.hidden = !willOpen;
        button.setAttribute("aria-expanded", String(willOpen));
        button.textContent = willOpen ? "Hide details" : "View details";
      });
    });
}

// ============================================
// FIRESTORE REAL-TIME HISTORY
// ============================================

function startHistoryListener() {
  if (!currentUser) return;

  if (unsubscribeHistory) {
    unsubscribeHistory();
    unsubscribeHistory = null;
  }

  hideMessage();
  isLoading = true;
  showLoading();

  const userAtRequest = currentUser;

  const historyQuery = query(
    collection(db, "history"),
    where("uid", "==", userAtRequest.uid),
    orderBy("time", "desc")
  );

  unsubscribeHistory = onSnapshot(
    historyQuery,
    (snapshot) => {
      if (
        !currentUser ||
        currentUser.uid !== userAtRequest.uid
      ) {
        return;
      }

      allHistory = snapshot.docs.map((historyDoc) => ({
        id: historyDoc.id,
        ...historyDoc.data()
      }));

      isLoading = false;

      // Summary cards always show statistics for all saved records,
      // even when search or date filters are active.
      updateSummary(allHistory);
      renderHistory();
      hideMessage();
    },
    (error) => {
      console.error("GradeFlow history error:", error);

      isLoading = false;

      if (error.code === "permission-denied") {
        showMessage(
          "Firestore denied access to your history. Check your Firebase Authentication state and Firestore rules.",
          "error"
        );

        showErrorState(
          "Your account does not have permission to read these history records."
        );
      } else if (error.code === "failed-precondition") {
        showMessage(
          "Firestore may require a composite index for this query. Check the error details in your browser console.",
          "warning"
        );

        showErrorState(
          "The history query could not run. Check the Firestore index and console error."
        );
      } else {
        showMessage(
          "A network or Firestore error prevented your history from loading.",
          "error"
        );

        showErrorState(
          "Check your internet connection, then try loading your history again."
        );
      }
    }
  );
}

// ============================================
// SIDEBAR AND MOBILE MENU
// ============================================

function openSidebar() {
  elements.sidebar?.classList.add("open");
  elements.sidebarBackdrop?.classList.add("show");

  if (elements.menuToggle) {
    elements.menuToggle.setAttribute("aria-expanded", "true");
  }
}

function closeSidebar() {
  elements.sidebar?.classList.remove("open");
  elements.sidebarBackdrop?.classList.remove("show");

  if (elements.menuToggle) {
    elements.menuToggle.setAttribute("aria-expanded", "false");
  }
}

function toggleSidebar() {
  if (elements.sidebar?.classList.contains("open")) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

function toggleMobileMoreMenu() {
  if (!elements.mobileMoreMenu) return;

  const willOpen = elements.mobileMoreMenu.hidden;

  elements.mobileMoreMenu.hidden = !willOpen;

  elements.mobileMoreButton?.setAttribute(
    "aria-expanded",
    String(willOpen)
  );
}

// ============================================
// DATE LABEL
// ============================================

function updateTodayLabel() {
  if (!elements.todayLabel) return;

  elements.todayLabel.textContent = new Intl.DateTimeFormat(
    undefined,
    {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric"
    }
  ).format(new Date());
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
  elements.historySearch?.addEventListener("input", renderHistory);

  elements.dateFrom?.addEventListener("change", () => {
    const from = elements.dateFrom.value;
    const to = elements.dateTo?.value || "";

    if (from && to && from > to) {
      showMessage(
        "The start date is after the end date. Adjust the date range.",
        "warning"
      );
    } else {
      hideMessage();
    }

    renderHistory();
  });

  elements.dateTo?.addEventListener("change", () => {
    const from = elements.dateFrom?.value || "";
    const to = elements.dateTo.value;

    if (from && to && from > to) {
      showMessage(
        "The end date is before the start date. Adjust the date range.",
        "warning"
      );
    } else {
      hideMessage();
    }

    renderHistory();
  });

  elements.historyFilters?.addEventListener("submit", (event) => {
    event.preventDefault();
    renderHistory();
  });

  elements.clearFilters?.addEventListener("click", clearFilters);

  elements.refreshHistory?.addEventListener("click", () => {
    if (!currentUser) return;

    startHistoryListener();
    loadUserProfile(currentUser);
  });

  elements.menuToggle?.addEventListener("click", toggleSidebar);
  elements.sidebarBackdrop?.addEventListener("click", closeSidebar);

  elements.mobileMoreButton?.addEventListener(
    "click",
    toggleMobileMoreMenu
  );

  elements.mobileMoreMenu?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      if (elements.mobileMoreMenu) {
        elements.mobileMoreMenu.hidden = true;
      }

      elements.mobileMoreButton?.setAttribute(
        "aria-expanded",
        "false"
      );
    });
  });

  elements.sidebar?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeSidebar);
  });

  // Close menus with Escape.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSidebar();

      if (elements.mobileMoreMenu) {
        elements.mobileMoreMenu.hidden = true;
      }

      elements.mobileMoreButton?.setAttribute(
        "aria-expanded",
        "false"
      );
    }
  });

  // If the screen grows beyond mobile width, close the mobile sidebar.
  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) {
      closeSidebar();
    }
  });
}

// ============================================
// AUTHENTICATION
// ============================================

function initializeHistoryPage() {
  updateTodayLabel();
  setupEventListeners();

  onAuthStateChanged(auth, async (user) => {
    historyRequestVersion++;

    if (unsubscribeHistory) {
      unsubscribeHistory();
      unsubscribeHistory = null;
    }

    currentUser = user;
    allHistory = [];

    if (!user) {
      window.location.replace("../login.html");
      return;
    }

    updateSummary([]);
    showLoading();

    await loadUserProfile(user);

    if (!currentUser || currentUser.uid !== user.uid) {
      return;
    }

    startHistoryListener();
  });
}

// ============================================
// START
// ============================================

initializeHistoryPage();