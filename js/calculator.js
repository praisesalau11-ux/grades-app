/* ==========================================
   GradeFlow — Calculator
   File: js/calculator.js
   ========================================== */

import { auth, db } from "./firebase.js";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
    collection,
    addDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ------------------------------------------
// Elements and state
// ------------------------------------------

const form = document.querySelector("#calculatorForm");
const subjectRows = document.querySelector("#subjectRows");
const addSubjectButton = document.querySelector("#addSubject");
const resetButton = document.querySelector("#resetButton");
const saveButton = document.querySelector("#saveButton");
const formError = document.querySelector("#formError");
const saveMessage = document.querySelector("#saveMessage");

let currentUser = null;
let latestResults = null;
let savedResultsKey = null;
let nextRowId = 1;

// ------------------------------------------
// Grading scale
// ------------------------------------------

function getGrade(score) {
    if (score >= 70) return "A";
    if (score >= 60) return "B";
    if (score >= 50) return "C";
    if (score >= 45) return "D";
    if (score >= 40) return "E";

    return "F";
}

// ------------------------------------------
// Subject rows
// ------------------------------------------

function updateSubjectCount() {
    const count = subjectRows.querySelectorAll(".subject-row").length;

    document.querySelector("#subjectCount").textContent =
        `${count} subject${count === 1 ? "" : "s"}`;
}

function addSubjectRow(name = "", score = "") {
    const row = document.createElement("div");
    row.className = "subject-row";
    row.dataset.rowId = String(nextRowId++);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "subject-name";
    nameInput.placeholder = "e.g. Mathematics";
    nameInput.setAttribute("aria-label", "Subject name");
    nameInput.maxLength = 100;
    nameInput.value = name;

    const scoreInput = document.createElement("input");
    scoreInput.type = "number";
    scoreInput.className = "subject-score";
    scoreInput.placeholder = "0–100";
    scoreInput.min = "0";
    scoreInput.max = "100";
    scoreInput.step = "any";
    scoreInput.inputMode = "decimal";
    scoreInput.setAttribute("aria-label", "Score out of 100");
    scoreInput.value = score;

    const gradeDisplay = document.createElement("span");
    gradeDisplay.className = "subject-grade";
    gradeDisplay.textContent = "—";
    gradeDisplay.setAttribute("aria-label", "Grade");

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-subject";
    removeButton.textContent = "×";
    removeButton.title = "Remove subject";
    removeButton.setAttribute("aria-label", "Remove this subject");

    scoreInput.addEventListener("input", () => {
        const value = scoreInput.value.trim();
        const numericScore = Number(value);

        if (
            value !== "" &&
            Number.isFinite(numericScore) &&
            numericScore >= 0 &&
            numericScore <= 100
        ) {
            gradeDisplay.textContent = getGrade(numericScore);
        } else {
            gradeDisplay.textContent = "—";
        }

        invalidateResults();
    });

    nameInput.addEventListener("input", invalidateResults);

    removeButton.addEventListener("click", () => {
        row.remove();
        updateSubjectCount();
        invalidateResults();
    });

    row.append(
        nameInput,
        scoreInput,
        gradeDisplay,
        removeButton
    );

    subjectRows.appendChild(row);
    updateSubjectCount();
}

function getSubjectInputs() {
    return [...subjectRows.querySelectorAll(".subject-row")];
}

// ------------------------------------------
// Read and validate form data
// ------------------------------------------

function readSubjects() {
    const rows = getSubjectInputs();
    const subjects = [];

    if (rows.length === 0) {
        throw new Error("Add at least one subject.");
    }

    for (let index = 0; index < rows.length; index++) {
        const row = rows[index];

        const name = row.querySelector(".subject-name")
            .value.trim();

        const scoreText = row.querySelector(".subject-score")
            .value.trim();

        if (!name) {
            throw new Error(
                `Enter a name for subject ${index + 1}.`
            );
        }

        if (scoreText === "") {
            throw new Error(
                `Enter a score for ${name}.`
            );
        }

        const score = Number(scoreText);

        if (
            !Number.isFinite(score) ||
            score < 0 ||
            score > 100
        ) {
            throw new Error(
                `${name}: the score must be between 0 and 100.`
            );
        }

        subjects.push({
            name,
            score,
            grade: getGrade(score)
        });
    }

    return subjects;
}

// ------------------------------------------
// Calculate results
// ------------------------------------------

function calculateResults(subjects) {
    const total = subjects.reduce(
        (sum, subject) => sum + subject.score,
        0
    );

    const percentage = total / subjects.length;

    /*
     * Compatibility with your existing history example:
     * GPA = percentage / 20 on an estimated 5-point scale.
     *
     * This is a percentage-based estimate, not a universal
     * university GPA formula.
     */

    const gpa = percentage / 20;

    return {
        subjects,
        total,
        percentage,
        gpa
    };
}

// ------------------------------------------
// Display results
// ------------------------------------------

