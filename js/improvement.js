import { auth, db } from "./firebase.js";

import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

/* =========================================================
   GRADEFLOW GRADE IMPROVEMENT TRACKER
   Data source: existing calculation history
   Access: read-only
   ========================================================= */

const $ = (id) => document.getElementById(id);

let historyRecords = [];
let subjectStats = [];
let isLoading = true;

const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2
});

/* -------------------------
   General utilities
-------------------------- */

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };

    return replacements[character];
  });
}

function toNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function formatNumber(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
}

function formatSigned(value, decimals = 2) {
  if (!Number.isFinite(value)) return "—";

  if (value > 0) return `+${formatNumber(value, decimals)}`;
  if (value < 0) return `−${formatNumber(Math.abs(value), decimals)}`;

  return formatNumber(0, decimals);
}

function getDate(record) {
  const value = record?.time;

  if (value && typeof value.toDate === "function") {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "number" || typeof value === "string") {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

function formatDate(date, includeTime = false) {
  if (!date || Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  const options = includeTime
    ? {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }
    : {
        year: "numeric",
        month: "short",
        day: "numeric"
      };

  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function showMessage(message, type = "info") {
  const element = $("pageMessage");

  if (!element) return;

  element.textContent = message;
  element.hidden = false;
  element.classList.toggle("error", type === "error");
}

function hideMessage() {
  const element = $("pageMessage");

  if (!element) return;

  element.hidden = true;
  element.textContent = "";
  element.classList.remove("error");
}

function showEmpty(container, title, description = "") {
  if (!container) return;

  container.innerHTML = `
    <div class="empty-state compact-empty">
      <span class="empty-symbol">⌁</span>
      <strong>${escapeHTML(title)}</strong>
      ${description
        ? `<p>${escapeHTML(description)}</p>`
        : ""}
    </div>
  `;
}

function getGpa(record) {
  return toNumber(record?.gpa);
}

function getPercentage(record) {
  return toNumber(record?.percentage);
}

function getSubjects(record) {
  if (!Array.isArray(record?.subjects)) return [];

  return record.subjects
    .filter((subject) => {
      return subject &&
        typeof subject.name === "string" &&
        subject.name.trim() !== "";
    })
    .map((subject) => ({
      name: subject.name.trim(),
      score: toNumber(subject.score),
      grade: subject.grade ?? "",
      credits: toNumber(subject.credits)
    }));
}

function getCredits(record) {
  const savedCredits = toNumber(record?.totalCredits);

  if (savedCredits !== null) {
    return savedCredits;
  }

  return getSubjects(record).reduce((total, subject) => {
    return total + (subject.credits ?? 0);
  }, 0);
}

/* -------------------------
   Normalize saved history
-------------------------- */

function normalizeHistory(docSnapshot) {
  const data = docSnapshot.data();

  return {
    id: docSnapshot.id,
    ...data,
    gpa: getGpa(data),
    percentage: getPercentage(data),
    subjects: getSubjects(data),
    date: getDate(data)
  };
}

function sortRecords(records) {
  return [...records].sort((a, b) => {
    const aTime = a.date?.getTime() ?? 0;
    const bTime = b.date?.getTime() ?? 0;

    if (aTime !== bTime) {
      return aTime - bTime;
    }

    return String(a.id).localeCompare(String(b.id));
  });
}

/* -------------------------
   Load existing history
-------------------------- */

async function loadHistory(uid) {
  isLoading = true;
  renderLoadingStates();

  try {
    /*
      Read only the signed-in user's existing history.
      No history documents are created, edited or deleted.
      Sorting is performed locally to avoid requiring an
      additional Firestore composite index for this page.
    */

    const historyQuery = query(
      collection(db, "history"),
      where("uid", "==", uid)
    );

    const snapshot = await getDocs(historyQuery);

    historyRecords = sortRecords(
      snapshot.docs.map(normalizeHistory)
    );

    isLoading = false;
    hideMessage();

    renderAll();
  } catch (error) {
    console.error("GradeFlow improvement tracker error:", error);

    isLoading = false;

    showMessage(
      "Could not load your calculation history. Check your internet connection, Firebase configuration, and Firestore security rules, then refresh the page.",
      "error"
    );

    renderLoadingError();
  }
}

function renderLoadingStates() {
  $("subjectTableBody").innerHTML = `
    <tr>
      <td colspan="6" class="table-empty">
        Loading saved subject records...
      </td>
    </tr>
  `;

  showEmpty(
    $("gpaChart"),
    "Loading GPA history..."
  );

  showEmpty(
    $("subjectSummary"),
    "Loading subject history..."
  );

  showEmpty(
    $("historyTimeline"),
    "Loading calculation history..."
  );
}

function renderLoadingError() {
  $("latestGpa").textContent = "—";
  $("gpaChange").textContent = "—";
  $("subjectsTracked").textContent = "0";
  $("improvingSubjects").textContent = "0";

  $("latestGpaNote").textContent = "History unavailable";
  $("gpaChangeNote").textContent = "Unable to compare records";

  showEmpty(
    $("gpaChart"),
    "GPA history unavailable",
    "Your saved results could not be loaded."
  );

  showEmpty(
    $("subjectSummary"),
    "Subject history unavailable",
    "Check your connection and try again."
  );

  $("subjectTableBody").innerHTML = `
    <tr>
      <td colspan="6" class="table-empty">
        Subject records could not be loaded.
      </td>
    </tr>
  `;

  showEmpty(
    $("historyTimeline"),
    "Calculation history unavailable",
    "Check your connection and try again."
  );

  $("subjectTableFooter").textContent = "";
}

/* -------------------------
   Build subject comparisons
-------------------------- */

function buildSubjectStats(records) {
  const map = new Map();

  /*
    Process oldest to newest. When the same subject appears
    more than once in one calculation, use the last occurrence
    with a valid score to avoid double-counting that calculation.
  */

  records.forEach((record) => {
    const seenInThisRecord = new Map();

    record.subjects.forEach((subject) => {
      if (subject.score === null) return;

      const key = subject.name.trim().toLocaleLowerCase();

      if (!key) return;

      seenInThisRecord.set(key, subject);
    });

    seenInThisRecord.forEach((subject, key) => {
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: subject.name,
          scores: []
        });
      }

      const item = map.get(key);

      item.name = subject.name;

      item.scores.push({
        score: subject.score,
        grade: subject.grade,
        credits: subject.credits,
        recordId: record.id,
        date: record.date
      });
    });
  });

  return Array.from(map.values())
    .map((item) => {
      const scores = item.scores;

      const previous = scores.length >= 2
        ? scores[scores.length - 2]
        : null;

      const latest = scores.length
        ? scores[scores.length - 1]
        : null;

      const change = previous && latest
        ? latest.score - previous.score
        : null;

      let status = "single";

      if (previous && latest) {
        if (change > 0.000001) {
          status = "improved";
        } else if (change < -0.000001) {
          status = "declined";
        } else {
          status = "unchanged";
        }
      }

      return {
        ...item,
        count: scores.length,
        previous,
        latest,
        change,
        status
      };
    })
    .sort((a, b) => {
      if (a.latest && b.latest) {
        return b.latest.date?.getTime() - a.latest.date?.getTime();
      }

      if (a.latest) return -1;
      if (b.latest) return 1;

      return a.name.localeCompare(b.name);
    });
}

/* -------------------------
   Summary statistics
-------------------------- */

function renderStats() {
  const validGpaRecords = historyRecords.filter(
    (record) => record.gpa !== null
  );

  const latestRecord = validGpaRecords.length
    ? validGpaRecords[validGpaRecords.length - 1]
    : null;

  const previousRecord = validGpaRecords.length >= 2
    ? validGpaRecords[validGpaRecords.length - 2]
    : null;

  if (latestRecord) {
    $("latestGpa").textContent = formatNumber(latestRecord.gpa);

    $("latestGpaNote").textContent = latestRecord.date
      ? `Recorded ${formatDate(latestRecord.date)}`
      : "Latest saved GPA";
  } else {
    $("latestGpa").textContent = "—";
    $("latestGpaNote").textContent = "No valid GPA in saved history";
  }

  if (latestRecord && previousRecord) {
    const change = latestRecord.gpa - previousRecord.gpa;

    $("gpaChange").textContent = formatSigned(change);

    $("gpaChange").classList.toggle("positive", change > 0);
    $("gpaChange").classList.toggle("negative", change < 0);
    $("gpaChange").classList.toggle("neutral", change === 0);

    $("gpaChangeNote").textContent = change > 0
      ? "Higher than your previous saved GPA"
      : change < 0
        ? "Lower than your previous saved GPA"
        : "Same as your previous saved GPA";
  } else {
    $("gpaChange").textContent = "—";
    $("gpaChange").classList.remove(
      "positive",
      "negative",
      "neutral"
    );

    $("gpaChangeNote").textContent = validGpaRecords.length
      ? "Save another calculation to compare"
      : "No valid GPA comparison available";
  }

  $("subjectsTracked").textContent = String(subjectStats.length);

  const improvingCount = subjectStats.filter(
    (subject) => subject.status === "improved"
  ).length;

  $("improvingSubjects").textContent = String(improvingCount);

  const comparedCount = subjectStats.filter(
    (subject) => subject.status !== "single"
  ).length;

  $("improvingSubjectsNote").textContent = comparedCount
    ? `${improvingCount} of ${comparedCount} comparable subjects improved`
    : "Save calculations with repeated subjects to compare";
}

/* -------------------------
   GPA trend chart
-------------------------- */

function renderGpaChart() {
  const container = $("gpaChart");
  const selectedRange = $("trendRange").value;

  let records = historyRecords.filter(
    (record) => record.gpa !== null
  );

  if (selectedRange !== "all") {
    records = records.slice(-Number(selectedRange));
  }

  if (records.length === 0) {
    $("trendRangeLabel").textContent = "No valid GPA records";

    showEmpty(
      container,
      "No GPA results yet",
      "Save a calculation with a valid GPA to start your trend."
    );

    return;
  }

  const first = records[0];
  const last = records[records.length - 1];
  const difference = last.gpa - first.gpa;

  $("trendRangeLabel").textContent =
    `${records.length} record${records.length === 1 ? "" : "s"} · ` +
    `${formatSigned(difference)} change`;

  if (records.length === 1) {
    container.innerHTML = `
      <div class="empty-state compact-empty">
        <span class="empty-symbol">⌁</span>
        <strong>One GPA record found</strong>
        <p>Your saved GPA is ${escapeHTML(formatNumber(first.gpa))}.
        Save another calculation to see a trend.</p>
      </div>
    `;

    return;
  }

  const width = 680;
  const height = 245;
  const left = 48;
  const right = 18;
  const top = 18;
  const bottom = 35;

  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  const values = records.map((record) => record.gpa);

  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);

  /*
    Use a padded vertical range. The chart does not assume
    a 4-point or 5-point grading scale.
  */

  if (minValue === maxValue) {
    const padding = Math.max(Math.abs(minValue) * 0.1, 0.5);
    minValue -= padding;
    maxValue += padding;
  } else {
    const padding = (maxValue - minValue) * 0.18;
    minValue -= padding;
    maxValue += padding;
  }

  const xFor = (index) => {
    return left + (index / (records.length - 1)) * plotWidth;
  };

  const yFor = (value) => {
    return top +
      ((maxValue - value) / (maxValue - minValue)) * plotHeight;
  };

  const points = records.map((record, index) => ({
    x: xFor(index),
    y: yFor(record.gpa),
    record
  }));

  const path = points
    .map((point, index) => {
      return `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`;
    })
    .join(" ");

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  const areaPath = [
    path,
    `L ${lastPoint.x} ${top + plotHeight}`,
    `L ${firstPoint.x} ${top + plotHeight}`,
    "Z"
  ].join(" ");

  const tickCount = 5;
  const grid = [];

  for (let i = 0; i < tickCount; i++) {
    const ratio = i / (tickCount - 1);
    const y = top + ratio * plotHeight;
    const value = maxValue - ratio * (maxValue - minValue);

    grid.push(`
      <line
        class="chart-grid-line"
        x1="${left}"
        y1="${y}"
        x2="${width - right}"
        y2="${y}"
      ></line>
      <text
        class="chart-axis-label"
        x="${left - 9}"
        y="${y + 4}"
        text-anchor="end"
      >${escapeHTML(formatNumber(value))}</text>
    `);
  }

  const labelIndices = new Set([
    0,
    Math.floor((records.length - 1) / 2),
    records.length - 1
  ]);

  const labels = Array.from(labelIndices)
    .map((index) => {
      const point = points[index];
      const dateText = point.record.date
        ? formatDate(point.record.date)
        : "Saved result";

      let anchor = "middle";
      if (index === 0) anchor = "start";
      if (index === records.length - 1) anchor = "end";

      return `
        <text
          class="chart-axis-label"
          x="${point.x}"
          y="${height - 10}"
          text-anchor="${anchor}"
        >${escapeHTML(dateText)}</text>
      `;
    })
    .join("");

  const circles = points.map((point) => {
    const dateText = point.record.date
      ? formatDate(point.record.date, true)
      : "Date unavailable";

    return `
      <circle
        class="chart-point"
        cx="${point.x}"
        cy="${point.y}"
        r="4.5"
      >
        <title>${escapeHTML(dateText)} — GPA ${escapeHTML(
          formatNumber(point.record.gpa)
        )}</title>
      </circle>
    `;
  }).join("");

  container.innerHTML = `
    <svg
      viewBox="0 0 ${width} ${height}"
      role="img"
      aria-label="GPA trend based on saved calculation history"
    >
      <defs>
        <linearGradient id="gpaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#d8b45a" stop-opacity="0.24"></stop>
          <stop offset="100%" stop-color="#d8b45a" stop-opacity="0.01"></stop>
        </linearGradient>
      </defs>

      ${grid.join("")}

      <path class="chart-area" d="${areaPath}"></path>
      <path class="chart-line" d="${path}"></path>

      ${circles}
      ${labels}
    </svg>
  `;
}

