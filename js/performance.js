// ============================================
// GRADEFLOW — PERFORMANCE PAGE
// File: js/performance.js
// Firebase SDK: 10.12.0
// ============================================

import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ============================================
// DOM ELEMENTS
// ============================================

const $ = (id) => document.getElementById(id);

const el = {
  sidebar: $("sidebar"),
  sidebarBackdrop: $("sidebarBackdrop"),
  menuToggle: $("menuToggle"),
  signOutButton: $("signOutButton"),

  sidebarAvatar: $("sidebarAvatar"),
  sidebarUserName: $("sidebarUserName"),
  sidebarUserEmail: $("sidebarUserEmail"),
  headerAvatar: $("headerAvatar"),

  todayLabel: $("todayLabel"),
  refresh: $("refreshPerformance"),
  message: $("performanceMessage"),

  total: $("totalCalculations"),
  averageGpa: $("averageGpa"),
  averagePercentage: $("averagePercentage"),
  highestGpa: $("highestGpa"),

  gpaChart: $("gpaChart"),
  trendCount: $("trendCount"),
  trendCaption: $("trendCaption"),

  latestResult: $("latestResult"),
  subjectChart: $("subjectChart"),
  subjectCount: $("subjectCount"),

  filters: $("performanceFilters"),
  dateFrom: $("dateFrom"),
  dateTo: $("dateTo"),
  clearFilters: $("clearFilters"),
  recordCount: $("recordCount"),
  recordsTableBody: $("recordsTableBody")
};

// ============================================
// STATE
// ============================================

let currentUser = null;
let allRecords = [];
let unsubscribeRecords = null;
let authVersion = 0;

// ============================================
// SAFE HELPERS
// ============================================

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return map[character];
  });
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function average(values) {
  const valid = values.filter((value) => value !== null && Number.isFinite(value));

  if (!valid.length) return null;

  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function formatNumber(value, decimals = 2) {
  if (value === null || !Number.isFinite(value)) return "—";

  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function getGpa(record) {
  return toNumber(record.gpa);
}

function getPercentage(record) {
  return toNumber(record.percentage);
}

function getSubjects(record) {
  return Array.isArray(record.subjects) ? record.subjects : [];
}

function getRecordDate(record) {
  const value = record.time;

  if (value && typeof value.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number" || typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function formatDate(value, includeTime = false) {
  const date = value instanceof Date ? value : getRecordDate({ time: value });

  if (!date) return "Date unavailable";

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(includeTime
      ? { hour: "2-digit", minute: "2-digit" }
      : {})
  }).format(date);
}

function localDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function getInitials(name, email) {
  const source = String(name || email || "G").trim();
  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  return source.slice(0, 2).toUpperCase() || "G";
}

// ============================================
// STATUS MESSAGES
// ============================================

function showMessage(message, type = "info") {
  if (!el.message) return;

  el.message.textContent = message;
  el.message.className = `status-message ${type}`;
  el.message.hidden = false;
}

function hideMessage() {
  if (!el.message) return;

  el.message.hidden = true;
  el.message.textContent = "";
  el.message.className = "status-message";
}

// ============================================
// PROFILE
// ============================================

function setAvatar(element, user, name) {
  if (!element) return;

  if (user.photoURL) {
    element.innerHTML = `
      <img
        src="${escapeHTML(user.photoURL)}"
        alt="Profile photo"
        referrerpolicy="no-referrer"
      >
    `;

    element.querySelector("img")?.addEventListener("error", () => {
      element.textContent = getInitials(name, user.email);
    }, { once: true });
  } else {
    element.textContent = getInitials(name, user.email);
  }
}

async function loadProfile(user, version) {
  let name = user.displayName || "";

  try {
    const profileSnapshot = await getDoc(doc(db, "users", user.uid));

    if (version !== authVersion) return;

    if (profileSnapshot.exists()) {
      const profile = profileSnapshot.data();

      name =
        profile.name ||
        profile.displayName ||
        profile.username ||
        name;
    }
  } catch (error) {
    console.warn("GradeFlow profile could not be loaded:", error);
  }

  if (version !== authVersion) return;

  name = name || user.email?.split("@")[0] || "Student";

  if (el.sidebarUserName) el.sidebarUserName.textContent = name;
  if (el.sidebarUserEmail) el.sidebarUserEmail.textContent = user.email || "";

  setAvatar(el.sidebarAvatar, user, name);
  setAvatar(el.headerAvatar, user, name);
}

// ============================================
// DATE LABEL
// ============================================

function updateTodayLabel() {
  if (!el.todayLabel) return;

  el.todayLabel.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date());
}

