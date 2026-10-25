
import { auth, db } from "../firebase.js";

import {
  doc,
  getDoc,
  getDocs,
  collection,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

let loadedMatchId = "";
let loadedMatch = null;

/* =========================
   AUTHENTICATION
========================= */

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

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

  showMessage("Loading your match…");

  try {
    const matchRef = doc(db, "matches", loadedMatchId);
    const matchSnapshot = await getDoc(matchRef);

    if (!matchSnapshot.exists()) {
      showMessage("This match could not be found.", true);
      return;
    }

    const match = matchSnapshot.data();

    if (match.hostUid !== user.uid) {
      showMessage("You do not have permission to view this match.", true);
      return;
    }

    const questionsSnapshot = await getDocs(
      collection(db, "matches", loadedMatchId, "questions")
    );

    const questions = questionsSnapshot.docs
      .map((questionDoc) => ({
        id: questionDoc.id,
        ...questionDoc.data()
      }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    loadedMatch = match;

    renderMatch(match, questions);
    showMessage("");
  } catch (error) {
    console.error("Match details error:", error);
    showMessage(
      error.message || "Could not load this match. Check your connection.",
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

  /* Edit Draft button */

  const editDraftButton = $("editDraftButton");

  if (editDraftButton) {
    const isDraft = match.status === "draft";

    editDraftButton.hidden = !isDraft;
    editDraftButton.href =
      `edit-draft.html?id=${encodeURIComponent(loadedMatchId)}`;
  }

  /* Publish button */

  const publishMatchButton = $("publishMatchButton");

  if (publishMatchButton) {
    publishMatchButton.hidden = match.status !== "draft";
  }

  renderQuestions(questions);

  const matchContent = $("matchContent");

  if (matchContent) {
    matchContent.hidden = false;
  }
}

/* =========================
   DISPLAY QUESTIONS
========================= */

function renderQuestions(questions) {
  const container = $("questionsList");

  if (!container) return;

  container.replaceChildren();

  if (questions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-message";
    empty.textContent = "No questions have been added to this match yet.";
    container.appendChild(empty);
    return;
  }

  questions.forEach((question, index) => {
    const card = document.createElement("article");
    card.className = "question-card";

    const heading = document.createElement("h3");
    heading.textContent = `Question ${index + 1}`;

    const questionText = document.createElement("p");
    questionText.textContent =
      question.question || "Question text not provided.";

    card.append(heading, questionText);

    if (Array.isArray(question.options)) {
      const optionsList = document.createElement("ol");
      optionsList.type = "A";

      question.options.forEach((option) => {
        const item = document.createElement("li");

        if (typeof option === "string") {
          item.textContent = option;
        } else if (option && typeof option === "object") {
          item.textContent =
            option.text ??
            option.label ??
            option.value ??
            JSON.stringify(option);
        } else {
          item.textContent = String(option ?? "");
        }

        optionsList.appendChild(item);
      });

      card.appendChild(optionsList);
    }

    if (question.correctAnswer !== undefined) {
      const answer = document.createElement("p");
      answer.className = "correct-answer";

      answer.textContent =
        "Correct answer: " +
        getAnswerText(question.correctAnswer, question.options);

      card.appendChild(answer);
    }

    if (question.explanation) {
      const explanation = document.createElement("p");
      explanation.className = "question-explanation";
      explanation.textContent = `Explanation: ${question.explanation}`;
      card.appendChild(explanation);
    }

    container.appendChild(card);
  });
}

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

function getAnswerText(answer, options) {
  if (typeof answer === "number" && Array.isArray(options)) {
    const option = options[answer];

    if (option !== undefined) {
      return typeof option === "string"
        ? option
        : option?.text ?? option?.label ?? String(answer);
    }
  }

  if (answer && typeof answer === "object") {
    return answer.text ?? answer.label ?? JSON.stringify(answer);
  }

  return String(answer);
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

  if (isError) {
    const matchContent = $("matchContent");
    if (matchContent) matchContent.hidden = true;
  }
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
    console.error("Copy match ID error:", error);
    prompt("Copy your match ID:", loadedMatchId);
  }
});

/* =========================
   PUBLISH DRAFT
========================= */

const publishMatchButton = $("publishMatchButton");

publishMatchButton?.addEventListener("click", async () => {
  const user = auth.currentUser;

  if (!user) {
    alert("Please sign in before publishing this match.");
    return;
  }

  if (!loadedMatchId) {
    alert("The match ID is missing. Reload the page and try again.");
    return;
  }

  const confirmed = window.confirm(
    "Publish this match? You will no longer be able to edit it using Edit Draft."
  );

  if (!confirmed) return;

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

    if (match.hostUid !== user.uid) {
      throw new Error("You are not allowed to publish this match.");
    }

    if (match.status !== "draft") {
      throw new Error("Only draft matches can be published.");
    }

    const questionsSnapshot = await getDocs(
      collection(db, "matches", loadedMatchId, "questions")
    );

    if (questionsSnapshot.empty) {
      throw new Error(
        "This match has no questions. Add questions before publishing."
      );
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
      "Could not publish this match. Check your connection and Firestore rules."
    );
  } finally {
    publishMatchButton.disabled = false;
    publishMatchButton.textContent = originalText;
  }
});
