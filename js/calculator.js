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
  serverTimestamp,
  query,
  where,
  onSnapshot,
  getDocs,
  deleteDoc,
  doc,
  getDoc,
  setDoc
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


const savedSubjectSelect = document.querySelector("#savedSubjectSelect");
const loadSavedSubjectButton = document.querySelector("#loadSavedSubject");
const saveSubjectsButton = document.querySelector("#saveSubjectsButton");
const deleteSavedSubjectButton = document.querySelector("#deleteSavedSubject");
const savedSubjectMessage = document.querySelector("#savedSubjectMessage");

let savedSubjectRecords = [];
let stopSavedSubjectsListener = null;

function showSavedSubjectMessage(message, type = "") {
    savedSubjectMessage.textContent = message;
    savedSubjectMessage.className =
        `saved-subject-message${type ? ` ${type}` : ""}`;
}

function renderSavedSubjectOptions() {
    savedSubjectSelect.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = savedSubjectRecords.length
        ? "Select a saved subject"
        : "No saved subjects yet";

    savedSubjectSelect.appendChild(placeholder);

    const sortedSubjects = [...savedSubjectRecords].sort((a, b) =>
        a.name.localeCompare(b.name)
    );

    sortedSubjects.forEach(subject => {
        const option = document.createElement("option");
        option.value = subject.id;
        option.textContent = subject.name;
        savedSubjectSelect.appendChild(option);
    });
}

function listenForSavedSubjects(user) {
    if (stopSavedSubjectsListener) {
        stopSavedSubjectsListener();
        stopSavedSubjectsListener = null;
    }

    savedSubjectRecords = [];
    renderSavedSubjectOptions();

    if (!user) {
        showSavedSubjectMessage("Sign in to manage your saved subjects.");
        return;
    }

    showSavedSubjectMessage("Loading your saved subjects…");

    const savedSubjectsQuery = query(
        collection(db, "savedSubjects"),
        where("uid", "==", user.uid)
    );

    stopSavedSubjectsListener = onSnapshot(
        savedSubjectsQuery,
        snapshot => {
            savedSubjectRecords = snapshot.docs.map(item => ({
                id: item.id,
                ...item.data()
            }));

            renderSavedSubjectOptions();

            showSavedSubjectMessage(
                `${savedSubjectRecords.length} saved subject${
                    savedSubjectRecords.length === 1 ? "" : "s"
                } available.`
            );
        },
        error => {
            console.error("Saved subjects error:", error);
            showSavedSubjectMessage(
                "Could not load saved subjects. Check your Firebase rules and connection.",
                "error"
            );
        }
    );
}

saveSubjectsButton.addEventListener("click", async () => {
    if (!currentUser) {
        showSavedSubjectMessage("Sign in before saving subjects.", "error");
        return;
    }

    const names = getSubjectInputs()
        .map(row => row.querySelector(".subject-name").value.trim())
        .filter(Boolean);

    if (!names.length) {
        showSavedSubjectMessage(
            "Enter at least one subject name before saving.",
            "error"
        );
        return;
    }

    const existingNames = new Set(
        savedSubjectRecords.map(subject =>
            subject.name.trim().toLowerCase()
        )
    );

    const uniqueNames = [...new Set(names)];
    const newNames = uniqueNames.filter(
        name => !existingNames.has(name.toLowerCase())
    );

    if (!newNames.length) {
        showSavedSubjectMessage(
            "Those subject names are already saved.",
            "success"
        );
        return;
    }

    saveSubjectsButton.disabled = true;
    showSavedSubjectMessage("Saving your subjects…");

    try {
        for (const name of newNames) {
            await addDoc(collection(db, "savedSubjects"), {
                uid: currentUser.uid,
                name,
                createdAt: serverTimestamp()
            });
        }

        showSavedSubjectMessage(
            `Saved ${newNames.length} subject${
                newNames.length === 1 ? "" : "s"
            } successfully.`,
            "success"
        );
    } catch (error) {
        console.error("Save subjects error:", error);
        showSavedSubjectMessage(
            "Could not save subjects. Check your Firestore rules and connection.",
            "error"
        );
    } finally {
        saveSubjectsButton.disabled = false;
    }
});

