
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $ = (selector) => document.querySelector(selector);

const elements = {
  message: $("#analyticsMessage"),
  latestGpa: $("#latestGpa"),
  latestGpaNote: $("#latestGpaNote"),
  overallAverage: $("#overallAverage"),
  totalCredits: $("#totalCredits"),
  calculationCount: $("#calculationCount"),
  chart: $("#gpaChart"),
  trend: $("#trendSummary"),
  strong: $("#strongSubjects"),
  weak: $("#weakSubjects"),
  table: $("#subjectTable"),
  period: $("#periodSelect")
};

let allHistory = [];

$("#currentYear").textContent = new Date().getFullYear();

function showMessage(message, isError = false) {
  elements.message.textContent = message;
  elements.message.classList.toggle("error", isError);
}

function dateValue(record) {
  if (record.time?.toDate) {
    return record.time.toDate().getTime();
  }

  if (record.time instanceof Date) {
    return record.time.getTime();
  }

  if (typeof record.time === "number") {
    return record.time;
  }

  if (typeof record.time === "string") {
    const parsed = Date.parse(record.time);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function validNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getGpa(record) {
  return validNumber(record.gpa);
}

function getScale(record) {
  const scale = Number(record.gpaScale);

  if (scale === 4 || scale === 5) {
    return scale;
  }

  // Older records may not contain gpaScale.
  // GradeFlow's original GPA system was 5-point.
  return 5;
}

function getPercentage(record) {
  const saved = validNumber(record.percentage);

  if (saved !== null) {
    return saved;
  }

  const subjects = Array.isArray(record.subjects)
    ? record.subjects
    : [];

  const scores = subjects
    .map(subject => validNumber(subject.score))
    .filter(score => score !== null);

  if (!scores.length) return null;

  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function formatDate(timestamp) {
  if (!timestamp) return "Undated";

  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short"
  });
}

function safeText(value) {
  return String(value ?? "");
}

function renderEmpty() {
  elements.latestGpa.textContent = "—";
  elements.latestGpaNote.textContent = "Save a calculation to begin.";
  elements.overallAverage.textContent = "—";
  elements.totalCredits.textContent = "—";
  elements.calculationCount.textContent = "0";

  elements.chart.innerHTML =
    '<div class="chart-empty">No saved calculations yet. Calculate grades and save your result to see your progress.</div>';

  elements.trend.textContent = "";
  elements.strong.innerHTML = '<p class="muted">No subject data available.</p>';
  elements.weak.innerHTML = '<p class="muted">No subject data available.</p>';
  elements.table.innerHTML =
    '<tr><td colspan="4">No saved subject records yet.</td></tr>';
}

function getVisibleHistory() {
  const choice = elements.period.value;

  if (choice === "all") {
    return [...allHistory].sort((a, b) => a.timestamp - b.timestamp);
  }

  const count = Number(choice) || 10;

  return [...allHistory]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, count)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function renderMetrics() {
  const newest = [...allHistory]
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  elements.calculationCount.textContent = String(allHistory.length);

  if (!newest) {
    renderEmpty();
    return;
  }

  const gpa = getGpa(newest.data);
  const scale = getScale(newest.data);
  const credits = validNumber(newest.data.totalCredits);

  elements.latestGpa.textContent =
    gpa === null ? "—" : `${gpa.toFixed(2)} / ${scale}`;

  elements.latestGpaNote.textContent =
    `Latest saved result · ${formatDate(newest.timestamp)}`;

  elements.totalCredits.textContent =
    credits === null ? getSubjectCredits(newest.data.subjects) : credits;

  const percentages = allHistory
    .map(item => getPercentage(item.data))
    .filter(value => value !== null);

  if (percentages.length) {
    const average =
      percentages.reduce((sum, value) => sum + value, 0) /
      percentages.length;

    elements.overallAverage.textContent = `${average.toFixed(1)}%`;
  } else {
    elements.overallAverage.textContent = "—";
  }
}

function getSubjectCredits(subjects) {
  if (!Array.isArray(subjects)) return "—";

  const credits = subjects.reduce((sum, subject) => {
    const value = validNumber(subject.credits);
    return sum + (value !== null ? value : 0);
  }, 0);

  return credits || "—";
}

function renderChart() {
  const records = getVisibleHistory();

  const validRecords = records.filter(item => getGpa(item.data) !== null);

  if (!validRecords.length) {
    elements.chart.innerHTML =
      '<div class="chart-empty">No GPA values found in your saved records.</div>';

    elements.trend.textContent = "";
    return;
  }

  elements.chart.replaceChildren();

  validRecords.forEach((item, index) => {
    const gpa = getGpa(item.data);
    const scale = getScale(item.data);

    // Normalize each GPA to a percentage so 4-point and
    // 5-point systems can be compared on the same chart.
    const normalized = Math.max(0, Math.min(100, (gpa / scale) * 100));

    const column = document.createElement("div");
    column.className = "chart-item";

    const value = document.createElement("span");
    value.className = "chart-value";
    value.textContent = gpa.toFixed(2);

    const track = document.createElement("div");
    track.className = "bar-track";
    track.title = `GPA ${gpa.toFixed(2)} out of ${scale}`;

    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = `${normalized}%`;

    track.appendChild(bar);

    const label = document.createElement("span");
    label.className = "chart-label";
    label.textContent = formatDate(item.timestamp);
    label.title = `Calculation ${index + 1}`;

    column.append(value, track, label);
    elements.chart.appendChild(column);
  });

  if (validRecords.length >= 2) {
    const first = validRecords[0];
    const last = validRecords[validRecords.length - 1];

    const firstGpa = getGpa(first.data) / getScale(first.data);
    const lastGpa = getGpa(last.data) / getScale(last.data);
    const change = (lastGpa - firstGpa) * 100;

    if (Math.abs(change) < 0.05) {
      elements.trend.textContent =
        "Your normalized GPA has remained approximately stable across the selected records.";
    } else if (change > 0) {
      elements.trend.textContent =
        `Your normalized GPA increased by ${change.toFixed(1)} percentage points across the selected records.`;
    } else {
      elements.trend.textContent =
        `Your normalized GPA decreased by ${Math.abs(change).toFixed(1)} percentage points across the selected records. Review your recent subject scores for areas to improve.`;
    }
  } else {
    elements.trend.textContent =
      "Save another calculation to compare your progress over time.";
  }
}

function collectSubjectStats() {
  const subjects = new Map();

  for (const record of allHistory) {
    const list = Array.isArray(record.data.subjects)
      ? record.data.subjects
      : [];

    for (const subject of list) {
      const name = safeText(subject.name).trim();
      const score = validNumber(subject.score);

      if (!name || score === null || score < 0 || score > 100) {
        continue;
      }

      const key = name.toLocaleLowerCase();

      if (!subjects.has(key)) {
        subjects.set(key, {
          name,
          total: 0,
          count: 0,
          latestTimestamp: 0
        });
      }

      const entry = subjects.get(key);
      entry.total += score;
      entry.count += 1;
      entry.latestTimestamp = Math.max(
        entry.latestTimestamp,
        record.timestamp
      );
    }
  }

  return [...subjects.values()]
    .map(subject => ({
      ...subject,
      average: subject.total / subject.count
    }))
    .sort((a, b) => b.average - a.average);
}

function createSubjectItem(subject) {
  const item = document.createElement("div");
  item.className = "subject-item";

  const name = document.createElement("span");
  name.className = "subject-name";
  name.textContent = subject.name;

  const score = document.createElement("span");
  score.className = "subject-score";
  score.textContent = `${subject.average.toFixed(1)}%`;

  item.append(name, score);
  return item;
}

function renderSubjectAnalytics() {
  const subjects = collectSubjectStats();

  elements.strong.replaceChildren();
  elements.weak.replaceChildren();
  elements.table.replaceChildren();

  if (!subjects.length) {
    elements.strong.innerHTML = '<p class="muted">No subject data available yet.</p>';
    elements.weak.innerHTML = '<p class="muted">No subject data available yet.</p>';
    elements.table.innerHTML =
      '<tr><td colspan="4">Save a calculation containing subjects to see this breakdown.</td></tr>';
    return;
  }

  subjects.slice(0, 5).forEach(subject => {
    elements.strong.appendChild(createSubjectItem(subject));
  });

  [...subjects]
    .sort((a, b) => a.average - b.average)
    .slice(0, 5)
    .forEach(subject => {
      elements.weak.appendChild(createSubjectItem(subject));
    });

  subjects.forEach(subject => {
    const row = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = subject.name;

    const scoreCell = document.createElement("td");
    scoreCell.textContent = `${subject.average.toFixed(1)}%`;

    const countCell = document.createElement("td");
    countCell.textContent = String(subject.count);

    const progressCell = document.createElement("td");
    const track = document.createElement("div");
    track.className = "progress-track";

    const fill = document.createElement("div");
    fill.className = "progress-fill";
    fill.style.width = `${Math.max(0, Math.min(100, subject.average))}%`;

    track.appendChild(fill);
    progressCell.appendChild(track);

    row.append(nameCell, scoreCell, countCell, progressCell);
    elements.table.appendChild(row);
  });
}

function renderAnalytics() {
  renderMetrics();
  renderChart();
  renderSubjectAnalytics();
}

async function loadAnalytics(user) {
  showMessage("Loading your saved calculations...");

  try {
    const historyQuery = query(
      collection(db, "history"),
      where("uid", "==", user.uid)
    );

    const snapshot = await getDocs(historyQuery);

    allHistory = snapshot.docs.map(document => {
      const data = document.data();

      return {
        id: document.id,
        data,
        timestamp: dateValue(data)
      };
    });

    allHistory.sort((a, b) => a.timestamp - b.timestamp);

    renderAnalytics();

    showMessage(
      allHistory.length
        ? `Loaded ${allHistory.length} saved calculation${allHistory.length === 1 ? "" : "s"}.`
        : "No saved calculations yet. Save a result from the calculator to begin."
    );
  } catch (error) {
    console.error("GradeFlow analytics failed to load:", error);
    showMessage(
      "Could not load analytics. Check your internet connection and Firebase permissions, then reload.",
      true
    );
  }
}

elements.period.addEventListener("change", renderChart);

onAuthStateChanged(auth, user => {
  if (!user) {
    allHistory = [];
    renderEmpty();
    showMessage("Sign in to view your personal performance analytics.", true);
    return;
  }

  loadAnalytics(user);
});