// ============================================
// FILTERS
// ============================================

function getFilteredRecords() {
  const from = el.dateFrom?.value || "";
  const to = el.dateTo?.value || "";

  return allRecords.filter((record) => {
    const date = getRecordDate(record);

    // Date filters operate on the user's local calendar dates.
    if (from && (!date || localDateKey(date) < from)) return false;
    if (to && (!date || localDateKey(date) > to)) return false;

    return true;
  });
}

function validateDateRange() {
  const from = el.dateFrom?.value || "";
  const to = el.dateTo?.value || "";

  if (from && to && from > to) {
    showMessage("The start date must not be after the end date.", "warning");
    return false;
  }

  hideMessage();
  return true;
}

// ============================================
// SUMMARY CARDS
// ============================================

function renderSummary(records) {
  const gpas = records.map(getGpa).filter((value) => value !== null);
  const percentages = records
    .map(getPercentage)
    .filter((value) => value !== null);

  const averageGpa = average(gpas);
  const averagePercentage = average(percentages);
  const highestGpa = gpas.length ? Math.max(...gpas) : null;

  if (el.total) {
    el.total.textContent = String(records.length);
  }

  if (el.averageGpa) {
    el.averageGpa.textContent = formatNumber(averageGpa);
  }

  if (el.averagePercentage) {
    el.averagePercentage.textContent =
      averagePercentage === null
        ? "—"
        : `${formatNumber(averagePercentage)}%`;
  }

  if (el.highestGpa) {
    el.highestGpa.textContent = formatNumber(highestGpa);
  }
}

// ============================================
// GPA TREND CHART
// ============================================

