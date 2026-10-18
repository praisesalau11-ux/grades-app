// GradeFlow notification helper
// File: js/notification-helper.js

import {
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { auth, db } from "./firebase.js";

export async function createGradeNotification({
  gpa,
  percentage,
  totalCredits
}) {
  const user = auth.currentUser;

  if (!user) {
    console.warn("Notification skipped: no signed-in user.");
    return false;
  }

  try {
    await addDoc(
      collection(
        db,
        "users",
        user.uid,
        "notifications"
      ),
      {
        title: "GPA result saved",
        message:
          `Your GPA of ${gpa} and percentage of ${percentage}% ` +
          `have been saved successfully. Total credits: ${totalCredits}.`,
        type: "academic",
        read: false,
        createdAt: serverTimestamp()
      }
    );

    console.log("GradeFlow notification created.");
    return true;

  } catch (error) {
    console.error(
      "Could not create GradeFlow notification:",
      error
    );

    return false;
  }
}