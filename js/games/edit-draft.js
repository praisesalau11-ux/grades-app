
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { auth, db } from "../firebase.js";

const $ = (id) => document.getElementById(id);

const pageMessage = $("pageMessage");
const editorContent = $("editorContent");
const form = $("editDraftForm");
const questionsEditor = $("questionsEditor");
const saveButton = $("saveButton");

const matchId = new URLSearchParams(location.search).get("id");

let currentUser = null;
let originalMatch = null;
let originalQuestions = [];
let isSaving = false;

function showMessage(message, isError = false) {
  pageMessage.textContent = message;
  pageMessage.classList.toggle("error", isError);
  pageMessage.hidden = false;
  editorContent.hidden = true;
}

function showEditor() {
  pageMessage.hidden = true;
  editorContent.hidden = false;
}

function setValue(id, value) {
  $(id).value = value == null ? "" : String(value);
}

function toOptionText(option) {
  if (option && typeof option === "object") {
    return String(option.text ?? option.label ?? option.value ?? "");
  }

  return String(option ?? "");
}

function getQuestionText(question) {
  return String(
    question.question ?? question.questionText ?? question.prompt ?? ""
  );
}

function getCorrectAnswer(question) {
  const answer = question.correctAnswer ?? question.answer ?? "";
  return typeof answer === "object"
    ? String(answer.text ?? answer.label ?? answer.value ?? "")
    : String(answer);
}

function renderQuestionEditor(question, index) {
  const card = document.createElement("article");
  card.className = "question-edit";
  card.dataset.questionId = question.id;

  const title = document.createElement("h3");
  title.textContent = `Question ${index + 1}`;
  card.appendChild(title);

  const questionLabel = document.createElement("label");
  questionLabel.textContent = "Question text";

  const questionInput = document.createElement("textarea");
  questionInput.rows = 3;
  questionInput.maxLength = 2000;
  questionInput.required = true;
  questionInput.dataset.field = "question";
  questionInput.value = getQuestionText(question);

  questionLabel.appendChild(questionInput);
  card.appendChild(questionLabel);

  const options = Array.isArray(question.options) ? question.options : [];
  const optionsHeading = document.createElement("p");
  optionsHeading.className = "help-text";
  optionsHeading.textContent = options.length
    ? "Edit the options below. Keep each option distinct."
    : "This question has no options array. You can edit its answer below.";
  card.appendChild(optionsHeading);

  if (options.length) {
    const optionGrid = document.createElement("div");
    optionGrid.className = "option-grid";

    options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.textContent = `Option ${String.fromCharCode(65 + optionIndex)}`;

      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 500;
      input.required = true;
      input.dataset.field = "option";
      input.dataset.optionIndex = String(optionIndex);
      input.value = toOptionText(option);

      label.appendChild(input);
      optionGrid.appendChild(label);
    });

    card.appendChild(optionGrid);
  }

  const answerLabel = document.createElement("label");
  answerLabel.textContent = "Correct answer (use the option text or letter)";

  const answerInput = document.createElement("input");
  answerInput.type = "text";
  answerInput.maxLength = 500;
  answerInput.required = true;
  answerInput.dataset.field = "correctAnswer";
  answerInput.value = getCorrectAnswer(question);

  answerLabel.appendChild(answerInput);
  card.appendChild(answerLabel);

  const explanationLabel = document.createElement("label");
  explanationLabel.textContent = "Explanation (optional)";

  const explanationInput = document.createElement("textarea");
  explanationInput.rows = 2;
  explanationInput.maxLength = 2000;
  explanationInput.dataset.field = "explanation";
  explanationInput.value = String(question.explanation ?? "");

  explanationLabel.appendChild(explanationInput);
  card.appendChild(explanationLabel);

  return card;
}

function renderQuestions() {
  questionsEditor.replaceChildren();

  if (!originalQuestions.length) {
    const empty = document.createElement("div");
    empty.className = "empty-questions";
    empty.textContent =
      "No saved questions were found. This editor cannot add questions to an empty draft yet.";
    questionsEditor.appendChild(empty);
    return;
  }

  originalQuestions.forEach((question, index) => {
    questionsEditor.appendChild(renderQuestionEditor(question, index));
  });
}

function populateMatch(match) {
  setValue("matchTitle", match.matchTitle);
  setValue("matchDescription", match.matchDescription);
  setValue("matchCategory", match.matchCategory);
  setValue("difficulty", match.difficulty);
  setValue("matchLanguage", match.matchLanguage);
  setValue("matchFormat", match.matchFormat);
  setValue(
    "subjects",
    Array.isArray(match.subjects) ? match.subjects.join("\n") : ""
  );
  setValue("questionType", match.questionType);
  setValue("secondsPerQuestion", match.secondsPerQuestion);
  setValue("pointsPerQuestion", match.pointsPerQuestion);
}

async function loadDraft(user) {
  if (!matchId) {
    showMessage("No match ID was provided. Return to My Matches.", true);
    return;
  }

  try {
    const matchRef = doc(db, "matches", matchId);
    const matchSnapshot = await getDoc(matchRef);

    if (!matchSnapshot.exists()) {
      showMessage("This match could not be found.", true);
      return;
    }

    const match = matchSnapshot.data();

    if (match.hostUid !== user.uid) {
      showMessage("You do not have permission to edit this match.", true);
      return;
    }

    if (match.status !== "draft") {
      showMessage(
        "Only drafts can be edited. This match is no longer marked as a draft.",
        true
      );
      return;
    }

    const questionSnapshot = await getDocs(
      collection(db, "matches", matchId, "questions")
    );

    originalQuestions = questionSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

    originalMatch = match;
    populateMatch(match);
    renderQuestions();

    $("cancelButton").href = `match-details.html?id=${encodeURIComponent(matchId)}`;
    showEditor();
  } catch (error) {
    console.error("Could not load draft:", error);

    showMessage(
      error.code === "permission-denied"
        ? "Firebase denied access. Check your Firestore Security Rules."
        : "Could not load the draft. Check your connection and try again.",
      true
    );
  }
}

