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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

/* =====================================================
   GRADEFLOW STUDY PLANNER
   Firebase Authentication + Firestore
   ===================================================== */

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  tasks: [],
  editingId: null,
  deletingId: null,
  unsubscribeTasks: null,
  authReady: false
};

const el = {
  taskList: $("taskList"),
  taskModal: $("taskModal"),
  deleteModal: $("deleteModal"),
  taskForm: $("taskForm"),
  taskFilter: $("taskFilter"),
  taskSort: $("taskSort"),
  taskFormError: $("taskFormError"),
  pageMessage: $("pageMessage")
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

function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDate(dateString) {
  if (!dateString) return "No date";

  const parts = dateString.split("-").map(Number);

  if (
    parts.length !== 3 ||
    parts.some((part) => !Number.isFinite(part))
  ) {
    return "Invalid date";
  }

  const date = new Date(parts[0], parts[1] - 1, parts[2]);

  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatTime(timeString) {
  if (!timeString) return "No time";

  const parts = timeString.split(":").map(Number);

  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part))) {
    return "Invalid time";
  }

  const date = new Date();
  date.setHours(parts[0], parts[1], 0, 0);

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatDuration(minutes) {
  const total = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(total / 60);
  const remainder = total % 60;

  if (hours && remainder) return `${hours}h ${remainder}m`;
  if (hours) return `${hours}h`;

  return `${remainder} min`;
}

function formatTotalHours(minutes) {
  const hours = (Math.max(0, minutes) / 60).toFixed(1);
  return `${hours}h`;
}

function showMessage(message, type = "success") {
  el.pageMessage.textContent = message;
  el.pageMessage.className =
    type === "error" ? "page-message error" : "page-message";

  if (!message) return;

  window.setTimeout(() => {
    if (el.pageMessage.textContent === message) {
      el.pageMessage.textContent = "";
      el.pageMessage.className = "page-message";
    }
  }, 5000);
}

function showFormError(message) {
  el.taskFormError.textContent = message;
  el.taskFormError.hidden = !message;
}

function getTaskStatus(task) {
  if (task.completed) return "completed";

  if (task.date && task.date < getToday()) {
    return "overdue";
  }

  return "pending";
}

function getTaskDateTime(task) {
  return `${task.date || "9999-12-31"}T${task.time || "23:59"}:00`;
}

function getPriorityRank(priority) {
  const ranks = {
    high: 3,
    medium: 2,
    low: 1
  };

  return ranks[priority] || 0;
}

/* =====================================================
   MODAL HELPERS
   ===================================================== */

