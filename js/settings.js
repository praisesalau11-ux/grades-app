// ============================================
// GRADEFLOW SETTINGS
// File: js/settings.js
// ============================================

import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ============================================
// ELEMENTS
// ============================================

const statusBox = document.getElementById("settingsStatus");

const themeButtons = document.querySelectorAll("[data-theme-choice]");

const defaultGpaScale = document.getElementById("defaultGpaScale");
const goalReminders = document.getElementById("goalReminders");
const progressReminders = document.getElementById("progressReminders");

const saveAcademicButton = document.getElementById("saveAcademicSettings");
const saveReminderButton = document.getElementById("saveReminderSettings");
const resetPasswordButton = document.getElementById("resetPasswordButton");
const exportHistoryButton = document.getElementById("exportHistoryButton");
const signOutButton = document.getElementById("signOutButton");

// ============================================
// STATE
// ============================================

let currentUser = null;
let savedSettings = {};
let settingsReady = false;

// ============================================
// STATUS MESSAGE
// ============================================

function showStatus(message, kind = "success") {
  if (!statusBox) return;

  statusBox.textContent = message;
  statusBox.dataset.kind = kind;
  statusBox.hidden = false;

  statusBox.scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });
}

function hideStatus() {
  if (!statusBox) return;

  statusBox.hidden = true;
  statusBox.textContent = "";
}

// ============================================
// THEME
// ============================================

function normalizeTheme(value) {
  return value === "light" ? "light" : "dark";
}

function applyTheme(theme) {
  const selectedTheme = normalizeTheme(theme);

  document.documentElement.dataset.theme = selectedTheme;

  try {
    localStorage.setItem("gradeflow-theme", selectedTheme);
  } catch (error) {
    console.warn("Theme could not be stored on this device.", error);
  }

  themeButtons.forEach((button) => {
    const selected = button.dataset.themeChoice === selectedTheme;
    button.setAttribute("aria-pressed", String(selected));
  });
}

themeButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const theme = normalizeTheme(button.dataset.themeChoice);

    applyTheme(theme);
    hideStatus();

    if (currentUser && settingsReady) {
      try {
        await saveUserSettings({ theme });
        showStatus("Theme preference saved.", "success");
      } catch (error) {
        console.error("Could not save theme preference:", error);
        showStatus(
          "Theme changed on this device, but the account preference could not be saved.",
          "error"
        );
      }
    } else {
      showStatus("Theme changed on this device.", "success");
    }
  });
});

// Apply the saved device theme immediately.
applyTheme(
  document.documentElement.dataset.theme ||
  getDeviceTheme()
);

function getDeviceTheme() {
  try {
    return localStorage.getItem("gradeflow-theme") || "dark";
  } catch {
    return "dark";
  }
}

// ============================================
// FIRESTORE SETTINGS
// Stored in users/{uid}.settings
// Does not replace the whole user document.
// ============================================

async function saveUserSettings(changes) {
  if (!currentUser) {
    throw new Error("You must be signed in to save account preferences.");
  }

  const userRef = doc(db, "users", currentUser.uid);

  const updatedSettings = {
    ...savedSettings,
    ...changes
  };

  await setDoc(
    userRef,
    {
      settings: updatedSettings
    },
    {
      merge: true
    }
  );

  savedSettings = updatedSettings;
}

// ============================================
// LOAD USER SETTINGS
// ============================================

async function loadUserSettings(user) {
  const userRef = doc(db, "users", user.uid);
  const snapshot = await getDoc(userRef);

  const userData = snapshot.exists() ? snapshot.data() : {};
  const accountSettings = userData.settings || {};

  savedSettings = {
    ...accountSettings
  };

  const deviceTheme = getDeviceTheme();
  const theme = normalizeTheme(
    accountSettings.theme || deviceTheme
  );

  applyTheme(theme);

  // Use 4.0 as the default unless a valid preference exists.
  defaultGpaScale.value =
    accountSettings.defaultGpaScale === "5.0" ? "5.0" : "4.0";

  goalReminders.checked =
    accountSettings.goalReminders === true;

  progressReminders.checked =
    accountSettings.progressReminders === true;

  settingsReady = true;
}

// ============================================
// SAVE ACADEMIC PREFERENCES
// ============================================

saveAcademicButton?.addEventListener("click", async () => {
  if (!currentUser || !settingsReady) {
    showStatus("Your account is still loading. Try again shortly.", "error");
    return;
  }

  const scale = defaultGpaScale.value;

  if (!["4.0", "5.0"].includes(scale)) {
    showStatus("Select a valid GPA scale.", "error");
    return;
  }

  saveAcademicButton.disabled = true;
  saveAcademicButton.textContent = "Saving…";

  try {
    await saveUserSettings({
      defaultGpaScale: scale
    });

    showStatus(
      `Your default GPA scale is now ${scale}. This preference will not alter previous results or automatically change the calculator until it is connected to this setting.`,
      "success"
    );
  } catch (error) {
    console.error("Academic settings save error:", error);
    showStatus(
      "Could not save your academic preferences. Check your connection and Firestore rules.",
      "error"
    );
  } finally {
    saveAcademicButton.disabled = false;
    saveAcademicButton.textContent = "Save academic preferences";
  }
});

