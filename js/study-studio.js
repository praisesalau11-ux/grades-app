
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

let currentMaterialId = null;
let currentQuestionSetId = null;
let sessionStartedAt = null;
let sessionSaved = false;

// EXAMINATION MODE STATE
const DEFAULT_EXAM_DURATION = 15;

let studyMode = "practice";
let examDurationMinutes = DEFAULT_EXAM_DURATION;
let examTimeRemaining = DEFAULT_EXAM_DURATION * 60;
let examTimer = null;
let examCurrentIndex = 0;
let examAnswers = {};
let examMarkedQuestions = new Set();
let examSubmitted = false;

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
   STUDY SETS AND SESSION PERSISTENCE
========================================== */

async function saveQuestionSet(material, questions) {
  if (!currentUser || !material.documentId) {
    throw new Error("Missing user or study material ID.");
  }

  const setsRef = collection(
    db,
    "users",
    currentUser.uid,
    "studyMaterials",
    material.documentId,
    "questionSets"
  );

  const setRef = doc(setsRef);

  await setDoc(setRef, {
    setId: setRef.id,
    materialId: material.documentId,
    materialName: material.name || "Study material",
    questions,
    questionCount: questions.length,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return setRef.id;
}


async function loadLatestQuestionSet(material, button) {
  if (!currentUser || !material.documentId) return;

  const originalText = button.textContent;

  button.disabled = true;
  button.textContent = "Loading...";

  try {
    const setsRef = collection(
      db,
      "users",
      currentUser.uid,
      "studyMaterials",
      material.documentId,
      "questionSets"
    );

    const setsQuery = query(
      setsRef,
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(setsQuery);

    if (snapshot.empty) {
      setQuestionStatus(
        "No saved question sets yet. Generate questions first.",
        true
      );

      questionSection.hidden = false;
      return;
    }

    const savedSet = snapshot.docs[0];
    const data = savedSet.data();

    if (
      !Array.isArray(data.questions) ||
      data.questions.length === 0
    ) {
      throw new Error("This saved question set is empty or invalid.");
    }

    questionSection.hidden = false;

    showGenerationComplete(
  data.questions,
  material.name || data.materialName || "Study material",
  {
    materialId: material.documentId,
    setId: savedSet.id,
    saved: true
  }
);

    questionSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

  } catch (error) {
    console.error("Load saved questions error:", error);

    setQuestionStatus(
      error.message || "Could not load saved questions.",
      true
    );

  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}


/* ==========================================
   SAVE COMPLETED QUIZ SESSION
========================================== */

async function saveCompletedStudySession() {
  if (sessionSaved) return true;

  if (!currentUser || !currentMaterialId) {
    console.warn("Session cannot be saved: missing material ID.");
    return false;
  }

  sessionSaved = true;

 const totalQuestions = currentQuestions.length;

  const correctCount = answeredQuestions.filter(
    answer => answer.correct
  ).length;

  const percentage = totalQuestions
    ? Math.round((correctCount / totalQuestions) * 100)
    : 0;

  const sessionRef = doc(
    collection(
      db,
      "users",
      currentUser.uid,
      "studyMaterials",
      currentMaterialId,
      "studySessions"
    )
  );

  const answers = answeredQuestions.map(answer => ({
    question: answer.question,
    difficulty: answer.difficulty,
    type: answer.type,
    mode: studyMode,
    userAnswer: answer.userAnswer,
    correctAnswer: answer.correctAnswer,
    correct: answer.correct,
    explanation: answer.explanation || "",
    sourceEvidence: answer.sourceEvidence || ""
  }));

  try {
    await setDoc(sessionRef, {
      sessionId: sessionRef.id,
      materialId: currentMaterialId,
      questionSetId: currentQuestionSetId,
      materialName: questionSource.textContent.replace(
        "Source: ",
        ""
      ),
      score: currentScore,
      totalQuestions,
      correctCount,
      incorrectCount: totalQuestions - correctCount,
      percentage,
      durationSeconds: sessionStartedAt
        ? Math.max(0, Math.round((Date.now() - sessionStartedAt) / 1000))
        : 0,
      answers,
      createdAt: serverTimestamp()
    });

    return true;

  } catch (error) {
    sessionSaved = false;

    console.error("Study session save error:", error);

    return false;
  }
}


/* ==========================================
   STUDY HISTORY INTERFACE
========================================== */

function getStudyHistoryPanel() {
  let panel = document.getElementById("studyHistoryPanel");

  if (panel) return panel;

  panel = document.createElement("section");
  panel.id = "studyHistoryPanel";
  panel.className = "study-history-panel";
  panel.hidden = true;

  const heading = document.createElement("h2");
  heading.textContent = "Study History";

  const description = document.createElement("p");
  description.textContent =
    "Your previous revision sessions for this material.";

  const list = document.createElement("div");
  list.id = "studyHistoryList";
  list.className = "study-history-list";

  panel.append(heading, description, list);

  questionSection.parentNode.insertBefore(
    panel,
    questionSection
  );

  return panel;
}


async function loadStudyHistory(material, button) {
  if (!currentUser || !material.documentId) return;

  const originalText = button.textContent;

  button.disabled = true;
  button.textContent = "Loading...";

  const panel = getStudyHistoryPanel();
  const list = document.getElementById("studyHistoryList");

  panel.hidden = false;
  list.innerHTML = "";

  const heading = document.createElement("h3");
  heading.textContent = material.name || "Study material";

  list.appendChild(heading);

  const loading = document.createElement("p");
  loading.textContent = "Loading previous sessions...";
  list.appendChild(loading);

  try {
    const sessionsRef = collection(
      db,
      "users",
      currentUser.uid,
      "studyMaterials",
      material.documentId,
      "studySessions"
    );

    const sessionsQuery = query(
      sessionsRef,
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(sessionsQuery);

    list.innerHTML = "";
    list.appendChild(heading);

    if (snapshot.empty) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent =
        "No completed study sessions for this material yet.";

      list.appendChild(empty);
      return;
    }

    snapshot.forEach(sessionDoc => {
      const session = sessionDoc.data();

      const card = document.createElement("article");
      card.className = "study-history-card";

      const date = document.createElement("small");
      date.textContent = formatDate(session.createdAt);

      const score = document.createElement("strong");
      score.textContent =
        `${session.percentage ?? 0}% · ${session.score ?? 0} points`;

      const details = document.createElement("p");
      details.textContent =
        `${session.correctCount ?? 0} correct out of ` +
        `${session.totalQuestions ?? 0} questions`;

      const incorrect = document.createElement("small");
      incorrect.textContent =
        `${session.incorrectCount ?? 0} incorrect`;

      card.append(date, score, details, incorrect);

      if (Array.isArray(session.answers)) {
        const reviewButton = document.createElement("button");
        reviewButton.type = "button";
        reviewButton.className = "secondary-button";
        reviewButton.textContent = "Review answers";

        const review = document.createElement("div");
        review.className = "study-history-review";
        review.hidden = true;

        session.answers.forEach((answer, index) => {
          const item = document.createElement("div");

          const question = document.createElement("strong");
          question.textContent =
            `${index + 1}. ${answer.question || "Question"}`;

          const yourAnswer = document.createElement("p");
          yourAnswer.textContent =
            `Your answer: ${answer.userAnswer || "No answer"}`;

          const correctAnswer = document.createElement("p");
          correctAnswer.textContent =
            `Correct answer: ${answer.correctAnswer || "Not available"}`;

          const result = document.createElement("small");
          result.textContent = answer.correct ? "Correct" : "Incorrect";
          result.className = answer.correct ? "history-correct" : "history-incorrect";

          item.append(question, yourAnswer, correctAnswer, result);

          if (answer.explanation) {
            const explanation = document.createElement("p");
            explanation.textContent = `Explanation: ${answer.explanation}`;
            item.appendChild(explanation);
          }

          review.appendChild(item);
        });

        reviewButton.addEventListener("click", () => {
          review.hidden = !review.hidden;
          reviewButton.textContent = review.hidden
            ? "Review answers"
            : "Hide answers";
        });

        card.append(reviewButton, review);
      }

      list.appendChild(card);
    });

    panel.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

  } catch (error) {
    console.error("Study history error:", error);

    list.innerHTML = "";

    const errorMessage = document.createElement("p");
    errorMessage.textContent =
      "Could not load study history. Check Firestore permissions.";

    list.appendChild(errorMessage);

  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

/* ==========================================
   DELETE SAVED STUDY RECORDS
========================================== */

async function deleteStudyMaterialRecords(materialId) {
  if (!currentUser || !materialId) {
    throw new Error("Missing user or material ID.");
  }

  const basePath = [
    "users",
    currentUser.uid,
    "studyMaterials",
    materialId
  ];

  const questionSetsRef = collection(
    db,
    ...basePath,
    "questionSets"
  );

  const sessionsRef = collection(
    db,
    ...basePath,
    "studySessions"
  );

  const [questionSets, sessions] = await Promise.all([
    getDocs(questionSetsRef),
    getDocs(sessionsRef)
  ]);

  const deletions = [
    ...questionSets.docs.map(item => deleteDoc(item.ref)),
    ...sessions.docs.map(item => deleteDoc(item.ref))
  ];

  await Promise.all(deletions);
}

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
      const material = {
  ...documentSnapshot.data(),
  documentId: documentSnapshot.id
};
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

await deleteStudyMaterialRecords(documentSnapshot.id);

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

      // STUDY SAVED QUESTIONS
const savedQuestionsButton = document.createElement("button");

savedQuestionsButton.type = "button";
savedQuestionsButton.textContent = "Study Saved Set";

savedQuestionsButton.addEventListener("click", () => {
  loadLatestQuestionSet(material, savedQuestionsButton);
});

// STUDY HISTORY
const historyButton = document.createElement("button");

historyButton.type = "button";
historyButton.textContent = "History";

historyButton.addEventListener("click", () => {
  loadStudyHistory(material, historyButton);
});

actions.append(
  openButton,
  generateButton,
  savedQuestionsButton,
  historyButton,
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


function bytesToBase64(data) {
  let bytes;

  // Handle Firebase Uint8Array
  if (data instanceof Uint8Array) {
    bytes = data;
  }

  // Handle ArrayBuffer
  else if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  }

  // Handle other typed-array views
  else if (ArrayBuffer.isView(data)) {
    bytes = new Uint8Array(
      data.buffer,
      data.byteOffset,
      data.byteLength
    );
  }

  else {
    throw new Error(
      `Unsupported PDF data type: ${Object.prototype.toString.call(data)}`
    );
  }

  if (bytes.length === 0) {
    throw new Error("PDF data is empty.");
  }

  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(
      i,
      Math.min(i + chunkSize, bytes.length)
    );

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
const downloadedData = await getBytes(
  ref(storage, material.storagePath),
  MAX_FILE_SIZE
);

console.log("Firebase PDF download:", {
  type: Object.prototype.toString.call(downloadedData),
  constructor: downloadedData?.constructor?.name,
  isArrayBuffer: downloadedData instanceof ArrayBuffer,
  isUint8Array: downloadedData instanceof Uint8Array,
  byteLength: downloadedData?.byteLength,
  length: downloadedData?.length
});

const bytes = downloadedData;

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

  
let pdfBase64;

try {
  pdfBase64 = bytesToBase64(bytes);

  console.log("PDF conversion successful:", {
    originalBytes: bytes.length,
    base64Characters: pdfBase64.length,
    base64Type: typeof pdfBase64
  });

} catch (conversionError) {
  console.error("PDF Base64 conversion failed:", conversionError);

  throw new Error(
    `PDF conversion failed: ${conversionError.message}`
  );
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

   let savedSetId = null;

try {
  savedSetId = await saveQuestionSet(
    material,
    result.questions
  );

  setQuestionStatus("Questions generated and saved successfully.");

} catch (saveError) {
  console.error("Question set save error:", saveError);

  setQuestionStatus(
    "Questions generated, but saving the question set failed.",
    true
  );
}

showGenerationComplete(
  result.questions,
  fileName,
  {
    materialId: material.documentId,
    setId: savedSetId,
    saved: Boolean(savedSetId)
  }
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
   GENERATION COMPLETE SCREEN
========================================== */


function showGenerationComplete(questions, fileName, options = {}) {
  questionResults.innerHTML = "";

  const notification = document.createElement("div");
  notification.id = "generationTopNotification";
  notification.className = "generation-top-notification";
  notification.setAttribute("role", "status");
  notification.textContent =
    `✓ Generation completed successfully! ${questions.length} questions are ready.`;

  document.getElementById("generationTopNotification")?.remove();

  const mainContainer = document.querySelector("main");
  if (mainContainer) mainContainer.prepend(notification);

  const card = document.createElement("div");
  card.className = "session-complete generation-complete";

  const icon = document.createElement("div");
  icon.className = "generation-success-icon";
  icon.textContent = "✓";

  const heading = document.createElement("h2");
  heading.textContent = "Generation Complete!";

  const description = document.createElement("p");
  description.textContent =
    "Your questions are ready. Choose how you want to study.";

  const count = document.createElement("div");
  count.className = "final-score";
  count.textContent = `${questions.length} Questions Ready`;

  const source = document.createElement("p");
  source.textContent = `Study material: ${fileName}`;

  const saveStatus = document.createElement("p");
  saveStatus.textContent = options.saved
    ? "Your question set has been saved to your Study Library."
    : "Your questions are ready, but the question set could not be saved.";

  const practiceButton = document.createElement("button");
  practiceButton.type = "button";
  practiceButton.className = "primary-button";
  practiceButton.textContent = "Start Practice Mode";

  practiceButton.addEventListener("click", () => {
    studyMode = "practice";

    startQuestionSession(questions, fileName, {
      materialId: options.materialId,
      setId: options.setId,
      mode: "practice"
    });

    questionSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });

  const examButton = document.createElement("button");
  examButton.type = "button";
  examButton.className = "secondary-button";
  examButton.textContent = "Start Exam Mode";

  examButton.addEventListener("click", () => {
    showExamSetup(questions, fileName, options);
  });

  card.append(
    icon,
    heading,
    description,
    count,
    source,
    saveStatus,
    practiceButton,
    examButton
  );

  questionResults.appendChild(card);

  setQuestionStatus("Generation complete. Choose your study mode.");
}


/* ==========================================
   EXAM SETUP
========================================== */

function showExamSetup(questions, fileName, options = {}) {
  questionResults.innerHTML = "";

  const card = document.createElement("div");
  card.className = "exam-setup-card";

  const heading = document.createElement("h2");
  heading.textContent = "Examination Setup";

  const description = document.createElement("p");
  description.textContent =
    "Configure your exam before starting. Answers and explanations will remain hidden until submission.";

  const count = document.createElement("p");
  count.textContent = `${questions.length} questions available`;

  const durationLabel = document.createElement("label");
  durationLabel.textContent = "Examination duration";

  const durationSelect = document.createElement("select");
  durationSelect.className = "exam-duration-select";

  [
    { value: 5, label: "5 minutes" },
    { value: 10, label: "10 minutes" },
    { value: 15, label: "15 minutes (Default)" },
    { value: 20, label: "20 minutes" },
    { value: 30, label: "30 minutes" },
    { value: 45, label: "45 minutes" },
    { value: 60, label: "60 minutes" }
  ].forEach(option => {
    const item = document.createElement("option");
    item.value = option.value;
    item.textContent = option.label;
    if (option.value === DEFAULT_EXAM_DURATION) {
      item.selected = true;
    }
    durationSelect.appendChild(item);
  });

  const startButton = document.createElement("button");
  startButton.type = "button";
  startButton.className = "primary-button";
  startButton.textContent = "Begin Examination";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "secondary-button";
  cancelButton.textContent = "Back";

  startButton.addEventListener("click", () => {
    examDurationMinutes = Number(durationSelect.value);

    startExamSession(questions, fileName, options);

    questionSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });

  cancelButton.addEventListener("click", () => {
    showGenerationComplete(questions, fileName, options);
  });

  card.append(
    heading,
    description,
    count,
    durationLabel,
    durationSelect,
    startButton,
    cancelButton
  );

  questionResults.appendChild(card);
  setQuestionStatus("Choose your examination duration.");
}


/* ==========================================
   EXAMINATION ENGINE
========================================== */

function startExamSession(questions, fileName, options = {}) {
  if (examTimer) clearInterval(examTimer);

  studyMode = "exam";

  currentQuestions = questions.map((question, index) => ({
    ...question,
    _id: `question-${index}`
  }));

  answeredQuestions = [];
  currentScore = 0;
  currentQuestion = null;

  currentMaterialId = options.materialId ?? null;
  currentQuestionSetId = options.setId ?? null;

  sessionStartedAt = Date.now();
  sessionSaved = false;

  examTimeRemaining = examDurationMinutes * 60;
  examCurrentIndex = 0;
  examAnswers = {};
  examMarkedQuestions = new Set();
  examSubmitted = false;

  questionSource.textContent = `Source: ${fileName} · Examination Mode`;

  setQuestionStatus("Your examination has started.");

  renderExamInterface();
  updateExamTimer();

  examTimer = setInterval(() => {
    examTimeRemaining -= 1;
    updateExamTimer();

    if (examTimeRemaining <= 0) {
      submitExam(true);
    }
  }, 1000);
}


function updateExamTimer() {
  const timer = document.getElementById("examTimer");
  if (!timer) return;

  const minutes = Math.floor(examTimeRemaining / 60);
  const seconds = examTimeRemaining % 60;

  timer.textContent =
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  timer.classList.toggle("exam-time-warning", examTimeRemaining <= 60);
}


function renderExamInterface() {
  questionResults.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "exam-interface";

  const top = document.createElement("div");
  top.className = "exam-top";

  const timerLabel = document.createElement("div");
  timerLabel.innerHTML = "<strong>TIME REMAINING</strong>";

  const timer = document.createElement("div");
  timer.id = "examTimer";
  timer.className = "exam-timer";
  timer.textContent = "15:00";

  timerLabel.appendChild(timer);
  top.appendChild(timerLabel);

  const progressText = document.createElement("p");
  progressText.className = "exam-progress-text";
  progressText.id = "examProgressText";

  wrapper.append(top, progressText);

  const navigatorHeading = document.createElement("h3");
  navigatorHeading.textContent = "Question Navigator";

  const navigator = document.createElement("div");
  navigator.className = "exam-navigator";
  navigator.id = "examNavigator";

  wrapper.append(navigatorHeading, navigator);

  const questionCard = document.createElement("div");
  questionCard.id = "examQuestionCard";
  questionCard.className = "exam-question-card";

  wrapper.appendChild(questionCard);

  const navigation = document.createElement("div");
  navigation.className = "exam-navigation";

  const previousButton = document.createElement("button");
  previousButton.type = "button";
  previousButton.className = "secondary-button";
  previousButton.textContent = "← Previous";

  previousButton.addEventListener("click", () => {
    if (examCurrentIndex > 0) {
      examCurrentIndex--;
      renderExamQuestion();
    }
  });

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "primary-button";
  nextButton.textContent = "Next →";
  nextButton.id = "examNextButton";

  nextButton.addEventListener("click", () => {
    if (examCurrentIndex < currentQuestions.length - 1) {
      examCurrentIndex++;
      renderExamQuestion();
    }
  });

  navigation.append(previousButton, nextButton);

  const submitButton = document.createElement("button");
  submitButton.type = "button";
  submitButton.className = "exam-submit-button";
  submitButton.textContent = "Submit Examination";

  submitButton.addEventListener("click", () => {
    const unanswered = currentQuestions.length -
      Object.keys(examAnswers).length;

    const message = unanswered > 0
      ? `You have ${unanswered} unanswered question(s). Submit anyway?`
      : "Are you sure you want to submit your examination?";

    if (window.confirm(message)) {
      submitExam(false);
    }
  });

  wrapper.append(navigation, submitButton);
  questionResults.appendChild(wrapper);

  renderExamQuestion();
}


function renderExamNavigator() {
  const navigator = document.getElementById("examNavigator");
  if (!navigator) return;

  navigator.innerHTML = "";

  currentQuestions.forEach((question, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "exam-nav-number";
    button.textContent = String(index + 1);

    if (index === examCurrentIndex) {
      button.classList.add("active");
    }

    if (Object.prototype.hasOwnProperty.call(examAnswers, question._id)) {
      button.classList.add("answered");
    }

    if (examMarkedQuestions.has(question._id)) {
      button.classList.add("marked");
    }

    button.addEventListener("click", () => {
      examCurrentIndex = index;
      renderExamQuestion();
    });

    navigator.appendChild(button);
  });

  const progress = document.getElementById("examProgressText");
  if (progress) {
    progress.textContent =
      `Question ${examCurrentIndex + 1} of ${currentQuestions.length} · ` +
      `${Object.keys(examAnswers).length} answered`;
  }
}


function renderExamQuestion() {
  const question = currentQuestions[examCurrentIndex];
  const card = document.getElementById("examQuestionCard");

  if (!question || !card) return;

  card.innerHTML = "";

  const meta = document.createElement("div");
  meta.className = "question-meta";

  const difficulty = document.createElement("span");
  difficulty.className = `question-tag ${question.difficulty || "medium"}`;
  difficulty.textContent = question.difficulty || "General";

  const type = document.createElement("span");
  type.className = "question-tag";
  type.textContent = question.type || "Question";

  meta.append(difficulty, type);

  const heading = document.createElement("h3");
  heading.className = "question-text";
  heading.textContent = question.question || "Question unavailable.";

  const answerArea = document.createElement("div");
  answerArea.className = "answer-options";

  const existingAnswer = examAnswers[question._id] ?? "";

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

      if (String(existingAnswer) === String(option)) {
        optionButton.classList.add("selected");
      }

      optionButton.addEventListener("click", () => {
        examAnswers[question._id] = option;
        renderExamQuestion();
      });

      answerArea.appendChild(optionButton);
    });
  } else {
    const input = document.createElement("textarea");
    input.className = "answer-option";
    input.rows = 4;
    input.placeholder = "Write your answer...";
    input.value = existingAnswer;

    input.addEventListener("input", () => {
      examAnswers[question._id] = input.value;
      renderExamNavigator();
    });

    answerArea.appendChild(input);
  }

  const markButton = document.createElement("button");
  markButton.type = "button";
  markButton.className = "exam-mark-button";

  markButton.textContent = examMarkedQuestions.has(question._id)
    ? "★ Remove review mark"
    : "☆ Mark for review";

  markButton.addEventListener("click", () => {
    if (examMarkedQuestions.has(question._id)) {
      examMarkedQuestions.delete(question._id);
    } else {
      examMarkedQuestions.add(question._id);
    }

    renderExamQuestion();
  });

  card.append(meta, heading, answerArea, markButton);

  renderExamNavigator();

  const previous = document.querySelector(
    ".exam-navigation button:first-child"
  );

  const next = document.getElementById("examNextButton");

  if (previous) previous.disabled = examCurrentIndex === 0;

  if (next) {
    next.disabled = examCurrentIndex === currentQuestions.length - 1;
    next.textContent = examCurrentIndex === currentQuestions.length - 1
      ? "Last Question"
      : "Next →";
  }
}


async function submitExam(timeExpired = false) {
  if (examSubmitted) return;

  examSubmitted = true;

  if (examTimer) {
    clearInterval(examTimer);
    examTimer = null;
  }

  const totalQuestions = currentQuestions.length;

  answeredQuestions = currentQuestions.map(question => {
    const userAnswer = examAnswers[question._id] ?? "";
    const hasAnswer = String(userAnswer).trim().length > 0;
    const correct = hasAnswer &&
      checkAnswer(userAnswer, question.correctAnswer);

    return {
      id: question._id,
      question: question.question,
      difficulty: question.difficulty || "medium",
      type: question.type || "question",
      userAnswer: String(userAnswer),
      correctAnswer: String(question.correctAnswer || ""),
      correct,
      explanation: question.explanation || "",
      sourceEvidence: question.sourceEvidence || "",
      unanswered: !hasAnswer
    };
  });

  const correctCount = answeredQuestions.filter(
    answer => answer.correct
  ).length;

  currentScore = answeredQuestions.reduce((score, answer, index) => {
    return score + (answer.correct
      ? Number(currentQuestions[index].points) || 1
      : 0);
  }, 0);

  const percentage = totalQuestions
    ? Math.round((correctCount / totalQuestions) * 100)
    : 0;

  const unanswered = answeredQuestions.filter(
    answer => answer.unanswered
  ).length;

  questionResults.innerHTML = "";

  const resultCard = document.createElement("div");
  resultCard.className = "exam-result-card";

  const heading = document.createElement("h2");
  heading.textContent = timeExpired
    ? "Time is up! Examination submitted."
    : "Examination Submitted";

  const score = document.createElement("div");
  score.className = "exam-final-percentage";
  score.textContent = `${percentage}%`;

  const summary = document.createElement("p");
  summary.textContent =
    `${correctCount} correct · ${totalQuestions - correctCount - unanswered} incorrect · ${unanswered} unanswered`;

  const points = document.createElement("p");
  points.textContent = `Total points: ${currentScore}`;

  const saving = document.createElement("p");
  saving.textContent = "Saving your examination result...";

  const reviewHeading = document.createElement("h3");
  reviewHeading.textContent = "Answer Review";

  const review = document.createElement("div");
  review.className = "exam-answer-review";

  answeredQuestions.forEach((answer, index) => {
    const item = document.createElement("article");

    const question = document.createElement("strong");
    question.textContent = `${index + 1}. ${answer.question}`;

    const yourAnswer = document.createElement("p");
    yourAnswer.textContent =
      `Your answer: ${answer.userAnswer || "Not answered"}`;

    const correctAnswer = document.createElement("p");
    correctAnswer.textContent =
      `Correct answer: ${answer.correctAnswer}`;

    const result = document.createElement("span");
    result.className = answer.correct
      ? "history-correct"
      : "history-incorrect";
    result.textContent = answer.correct
      ? "Correct"
      : answer.unanswered
        ? "Unanswered"
        : "Incorrect";

    item.append(question, yourAnswer, correctAnswer, result);

    if (answer.explanation) {
      const explanation = document.createElement("p");
      explanation.textContent = `Explanation: ${answer.explanation}`;
      item.appendChild(explanation);
    }

    review.appendChild(item);
  });

  resultCard.append(
    heading,
    score,
    summary,
    points,
    saving,
    reviewHeading,
    review
  );

  questionResults.appendChild(resultCard);

  questionCounter.textContent =
    `${totalQuestions} of ${totalQuestions} completed`;

  scoreCounter.textContent = `Score: ${currentScore}`;
  questionProgress.style.width = "100%";

  const saved = await saveCompletedStudySession();

  saving.textContent = saved
    ? "Your examination result has been saved."
    : "Your result is displayed, but could not be saved to your history.";

  setQuestionStatus(
    saved
      ? "Examination completed and saved."
      : "Examination completed. Saving failed.",
    !saved
  );
}


/* ==========================================
   START QUESTION SESSION
========================================== */
function startQuestionSession(questions, fileName, options = {}) {
  currentQuestions = questions.map((question, index) => ({
    ...question,
    _id: `question-${index}`
  }));

if (examTimer) {
  clearInterval(examTimer);
  examTimer = null;
}

studyMode = "practice";

  answeredQuestions = [];

  currentQuestion = null;
  currentScore = 0;

  currentMaterialId = options.materialId ?? null;
  currentQuestionSetId = options.setId || null;

  sessionStartedAt = Date.now();
  sessionSaved = false;

  questionSource.textContent = `Source: ${fileName}`;

  setQuestionStatus(
    `${currentQuestions.length} questions ready.`
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
  correct: isCorrect,
  question: question.question,
  difficulty: question.difficulty || "medium",
  type: question.type || "question",
  userAnswer: String(selectedAnswer),
  correctAnswer: String(question.correctAnswer || ""),
  explanation: question.explanation || "",
  sourceEvidence: question.sourceEvidence || ""
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
  questionSource.textContent.replace("Source: ", ""),
  {
    materialId: currentMaterialId,
    setId: currentQuestionSetId
  }
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

setQuestionStatus("Saving your study result...");

saveCompletedStudySession().then(saved => {
  if (saved) {
    setQuestionStatus(
      "Session completed and saved to your study history."
    );
  } else {
    setQuestionStatus(
      "Session completed, but its history could not be saved.",
      true
    );
  }
});
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
