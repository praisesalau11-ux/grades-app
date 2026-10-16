
import { auth, db } from "./firebase.js";

import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// --------------------------------------------------
// GRADEFLOW GOALS
// --------------------------------------------------

const $ = (id) => document.getElementById(id);

let currentUser = null;
let goals = [];
let historyRecords = [];
let editingGoalId = null;
let pendingAction = null;
let unsubscribeGoals = null;
let unsubscribeHistory = null;
let listenersStarted = false;
let saving = false;

const today = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const notice = $("notice");

// --------------------------------------------------
// SAFE DISPLAY HELPERS
// --------------------------------------------------

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle("error", isError);
  notice.hidden = false;
}

function hideNotice() {
  notice.hidden = true;
  notice.classList.remove("error");
}

function formatDate(value) {
  if (!value) return "No deadline";

  // Goal deadlines are stored as YYYY-MM-DD strings.
  const parts = String(value).split("-");

  if (parts.length !== 3) return "Invalid date";

  const date = new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2])
  );

  if (Number.isNaN(date.getTime())) return "Invalid date";

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

function getRecordDate(record) {
  if (!record.time) return null;

  const date = typeof record.time.toDate === "function"
    ? record.time.toDate()
    : new Date(record.time);

  return Number.isNaN(date.getTime()) ? null : date;
}

function getMetric(record, type) {
  const rawValue = type === "gpa"
    ? record.gpa
    : record.percentage;

  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return null;
  }

  const value = Number(rawValue);

  return Number.isFinite(value) ? value : null;
}

function averageForType(type) {
  const values = historyRecords
    .map((record) => getMetric(record, type))
    .filter((value) => value !== null);

  if (!values.length) return null;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getCurrentMetric(type) {
  return averageForType(type);
}

function getProgress(goal) {
  if (goal.completed) return 100;

  const target = Number(goal.target);
  const current = getCurrentMetric(goal.type);

  if (!Number.isFinite(target) || target <= 0 || current === null) {
    return 0;
  }

  return Math.min(100, Math.max(0, (current / target) * 100));
}

function isOverdue(goal) {
  return !goal.completed && Boolean(goal.deadline) &&
    goal.deadline < today();
}

function getStatus(goal) {
  if (goal.completed) return "completed";
  if (isOverdue(goal)) return "overdue";
  return "active";
}

function getTypeLabel(type) {
  return type === "percentage" ? "Percentage goal" : "GPA goal";
}

function getMetricLabel(type) {
  return type === "percentage" ? "Percentage" : "GPA";
}

function formatMetric(value, type) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  return type === "percentage"
    ? `${value.toFixed(2)}%`
    : value.toFixed(2);
}

function formatTargetInput(type) {
  const targetInput = $("goalTarget");
  const targetLabel = $("targetLabel");
  const targetHelp = $("targetHelp");

  if (type === "percentage") {
    targetInput.min = "0.01";
    targetInput.max = "100";
    targetInput.step = "0.01";
    targetInput.placeholder = "e.g. 80";
    targetLabel.textContent = "Target percentage";
    targetHelp.textContent =
      "Enter a target from 0 to 100%.";
  } else {
    // Allow different common GPA scales, including 4.0, 5.0 and 7.0.
    targetInput.min = "0.01";
    targetInput.max = "10";
    targetInput.step = "0.01";
    targetInput.placeholder = "e.g. 4.50";
    targetLabel.textContent = "Target GPA";
    targetHelp.textContent =
      "Enter a target that matches your institution's GPA scale.";
  }
}

// --------------------------------------------------
// AUTHENTICATION
// --------------------------------------------------

onAuthStateChanged(auth, (user) => {
  if (!user) {
    stopListeners();
    window.location.href = "../login.html";
    return;
  }

  if (currentUser?.uid === user.uid && listenersStarted) {
    return;
  }

  stopListeners();

  currentUser = user;

  $("userLabel").textContent =
    user.displayName || user.email || "Your goals";

  listenersStarted = true;
  hideNotice();

  startListeners(user);
});

