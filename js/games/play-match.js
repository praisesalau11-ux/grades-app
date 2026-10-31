import { auth, db } from "../../firebase.js";

import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";


const $ = (id) => document.getElementById(id);

const loadingScreen = $("loadingScreen");
const errorScreen = $("errorScreen");
const gameScreen = $("gameScreen");
const resultScreen = $("resultScreen");

const matchId = new URLSearchParams(location.search).get("matchId");

let currentUser = null;
let matchData = null;
let questions = [];
let currentQuestionIndex = 0;
let score = 0;
let correctCount = 0;
let timer = null;
let secondsLeft = 0;
let answered = false;


function showScreen(screen) {
  [loadingScreen, errorScreen, gameScreen, resultScreen]
    .forEach(element => element.classList.add("hidden"));

  screen.classList.remove("hidden");
}


function showError(title, message) {
  $("errorTitle").textContent = title;
  $("errorMessage").textContent = message;
  showScreen(errorScreen);
}


function returnToLobby() {
  location.href = "../../match-lobby.html";
}


$("exitButton").addEventListener("click", returnToLobby);
$("backButton").addEventListener("click", returnToLobby);
$("resultBackButton").addEventListener("click", returnToLobby);
$("nextButton").addEventListener("click", nextQuestion);


function isHost(match) {
  return (
    match.hostUid === currentUser.uid ||
    match.createdBy === currentUser.uid ||
    match.hostId === currentUser.uid
  );
}


function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}


async function getMatchAndVerifyAccess() {
  if (!matchId) {
    throw new Error("The match ID is missing from the page URL.");
  }

  const matchRef = doc(db, "matches", matchId);
  const matchSnap = await getDoc(matchRef);

  if (!matchSnap.exists()) {
    throw new Error("This match does not exist.");
  }

  matchData = matchSnap.data();

  if (matchData.status !== "published") {
    throw new Error("This match is not currently published.");
  }

  const host = isHost(matchData);

  if (!host && matchData.visibility !== "public") {
    throw new Error("This match is not publicly accessible.");
  }

  // The host can preview the match without joining as a participant.
  if (host) return;

  const participantRef = doc(
    db,
    "matches",
    matchId,
    "participants",
    currentUser.uid
  );

  const participantSnap = await getDoc(participantRef);

  if (!participantSnap.exists()) {
    throw new Error("You are not a participant in this match.");
  }

  const participant = participantSnap.data();

  if (participant.status !== "joined") {
    throw new Error("Your participant status does not allow you to play.");
  }

  // Application-based matches require explicit host approval.
  if (matchData.competitorMode === "application") {
    const applicationRef = doc(
      db,
      "matches",
      matchId,
      "applications",
      currentUser.uid
    );

    const applicationSnap = await getDoc(applicationRef);

    if (!applicationSnap.exists()) {
      throw new Error("You have not applied to join this match.");
    }

    const application = applicationSnap.data();

    if (application.status !== "approved") {
      if (application.status === "pending") {
        throw new Error("Your application is still waiting for host approval.");
      }

      if (application.status === "rejected") {
        throw new Error("Your application was rejected by the host.");
      }

      throw new Error("Your application has not been approved.");
    }
  }

  // Invite-based matches must also verify the invitation.
  if (matchData.competitorMode === "invite") {
    const invitations = Array.isArray(matchData.invitedCompetitors)
      ? matchData.invitedCompetitors
      : [];

    const invited = invitations.some(item => {
      if (typeof item === "string") {
        return (
          item === currentUser.uid ||
          normalizeEmail(item) === normalizeEmail(currentUser.email)
        );
      }

      if (item && typeof item === "object") {
        return (
          item.uid === currentUser.uid ||
          normalizeEmail(item.email) === normalizeEmail(currentUser.email)
        );
      }

      return false;
    });

    if (!invited) {
      throw new Error("You are not on the invitation list for this match.");
    }
  }
}


async function loadQuestions() {
  const questionsRef = collection(
    db,
    "matches",
    matchId,
    "questions"
  );

  let snapshot;

  try {
    snapshot = await getDocs(
      query(questionsRef, orderBy("order", "asc"))
    );
  } catch (error) {
    console.warn("Ordered question query failed; trying normal query.", error);
    snapshot = await getDocs(questionsRef);
  }

  questions = snapshot.docs.map(document => ({
    id: document.id,
    ...document.data()
  }));

  questions.sort((a, b) => {
    return Number(a.order || 0) - Number(b.order || 0);
  });

  if (!questions.length) {
    throw new Error("This match has no questions yet.");
  }

  questions.forEach((question, index) => {
    if (!question.question) {
      throw new Error(`Question ${index + 1} has no question text.`);
    }

    if (!Array.isArray(question.options) || !question.options.length) {
      throw new Error(`Question ${index + 1} has no answer options.`);
    }

    if (typeof question.correctAnswer !== "string") {
      throw new Error(
        `Question ${index + 1} has no valid correct answer.`
      );
    }
  });
}


