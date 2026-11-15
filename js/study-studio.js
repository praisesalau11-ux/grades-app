
import { auth, db, storage } from "./firebase.js";

import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";


/* ==========================================
   CONFIGURATION
========================================== */

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const API_BASE_URL = "https://grades-app-6qgy.onrender.com";

const GENERATE_ENDPOINT =
  `${API_BASE_URL}/api/study-studio/generate-questions`;


/* ==========================================
   DOM ELEMENTS
========================================== */

const pdfInput = document.getElementById("pdfInput");
const uploadZone = document.getElementById("uploadZone");

const selectedFileBox = document.getElementById("selectedFile");
const selectedFileName = document.getElementById("selectedFileName");
const selectedFileSize = document.getElementById("selectedFileSize");

const uploadButton = document.getElementById("uploadButton");
const uploadStatus = document.getElementById("uploadStatus");

const libraryStatus = document.getElementById("libraryStatus");
const documentGrid = document.getElementById("documentGrid");

const refreshButton = document.getElementById("refreshButton");
const removeFileButton = document.getElementById("removeFile");

const questionSection = document.getElementById("questionSection");
const questionSource = document.getElementById("questionSource");
const questionStatus = document.getElementById("questionStatus");
const questionResults = document.getElementById("questionResults");

const questionCounter = document.getElementById("questionCounter");
const scoreCounter = document.getElementById("scoreCounter");
const questionProgress = document.getElementById("questionProgress");


/* ==========================================
   APPLICATION STATE
========================================== */

let currentUser = null;
let selectedFile = null;

let isUploading = false;
let isGeneratingQuestions = false;

let currentQuestions = [];
let answeredQuestions = [];

let currentQuestion = null;
let currentScore = 0;


/* ==========================================
   HELPERS
========================================== */

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}


function formatDate(timestamp) {
  if (!timestamp?.toDate) return "Recently added";

  return timestamp.toDate().toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}


function setStatus(message, isError = false) {
  uploadStatus.textContent = message;

  uploadStatus.style.color = isError
    ? "var(--danger)"
    : "var(--muted)";
}


function setQuestionStatus(message, isError = false) {
  questionStatus.textContent = message;

  questionStatus.style.color = isError
    ? "var(--danger)"
    : "var(--muted)";
}


function clearSelectedFile() {
  selectedFile = null;
  pdfInput.value = "";

  selectedFileBox.hidden = true;
  uploadButton.disabled = true;

  setStatus("");
}


/* ==========================================
   PDF VALIDATION
========================================== */

async function validatePdf(file) {
  if (!file) {
    throw new Error("Choose a PDF file first.");
  }

  if (
    file.type !== "application/pdf" &&
    !file.name.toLowerCase().endsWith(".pdf")
  ) {
    throw new Error("Only PDF documents are accepted.");
  }

  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    throw new Error(
      "The PDF must be smaller than or equal to 5 MB."
    );
  }

  const header = await file.slice(0, 5).text();

  if (header !== "%PDF-") {
    throw new Error("This file does not appear to be a valid PDF.");
  }

  return true;
}


function selectFile(file) {
  if (!file) return;

  validatePdf(file)
    .then(() => {
      selectedFile = file;

      selectedFileName.textContent = file.name;
      selectedFileSize.textContent = formatBytes(file.size);

      selectedFileBox.hidden = false;
      uploadButton.disabled = false;

      setStatus("PDF ready for upload.");
    })
    .catch(error => {
      clearSelectedFile();
      setStatus(error.message, true);
    });
}


/* ==========================================
   FILE INPUT EVENTS
========================================== */

pdfInput.addEventListener("change", event => {
  selectFile(event.target.files?.[0]);
});


removeFileButton.addEventListener("click", clearSelectedFile);


uploadZone.addEventListener("dragover", event => {
  event.preventDefault();
  uploadZone.classList.add("dragover");
});


uploadZone.addEventListener("dragleave", () => {
  uploadZone.classList.remove("dragover");
});


uploadZone.addEventListener("drop", event => {
  event.preventDefault();

  uploadZone.classList.remove("dragover");

  const file = event.dataTransfer.files?.[0];

  if (file) selectFile(file);
});


/* ==========================================
   PDF UPLOAD
========================================== */

