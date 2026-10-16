
/* ==========================================
   GradeFlow — Dashboard Controller
   File: js/dashboard.js
   ========================================== */

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
    limit,
    onSnapshot,
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ------------------------------------------
// DOM helpers
// ------------------------------------------

const $ = selector => document.querySelector(selector);

function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
}

function formatNumber(value, decimals = 2) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(decimals) : "—";
}

function getDate(value) {
    if (!value) return null;

    if (typeof value.toDate === "function") {
        return value.toDate();
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
    const date = getDate(value);
    if (!date) return "Date unavailable";

    return date.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function getInitials(name) {
    return String(name || "Student")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part.charAt(0).toUpperCase())
        .join("") || "S";
}

function showMessage(container, message) {
    if (!container) return;

    container.replaceChildren();

    const paragraph = document.createElement("p");
    paragraph.className = "empty-state-message";
    paragraph.textContent = message;

    container.appendChild(paragraph);
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function getTimestamp(value) {
    return getDate(value)?.getTime() || 0;
}

function getRecordGpa(record) {
    const value = Number(record?.gpa);
    return record?.gpa !== "" && record?.gpa != null &&
        Number.isFinite(value) ? value : null;
}

function getRecordPercentage(record) {
    const value = Number(record?.percentage);

    return record?.percentage !== "" &&
        record?.percentage != null &&
        Number.isFinite(value)
        ? value
        : null;
}

// ------------------------------------------
// Shared dashboard state
// ------------------------------------------

let currentUser = null;
let historyRecords = [];
let goalRecords = [];

let stopHistoryListener = null;
let stopGoalsListener = null;

// ------------------------------------------
// Profile
// ------------------------------------------

async function loadProfile(user) {
    let profile = {};

    try {
        const profileRef = doc(db, "users", user.uid);
        const profileSnapshot = await getDoc(profileRef);

        if (profileSnapshot.exists()) {
            profile = profileSnapshot.data();
        }
    } catch (error) {
        console.error("Could not load GradeFlow profile:", error);
    }

    // Do not update the dashboard for a different account.
    if (!currentUser || currentUser.uid !== user.uid) return;

    const displayName =
        profile.name ||
        profile.fullName ||
        user.displayName ||
        user.email?.split("@")[0] ||
        "Student";

    setText("#welcomeName", displayName);
    setText("#sidebarUserName", displayName);
    setText("#headerUserName", displayName);
    setText("#sidebarUserRole", "Student");

    setText("#sidebarAvatar", getInitials(displayName));
    setText("#headerAvatar", getInitials(displayName));

    const today = $("#todayLabel");

    if (today) {
        today.textContent = new Date().toLocaleDateString(
            undefined,
            {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric"
            }
        );
    }
}

// ------------------------------------------
// History listener
// ------------------------------------------

function loadHistory(user) {
    const historyContainer = $("#recentCalculations");

    showMessage(historyContainer, "Loading your calculations…");

    const historyQuery = query(
        collection(db, "history"),
        where("uid", "==", user.uid),
        orderBy("time", "desc"),
        limit(50)
    );

    return onSnapshot(
        historyQuery,
        snapshot => {
            if (!currentUser || currentUser.uid !== user.uid) return;

            historyRecords = snapshot.docs.map(historyDoc => ({
                id: historyDoc.id,
                ...historyDoc.data()
            }));

            historyRecords.sort(
                (a, b) => getTimestamp(b.time) - getTimestamp(a.time)
            );

            renderDashboardMetrics(historyRecords);
            renderRecentCalculations(historyRecords);
            renderPerformanceChart(historyRecords);

            // Refresh goal progress when a new calculation is saved.
            renderCurrentGoals(goalRecords, historyRecords);
        },
        error => {
            console.error("GradeFlow history listener error:", error);

            if (error.code === "permission-denied") {
                showMessage(
                    historyContainer,
                    "Cannot read your calculations. Check your Firestore security rules."
                );
            } else if (error.code === "failed-precondition") {
                showMessage(
                    historyContainer,
                    "A Firestore index is required. Check the browser console."
                );
            } else {
                showMessage(
                    historyContainer,
                    "Could not load calculations. Check your connection and try again."
                );
            }
        }
    );
}

// ------------------------------------------
// Dashboard metrics
// ------------------------------------------

function renderDashboardMetrics(calculations) {
    const latest = calculations[0] || null;

    setText(
        "#subjectsTrackedNote",
        `${calculations.length} saved calculation${calculations.length === 1 ? "" : "s"}`
    );

    // Count distinct subject names in saved calculations.
    const uniqueSubjects = new Set();

    calculations.forEach(calculation => {
        if (!Array.isArray(calculation.subjects)) return;

        calculation.subjects.forEach(subject => {
            const name = String(subject?.name || "").trim();

            if (name) uniqueSubjects.add(name.toLowerCase());
        });
    });

    setText("#subjectsTracked", String(uniqueSubjects.size));

    if (latest) {
        const gpa = getRecordGpa(latest);
        const percentage = getRecordPercentage(latest);

        setText(
            "#currentGpa",
            gpa === null ? "—" : formatNumber(gpa)
        );

        setText(
            "#currentGpaNote",
            `Latest calculation · ${formatDate(latest.time)}`
        );

        setText(
            "#overallAverage",
            percentage === null
                ? "—"
                : `${formatNumber(percentage, 1)}%`
        );

        setText(
            "#overallAverageNote",
            "From your latest calculation"
        );
    } else {
        setText("#currentGpa", "—");
        setText("#currentGpaNote", "No calculations saved yet");
        setText("#overallAverage", "—");
        setText("#overallAverageNote", "Calculate your grades to begin");
    }

    // Goals are updated by their own live Firestore listener.
    // Do not reset the goals count here.

    setText("#notificationCount", "0");

    const notificationDot = $("#notificationDot");
    if (notificationDot) notificationDot.hidden = true;
}

// ------------------------------------------
// Recent calculations
// ------------------------------------------

function renderRecentCalculations(calculations) {
    const container = $("#recentCalculations");
    if (!container) return;

    container.replaceChildren();

    if (!calculations.length) {
        showMessage(
            container,
            "No saved calculations yet. Use the calculator to create your first result."
        );
        return;
    }

    calculations.slice(0, 6).forEach(calculation => {
        const item = document.createElement("article");
        item.className = "activity-item";

        const subjects = Array.isArray(calculation.subjects)
            ? calculation.subjects
            : [];

        const subjectNames = subjects
            .map(subject => String(subject?.name || "").trim())
            .filter(Boolean);

        const title = document.createElement("h3");
        title.textContent = subjectNames.length
            ? subjectNames.slice(0, 3).join(", ") +
                (subjectNames.length > 3 ? "…" : "")
            : "Grade calculation";

        const details = document.createElement("p");
        details.textContent =
            `${subjectNames.length} subject${subjectNames.length === 1 ? "" : "s"} · ` +
            formatDate(calculation.time);

        const result = document.createElement("p");
        const gpa = getRecordGpa(calculation);
        const percentage = getRecordPercentage(calculation);

        result.textContent =
            `${gpa === null ? "GPA unavailable" : `GPA ${formatNumber(gpa)}`} · ` +
            `${percentage === null ? "Percentage unavailable" : `${formatNumber(percentage, 1)}%`}`;

        item.append(title, details, result);

        if (subjects.length) {
            const subjectList = document.createElement("ul");
            subjectList.className = "activity-subjects";

            subjects.forEach(subject => {
                const row = document.createElement("li");

                row.textContent =
                    `${subject.name || "Subject"} — ` +
                    `Score: ${subject.score ?? "—"} — ` +
                    `Grade: ${subject.grade || "—"}`;

                subjectList.appendChild(row);
            });

            item.appendChild(subjectList);
        }

        container.appendChild(item);
    });
}

// ------------------------------------------
// Performance chart
// ------------------------------------------

function renderPerformanceChart(calculations) {
    const container = $("#performanceChart");
    if (!container) return;

    container.replaceChildren();

    const chartData = calculations
        .filter(item => getRecordPercentage(item) !== null)
        .slice(0, 10)
        .reverse();

    if (chartData.length < 2) {
        showMessage(
            container,
            chartData.length === 1
                ? "Your performance chart will appear after another calculation."
                : "Your performance chart will appear after you save calculations."
        );
        return;
    }

    const width = 640;
    const height = 220;
    const padding = 28;

    const values = chartData.map(item =>
        Math.max(0, Math.min(100, getRecordPercentage(item)))
    );

    const points = values.map((value, index) => ({
        x: padding +
            (index / (values.length - 1)) * (width - padding * 2),
        y: height - padding -
            (value / 100) * (height - padding * 2),
        value
    }));

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Recent calculation percentages");

    [0, 25, 50, 75, 100].forEach(value => {
        const y = height - padding -
            (value / 100) * (height - padding * 2);

        const line = document.createElementNS(svgNS, "line");

        line.setAttribute("x1", String(padding));
        line.setAttribute("x2", String(width - padding));
        line.setAttribute("y1", String(y));
        line.setAttribute("y2", String(y));
        line.setAttribute("stroke", "currentColor");
        line.setAttribute("opacity", "0.14");

        svg.appendChild(line);
    });

    const polyline = document.createElementNS(svgNS, "polyline");

    polyline.setAttribute(
        "points",
        points.map(point => `${point.x},${point.y}`).join(" ")
    );

    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", "#C6A76B");
    polyline.setAttribute("stroke-width", "3");
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");

    svg.appendChild(polyline);

    points.forEach(point => {
        const circle = document.createElementNS(svgNS, "circle");

        circle.setAttribute("cx", String(point.x));
        circle.setAttribute("cy", String(point.y));
        circle.setAttribute("r", "4");
        circle.setAttribute("fill", "#C6A76B");

        const title = document.createElementNS(svgNS, "title");
        title.textContent = `${formatNumber(point.value, 1)}%`;

        circle.appendChild(title);
        svg.appendChild(circle);
    });

    container.appendChild(svg);
}

// ------------------------------------------
// CURRENT GOALS — DASHBOARD
// ------------------------------------------

function renderCurrentGoals(goals = [], calculations = []) {
    const container = $("#goalPreviewList");

    const activeGoals = goals
        .filter(goal => {
            if (!goal || typeof goal !== "object") return false;

            return !(
                goal.completed === true ||
                goal.isCompleted === true ||
                goal.status === "completed"
            );
        })
        .sort((a, b) => {
            const dateA = getDate(a.deadline)?.getTime() ??
                Number.MAX_SAFE_INTEGER;
            const dateB = getDate(b.deadline)?.getTime() ??
                Number.MAX_SAFE_INTEGER;

            return dateA - dateB;
        });

    setText("#activeGoals", String(activeGoals.length));

    setText(
        "#activeGoalsNote",
        activeGoals.length
            ? "Goals you are currently working toward"
            : "Create a goal to start tracking your progress"
    );

    if (!container) return;

    container.replaceChildren();

    if (!activeGoals.length) {
        const empty = document.createElement("div");
        empty.className = "list-empty-state";

        const heading = document.createElement("strong");
        heading.textContent = "No current goals";

        const message = document.createElement("p");
        message.textContent =
            "Create a GPA or percentage goal to track your academic progress.";

        const link = document.createElement("a");
        link.className = "secondary-button";
        link.href = "pages/goals.html";
        link.textContent = "Create a goal →";

        empty.append(heading, message, link);
        container.appendChild(empty);
        return;
    }

    const latest = calculations[0] || null;

    activeGoals.slice(0, 4).forEach(goal => {
        const type = goal.type === "percentage" ? "percentage" : "gpa";
        const target = goal.target === "" || goal.target == null
            ? null
            : Number(goal.target);

        const validTarget = target !== null &&
            Number.isFinite(target) && target > 0;

        const current = latest
            ? (
                type === "percentage"
                    ? getRecordPercentage(latest)
                    : getRecordGpa(latest)
            )
            : null;

        const progress = validTarget && current !== null
            ? Math.max(0, Math.min(100, current / target * 100))
            : null;

        const card = document.createElement("article");
        card.className = "goal-preview-item";

        const top = document.createElement("div");
        top.className = "goal-preview-top";

        const heading = document.createElement("h3");
        heading.textContent = String(goal.title || goal.name || "Academic goal");

        const targetLabel = document.createElement("span");
        targetLabel.className = "goal-target";
        targetLabel.textContent = validTarget
            ? `Target: ${formatNumber(target)}${type === "percentage" ? "%" : " GPA"}`
            : "Target not set";

        top.append(heading, targetLabel);

        const currentLabel = document.createElement("p");
        currentLabel.className = "goal-preview-current";
        currentLabel.textContent = current === null
            ? "No result saved yet"
            : `Current: ${formatNumber(current)}${type === "percentage" ? "%" : " GPA"}`;

        card.append(top, currentLabel);

        if (progress !== null) {
            const track = document.createElement("div");
            track.className = "goal-preview-progress";
            track.setAttribute("role", "progressbar");
            track.setAttribute("aria-valuemin", "0");
            track.setAttribute("aria-valuemax", "100");
            track.setAttribute("aria-valuenow", String(Math.round(progress)));
            track.setAttribute("aria-label", `${heading.textContent} progress`);

            const fill = document.createElement("span");
            fill.className = "goal-preview-progress-fill";
            fill.style.width = `${progress}%`;

            track.appendChild(fill);

            const meta = document.createElement("div");
            meta.className = "goal-preview-meta";

            const progressLabel = document.createElement("span");
            progressLabel.textContent =
                `${formatNumber(progress, 0)}% of target`;

            const deadlineLabel = document.createElement("span");
            const deadline = getDate(goal.deadline);

            deadlineLabel.textContent = deadline
                ? `Due ${deadline.toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "numeric"
                })}`
                : "No deadline";

            meta.append(progressLabel, deadlineLabel);
            card.append(track, meta);
        } else {
            const meta = document.createElement("div");
            meta.className = "goal-preview-meta";

            const hint = document.createElement("span");
            hint.textContent = "Save a calculation to see progress.";

            const deadline = getDate(goal.deadline);
            const due = document.createElement("span");

            due.textContent = deadline
                ? `Due ${deadline.toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "numeric"
                })}`
                : "No deadline";

            meta.append(hint, due);
            card.appendChild(meta);
        }

        const link = document.createElement("a");
        link.className = "goal-preview-link";
        link.href = "pages/goals.html";
        link.textContent = "View goal details →";

        card.appendChild(link);
        container.appendChild(card);
    });

    if (activeGoals.length > 4) {
        const more = document.createElement("p");
        more.className = "goal-preview-more";
        more.textContent =
            `Showing 4 of ${activeGoals.length} active goals.`;

        container.appendChild(more);
    }
}

// ------------------------------------------
// Live Firestore goals listener
// ------------------------------------------

function loadGoals(user) {
    const container = $("#goalPreviewList");

    showMessage(container, "Loading your goals…");
    setText("#activeGoals", "…");
    setText("#activeGoalsNote", "Loading your saved goals");

    const goalsQuery = query(
        collection(db, "goals"),
        where("uid", "==", user.uid)
    );

    return onSnapshot(
        goalsQuery,
        snapshot => {
            if (!currentUser || currentUser.uid !== user.uid) return;

            goalRecords = snapshot.docs.map(goalDoc => ({
                id: goalDoc.id,
                ...goalDoc.data()
            }));

            renderCurrentGoals(goalRecords, historyRecords);
        },
        error => {
            console.error("GradeFlow goals listener error:", error);

            setText("#activeGoals", "—");
            setText("#activeGoalsNote", "Could not load your goals");

            showMessage(
                container,
                error.code === "permission-denied"
                    ? "Access denied. Check the Firestore security rules for your goals."
                    : "Goals could not be loaded. Check your connection and Firestore configuration."
            );
        }
    );
}

// ------------------------------------------
// Sidebar and mobile navigation
// ------------------------------------------

function setupNavigation() {
    const sidebar = $("#sidebar");
    const toggle = $("#menuToggle");
    const backdrop = $("#sidebarBackdrop");
    const moreButton = $("#mobileMoreButton");
    const moreMenu = $("#mobileMoreMenu");

    function closeSidebar() {
        sidebar?.classList.remove("open");
        backdrop?.classList.remove("visible");
    }

    toggle?.addEventListener("click", () => {
        sidebar?.classList.toggle("open");

        backdrop?.classList.toggle(
            "visible",
            sidebar?.classList.contains("open") || false
        );
    });

    backdrop?.addEventListener("click", closeSidebar);

    moreButton?.addEventListener("click", () => {
        if (moreMenu) moreMenu.hidden = !moreMenu.hidden;
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeSidebar();
            if (moreMenu) moreMenu.hidden = true;
        }
    });

    document.querySelectorAll(".nav-link").forEach(link => {
        link.addEventListener("click", closeSidebar);
    });

    $("#profileButton")?.addEventListener("click", () => {
        window.location.href = "pages/settings.html";
    });

    $("#accountSwitcher")?.addEventListener("click", () => {
        window.location.href = "pages/settings.html";
    });

    $("#logoutButton")?.addEventListener("click", async () => {
        try {
            await signOut(auth);
            window.location.href = "login.html";
        } catch (error) {
            console.error("Sign-out failed:", error);
            alert("Could not sign out. Please try again.");
        }
    });
}

// ------------------------------------------
// Authentication and startup
// ------------------------------------------

setupNavigation();

onAuthStateChanged(auth, async user => {
    // Stop listeners belonging to the previous account.
    if (stopHistoryListener) {
        stopHistoryListener();
        stopHistoryListener = null;
    }

    if (stopGoalsListener) {
        stopGoalsListener();
        stopGoalsListener = null;
    }

    currentUser = user;
    historyRecords = [];
    goalRecords = [];

    if (!user) {
        window.location.href = "login.html";
        return;
    }

    renderDashboardMetrics([]);
    renderCurrentGoals([], []);

    try {
        await loadProfile(user);

        // The account may have changed while the profile loaded.
        if (!currentUser || currentUser.uid !== user.uid) return;

        stopHistoryListener = loadHistory(user);
        stopGoalsListener = loadGoals(user);
    } catch (error) {
        console.error("GradeFlow dashboard error:", error);

        showMessage(
            $("#recentCalculations"),
            "Your dashboard could not load. Check your connection and try again."
        );
    }
});