function renderGpaChart(records) {
  const points = records
    .filter((record) => getGpa(record) !== null)
    .map((record) => ({
      gpa: getGpa(record),
      date: getRecordDate(record)
    }))
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return -1;
      if (!b.date) return 1;
      return a.date - b.date;
    });

  if (el.trendCount) {
    el.trendCount.textContent =
      `${points.length} result${points.length === 1 ? "" : "s"}`;
  }

  if (!el.gpaChart) return;

  if (!points.length) {
    el.gpaChart.innerHTML = `
      <div class="chart-placeholder">
        No valid GPA results are available yet.
      </div>
    `;

    if (el.trendCaption) {
      el.trendCaption.textContent =
        "Save a calculation containing a valid GPA to see your trend.";
    }

    return;
  }

  const width = 720;
  const height = 235;
  const left = 48;
  const right = 16;
  const top = 18;
  const bottom = 36;

  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  const values = points.map((point) => point.gpa);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);

  // Add a little padding around the data without assuming a GPA scale.
  const range = dataMax - dataMin;
  const padding = range === 0
    ? Math.max(Math.abs(dataMax) * 0.1, 0.5)
    : range * 0.18;

  const minY = dataMin - padding;
  const maxY = dataMax + padding;

  const xPosition = (index) => {
    if (points.length === 1) return left + plotWidth / 2;

    return left + (index / (points.length - 1)) * plotWidth;
  };

  const yPosition = (value) => {
    return top + ((maxY - value) / (maxY - minY)) * plotHeight;
  };

  const plottedPoints = points.map((point, index) => ({
    ...point,
    x: xPosition(index),
    y: yPosition(point.gpa)
  }));

  const polyline = plottedPoints
    .map((point) => `${point.x},${point.y}`)
    .join(" ");

  const areaPath = [
    `M ${plottedPoints[0].x} ${height - bottom}`,
    ...plottedPoints.map((point) => `L ${point.x} ${point.y}`),
    `L ${plottedPoints[plottedPoints.length - 1].x} ${height - bottom}`,
    "Z"
  ].join(" ");

  const grid = [0, 1, 2, 3, 4].map((index) => {
    const y = top + (index / 4) * plotHeight;
    const value = maxY - (index / 4) * (maxY - minY);

    return `
      <line
        class="chart-grid-line"
        x1="${left}" y1="${y}"
        x2="${width - right}" y2="${y}"
      />
      <text class="chart-axis-label"
        x="${left - 9}" y="${y + 4}"
        text-anchor="end">${formatNumber(value, 2)}</text>
    `;
  }).join("");

  // Display up to five date labels to avoid crowding.
  const labelIndices = new Set();

  if (points.length <= 5) {
    points.forEach((_, index) => labelIndices.add(index));
  } else {
    [0, Math.round((points.length - 1) / 2), points.length - 1]
      .forEach((index) => labelIndices.add(index));

    const quarter = Math.round((points.length - 1) / 4);
    const threeQuarter = Math.round(3 * (points.length - 1) / 4);

    labelIndices.add(quarter);
    labelIndices.add(threeQuarter);
  }

  const labels = [...labelIndices].map((index) => {
    const point = plottedPoints[index];
    const dateLabel = point.date
      ? escapeHTML(new Intl.DateTimeFormat(undefined, {
          day: "numeric",
          month: "short"
        }).format(point.date))
      : "Unknown";

    return `
      <text
        class="chart-axis-label"
        x="${point.x}"
        y="${height - 11}"
        text-anchor="middle"
      >${dateLabel}</text>
    `;
  }).join("");

  const circles = plottedPoints.map((point) => `
    <circle
      class="chart-point"
      cx="${point.x}"
      cy="${point.y}"
      r="4"
    >
      <title>${escapeHTML(formatNumber(point.gpa))} GPA — ${
        escapeHTML(formatDate(point.date))
      }</title>
    </circle>
  `).join("");

  el.gpaChart.innerHTML = `
    <svg
      class="gpa-svg"
      viewBox="0 0 ${width} ${height}"
      role="img"
      aria-label="GPA trend chart with ${points.length} saved results"
    >
      ${grid}
      <path class="chart-area" d="${areaPath}"></path>
      <polyline class="chart-line" points="${polyline}"></polyline>
      ${circles}
      ${labels}
    </svg>
  `;

  if (el.trendCaption) {
    if (points.length === 1) {
      el.trendCaption.textContent =
        "One valid GPA result is available. Save more calculations to compare progress.";
    } else {
      const first = points[0].gpa;
      const last = points[points.length - 1].gpa;
      const difference = last - first;

      if (difference > 0) {
        el.trendCaption.textContent =
          `Your latest GPA is ${formatNumber(difference)} points higher than your earliest valid saved GPA.`;
      } else if (difference < 0) {
        el.trendCaption.textContent =
          `Your latest GPA is ${formatNumber(Math.abs(difference))} points lower than your earliest valid saved GPA.`;
      } else {
        el.trendCaption.textContent =
          "Your earliest and latest valid saved GPAs are equal.";
      }
    }
  }
}

// ============================================
// LATEST RESULT
// ============================================

function renderLatestResult(records) {
  if (!el.latestResult) return;

  const sorted = [...records].sort((a, b) => {
    const dateA = getRecordDate(a);
    const dateB = getRecordDate(b);

    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;

    return dateB - dateA;
  });

  const latest = sorted[0];

  if (!latest) {
    el.latestResult.innerHTML = `
      <div class="chart-placeholder">
        Your latest saved calculation will appear here.
      </div>
    `;
    return;
  }

  const gpa = getGpa(latest);
  const percentage = getPercentage(latest);
  const subjects = getSubjects(latest);

  el.latestResult.innerHTML = `
    <span class="latest-date">${escapeHTML(formatDate(getRecordDate(latest), true))}</span>

    <div class="latest-gpa-box">
      <span class="latest-gpa-label">Latest GPA</span>
      <p class="latest-gpa-value">${escapeHTML(formatNumber(gpa))}</p>
    </div>

    <div class="latest-metrics">
      <div class="latest-metric">
        <span>Percentage</span>
        <strong>${percentage === null
          ? "—"
          : `${escapeHTML(formatNumber(percentage))}%`}</strong>
      </div>

      <div class="latest-metric">
        <span>Subjects</span>
        <strong>${subjects.length}</strong>
      </div>
    </div>

    <div class="latest-trend">
      This is your most recent saved calculation, not necessarily your highest GPA.
    </div>
  `;
}

// ============================================
// SUBJECT PERFORMANCE
// ============================================