async function uploadPdf() {
  if (!currentUser) {
    setStatus("Sign in before uploading.", true);
    return;
  }

  if (!selectedFile || isUploading) return;

  isUploading = true;
  uploadButton.disabled = true;

  setStatus("Uploading your PDF...");

  const uid = currentUser.uid;
  const documentId = crypto.randomUUID();

  const safeFileName = selectedFile.name
    .replace(/[^\w.-]/g, "_")
    .slice(0, 100);

  const storagePath =
    `users/${uid}/study-materials/${documentId}/${safeFileName}`;

  const storageReference = ref(storage, storagePath);

  let uploaded = false;

  try {
    await validatePdf(selectedFile);

    await uploadBytes(storageReference, selectedFile, {
      contentType: "application/pdf",
      customMetadata: {
        ownerUid: uid,
        documentId
      }
    });

    uploaded = true;

    const metadataReference = doc(
      db,
      "users",
      uid,
      "studyMaterials",
      documentId
    );

    await setDoc(metadataReference, {
      documentId,
      name: selectedFile.name,
      safeFileName,
      storagePath,
      size: selectedFile.size,
      contentType: "application/pdf",
      createdAt: serverTimestamp()
    });

    setStatus("PDF uploaded successfully.");

    clearSelectedFile();

    await loadMaterials();

  } catch (error) {
    console.error("Study Studio upload error:", error);

    if (uploaded) {
      try {
        await deleteObject(storageReference);
      } catch (cleanupError) {
        console.error("Upload cleanup failed:", cleanupError);
      }
    }

    setStatus(
      error.message || "Upload failed. Try again.",
      true
    );

  } finally {
    isUploading = false;
    uploadButton.disabled = !selectedFile;
  }
}


uploadButton.addEventListener("click", uploadPdf);


/* ==========================================
   LOAD STUDY MATERIALS
========================================== */

async function loadMaterials() {
  if (!currentUser) return;

  libraryStatus.textContent = "Loading your documents...";
  documentGrid.innerHTML = "";

  try {
    const materialsRef = collection(
      db,
      "users",
      currentUser.uid,
      "studyMaterials"
    );

    const materialsQuery = query(
      materialsRef,
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(materialsQuery);

    if (snapshot.empty) {
      libraryStatus.textContent = "";

      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent =
        "No study materials yet. Upload your first PDF above.";

      documentGrid.appendChild(empty);
      return;
    }

    libraryStatus.textContent =
      `${snapshot.size} saved document${snapshot.size === 1 ? "" : "s"}`;

    snapshot.forEach(documentSnapshot => {
      const material = documentSnapshot.data();

      const card = document.createElement("article");
      card.className = "document-card";

      const top = document.createElement("div");
      top.className = "document-top";

      const icon = document.createElement("div");
      icon.className = "pdf-icon";
      icon.textContent = "PDF";

      const info = document.createElement("div");
      info.className = "document-info";

      const title = document.createElement("strong");
      title.textContent = material.name || "Untitled PDF";

      const details = document.createElement("small");

      details.textContent =
        `${formatBytes(material.size || 0)} · ${formatDate(material.createdAt)}`;

      info.append(title, details);
      top.append(icon, info);

      const actions = document.createElement("div");
      actions.className = "document-actions";


      // OPEN PDF

      const openButton = document.createElement("button");

      openButton.type = "button";
      openButton.textContent = "Open PDF";

      openButton.addEventListener("click", async () => {
        const newTab = window.open("about:blank", "_blank");

        try {
          const fileReference = ref(storage, material.storagePath);
          const url = await getDownloadURL(fileReference);

          if (newTab) {
            newTab.opener = null;
            newTab.location.href = url;
          } else {
            window.location.href = url;
          }

        } catch (error) {
          if (newTab) newTab.close();

          console.error(error);

          libraryStatus.textContent =
            "Could not open this PDF. Check your Storage permissions.";
        }
      });


      // GENERATE QUESTIONS

      const generateButton = document.createElement("button");

      generateButton.type = "button";
      generateButton.textContent = "Generate Questions";

      generateButton.addEventListener("click", () => {
        generateQuestions(material, generateButton);
      });


      // DELETE PDF

      const deleteButton = document.createElement("button");

      deleteButton.type = "button";
      deleteButton.className = "delete-button";
      deleteButton.textContent = "Delete";

      deleteButton.addEventListener("click", async () => {
        const confirmed = window.confirm(
          `Delete "${material.name || "this PDF"}"? This cannot be undone.`
        );

        if (!confirmed) return;

        deleteButton.disabled = true;

        try {
          const fileReference = ref(storage, material.storagePath);

          await deleteObject(fileReference);

          await deleteDoc(doc(
            db,
            "users",
            currentUser.uid,
            "studyMaterials",
            documentSnapshot.id
          ));

          await loadMaterials();

        } catch (error) {
          console.error("Delete error:", error);

          libraryStatus.textContent =
            "Could not delete this document. Check Firebase permissions.";

          deleteButton.disabled = false;
        }
      });

      actions.append(
        openButton,
        generateButton,
        deleteButton
      );

      card.append(top, actions);

      documentGrid.appendChild(card);
    });

  } catch (error) {
    console.error("Library loading error:", error);

    libraryStatus.textContent =
      "Could not load your library. Check Firestore permissions and connection.";
  }
}


refreshButton.addEventListener("click", loadMaterials);


/* ==========================================
   CONVERT PDF BYTES TO BASE64
========================================== */

function bytesToBase64(bytes) {
  let binary = "";

  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);

    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}


