
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ============================================
// GRADEFLOW SUBJECT MANAGEMENT
// ============================================

const elements = {
  subjectForm: document.getElementById("subjectForm"),
  subjectId: document.getElementById("subjectId"),
  subjectName: document.getElementById("subjectName"),
  courseCode: document.getElementById("courseCode"),
  creditUnits: document.getElementById("creditUnits"),
  semester: document.getElementById("semester"),
  score: document.getElementById("score"),

  formTitle: document.getElementById("formTitle"),
  formBadge: document.getElementById("formBadge"),
  saveSubjectButton: document.getElementById("saveSubjectButton"),
  cancelEditButton: document.getElementById("cancelEditButton"),
  addSubjectButton: document.getElementById("addSubjectButton"),
  emptyAddButton: document.getElementById("emptyAddButton"),

  subjectSearch: document.getElementById("subjectSearch"),
  semesterFilter: document.getElementById("semesterFilter"),
  subjectsTableBody: document.getElementById("subjectsTableBody"),

  totalSubjects: document.getElementById("totalSubjects"),
  totalCredits: document.getElementById("totalCredits"),
  averageScore: document.getElementById("averageScore"),
  estimatedGpa: document.getElementById("estimatedGpa"),

  resultCount: document.getElementById("resultCount"),
  emptyState: document.getElementById("emptyState"),
  emptyTitle: document.getElementById("emptyTitle"),
  emptyDescription: document.getElementById("emptyDescription"),
  pageMessage: document.getElementById("pageMessage"),

  userName: document.getElementById("userName"),
  userEmail: document.getElementById("userEmail"),
  userAvatar: document.getElementById("userAvatar"),
  signOutButton: document.getElementById("signOutButton"),

  sidebar: document.getElementById("sidebar"),
  sidebarBackdrop: document.getElementById("sidebarBackdrop"),
  menuToggle: document.getElementById("menuToggle"),
  todayLabel: document.getElementById("todayLabel")
};

let currentUser = null;
let subjects = [];
let unsubscribeSubjects = null;
let messageTimeout = null;
let isSaving = false;

// ============================================
// DATE LABEL
// ============================================

elements.todayLabel.textContent =
  new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date());

// ============================================
// SAFE TEXT HELPERS
// ============================================

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => {
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

function getInitials(name, email = "") {
  const cleanName = String(name || "").trim();

  if (cleanName) {
    return cleanName
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part[0])
      .join("")
      .toUpperCase();
  }

  return email ? email[0].toUpperCase() : "S";
}

function showMessage(message, type = "info") {
  clearTimeout(messageTimeout);

  elements.pageMessage.textContent = message;
  elements.pageMessage.className = `status-message ${type}`;
  elements.pageMessage.hidden = false;

  messageTimeout = setTimeout(() => {
    elements.pageMessage.hidden = true;
  }, 5000);
}

// ============================================
// SCORE AND GRADE HELPERS
// ============================================

function getScore(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0 || number > 100) {
    return null;
  }

  return number;
}

function getGrade(score) {
  if (score === null) return "—";
  if (score >= 70) return "A";
  if (score >= 60) return "B";
  if (score >= 50) return "C";
  if (score >= 45) return "D";
  if (score >= 40) return "E";

  return "F";
}

function formatNumber(number, decimalPlaces = 2) {
  return Number(number).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimalPlaces
  });
}