function renderSubjectPerformance(records) {
  if (!el.subjectChart) return;

  const subjectGroups = new Map();

  records.forEach((record) => {
    getSubjects(record).forEach((subject) => {
      const name = String(subject.name || "").trim();
      const score = toNumber(subject.score);

      if (!name || score === null) return;

      const key = name.toLocaleLowerCase();

      if (!subjectGroups.has(key)) {
        subjectGroups.set(key, {
          name,
          scores: []
        });
      }

      subjectGroups.get(key).scores.push(score);
    });
  });

  const subjects = [...subjectGroups.values()]
    .map((subject) => ({
      name: subject.name,
      count: subject.scores.length,
      average: average(subject.scores)
    }))
    .filter((subject) => subject.average !== null)
    .sort((a, b) => b.average - a.average);

  if (el.subjectCount) {
    el.subjectCount.textContent =
      `${subjects.length} subject${subjects.length === 1 ? "" : "s"}`;
  }

  if (!subjects.length) {
    el.subjectChart.innerHTML = `
      <div class="chart-placeholder">
        No valid saved subject scores are available yet.
      </div>
    `;
    return;
  }

  // Show the top 8 subjects by average score.
  el.subjectChart.innerHTML = subjects.slice(0, 8).map((subject) => {
    // The width is a visual comparison relative to 100 marks.
    // The actual average score shown remains unchanged.
    const width = Math.max(0, Math.min(100, subject.average));

    return `
      <div class="subject-bar-item">
        <div class="subject-bar-heading">
          <span class="subject-bar-name"
            title="${escapeHTML(subject.name)}">
            ${escapeHTML(subject.name)}
          </span>

          <span class="subject-bar-value">
            ${escapeHTML(formatNumber(subject.average, 1))}
            <span style="color:#85847a;font-weight:400">
              (${subject.count} result${subject.count === 1 ? "" : "s"})
            </span>
          </span>
        </div>

        <div class="subject-bar-track"
          role="img"
          aria-label="${escapeHTML(subject.name)} average score ${escapeHTML(formatNumber(subject.average, 1))}">
          <div
            class="subject-bar-fill"
            style="width:${width}%"
          ></div>
        </div>
      </div>
    `;
  }).join("");
}

// ============================================
// PERFORMANCE RECORDS TABLE
// ============================================

function renderRecordsTable(records) {
  if (!el.recordsTableBody) return;

  if (el.recordCount) {
    el.recordCount.textContent =
      `${records.length} record${records.length === 1 ? "" : "s"} shown`;
  }

  if (!records.length) {
    el.recordsTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="table-placeholder">
          No calculations match this date range.
        </td>
      </tr>
    `;
    return;
  }

  el.recordsTableBody.innerHTML = records.map((record) => {
    const gpa = getGpa(record);
    const percentage = getPercentage(record);
    const subjectCount = getSubjects(record).length;

    return `
      <tr>
        <td>${escapeHTML(formatDate(getRecordDate(record), true))}</td>
        <td class="table-gpa">${escapeHTML(formatNumber(gpa))}</td>
        <td>${percentage === null
          ? "—"
          : `${escapeHTML(formatNumber(percentage))}%`}</td>
        <td>${subjectCount}</td>
      </tr>
    `;
  }).join("");
}

// ============================================
// RENDER PAGE
// ============================================

function renderPerformance() {
  const filtered = getFilteredRecords();

  // Summary cards, trend, latest result and subject averages use all saved
  // records so date filtering only affects the records table.
  renderSummary(allRecords);
  renderGpaChart(allRecords);
  renderLatestResult(allRecords);
  renderSubjectPerformance(allRecords);
  renderRecordsTable(filtered);
}

// ============================================
// LOADING STATES
// ============================================

function showLoading() {
  if (el.gpaChart) {
    el.gpaChart.innerHTML =
      '<div class="chart-placeholder">Loading GPA trend...</div>';
  }

  if (el.latestResult) {
    el.latestResult.innerHTML =
      '<div class="chart-placeholder">Loading latest result...</div>';
  }

  if (el.subjectChart) {
    el.subjectChart.innerHTML =
      '<div class="chart-placeholder">Loading subject performance...</div>';
  }

  if (el.recordsTableBody) {
    el.recordsTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="table-placeholder">Loading records...</td>
      </tr>
    `;
  }
}