/* ==========================================
   GENERATE QUESTIONS
========================================== */

async function generateQuestions(material, button) {
  if (!currentUser) {
    setQuestionStatus("Sign in before generating questions.", true);
    return;
  }

  if (isGeneratingQuestions) return;

  isGeneratingQuestions = true;

  const originalButtonText = button.textContent;

  button.disabled = true;
  button.textContent = "Generating...";

  questionSection.hidden = false;

  questionSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  questionResults.innerHTML = "";

  setQuestionStatus("Preparing your PDF for AI analysis...");

  try {
    if (!material?.storagePath) {
      throw new Error("This document has no saved Storage path.");
    }

    // Download saved PDF from Firebase Storage.

    const fileReference = ref(storage, material.storagePath);

    const bytes = await getBytes(
      fileReference,
      MAX_FILE_SIZE
    );

    if (!bytes || bytes.length === 0) {
      throw new Error("The saved PDF is empty.");
    }

    if (bytes.length > MAX_FILE_SIZE) {
      throw new Error("This PDF exceeds the 5 MB limit.");
    }

    // Validate actual PDF signature.

    const header = new TextDecoder().decode(
      bytes.slice(0, 5)
    );

    if (header !== "%PDF-") {
      throw new Error("The saved document is not a valid PDF.");
    }

    // Convert PDF to Base64.

    const pdfBase64 = bytesToBase64(bytes);

    if (!pdfBase64 || typeof pdfBase64 !== "string") {
      throw new Error("PDF conversion failed.");
    }

    const fileName =
      material.name ||
      material.safeFileName ||
      "study-material.pdf";

    // Obtain fresh Firebase authentication token.

    const token = await currentUser.getIdToken(true);

    // Diagnostic log: never log the actual PDF data.

    console.log("Study Studio request:", {
      fileName,
      pdfBase64Type: typeof pdfBase64,
      pdfBase64Length: pdfBase64.length,
      pdfSizeBytes: bytes.length
    });

    setQuestionStatus(
      "GradeFlow AI is reading your material and creating questions..."
    );

    // Send PDF to backend.

    const response = await fetch(GENERATE_ENDPOINT, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },

      body: JSON.stringify({
        fileName,
        pdfBase64
      })
    });

    let result;

    try {
      result = await response.json();
    } catch {
      throw new Error(
        `AI server returned an invalid response. HTTP ${response.status}`
      );
    }

    if (!response.ok || !result.success) {
      console.error("Study Studio API response:", result);

      throw new Error(
        result.error ||
        result.message ||
        `Question generation failed. HTTP ${response.status}`
      );
    }

    if (
      !Array.isArray(result.questions) ||
      result.questions.length === 0
    ) {
      throw new Error("The AI did not return any questions.");
    }

    startQuestionSession(
      result.questions,
      fileName
    );

  } catch (error) {
    console.error("Question generation error:", error);

    setQuestionStatus(
      error.message || "Could not generate questions.",
      true
    );

  } finally {
    isGeneratingQuestions = false;

    button.disabled = false;
    button.textContent = originalButtonText;
  }
}


/* ==========================================
   START QUESTION SESSION
========================================== */

function startQuestionSession(questions, fileName) {
  currentQuestions = questions.map((question, index) => ({
    ...question,
    _id: `question-${index}`
  }));

  answeredQuestions = [];

  currentQuestion = null;
  currentScore = 0;

  questionSource.textContent = `Source: ${fileName}`;

  setQuestionStatus(
    `${currentQuestions.length} questions generated successfully.`
  );

  updateProgress();

  showNextQuestion();
}


