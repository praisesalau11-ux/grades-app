
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const adminLink = document.getElementById("adminSupportLink");

if (adminLink) {
  onAuthStateChanged(auth, async (user) => {
    adminLink.hidden = true;

    if (!user) return;

    try {
      const adminSnapshot = await getDoc(
        doc(db, "admins", user.uid)
      );

      if (!adminSnapshot.exists()) return;

      const adminData = adminSnapshot.data();

      adminLink.hidden = !(
        adminData.role === "admin" &&
        adminData.active === true
      );

    } catch (error) {
      console.error("Could not verify admin navigation:", error);
      adminLink.hidden = true;
    }
  });
}
