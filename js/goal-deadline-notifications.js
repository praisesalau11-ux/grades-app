
import { auth, db } from "./firebase.js";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
    collection,
    doc,
    getDoc,
    onSnapshot,
    query,
    serverTimestamp,
    setDoc,
    where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let stopWatchingGoals = null;
const remindersBeingCreated = new Set();

async function createDeadlineReminder(user, goalDocument) {
    const goal = goalDocument.data();

    if (goal.completed === true || !goal.deadline) return;

    const deadlineDate = String(goal.deadline).slice(0, 10);

    // Expected deadline format: YYYY-MM-DD.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineDate)) return;

    const deadline = new Date(`${deadlineDate}T00:00:00`);
    if (Number.isNaN(deadline.getTime())) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const daysRemaining = Math.round(
        (deadline.getTime() - today.getTime()) / 86400000
    );

    // Only notify for goals due within the next three days or overdue.
    if (daysRemaining > 3) return;

    // Respect the user's saved reminder preference, if one exists.
    const userSnapshot = await getDoc(doc(db, "users", user.uid));
    const settings = userSnapshot.exists()
        ? userSnapshot.data().settings || {}
        : {};

    if (settings.goalReminders === false) return;

    const notificationId =
        `goal_deadline_${goalDocument.id}_${deadlineDate}`;

    // Prevent duplicate requests if Firestore emits another snapshot while
    // the first reminder for this goal is still being checked/created.
    const inFlightKey = `${user.uid}:${notificationId}`;
    if (remindersBeingCreated.has(inFlightKey)) return;
    remindersBeingCreated.add(inFlightKey);

    try {
        const notificationRef = doc(
            db,
            "users",
            user.uid,
            "notifications",
            notificationId
        );

        // Do not recreate the same reminder on every page update.
        const existing = await getDoc(notificationRef);
        if (existing.exists()) return;

    let message;

    if (daysRemaining < 0) {
        message = `"${goal.title || "Your academic goal"}" is overdue. Review your progress and update your deadline if needed.`;
    } else if (daysRemaining === 0) {
        message = `"${goal.title || "Your academic goal"}" is due today. Check your progress.`;
    } else {
        message = `"${goal.title || "Your academic goal"}" is due in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}.`;
    }

        await setDoc(notificationRef, {
            title: daysRemaining < 0
                ? "Academic goal overdue"
                : "Academic goal deadline approaching",
            message,
            type: "goal",
            read: false,
            createdAt: serverTimestamp()
        });
    } finally {
        remindersBeingCreated.delete(inFlightKey);
    }
}

onAuthStateChanged(auth, (user) => {
    if (stopWatchingGoals) {
        stopWatchingGoals();
        stopWatchingGoals = null;
    }

    if (!user) return;

    const goalsQuery = query(
        collection(db, "goals"),
        where("uid", "==", user.uid)
    );

    stopWatchingGoals = onSnapshot(
        goalsQuery,
        (snapshot) => {
            snapshot.docs.forEach((goalDocument) => {
                createDeadlineReminder(user, goalDocument).catch((error) => {
                    console.error(
                        "GradeFlow goal reminder error:",
                        error
                    );
                });
            });
        },
        (error) => {
            console.error(
                "GradeFlow goal reminder listener error:",
                error
            );
        }
    );
});
