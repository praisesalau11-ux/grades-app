
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

const $ = (selector) => document.querySelector(selector);

function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
}

function formatNumber(value, decimals = 2) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number.toFixed(decimals)
        : "—";
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

    const initials = getInitials(displayName);

    setText("#sidebarAvatar", initials);
    setText("#headerAvatar", initials);

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
// Load the existing top-level history
// ------------------------------------------


function loadHistory(user) {
    const historyContainer = $("#recentCalculations");

    if (historyContainer) {
        showMessage(historyContainer, "Loading your calculations…");
    }

    const historyQuery = query(
        collection(db, "history"),
        where("uid", "==", user.uid),
        orderBy("time", "desc"),
        limit(50)
    );

    return onSnapshot(
        historyQuery,
        snapshot => {
            const calculations = snapshot.docs.map(document => ({
                id: document.id,
                ...document.data()
            }));

            // Sort newest first, including timestamp values.
            calculations.sort((a, b) => {
                const dateA = getDate(a.time)?.getTime() || 0;
                const dateB = getDate(b.time)?.getTime() || 0;
                return dateB - dateA;
            });

            renderDashboardMetrics(calculations);
            renderRecentCalculations(calculations);
            renderPerformanceChart(calculations);
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
                    "A Firestore index is required. Check the browser console for the index link."
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
    const latest = calculations[0];

    // Total calculations saved in the retrieved history.
    setText(
        "#subjectsTrackedNote",
        `${calculations.length} saved calculation${calculations.length === 1 ? "" : "s"}`
    );

    /*
     * Count distinct subject names across the retrieved records.
     * This measures unique subject names, not official enrolments.
     */
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
        const gpa = Number(latest.gpa);
        const percentage = Number(latest.percentage);

        setText(
            "#currentGpa",
            Number.isFinite(gpa) ? formatNumber(gpa) : "—"
        );

        setText(
            "#currentGpaNote",
            `Latest calculation · ${formatDate(latest.time)}`
        );

        setText(
            "#overallAverage",
            Number.isFinite(percentage)
                ? `${formatNumber(percentage, 1)}%`
                : "—"
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

    // Goals are not loaded here because your confirmed
    // database structure does not yet include a goals collection.
    setText("#activeGoals", "—");
    setText("#activeGoalsNote", "Goals feature not connected yet");

    // Notification data has not been confirmed either.
    setText("#notificationCount", "0");

    const notificationDot = $("#notificationDot");

    if (notificationDot) {
        notificationDot.hidden = true;
    }
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

        const subjectNames = Array.isArray(calculation.subjects)
            ? calculation.subjects
                .map(subject => String(subject?.name || "").trim())
                .filter(Boolean)
            : [];

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
        const gpa = Number(calculation.gpa);
        const percentage = Number(calculation.percentage);

        const gpaText = Number.isFinite(gpa)
            ? `GPA ${formatNumber(gpa)}`
            : "GPA unavailable";

        const percentageText = Number.isFinite(percentage)
            ? `${formatNumber(percentage, 1)}%`
            : "Percentage unavailable";

        result.textContent = `${gpaText} · ${percentageText}`;

        item.append(title, details, result);


        if (Array.isArray(calculation.subjects)) {
            const subjectList = document.createElement("ul");
            subjectList.className = "activity-subjects";

            calculation.subjects.forEach(subject => {
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
        .filter(item => Number.isFinite(Number(item.percentage)))
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
        Math.max(0, Math.min(100, Number(item.percentage)))
    );

    const points = values.map((value, index) => {
        const x = padding +
            (index / (values.length - 1)) * (width - padding * 2);

        const y = height - padding -
            (value / 100) * (height - padding * 2);

        return { x, y, value };
    });

    const svgNS = "http://www.w3.org/2000/svg";

    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Recent calculation percentages");

    // Horizontal grid lines.
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
        if (!moreMenu) return;

        moreMenu.hidden = !moreMenu.hidden;
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


let stopHistoryListener = null;

setupNavigation();

onAuthStateChanged(auth, async user => {
    // Stop listening to the previous account, if any.
    if (stopHistoryListener) {
        stopHistoryListener();
        stopHistoryListener = null;
    }

    if (!user) {
        window.location.href = "login.html";
        return;
    }

    try {
        await loadProfile(user);

        // Live updates whenever this user's history changes.
        stopHistoryListener = loadHistory(user);
    } catch (error) {
        console.error("GradeFlow dashboard error:", error);

        showMessage(
            $("#recentCalculations"),
            "Your dashboard could not load. Check your connection and try again."
        );
    }
});
