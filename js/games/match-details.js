
import { auth, db } from "../firebase.js";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    where,
    setDoc,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

let loadedMatchId = "";
let loadedMatch = null;
let loadedQuestions = [];
let currentUser = null;
let isHost = false;
let authReady = false;

/* =========================
   AUTHENTICATION
========================= */

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  currentUser = user;
  authReady = true;

  await loadMatch(user);
});

/* =========================
   LOAD MATCH
========================= */

async function loadMatch(user) {
  const matchId = new URLSearchParams(window.location.search).get("id");

  if (!matchId) {
    showMessage("Match ID is missing from the URL.", true);
    return;
  }

  loadedMatchId = matchId;
  showMessage("Loading match details…");

  try {
    const matchRef = doc(db, "matches", matchId);
    const matchSnapshot = await getDoc(matchRef);

    if (!matchSnapshot.exists()) {
      showMessage("This match could not be found.", true);
      return;
    }

    const match = matchSnapshot.data();

    isHost = match.hostUid === user.uid;

    // Only the host can view drafts.
    // Other users may view published public matches.
    const isPublicPublishedMatch =
      match.status === "published" &&
      match.visibility === "public";

    if (!isHost && !isPublicPublishedMatch) {
      showMessage(
        "This match is not publicly available, or you do not have permission to view it.",
        true
      );
      return;
    }

    const questionsSnapshot = await getDocs(
      collection(db, "matches", matchId, "questions")
    );

    loadedQuestions = questionsSnapshot.docs
      .map((questionDoc) => ({
        id: questionDoc.id,
        ...questionDoc.data()
      }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    loadedMatch = match;

    renderMatch(match, loadedQuestions);

    await loadParticipants();

    showMessage("");
  } catch (error) {
    console.error("Match details error:", error);

    showMessage(
      "Could not load this match. Check your connection and Firestore permissions.",
      true
    );
  }
}

/* =========================
   DISPLAY MATCH
========================= */

function renderMatch(match, questions) {
  setText("matchTitle", match.matchTitle, "Untitled match");
  setText("matchDescription", match.matchDescription, "");
  setText("matchStatus", match.status, "draft");
  setText("matchCategory", match.matchCategory);
  setText("matchDifficulty", match.difficulty);
  setText("matchFormat", match.matchFormat);

  setText(
    "matchSubjects",
    Array.isArray(match.subjects)
      ? match.subjects.join(", ")
      : match.subjects
  );

  setText("matchLanguage", match.matchLanguage);
  setText("questionType", match.questionType);
  setText("secondsPerQuestion", match.secondsPerQuestion);
  setText("pointsPerQuestion", match.pointsPerQuestion);
  setText("competitorSlots", match.competitorSlots);
  setText("matchVisibility", match.visibility);
  setText("startDateTime", formatDate(match.startDateTime));
  setText("createdAt", formatDate(match.createdAt));
  setText("questionCount", questions.length);
  setText("questionBadge", `${questions.length} questions`);
  setText("matchIdText", loadedMatchId);

  const statusElement = $("matchStatus");

  if (statusElement) {
    statusElement.className = "status-badge";
    statusElement.classList.add(
      `status-${String(match.status || "draft").toLowerCase()}`
    );
  }

  // Host-only draft editing.
  const editDraftButton = $("editDraftButton");

  if (editDraftButton) {
    const canEdit = isHost && match.status === "draft";

    editDraftButton.hidden = !canEdit;
    editDraftButton.href =
      `edit-draft.html?id=${encodeURIComponent(loadedMatchId)}`;
  }

  // Only the host may publish.
  const publishButton = $("publishMatchButton");

  if (publishButton) {
    publishButton.hidden = !isHost || match.status !== "draft";
  }

  // A player can join only a published public match.
  const joinButton = $("joinMatchButton");

  if (joinButton) {
    joinButton.hidden =
      isHost ||
      match.status !== "published" ||
      match.visibility !== "public";

    joinButton.textContent = "Join Match";
    joinButton.disabled = false;
  }

  // Do not expose answers or explanations to competitors.
  renderQuestions(questions, isHost);

  const content = $("matchContent");

  if (content) {
    content.hidden = false;
  }
}

/* =========================
   DISPLAY QUESTIONS
========================= */

function renderQuestions(questions, showAnswers) {
  const container = $("questionsList");

  if (!container) return;

  container.replaceChildren();

  if (questions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-questions";
    empty.textContent = "No questions have been added yet.";
    container.appendChild(empty);
    return;
  }

  questions.forEach((question, index) => {
    const card = document.createElement("article");
    card.className = "question-card";

    const top = document.createElement("div");
    top.className = "question-top";

    const number = document.createElement("span");
    number.className = "question-number";
    number.textContent = `QUESTION ${index + 1}`;

    top.appendChild(number);

    if (question.subject) {
      const subject = document.createElement("span");
      subject.className = "question-subject";
      subject.textContent = question.subject;
      top.appendChild(subject);
    }

    const questionText = document.createElement("p");
    questionText.className = "question-text";
    questionText.textContent =
      question.question || "Question text not provided.";

    card.append(top, questionText);

    if (Array.isArray(question.options)) {
      const optionsList = document.createElement("ol");
      optionsList.className = "options-list";

      question.options.forEach((option, optionIndex) => {
        const item = document.createElement("li");

        const optionText = getOptionText(option);

        item.textContent = `${String.fromCharCode(65 + optionIndex)}. ${optionText}`;

        if (
          showAnswers &&
          isCorrectOption(question.correctAnswer, option, optionIndex)
        ) {
          item.classList.add("correct-option");
        }

        optionsList.appendChild(item);
      });

      card.appendChild(optionsList);
    }

    if (showAnswers && question.correctAnswer !== undefined) {
      const answer = document.createElement("div");
      answer.className = "answer-box";

      const label = document.createElement("strong");
      label.textContent = "Correct answer: ";

      answer.append(label, document.createTextNode(
        getAnswerText(question.correctAnswer, question.options)
      ));

      card.appendChild(answer);
    }

    if (showAnswers && question.explanation) {
      const explanation = document.createElement("div");
      explanation.className = "explanation-box";

      const label = document.createElement("strong");
      label.textContent = "Explanation: ";

      explanation.append(
        label,
        document.createTextNode(String(question.explanation))
      );

      card.appendChild(explanation);
    }

    container.appendChild(card);
  });
}

/* =========================
   PARTICIPANTS
========================= */

async function loadParticipants() {
  const panel = $("participantsPanel");
  const list = $("participantsList");

  if (!panel || !list || !loadedMatchId) return;

  panel.hidden = false;
  list.replaceChildren();

  try {
    const participantsRef = collection(
      db,
      "matches",
      loadedMatchId,
      "participants"
    );

    const participantsSnapshot = await getDocs(participantsRef);

    const participants = participantsSnapshot.docs.map((participantDoc) => ({
      id: participantDoc.id,
      ...participantDoc.data()
    }));

    setText(
      "participantsSummary",
      `${participants.length} participant${participants.length === 1 ? "" : "s"}`
    );

    if (participants.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-questions";
      empty.textContent = "No players have joined this match yet.";
      list.appendChild(empty);
    } else {
      participants.forEach((participant, index) => {
        const card = document.createElement("article");
        card.className = "question-card";

        const name = document.createElement("strong");
        name.textContent =
          participant.displayName ||
          `Player ${index + 1}`;

        const status = document.createElement("p");
        status.textContent = `Status: ${participant.status || "joined"}`;

        card.append(name, status);
        list.appendChild(card);
      });
    }

    // Hide the join button if this user has already joined.
    const joinButton = $("joinMatchButton");

    if (joinButton && !isHost) {
      const alreadyJoined = participants.some(
        (participant) => participant.id === currentUser.uid
      );

      if (alreadyJoined) {
        joinButton.textContent = "Already Joined";
        joinButton.disabled = true;
      }
    }
  } catch (error) {
    console.error("Participants loading error:", error);

    setText(
      "participantsSummary",
      "Participant information is currently unavailable."
    );

    // The match details can still be used even if this list fails.
  }
}

/* =========================
   JOIN MATCH
========================= */

const joinButton = $("joinMatchButton");

joinButton?.addEventListener("click", async () => {
  const user = auth.currentUser;

  if (!user || !authReady) {
    alert("Please sign in before joining this match.");
    return;
  }

  if (!loadedMatchId || !loadedMatch) {
    alert("Match details are not ready yet.");
    return;
  }

  if (isHost) {
    alert("You cannot join your own match as a competitor.");
    return;
  }

  if (
    loadedMatch.status !== "published" ||
    loadedMatch.visibility !== "public"
  ) {
    alert("This match is not open for public joining.");
    return;
  }

  const originalText = joinButton.textContent;

  joinButton.disabled = true;
  joinButton.textContent = "Joining…";

  try {
    // Re-check the current match before attempting to join.
    const matchRef = doc(db, "matches", loadedMatchId);
    const matchSnapshot = await getDoc(matchRef);

    if (!matchSnapshot.exists()) {
      throw new Error("This match no longer exists.");
    }

    const match = matchSnapshot.data();

    if (
      match.status !== "published" ||
      match.visibility !== "public"
    ) {
      throw new Error("This match is no longer open for public joining.");
    }

    if (match.hostUid === user.uid) {
      throw new Error("The host cannot join their own match.");
    }

    // Respect competitor capacity when the field is configured.
    const capacity = Number(match.competitorSlots);

    if (Number.isFinite(capacity) && capacity > 0) {
      const participantSnapshot = await getDocs(
        collection(db, "matches", loadedMatchId, "participants")
      );

      const existingParticipant = participantSnapshot.docs.some(
        (participantDoc) => participantDoc.id === user.uid
      );

      if (!existingParticipant && participantSnapshot.size >= capacity) {
        throw new Error("This match is full.");
      }
    }

    const participantRef = doc(
      db,
      "matches",
      loadedMatchId,
      "participants",
      user.uid
    );

    const existing = await getDoc(participantRef);

    if (existing.exists()) {
      joinButton.textContent = "Already Joined";
      alert("You have already joined this match.");
      await loadParticipants();
      return;
    }

    const displayName =
      user.displayName ||
      user.email?.split("@")[0] ||
      "GradeFlow Player";

    await setDoc(participantRef, {
      uid: user.uid,
      displayName,
      status: "joined",
      joinedAt: serverTimestamp()
    });

    alert("You joined the match successfully.");

    joinButton.textContent = "Already Joined";
    await loadParticipants();
  } catch (error) {
    console.error("Join match error:", error);

    alert(
      error.message ||
      "Could not join this match. Check your connection and Firestore rules."
    );

    joinButton.textContent = originalText;
    joinButton.disabled = false;
  }
});

/* =========================
   HELPERS
========================= */

function setText(id, value, fallback = "—") {
  const element = $(id);

  if (!element) return;

  element.textContent =
    value === undefined || value === null || value === ""
      ? fallback
      : String(value);
}

function formatDate(value) {
  if (!value) return "—";

  let date;

  if (typeof value.toDate === "function") {
    date = value.toDate();
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

function getOptionText(option) {
  if (typeof option === "string") return option;

  if (option && typeof option === "object") {
    return String(
      option.text ??
      option.label ??
      option.value ??
      JSON.stringify(option)
    );
  }

  return String(option ?? "");
}

function getAnswerText(answer, options) {
  if (typeof answer === "number" && Array.isArray(options)) {
    return getOptionText(options[answer] ?? answer);
  }

  if (answer && typeof answer === "object") {
    return String(
      answer.text ??
      answer.label ??
      answer.value ??
      JSON.stringify(answer)
    );
  }

  return String(answer);
}

function isCorrectOption(answer, option, index) {
  if (typeof answer === "number") return answer === index;

  if (typeof answer === "string") {
    return (
      answer === String(index) ||
      answer === String.fromCharCode(65 + index) ||
      answer === getOptionText(option)
    );
  }

  if (answer && typeof answer === "object") {
    return (
      answer.text === getOptionText(option) ||
      answer.label === getOptionText(option) ||
      answer.value === getOptionText(option)
    );
  }

  return false;
}

function showMessage(message, isError = false) {
  const element = $("pageMessage");

  if (!element) {
    if (isError && message) alert(message);
    return;
  }

  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle("message-error", isError);
}

/* =========================
   COPY MATCH ID
========================= */

const copyMatchIdButton = $("copyMatchIdButton");

copyMatchIdButton?.addEventListener("click", async () => {
  if (!loadedMatchId) {
    alert("The match ID is not available yet.");
    return;
  }

  try {
    await navigator.clipboard.writeText(loadedMatchId);
    alert("Match ID copied.");
  } catch (error) {
    prompt("Copy your match ID:", loadedMatchId);
  }
});

/* =========================
   PUBLISH DRAFT
========================= */

const publishMatchButton = $("publishMatchButton");

publishMatchButton?.addEventListener("click", async () => {
  const user = auth.currentUser;

  if (!user || !loadedMatchId) {
    alert("Please sign in and reload the match.");
    return;
  }

  if (!isHost || loadedMatch?.status !== "draft") {
    alert("Only the host can publish a draft match.");
    return;
  }

  if (!window.confirm(
    "Publish this match? You will no longer be able to edit it using Edit Draft."
  )) {
    return;
  }

  const originalText = publishMatchButton.textContent;

  publishMatchButton.disabled = true;
  publishMatchButton.textContent = "Publishing…";

  try {
    const matchRef = doc(db, "matches", loadedMatchId);
    const matchSnapshot = await getDoc(matchRef);

    if (!matchSnapshot.exists()) {
      throw new Error("This match could not be found.");
    }

    const match = matchSnapshot.data();

    if (match.hostUid !== user.uid || match.status !== "draft") {
      throw new Error("Only the host can publish a draft match.");
    }

    const questionsSnapshot = await getDocs(
      collection(db, "matches", loadedMatchId, "questions")
    );

    if (questionsSnapshot.empty) {
      throw new Error("Add questions before publishing this match.");
    }

    await updateDoc(matchRef, {
      status: "published",
      publishedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    alert("Match published successfully.");
    await loadMatch(user);
  } catch (error) {
    console.error("Publish match error:", error);

    alert(
      error.message ||
      "Could not publish this match. Check your Firestore rules."
    );
  } finally {
    publishMatchButton.disabled = false;
    publishMatchButton.textContent = originalText;
  }
});