/* -------------------------
   Subject overview
-------------------------- */

function renderSubjectSummary() {
  const container = $("subjectSummary");

  if (!subjectStats.length) {
    showEmpty(
      container,
      "No subject scores yet",
      "Your saved calculations need subject names and numeric scores."
    );

    return;
  }

  const comparable = subjectStats.filter(
    (subject) => subject.status !== "single"
  );

  /*
    Show the strongest positive changes first. If there are no
    comparable subjects, show subjects with the most records.
  */

  const ranked = comparable.length
    ? [...comparable].sort((a, b) => b.change - a.change)
    : [...subjectStats].sort((a, b) => b.count - a.count);

  const displayed = ranked.slice(0, 5);

  container.innerHTML = displayed.map((subject) => {
    const latestScore = subject.latest?.score;
    const width = latestScore === null || latestScore === undefined
      ? 0
      : Math.max(0, Math.min(100, latestScore));

    const changeLabel = subject.change === null
      ? "One recorded score"
      : `${formatSigned(subject.change)} points`;

    const changeClass = subject.status === "improved"
      ? "positive"
      : subject.status === "declined"
        ? "negative"
        : "neutral";

    const fillClass = subject.status === "improved"
      ? "green"
      : subject.status === "declined"
        ? "red"
        : "";

    return `
      <div class="mini-subject">
        <div class="mini-subject-head">
          <span class="mini-subject-name" title="${escapeHTML(subject.name)}">
            ${escapeHTML(subject.name)}
          </span>
          <span class="mini-subject-score">
            ${escapeHTML(formatNumber(latestScore))}
          </span>
        </div>

        <div class="progress-track" aria-label="Latest score">
          <div
            class="progress-fill ${fillClass}"
            style="width: ${width}%"
          ></div>
        </div>

        <div class="mini-subject-meta">
          <span>${subject.count} saved score${subject.count === 1 ? "" : "s"}</span>
          <span class="${changeClass}">${escapeHTML(changeLabel)}</span>
        </div>
      </div>
    `;
  }).join("");
}