function openModal(modal) {
  modal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeModal(modal) {
  modal.hidden = true;

  if (el.taskModal.hidden && el.deleteModal.hidden) {
    document.body.classList.remove("modal-open");
  }
}

function closeTaskModal() {
  closeModal(el.taskModal);
  state.editingId = null;
  showFormError("");
}

function closeDeleteModal() {
  closeModal(el.deleteModal);
  state.deletingId = null;
}

/* =====================================================
   TASK STATISTICS
   ===================================================== */

function renderStatistics() {
  const total = state.tasks.length;
  const completed = state.tasks.filter((task) => task.completed);
  const pending = state.tasks.filter((task) => !task.completed);

  const plannedMinutes = state.tasks.reduce(
    (sum, task) => sum + (Number(task.duration) || 0),
    0
  );

  const completedMinutes = completed.reduce(
    (sum, task) => sum + (Number(task.duration) || 0),
    0
  );

  const completion = total
    ? Math.round((completed.length / total) * 100)
    : 0;

  $("totalTasks").textContent = String(total);
  $("pendingTasks").textContent = String(pending.length);
  $("completedTasks").textContent = String(completed.length);
  $("plannedHours").textContent = formatTotalHours(plannedMinutes);

  $("completionPercentage").textContent = `${completion}%`;
  $("completionProgressFill").style.width = `${completion}%`;

  $("completionProgress").setAttribute(
    "aria-valuenow",
    String(completion)
  );

  $("completionSummary").textContent = total
    ? `${completed.length} of ${total} tasks completed`
    : "No study tasks yet.";

  $("completedMinutes").textContent =
    `${completedMinutes} minutes completed`;
}

/* =====================================================
   RENDER ONE TASK CARD
   ===================================================== */

function renderTaskCard(task) {
  const status = getTaskStatus(task);

  const statusLabel = status === "completed"
    ? "Completed"
    : status === "overdue"
      ? "Overdue"
      : "Pending";

  const priority = ["low", "medium", "high"].includes(task.priority)
    ? task.priority
    : "medium";

  const taskId = escapeHtml(task.id);
  const safeTitle = escapeHtml(task.title || "Untitled task");
  const safeSubject = escapeHtml(task.subject || "Unspecified subject");
  const safeTopic = escapeHtml(task.topic || "");
  const safeNotes = escapeHtml(task.notes || "");
  const safeDate = escapeHtml(formatDate(task.date));
  const safeTime = escapeHtml(formatTime(task.time));
  const safeDuration = escapeHtml(
    formatDuration(Number(task.duration) || 0)
  );

  return `
    <article class="task-card ${task.completed ? "is-completed" : ""} ${status === "overdue" ? "is-overdue" : ""}">
      <div class="task-top">
        <div class="task-heading">
          <p class="task-subject">${safeSubject}</p>
          <h3 class="task-title">${safeTitle}</h3>
          ${safeTopic
            ? `<p class="task-topic">Topic: ${safeTopic}</p>`
            : ""}
        </div>

        <span class="task-status ${status}">${statusLabel}</span>
      </div>

      <span class="priority-badge ${priority}">
        ${priority === "high" ? "▲" : priority === "medium" ? "●" : "▽"}
        ${priority.charAt(0).toUpperCase() + priority.slice(1)} priority
      </span>

      <div class="task-details">
        <div class="task-detail">
          <span>Study date</span>
          <strong>${safeDate}</strong>
        </div>

        <div class="task-detail">
          <span>Start time</span>
          <strong>${safeTime}</strong>
        </div>

        <div class="task-detail">
          <span>Duration</span>
          <strong>${safeDuration}</strong>
        </div>

        <div class="task-detail">
          <span>Progress</span>
          <strong>${task.completed ? "Finished" : "Not completed"}</strong>
        </div>
      </div>

      ${safeNotes
        ? `<p class="task-notes">${safeNotes}</p>`
        : ""}

      <div class="task-actions">
        <button class="task-action" type="button"
          data-task-action="toggle" data-task-id="${taskId}">
          ${task.completed ? "Reopen task" : "Mark complete"}
        </button>

        <button class="task-action" type="button"
          data-task-action="edit" data-task-id="${taskId}">
          Edit
        </button>

        <button class="task-action danger" type="button"
          data-task-action="delete" data-task-id="${taskId}">
          Delete
        </button>
      </div>
    </article>
  `;
}

/* =====================================================
   FILTER AND SORT TASKS
   ===================================================== */

function getFilteredTasks() {
  const filter = el.taskFilter.value;
  const sort = el.taskSort.value;
  const today = getToday();

  let tasks = [...state.tasks];

  if (filter === "today") {
    tasks = tasks.filter((task) => task.date === today);
  } else if (filter === "upcoming") {
    tasks = tasks.filter(
      (task) => !task.completed && task.date > today
    );
  } else if (filter === "overdue") {
    tasks = tasks.filter(
      (task) => getTaskStatus(task) === "overdue"
    );
  } else if (filter === "completed") {
    tasks = tasks.filter((task) => task.completed);
  } else if (filter === "pending") {
    tasks = tasks.filter((task) => !task.completed);
  }

  if (sort === "date") {
    tasks.sort((a, b) =>
      getTaskDateTime(a).localeCompare(getTaskDateTime(b))
    );
  } else if (sort === "priority") {
    tasks.sort((a, b) => {
      const priorityDifference =
        getPriorityRank(b.priority) - getPriorityRank(a.priority);

      if (priorityDifference !== 0) return priorityDifference;

      return getTaskDateTime(a).localeCompare(getTaskDateTime(b));
    });
  } else if (sort === "newest") {
    tasks.sort((a, b) => {
      const aTime = Number(a.createdAtMs) || 0;
      const bTime = Number(b.createdAtMs) || 0;

      return bTime - aTime;
    });
  } else if (sort === "duration") {
    tasks.sort(
      (a, b) => (Number(b.duration) || 0) - (Number(a.duration) || 0)
    );
  }

  return tasks;
}

function renderTasks() {
  const tasks = getFilteredTasks();

  if (!tasks.length) {
    let title = "No study tasks yet";
    let description =
      "Add a subject, choose a study time, and start building your routine.";

    if (state.tasks.length > 0) {
      title = "No tasks match this filter";
      description =
        "Try another filter or create a new study task.";
    }

    el.taskList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">◷</span>
        <h3>${title}</h3>
        <p>${description}</p>
        ${state.tasks.length === 0
          ? `<button class="secondary-button" id="emptyAddTask" type="button">Create study task</button>`
          : ""}
      </div>
    `;

    const emptyButton = $("emptyAddTask");

    if (emptyButton) {
      emptyButton.addEventListener("click", openCreateTaskModal);
    }

    return;
  }

  el.taskList.innerHTML = tasks.map(renderTaskCard).join("");
}

function renderPage() {
  renderStatistics();
  renderTasks();
}

/* =====================================================
   CREATE TASK
   ===================================================== */

function openCreateTaskModal() {
  state.editingId = null;

  el.taskForm.reset();

  $("taskId").value = "";
  $("taskModalTitle").textContent = "Add a study task";
  $("saveTaskButton").textContent = "Save study task";

  $("taskDate").min = getToday();
  $("taskDate").value = getToday();

  $("taskTime").value = "16:00";
  $("taskDuration").value = "45";
  $("taskPriority").value = "medium";

  showFormError("");
  openModal(el.taskModal);

  $("taskTitle").focus();
}

/* =====================================================
   EDIT TASK
   ===================================================== */

function openEditTaskModal(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);

  if (!task) {
    showMessage("This study task could not be found.", "error");
    return;
  }

  if (task.uid !== state.user?.uid) {
    showMessage("You cannot edit this task.", "error");
    return;
  }

  state.editingId = taskId;

  $("taskId").value = taskId;
  $("taskTitle").value = task.title || "";
  $("taskSubject").value = task.subject || "";
  $("taskTopic").value = task.topic || "";
  $("taskDate").value = task.date || getToday();

  /*
    Existing tasks may have dates in the past.
    Allow editing the task without forcing the user
    to change its date first.
  */
  $("taskDate").min = "";

  $("taskTime").value = task.time || "16:00";
  $("taskDuration").value = String(task.duration || 45);
  $("taskPriority").value = task.priority || "medium";
  $("taskNotes").value = task.notes || "";

  $("taskModalTitle").textContent = "Edit study task";
  $("saveTaskButton").textContent = "Save changes";

  showFormError("");
  openModal(el.taskModal);

  $("taskTitle").focus();
}

/* =====================================================
   VALIDATE AND SAVE TASK
   ===================================================== */

function validateTaskForm(data, existingTask) {
  if (!data.title) {
    return "Enter a title for your study task.";
  }

  if (!data.subject) {
    return "Enter the subject for this study task.";
  }

  if (!data.date) {
    return "Choose a study date.";
  }

  if (!data.time) {
    return "Choose a start time.";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    return "Enter a valid study date.";
  }

  const [year, month, day] = data.date.split("-").map(Number);
  const parsedDate = new Date(year, month - 1, day);

  if (
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  ) {
    return "The selected study date is invalid.";
  }

  if (!existingTask && data.date < getToday()) {
    return "Choose today or a future date for a new task.";
  }

  if (!/^\d{2}:\d{2}$/.test(data.time)) {
    return "Enter a valid start time.";
  }

  const [hours, minutes] = data.time.split(":").map(Number);

  if (hours > 23 || minutes > 59) {
    return "The selected start time is invalid.";
  }

  if (
    !Number.isInteger(data.duration) ||
    data.duration < 5 ||
    data.duration > 720
  ) {
    return "Duration must be between 5 and 720 minutes.";
  }

  if (!["low", "medium", "high"].includes(data.priority)) {
    return "Choose a valid task priority.";
  }

  if (data.title.length > 100) {
    return "Task titles cannot exceed 100 characters.";
  }

  if (data.subject.length > 70) {
    return "Subject names cannot exceed 70 characters.";
  }

  if (data.topic.length > 100) {
    return "Topics cannot exceed 100 characters.";
  }

  if (data.notes.length > 1000) {
    return "Notes cannot exceed 1,000 characters.";
  }

  return null;
}

async function saveTask(event) {
  event.preventDefault();

  if (!state.user) {
    showFormError("Sign in before saving a study task.");
    return;
  }

  const title = $("taskTitle").value.trim();
  const subject = $("taskSubject").value.trim();
  const topic = $("taskTopic").value.trim();
  const date = $("taskDate").value;
  const time = $("taskTime").value;
  const duration = Number($("taskDuration").value);
  const priority = $("taskPriority").value;
  const notes = $("taskNotes").value.trim();

  const data = {
    title,
    subject,
    topic,
    date,
    time,
    duration,
    priority,
    notes
  };

  const existingTask = state.editingId
    ? state.tasks.find((task) => task.id === state.editingId)
    : null;

  const error = validateTaskForm(data, existingTask);

  if (error) {
    showFormError(error);
    return;
  }

  if (state.editingId && !existingTask) {
    showFormError("This task is no longer available. Refresh and try again.");
    return;
  }

  if (existingTask && existingTask.uid !== state.user.uid) {
    showFormError("You do not have permission to edit this task.");
    return;
  }

  const button = $("saveTaskButton");

  button.disabled = true;
  button.textContent = "Saving…";
  showFormError("");

  try {
    const taskData = {
      ...data,
      uid: state.user.uid,
      updatedAt: serverTimestamp()
    };

    if (existingTask) {
      await updateDoc(doc(db, "studyTasks", existingTask.id), taskData);
      closeTaskModal();
      showMessage("Study task updated.");
    } else {
      await addDoc(collection(db, "studyTasks"), {
        ...taskData,
        completed: false,
        createdAt: serverTimestamp()
      });

      closeTaskModal();
      showMessage("Study task saved to your account.");
    }
  } catch (error) {
    console.error("GradeFlow: saving study task failed:", error);

    showFormError(
      error.code === "permission-denied"
        ? "Firestore denied this operation. Check your studyTasks security rule."
        : "Unable to save your task. Check your connection and try again."
    );
  } finally {
    button.disabled = false;
    button.textContent = state.editingId
      ? "Save changes"
      : "Save study task";
  }
}

/* =====================================================
   COMPLETE / REOPEN TASK
   ===================================================== */

async function toggleTask(taskId) {
  if (!state.user) return;

  const task = state.tasks.find((item) => item.id === taskId);

  if (!task || task.uid !== state.user.uid) {
    showMessage("This task is unavailable.", "error");
    return;
  }

  try {
    const nextCompleted = !task.completed;

    await updateDoc(doc(db, "studyTasks", taskId), {
      completed: nextCompleted,
      completedAt: nextCompleted ? serverTimestamp() : null,
      updatedAt: serverTimestamp()
    });

    showMessage(
      nextCompleted
        ? "Study task marked as completed."
        : "Study task reopened."
    );
  } catch (error) {
    console.error("GradeFlow: completing study task failed:", error);

    showMessage(
      error.code === "permission-denied"
        ? "Firestore denied this update. Check your studyTasks security rule."
        : "Unable to update this task. Try again.",
      "error"
    );
  }
}

/* =====================================================
   DELETE TASK
   ===================================================== */

function openDeleteTaskModal(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);

  if (!task) {
    showMessage("This study task could not be found.", "error");
    return;
  }

  if (task.uid !== state.user?.uid) {
    showMessage("You cannot delete this task.", "error");
    return;
  }

  state.deletingId = taskId;
  $("deleteTaskName").textContent = task.title || "Untitled task";

  openModal(el.deleteModal);
}

async function confirmDeleteTask() {
  if (!state.user || !state.deletingId) return;

  const task = state.tasks.find((item) => item.id === state.deletingId);

  if (!task || task.uid !== state.user.uid) {
    closeDeleteModal();
    return;
  }

  const button = $("confirmDeleteButton");
  button.disabled = true;
  button.textContent = "Deleting…";

  try {
    await deleteDoc(doc(db, "studyTasks", task.id));

    closeDeleteModal();
    showMessage("Study task deleted.");
  } catch (error) {
    console.error("GradeFlow: deleting study task failed:", error);

    showMessage(
      error.code === "permission-denied"
        ? "Firestore denied this deletion. Check your studyTasks security rule."
        : "Unable to delete this task. Try again.",
      "error"
    );
  } finally {
    button.disabled = false;
    button.textContent = "Delete task";
  }
}

/* =====================================================
   TASK LIST EVENTS
   ===================================================== */

el.taskList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-task-action]");

  if (!button) return;

  const taskId = button.dataset.taskId;
  const action = button.dataset.taskAction;

  if (action === "toggle") {
    toggleTask(taskId);
  } else if (action === "edit") {
    openEditTaskModal(taskId);
  } else if (action === "delete") {
    openDeleteTaskModal(taskId);
  }
});

el.taskFilter.addEventListener("change", renderTasks);
el.taskSort.addEventListener("change", renderTasks);
el.taskForm.addEventListener("submit", saveTask);

$("addTaskButton").addEventListener("click", openCreateTaskModal);
$("closeTaskModal").addEventListener("click", closeTaskModal);
$("cancelTaskButton").addEventListener("click", closeTaskModal);

$("closeDeleteModal").addEventListener("click", closeDeleteModal);
$("cancelDeleteButton").addEventListener("click", closeDeleteModal);
$("confirmDeleteButton").addEventListener("click", confirmDeleteTask);

el.taskModal.addEventListener("click", (event) => {
  if (event.target === el.taskModal) {
    closeTaskModal();
  }
});

el.deleteModal.addEventListener("click", (event) => {
  if (event.target === el.deleteModal) {
    closeDeleteModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  if (!el.taskModal.hidden) closeTaskModal();
  if (!el.deleteModal.hidden) closeDeleteModal();
});

/* =====================================================
   MOBILE NAVIGATION
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
    showMessage("Unable to sign out. Please try again.", "error");
  }
});

/* =====================================================
   FIRESTORE LISTENER
   ===================================================== */

function stopTaskListener() {
  if (state.unsubscribeTasks) {
    state.unsubscribeTasks();
    state.unsubscribeTasks = null;
  }
}

function listenForTasks(user) {
  const tasksQuery = query(
    collection(db, "studyTasks"),
    where("uid", "==", user.uid)
  );

  state.unsubscribeTasks = onSnapshot(
    tasksQuery,
    (snapshot) => {
      state.tasks = snapshot.docs.map((item) => {
        const data = item.data();
        const createdAtMs =
          data.createdAt && typeof data.createdAt.toMillis === "function"
            ? data.createdAt.toMillis()
            : 0;

        return {
          id: item.id,
          ...data,
          createdAtMs
        };
      });

      renderPage();
    },
    (error) => {
      console.error("GradeFlow: loading study tasks failed:", error);

      el.taskList.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">!</span>
          <h3>Study tasks could not be loaded</h3>
          <p>Check your internet connection and Firestore rules, then refresh the page.</p>
        </div>
      `;

      showMessage("Unable to load study tasks from Firestore.", "error");
    }
  );
}

/* =====================================================
   AUTHENTICATION
   ===================================================== */

onAuthStateChanged(auth, (user) => {
  stopTaskListener();

  if (!user) {
    state.user = null;
    state.tasks = [];
    window.location.href = "../login.html";
    return;
  }

  state.user = user;
  state.authReady = true;

  const displayName =
    user.displayName ||
    (user.email ? user.email.split("@")[0] : "Student");

  const firstLetter = displayName.trim().charAt(0).toUpperCase() || "G";

  $("sidebarUserName").textContent = displayName;
  $("sidebarAvatar").textContent = firstLetter;
  $("headerAvatar").textContent = firstLetter;

  $("headerDate").textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short"
  }).format(new Date());

  $("currentYear").textContent = String(new Date().getFullYear());

  listenForTasks(user);
});

/* =====================================================
   INITIAL SETUP
   ===================================================== */

$("currentYear").textContent = String(new Date().getFullYear());

$("headerDate").textContent = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short"
}).format(new Date());