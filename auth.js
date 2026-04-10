import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ================= SIGN UP ================= */

const signupBtn = document.getElementById("signupBtn");

if (signupBtn) {
  signupBtn.addEventListener("click", async () => {

    const name = document.getElementById("name").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();

    // VALIDATION
    if (!name || !phone || !email || !password) {
      alert("Fill all fields");
      return;
    }

    if (password.length < 6) {
      alert("Password must be at least 6 characters");
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // SAVE USER DATA IN FIRESTORE
      await setDoc(doc(db, "users", user.uid), {
        name,
        phone,
        email,
        createdAt: new Date().toISOString()
      });

      alert("Signup successful. You can now login.");

      window.location.href = "login.html";

    } catch (error) {

      console.log("Signup error:", error.code);

      if (error.code === "auth/email-already-in-use") {
        alert("Email already taken");
      } else if (error.code === "auth/invalid-email") {
        alert("Invalid email format");
      } else {
        alert("Signup failed: " + error.message);
      }
    }
  });
}

/* ================= LOGIN ================= */

const loginBtn = document.getElementById("loginBtn");

if (loginBtn) {
  loginBtn.addEventListener("click", async () => {

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value.trim();

    if (!email || !password) {
      alert("Fill all fields");
      return;
    }

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // GET USER DATA
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      let name = "User";

      if (userSnap.exists()) {
        name = userSnap.data().name;
      }

      alert(`Login successful. Welcome ${name}`);

      window.location.href = "dashboard.html";

    } catch (error) {

      console.log("Login error:", error.code);

      if (error.code === "auth/wrong-password") {
        alert("Wrong password");
      } else if (error.code === "auth/user-not-found") {
        alert("User not found");
      } else {
        alert("Login failed");
      }
    }
  });
}