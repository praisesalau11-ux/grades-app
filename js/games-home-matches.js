
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

function setMessage(element, message) {
  if (element) {
    element.textContent = message;
    element.hidden = !message;
  }
}

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

function createElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);

  return element;
}

function createMatchCard(match, id, isHosted) {
  const card = createElement("article", "home-match-card");

  const top = createElement("div", "home-match-card-top");
  const badge = createElement(
    "span",
    `home-match-badge ${
      match.status === "published" ? "badge-published" : "badge-draft"
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
    item.appendChild(document.createTextNode(String(value)));
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
    const note = createElement(
      "span",
      "home-match-note",
      "Player joining will be available when the Match Lobby is connected."
    );

    actions.appendChild(note);
  }

  card.appendChild(actions);

  return card;
}

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

function sortMatches(matches) {
  return matches.sort((a, b) => {
    const getTime = (match) => {
      const value = match.data.publishedAt || match.data.createdAt;

      if (!value) return 0;

      if (typeof value.toMillis === "function") {
        return value.toMillis();
      }

      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    };

    return getTime(b) - getTime(a);
  });
}

async function loadHomepageMatches() {
  if (loading) return;

  loading = true;

  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = "Loading…";
  }

  setMessage(publishedMessage, "Loading published games…");
  setMessage(hostedMessage, "Loading your hosted games…");

  try {
    /*
     * Only published matches are requested for the public list.
     */

    const publishedQuery = query(
      collection(db, "matches"),
      where("status", "==", "published")
    );

    const publishedSnapshot = await getDocs(publishedQuery);

    const publishedMatches = publishedSnapshot.docs.map((item) => ({
      id: item.id,
      data: item.data()
    }));

    /*
     * Hosted matches are requested separately for the signed-in user.
     * This includes both drafts and published matches.
     */

    let hostedMatches = [];

    if (currentUser) {
      const hostedQuery = query(
        collection(db, "matches"),
        where("hostUid", "==", currentUser.uid)
      );

      const hostedSnapshot = await getDocs(hostedQuery);

      hostedMatches = hostedSnapshot.docs.map((item) => ({
        id: item.id,
        data: item.data()
      }));
    }

    const sortedPublished = sortMatches(publishedMatches);
    const sortedHosted = sortMatches(hostedMatches);

    renderList(
      publishedList,
      sortedPublished,
      false,
      publishedMessage
    );

    renderList(
      hostedList,
      sortedHosted,
      true,
      hostedMessage
    );

    const hostedCount = $("hostedMatchesCount");

    if (hostedCount) {
      hostedCount.textContent = String(hostedMatches.length);
    }
  } catch (error) {
    console.error("Could not load GradeFlow Games matches:", error);

    setMessage(
      publishedMessage,
      "Could not load published games. Check your connection and Firestore rules."
    );

    setMessage(
      hostedMessage,
      "Could not load your hosted games. Check your connection and Firestore rules."
    );
  } finally {
    loading = false;

    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = "↻ Refresh";
    }
  }
}

/* Wait for Firebase authentication before loading matches. */

auth.onAuthStateChanged((user) => {
  currentUser = user;
  loadHomepageMatches();
});

/* Refresh both lists. */

refreshButton?.addEventListener("click", () => {
  loadHomepageMatches();
});