function startGame() {
  $("matchTitle").textContent = matchData.title || "Quiz Match";

  const format = matchData.matchFormat || "one-on-one";

  $("matchFormat").textContent =
    format === "team" ? "TEAM QUIZ" : "ONE-ON-ONE QUIZ";

  $("matchDetails").textContent =
    `${questions.length} questions · ${format === "team" ? "Team format" : "Individual format"}`;

  currentQuestionIndex = 0;
  score = 0;
  correctCount = 0;

  updateScore();
  showScreen(gameScreen);
  displayQuestion();
}


function updateScore() {
  $("scoreDisplay").textContent = score;
}


function displayQuestion() {
  clearInterval(timer);
  answered = false;

  const question = questions[currentQuestionIndex];
  const total = questions.length;

  const points = Number(matchData.pointsPerQuestion || 10);
  const duration = Number(matchData.secondsPerQuestion || 30);

  $("questionCounter").textContent =
    `Question ${currentQuestionIndex + 1} of ${total}`;

  $("progressBar").style.width =
    `${((currentQuestionIndex + 1) / total) * 100}%`;

  $("questionText").textContent = question.question;
  $("subjectLabel").textContent =
    question.subject || "GENERAL";

  $("pointsLabel").textContent = `${points} points`;

  $("feedbackBox").className = "feedback-box hidden";
  $("feedbackBox").textContent = "";
  $("nextButton").classList.add("hidden");

  const optionsContainer = $("optionsContainer");
  optionsContainer.innerHTML = "";

  question.options.forEach(option => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "option-button";
    button.textContent = option;

    button.addEventListener("click", () => {
      submitAnswer(option);
    });

    optionsContainer.appendChild(button);
  });

  startTimer(duration);
}


function startTimer(duration) {
  secondsLeft = duration;
  updateTimerDisplay();

  timer = setInterval(() => {
    secondsLeft--;
    updateTimerDisplay();

    if (secondsLeft <= 0) {
      clearInterval(timer);
      submitAnswer(null);
    }
  }, 1000);
}


function updateTimerDisplay() {
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  $("timerDisplay").textContent =
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}


function submitAnswer(selectedAnswer) {
  if (answered) return;

  answered = true;
  clearInterval(timer);

  const question = questions[currentQuestionIndex];
  const points = Number(matchData.pointsPerQuestion || 10);

  const isCorrect =
    selectedAnswer !== null &&
    selectedAnswer.trim() === question.correctAnswer.trim();

  if (isCorrect) {
    score += points;
    correctCount++;
  }

  updateScore();

  const buttons = [
    ...$("optionsContainer").querySelectorAll(".option-button")
  ];

  buttons.forEach(button => {
    button.disabled = true;

    if (button.textContent === question.correctAnswer) {
      button.classList.add("correct");
    } else if (button.textContent === selectedAnswer && !isCorrect) {
      button.classList.add("incorrect");
    }
  });

  const feedback = $("feedbackBox");

  feedback.classList.remove("hidden");
  feedback.classList.add(
    isCorrect ? "correct-feedback" : "wrong-feedback"
  );

  const explanation = question.explanation
    ? ` Explanation: ${question.explanation}`
    : "";

  feedback.textContent = isCorrect
    ? `Correct! You earned ${points} points.${explanation}`
    : `Incorrect. The correct answer is: ${question.correctAnswer}.${explanation}`;

  $("nextButton").textContent =
    currentQuestionIndex === questions.length - 1
      ? "View results"
      : "Next question";

  $("nextButton").classList.remove("hidden");
}


function nextQuestion() {
  if (!answered) return;

  currentQuestionIndex++;

  if (currentQuestionIndex >= questions.length) {
    finishGame();
    return;
  }

  displayQuestion();
}


function finishGame() {
  clearInterval(timer);

  const percentage = Math.round(
    (correctCount / questions.length) * 100
  );

  $("finalScore").textContent = score;

  $("resultSummary").textContent =
    `You answered ${correctCount} out of ${questions.length} questions correctly. Accuracy: ${percentage}%.`;

  showScreen(resultScreen);
}


onAuthStateChanged(auth, async user => {
  if (!user) {
    showError(
      "Sign in required",
      "You must sign in to access this match."
    );
    return;
  }

  currentUser = user;

  try {
    $("loadingMessage").textContent = "Verifying match access…";

    await getMatchAndVerifyAccess();

    $("loadingMessage").textContent = "Loading quiz questions…";

    await loadQuestions();

    startGame();

  } catch (error) {
    console.error("GradeFlow game access error:", error);

    showError(
      "Unable to enter match",
      error.message || "An unexpected error occurred."
    );
  }
});