function renderResults(results) {
    document.querySelector("#averageResult").textContent =
        results.percentage.toFixed(2);

    document.querySelector("#gpaResult").textContent =
        results.gpa.toFixed(2);

    document.querySelector("#totalResult").textContent =
        Number.isInteger(results.total)
            ? String(results.total)
            : results.total.toFixed(2);

    document.querySelector("#totalCaption").textContent =
        `Across ${results.subjects.length} subject${results.subjects.length === 1 ? "" : "s"}`;

    document.querySelector("#averageProgress").style.width =
        `${Math.max(0, Math.min(100, results.percentage))}%`;

    const gradeBreakdown = document.querySelector("#gradeBreakdown");
    gradeBreakdown.replaceChildren();

    const counts = {};

    results.subjects.forEach(subject => {
        counts[subject.grade] = (counts[subject.grade] || 0) + 1;
    });

    Object.entries(counts)
        .sort(([gradeA], [gradeB]) => gradeA.localeCompare(gradeB))
        .forEach(([grade, count]) => {
            const chip = document.createElement("span");
            chip.className = "grade-chip";

            const gradeLabel = document.createElement("strong");
            gradeLabel.textContent = grade;

            const countLabel = document.createElement("span");
            countLabel.textContent = `${count} subject${count === 1 ? "" : "s"}`;

            chip.append(gradeLabel, countLabel);
            gradeBreakdown.appendChild(chip);
        });

    document.querySelector("#resultStatus").textContent =
        "Calculated";

    saveButton.disabled = false;
    saveMessage.className = "save-message";
    saveMessage.textContent = currentUser
        ? "Your result is ready to save."
        : "Sign in to save your calculation.";
}

function showFormError(message) {
    formError.textContent = message;
    formError.hidden = false;
}

function clearFormError() {
    formError.textContent = "";
    formError.hidden = true;
}

function invalidateResults() {
    latestResults = null;
    savedResultsKey = null;
    saveButton.disabled = true;

    document.querySelector("#resultStatus").textContent =
        "Not calculated";

    saveMessage.className = "save-message";
    saveMessage.textContent =
        "Recalculate after changing your subjects or scores.";

    clearFormError();
}

// ------------------------------------------
// Save to the existing history collection
// ------------------------------------------

async function saveCalculation() {
    if (!currentUser) {
        saveMessage.className = "save-message error";
        saveMessage.textContent =
            "You must be signed in to save calculations.";
        return;
    }

    if (!latestResults) {
        saveMessage.className = "save-message error";
        saveMessage.textContent =
            "Calculate your results before saving.";
        return;
    }

    if (savedResultsKey) {
        saveMessage.className = "save-message success";
        saveMessage.textContent =
            "This calculation has already been saved.";
        return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "Saving…";

    saveMessage.className = "save-message";
    saveMessage.textContent = "Saving your calculation securely…";

    try {
        const results = latestResults;

        const documentData = {
            uid: currentUser.uid,

            // Preserve the structure used by existing history.
            gpa: results.gpa.toFixed(2),
            percentage: results.percentage,

            subjects: results.subjects.map(subject => ({
                name: subject.name,
                score: subject.score,
                grade: subject.grade
            })),

            time: serverTimestamp()
        };

        await addDoc(
            collection(db, "history"),
            documentData
        );

        savedResultsKey = JSON.stringify(documentData.subjects);

        saveMessage.className = "save-message success";
        saveMessage.textContent =
            "Calculation saved successfully to your history.";

        saveButton.textContent = "Saved";
    } catch (error) {
        console.error("GradeFlow save error:", error);

        saveMessage.className = "save-message error";

        if (error.code === "permission-denied") {
            saveMessage.textContent =
                "Permission denied. Check that your Firestore history rules are published and that you are signed in.";
        } else if (!navigator.onLine) {
            saveMessage.textContent =
                "You appear to be offline. Reconnect and try saving again.";
        } else {
            saveMessage.textContent =
                "Could not save the calculation. Check your connection and try again.";
        }

        saveButton.disabled = false;
        saveButton.textContent = "Retry saving";
    }
}

// ------------------------------------------
// Form events
// ------------------------------------------

addSubjectButton.addEventListener("click", () => {
    addSubjectRow();
    invalidateResults();

    const rows = getSubjectInputs();
    rows[rows.length - 1]?.querySelector(".subject-name")?.focus();
});

form.addEventListener("submit", event => {
    event.preventDefault();
    clearFormError();

    try {
        const subjects = readSubjects();

        latestResults = calculateResults(subjects);
        savedResultsKey = null;

        renderResults(latestResults);

        saveButton.textContent = "Save calculation";
        saveButton.disabled = !currentUser;

        if (!currentUser) {
            saveMessage.textContent =
                "Sign in to save this calculation.";
        }
    } catch (error) {
        showFormError(error.message);
    }
});

saveButton.addEventListener("click", saveCalculation);

resetButton.addEventListener("click", () => {
    const confirmed = window.confirm(
        "Clear all subjects and results from this calculator? Saved history will not be deleted."
    );

    if (!confirmed) return;

    subjectRows.replaceChildren();

    addSubjectRow();
    addSubjectRow();
    addSubjectRow();

    latestResults = null;
    savedResultsKey = null;

    document.querySelector("#averageResult").textContent = "—";
    document.querySelector("#gpaResult").textContent = "—";
    document.querySelector("#totalResult").textContent = "—";
    document.querySelector("#totalCaption").textContent =
        "Across all subjects";
    document.querySelector("#averageProgress").style.width = "0%";
    document.querySelector("#gradeBreakdown").innerHTML =
        '<p class="muted">Your grade breakdown will appear here.</p>';
    document.querySelector("#resultStatus").textContent =
        "Not calculated";

    saveButton.disabled = true;
    saveButton.textContent = "Save calculation";

    saveMessage.className = "save-message";
    saveMessage.textContent =
        "Calculate your results before saving.";

    clearFormError();
});

// ------------------------------------------
// Authentication
// ------------------------------------------

onAuthStateChanged(auth, user => {
    currentUser = user;

    if (!user) {
        saveButton.disabled = true;

        saveMessage.className = "save-message";
        saveMessage.textContent =
            "Sign in to GradeFlow to save your calculations.";

        return;
    }

    if (!latestResults) {
        saveMessage.className = "save-message";
        saveMessage.textContent =
            "Your calculations will be saved to your account.";
    }
});

// Start with three blank subject rows.
addSubjectRow();
addSubjectRow();
addSubjectRow();