function stopListeners() {
  if (unsubscribeGoals) {
    unsubscribeGoals();
    unsubscribeGoals = null;
  }

  if (unsubscribeHistory) {
    unsubscribeHistory();
    unsubscribeHistory = null;
  }

  listenersStarted = false;
}

function startListeners(user) {
  $("goalsGrid").innerHTML =
    '<div class="loading-card">Loading your goals…</div>';

  // Each query only loads records belonging to the signed-in user.
  const goalsQuery = query(
    collection(db, "goals"),
    where("uid", "==", user.uid)
  );

  unsubscribeGoals = onSnapshot(
    goalsQuery,
    (snapshot) => {
      goals = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      goals.sort((a, b) => {
        const dateA = a.deadline || "9999-12-31";
        const dateB = b.deadline || "9999-12-31";

        return dateA.localeCompare(dateB);
      });

      renderEverything();
      hideNotice();
    },
    (error) => {
      console.error("Goals could not be loaded:", error);
      showNotice(
        "Unable to load goals. Check your Firestore rules and internet connection.",
        true
      );

      $("goalsGrid").innerHTML = "";
      $("goalsEmpty").hidden = false;
      $("emptyTitle").textContent = "Goals could not be loaded";
      $("emptyText").textContent =
        "Check your Firebase permissions and try refreshing the page.";
    }
  );

  const historyQuery = query(
    collection(db, "history"),
    where("uid", "==", user.uid),
    orderBy("time", "desc")
  );

  unsubscribeHistory = onSnapshot(
    historyQuery,
    (snapshot) => {
      historyRecords = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      renderEverything();
    },
    (error) => {
      console.error("History could not be loaded for goal tracking:", error);

      historyRecords = [];
      renderEverything();

      showNotice(
        "Goals loaded, but saved results could not be read. Check your history permissions.",
        true
      );
    }
  );
}

// --------------------------------------------------
// SUMMARY STATISTICS
// --------------------------------------------------

function renderStatistics() {
  const completed = goals.filter((goal) => goal.completed).length;
  const active = goals.filter((goal) => !goal.completed).length;
  const currentGpa = averageForType("gpa");

  $("totalGoals").textContent = goals.length;
  $("activeGoals").textContent = active;
  $("completedGoals").textContent = completed;
  $("currentGpa").textContent = currentGpa === null
    ? "—"
    : currentGpa.toFixed(2);

  const achievementRate = goals.length
    ? Math.round((completed / goals.length) * 100)
    : 0;

  $("overallProgressBar").style.width = `${achievementRate}%`;
  $("overallProgressLabel").textContent =
    `${achievementRate}% achieved`;

  if (!goals.length) {
    $("overallProgressText").textContent =
      "Create your first goal to start tracking progress.";
  } else {
    $("overallProgressText").textContent =
      `${completed} of ${goals.length} goals marked as completed. ` +
      "Use the progress cards to track your targets.";
  }
}

// --------------------------------------------------
// GOAL CARDS
// --------------------------------------------------

function renderEverything() {
  renderStatistics();
  renderGoals();
}

function renderGoals() {
  const selectedFilter = $("goalFilter").value;

  const filteredGoals = goals.filter((goal) => {
    const status = getStatus(goal);

    if (selectedFilter === "all") return true;
    return status === selectedFilter;
  });

  $("goalsGrid").innerHTML = "";

  if (!filteredGoals.length) {
    $("goalsEmpty").hidden = false;

    if (!goals.length) {
      $("emptyTitle").textContent = "No goals yet";
      $("emptyText").textContent =
        "Create your first academic goal and track your progress here.";
      $("emptyCreateBtn").hidden = false;
    } else {
      $("emptyTitle").textContent = "No matching goals";
      $("emptyText").textContent =
        "Try another filter to see your other goals.";
      $("emptyCreateBtn").hidden = true;
    }

    return;
  }

  $("goalsEmpty").hidden = true;

  for (const goal of filteredGoals) {
    const card = createGoalCard(goal);
    $("goalsGrid").appendChild(card);
  }
}

