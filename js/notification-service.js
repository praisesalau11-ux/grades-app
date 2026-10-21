import {
    doc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { db } from "./firebase.js";

/**
 * Creates an in-app GradeFlow notification.
 * Path: users/{uid}/notifications/{notificationId}
 */
export async function createGradeFlowNotification(uid, notification) {
    if (!uid) {
        throw new Error("A signed-in user is required.");
    }

    if (!notification?.id || !notification?.title || !notification?.message) {
        throw new Error("Notification ID, title, and message are required.");
    }

    const notificationRef = doc(
        db,
        "users",
        uid,
        "notifications",
        notification.id
    );

    await setDoc(notificationRef, {
        title: notification.title,
        message: notification.message,
        type: notification.type || "academic",
        read: false,
        createdAt: serverTimestamp()
    });

    return true;
}
