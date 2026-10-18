
import { db } from "./firebase.js";

import {
    collection,
    doc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/**
 * Create a notification for one signed-in user.
 * Supplying an id prevents duplicate notifications.
 */
export async function createGradeFlowNotification(
    uid,
    { id, title, message, type = "academic" }
) {
    if (!uid || !title || !message) {
        throw new Error("Notification details are incomplete.");
    }

    const notificationRef = id
        ? doc(db, "users", uid, "notifications", id)
        : doc(collection(db, "users", uid, "notifications"));

    await setDoc(notificationRef, {
        title,
        message,
        type,
        read: false,
        createdAt: serverTimestamp()
    });

    return notificationRef.id;
}
