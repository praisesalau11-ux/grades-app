"use strict";

import { auth, db } from "./firebase.js";

import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

let currentUser = null;
let loading = false;

const publishedList = $("publishedGamesList");
const hostedList = $("hostedGamesList");
const publishedMessage = $("publishedGamesMessage");
const hostedMessage = $("hostedGamesMessage");
const refreshButton = $("refreshPublishedGames");

/* ==========================================
   MESSAGE HELPERS
========================================== */

function setMessage(element, message) {
  if (element) {
    element.textContent = message;
    element.hidden = !message;
  }
}

/* ==========================================
   DATE HELPERS
========================================== */

function formatDate(value) {
  if (!value) return "";

  const date =
    typeof value.toDate === "function"
      ? value.toDate()
      : new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

/* ==========================================
   ELEMENT HELPERS
========================================== */

function createElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) {
    element.className = className;
  }

  if (text !== undefined) {
    element.textContent = String(text);
  }

  return element;
}

/* ==========================================
   MATCH CARD
========================================== */

function createMatchCard(match, id, isHosted) {
  const card = createElement("article", "home-match-card");

  const top = createElement("div", "home-match-card-top");

  const badge = createElement(
    "span",
    `home-match-badge ${
      match.status === "published"
        ? "badge-published"
        : "badge-draft"
    }`,
    match.status === "published" ? "Published" : "Draft"
  );

  top.appendChild(badge);
  card.appendChild(top);

  card.appendChild(
    createElement(
      "h3",
      "home-match-title",
      match.matchTitle || "Untitled match"
    )
  );

  card.appendChild(
    createElement(
      "p",
      "home-match-description",
      match.matchDescription || "No description provided."
    )
  );

  const metadata = createElement("div", "home-match-metadata");

  const subjects = Array.isArray(match.subjects)
    ? match.subjects.join(", ")
    : match.subjects;

  [
    ["Category", match.matchCategory],
    ["Subject", subjects],
    ["Difficulty", match.difficulty],
    ["Format", match.matchFormat]
  ].forEach(([label, value]) => {
    if (!value) return;

    const item = createElement("span", "home-match-meta-item");

    item.appendChild(
      createElement("strong", "", `${label}: `)
    );

    item.appendChild(
      document.createTextNode(String(value))
    );

    metadata.appendChild(item);
  });

  card.appendChild(metadata);

  const date = formatDate(
    match.publishedAt || match.createdAt
  );

  if (date) {
    card.appendChild(
      createElement(
        "p",
        "home-match-date",
        `${match.status === "published" ? "Published" : "Created"} ${date}`
      )
    );
  }

  const actions = createElement("div", "home-match-actions");

  if (isHosted) {
    const detailsLink = createElement(
      "a",
      "home-match-button",
      "View details"
    );

    detailsLink.href =
      `games/match-details.html?id=${encodeURIComponent(id)}`;

    actions.appendChild(detailsLink);

    if (match.status === "draft") {
      const editLink = createElement(
        "a",
        "home-match-button home-match-button-secondary",
        "Edit draft"
      );

      editLink.href =
        `games/edit-draft.html?id=${encodeURIComponent(id)}`;

      actions.appendChild(editLink);
    }
  } else {
    actions.appendChild(
      createElement(
        "span",
        "home-match-note",
        "Player joining will be available when the Match Lobby is connected."
      )
    );
  }

  card.appendChild(actions);

  return card;
}

/* ==========================================
   RENDER MATCH LIST
========================================== */

function renderList(container, matches, isHosted, messageElement) {
  if (!container) return;

  container.replaceChildren();

  if (matches.length === 0) {
    setMessage(
      messageElement,
      isHosted
        ? "You haven't hosted any matches yet. Create a match to get started."
        : "No published games are available yet."
    );

    return;
  }

  setMessage(messageElement, "");

  matches.forEach(({ id, data }) => {
    container.appendChild(
      createMatchCard(data, id, isHosted)
    );
  });
}

/* ==========================================
   SORT MATCHES
========================================== */

