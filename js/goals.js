
import { auth, db } from "./firebase.js";

import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import { createGradeFlowNotification } from "./notification-service.js";

/* =====================================================
   GRADEFLOW GOALS AND TARGET GPA PLANNER
   ===================================================== */

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  goals: [],
  history: [],
  editingGoalId: null,
  deletingGoalId: null,
  unsubscribeGoals: null,
  unsubscribeHistory: null
};

const elements = {
  goalList: $("goalList"),
  goalForm: $("goalForm"),
  goalModal: $("goalModal"),
  deleteModal: $("deleteModal"),
  goalFilter: $("goalFilter"),
  goalSort: $("goalSort"),
  goalType: $("goalType"),
  goalTarget: $("goalTarget"),
  goalTargetHint: $("goalTargetHint"),
  goalFormError: $("goalFormError"),
  pageMessage: $("pageMessage"),
  plannerScale: $("plannerScale")
};

/* =====================================================
   GENERAL HELPERS
   ===================================================== */

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return replacements[character];
  });
}

function todayISO() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  if (!value) return "No deadline";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

function getDeadlineStatus(goal) {
  if (goal.completed) return "completed";
  if (!goal.deadline) return "active";

  return goal.deadline < todayISO() ? "overdue" : "active";
}

function showMessage(message, type = "success") {
  if (!elements.pageMessage) return;

  elements.pageMessage.textContent = message;
  elements.pageMessage.className =
    type === "error" ? "page-message error" : "page-message";

  if (message) {
    window.setTimeout(() => {
      if (elements.pageMessage.textContent === message) {
        elements.pageMessage.textContent = "";
        elements.pageMessage.className = "page-message";
      }
    }, 5000);
  }
}