function getCreatedTime(subject) {
  const value = subject.createdAt;

  if (value && typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return 0;
}

// ============================================
// PROFILE DISPLAY
// ============================================

function updateUserDisplay(user) {
  const name =
    user.displayName ||
    user.email?.split("@")[0] ||
    "Student";

  elements.userName.textContent = name;
  elements.userEmail.textContent = user.email || "";
  elements.userAvatar.textContent = getInitials(name, user.email);
}

// ============================================
// SUBJECT FORM
// ============================================

function resetSubjectForm() {
  elements.subjectForm.reset();
  elements.subjectId.value = "";
  elements.creditUnits.value = "3";
  elements.semester.value = "First Semester";

  elements.formTitle.textContent = "Add a subject";
  elements.formBadge.textContent = "NEW ENTRY";
  elements.saveSubjectButton.textContent = "Save subject";
  elements.cancelEditButton.hidden = true;
}

function openSubjectForm() {
  document.getElementById("subjectFormSection").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  setTimeout(() => {
    elements.subjectName.focus({ preventScroll: true });
  }, 250);
}

function startEditing(subjectId) {
  const subject = subjects.find(item => item.id === subjectId);

  if (!subject) {
    showMessage("This subject could not be found. Refresh the page and try again.", "error");
    return;
  }

  elements.subjectId.value = subject.id;
  elements.subjectName.value = subject.name || "";
  elements.courseCode.value = subject.courseCode || "";
  elements.creditUnits.value = String(subject.creditUnits || 3);
  elements.semester.value = subject.semester || "First Semester";
  elements.score.value =
    subject.score === null || subject.score === undefined
      ? ""
      : String(subject.score);

  elements.formTitle.textContent = "Edit subject";
  elements.formBadge.textContent = "EDITING";
  elements.saveSubjectButton.textContent = "Update subject";
  elements.cancelEditButton.hidden = false;

  openSubjectForm();
}

function validateSubjectForm() {
  const name = elements.subjectName.value.trim();
  const courseCode = elements.courseCode.value.trim();
  const creditUnits = Number(elements.creditUnits.value);
  const semester = elements.semester.value;
  const rawScore = elements.score.value.trim();

  if (!name) {
    showMessage("Enter the subject name.", "error");
    elements.subjectName.focus();
    return null;
  }

  if (
    !Number.isInteger(creditUnits) ||
    creditUnits < 1 ||
    creditUnits > 30
  ) {
    showMessage("Credit units must be a whole number between 1 and 30.", "error");
    elements.creditUnits.focus();
    return null;
  }

  const validSemesters = [
    "First Semester",
    "Second Semester",
    "Third Semester",
    "Summer",
    "Other"
  ];

  if (!validSemesters.includes(semester)) {
    showMessage("Select a valid semester.", "error");
    elements.semester.focus();
    return null;
  }

  let score = null;

  if (rawScore !== "") {
    score = Number(rawScore);

    if (!Number.isFinite(score) || score < 0 || score > 100) {
      showMessage("Score must be between 0 and 100.", "error");
      elements.score.focus();
      return null;
    }
  }

  return {
    name,
    courseCode,
    creditUnits,
    semester,
    score,
    grade: getGrade(score)
  };
}

// ============================================
// SAVE OR UPDATE SUBJECT
// ============================================

elements.subjectForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser) {
    showMessage("Sign in before saving subjects.", "error");
    return;
  }

  if (isSaving) return;

  const subjectData = validateSubjectForm();

  if (!subjectData) return;

  isSaving = true;
  elements.saveSubjectButton.disabled = true;
  elements.saveSubjectButton.textContent = "Saving...";

  try {
    const subjectId = elements.subjectId.value.trim();

    if (subjectId) {
      const existingSubject = subjects.find(item => item.id === subjectId);

      if (!existingSubject) {
        throw new Error("Subject not found. Refresh and try again.");
      }

      await updateDoc(doc(db, "subjects", subjectId), {
        ...subjectData,
        updatedAt: serverTimestamp()
      });

      showMessage("Subject updated successfully.", "success");
    } else {
      await addDoc(collection(db, "subjects"), {
        ...subjectData,
        uid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      showMessage("Subject saved successfully.", "success");
    }

    resetSubjectForm();
  } catch (error) {
    console.error("GradeFlow subject save error:", error);

    showMessage(
      error.code === "permission-denied"
        ? "Firebase denied this action. Check your Firestore subjects rules."
        : "Could not save the subject. Check your connection and try again.",
      "error"
    );
  } finally {
    isSaving = false;
    elements.saveSubjectButton.disabled = false;

    if (elements.subjectId.value) {
      elements.saveSubjectButton.textContent = "Update subject";
    } else {
      elements.saveSubjectButton.textContent = "Save subject";
    }
  }
});

// ============================================
// DELETE SUBJECT
// ============================================

