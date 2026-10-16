
import { auth, db } from "./firebase.js";

import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// --------------------------------------------------
// GRADEFLOW REPORTS
// --------------------------------------------------

const $ = (id) => document.getElementById(id);

let allReports = [];
let currentReports = [];
let unsubscribeHistory = null;
let currentUser = null;

const notice = $("notice");
const tableBody = $("reportTableBody");
const emptyState = $("emptyState");
const detailModal = $("detailModal");

$("generatedDate").textContent = new Intl.DateTimeFormat(
  "en-GB",
  { day: "numeric", month: "short", year: "numeric" }
).format(new Date());

// --------------------------------------------------
// NOTIFICATIONS
// --------------------------------------------------

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle("error", isError);
  notice.hidden = false;
}

function hideNotice() {
  notice.hidden = true;
  notice.classList.remove("error");
}

// --------------------------------------------------
// FORMATTERS
// --------------------------------------------------

function formatDate(value) {
  if (!value) return "Date unavailable";

  let date;

  if (typeof value.toDate === "function") {
    date = value.toDate();
  } else if (value instanceof Date) {
    date = value;
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "Date unavailable";

  let date;

  if (typeof value.toDate === "function") {
    date = value.toDate();
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getDateObject(value) {
  if (!value) return null;

  const date = typeof value.toDate === "function"
    ? value.toDate()
    : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function getGpa(report) {
  const value = Number.parseFloat(report.gpa);
  return Number.isFinite(value) ? value : null;
}

function getPercentage(report) {
  if (
    report.percentage === null ||
    report.percentage === undefined ||
    report.percentage === ""
  ) {
    return null;
  }

  const value = Number(report.percentage);
  return Number.isFinite(value) ? value : null;
}

function getSubjects(report) {
  return Array.isArray(report.subjects) ? report.subjects : [];
}

function formatNumber(value, decimals = 2) {
  return Number(value).toFixed(decimals);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
}

function getReportId(report) {
  return report.id;
}

// --------------------------------------------------
// AUTHENTICATION AND HISTORY LISTENER
// --------------------------------------------------

onAuthStateChanged(auth, (user) => {
  if (!user) {
    if (unsubscribeHistory) {
      unsubscribeHistory();
      unsubscribeHistory = null;
    }

    window.location.href = "../login.html";
    return;
  }

  // Avoid opening duplicate listeners when auth state refreshes.
  if (currentUser?.uid === user.uid && unsubscribeHistory) {
    return;
  }

  if (unsubscribeHistory) {
    unsubscribeHistory();
    unsubscribeHistory = null;
  }

  currentUser = user;

  $("userLabel").textContent =
    user.displayName || user.email || "Your reports";

  hideNotice();

  tableBody.innerHTML = `
    <tr>
      <td colspan="5" class="empty-cell">Loading reports...</td>
    </tr>
  `;

  const historyQuery = query(
    collection(db, "history"),
    where("uid", "==", user.uid),
    orderBy("time", "desc")
  );

  unsubscribeHistory = onSnapshot(
    historyQuery,
    (snapshot) => {
      allReports = snapshot.docs.map((document) => ({
        id: document.id,
        ...document.data()
      }));

      applyDateFilter();
      hideNotice();
    },
    (error) => {
      console.error("Could not load GradeFlow reports:", error);

      showNotice(
        "Unable to load your reports. Check your internet connection and Firestore permissions.",
        true
      );

      tableBody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-cell">
            Reports could not be loaded.
          </td>
        </tr>
      `;

      emptyState.hidden = true;
    }
  );
});

// --------------------------------------------------
// DATE FILTERING
// --------------------------------------------------

function applyDateFilter() {
  const startValue = $("startDate").value;
  const endValue = $("endDate").value;

  if (startValue && endValue && startValue > endValue) {
    showNotice(
      "The start date must be on or before the end date.",
      true
    );
    return;
  }

  hideNotice();

  const startDate = startValue
    ? new Date(`${startValue}T00:00:00`)
    : null;

  const endDate = endValue
    ? new Date(`${endValue}T23:59:59.999`)
    : null;

  currentReports = allReports.filter((report) => {
    const date = getDateObject(report.time);

    // Records without dates cannot be assigned to a date range.
    if (!date) {
      return !startDate && !endDate;
    }

    if (startDate && date < startDate) return false;
    if (endDate && date > endDate) return false;

    return true;
  });

  $("filterStatus").textContent =
    startValue || endValue
      ? `${startValue || "Earliest"} to ${endValue || "Latest"}`
      : "Showing all saved calculations";

  $("reportPeriod").textContent =
    startValue || endValue
      ? `Period: ${startValue || "Earliest"} to ${endValue || "Latest"}`
      : "All available saved calculations";

  renderReport();
}

$("startDate").addEventListener("change", applyDateFilter);
$("endDate").addEventListener("change", applyDateFilter);

$("resetFilterBtn").addEventListener("click", () => {
  $("startDate").value = "";
  $("endDate").value = "";
  applyDateFilter();
});

// --------------------------------------------------
// SUMMARY STATISTICS
// --------------------------------------------------

function renderStatistics() {
  const reports = currentReports;

  const gpas = reports
    .map(getGpa)
    .filter((value) => value !== null);

  const percentages = reports
    .map(getPercentage)
    .filter((value) => value !== null);

  $("totalReports").textContent = reports.length;

  $("averageGpa").textContent = gpas.length
    ? formatNumber(
        gpas.reduce((total, value) => total + value, 0) / gpas.length
      )
    : "—";

  $("averagePercentage").textContent = percentages.length
    ? `${formatNumber(
        percentages.reduce((total, value) => total + value, 0) /
          percentages.length
      )}%`
    : "—";

  if (gpas.length) {
    let highestReport = null;

    for (const report of reports) {
      const gpa = getGpa(report);

      if (gpa === null) continue;

      if (
        highestReport === null ||
        gpa > getGpa(highestReport)
      ) {
        highestReport = report;
      }
    }

    $("highestGpa").textContent =
      highestReport ? formatNumber(getGpa(highestReport)) : "—";

    $("highestGpaDate").textContent = highestReport
      ? formatDate(highestReport.time)
      : "No GPA data";
  } else {
    $("highestGpa").textContent = "—";
    $("highestGpaDate").textContent = "No GPA data";
  }
}

// --------------------------------------------------
// REPORT TABLE
// --------------------------------------------------

function renderReport() {
  renderStatistics();

  $("recordCount").textContent =
    `${currentReports.length} ${
      currentReports.length === 1 ? "record" : "records"
    }`;

  tableBody.innerHTML = "";

  if (currentReports.length === 0) {
    emptyState.hidden = false;

    $("emptyMessage").textContent = allReports.length
      ? "No saved calculations match the selected date range."
      : "Save a calculation first, and it will appear here.";

    tableBody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-cell">
          No records to display.
        </td>
      </tr>
    `;

    return;
  }

  emptyState.hidden = true;

  for (const report of currentReports) {
    const gpa = getGpa(report);
    const percentage = getPercentage(report);
    const subjectCount = getSubjects(report).length;

    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${escapeHTML(formatDate(report.time))}</td>
      <td>
        <span class="gpa-pill">
          ${gpa === null ? "—" : escapeHTML(formatNumber(gpa))}
        </span>
      </td>
      <td>
        <span class="percentage-value">
          ${percentage === null
            ? "—"
            : `${escapeHTML(formatNumber(percentage))}%`}
        </span>
      </td>
      <td>${subjectCount}</td>
      <td>
        <button
          class="view-btn"
          type="button"
          data-report-id="${escapeHTML(getReportId(report))}"
        >
          View details
        </button>
      </td>
    `;

    tableBody.appendChild(row);
  }
}

tableBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-report-id]");
  if (!button) return;

  const report = currentReports.find(
    (item) => item.id === button.dataset.reportId
  );

  if (report) openReportDetails(report);
});

// --------------------------------------------------
// REPORT DETAIL MODAL
// --------------------------------------------------

function openReportDetails(report) {
  const gpa = getGpa(report);
  const percentage = getPercentage(report);
  const subjects = getSubjects(report);

  const content = $("detailContent");

  content.innerHTML = `
    <div class="detail-summary">
      <div class="detail-metric">
        <span>GPA</span>
        <strong>${gpa === null ? "—" : escapeHTML(formatNumber(gpa))}</strong>
      </div>

      <div class="detail-metric">
        <span>Percentage</span>
        <strong>
          ${percentage === null
            ? "—"
            : `${escapeHTML(formatNumber(percentage))}%`}
        </strong>
      </div>

      <div class="detail-metric">
        <span>Subjects</span>
        <strong>${subjects.length}</strong>
      </div>
    </div>

    <p class="detail-muted">
      Saved on ${escapeHTML(formatDateTime(report.time))}
    </p>

    <h3 class="detail-section-title">Subject breakdown</h3>

    <div id="detailSubjects"></div>
  `;

  const subjectContainer = content.querySelector("#detailSubjects");

  if (!subjects.length) {
    subjectContainer.innerHTML = `
      <p class="detail-muted">
        No subject breakdown was saved with this calculation.
      </p>
    `;
  } else {
    subjectContainer.innerHTML = subjects.map((subject) => {
      const name = subject.name || "Unnamed subject";
      const score = subject.score ?? "—";
      const grade = subject.grade || "—";

      return `
        <div class="detail-subject">
          <span>${escapeHTML(name)}</span>
          <span class="detail-muted">
            Score: ${escapeHTML(score)}
          </span>
          <strong>${escapeHTML(grade)}</strong>
        </div>
      `;
    }).join("");
  }

  detailModal.hidden = false;
  $("closeModalBtn").focus();
}

function closeReportDetails() {
  detailModal.hidden = true;
}

$("closeModalBtn").addEventListener("click", closeReportDetails);

detailModal.addEventListener("click", (event) => {
  if (event.target === detailModal) {
    closeReportDetails();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeReportDetails();
  }
});

// --------------------------------------------------
// CSV EXPORT
// --------------------------------------------------

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

$("exportBtn").addEventListener("click", () => {
  if (!currentReports.length) {
    showNotice("There are no reports to export.", true);
    return;
  }

  const rows = [
    [
      "Calculation Date",
      "GPA",
      "Percentage",
      "Subject Count",
      "Subject Details"
    ]
  ];

  for (const report of currentReports) {
    const subjects = getSubjects(report);

    const subjectDetails = subjects.map((subject) => {
      return [
        subject.name || "Unnamed subject",
        `Score: ${subject.score ?? "—"}`,
        `Grade: ${subject.grade || "—"}`
      ].join(" | ");
    }).join("; ");

    rows.push([
      formatDateTime(report.time),
      getGpa(report) ?? "",
      getPercentage(report) ?? "",
      subjects.length,
      subjectDetails
    ]);
  }

  const csvContent = "\uFEFF" + rows
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");

  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `GradeFlow-Reports-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
  hideNotice();
});

// --------------------------------------------------
// PRINT / SAVE AS PDF
// --------------------------------------------------

$("printBtn").addEventListener("click", () => {
  if (!currentReports.length) {
    showNotice("There are no reports to print.", true);
    return;
  }

  window.print();
});

// --------------------------------------------------
// MOBILE NAVIGATION
// --------------------------------------------------

$("menuBtn").addEventListener("click", () => {
  $("sidebar").classList.toggle("open");
});

document.addEventListener("click", (event) => {
  const sidebar = $("sidebar");
  const menuButton = $("menuBtn");

  if (
    window.innerWidth <= 760 &&
    sidebar.classList.contains("open") &&
    !sidebar.contains(event.target) &&
    !menuButton.contains(event.target)
  ) {
    sidebar.classList.remove("open");
  }
});

// --------------------------------------------------
// SIGN OUT
// --------------------------------------------------

$("signOutBtn").addEventListener("click", async () => {
  try {
    if (unsubscribeHistory) {
      unsubscribeHistory();
      unsubscribeHistory = null;
    }

    await signOut(auth);
    window.location.href = "../login.html";
  } catch (error) {
    console.error("Sign out failed:", error);
    showNotice("Unable to sign out. Please try again.", true);
  }
});