function getRecordDate(record) {
  const time = record.time;

  if (time && typeof time.toDate === "function") {
    return time.toDate().getTime();
  }

  if (time instanceof Date) {
    return time.getTime();
  }

  if (typeof time === "number") {
    return time;
  }

  if (typeof time === "string") {
    const parsed = Date.parse(time);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function getCreatedDate(goal) {
  const createdAt = goal.createdAt;

  if (createdAt && typeof createdAt.toDate === "function") {
    return createdAt.toDate().getTime();
  }

  if (createdAt instanceof Date) {
    return createdAt.getTime();
  }

  return 0;
}

/* =====================================================
   GOAL NOTIFICATIONS
   ===================================================== */

async function notifyGoal(notification, checkExisting = false) {
  if (!state.user) return false;

  try {
    // For deadline reminders, avoid recreating the same
    // notification every time Firestore refreshes the goals.
    if (checkExisting) {
      const notificationRef = doc(
        db,
        "users",
        state.user.uid,
        "notifications",
        notification.id
      );

      const existing = await getDoc(notificationRef);

      if (existing.exists()) {
        return false;
      }
    }

    await createGradeFlowNotification(state.user.uid, notification);
    return true;
  } catch (error) {
    // Notification failures must not undo a saved goal.
    console.error("GradeFlow: goal notification failed:", error);
    return false;
  }
}


/* =====================================================
   CURRENT ACADEMIC PERFORMANCE
   ===================================================== */

/*
  This page uses the saved history records to estimate
  current GPA and average percentage.

  It averages saved GPA records. If your institution
  calculates cumulative GPA from all individual course
  credits across semesters, use your official cumulative
  GPA and total completed credits in the planner.
*/

function getAverageGpa() {
  const values = state.history
    .map((record) => Number(record.gpa))
    .filter((value) => Number.isFinite(value) && value >= 0);

  if (!values.length) return null;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getAveragePercentage() {
  const values = state.history
    .map((record) => Number(record.percentage))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 100);

  if (!values.length) return null;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getCurrentValue(type) {
  return type === "percentage"
    ? getAveragePercentage()
    : getAverageGpa();
}

function getGoalProgress(goal) {
  if (goal.completed) return 100;

  const target = Number(goal.target);
  const current = getCurrentValue(goal.type);

  if (!Number.isFinite(target) || target <= 0 || current === null) {
    return 0;
  }

  return Math.max(0, Math.min(100, (current / target) * 100));
}

function getCurrentValueLabel(goal) {
  const current = getCurrentValue(goal.type);

  if (current === null) return "No saved results";

  if (goal.type === "percentage") {
    return `${current.toFixed(2)}%`;
  }

  return current.toFixed(2);
}

function getTargetLabel(goal) {
  if (goal.type === "percentage") {
    return `${Number(goal.target).toFixed(2)}%`;
  }

  return Number(goal.target).toFixed(2);
}

/* =====================================================
   UPDATE STATISTICS
   ===================================================== */

function renderStatistics() {
  const total = state.goals.length;
  const completed = state.goals.filter((goal) => goal.completed).length;
  const active = state.goals.filter((goal) => !goal.completed).length;

  $("totalGoals").textContent = String(total);
  $("activeGoals").textContent = String(active);
  $("completedGoals").textContent = String(completed);

  const averageGpa = getAverageGpa();

  $("averageGpa").textContent =
    averageGpa === null ? "—" : averageGpa.toFixed(2);

  $("averageGpaNote").textContent = state.history.length
    ? `${state.history.length} saved result${state.history.length === 1 ? "" : "s"}`
    : "Save a calculation to begin";

  const completion = total
    ? Math.round((completed / total) * 100)
    : 0;

  $("overallProgressText").textContent = `${completion}%`;
  $("overallProgressFill").style.width = `${completion}%`;

  if (total === 0) {
    $("overallProgressNote").textContent =
      "Create a goal to start tracking your progress.";
  } else {
    $("overallProgressNote").textContent =
      `${completed} of ${total} goals completed. ${active} still in progress.`;
  }
}

/* =====================================================
   RENDER GOALS
   ===================================================== */

function createGoalCard(goal) {
  const status = getDeadlineStatus(goal);
  const progress = getGoalProgress(goal);
  const typeLabel = goal.type === "percentage"
    ? "Average percentage"
    : "Cumulative GPA";

  const statusLabel = status === "completed"
    ? "Completed"
    : status === "overdue"
      ? "Overdue"
      : "Active";

  const progressLabel = goal.completed
    ? "Target achieved"
    : `${Math.round(progress)}% of target`;

  const safeTitle = escapeHtml(goal.title || "Untitled goal");
  const safeDescription = escapeHtml(goal.description || "");
  const safeDeadline = escapeHtml(formatDate(goal.deadline));
  const safeId = escapeHtml(goal.id);

  return `
    <article class="goal-card ${goal.completed ? "is-completed" : ""} ${status === "overdue" ? "is-overdue" : ""}">
      <div class="goal-card-top">
        <div class="goal-title-group">
          <h3 class="goal-title">${safeTitle}</h3>
          ${safeDescription
            ? `<p class="goal-description">${safeDescription}</p>`
            : ""}
          <span class="goal-type-badge">${typeLabel}</span>
        </div>

        <span class="goal-status ${status}">${statusLabel}</span>
      </div>

      <div class="goal-metrics">
        <div>
          <span class="goal-current-label">Current progress</span>
          <strong class="goal-current-value">${escapeHtml(getCurrentValueLabel(goal))}</strong>
        </div>

        <div class="goal-target">
          <span class="goal-current-label">Target</span>
          <strong>${escapeHtml(getTargetLabel(goal))}</strong>
        </div>
      </div>

      <div class="goal-progress-track"
        role="progressbar"
        aria-label="${safeTitle} progress"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="${Math.round(progress)}">
        <div class="goal-progress-fill" style="width:${progress}%"></div>
      </div>

      <div class="goal-deadline">
        <span>${progressLabel}</span>
        <strong>Due ${safeDeadline}</strong>
      </div>

      <div class="goal-actions">
        <button class="goal-action" type="button"
          data-goal-action="toggle" data-goal-id="${safeId}">
          ${goal.completed ? "Reopen" : "Mark complete"}
        </button>

        <button class="goal-action" type="button"
          data-goal-action="edit" data-goal-id="${safeId}">
          Edit
        </button>

        <button class="goal-action danger" type="button"

          data-goal-action="delete" data-goal-id="${safeId}">
          Delete
        </button>
      </div>
    </article>
  `;
}

function renderGoals() {
  if (!elements.goalList) return;

  const filter = elements.goalFilter.value;
  const sort = elements.goalSort.value;
  let goals = [...state.goals];

  if (filter === "active") {
    goals = goals.filter((goal) => !goal.completed);
  } else if (filter === "completed") {
    goals = goals.filter((goal) => goal.completed);
  } else if (filter === "overdue") {
    goals = goals.filter((goal) => getDeadlineStatus(goal) === "overdue");
  }

  if (sort === "deadline") {
    goals.sort((a, b) => {
      const aDeadline = a.deadline || "9999-12-31";
      const bDeadline = b.deadline || "9999-12-31";

      return aDeadline.localeCompare(bDeadline);
    });
  } else if (sort === "newest") {
    goals.sort((a, b) => getCreatedDate(b) - getCreatedDate(a));
  } else if (sort === "progress") {
    goals.sort((a, b) => getGoalProgress(b) - getGoalProgress(a));
  }

  if (!goals.length) {
    let title = "No goals yet";
    let description = "Create your first academic goal and track your progress.";

    if (state.goals.length > 0) {
      title = "No goals match this filter";
      description = "Choose another filter to see your saved goals.";
    }

    elements.goalList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">◎</span>
        <h3>${title}</h3>
        <p>${description}</p>
        ${state.goals.length === 0
          ? `<button class="secondary-button" id="emptyCreateGoal" type="button">Create a goal</button>`
          : ""}
      </div>
    `;

    const emptyCreateGoal = $("emptyCreateGoal");

    if (emptyCreateGoal) {
      emptyCreateGoal.addEventListener("click", openCreateGoalModal);
    }

    return;
  }

  elements.goalList.innerHTML = goals.map(createGoalCard).join("");
}

/* =====================================================
   GOAL MODAL
   ===================================================== */

function openModal(modal) {
  modal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeModal(modal) {
  modal.hidden = true;

  if (elements.goalModal.hidden && elements.deleteModal.hidden) {
    document.body.classList.remove("modal-open");
  }
}

function showGoalFormError(message) {
  elements.goalFormError.textContent = message;
  elements.goalFormError.hidden = !message;
}

function updateGoalTargetLimit() {
  const type = elements.goalType.value;

  if (type === "percentage") {
    elements.goalTarget.max = "100";
    elements.goalTarget.placeholder = "e.g. 85";
    elements.goalTargetHint.textContent = "Enter a percentage from 0 to 100.";
  } else {
    const scale = Number(elements.plannerScale.value || 5);

    elements.goalTarget.max = String(scale);
    elements.goalTarget.placeholder = "e.g. 4.00";
    elements.goalTargetHint.textContent =
      `Maximum is ${scale.toFixed(1)} on the selected GPA scale.`;
  }
}

function openCreateGoalModal() {
  state.editingGoalId = null;

  elements.goalForm.reset();
  $("goalId").value = "";
  $("goalModalTitle").textContent = "Create a goal";
  $("saveGoalButton").textContent = "Save goal";
  $("goalDeadline").min = todayISO();
  $("goalDeadline").value = "";
  elements.goalType.value = "gpa";

  showGoalFormError("");
  updateGoalTargetLimit();
  openModal(elements.goalModal);

  $("goalTitle").focus();
}

function openEditGoalModal(goalId) {
  const goal = state.goals.find((item) => item.id === goalId);

  if (!goal) {
    showMessage("That goal could not be found.", "error");
    return;
  }

  state.editingGoalId = goal.id;

  $("goalId").value = goal.id;
  $("goalTitle").value = goal.title || "";
  elements.goalType.value = goal.type === "percentage"
    ? "percentage"
    : "gpa";
  elements.goalTarget.value = String(goal.target ?? "");
  $("goalDeadline").value = goal.deadline || "";
  $("goalDeadline").min = todayISO();
  $("goalDescription").value = goal.description || "";

  $("goalModalTitle").textContent = "Edit goal";
  $("saveGoalButton").textContent = "Save changes";

  showGoalFormError("");
  updateGoalTargetLimit();
  openModal(elements.goalModal);

  $("goalTitle").focus();
}

function closeGoalModal() {
  closeModal(elements.goalModal);
  state.editingGoalId = null;
  showGoalFormError("");
}

/* =====================================================
   SAVE / UPDATE GOAL
   ===================================================== */

async function saveGoal(event) {
  event.preventDefault();

  if (!state.user) {
    showGoalFormError("Sign in to save your goal.");
    return;
  }

  const title = $("goalTitle").value.trim();
  const type = elements.goalType.value;
  const target = Number(elements.goalTarget.value);
  const deadline = $("goalDeadline").value;
  const description = $("goalDescription").value.trim();
  const scale = Number(elements.plannerScale.value || 5);

  if (!title) {
    showGoalFormError("Enter a title for your goal.");
    return;
  }

  if (!Number.isFinite(target) || target <= 0) {
    showGoalFormError("Enter a target greater than zero.");
    return;
  }

  if (type === "gpa" && target > scale) {
    showGoalFormError(`Your GPA target cannot exceed ${scale}.`);
    return;
  }

  if (type === "percentage" && target > 100) {
    showGoalFormError("Your percentage target cannot exceed 100.");
    return;
  }

  if (!deadline) {
    showGoalFormError("Choose a deadline for your goal.");
    return;
  }

  if (deadline < todayISO()) {
    showGoalFormError("Choose today or a future date for the deadline.");
    return;
  }

  const saveButton = $("saveGoalButton");
  saveButton.disabled = true;
  saveButton.textContent = "Saving…";
  showGoalFormError("");

  const isEditing = Boolean(state.editingGoalId);
  const editingGoalId = state.editingGoalId;

  const goalData = {
    uid: state.user.uid,
    title,
    type,
    target,
    deadline,
    description,
    updatedAt: serverTimestamp()
  };

  try {
    if (isEditing) {
      const existingGoal = state.goals.find(
        (goal) => goal.id === editingGoalId
      );

      if (!existingGoal || existingGoal.uid !== state.user.uid) {
        throw new Error("This goal could not be updated.");
      }

      await updateDoc(doc(db, "goals", editingGoalId), goalData);

      // The goal is saved first. A notification failure must not undo it.
      await notifyGoal({
        id: `goal-updated-${editingGoalId}-${Date.now()}`,
        title: "Academic goal updated",
        message: `Your goal "${title}" has been updated. Deadline: ${formatDate(deadline)}.`,
        type: "academic"
      });

      showMessage("Goal updated successfully.");
    } else {
      const savedGoal = await addDoc(collection(db, "goals"), {
        ...goalData,
        completed: false,
        createdAt: serverTimestamp()
      });

      await notifyGoal({
        id: `goal-created-${savedGoal.id}`,
        title: "Academic goal created",
        message: `Your goal "${title}" has been created. Deadline: ${formatDate(deadline)}.`,
        type: "academic"
      });

      showMessage("Goal created successfully.");
    }

    closeGoalModal();
  } catch (error) {
    console.error("GradeFlow: unable to save goal:", error);

    showGoalFormError(
      error.code === "permission-denied"
        ? "Permission denied. Check your Firestore rules for the goals collection."
        : error.message || "Unable to save the goal. Try again."
    );
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = isEditing ? "Save changes" : "Save goal";
  }
}

/* =====================================================
   COMPLETE / REOPEN GOAL
   ===================================================== */

async function toggleGoalCompletion(goalId) {
  if (!state.user) return;

  const goal = state.goals.find((item) => item.id === goalId);

  if (!goal || goal.uid !== state.user.uid) return;

  try {
    const willComplete = !goal.completed;

    await updateDoc(doc(db, "goals", goalId), {
      completed: willComplete,
      updatedAt: serverTimestamp()
    });

    if (willComplete) {
      await notifyGoal({
        id: `goal-completed-${goalId}-${Date.now()}`,
        title: "Academic goal completed",
        message: `You marked "${goal.title || "Untitled goal"}" as completed.`,
        type: "academic"
      });
    }

    showMessage(
      goal.completed
        ? "Goal reopened."
        : "Goal marked as completed."
    );
  } catch (error) {
    console.error("GradeFlow: unable to update goal:", error);
    showMessage("Unable to update this goal. Check your connection and permissions.", "error");
  }
}

/* =====================================================
   DELETE GOAL
   ===================================================== */

function openDeleteModal(goalId) {
  const goal = state.goals.find((item) => item.id === goalId);

  if (!goal) {
    showMessage("That goal could not be found.", "error");
    return;
  }

  state.deletingGoalId = goalId;
  $("deleteGoalName").textContent = goal.title || "Untitled goal";

  openModal(elements.deleteModal);
}

function closeDeleteModal() {
  closeModal(elements.deleteModal);
  state.deletingGoalId = null;
}

async function confirmDeleteGoal() {
  if (!state.user || !state.deletingGoalId) return;

  const goal = state.goals.find(
    (item) => item.id === state.deletingGoalId
  );

  if (!goal || goal.uid !== state.user.uid) {
    closeDeleteModal();
    return;
  }

  const button = $("confirmDeleteButton");
  const goalId = state.deletingGoalId;

  button.disabled = true;
  button.textContent = "Deleting…";

  try {
    await deleteDoc(doc(db, "goals", goalId));

    closeDeleteModal();
    showMessage("Goal deleted.");
  } catch (error) {
    console.error("GradeFlow: unable to delete goal:", error);
    showMessage("Unable to delete this goal. Check your connection and permissions.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Delete goal";
  }
}

/* =====================================================
   GOAL LIST EVENTS
   ===================================================== */

elements.goalList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-goal-action]");

  if (!button) return;

  const goalId = button.dataset.goalId;
  const action = button.dataset.goalAction;

  if (action === "toggle") {
    toggleGoalCompletion(goalId);
  } else if (action === "edit") {
    openEditGoalModal(goalId);
  } else if (action === "delete") {
    openDeleteModal(goalId);
  }
});

elements.goalFilter.addEventListener("change", renderGoals);
elements.goalSort.addEventListener("change", renderGoals);
elements.goalForm.addEventListener("submit", saveGoal);

$("addGoalButton").addEventListener("click", openCreateGoalModal);
$("closeGoalModal").addEventListener("click", closeGoalModal);
$("cancelGoalButton").addEventListener("click", closeGoalModal);

$("closeDeleteModal").addEventListener("click", closeDeleteModal);
$("cancelDeleteButton").addEventListener("click", closeDeleteModal);
$("confirmDeleteButton").addEventListener("click", confirmDeleteGoal);

elements.goalType.addEventListener("change", updateGoalTargetLimit);
elements.plannerScale.addEventListener("change", updateGoalTargetLimit);

elements.goalModal.addEventListener("click", (event) => {
  if (event.target === elements.goalModal) {
    closeGoalModal();
  }
});

elements.deleteModal.addEventListener("click", (event) => {
  if (event.target === elements.deleteModal) {
    closeDeleteModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!elements.goalModal.hidden) closeGoalModal();
    if (!elements.deleteModal.hidden) closeDeleteModal();
  }
});

/* =====================================================
   MOBILE SIDEBAR
   ===================================================== */

const sidebar = $("sidebar");
const menuToggle = $("menuToggle");
const sidebarBackdrop = $("sidebarBackdrop");

function openSidebar() {
  sidebar.classList.add("open");
  sidebarBackdrop.hidden = false;
  menuToggle.setAttribute("aria-expanded", "true");
  menuToggle.setAttribute("aria-label", "Close navigation");
}

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarBackdrop.hidden = true;
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Open navigation");
}

menuToggle.addEventListener("click", () => {
  if (sidebar.classList.contains("open")) {
    closeSidebar();
  } else {
    openSidebar();
  }
});

sidebarBackdrop.addEventListener("click", closeSidebar);

sidebar.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", closeSidebar);
});

/* =====================================================
   SIGN OUT
   ===================================================== */

$("signOutButton").addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "../login.html";
  } catch (error) {
    console.error("GradeFlow: sign out failed:", error);
    showMessage("Unable to sign out. Try again.", "error");
  }
});

/* =====================================================
   FIRESTORE LISTENERS
   ===================================================== */

function stopFirestoreListeners() {
  if (state.unsubscribeGoals) {
    state.unsubscribeGoals();
    state.unsubscribeGoals = null;
  }

  if (state.unsubscribeHistory) {
    state.unsubscribeHistory();
    state.unsubscribeHistory = null;
  }
}

function listenForGoals(user) {
  const goalsQuery = query(
    collection(db, "goals"),
    where("uid", "==", user.uid)
  );

  state.unsubscribeGoals = onSnapshot(
    goalsQuery,
    (snapshot) => {
      state.goals = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      renderStatistics();
      renderGoals();
    },
    (error) => {
      console.error("GradeFlow: loading goals failed:", error);

      elements.goalList.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">!</span>
          <h3>Goals could not be loaded</h3>
          <p>Check your internet connection and Firestore permissions, then refresh this page.</p>
        </div>
      `;

      showMessage("Unable to load goals from Firestore.", "error");
    }
  );
}

function listenForHistory(user) {
  const historyQuery = query(
    collection(db, "history"),
    where("uid", "==", user.uid)
  );

  state.unsubscribeHistory = onSnapshot(
    historyQuery,
    (snapshot) => {
      state.history = snapshot.docs
        .map((item) => ({
          id: item.id,
          ...item.data()
        }))
        .sort((a, b) => getRecordDate(b) - getRecordDate(a));

      renderStatistics();
      renderGoals();
    },
    (error) => {
      console.error("GradeFlow: loading academic history failed:", error);

      state.history = [];
      renderStatistics();
      renderGoals();

      showMessage(
        "History could not be loaded. Goal progress may be incomplete.",
        "error"
      );
    }
  );
}

/* =====================================================
   AUTHENTICATION
   ===================================================== */

onAuthStateChanged(auth, (user) => {
  stopFirestoreListeners();

  if (!user) {
    state.user = null;
    window.location.href = "../login.html";
    return;
  }

  state.user = user;

  const displayName =
    user.displayName ||
    (user.email ? user.email.split("@")[0] : "Student");

  const firstLetter = displayName.trim().charAt(0).toUpperCase() || "G";

  $("sidebarUserName").textContent = displayName;
  $("sidebarAvatar").textContent = firstLetter;
  $("headerAvatar").textContent = firstLetter;

  $("currentYear").textContent = String(new Date().getFullYear());

  listenForGoals(user);
  listenForHistory(user);
});

/* =====================================================
   TARGET GPA PLANNER
   ===================================================== */

(() => {
  const planner = $("targetGpaPlanner");

  if (!planner) return;

  const scaleInput = $("plannerScale");
  const semesterPanel = $("semesterPlanner");
  const cumulativePanel = $("cumulativePlanner");

  function getScale() {
    return Number(scaleInput.value);
  }

  function getNumber(id) {
    const input = $(id);

    if (!input || input.value.trim() === "") {
      return null;
    }

    const value = Number(input.value);

    return Number.isFinite(value) ? value : null;
  }

  function showPlannerResult(id, message, type = "info") {
    const result = $(id);

    result.hidden = false;
    result.className = `planner-result ${type}`;
    result.textContent = message;
  }

  function clearPlannerResults() {
    $("semesterPlannerResult").hidden = true;
    $("cumulativePlannerResult").hidden = true;
  }

  function validateGpa(value, scale, label) {
    if (value === null || value < 0 || value > scale) {
      return `${label} must be between 0 and ${scale}.`;
    }

    return null;
  }

  function validateCredits(value, label, allowZero = false) {
    const minimum = allowZero ? 0 : 0.01;

    if (value === null || value < minimum) {
      return allowZero
        ? `${label} must be zero or greater.`
        : `${label} must be greater than zero.`;
    }

    return null;
  }

  function updateScaleLimits() {
    const scale = getScale();

    [
      "semesterCurrentGpa",
      "semesterTargetGpa",
      "cumulativeCurrentGpa",
      "cumulativeSemesterGpa"
    ].forEach((id) => {
      $(id).max = String(scale);
    });

    updateGoalTargetLimit();
    clearPlannerResults();
  }

  function switchPlanner(tab) {
    semesterPanel.hidden = tab !== "semester";
    cumulativePanel.hidden = tab !== "cumulative";

    document.querySelectorAll("[data-planner-tab]").forEach((button) => {
      const active = button.dataset.plannerTab === tab;

      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    clearPlannerResults();
  }

  document.querySelectorAll("[data-planner-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      switchPlanner(button.dataset.plannerTab);
    });
  });

  scaleInput.addEventListener("change", updateScaleLimits);

  /* METHOD ONE: REQUIRED NEXT-SEMESTER GPA */

  $("calculateSemesterBtn").addEventListener("click", () => {
    const scale = getScale();
    const currentGpa = getNumber("semesterCurrentGpa");
    const completedCredits = getNumber("semesterCompletedCredits");
    const targetGpa = getNumber("semesterTargetGpa");
    const upcomingCredits = getNumber("semesterUpcomingCredits");

    const resultId = "semesterPlannerResult";

    const error =
      validateGpa(currentGpa, scale, "Current cumulative GPA") ||
      validateGpa(targetGpa, scale, "Target cumulative GPA") ||
      validateCredits(completedCredits, "Completed credits", true) ||
      validateCredits(upcomingCredits, "Next-semester credits");

    if (error) {
      showPlannerResult(resultId, error, "error");
      return;
    }

    const totalCredits = completedCredits + upcomingCredits;

    /*
      Required next-semester GPA =
      (target cumulative GPA × total future credits
       - current cumulative GPA × completed credits)
      ÷ upcoming credits
    */

    const requiredGpa =
      (
        targetGpa * totalCredits -
        currentGpa * completedCredits
      ) / upcomingCredits;

    if (!Number.isFinite(requiredGpa)) {
      showPlannerResult(
        resultId,
        "Unable to calculate a result. Check the values you entered.",
        "error"
      );
      return;
    }

    if (requiredGpa > scale) {
      showPlannerResult(
        resultId,
        `You would need a GPA of ${requiredGpa.toFixed(2)} next semester. That exceeds your ${scale}-point scale, so reaching this cumulative target in one semester is mathematically impossible with these credit totals.`,
        "error"
      );
      return;
    }

    if (requiredGpa < 0) {
      showPlannerResult(
        resultId,
        `Your current GPA is already high enough for this target under these assumptions. The calculated requirement is ${requiredGpa.toFixed(2)}. Verify your target and credit totals.`,
        "success"
      );
      return;
    }

    showPlannerResult(
      resultId,
      `You need approximately ${requiredGpa.toFixed(2)} / ${scale.toFixed(1)} next semester to reach a cumulative GPA of ${targetGpa.toFixed(2)}. This calculation assumes ${completedCredits} completed credits and ${upcomingCredits} new credits.`,
      "success"
    );
  });

  /* METHOD TWO: FUTURE CUMULATIVE GPA */

  $("calculateCumulativeBtn").addEventListener("click", () => {
    const scale = getScale();
    const currentGpa = getNumber("cumulativeCurrentGpa");
    const completedCredits = getNumber("cumulativeCompletedCredits");
    const semesterGpa = getNumber("cumulativeSemesterGpa");
    const upcomingCredits = getNumber("cumulativeUpcomingCredits");

    const resultId = "cumulativePlannerResult";

    const error =
      validateGpa(currentGpa, scale, "Current cumulative GPA") ||
      validateGpa(semesterGpa, scale, "Expected next-semester GPA") ||
      validateCredits(completedCredits, "Completed credits", true) ||
      validateCredits(upcomingCredits, "Next-semester credits");

    if (error) {
      showPlannerResult(resultId, error, "error");
      return;
    }

    const totalCredits = completedCredits + upcomingCredits;

    if (totalCredits <= 0) {
      showPlannerResult(
        resultId,
        "Enter a valid total number of credits.",
        "error"
      );
      return;
    }

    /*
      Future cumulative GPA =
      (current GPA × completed credits
       + next-semester GPA × upcoming credits)
      ÷ total credits after next semester
    */

    const futureGpa =
      (
        currentGpa * completedCredits +
        semesterGpa * upcomingCredits
      ) / totalCredits;

    showPlannerResult(
      resultId,
      `Your estimated cumulative GPA after next semester is ${futureGpa.toFixed(2)} / ${scale.toFixed(1)}. You would have ${totalCredits} total credits, assuming ${completedCredits} completed credits and ${upcomingCredits} additional credits.`,
      "success"
    );
  });

  updateScaleLimits();
  switchPlanner("semester");
})();

/* =====================================================
   INITIAL PAGE SETUP
   ===================================================== */

$("currentYear").textContent = String(new Date().getFullYear());
updateGoalTargetLimit();