// ============================================
// SAVE REMINDER PREFERENCES
// ============================================

saveReminderButton?.addEventListener("click", async () => {
  if (!currentUser || !settingsReady) {
    showStatus("Your account is still loading. Try again shortly.", "error");
    return;
  }

  saveReminderButton.disabled = true;
  saveReminderButton.textContent = "Saving…";

  try {
    await saveUserSettings({
      goalReminders: goalReminders.checked,
      progressReminders: progressReminders.checked
    });

    showStatus(
      "Reminder preferences saved. Actual reminders are not sent by these switches yet.",
      "success"
    );
  } catch (error) {
    console.error("Reminder settings save error:", error);
    showStatus(
      "Could not save reminder preferences. Check your connection and Firestore rules.",
      "error"
    );
  } finally {
    saveReminderButton.disabled = false;
    saveReminderButton.textContent = "Save reminder preferences";
  }
});

// ============================================
// PASSWORD RESET
// ============================================

resetPasswordButton?.addEventListener("click", async () => {
  if (!currentUser) {
    showStatus("Sign in before requesting a password reset.", "error");
    return;
  }

  if (!currentUser.email) {
    showStatus(
      "There is no email address available for this account's password reset.",
      "error"
    );
    return;
  }

  const confirmed = window.confirm(
    `Send a password-reset email to ${currentUser.email}?`
  );

  if (!confirmed) return;

  resetPasswordButton.disabled = true;
  resetPasswordButton.textContent = "Sending…";

  try {
    await sendPasswordResetEmail(auth, currentUser.email);

    showStatus(
      `If Firebase accepts the request, a password-reset email will be sent to ${currentUser.email}. Check your inbox and spam folder.`,
      "success"
    );
  } catch (error) {
    console.error("Password reset error:", error);

    if (error.code === "auth/too-many-requests") {
      showStatus("Too many requests. Wait a while and try again.", "error");
    } else if (error.code === "auth/network-request-failed") {
      showStatus("Network error. Check your connection and try again.", "error");
    } else {
      showStatus(
        "The password-reset email could not be requested. Check Firebase Authentication settings and try again.",
        "error"
      );
    }
  } finally {
    resetPasswordButton.disabled = false;
    resetPasswordButton.textContent = "Reset password";
  }
});

// ============================================
// EXPORT SAVED HISTORY
// ============================================

exportHistoryButton?.addEventListener("click", async () => {
  if (!currentUser) {
    showStatus("Sign in before exporting your history.", "error");
    return;
  }

  exportHistoryButton.disabled = true;
  exportHistoryButton.textContent = "Preparing…";

  try {
    const historyQuery = query(
      collection(db, "history"),
      where("uid", "==", currentUser.uid)
    );

    const snapshot = await getDocs(historyQuery);

    const records = snapshot.docs.map((historyDoc) => {
      const data = historyDoc.data();

      return {
        id: historyDoc.id,
        ...data,
        time: data.time && typeof data.time.toDate === "function"
          ? data.time.toDate().toISOString()
          : data.time ?? null
      };
    });

    const exportData = {
      app: "GradeFlow",
      exportedAt: new Date().toISOString(),
      account: {
        uid: currentUser.uid,
        email: currentUser.email || null
      },
      calculationCount: records.length,
      history: records
    };

    const file = new Blob(
      [JSON.stringify(exportData, null, 2)],
      { type: "application/json;charset=utf-8" }
    );

    const url = URL.createObjectURL(file);
    const link = document.createElement("a");

    link.href = url;
    link.download = `gradeflow-history-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);

    showStatus(
      `Export prepared. ${records.length} saved calculation(s) included.`,
      "success"
    );
  } catch (error) {
    console.error("History export error:", error);

    showStatus(
      "History could not be exported. Check your connection and Firestore access.",
      "error"
    );
  } finally {
    exportHistoryButton.disabled = false;
    exportHistoryButton.textContent = "Export data";
  }
});

// ============================================
// SIGN OUT
// ============================================

signOutButton?.addEventListener("click", async () => {
  const confirmed = window.confirm("Are you sure you want to sign out?");

  if (!confirmed) return;

  signOutButton.disabled = true;
  signOutButton.textContent = "Signing out…";

  try {
    await signOut(auth);
    window.location.replace("../login.html");
  } catch (error) {
    console.error("Sign-out error:", error);

    showStatus("Could not sign out. Try again.", "error");
    signOutButton.disabled = false;
    signOutButton.textContent = "Sign out";
  }
});

// ============================================
// AUTHENTICATION STATE
// ============================================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("../login.html");
    return;
  }

  currentUser = user;
  settingsReady = false;

  try {
    await loadUserSettings(user);
  } catch (error) {
    console.error("Could not load GradeFlow settings:", error);

    showStatus(
      "Settings could not be loaded from your account. Check your connection and Firestore rules.",
      "error"
    );
  }
});