import { auth, db } from "./firebase.js";

import {
  collection,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// =====================================================
// GRADEFLOW — SMART STUDY RECOMMENDATIONS
// Reads existing history and studyTasks.
// This file does not modify or delete existing records.
// =====================================================

const $ = selector => document.querySelector(selector);

const elements = {
  userName: $("#userName"),
  userAvatar: $("#userAvatar"),
  signOutButton: $("#signOutButton"),
  pageMessage: $("#pageMessage"),

  topRecommendation: $("#topRecommendation"),
  topRecommendationText: $("#topRecommendationText"),

  subjectCount: $("#subjectCount"),
  pendingCount: $("#pendingCount"),
  overdueCount: $("#overdueCount"),
  plannedHours: $("#plannedHours"),

  subjectRecommendations: $("#subjectRecommendations"),
  taskRecommendations: $("#taskRecommendations"),

  sessionSubject: $("#sessionSubject"),
  sessionSubjectText: $("#sessionSubjectText"),
  sessionDuration: $("#sessionDuration"),
  sessionDurationText: $("#sessionDurationText")
};

let currentUser = null;
let historyRecords = [];
let studyTasks = [];
let historyLoaded = false;
let tasksLoaded = false;
let historyFailed = false;
let tasksFailed = false;

let unsubscribeHistory = null;
let unsubscribeTasks = null;

// =====================================================
// UTILITIES
// =====================================================

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseScore(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

function formatDate(dateString) {
  if (!dateString) return "No date set";

  const date = new Date(`${dateString}T12:00:00`);

  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatDuration(minutes) {
  const safeMinutes = Math.max(0, Number(minutes) || 0);

  if (safeMinutes < 60) {
    return `${safeMinutes} min`;
  }

  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;

  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function showMessage(message) {
  elements.pageMessage.textContent = message;
  elements.pageMessage.hidden = !message;
}

function getTaskStatus(task) {
  if (task.completed === true) return "completed";

  const today = localDateString();

  if (task.date && task.date < today) return "overdue";
  if (task.date === today) return "today";

  return "upcoming";
}

function getPriorityRank(priority) {
  const ranks = {
    high: 3,
    medium: 2,
    low: 1
  };

  return ranks[String(priority || "").toLowerCase()] || 1;
}

function getTaskUrgency(task) {
  const status = getTaskStatus(task);

  // A completed task never needs to be recommended again.
  if (status === "completed") return 0;

  let urgency = getPriorityRank(task.priority) * 10;

  if (status === "overdue") urgency += 100;
  if (status === "today") urgency += 80;

  if (task.date) {
    const daysAway = Math.round(
      (new Date(`${task.date}T12:00:00`).getTime() -
        new Date(`${localDateString()}T12:00:00`).getTime()) /
      86400000
    );

    if (daysAway === 1) urgency += 50;
    else if (daysAway > 1 && daysAway <= 3) urgency += 25;
    else if (daysAway > 3 && daysAway <= 7) urgency += 10;
  }

  return urgency;
}

// =====================================================
// SUBJECT ANALYSIS
// =====================================================

function calculateSubjectAverages() {
  const subjects = new Map();

  for (const record of historyRecords) {
    if (!Array.isArray(record.subjects)) continue;

    for (const subject of record.subjects) {
      const name = String(subject?.name || "").trim();
      const score = parseScore(subject?.score);

      if (!name || score === null || score < 0) continue;

      if (!subjects.has(name.toLowerCase())) {
        subjects.set(name.toLowerCase(), {
          name,
          total: 0,
          count: 0,
          latestScore: score
        });
      }

      const item = subjects.get(name.toLowerCase());

      item.total += score;
      item.count += 1;
      item.latestScore = score;
    }
  }

  return [...subjects.values()]
    .map(subject => ({
      ...subject,
      average: subject.total / subject.count
    }))
    .sort((a, b) => a.average - b.average);
}

function getSubjectAdvice(subject) {
  if (subject.average < 40) {
    return "Give this subject extra attention. Review the basics, practise questions, and check the topics you find difficult.";
  }

  if (subject.average < 50) {
    return "Prioritize understanding the main concepts, then practise questions and review your mistakes.";
  }

  if (subject.average < 70) {
    return "You have room to improve. Review weaker topics and practise questions without looking at your notes first.";
  }

  if (subject.average < 85) {
    return "Your average is strong. Maintain it with regular revision and more challenging practice questions.";
  }

  return "Your saved average is strong. Maintain it through short revision sessions and practice tests.";
}

function renderSubjectRecommendations(subjects) {
  elements.subjectCount.textContent = String(subjects.length);

  if (historyFailed) {
    elements.subjectRecommendations.innerHTML = `
      <div class="empty-state">
        Grade history could not be loaded. Check your Firestore history
        read permissions and your internet connection, then refresh.
      </div>
    `;
    return;
  }

  if (!historyLoaded) {
    elements.subjectRecommendations.innerHTML = `
      <div class="loading-state">Loading your subject results…</div>
    `;
    return;
  }

  if (subjects.length === 0) {
    elements.subjectRecommendations.innerHTML = `
      <div class="empty-state">
        <strong>No subject scores found yet.</strong><br>
        Use the GPA Calculator, then save a calculation containing subject
        names and numeric scores. Your recommendations will appear here.
        <br><br>
        <a class="text-link" href="./calculator.html">Open GPA Calculator →</a>
      </div>
    `;
    return;
  }

  const lowest = subjects[0];

  elements.subjectRecommendations.innerHTML = subjects
    .slice(0, 5)
    .map((subject, index) => {
      const average = Math.max(0, Math.min(100, subject.average));
      const badge = index === 0 ? "Focus first" : `${average.toFixed(1)}% avg`;

      return `
        <article class="recommendation-item">
          <div class="item-top">
            <div>
              <div class="item-title">${escapeHTML(subject.name)}</div>
              <p class="item-description">
                ${escapeHTML(getSubjectAdvice(subject))}
              </p>
            </div>
            <span class="score-pill">${escapeHTML(badge)}</span>
          </div>
          <div class="mini-progress" aria-label="Average score ${average.toFixed(1)}%">
            <span style="width:${average}%"></span>
          </div>
          <p class="item-description">
            Based on ${subject.count} saved ${subject.count === 1 ? "score" : "scores"}.
          </p>
        </article>
      `;
    })
    .join("");

  elements.sessionSubject.textContent = lowest.name;
  elements.sessionSubjectText.textContent =
    `Your lowest saved subject average is ${lowest.average.toFixed(1)}%. ` +
    "Start with one topic you find difficult, then answer practice questions.";
}

// =====================================================
// TASK ANALYSIS
// =====================================================

function getRecommendedTasks() {
  return studyTasks
    .filter(task => task.completed !== true)
    .sort((a, b) => {
      const urgencyDifference = getTaskUrgency(b) - getTaskUrgency(a);

      if (urgencyDifference !== 0) return urgencyDifference;

      const dateA = a.date || "9999-12-31";
      const dateB = b.date || "9999-12-31";

      return dateA.localeCompare(dateB);
    });
}

function renderTaskRecommendations(tasks) {
  const pending = tasks.filter(task => task.completed !== true);
  const overdue = pending.filter(task => getTaskStatus(task) === "overdue");

  const pendingMinutes = pending.reduce(
    (sum, task) => sum + Math.max(0, Number(task.duration) || 0),
    0
  );

  elements.pendingCount.textContent = String(pending.length);
  elements.overdueCount.textContent = String(overdue.length);
  elements.plannedHours.textContent = (pendingMinutes / 60).toFixed(1) + "h";

  if (tasksFailed) {
    elements.taskRecommendations.innerHTML = `
      <div class="empty-state">
        Study tasks could not be loaded. Check your Firestore studyTasks
        read permissions and your internet connection, then refresh.
      </div>
    `;
    return;
  }

  if (!tasksLoaded) {
    elements.taskRecommendations.innerHTML = `
      <div class="loading-state">Loading your study tasks…</div>
    `;
    return;
  }

  if (pending.length === 0) {
    elements.taskRecommendations.innerHTML = `
      <div class="empty-state">
        <strong>No pending study tasks.</strong><br>
        You can add a new topic or revision session to your Study Planner.
        <br><br>
        <a class="text-link" href="./study-planner.html">Create a study task →</a>
      </div>
    `;
    return;
  }

  elements.taskRecommendations.innerHTML = pending
    .slice(0, 5)
    .map((task, index) => {
      const status = getTaskStatus(task);
      const priority = String(task.priority || "low").toLowerCase();
      const priorityClass = ["high", "medium", "low"].includes(priority)
        ? priority
        : "low";

      let statusText = "Upcoming";

      if (status === "overdue") statusText = "Overdue";
      else if (status === "today") statusText = "Due today";

      const taskTitle = task.title || "Untitled study task";
      const details = [
        task.subject,
        task.topic,
        task.date ? formatDate(task.date) : "",
        Number(task.duration) > 0 ? formatDuration(task.duration) : ""
      ].filter(Boolean).join(" · ");

      return `
        <article class="recommendation-item">
          <div class="item-top">
            <div>
              <div class="item-title">
                ${index + 1}. ${escapeHTML(taskTitle)}
              </div>
              <p class="item-description">${escapeHTML(details || "Study task")}</p>
            </div>
            <span class="priority-pill priority-${priorityClass}">
              ${escapeHTML(statusText)}
            </span>
          </div>
          <p class="item-description">
            Priority: ${escapeHTML(priority)}.
            ${status === "overdue"
              ? "Reschedule this task or complete it as soon as practical."
              : status === "today"
                ? "Consider working on this task today."
                : "Keep this task in your upcoming study schedule."}
          </p>
        </article>
      `;
    })
    .join("");
}

// =====================================================
// BUILD RECOMMENDATIONS
// =====================================================

function renderAll() {
  const subjects = calculateSubjectAverages();
  const pendingTasks = getRecommendedTasks();

  renderSubjectRecommendations(subjects);
  renderTaskRecommendations(studyTasks);

  if (!historyLoaded || !tasksLoaded) {
    elements.topRecommendation.textContent = "Preparing your recommendations…";
    elements.topRecommendationText.textContent =
      "GradeFlow is loading your saved results and study tasks.";
    return;
  }

  if (subjects.length > 0) {
    const lowest = subjects[0];

    if (pendingTasks.length > 0) {
      const nextTask = pendingTasks[0];

      elements.topRecommendation.textContent =
        `Start with ${nextTask.title || "your next study task"}`;

      elements.topRecommendationText.textContent =
        `${getTaskStatus(nextTask) === "overdue"
          ? "This task is overdue. "
          : getTaskStatus(nextTask) === "today"
            ? "This task is due today. "
            : ""}` +
        `Your lowest saved subject average is ${lowest.name} ` +
        `at ${lowest.average.toFixed(1)}%. Consider reviewing that subject ` +
        "while keeping your deadlines in mind.";
    } else {
      elements.topRecommendation.textContent =
        `Review ${lowest.name} first`;

      elements.topRecommendationText.textContent =
        `Its average from saved scores is ${lowest.average.toFixed(1)}%. ` +
        "Add a focused revision session to your Study Planner.";
    }
  } else if (pendingTasks.length > 0) {
    const nextTask = pendingTasks[0];

    elements.topRecommendation.textContent =
      `Work on ${nextTask.title || "your next study task"}`;

    elements.topRecommendationText.textContent =
      "There are pending tasks in your Study Planner, but no usable saved " +
      "subject scores were found. Save a calculator result to get subject-specific advice.";
  } else {
    elements.topRecommendation.textContent =
      "Build your study plan";

    elements.topRecommendationText.textContent =
      "Save a GPA calculation and add a study task. GradeFlow can then use both " +
      "your results and deadlines to suggest what to focus on.";
  }

  if (subjects.length > 0) {
    elements.sessionDuration.textContent = "Start with 25 minutes";
    elements.sessionDurationText.textContent =
      "Review one topic from your focus subject, then take a short break and test yourself.";
  } else if (pendingTasks.length > 0) {
    const minutes = Number(pendingTasks[0].duration);

    elements.sessionDuration.textContent = minutes > 0
      ? `Plan for ${formatDuration(minutes)}`
      : "Start with 25 minutes";

    elements.sessionDurationText.textContent =
      "Use the task's planned duration as a guide. Break longer sessions into focused blocks.";
  }
}

// =====================================================
// FIRESTORE LISTENERS
// =====================================================

function startDataListeners(user) {
  if (unsubscribeHistory) unsubscribeHistory();
  if (unsubscribeTasks) unsubscribeTasks();

  historyLoaded = false;
  tasksLoaded = false;
  historyFailed = false;
  tasksFailed = false;
  historyRecords = [];
  studyTasks = [];

  renderAll();

  const historyQuery = query(
    collection(db, "history"),
    where("uid", "==", user.uid)
  );

  unsubscribeHistory = onSnapshot(
    historyQuery,
    snapshot => {
      historyRecords = snapshot.docs.map(document => document.data());
      historyLoaded = true;
      historyFailed = false;
      renderAll();
    },
    error => {
      console.error("GradeFlow history recommendation error:", error);
      historyLoaded = true;
      historyFailed = true;
      renderAll();
      showMessage(
        "Could not read your saved history. Check the Firestore history rules."
      );
    }
  );

  const tasksQuery = query(
    collection(db, "studyTasks"),
    where("uid", "==", user.uid)
  );

  unsubscribeTasks = onSnapshot(
    tasksQuery,
    snapshot => {
      studyTasks = snapshot.docs.map(document => ({
        id: document.id,
        ...document.data()
      }));

      tasksLoaded = true;
      tasksFailed = false;
      renderAll();
    },
    error => {
      console.error("GradeFlow study task recommendation error:", error);
      tasksLoaded = true;
      tasksFailed = true;
      renderAll();
      showMessage(
        "Could not read your study tasks. Check the Firestore studyTasks rules."
      );
    }
  );
}

// =====================================================
// ACCOUNT
// =====================================================

elements.signOutButton.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "../login.html";
  } catch (error) {
    console.error("GradeFlow sign-out error:", error);
    showMessage("Could not sign out. Please try again.");
  }
});

onAuthStateChanged(auth, user => {
  if (!user) {
    if (unsubscribeHistory) unsubscribeHistory();
    if (unsubscribeTasks) unsubscribeTasks();

    window.location.href = "../login.html";
    return;
  }

  currentUser = user;

  const displayName =
    user.displayName ||
    (user.email ? user.email.split("@")[0] : "Student");

  elements.userName.textContent = displayName;
  elements.userAvatar.textContent =
    displayName.trim().charAt(0).toUpperCase() || "G";

  startDataListeners(currentUser);
});