async function deleteSubject(subjectId) {
  if (!currentUser) {
    showMessage("Sign in before deleting subjects.", "error");
    return;
  }

  const subject = subjects.find(item => item.id === subjectId);

  if (!subject) {
    showMessage("This subject could not be found.", "error");
    return;
  }

  const confirmed = window.confirm(
    `Delete "${subject.name}" from your saved subjects? This cannot be undone.`
  );

  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "subjects", subjectId));

    if (elements.subjectId.value === subjectId) {
      resetSubjectForm();
    }

    showMessage("Subject deleted.", "success");
  } catch (error) {
    console.error("GradeFlow subject delete error:", error);

    showMessage(
      error.code === "permission-denied"
        ? "Firebase denied deletion. Check your Firestore subjects rules."
        : "Could not delete this subject. Please try again.",
      "error"
    );
  }
}

// ============================================
// FILTER SUBJECTS
// ============================================

function getFilteredSubjects() {
  const search = elements.subjectSearch.value.trim().toLowerCase();
  const semester = elements.semesterFilter.value;

  return subjects
    .filter(subject => {
      const name = String(subject.name || "").toLowerCase();
      const code = String(subject.courseCode || "").toLowerCase();

      const matchesSearch =
        !search ||
        name.includes(search) ||
        code.includes(search);

      const matchesSemester =
        semester === "all" ||
        subject.semester === semester;

      return matchesSearch && matchesSemester;
    })
    .sort((a, b) => {
      const semesterCompare = String(a.semester || "").localeCompare(
        String(b.semester || "")
      );

      if (semesterCompare !== 0) return semesterCompare;

      return String(a.name || "").localeCompare(String(b.name || ""));
    });
}

// ============================================
// SUBJECT SUMMARY
// ============================================

function updateSummary() {
  const total = subjects.length;

  const totalCredits = subjects.reduce((sum, subject) => {
    const credits = Number(subject.creditUnits);

    return sum + (
      Number.isFinite(credits) && credits > 0
        ? credits
        : 0
    );
  }, 0);

  const scoredSubjects = subjects.filter(subject => {
    return getScore(subject.score) !== null;
  });

  const scoredCredits = scoredSubjects.reduce((sum, subject) => {
    const credits = Number(subject.creditUnits);

    return sum + (
      Number.isFinite(credits) && credits > 0
        ? credits
        : 0
    );
  }, 0);

  const weightedScoreTotal = scoredSubjects.reduce((sum, subject) => {
    const score = getScore(subject.score);
    const credits = Number(subject.creditUnits);

    if (score === null || !Number.isFinite(credits) || credits <= 0) {
      return sum;
    }

    return sum + score * credits;
  }, 0);

  const average = scoredCredits > 0
    ? weightedScoreTotal / scoredCredits
    : null;

  const estimatedGpa = average === null
    ? null
    : average / 20;

  elements.totalSubjects.textContent = String(total);
  elements.totalCredits.textContent = formatNumber(totalCredits, 0);
  elements.averageScore.textContent =
    average === null ? "—" : `${formatNumber(average)}%`;

  elements.estimatedGpa.textContent =
    estimatedGpa === null ? "—" : formatNumber(estimatedGpa);

  elements.resultCount.textContent =
    `${total} ${total === 1 ? "subject" : "subjects"}`;
}

// ============================================
// RENDER SUBJECT TABLE
// ============================================

function renderSubjects() {
  updateSummary();

  const filteredSubjects = getFilteredSubjects();

  elements.subjectsTableBody.replaceChildren();

  if (filteredSubjects.length === 0) {
    elements.emptyState.hidden = false;

    if (subjects.length === 0) {
      elements.emptyTitle.textContent = "No subjects yet";
      elements.emptyDescription.textContent =
        "Add your first subject using the form above.";
      elements.emptyAddButton.hidden = false;
    } else {
      elements.emptyTitle.textContent = "No matching subjects";
      elements.emptyDescription.textContent =
        "Try a different search term or semester filter.";
      elements.emptyAddButton.hidden = true;
    }

    return;
  }

  elements.emptyState.hidden = true;

  filteredSubjects.forEach(subject => {
    const row = document.createElement("tr");
    const score = getScore(subject.score);
    const grade = getGrade(score);

    row.innerHTML = `
      <td>
        <span class="subject-title">${escapeHTML(subject.name || "Untitled subject")}</span>
        <span class="subject-code">${escapeHTML(subject.courseCode || "No course code")}</span>
      </td>
      <td>${escapeHTML(subject.semester || "Not set")}</td>
      <td>${escapeHTML(subject.creditUnits ?? "—")}</td>
      <td>${score === null ? "—" : `${formatNumber(score)}%`}</td>
      <td>
        <span class="grade-pill ${grade === "F" ? "grade-f" : ""}">
          ${grade}
        </span>
      </td>
      <td>
        <div class="action-group">
          <button class="table-action" type="button" data-action="edit"
            data-id="${escapeHTML(subject.id)}">Edit</button>
          <button class="table-action delete" type="button" data-action="delete"
            data-id="${escapeHTML(subject.id)}">Delete</button>
        </div>
      </td>
    `;

    elements.subjectsTableBody.appendChild(row);
  });
}