function sortMatches(matches) {
  return matches.sort((a, b) => {
    const getTime = (match) => {
      const value =
        match.data.publishedAt || match.data.createdAt;

      if (!value) return 0;

      if (typeof value.toMillis === "function") {
        return value.toMillis();
      }

      const date = new Date(value);

      return Number.isNaN(date.getTime())
        ? 0
        : date.getTime();
    };

    return getTime(b) - getTime(a);
  });
}

/* ==========================================
   LOAD PUBLISHED GAMES
========================================== */

async function loadPublishedGames() {
  const publishedQuery = query(
    collection(db, "matches"),
    where("status", "==", "published"),
    where("visibility", "==", "public")
  );

  const snapshot = await getDocs(publishedQuery);

  return snapshot.docs.map((item) => ({
    id: item.id,
    data: item.data()
  }));
}

/* ==========================================
   LOAD GAMES HOSTED BY CURRENT USER
========================================== */

async function loadHostedGames(user) {
  if (!user) return [];

  const hostedQuery = query(
    collection(db, "matches"),
    where("hostUid", "==", user.uid)
  );

  const snapshot = await getDocs(hostedQuery);

  return snapshot.docs.map((item) => ({
    id: item.id,
    data: item.data()
  }));
}

/* ==========================================
   UPDATE HOSTED MATCH COUNT
========================================== */

function updateHostedCount(count) {
  const hostedCount = $("hostedMatchesCount");

  if (hostedCount) {
    hostedCount.textContent = String(count);
  }
}

/* ==========================================
   LOAD HOMEPAGE MATCHES
========================================== */

async function loadHomepageMatches() {
  if (loading) return;

  if (!currentUser) {
    setMessage(
      publishedMessage,
      "Sign in to GradeFlow to explore published games."
    );

    setMessage(
      hostedMessage,
      "Sign in to view the games you host."
    );

    if (publishedList) publishedList.replaceChildren();
    if (hostedList) hostedList.replaceChildren();

    updateHostedCount(0);

    return;
  }

  loading = true;

  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = "Loading…";
  }

  setMessage(publishedMessage, "Loading published games…");
  setMessage(hostedMessage, "Loading your hosted games…");

  /*
   * Load each list independently.
   * One failed query will no longer hide the result
   * of the other successful query.
   */

  const publishedResult = await loadPublishedGames()
    .then((matches) => ({
      success: true,
      matches
    }))
    .catch((error) => ({
      success: false,
      error
    }));

  const hostedResult = await loadHostedGames(currentUser)
    .then((matches) => ({
      success: true,
      matches
    }))
    .catch((error) => ({
      success: false,
      error
    }));

  /* Published games */

  if (publishedResult.success) {
    renderList(
      publishedList,
      sortMatches(publishedResult.matches),
      false,
      publishedMessage
    );
  } else {
    console.error(
      "Could not load published GradeFlow Games:",
      publishedResult.error
    );

    if (publishedList) publishedList.replaceChildren();

    setMessage(
      publishedMessage,
      publishedResult.error?.code === "permission-denied"
        ? "Permission denied while loading published games. Check the matches read rule and query."
        : "Could not load published games. Check the browser console."
    );
  }

  /* Hosted games */

  if (hostedResult.success) {
    renderList(
      hostedList,
      sortMatches(hostedResult.matches),
      true,
      hostedMessage
    );

    updateHostedCount(hostedResult.matches.length);
  } else {
    console.error(
      "Could not load hosted GradeFlow Games:",
      hostedResult.error
    );

    if (hostedList) hostedList.replaceChildren();

    setMessage(
      hostedMessage,
      hostedResult.error?.code === "permission-denied"
        ? "Permission denied while loading your hosted games. Check hostUid and the matches read rule."
        : "Could not load your hosted games. Check the browser console."
    );
  }

  loading = false;

  if (refreshButton) {
    refreshButton.disabled = false;
    refreshButton.textContent = "↻ Refresh";
  }
}

/* ==========================================
   AUTHENTICATION
========================================== */

auth.onAuthStateChanged((user) => {
  currentUser = user;
  loadHomepageMatches();
});

/* ==========================================
   REFRESH BUTTON
========================================== */

refreshButton?.addEventListener("click", () => {
  loadHomepageMatches();
});