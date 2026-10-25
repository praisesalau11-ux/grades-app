
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  collection,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { auth, db } from "../firebase.js";

"use strict";

(() => {
  const $ = (id) => document.getElementById(id);

  const elements = {
    sidebar: $("sidebar"),
    menuToggle: $("menuToggle"),
    sidebarOverlay: $("sidebarOverlay"),

    totalMatchesCount: $("totalMatchesCount"),
    draftMatchesCount: $("draftMatchesCount"),
    totalQuestionsCount: $("totalQuestionsCount"),

    connectionStatus: $("connectionStatus"),
    matchesList: $("matchesList"),
    matchesResultCount: $("matchesResultCount"),

    matchSearch: $("matchSearch"),
    matchStatusFilter: $("matchStatusFilter"),
    refreshMatches: $("refreshMatches"),
    matchesToast: $("matchesToast")
  };

  let currentUser = null;
  let allMatches = [];
  let unsubscribeMatches = null;
  let toastTimer = null;
  let hasReceivedSnapshot = false;

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

  function showToast(message) {
    const toast = elements.matchesToast;

    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("visible");

    window.clearTimeout(toastTimer);

    toastTimer = window.setTimeout(() => {
      toast.classList.remove("visible");
    }, 3000);
  }

  function setConnectionStatus(message, isError = false) {
    const status = elements.connectionStatus;

    status.textContent = message;
    status.classList.toggle("status-error", isError);
  }

  function setLoading(isLoading) {
    elements.matchesList.setAttribute(
      "aria-busy",
      isLoading ? "true" : "false"
    );
  }

  function showMessage(title, description, options = {}) {
    const action = options.action || "";
    const actionLabel = options.actionLabel || "";

    const actionHTML = action
      ? `<a href="${escapeHTML(action)}">${escapeHTML(actionLabel)}</a>`
      : "";

    elements.matchesList.innerHTML = `
      <div class="matches-message">
        <h3>${escapeHTML(title)}</h3>
        <p>${escapeHTML(description)}</p>
        ${actionHTML}
      </div>
    `;

    setLoading(false);
  }

  function getDateValue(timestamp) {
    if (!timestamp) return 0;

    if (typeof timestamp.toMillis === "function") {
      return timestamp.toMillis();
    }

    if (typeof timestamp.toDate === "function") {
      return timestamp.toDate().getTime();
    }

    if (timestamp instanceof Date) {
      return timestamp.getTime();
    }

    const parsed = new Date(timestamp).getTime();

    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatDate(timestamp) {
    const milliseconds = getDateValue(timestamp);

    if (!milliseconds) return "Date unavailable";

    return new Date(milliseconds).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function getSubjects(match) {
    if (Array.isArray(match.subjects)) {
      return match.subjects
        .map((subject) => String(subject).trim())
        .filter(Boolean);
    }

    if (typeof match.subjects === "string" && match.subjects.trim()) {
      return [match.subjects.trim()];
    }

    if (typeof match.subject === "string" && match.subject.trim()) {
      return [match.subject.trim()];
    }

    return [];
  }

  function getQuestionCount(match) {
    const count = Number(match.questionCount);

    return Number.isFinite(count) && count > 0
      ? Math.floor(count)
      : 0;
  }

  function getStatus(match) {
    const status = String(match.status || "draft")
      .trim()
      .toLowerCase();

    return status || "draft";
  }

  function formatStatus(status) {
    return status
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  function renderStatistics() {
    const total = allMatches.length;

    const drafts = allMatches.filter(
      (match) => getStatus(match) === "draft"
    ).length;

    const questionTotal = allMatches.reduce(
      (sum, match) => sum + getQuestionCount(match),
      0
    );

    elements.totalMatchesCount.textContent = String(total);
    elements.draftMatchesCount.textContent = String(drafts);
    elements.totalQuestionsCount.textContent =
      questionTotal.toLocaleString();
  }

  function getFilteredMatches() {
    const searchTerm = elements.matchSearch.value
      .trim()
      .toLowerCase();

    const statusFilter = elements.matchStatusFilter.value;

    return allMatches.filter((match) => {
      const title = String(
        match.matchTitle || match.title || "Untitled match"
      );

      const subjects = getSubjects(match).join(" ");

      const matchesSearch =
        !searchTerm ||
        title.toLowerCase().includes(searchTerm) ||
        subjects.toLowerCase().includes(searchTerm);

      const status = getStatus(match);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "draft" && status === "draft") ||
        (statusFilter === "other" && status !== "draft");

      return matchesSearch && matchesStatus;
    });
  }

  function renderMatchCard(match) {
    const title = match.matchTitle || match.title || "Untitled match";
    const subjects = getSubjects(match);
    const questionCount = getQuestionCount(match);
    const status = getStatus(match);

    const subjectText = subjects.length
      ? subjects.join(" · ")
      : "No subjects recorded";

    const category = match.matchCategory || "Academic competition";
    const format = match.matchFormat || match.format || "Not specified";
    const visibility = match.visibility || "Not specified";

    const createdDate = formatDate(match.createdAt);
    const matchId = String(match.id || "");

    const statusClass =
      status === "draft" ? "" : "status-other";

    return `
      <article class="match-card">
        <div class="match-card-top">
          <div>
            <h3 class="match-card-title">
              ${escapeHTML(title)}
            </h3>

            <p class="match-card-subjects">
              ${escapeHTML(subjectText)}
            </p>
          </div>

          <span class="match-status ${statusClass}">
            ${escapeHTML(formatStatus(status))}
          </span>
        </div>

        <div class="match-card-meta">
          <span>▤ ${questionCount} questions</span>
          <span>◈ ${escapeHTML(category)}</span>
          <span>◷ ${escapeHTML(format)}</span>
          <span>◎ ${escapeHTML(visibility)}</span>
          <span>Created ${escapeHTML(createdDate)}</span>
        </div>

        <div class="match-card-bottom">
          <span class="match-id-label" title="${escapeHTML(matchId)}">
            ID: ${escapeHTML(matchId)}
          </span>

          <button
            class="match-copy-button"
            type="button"
            data-copy-match-id="${escapeHTML(matchId)}"
          >
            Copy match ID
          </button>
        </div>
      </article>
      
<a
  class="match-action-link"
  href="match-details.html?id=${encodeURIComponent(match.id)}">
  View details →
</a>

    `;
  }

  function renderMatches() {
    renderStatistics();

    const filteredMatches = getFilteredMatches();

    elements.matchesResultCount.textContent =
      `${filteredMatches.length} of ${allMatches.length} match` +
      `${allMatches.length === 1 ? "" : "es"}`;

    if (allMatches.length === 0) {
      showMessage(
        "No matches created yet",
        "When you create and save a match, it will appear here.",
        {
          action: "create-match.html",
          actionLabel: "Create your first match"
        }
      );

      return;
    }

    if (filteredMatches.length === 0) {
      showMessage(
        "No matching results",
        "Try another search term or change the status filter."
      );

      return;
    }

    elements.matchesList.innerHTML = filteredMatches
      .map(renderMatchCard)
      .join("");

    setLoading(false);
  }

  function stopMatchesListener() {
    if (typeof unsubscribeMatches === "function") {
      unsubscribeMatches();
      unsubscribeMatches = null;
    }
  }

  function startMatchesListener() {
    if (!currentUser) {
      showMessage(
        "Sign in required",
        "Sign in to view the matches saved to your GradeFlow account.",
        {
          action: "../../login.html",
          actionLabel: "Go to login"
        }
      );

      setConnectionStatus("Sign in required", true);
      return;
    }

    stopMatchesListener();

    hasReceivedSnapshot = false;
    allMatches = [];

    setLoading(true);
    setConnectionStatus("Connecting…");

    elements.matchesList.innerHTML = `
      <div class="matches-message">
        <span class="matches-spinner"></span>
        <h3>Loading your matches</h3>
        <p>Retrieving your saved matches from Firebase…</p>
      </div>
    `;

    const myMatchesQuery = query(
      collection(db, "matches"),
      where("hostUid", "==", currentUser.uid)
    );

    unsubscribeMatches = onSnapshot(
      myMatchesQuery,

      (snapshot) => {
        hasReceivedSnapshot = true;

        allMatches = snapshot.docs
          .map((documentSnapshot) => ({
            id: documentSnapshot.id,
            ...documentSnapshot.data()
          }))
          .sort((a, b) => {
            return getDateValue(b.createdAt) - getDateValue(a.createdAt);
          });

        setConnectionStatus("Live updates enabled");
        renderMatches();

        console.info(
          `GradeFlow My Matches: loaded ${allMatches.length} saved match(es).`
        );
      },

      (error) => {
        console.error(
          "GradeFlow My Matches: Firestore listener failed:",
          error
        );

        setConnectionStatus("Loading failed", true);

        if (error.code === "permission-denied") {
          showMessage(
            "Firestore permission denied",
            "Your Firestore Security Rules may not allow this account to read its own matches. Check the rules for the matches collection."
          );
        } else if (error.code === "unavailable") {
          showMessage(
            "Connection unavailable",
            "Firebase could not be reached. Check your internet connection and try again."
          );
        } else {
          showMessage(
            "Could not load matches",
            error.message || "An unexpected Firebase error occurred."
          );
        }
      }
    );
  }

  async function copyMatchId(matchId) {
    if (!matchId) {
      showToast("This match has no ID to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(matchId);
      showToast("Match ID copied.");
    } catch (error) {
      console.warn("Clipboard copy failed:", error);
      showToast("Copy failed. Select the match ID and copy it manually.");
    }
  }

  function openSidebar() {
    elements.sidebar.classList.add("open");
    elements.sidebarOverlay.classList.add("active");
    elements.menuToggle.setAttribute("aria-expanded", "true");
    elements.menuToggle.setAttribute("aria-label", "Close navigation");
  }

  function closeSidebar() {
    elements.sidebar.classList.remove("open");
    elements.sidebarOverlay.classList.remove("active");
    elements.menuToggle.setAttribute("aria-expanded", "false");
    elements.menuToggle.setAttribute("aria-label", "Open navigation");
  }

  function bindEvents() {
    elements.matchSearch.addEventListener("input", renderMatches);
    elements.matchStatusFilter.addEventListener("change", renderMatches);

    elements.refreshMatches.addEventListener("click", () => {
      if (!currentUser) {
        showToast("Sign in before refreshing your matches.");
        return;
      }

      if (hasReceivedSnapshot) {
        startMatchesListener();
      } else {
        showToast("Still connecting to Firebase. Try again shortly.");
      }
    });

    elements.matchesList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-copy-match-id]");

      if (!button) return;

      copyMatchId(button.dataset.copyMatchId);
    });

    elements.menuToggle.addEventListener("click", () => {
      const isOpen = elements.sidebar.classList.contains("open");

      if (isOpen) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });

    elements.sidebarOverlay.addEventListener("click", closeSidebar);

    elements.sidebar.querySelectorAll(".nav-link").forEach((link) => {
      link.addEventListener("click", closeSidebar);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeSidebar();
      }
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 900) {
        closeSidebar();
      }
    });
  }

  function init() {
    bindEvents();

    onAuthStateChanged(
      auth,

      (user) => {
        currentUser = user;

        if (!user) {
          stopMatchesListener();
          allMatches = [];
          renderStatistics();

          showMessage(
            "Sign in to view your matches",
            "Your saved matches are connected to your GradeFlow account.",
            {
              action: "../../login.html",
              actionLabel: "Go to login"
            }
          );

          setConnectionStatus("Not signed in", true);
          return;
        }

        startMatchesListener();
      },

      (error) => {
        console.error("GradeFlow authentication check failed:", error);

        setConnectionStatus("Authentication error", true);

        showMessage(
          "Could not verify your account",
          "Refresh the page. If the problem continues, check your Firebase Authentication setup."
        );
      }
    );
  }

  init();
})();