// ============================================
// TABLE ACTIONS
// ============================================

elements.subjectsTableBody.addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");

  if (!button) return;

  const subjectId = button.dataset.id;
  const action = button.dataset.action;

  if (action === "edit") {
    startEditing(subjectId);
  }

  if (action === "delete") {
    deleteSubject(subjectId);
  }
});

// ============================================
// SEARCH AND FILTER EVENTS
// ============================================

elements.subjectSearch.addEventListener("input", renderSubjects);
elements.semesterFilter.addEventListener("change", renderSubjects);

elements.addSubjectButton.addEventListener("click", () => {
  resetSubjectForm();
  openSubjectForm();
});

elements.emptyAddButton.addEventListener("click", () => {
  resetSubjectForm();
  openSubjectForm();
});

elements.cancelEditButton.addEventListener("click", () => {
  resetSubjectForm();
});

// ============================================
// FIRESTORE LIVE SUBJECT LISTENER
// ============================================

function listenForSubjects(user) {
  if (unsubscribeSubjects) {
    unsubscribeSubjects();
    unsubscribeSubjects = null;
  }

  subjects = [];

  elements.subjectsTableBody.innerHTML = `
    <tr>
      <td colspan="6" class="empty-cell">Loading your subjects...</td>
    </tr>
  `;

  const subjectsQuery = query(
    collection(db, "subjects"),
    where("uid", "==", user.uid)
  );

  unsubscribeSubjects = onSnapshot(
    subjectsQuery,
    snapshot => {
      subjects = snapshot.docs.map(subjectDoc => ({
        id: subjectDoc.id,
        ...subjectDoc.data()
      }));

      subjects.sort((a, b) => getCreatedTime(b) - getCreatedTime(a));

      renderSubjects();
    },
    error => {
      console.error("GradeFlow subject listener error:", error);

      elements.subjectsTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-cell">
            Could not load subjects. Check your connection and Firestore rules.
          </td>
        </tr>
      `;

      showMessage(
        error.code === "permission-denied"
          ? "Access denied. Add the subjects collection rule to Firestore."
          : "Could not load subjects. Refresh the page and try again.",
        "error"
      );
    }
  );
}

// ============================================
// MOBILE SIDEBAR
// ============================================

function closeSidebar() {
  elements.sidebar.classList.remove("open");
  elements.sidebarBackdrop.classList.remove("visible");
  elements.menuToggle.setAttribute("aria-expanded", "false");
}

elements.menuToggle.addEventListener("click", () => {
  const isOpen = elements.sidebar.classList.toggle("open");

  elements.sidebarBackdrop.classList.toggle("visible", isOpen);
  elements.menuToggle.setAttribute("aria-expanded", String(isOpen));
});

elements.sidebarBackdrop.addEventListener("click", closeSidebar);

document.querySelectorAll(".nav-link").forEach(link => {
  link.addEventListener("click", closeSidebar);
});

// ============================================
// SIGN OUT
// ============================================

elements.signOutButton.addEventListener("click", async () => {
  elements.signOutButton.disabled = true;
  elements.signOutButton.textContent = "Signing out...";

  try {
    await signOut(auth);
    window.location.href = "../login.html";
  } catch (error) {
    console.error("GradeFlow sign-out error:", error);

    showMessage("Could not sign out. Please try again.", "error");

    elements.signOutButton.disabled = false;
    elements.signOutButton.textContent = "↪ Sign out";
  }
});

// ============================================
// AUTHENTICATION
// ============================================

onAuthStateChanged(auth, user => {
  currentUser = user;

  if (!user) {
    if (unsubscribeSubjects) {
      unsubscribeSubjects();
      unsubscribeSubjects = null;
    }

    window.location.href = "../login.html";
    return;
  }

  updateUserDisplay(user);
  listenForSubjects(user);
});