loadSavedSubjectButton.addEventListener("click", () => {
    const selectedId = savedSubjectSelect.value;

    const subject = savedSubjectRecords.find(
        item => item.id === selectedId
    );

    if (!subject) {
        showSavedSubjectMessage("Choose a saved subject first.", "error");
        return;
    }

    const existingRow = getSubjectInputs().find(row => {
        const name = row.querySelector(".subject-name").value.trim();
        const score = row.querySelector(".subject-score").value.trim();

        return !name && !score;
    });

    if (existingRow) {
        existingRow.querySelector(".subject-name").value = subject.name;
    } else {
        addSubjectRow(subject.name, "");
    }

    invalidateResults();
    showSavedSubjectMessage(
        `${subject.name} added to your calculator.`,
        "success"
    );
});

deleteSavedSubjectButton.addEventListener("click", async () => {
    if (!currentUser) {
        showSavedSubjectMessage("Sign in before deleting saved subjects.", "error");
        return;
    }

    const selectedId = savedSubjectSelect.value;

    const subject = savedSubjectRecords.find(
        item => item.id === selectedId
    );

    if (!subject) {
        showSavedSubjectMessage("Choose a saved subject to delete.", "error");
        return;
    }

    const confirmed = window.confirm(
        `Delete "${subject.name}" from your saved subjects? This will not delete your calculation history.`
    );

    if (!confirmed) return;

    deleteSavedSubjectButton.disabled = true;

    try {
        await deleteDoc(doc(db, "savedSubjects", subject.id));

        showSavedSubjectMessage(
            `${subject.name} deleted from saved subjects.`,
            "success"
        );
    } catch (error) {
        console.error("Delete saved subject error:", error);
        showSavedSubjectMessage(
            "Could not delete that subject. Check your Firestore rules.",
            "error"
        );
    } finally {
        deleteSavedSubjectButton.disabled = false;
    }
});

// ------------------------------------------
// Grading scale
// ------------------------------------------


const DEFAULT_GRADING_SETTINGS = {
    scale: "5",

    boundaries: {
        A: 70,
        B: 60,
        C: 50,
        D: 45,
        E: 40
    },

    points: {
        "5": { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 },
        "4": { A: 4, B: 3, C: 2, D: 1, E: 0, F: 0 }
    }
};

let gradingSettings = structuredClone(DEFAULT_GRADING_SETTINGS);

const gradingScaleSelect = document.querySelector("#gpaScale");
const gradingSettingsMessage = document.querySelector("#gradingSettingsMessage");

const saveGradingSettingsButton =
    document.querySelector("#saveGradingSettings");

const resetGradingSettingsButton =
    document.querySelector("#resetGradingSettings");

function getGrade(score) {
    const boundaries = gradingSettings.boundaries;

    if (score >= boundaries.A) return "A";
    if (score >= boundaries.B) return "B";
    if (score >= boundaries.C) return "C";
    if (score >= boundaries.D) return "D";
    if (score >= boundaries.E) return "E";

    return "F";
}

function getCurrentGradePoints() {
    return gradingSettings.points[gradingSettings.scale];
}

function readGradingSettingsFromForm() {
    const boundaries = {
        A: Number(document.querySelector("#boundaryA").value),
        B: Number(document.querySelector("#boundaryB").value),
        C: Number(document.querySelector("#boundaryC").value),
        D: Number(document.querySelector("#boundaryD").value),
        E: Number(document.querySelector("#boundaryE").value)
    };

    const points = {
        A: Number(document.querySelector("#pointsA").value),
        B: Number(document.querySelector("#pointsB").value),
        C: Number(document.querySelector("#pointsC").value),
        D: Number(document.querySelector("#pointsD").value),
        E: Number(document.querySelector("#pointsE").value),
        F: Number(document.querySelector("#pointsF").value)
    };

    const maxPoints = Number(gradingSettings.scale);

    const boundaryValues = Object.values(boundaries);
    const pointValues = Object.values(points);

    if (boundaryValues.some(value =>
        !Number.isFinite(value) || value < 0 || value > 100
    )) {
        throw new Error("Grade boundaries must be between 0 and 100.");
    }

    if (
        !(boundaries.A > boundaries.B &&
          boundaries.B > boundaries.C &&
          boundaries.C > boundaries.D &&
          boundaries.D > boundaries.E)
    ) {
        throw new Error(
            "Boundaries must descend from A to E. Each boundary must be lower than the previous one."
        );
    }

    if (pointValues.some(value =>
        !Number.isFinite(value) || value < 0 || value > maxPoints
    )) {
        throw new Error(
            `Grade points must be between 0 and ${maxPoints} for the selected GPA scale.`
        );
    }

    return { boundaries, points };
}