/* ==========================================
   ADAPTIVE QUESTION SELECTION
========================================== */

function getNextQuestion() {
  const unanswered = currentQuestions.filter(question =>
    !answeredQuestions.some(answer => answer.id === question._id)
  );

  if (!unanswered.length) return null;

  if (!currentQuestion) {
    return (
      unanswered.find(q => q.difficulty === "easy") ||
      unanswered[0]
    );
  }

  const lastAnswer = answeredQuestions.find(
    item => item.id === currentQuestion._id
  );

  let preferredDifficulty = currentQuestion.difficulty;

  if (lastAnswer) {
    preferredDifficulty = lastAnswer.correct
      ? "hard"
      : "easy";
  }

  const preferred = unanswered.find(
    q => q.difficulty === preferredDifficulty
  );

  if (preferred) return preferred;

  return unanswered.find(q => q.difficulty === "medium") ||
    unanswered[0];
}


/* ==========================================
   SHOW NEXT QUESTION
========================================== */

function showNextQuestion() {
  currentQuestion = getNextQuestion();

  if (!currentQuestion) {
    showSessionComplete();
    return;
  }

  renderQuestion(currentQuestion);
  updateProgress();
}


/* ==========================================
   UPDATE PROGRESS
========================================== */

function updateProgress() {
  const total = currentQuestions.length;
  const answered = answeredQuestions.length;

  const percentage = total
    ? (answered / total) * 100
    : 0;

  questionCounter.textContent =
    `Question ${Math.min(answered + 1, total)} of ${total}`;

  scoreCounter.textContent =
    `Score: ${currentScore}`;

  questionProgress.style.width =
    `${percentage}%`;
}


/* ==========================================
   RENDER QUESTION
========================================== */

function renderQuestion(question) {
  questionResults.innerHTML = "";

  const card = document.createElement("div");
  card.className = "question-card";

  const meta = document.createElement("div");
  meta.className = "question-meta";

  const difficulty = document.createElement("span");

  difficulty.className =
    `question-tag ${question.difficulty || "medium"}`;

  difficulty.textContent =
    question.difficulty || "General";

  const type = document.createElement("span");

  type.className = "question-tag";
  type.textContent = question.type || "Question";

  meta.append(difficulty, type);

  const questionText = document.createElement("h3");

  questionText.className = "question-text";
  questionText.textContent = question.question || "Question unavailable.";

  card.append(meta, questionText);

  const optionsContainer = document.createElement("div");
  optionsContainer.className = "answer-options";

  let selectedAnswer = null;

  const optionButtons = [];

  const isMultipleChoice =
    question.type === "multiple-choice" &&
    Array.isArray(question.options);

  const isTrueFalse = question.type === "true-false";

  if (isMultipleChoice || isTrueFalse) {
    const options = isMultipleChoice
      ? question.options
      : ["True", "False"];

    options.forEach((option, index) => {
      const optionButton = createOptionButton(
        String.fromCharCode(65 + index),
        option
      );

      optionButton.addEventListener("click", () => {
        selectedAnswer = option;

        optionButtons.forEach(button => {
          button.classList.remove("selected");
        });

        optionButton.classList.add("selected");
      });

      optionButtons.push(optionButton);
      optionsContainer.appendChild(optionButton);
    });

  } else {
    const answerInput = document.createElement("textarea");

    answerInput.className = "answer-option";
    answerInput.placeholder = "Write your answer here...";
    answerInput.rows = 3;

    answerInput.addEventListener("input", () => {
      selectedAnswer = answerInput.value.trim();
    });

    optionsContainer.appendChild(answerInput);
  }

  card.appendChild(optionsContainer);

  const feedback = document.createElement("div");

  feedback.className = "answer-feedback";
  feedback.hidden = true;

  const actions = document.createElement("div");
  actions.className = "question-actions";

  const submitButton = document.createElement("button");

  submitButton.className = "primary-button";
  submitButton.textContent = "Check answer";

  const nextButton = document.createElement("button");

  nextButton.className = "secondary-button";
  nextButton.textContent = "Next question";
  nextButton.disabled = true;

  submitButton.addEventListener("click", () => {
    if (
      selectedAnswer === null ||
      String(selectedAnswer).trim() === ""
    ) {
      setQuestionStatus("Choose or enter an answer first.", true);
      return;
    }

    const isCorrect = checkAnswer(
      selectedAnswer,
      question.correctAnswer
    );

    const points = Number(question.points) || 1;

    if (isCorrect) {
      currentScore += points;
    }

    answeredQuestions.push({
      id: question._id,
      correct: isCorrect
    });

    // Mark selected and correct answers.

    optionButtons.forEach(optionButton => {
      optionButton.disabled = true;

      const value = optionButton.dataset.value;

      if (
        normalizeAnswer(value) ===
        normalizeAnswer(question.correctAnswer)
      ) {
        optionButton.classList.add("correct");

      } else if (
        normalizeAnswer(value) ===
        normalizeAnswer(selectedAnswer) &&
        !isCorrect
      ) {
        optionButton.classList.add("incorrect");
      }
    });

    const answerInput = optionsContainer.querySelector("textarea");

    if (answerInput) {
      answerInput.disabled = true;
    }

    feedback.hidden = false;

    feedback.className =
      `answer-feedback ${isCorrect ? "correct" : "incorrect"}`;

    const feedbackTitle = document.createElement("strong");

    feedbackTitle.textContent = isCorrect
      ? "Correct answer!"
      : "Not quite. Keep learning.";

    const explanation = document.createElement("p");

    explanation.textContent =
      question.explanation || "No explanation was provided.";

    const correctAnswer = document.createElement("p");

    correctAnswer.textContent =
      `Correct answer: ${question.correctAnswer || "Not provided"}`;

    feedback.append(
      feedbackTitle,
      explanation,
      correctAnswer
    );

    if (question.sourceEvidence) {
      const evidence = document.createElement("small");

      evidence.className = "evidence-text";
      evidence.textContent =
        `Source evidence: ${question.sourceEvidence}`;

      feedback.appendChild(evidence);
    }

    submitButton.disabled = true;
    nextButton.disabled = false;

    updateProgress();

    setQuestionStatus(
      isCorrect
        ? "Well done."
        : "Review the explanation before continuing."
    );
  });

  nextButton.addEventListener("click", showNextQuestion);

  actions.append(submitButton, nextButton);

  card.append(feedback, actions);

  questionResults.appendChild(card);
}