function collectSettings() {
  const title = $("matchTitle").value.trim();
  const category = $("matchCategory").value;
  const subjects = $("subjects").value
    .split(/\r?\n/)
    .map((subject) => subject.trim())
    .filter(Boolean);

  const seconds = Number($("secondsPerQuestion").value);
  const points = Number($("pointsPerQuestion").value);

  if (!title) throw new Error("Enter a match title.");
  if (!category) throw new Error("Choose a category.");
  if (!subjects.length) throw new Error("Enter at least one subject.");

  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) {
    throw new Error("Seconds per question must be between 1 and 600.");
  }

  if (!Number.isInteger(points) || points < 1 || points > 100000) {
    throw new Error("Points per question must be between 1 and 100,000.");
  }

  return {
    matchTitle: title,
    matchDescription: $("matchDescription").value.trim(),
    matchCategory: category,
    difficulty: $("difficulty").value,
    matchLanguage: $("matchLanguage").value.trim(),
    matchFormat: $("matchFormat").value.trim(),
    subjects,
    subjectMode: subjects.length > 1 ? "mixed" : "single",
    questionType: $("questionType").value.trim(),
    secondsPerQuestion: seconds,
    pointsPerQuestion: points
  };
}

function collectEditedQuestions() {
  return Array.from(questionsEditor.querySelectorAll(".question-edit")).map(
    (card, index) => {
      const questionId = card.dataset.questionId;
      const original = originalQuestions.find((item) => item.id === questionId);

      if (!original) {
        throw new Error(`Question ${index + 1} could not be identified.`);
      }

      const questionText = card.querySelector('[data-field="question"]').value.trim();
      const correctAnswer = card.querySelector('[data-field="correctAnswer"]').value.trim();
      const explanation = card.querySelector('[data-field="explanation"]').value.trim();

      if (!questionText) {
        throw new Error(`Enter the text for question ${index + 1}.`);
      }

      if (!correctAnswer) {
        throw new Error(`Enter the correct answer for question ${index + 1}.`);
      }

      const optionInputs = Array.from(
        card.querySelectorAll('[data-field="option"]')
      );

      const options = optionInputs.map((input) => input.value.trim());

      if (options.some((option) => !option)) {
        throw new Error(`Fill in every option for question ${index + 1}.`);
      }

      if (options.length && new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
        throw new Error(`Question ${index + 1} has duplicate options.`);
      }

      if (options.length) {
        const letterIndex = /^[A-Z]$/i.test(correctAnswer)
          ? correctAnswer.toUpperCase().charCodeAt(0) - 65
          : -1;

        const answerMatchesOption =
          options.some((option) => option.toLowerCase() === correctAnswer.toLowerCase());

        if (
          !answerMatchesOption &&
          !(letterIndex >= 0 && letterIndex < options.length)
        ) {
          throw new Error(
            `For question ${index + 1}, the correct answer must match an option or its letter (A, B, C…).`
          );
        }
      }

      const updates = {
        question: questionText,
        correctAnswer,
        explanation
      };

      if (Array.isArray(original.options)) {
        updates.options = options;
      }

      return { id: questionId, updates };
    }
  );
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSaving || !currentUser || !originalMatch) return;

  isSaving = true;
  saveButton.disabled = true;
  saveButton.textContent = "Saving changes…";

  try {
    const settings = collectSettings();
    const editedQuestions = collectEditedQuestions();

    // Re-check ownership and status immediately before saving.
    const matchRef = doc(db, "matches", matchId);
    const latestSnapshot = await getDoc(matchRef);

    if (!latestSnapshot.exists()) {
      throw new Error("This match no longer exists.");
    }

    const latestMatch = latestSnapshot.data();

    if (latestMatch.hostUid !== currentUser.uid) {
      throw new Error("You no longer have permission to edit this match.");
    }

    if (latestMatch.status !== "draft") {
      throw new Error("This match is no longer a draft, so changes were not saved.");
    }

    // One batch updates the existing match and question documents.
    const batch = writeBatch(db);

    batch.update(matchRef, {
      ...settings,
      updatedAt: serverTimestamp()
    });

    editedQuestions.forEach(({ id, updates }) => {
      const questionRef = doc(db, "matches", matchId, "questions", id);
      batch.update(questionRef, updates);
    });

    await batch.commit();

    window.location.href =
      `match-details.html?id=${encodeURIComponent(matchId)}&saved=1`;
  } catch (error) {
    console.error("Could not save draft changes:", error);

    pageMessage.textContent =
      error.message || "Could not save changes. Check your connection and Firestore rules.";

    pageMessage.classList.add("error");
    pageMessage.hidden = false;
  } finally {
    isSaving = false;
    saveButton.disabled = false;
    saveButton.textContent = "Save changes";
  }
});

onAuthStateChanged(auth, (user) => {
  currentUser = user;

  if (!user) {
    showMessage("Sign in to edit your GradeFlow match.", true);
    return;
  }

  loadDraft(user);
});
