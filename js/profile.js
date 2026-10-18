
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const form = document.getElementById("profileForm");
const fields = document.getElementById("profileFields");
const saveButton = document.getElementById("saveButton");
const resetButton = document.getElementById("resetButton");
const message = document.getElementById("pageMessage");

const avatar = document.getElementById("profileAvatar");
const displayName = document.getElementById("profileDisplayName");
const emailDisplay = document.getElementById("profileEmailDisplay");

const input = {
  fullName: document.getElementById("fullName"),
  username: document.getElementById("username"),
  email: document.getElementById("email"),
  phone: document.getElementById("phone"),
  country: document.getElementById("country"),
  dob: document.getElementById("dob"),
  gender: document.getElementById("gender"),
  school: document.getElementById("school"),
  course: document.getElementById("course"),
  classLevel: document.getElementById("classLevel")
};

let currentUser = null;
let originalValues = {};
let loadingProfile = false;

function clean(value) {
  return String(value ?? "").trim();
}

function getInitials(name) {
  const parts = clean(name).split(/\s+/).filter(Boolean);

  if (!parts.length) return "G";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return (
    parts[0][0] + parts[parts.length - 1][0]
  ).toUpperCase();
}

function showMessage(text, type = "info") {
  message.textContent = text;
  message.className = `message ${type}`;
  message.hidden = false;
}

function hideMessage() {
  message.hidden = true;
  message.textContent = "";
}

function getFieldValues() {
  return {
    fullName: clean(input.fullName.value),
    username: clean(input.username.value),
    phone: clean(input.phone.value),
    country: clean(input.country.value),
    dob: input.dob.value,
    gender: input.gender.value,
    school: clean(input.school.value),
    course: clean(input.course.value),
    classLevel: clean(input.classLevel.value)
  };
}

function updateHeader(name, email) {
  displayName.textContent = name || "GradeFlow student";
  emailDisplay.textContent = email || "No email available";
  avatar.textContent = getInitials(name);
}

function setFormValues(data, user) {
  const name =
    data.name ||
    data.displayName ||
    [data.firstName, data.lastName].filter(Boolean).join(" ") ||
    user.displayName ||
    "";

  input.fullName.value = name;
  input.username.value = data.username || "";
  input.email.value = user.email || data.email || "";
  input.phone.value = data.phone || data.phoneNumber || "";
  input.country.value = data.country || "";
  input.dob.value = data.dob || data.dateOfBirth || "";
  input.gender.value = data.gender || "";
  input.school.value = data.school || data.institution || "";
  input.course.value = data.course || data.programme || "";

  const classes = data.classes;
  input.classLevel.value =
    data.classLevel ||
    data.academicLevel ||
    (Array.isArray(classes) ? classes.join(", ") : classes || "");

  updateHeader(name, user.email);
  originalValues = getFieldValues();
}

async function loadProfile(user) {
  loadingProfile = true;
  fields.disabled = true;
  hideMessage();

  try {
    const userRef = doc(db, "users", user.uid);
    const snapshot = await getDoc(userRef);
    const data = snapshot.exists() ? snapshot.data() : {};

    setFormValues(data, user);
    fields.disabled = false;
  } catch (error) {
    console.error("GradeFlow profile load error:", error);
    showMessage(
      "Could not load your profile. Check your connection and Firestore rules, then reload.",
      "error"
    );
  } finally {
    loadingProfile = false;
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("../login.html");
    return;
  }

  currentUser = user;
  await loadProfile(user);
});

resetButton.addEventListener("click", () => {
  if (loadingProfile) return;

  input.fullName.value = originalValues.fullName || "";
  input.phone.value = originalValues.phone || "";
  input.country.value = originalValues.country || "";
  input.dob.value = originalValues.dob || "";
  input.gender.value = originalValues.gender || "";
  input.school.value = originalValues.school || "";
  input.course.value = originalValues.course || "";
  input.classLevel.value = originalValues.classLevel || "";

  updateHeader(input.fullName.value, currentUser?.email);
  hideMessage();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser || loadingProfile) return;

  const values = getFieldValues();

  if (!values.fullName) {
    showMessage("Enter your full name before saving.", "error");
    input.fullName.focus();
    return;
  }

  if (values.dob) {
    const selectedDate = new Date(`${values.dob}T00:00:00`);

    if (Number.isNaN(selectedDate.getTime()) || selectedDate > new Date()) {
      showMessage("Enter a valid date of birth that is not in the future.", "error");
      input.dob.focus();
      return;
    }
  }

  saveButton.disabled = true;
  resetButton.disabled = true;
  saveButton.textContent = "Saving…";
  hideMessage();

  try {
    const nameParts = values.fullName.split(/\s+/).filter(Boolean);

    const profileData = {
      name: values.fullName,
      displayName: values.fullName,
      firstName: nameParts[0] || "",
      lastName: nameParts.slice(1).join(" "),
      phone: values.phone,
      phoneNumber: values.phone,
      country: values.country,
      dob: values.dob,
      dateOfBirth: values.dob,
      gender: values.gender,
      school: values.school,
      course: values.course,
      classLevel: values.classLevel,
      updatedAt: serverTimestamp()
    };

    // Preserve the existing user document and fields.
    await setDoc(
      doc(db, "users", currentUser.uid),
      profileData,
      { merge: true }
    );

    // Keep Firebase Authentication's display name in sync.
    if (currentUser.displayName !== values.fullName) {
      await updateProfile(currentUser, {
        displayName: values.fullName
      });
    }

    originalValues = getFieldValues();
    updateHeader(values.fullName, currentUser.email);

    showMessage("Profile saved successfully.", "success");
  } catch (error) {
    console.error("GradeFlow profile save error:", error);

    if (error.code === "permission-denied") {
      showMessage(
        "Firebase denied this save. Check the existing users/{uid} Firestore rule.",
        "error"
      );
    } else {
      showMessage(
        "Your profile could not be saved. Check your internet connection and try again.",
        "error"
      );
    }
  } finally {
    saveButton.disabled = false;
    resetButton.disabled = false;
    saveButton.textContent = "Save changes";
  }
});