/* ==========================================
   CREATE OPTION BUTTON
========================================== */

function createOptionButton(letter, value) {
  const button = document.createElement("button");

  button.type = "button";
  button.className = "answer-option";

  button.dataset.value = String(value);

  const badge = document.createElement("span");

  badge.className = "option-letter";
  badge.textContent = letter;

  const text = document.createElement("span");

  text.textContent = String(value);

  button.append(badge, text);

  return button;
}


/* ==========================================
   ANSWER CHECKING
========================================== */

function normalizeAnswer(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
}


function checkAnswer(userAnswer, correctAnswer) {
  if (!correctAnswer) return false;

  return (
    normalizeAnswer(userAnswer) ===
    normalizeAnswer(correctAnswer)
  );
}


/* ==========================================
   SESSION COMPLETE
========================================== */

function showSessionComplete() {
  questionResults.innerHTML = "";

  questionCounter.textContent =
    `${currentQuestions.length} of ${currentQuestions.length} completed`;

  questionProgress.style.width = "100%";

  setQuestionStatus("Revision session completed.");

  const completion = document.createElement("div");

  completion.className = "session-complete";

  const heading = document.createElement("h3");
  heading.textContent = "Session complete";

  const message = document.createElement("p");

  message.textContent =
    "You have completed all the generated questions.";

  const score = document.createElement("div");

  score.className = "final-score";
  score.textContent = `${currentScore} points`;

  const correctCount = answeredQuestions.filter(
    answer => answer.correct
  ).length;

  const summary = document.createElement("p");

  summary.textContent =
    `${correctCount} correct answers out of ${answeredQuestions.length}.`;

  const restartButton = document.createElement("button");

  restartButton.type = "button";
  restartButton.className = "primary-button";
  restartButton.textContent = "Restart session";

  restartButton.addEventListener("click", () => {
    startQuestionSession(
      currentQuestions,
      questionSource.textContent.replace("Source: ", "")
    );
  });

  completion.append(
    heading,
    message,
    score,
    summary,
    restartButton
  );

  questionResults.appendChild(completion);
}


/* ==========================================
   AUTHENTICATION
========================================== */

onAuthStateChanged(auth, user => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  currentUser = user;

  loadMaterials();
});