function renderGradingSettings() {
    gradingScaleSelect.value = gradingSettings.scale;

    for (const grade of ["A", "B", "C", "D", "E"]) {
        document.querySelector(`#boundary${grade}`).value =
            gradingSettings.boundaries[grade];
    }

    const maxPoints = Number(gradingSettings.scale);
    const currentPoints = gradingSettings.points[gradingSettings.scale];

    for (const grade of ["A", "B", "C", "D", "E", "F"]) {
        const input = document.querySelector(`#points${grade}`);
        input.max = String(maxPoints);
        input.value = currentPoints[grade];
    }
}

function showGradingSettingsMessage(message, state = "") {
    gradingSettingsMessage.textContent = message;
    gradingSettingsMessage.className =
        `save-message${state ? ` ${state}` : ""}`;
}

async function loadGradingSettings(user) {
    if (!user) {
        gradingSettings = structuredClone(DEFAULT_GRADING_SETTINGS);
        renderGradingSettings();

        showGradingSettingsMessage(
            "Sign in to save grading settings to your account."
        );
        return;
    }

    try {
        const settingsRef = doc(db, "gradingSettings", user.uid);
        const settingsSnapshot = await getDoc(settingsRef);

        if (settingsSnapshot.exists()) {
            const saved = settingsSnapshot.data();

            // Merge with defaults so older or partial settings remain usable.
            gradingSettings = {
                scale: saved.scale === "4" ? "4" : "5",

                boundaries: {
                    ...DEFAULT_GRADING_SETTINGS.boundaries,
                    ...(saved.boundaries || {})
                },

                points: {
                    "5": {
                        ...DEFAULT_GRADING_SETTINGS.points["5"],
                        ...(saved.points?.["5"] || {})
                    },
                    "4": {
                        ...DEFAULT_GRADING_SETTINGS.points["4"],
                        ...(saved.points?.["4"] || {})
                    }
                }
            };
        } else {
            gradingSettings = structuredClone(DEFAULT_GRADING_SETTINGS);
        }

        renderGradingSettings();

        showGradingSettingsMessage(
            "Your account grading settings are loaded."
        );
    } catch (error) {
        console.error("Could not load GradeFlow grading settings:", error);

        showGradingSettingsMessage(
            "Could not load your saved settings. Check your connection and Firestore rules.",
            "error"
        );
    }
}

async function saveGradingSettings() {
    if (!currentUser) {
        showGradingSettingsMessage(
            "Sign in before saving grading settings.",
            "error"
        );
        return;
    }

    try {
        const formSettings = readGradingSettingsFromForm();

        gradingSettings.boundaries = formSettings.boundaries;
        gradingSettings.points[gradingSettings.scale] =
            formSettings.points;

        await setDoc(
            doc(db, "gradingSettings", currentUser.uid),
            {
                scale: gradingSettings.scale,
                boundaries: gradingSettings.boundaries,
                points: gradingSettings.points,
                updatedAt: serverTimestamp()
            }
        );

        showGradingSettingsMessage(
            "Grading settings saved to your Firebase account.",
            "success"
        );

        // Existing subject grades may have changed because boundaries changed.
        refreshSubjectGrades();
        invalidateResults();
    } catch (error) {
        console.error("Could not save grading settings:", error);

        showGradingSettingsMessage(
            error.message || "Could not save grading settings.",
            "error"
        );
    }
}

function refreshSubjectGrades() {
    document.querySelectorAll(".subject-row").forEach(row => {
        const scoreInput = row.querySelector(".subject-score");
        const gradeDisplay = row.querySelector(".subject-grade");

        if (!scoreInput || !gradeDisplay || scoreInput.value.trim() === "") {
            if (gradeDisplay) gradeDisplay.textContent = "—";
            return;
        }

        const score = Number(scoreInput.value);

        gradeDisplay.textContent =
            Number.isFinite(score) && score >= 0 && score <= 100
                ? getGrade(score)
                : "—";
    });
}

gradingScaleSelect.addEventListener("change", () => {
    gradingSettings.scale = gradingScaleSelect.value === "4" ? "4" : "5";

    renderGradingSettings();

    showGradingSettingsMessage(
        "Scale changed. Save your settings to keep this choice on your account."
    );

    refreshSubjectGrades();
    invalidateResults();
});

saveGradingSettingsButton.addEventListener(
    "click",
    saveGradingSettings
);

resetGradingSettingsButton.addEventListener("click", () => {
    gradingSettings = structuredClone(DEFAULT_GRADING_SETTINGS);
    renderGradingSettings();

    refreshSubjectGrades();
    invalidateResults();

    showGradingSettingsMessage(
        "Defaults restored in this form. Select Save grading settings to store them in your account."
    );
});