function showLoadError(error) {
  console.error("GradeFlow performance history error:", error);

  let message =
    "Could not load your performance data. Check your connection and try again.";

  if (error.code === "permission-denied") {
    message =
      "Firestore denied access. Check that you are signed in and your history security rules permit reading your own records.";
  } else if (error.code === "failed-precondition") {
    message =
      "Firestore reported a query/index problem. Check the browser console for the exact error.";
  }

  showMessage(message, "error");

  if (el.gpaChart) {
    el.gpaChart.innerHTML =
      '<div class="chart-placeholder">Performance data could not be loaded.</div>';
  }

  if (el.latestResult) {
    el.latestResult.innerHTML =
      '<div class="chart-placeholder">Performance data could not be loaded.</div>';
  }

  if (el.subjectChart) {
    el.subjectChart.innerHTML =
      '<div class="chart-placeholder">Performance data could not be loaded.</div>';
  }

  if (el.recordsTableBody) {
    el.recordsTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="table-placeholder">
          Performance data could not be loaded.
        </td>
      </tr>
    `;
  }
}

// ============================================
// FIRESTORE REAL-TIME LISTENER
// ============================================

function startPerformanceListener() {
  if (!currentUser) return;

  if (unsubscribeRecords) {
    unsubscribeRecords();
    unsubscribeRecords = null;
  }

  hideMessage();
  showLoading();

  const userAtRequest = currentUser;

  const historyQuery = query(
    collection(db, "history"),
    where("uid", "==", userAtRequest.uid),
    orderBy("time", "desc")
  );

  unsubscribeRecords = onSnapshot(
    historyQuery,
    (snapshot) => {
      if (
        !currentUser ||
        currentUser.uid !== userAtRequest.uid
      ) {
        return;
      }

      allRecords = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      renderPerformance();
      hideMessage();
    },
    (error) => {
      if (
        !currentUser ||
        currentUser.uid !== userAtRequest.uid
      ) {
        return;
      }

      showLoadError(error);
    }
  );
}

// ============================================
// SIDEBAR
// ============================================

function openSidebar() {
  el.sidebar?.classList.add("open");
  el.sidebarBackdrop?.classList.add("show");
  el.menuToggle?.setAttribute("aria-expanded", "true");
}

function closeSidebar() {
  el.sidebar?.classList.remove("open");
  el.sidebarBackdrop?.classList.remove("show");
  el.menuToggle?.setAttribute("aria-expanded", "false");
}

function toggleSidebar() {
  if (el.sidebar?.classList.contains("open")) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

// ============================================
// EVENTS
// ============================================

function setupEvents() {
  el.refresh?.addEventListener("click", () => {
    if (!currentUser) return;

    startPerformanceListener();
  });

  el.menuToggle?.addEventListener("click", toggleSidebar);
  el.sidebarBackdrop?.addEventListener("click", closeSidebar);

  el.sidebar?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeSidebar);
  });

  el.filters?.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!validateDateRange()) return;

    renderRecordsTable(getFilteredRecords());
  });

  el.clearFilters?.addEventListener("click", () => {
    if (el.dateFrom) el.dateFrom.value = "";
    if (el.dateTo) el.dateTo.value = "";

    hideMessage();
    renderRecordsTable(getFilteredRecords());
  });

  el.dateFrom?.addEventListener("change", validateDateRange);
  el.dateTo?.addEventListener("change", validateDateRange);

  el.signOutButton?.addEventListener("click", async () => {
    el.signOutButton.disabled = true;

    try {
      await signOut(auth);
      window.location.replace("../login.html");
    } catch (error) {
      console.error("GradeFlow sign-out error:", error);
      showMessage("Could not sign out. Please try again.", "error");
      el.signOutButton.disabled = false;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSidebar();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) closeSidebar();
  });
}

// ============================================
// INITIALIZATION
// ============================================

function initializePerformancePage() {
  updateTodayLabel();
  setupEvents();

  onAuthStateChanged(auth, async (user) => {
    authVersion++;

    const version = authVersion;

    if (unsubscribeRecords) {
      unsubscribeRecords();
      unsubscribeRecords = null;
    }

    currentUser = user;
    allRecords = [];

    if (!user) {
      window.location.replace("../login.html");
      return;
    }

    renderSummary([]);
    showLoading();

    await loadProfile(user, version);

    if (
      version !== authVersion ||
      !currentUser ||
      currentUser.uid !== user.uid
    ) {
      return;
    }

    startPerformanceListener();
  });
}

initializePerformancePage();