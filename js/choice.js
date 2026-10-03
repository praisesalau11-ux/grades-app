/* ==========================================
   GRADEFLOW
   File: js/choice.js

   Account Creation Method Selection
========================================== */


/* ==========================================
   FIREBASE
========================================== */

import { auth, db } from "./firebase.js";

import {
    GoogleAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
    doc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


/* ==========================================
   DOM ELEMENTS
========================================== */

const pageLoader =
    document.getElementById("pageLoader");

const backButton =
    document.getElementById("backButton");

const googleSignup =
    document.getElementById("googleSignup");

const emailSignup =
    document.getElementById("emailSignup");

const currentYear =
    document.getElementById("currentYear");


/* ==========================================
   PAGE INITIALIZATION
========================================== */

document.addEventListener("DOMContentLoaded", () => {

    initializeYear();

    initializePageReveal();

    initializeNavigation();

    initializeGoogleSignup();

});


/* ==========================================
   YEAR
========================================== */

function initializeYear() {

    if (!currentYear) {
        return;
    }

    currentYear.textContent =
        new Date().getFullYear();

}


/* ==========================================
   PAGE REVEAL
========================================== */

function initializePageReveal() {

    requestAnimationFrame(() => {

        document.body.classList.add("page-ready");

    });

}


/* ==========================================
   NAVIGATION
========================================== */

function initializeNavigation() {

    /* ----------------------------------------
       BACK
    ---------------------------------------- */

    if (backButton) {

        backButton.addEventListener(
            "click",
            (event) => {

                event.preventDefault();

                navigateTo("screen.html");

            }
        );

    }


    /* ----------------------------------------
       EMAIL SIGNUP
    ---------------------------------------- */

    if (emailSignup) {

        emailSignup.addEventListener(
            "click",
            () => {

                navigateTo("signup.html");

            }
        );

    }

}


/* ==========================================
   GOOGLE SIGNUP
========================================== */

function initializeGoogleSignup() {

    if (!googleSignup) {
        return;
    }


    googleSignup.addEventListener(
        "click",
        handleGoogleSignup
    );

}


/* ==========================================
   HANDLE GOOGLE SIGNUP
========================================== */

async function handleGoogleSignup() {

    /*
     * Prevent multiple Google popup requests.
     */

    if (
        googleSignup.classList.contains("loading") ||
        googleSignup.disabled
    ) {
        return;
    }


    /* ==========================================
       SAVE ORIGINAL BUTTON
    ========================================== */

    const originalContent =
        googleSignup.innerHTML;


    /* ==========================================
       LOADING STATE
    ========================================== */

    googleSignup.classList.add("loading");

    googleSignup.disabled = true;

    googleSignup.innerHTML = `
        <span class="option-icon google-icon">
            <span>G</span>
        </span>

        <span class="option-content">
            <strong>Opening Google...</strong>

            <small>
                Choose your Google account
            </small>
        </span>

        <span class="option-arrow">
            →
        </span>
    `;


    try {

        /* ==========================================
           GOOGLE PROVIDER
        ========================================== */

        const provider =
            new GoogleAuthProvider();


        /*
         * Always show Google's account chooser.
         *
         * This lets the user choose which
         * Google account to use for GradeFlow.
         */

        provider.setCustomParameters({
            prompt: "select_account"
        });


        /* ==========================================
           OPEN GOOGLE ACCOUNT SELECTOR
        ========================================== */

        const result =
            await signInWithPopup(
                auth,
                provider
            );


        /* ==========================================
           FIREBASE USER
        ========================================== */

        const user =
            result.user;


        if (!user) {

            throw new Error(
                "Google authentication returned no user."
            );

        }


        console.log(
            "Google account selected:",
            user.email
        );


        /* ==========================================
           USER INFORMATION
        ========================================== */

        const userData = {

            uid:
                user.uid,

            fullName:
                user.displayName || "",

            email:
                user.email || "",

            photoURL:
                user.photoURL || "",

            provider:
                "google",

            profileComplete:
                false,

            updatedAt:
                serverTimestamp()

        };


        /* ==========================================
           CREATE / UPDATE FIRESTORE USER
        ========================================== */

        await setDoc(
            doc(
                db,
                "users",
                user.uid
            ),
            userData,
            {
                merge: true
            }
        );


        /* ==========================================
           SUCCESS STATE
        ========================================== */

        googleSignup.innerHTML = `
            <span class="option-icon google-icon">
                <span>✓</span>
            </span>

            <span class="option-content">
                <strong>Account created</strong>

                <small>
                    Opening GradeFlow...
                </small>
            </span>

            <span class="option-arrow">
                →
            </span>
        `;


        /* ==========================================
           GO TO DASHBOARD
        ========================================== */

        setTimeout(() => {

            navigateTo(
                "dashboard.html"
            );

        }, 500);


    } catch (error) {

        console.error(
            "Google signup error:",
            error
        );


        /* ==========================================
           FIREBASE ERROR MESSAGE
        ========================================== */

        const errorMessage =
            getGoogleErrorMessage(error);


        /* ==========================================
           RESTORE BUTTON
        ========================================== */

        googleSignup.classList.remove(
            "loading"
        );

        googleSignup.disabled = false;

        googleSignup.innerHTML =
            originalContent;


        /* ==========================================
           SHOW ERROR
        ========================================== */

        showGoogleError(
            errorMessage
        );

    }

}


/* ==========================================
   GOOGLE ERROR MESSAGE
========================================== */

function getGoogleErrorMessage(error) {

    switch (error?.code) {

        case "auth/popup-closed-by-user":

            return "Google signup was cancelled.";


        case "auth/popup-blocked":

            return (
                "Your browser blocked the Google popup. " +
                "Allow popups for GradeFlow and try again."
            );


        case "auth/cancelled-popup-request":

            return "The Google signup request was cancelled.";


        case "auth/network-request-failed":

            return (
                "Network error. Check your internet connection " +
                "and try again."
            );


        case "auth/account-exists-with-different-credential":

            return (
                "An account already exists with this email " +
                "using another sign-in method."
            );


        case "auth/operation-not-allowed":

            return (
                "Google Sign-In is not enabled in Firebase Authentication."
            );


        case "auth/unauthorized-domain":

            return (
                "This website is not authorized for Google Sign-In. " +
                "Add the current domain in Firebase Authentication."
            );


        default:

            return (
                error?.message ||
                "Google signup could not be completed. Please try again."
            );

    }

}


/* ==========================================
   SHOW GOOGLE ERROR
========================================== */

function showGoogleError(message) {

    /*
     * Look for an existing message element.
     */

    let errorElement =
        document.getElementById(
            "choiceMessage"
        );


    /*
     * If your HTML already contains
     * #choiceMessage, use it.
     */

    if (errorElement) {

        errorElement.textContent =
            message;

        errorElement.classList.remove(
            "success",
            "loading"
        );

        errorElement.classList.add(
            "error"
        );

        return;

    }


    /*
     * If no message element exists,
     * use a normal browser alert.
     */

    alert(message);

}


/* ==========================================
   NAVIGATION HELPER
========================================== */

function navigateTo(url) {

    if (!url) {
        return;
    }


    /*
     * Use the browser View Transition API
     * when available.
     */

    if (document.startViewTransition) {

        document.startViewTransition(() => {

            window.location.href = url;

        });

        return;

    }


    window.location.href = url;

}


/* ==========================================
   KEYBOARD SHORTCUTS
========================================== */

document.addEventListener(
    "keydown",
    (event) => {

        /*
         * Ignore shortcuts when typing.
         */

        if (
            event.target.tagName === "INPUT" ||
            event.target.tagName === "TEXTAREA" ||
            event.target.tagName === "SELECT"
        ) {
            return;
        }


        const key =
            event.key.toLowerCase();


        /* ----------------------------------------
           E = EMAIL SIGNUP
        ---------------------------------------- */

        if (key === "e") {

            emailSignup?.click();

        }


        /* ----------------------------------------
           G = GOOGLE SIGNUP
        ---------------------------------------- */

        if (key === "g") {

            googleSignup?.click();

        }


        /* ----------------------------------------
           B = BACK
        ---------------------------------------- */

        if (key === "b") {

            backButton?.click();

        }

    }
);


/* ==========================================
   LOADER
========================================== */

window.addEventListener(
    "load",
    () => {

        setTimeout(() => {

            if (pageLoader) {

                pageLoader.classList.add(
                    "hidden"
                );

            }

        }, 350);

    }
);

/* ==========================================
   FORCE CHOICE PAGE REFRESH
========================================== */

window.addEventListener("pageshow", (event) => {

    /*
     * If the page was restored from the browser's
     * back/forward cache, reload it.
     */

    if (event.persisted) {

        window.location.reload();

    }

});