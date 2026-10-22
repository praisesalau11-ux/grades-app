
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

    return record?.gpa !== "" &&
        record?.gpa != null &&
        Number.isFinite(value)
        ? value
        : null;
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
let stopNotificationsListener = null;

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

    const uniqueSubjects = new Set();

    calculations.forEach(calculation => {
        if (!Array.isArray(calculation.subjects)) return;

        calculation.subjects.forEach(subject => {
            const name = String(subject?.name || "").trim();

            if (name) {
                uniqueSubjects.add(name.toLowerCase());
            }
        });
    });

    setText("#subjectsTracked", String(uniqueSubjects.size));

    if (!latest) {
        setText("#currentGpa", "—");
        setText("#currentGpaNote", "No calculations saved yet");

        setText("#overallAverage", "—");
        setText("#overallAverageNote", "Calculate your grades to begin");

        setText(
            "#performanceTrendSummary",
            "Save more calculations to compare your results over time."
        );

        return;
    }

    const latestGpa = getRecordGpa(latest);

    const percentages = calculations
        .map(getRecordPercentage)
        .filter(value =>
            value !== null &&
            value >= 0 &&
            value <= 100
        );

    const overallAverage = percentages.length
        ? percentages.reduce((sum, value) => sum + value, 0) /
            percentages.length
        : null;

    setText(
        "#currentGpa",
        latestGpa === null ? "—" : formatNumber(latestGpa)
    );

    let gpaNote = `Latest calculation · ${formatDate(latest.time)}`;

    const previousWithGpa = calculations
        .slice(1)
        .find(record => getRecordGpa(record) !== null);

    if (latestGpa !== null && previousWithGpa) {
        const difference = latestGpa - getRecordGpa(previousWithGpa);
        const roundedDifference = Math.abs(difference).toFixed(2);

        if (difference > 0.004) {
            gpaNote += ` · Up ${roundedDifference} from previous result`;
        } else if (difference < -0.004) {
            gpaNote += ` · Down ${roundedDifference} from previous result`;
        } else {
            gpaNote += " · Unchanged from previous result";
        }
    }

    setText("#currentGpaNote", gpaNote);

    setText(
        "#overallAverage",
        overallAverage === null
            ? "—"
            : `${formatNumber(overallAverage, 1)}%`
    );

    setText(
        "#overallAverageNote",
        overallAverage === null
            ? "No percentage results available yet"
            : `Average across ${percentages.length} saved result${percentages.length === 1 ? "" : "s"}`
    );

    const latestPercentage = getRecordPercentage(latest);

    const previousWithPercentage = calculations
        .slice(1)
        .find(record => getRecordPercentage(record) !== null);

    let trendText =
        `${percentages.length} percentage result${percentages.length === 1 ? "" : "s"} included in your overall average.`;

    if (latestPercentage !== null && previousWithPercentage) {
        const previousPercentage =
            getRecordPercentage(previousWithPercentage);

        const difference = latestPercentage - previousPercentage;

        if (difference > 0.049) {
            trendText =
                `Your latest percentage is up ${difference.toFixed(1)} points from the previous result.`;
        } else if (difference < -0.049) {
            trendText =
                `Your latest percentage is down ${Math.abs(difference).toFixed(1)} points from the previous result.`;
        } else {
            trendText =
                "Your latest percentage is nearly unchanged from the previous result.";
        }
    } else if (latestPercentage !== null) {
        trendText =
            "Save another calculation to compare your percentage trend.";
    }

    setText("#performanceTrendSummary", trendText);
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

            subjects.slice(0, 4).forEach(subject => {
                const listItem = document.createElement("li");

                listItem.textContent = String(
                    subject?.name || "Subject"
                );

                subjectList.appendChild(listItem);
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
    const canvas = $("#performanceChart");

    if (!canvas) return;

    const context = canvas.getContext("2d");

    if (!context) return;

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(rect.width, 280);
    const height = Math.max(rect.height, 180);
    const pixelRatio = window.devicePixelRatio || 1;

    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    const points = calculations
        .slice()
        .reverse()
        .map(record => ({
            date: getDate(record.time),
            percentage: getRecordPercentage(record)
        }))
        .filter(point =>
            point.date instanceof Date &&
            point.percentage !== null
        )
        .slice(-8);

    if (!points.length) {
        context.fillStyle = getComputedStyle(canvas).color || "#777";
        context.font = "14px sans-serif";
        context.textAlign = "center";

        context.fillText(
            "Save calculations to see your progress",
            width / 2,
            height / 2
        );

        return;
    }

    const padding = {
        top: 20,
        right: 18,
        bottom: 30,
        left: 38
    };

    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const maxValue = Math.max(
        100,
        ...points.map(point => point.percentage)
    );

    const minValue = Math.min(
        0,
        ...points.map(point => point.percentage)
    );

    const range = Math.max(1, maxValue - minValue);

    context.font = "11px sans-serif";
    context.textAlign = "right";
    context.textBaseline = "middle";

    for (let i = 0; i <= 4; i++) {
        const value = maxValue - (range * i / 4);
        const y = padding.top + chartHeight * i / 4;

        context.strokeStyle = "rgba(128,128,128,0.2)";
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();

        context.fillStyle = getComputedStyle(canvas).color || "#777";

        context.fillText(
            `${Math.round(value)}%`,
            padding.left - 6,
            y
        );
    }

    const getX = index => points.length === 1
        ? padding.left + chartWidth / 2
        : padding.left +
            index * chartWidth / (points.length - 1);

    const getY = value =>
        padding.top +
        ((maxValue - value) / range) * chartHeight;

    context.strokeStyle = "#16a085";
    context.lineWidth = 2.5;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();

    points.forEach((point, index) => {
        const x = getX(index);
        const y = getY(point.percentage);

        if (index === 0) {
            context.moveTo(x, y);
        } else {
            context.lineTo(x, y);
        }
    });

    context.stroke();

    points.forEach((point, index) => {
        const x = getX(index);
        const y = getY(point.percentage);

        context.beginPath();
        context.arc(x, y, 4, 0, Math.PI * 2);
        context.fillStyle = "#16a085";
        context.fill();

        context.fillStyle = getComputedStyle(canvas).color || "#777";
        context.font = "10px sans-serif";
        context.textAlign = "center";
        context.textBaseline = "top";

        context.fillText(
            point.date.toLocaleDateString(undefined, {
                day: "numeric",
                month: "short"
            }),
            x,
            height - padding.bottom + 8
        );
    });
}

// ------------------------------------------
// Current goals
// ------------------------------------------

function renderCurrentGoals(goals, calculations) {
    const container = $("#goalPreviewList");

    if (!container) return;

    const activeGoals = goals.filter(goal =>
        goal.completed !== true &&
        goal.status !== "completed"
    );

    setText("#activeGoals", String(activeGoals.length));

    setText(
        "#activeGoalsNote",
        activeGoals.length === 1
            ? "Active academic goal"
            : "Active academic goals"
    );

    container.replaceChildren();

    if (!activeGoals.length) {
        showMessage(
            container,
            "No active goals yet. Create a goal to start tracking your progress."
        );

        return;
    }

    const latest = calculations[0] || null;

    activeGoals.slice(0, 4).forEach(goal => {
        const target = Number(goal.target);

        const type = goal.type === "percentage"
            ? "percentage"
            : "gpa";

        const validTarget =
            Number.isFinite(target) && target > 0;

        const current = latest
            ? (
                type === "percentage"
                    ? getRecordPercentage(latest)
                    : getRecordGpa(latest)
            )
            : null;

        const progress = validTarget && current !== null
            ? Math.max(
                0,
                Math.min(100, current / target * 100)
            )
            : null;

        const card = document.createElement("article");
        card.className = "goal-preview-item";

        const top = document.createElement("div");
        top.className = "goal-preview-top";

        const heading = document.createElement("h3");

        heading.textContent = String(
            goal.title || goal.name || "Academic goal"
        );

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
            track.setAttribute(
                "aria-valuenow",
                String(Math.round(progress))
            );
            track.setAttribute(
                "aria-label",
                `${heading.textContent} progress`
            );

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

            hint.textContent =
                "Save a calculation to see progress.";

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
// Live notification badge
// Path: users/{uid}/notifications/{notificationId}
// ------------------------------------------

function loadNotificationBadge(user) {
    const badge = $("#notificationCount");
    const dot = $("#notificationDot");

    if (!badge && !dot) return () => {};

    const notificationsRef = collection(
        db,
        "users",
        user.uid,
        "notifications"
    );

    const notificationsQuery = query(notificationsRef);

    return onSnapshot(
        notificationsQuery,
        snapshot => {
            if (!currentUser || currentUser.uid !== user.uid) return;

            const unread = snapshot.docs.reduce(
                (count, notificationDoc) => {
                    return count +
                        (notificationDoc.data().read === true ? 0 : 1);
                },
                0
            );

            if (badge) {
                badge.textContent =
                    unread > 99 ? "99+" : String(unread);

                badge.hidden = unread === 0;

                badge.setAttribute(
                    "aria-label",
                    `${unread} unread notifications`
                );
            }

            if (dot) {
                dot.hidden = unread === 0;

                dot.setAttribute(
                    "aria-label",
                    unread
                        ? "Unread notifications"
                        : "No unread notifications"
                );
            }
        },
        error => {
            console.error(
                "GradeFlow notification badge listener error:",
                error
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
        if (moreMenu) {
            moreMenu.hidden = !moreMenu.hidden;
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeSidebar();

            if (moreMenu) {
                moreMenu.hidden = true;
            }
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
    if (stopHistoryListener) {
        stopHistoryListener();
        stopHistoryListener = null;
    }

    if (stopGoalsListener) {
        stopGoalsListener();
        stopGoalsListener = null;
    }

    if (stopNotificationsListener) {
        stopNotificationsListener();
        stopNotificationsListener = null;
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

        if (!currentUser || currentUser.uid !== user.uid) return;

        stopHistoryListener = loadHistory(user);
        stopGoalsListener = loadGoals(user);
        stopNotificationsListener = loadNotificationBadge(user);
    } catch (error) {
        console.error("GradeFlow dashboard error:", error);

        showMessage(
            $("#recentCalculations"),
            "Your dashboard could not load. Check your connection and try again."
        );
    }
});