function createGoalCard(goal) {
  const status = getStatus(goal);
  const progress = getProgress(goal);
  const current = getCurrentMetric(goal.type);
  const target = Number(goal.target);
  const card = document.createElement("article");

  card.className = "goal-card";

  if (status === "completed") card.classList.add("is-completed");
  if (status === "overdue") card.classList.add("is-overdue");

  const statusLabel = status === "completed"
    ? "Completed"
    : status === "overdue"
      ? "Overdue"
      : "In progress";

  const icon = status === "completed"
    ? "✓"
    : status === "overdue"
      ? "!"
      : goal.type === "percentage"
        ? "%"
        : "◎";

  let deadlineLabel;

  if (!goal.deadline) {
    deadlineLabel = "No deadline";
  } else if (status === "completed") {
    deadlineLabel = `Deadline: ${formatDate(goal.deadline)}`;
  } else if (status === "overdue") {
    deadlineLabel = `Was due ${formatDate(goal.deadline)}`;
  } else if (goal.deadline === today()) {
    deadlineLabel = "Due today";
  } else {
    const daysLeft = Math.ceil(
      (new Date(`${goal.deadline}T00:00:00`) -
       new Date(`${today()}T00:00:00`)) / 86400000
    );

    deadlineLabel = daysLeft === 1
      ? "1 day left"
      : `${daysLeft} days left`;
  }

  const currentLabel = current === null
    ? "No saved results"
    : formatMetric(current, goal.type);

  card.innerHTML = `
    <div class="goal-card-top">
      <div class="goal-top-left">
        <div class="goal-icon">${icon}</div>
        <div>
          <h3 class="goal-name">${escapeHTML(goal.title || "Untitled goal")}</h3>
          <span class="goal-type-label">${escapeHTML(getTypeLabel(goal.type))}</span>
        </div>
      </div>

      <details class="goal-menu">
        <summary aria-label="Goal options">⋮</summary>
        <div class="goal-menu-items">
          <button type="button" data-action="edit">Edit goal</button>
          <button type="button" data-action="toggle">
            ${goal.completed ? "Reopen goal" : "Mark completed"}
          </button>
          <button type="button" data-action="delete" class="danger">
            Delete goal
          </button>
        </div>
      </details>
    </div>

    <p class="goal-description">
      ${escapeHTML(goal.description || "No description added.")}
    </p>

    <div class="goal-numbers">
      <div>
        <div class="goal-progress-number">
          ${progress.toFixed(0)}<small>%</small>
        </div>
        <div class="goal-type-label">Progress to target</div>
      </div>

      <div class="goal-target">
        Target
        <strong>${escapeHTML(formatMetric(target, goal.type))}</strong>
      </div>
    </div>

    <div
      class="progress-track"
      role="progressbar"
      aria-label="${escapeHTML(goal.title || "Goal")} progress"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow="${progress.toFixed(0)}"
    >
      <div class="progress-fill" style="width:${progress}%"></div>
    </div>

    <div class="goal-progress-caption">
      <span>Current average: <strong>${escapeHTML(currentLabel)}</strong></span>
      <strong>${progress.toFixed(0)}%</strong>
    </div>

    <div class="goal-meta">
      <span>${escapeHTML(deadlineLabel)}</span>
      <span class="goal-status status-${status}">
        <span class="status-dot-small"></span>
        ${statusLabel}
      </span>
    </div>

    <div class="goal-actions">
      <button class="small-btn" type="button" data-action="edit">
        Edit goal
      </button>
      <button class="small-btn primary" type="button" data-action="toggle">
        ${goal.completed ? "Reopen goal" : "Mark completed"}
      </button>
    </div>
  `;

  card.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();

      const menu = button.closest("details");
      if (menu) menu.open = false;

      handleGoalAction(goal, button.dataset.action);
    });
  });

  return card;
}

