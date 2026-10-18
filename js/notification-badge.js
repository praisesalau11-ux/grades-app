
import { auth, db } from "./firebase.js";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
    collection,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const countBadge = document.getElementById("notificationCount");
const notificationDot = document.getElementById("notificationDot");

let stopListening = null;

function showUnreadCount(count) {
    if (countBadge) {
        countBadge.textContent = count > 99 ? "99+" : String(count);
        countBadge.hidden = count === 0;
    }

    if (notificationDot) {
        notificationDot.hidden = count === 0;
    }
}

onAuthStateChanged(auth, (user) => {
    if (stopListening) {
        stopListening();
        stopListening = null;
    }

    showUnreadCount(0);

    if (!user) return;

    const notificationsRef = collection(
        db,
        "users",
        user.uid,
        "notifications"
    );

    stopListening = onSnapshot(
        notificationsRef,
        (snapshot) => {
            const unreadCount = snapshot.docs.filter(
                (notification) => notification.data().read !== true
            ).length;

            showUnreadCount(unreadCount);
        },
        (error) => {
            console.error(
                "GradeFlow unread notification count error:",
                error
            );
        }
    );
});
