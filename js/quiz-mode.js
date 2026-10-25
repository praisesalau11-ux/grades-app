
import { auth } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const AI_API_URL = "https://grades-app-6qgy.onrender.com/api/ai/chat";
const $ = (id) => document.getElementById(id);

const setupPanel = $("setupPanel");
const quizPanel = $("quizPanel");
const resultsPanel = $("resultsPanel");
const startBtn = $("startBtn");
const setupStatus = $("setupStatus");
const questionsEl = $("questions");
const quizForm = $("quizForm");

let currentUser = null;
let quizQuestions = [];
let quizSettings = {};

onAuthStateChanged(auth, (user) => {
  currentUser = user;

  if (!user) {
    setStatus("Please sign in to GradeFlow before starting a quiz.", true);
    startBtn.disabled = true;
  } else {
    setStatus("");
    startBtn.disabled = false;
  }
});

startBtn.addEventListener("click", startQuiz);

$("backBtn").addEventListener("click", () => {
  quizPanel.hidden = true;
  resultsPanel.hidden = true;
  setupPanel.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
});

$("retryBtn").addEventListener("click", () => {
  resultsPanel.hidden = true;
  setupPanel.hidden = false;
  setStatus("");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

quizForm.addEventListener("submit", submitQuiz);

async function startQuiz() {
  if (!currentUser) {
    setStatus("Sign in to GradeFlow before generating a quiz.", true);
    return;
  }

  quizSettings = {
    subject: $("subject").value,
    difficulty: $("difficulty").value,
    count: Number($("questionCount").value),
    level: $("level").value
  };

  startBtn.disabled = true;
  startBtn.textContent = "Generating quiz...";
  setStatus("GradeFlow AI is preparing your questions. Please wait.");

  try {
    const token = await currentUser.getIdToken();

    const response = await fetch(AI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        message: buildQuizPrompt(quizSettings),
        history: [],
        academicContext: {
          history: [],
          goals: []
        },
        attachments: []
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error || `The quiz request failed (${response.status}).`
      );
    }

    if (typeof data.reply !== "string" || !data.reply.trim()) {
      throw new Error("The AI returned an empty response. Please try again.");
    }

    quizQuestions = parseQuestions(data.reply);

    if (quizQuestions.length < quizSettings.count) {
      throw new Error(
        "The AI returned too few valid questions. Please generate the quiz again."
      );
    }

    quizQuestions = quizQuestions.slice(0, quizSettings.count);

    renderQuiz();

    setupPanel.hidden = true;
    resultsPanel.hidden = true;
    quizPanel.hidden = false;

    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    console.error("GradeFlow Quiz Mode error:", error);
    setStatus(
      error.message || "Could not generate the quiz. Please try again.",
      true
    );
  } finally {
    startBtn.disabled = !currentUser;
    startBtn.textContent = "Generate quiz";
  }
}

function buildQuizPrompt(settings) {
  return [
    "Create a multiple-choice practice quiz for GradeFlow students.",
    `Subject: ${settings.subject}.`,
    `Difficulty: ${settings.difficulty}.`,
    `School level: ${settings.level}.`,
    `Return exactly ${settings.count} questions.`,
    "Return only valid JSON. Do not include Markdown, code fences, introductions, or text outside the JSON.",
    'Required JSON structure: {"questions":[{"question":"Question text","options":["Option A","Option B","Option C","Option D"],"answerIndex":0,"explanation":"Brief explanation of the correct answer."}]}',
    "Every question must have exactly four distinct options.",
    "answerIndex must be an integer from 0 to 3 and must identify the correct option.",
    "Every explanation must be accurate, brief, and suitable for the selected school level.",
    "Avoid ambiguous questions and duplicate questions.",
    "Check the correct answer before returning the quiz.",
    "Do not include answers outside the answerIndex field."
  ].join("\n");
}

function parseQuestions(raw) {
  let cleaned = raw.trim();

  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");

  if (first < 0 || last <= first) {
    throw new Error(
      "The AI did not return readable quiz data. Please try again."
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    throw new Error(
      "The AI returned quiz data that could not be read. Please try again."
    );
  }

  if (!parsed || !Array.isArray(parsed.questions)) {
    throw new Error("The AI response did not contain a question list.");
  }

  const validQuestions = parsed.questions.filter((question) => {
    return (
      question &&
      typeof question.question === "string" &&
      question.question.trim().length > 0 &&
      Array.isArray(question.options) &&
      question.options.length === 4 &&
      question.options.every(
        (option) => typeof option === "string" && option.trim().length > 0
      ) &&
      Number.isInteger(question.answerIndex) &&
      question.answerIndex >= 0 &&
      question.answerIndex <= 3 &&
      typeof question.explanation === "string"
    );
  });

  if (validQuestions.length === 0) {
    throw new Error(
      "The AI did not provide valid multiple-choice questions. Please try again."
    );
  }

  return validQuestions;
}

function renderQuiz() {
  $("quizMeta").textContent =
    `${quizSettings.subject.toUpperCase()} · ${quizSettings.difficulty.toUpperCase()}`;

  $("quizTitle").textContent =
    `${quizSettings.count}-question practice`;

  questionsEl.replaceChildren();

  quizQuestions.forEach((question, index) => {
    const card = document.createElement("section");
    card.className = "question-card";

    const number = document.createElement("p");
    number.className = "question-number";
    number.textContent = `QUESTION ${index + 1}`;

    const title = document.createElement("p");
    title.className = "question-text";
    title.textContent = question.question;

    const options = document.createElement("div");
    options.className = "options";

    question.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.className = "option";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = `question-${index}`;
      input.value = String(optionIndex);
      input.required = true;
      input.addEventListener("change", updateProgress);

      const optionText = document.createElement("span");
      optionText.textContent = option;

      label.append(input, optionText);
      options.append(label);
    });

    card.append(number, title, options);
    questionsEl.append(card);
  });

  updateProgress();
}