// ------------------------------------------
// Subject rows
// ------------------------------------------

function updateSubjectCount() {
    const count = subjectRows.querySelectorAll(".subject-row").length;

    document.querySelector("#subjectCount").textContent =
        `${count} subject${count === 1 ? "" : "s"}`;
}


function addSubjectRow(name = "", score = "", credits = "3") {
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

    const creditInput = document.createElement("input");
    creditInput.type = "number";
    creditInput.className = "subject-credits";
    creditInput.min = "1";
    creditInput.max = "30";
    creditInput.step = "1";
    creditInput.value = credits;
    creditInput.setAttribute("aria-label", "Course credit units");
    creditInput.title = "Course credit units (1–30)";

    const gradeDisplay = document.createElement("span");
    gradeDisplay.className = "subject-grade";
    gradeDisplay.textContent = score !== "" &&
        Number.isFinite(Number(score)) &&
        Number(score) >= 0 &&
        Number(score) <= 100
        ? getGrade(Number(score))
        : "—";
    gradeDisplay.setAttribute("aria-label", "Grade");

    function updateGrade() {
        const value = scoreInput.value.trim();
        const numericScore = Number(value);

        gradeDisplay.textContent =
            value !== "" &&
            Number.isFinite(numericScore) &&
            numericScore >= 0 &&
            numericScore <= 100
                ? getGrade(numericScore)
                : "—";

        invalidateResults();
    }

    scoreInput.addEventListener("input", updateGrade);
    nameInput.addEventListener("input", invalidateResults);
    creditInput.addEventListener("input", invalidateResults);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-subject";
    removeButton.textContent = "×";
    removeButton.title = "Remove subject";
    removeButton.setAttribute("aria-label", "Remove this subject");

    removeButton.addEventListener("click", () => {
        row.remove();
        updateSubjectCount();
        invalidateResults();
    });

    row.append(
        nameInput,
        scoreInput,
        creditInput,
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

        const name = row.querySelector(".subject-name").value.trim();
        const scoreText = row.querySelector(".subject-score").value.trim();
        const creditsText = row.querySelector(".subject-credits").value.trim();

        if (!name) {
            throw new Error(`Enter a name for subject ${index + 1}.`);
        }

        if (scoreText === "") {
            throw new Error(`Enter a score for ${name}.`);
        }

        const score = Number(scoreText);

        if (!Number.isFinite(score) || score < 0 || score > 100) {
            throw new Error(`${name}: score must be between 0 and 100.`);
        }

        if (creditsText === "") {
            throw new Error(`Enter credit units for ${name}.`);
        }

        const credits = Number(creditsText);

        if (!Number.isInteger(credits) || credits < 1 || credits > 30) {
            throw new Error(`${name}: credits must be a whole number from 1 to 30.`);
        }

        subjects.push({
            name,
            score,
            grade: getGrade(score),
            credits
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
    const gradePoints = getCurrentGradePoints();

    const totalCredits = subjects.reduce(
        (sum, subject) => sum + Number(subject.credits),
        0
    );

    if (totalCredits <= 0) {
        throw new Error("Total credits must be greater than zero.");
    }

    const weightedPoints = subjects.reduce(
        (sum, subject) =>
            sum + gradePoints[subject.grade] * Number(subject.credits),
        0
    );

    const gpa = weightedPoints / totalCredits;

    return {
        subjects,
        total,
        percentage,
        gpa,
        totalCredits,
        gpaScale: gradingSettings.scale
    };
}

// ------------------------------------------
// Display results
// ------------------------------------------

function renderResults(results) {
    document.querySelector("#averageResult").textContent =
        results.percentage.toFixed(2);

  
document.querySelector("#gpaResult").textContent =
    `${results.gpa.toFixed(2)} / ${results.gpaScale || gradingSettings.scale}`;

    document.querySelector("#totalResult").textContent =
        Number.isInteger(results.total)
            ? String(results.total)
            : results.total.toFixed(2);

    
document.querySelector("#totalCaption").textContent =
    `${results.subjects.length} subjects · ${results.totalCredits} credits`;

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
    grade: subject.grade,
    credits: subject.credits
})),

totalCredits: results.totalCredits,


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
    
loadGradingSettings(user);

    currentUser = user;
    listenForSavedSubjects(user);

    // Keep the rest of your existing authentication callback here.


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