$("goalFilter").addEventListener("change", renderGoals);

// --------------------------------------------------
// CREATE AND EDIT GOALS
// --------------------------------------------------

function openGoalModal(goal = null) {
  editingGoalId = goal?.id || null;

  $("goalForm").reset();
  $("formError").hidden = true;
  $("modalTitle").textContent = goal ? "Edit goal" : "Create a goal";
  $("saveGoalBtn").textContent = goal ? "Save changes" : "Save goal";

  $("goalTitle").value = goal?.title || "";
  $("goalType").value = goal?.type || "gpa";
  $("goalTarget").value = goal?.target ?? "";
  $("goalDeadline").value = goal?.deadline || "";
  $("goalDescription").value = goal?.description || "";

  formatTargetInput($("goalType").value);

  $("goalModal").hidden = false;
  $("goalTitle").focus();
}

function closeGoalModal() {
  if (saving) return;

  $("goalModal").hidden = true;
  editingGoalId = null;
  $("formError").hidden = true;
}

$("newGoalBtn").addEventListener("click", () => openGoalModal());
$("heroCreateBtn").addEventListener("click", () => openGoalModal());
$("emptyCreateBtn").addEventListener("click", () => openGoalModal());

$("closeModalBtn").addEventListener("click", closeGoalModal);
$("cancelModalBtn").addEventListener("click", closeGoalModal);

$("goalModal").addEventListener("click", (event) => {
  if (event.target === $("goalModal")) closeGoalModal();
});

$("goalType").addEventListener("change", () => {
  formatTargetInput($("goalType").value);
  $("goalTarget").value = "";
});

function showFormError(message) {
  $("formError").textContent = message;
  $("formError").hidden = false;
}

$("goalForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser || saving) return;

  const title = $("goalTitle").value.trim();
  const type = $("goalType").value;
  const target = Number($("goalTarget").value);
  const deadline = $("goalDeadline").value;
  const description = $("goalDescription").value.trim();

  if (!title) {
    showFormError("Enter a name for this goal.");
    return;
  }

  if (!["gpa", "percentage"].includes(type)) {
    showFormError("Select a valid goal type.");
    return;
  }

  const maxTarget = type === "percentage" ? 100 : 10;

  if (
    !Number.isFinite(target) ||
    target <= 0 ||
    target > maxTarget
  ) {
    showFormError(
      type === "percentage"
        ? "Enter a percentage target greater than 0 and no more than 100."
        : "Enter a GPA target greater than 0 and no more than 10."
    );
    return;
  }

  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    showFormError("Choose a valid deadline.");
    return;
  }

  const saveButton = $("saveGoalBtn");
  saving = true;
  saveButton.disabled = true;
  saveButton.textContent = "Saving…";
  $("formError").hidden = true;

  const goalData = {
    uid: currentUser.uid,
    title,
    type,
    target,
    deadline,
    description,
    updatedAt: serverTimestamp()
  };

  try {
    if (editingGoalId) {
      const existingGoal = goals.find(
        (item) => item.id === editingGoalId
      );

      if (!existingGoal || existingGoal.uid !== currentUser.uid) {
        throw new Error("This goal could not be found.");
      }

      await updateDoc(doc(db, "goals", editingGoalId), goalData);
      showNotice("Goal updated successfully.");
    } else {
      goalData.completed = false;
      goalData.createdAt = serverTimestamp();

      await addDoc(collection(db, "goals"), goalData);
      showNotice("Your goal has been created.");
    }

    $("goalModal").hidden = true;
    editingGoalId = null;
  } catch (error) {
    console.error("Could not save goal:", error);

    showFormError(
      error.code === "permission-denied"
        ? "Firebase denied this action. Check your goals Firestore rules."
        : "Could not save this goal. Check your connection and try again."
    );
  } finally {
    saving = false;
    saveButton.disabled = false;
    saveButton.textContent = editingGoalId ? "Save changes" : "Save goal";
  }
});