/* -------------------------
   Detailed subject table
-------------------------- */

function renderSubjectTable() {
  const tbody = $("subjectTableBody");
  const search = $("subjectSearch").value.trim().toLocaleLowerCase();
  const filter = $("subjectFilter").value;

  let filtered = subjectStats.filter((subject) => {
    const matchesSearch = subject.name.toLocaleLowerCase().includes(search);
    const matchesFilter = filter === "all" || subject.status === filter;

    return matchesSearch && matchesFilter;
  });

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty">
          No subjects match the selected search or filter.
        </td>
      </tr>
    `;

    $("subjectTableFooter").textContent =
      `0 subjects shown · ${subjectStats.length} tracked`;

    return;
  }

  tbody.innerHTML = filtered.map((subject) => {
    const previousScore = subject.previous?.score;
    const latestScore = subject.latest?.score;

    let changeClass = "new";
    let changeText = "New";
    let trend = "•";

    if (subject.status === "improved") {
      changeClass = "up";
      changeText = `↑ ${formatSigned(subject.change)}`;
      trend = "↗";
    } else if (subject.status === "declined") {
      changeClass = "down";
      changeText = `↓ ${formatSigned(subject.change)}`;
      trend = "↘";
    } else if (subject.status === "unchanged") {
      changeClass = "same";
      changeText = "0";
      trend = "→";
    }

    if (subject.status === "single") {
      changeText = "First score";
      trend = "•";
    }

    return `
      <tr>
        <td class="subject-name-cell" title="${escapeHTML(subject.name)}">
          ${escapeHTML(subject.name)}
        </td>

        <td class="score-cell">
          ${escapeHTML(formatNumber(previousScore))}
        </td>

        <td class="score-cell">
          ${escapeHTML(formatNumber(latestScore))}
        </td>

        <td>
          <span class="change-pill ${changeClass}">
            ${escapeHTML(changeText)}
          </span>
        </td>

        <td>${subject.count}</td>

        <td>
          <span class="trend-mini" aria-label="${escapeHTML(subject.status)}">
            ${trend}
          </span>
        </td>
      </tr>
    `;
  }).join("");

  $("subjectTableFooter").textContent =
    `${filtered.length} subject${filtered.length === 1 ? "" : "s"} shown · ` +
    `${subjectStats.length} tracked in total`;
}

/* -------------------------
   Calculation timeline
-------------------------- */

function renderTimeline() {
  const container = $("historyTimeline");
  const limitValue = $("historyLimit").value;

  let records = [...historyRecords].reverse();

  if (limitValue !== "all") {
    records = records.slice(0, Number(limitValue));
  }

  if (!records.length) {
    showEmpty(
      container,
      "No saved calculations",
      "Complete and save a calculation in GradeFlow to begin tracking your progress."
    );

    return;
  }

  container.innerHTML = records.map((record) => {
    const gpaText = record.gpa === null
      ? "—"
      : formatNumber(record.gpa);

    const percentageText = record.percentage === null
      ? "—"
      : `${formatNumber(record.percentage)}%`;

    const subjectCount = record.subjects.length;
    const credits = getCredits(record);

    const dateText = record.date
      ? formatDate(record.date, true)
      : "Date unavailable";

    const scaleText = record.gpaScale
      ? `Scale ${record.gpaScale}`
      : "";

    return `
      <article class="timeline-item">
        <div class="timeline-marker"></div>

        <div>
          <div class="timeline-title">
            Saved calculation
          </div>

          <div class="timeline-date">
            ${escapeHTML(dateText)}
          </div>

          <div class="timeline-details">
            <span class="timeline-tag">
              ${subjectCount} subject${subjectCount === 1 ? "" : "s"}
            </span>

            <span class="timeline-tag">
              ${escapeHTML(formatNumber(credits))} credits
            </span>

            <span class="timeline-tag">
              ${escapeHTML(percentageText)} percentage
            </span>

            ${scaleText
              ? `<span class="timeline-tag">${escapeHTML(scaleText)}</span>`
              : ""}
          </div>
        </div>

        <div class="timeline-gpa">
          ${escapeHTML(gpaText)}
          <small>GPA</small>
        </div>
      </article>
    `;
  }).join("");
}

/* -------------------------
   Render the complete page
-------------------------- */

function renderAll() {
  subjectStats = buildSubjectStats(historyRecords);

  renderStats();
  renderGpaChart();
  renderSubjectSummary();
  renderSubjectTable();
  renderTimeline();
}

/* -------------------------
   Mobile navigation
-------------------------- */

function setupMobileNavigation() {
  const sidebar = $("sidebar");
  const menu = $("mobileMenu");
  const overlay = $("sidebarOverlay");

  function closeSidebar() {
    sidebar.classList.remove("open");
    overlay.classList.remove("show");
  }

  menu.addEventListener("click", () => {
    const isOpen = sidebar.classList.toggle("open");
    overlay.classList.toggle("show", isOpen);
  });

  overlay.addEventListener("click", closeSidebar);

  sidebar.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeSidebar);
  });
}

/* -------------------------
   Sign out
-------------------------- */

function setupSignOut() {
  $("logoutButton").addEventListener("click", async () => {
    const button = $("logoutButton");

    button.disabled = true;
    button.textContent = "Signing out...";

    try {
      await signOut(auth);
      window.location.href = "../login.html";
    } catch (error) {
      console.error("Sign out failed:", error);

      button.disabled = false;
      button.innerHTML = "<span>↪</span> Sign out";

      showMessage(
        "Could not sign out. Check your connection and try again.",
        "error"
      );
    }
  });
}

/* -------------------------
   Controls
-------------------------- */

function setupControls() {
  $("trendRange").addEventListener("change", renderGpaChart);
  $("subjectSearch").addEventListener("input", renderSubjectTable);
  $("subjectFilter").addEventListener("change", renderSubjectTable);
  $("historyLimit").addEventListener("change", renderTimeline);

  setupMobileNavigation();
  setupSignOut();
}

/* -------------------------
   Authentication
-------------------------- */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  await loadHistory(user.uid);
});

setupControls();