function updateProgress() {
  const answered = quizQuestions.reduce((total, question, index) => {
    const selected = questionsEl.querySelector(
      `input[name="question-${index}"]:checked`
    );

    return total + (selected ? 1 : 0);
  }, 0);

  $("progressCopy").textContent =
    `${answered} of ${quizQuestions.length} answered`;

  $("progressBar").style.width =
    `${(answered / quizQuestions.length) * 100}%`;
}

function submitQuiz(event) {
  event.preventDefault();

  const answers = quizQuestions.map((question, index) => {
    const selected = questionsEl.querySelector(
      `input[name="question-${index}"]:checked`
    );

    return selected ? Number(selected.value) : -1;
  });

  const unansweredIndex = answers.findIndex((answer) => answer === -1);

  if (unansweredIndex !== -1) {
    setStatus("Answer every question before submitting.", true);

    questionsEl
      .querySelector(`input[name="question-${unansweredIndex}"]`)
      ?.focus();

    return;
  }

  setStatus("");

  const score = quizQuestions.reduce((total, question, index) => {
    return total + (answers[index] === question.answerIndex ? 1 : 0);
  }, 0);

  const percentage = Math.round(
    (score / quizQuestions.length) * 100
  );

  $("scorePercent").textContent = `${percentage}%`;
  $("scoreSummary").textContent =
    `${score} out of ${quizQuestions.length} correct`;

  $("scoreFeedback").textContent = getFeedback(percentage);

  renderReview(answers);

  quizPanel.hidden = true;
  resultsPanel.hidden = false;

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderReview(answers) {
  const reviewList = $("reviewList");
  reviewList.replaceChildren();

  quizQuestions.forEach((question, index) => {
    const correct = answers[index] === question.answerIndex;

    const item = document.createElement("article");
    item.className = `review-item ${correct ? "correct" : "incorrect"}`;

    const status = document.createElement("p");
    status.className = "review-status";
    status.textContent =
      `${correct ? "Correct" : "Incorrect"} · Question ${index + 1}`;

    const title = document.createElement("p");
    title.className = "review-question";
    title.textContent = question.question;

    const yourAnswer = document.createElement("p");
    yourAnswer.className = "review-answer";
    yourAnswer.textContent =
      `Your answer: ${question.options[answers[index]]}`;

    const correctAnswer = document.createElement("p");
    correctAnswer.className = "review-answer";
    correctAnswer.textContent =
      `Correct answer: ${question.options[question.answerIndex]}`;

    const explanation = document.createElement("p");
    explanation.className = "review-explanation";
    explanation.textContent =
      `Explanation: ${question.explanation}`;

    item.append(
      status,
      title,
      yourAnswer,
      correctAnswer,
      explanation
    );

    reviewList.append(item);
  });
}

function getFeedback(percentage) {
  if (percentage >= 90) {
    return "Excellent work. Review the explanations to reinforce what you know.";
  }

  if (percentage >= 70) {
    return "Good progress. Review missed questions and try another quiz.";
  }

  if (percentage >= 50) {
    return "You have a foundation to build on. Study the explanations and practise again.";
  }

  return "Review the explanations and ask GradeFlow AI to teach you the difficult topics.";
}

function setStatus(message, isError = false) {
  setupStatus.textContent = message;
  setupStatus.classList.toggle("error", isError);
}