// --------------------------------------------------
// EDIT, COMPLETE, REOPEN AND DELETE
// --------------------------------------------------

function handleGoalAction(goal, action) {
  if (action === "edit") {
    openGoalModal(goal);
    return;
  }

  if (action === "toggle") {
    if (goal.completed) {
      openConfirm(
        "Reopen this goal?",
        `“${goal.title}” will return to active tracking.`,
        async () => {
          await updateGoal(goal, { completed: false });
        },
        "Reopen goal"
      );
    } else {
      openConfirm(
        "Mark goal as completed?",
        `This will mark “${goal.title}” as completed. You can reopen it later.`,
        async () => {
          await updateGoal(goal, { completed: true });
        },
        "Mark completed"
      );
    }

    return;
  }

  if (action === "delete") {
    openConfirm(
      "Delete this goal?",
      `“${goal.title}” will be permanently deleted. This does not delete your calculation history.`,
      async () => {
        await deleteGoal(goal);
      },
      "Delete goal",
      true
    );
  }
}

async function updateGoal(goal, changes) {
  if (!currentUser || goal.uid !== currentUser.uid) {
    showNotice("You cannot update this goal.", true);
    return;
  }

  try {
    await updateDoc(doc(db, "goals", goal.id), {
      ...changes,
      updatedAt: serverTimestamp()
    });

    showNotice(
      changes.completed
        ? "Goal marked as completed."
        : "Goal reopened."
    );
  } catch (error) {
    console.error("Could not update goal:", error);
    showNotice("Could not update this goal. Check your connection and permissions.", true);
  }
}

async function deleteGoal(goal) {
  if (!currentUser || goal.uid !== currentUser.uid) {
    showNotice("You cannot delete this goal.", true);
    return;
  }

  try {
    await deleteDoc(doc(db, "goals", goal.id));
    showNotice("Goal deleted.");
  } catch (error) {
    console.error("Could not delete goal:", error);
    showNotice("Could not delete this goal. Check your connection and permissions.", true);
  }
}

// --------------------------------------------------
// CONFIRMATION DIALOG
// --------------------------------------------------

function openConfirm(title, message, action, buttonText, isDanger = false) {
  pendingAction = action;

  $("confirmTitle").textContent = title;
  $("confirmMessage").textContent = message;
  $("confirmActionBtn").textContent = buttonText;
  $("confirmActionBtn").classList.toggle("danger", isDanger);
  $("confirmActionBtn").classList.toggle("btn-primary", !isDanger);
  $("confirmActionBtn").classList.toggle("btn-secondary", isDanger);
  $("confirmModal").hidden = false;
  $("confirmActionBtn").focus();
}

function closeConfirm() {
  if (saving) return;

  pendingAction = null;
  $("confirmModal").hidden = true;
}

$("closeConfirmBtn").addEventListener("click", closeConfirm);
$("cancelConfirmBtn").addEventListener("click", closeConfirm);

$("confirmModal").addEventListener("click", (event) => {
  if (event.target === $("confirmModal")) closeConfirm();
});

$("confirmActionBtn").addEventListener("click", async () => {
  if (!pendingAction || saving) return;

  const action = pendingAction;

  saving = true;
  $("confirmActionBtn").disabled = true;
  $("confirmActionBtn").textContent = "Please wait…";

  try {
    await action();
    pendingAction = null;
    $("confirmModal").hidden = true;
  } finally {
    saving = false;
    $("confirmActionBtn").disabled = false;
  }
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!$("goalModal").hidden) closeGoalModal();
    if (!$("confirmModal").hidden) closeConfirm();
  }
});

// --------------------------------------------------
// SIGN OUT
// --------------------------------------------------

$("signOutBtn").addEventListener("click", async () => {
  try {
    stopListeners();
    await signOut(auth);
    window.location.href = "../login.html";
  } catch (error) {
    console.error("Sign out failed:", error);
    showNotice("Unable to sign out. Please try again.", true);
  }
});
