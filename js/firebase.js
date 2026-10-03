// firebase.js

/* ==========================================
   GradeFlow 2.0
   File: js/firebase.js

   Central Firebase Configuration
   ========================================== */

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ==========================================
   FIREBASE CONFIG
   ========================================== */

const firebaseConfig = {
  apiKey: "AIzaSyDU7Pn3sURG2ggj1d7b4g4lsbbNqiHZG00",
  authDomain: "grades-calculator-72499.firebaseapp.com",
  projectId: "grades-calculator-72499",
  storageBucket: "grades-calculator-72499.firebasestorage.app",
  messagingSenderId: "668421730766",
  appId: "1:668421730766:web:743fe0128e0199ef3bfb9f"
};

/* ==========================================
   INITIALIZE FIREBASE
   ========================================== */

const app = initializeApp(firebaseConfig);

/* ==========================================
   FIREBASE SERVICES
   ========================================== */

export const auth = getAuth(app);

export const db = getFirestore(app);

/* ==========================================
   APP INSTANCE
   ========================================== */

export { app };