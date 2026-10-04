/* ==========================================
   GRADEFLOW
   File: js/login.js

   Email + Password Login
   Google Login
   Custom Resend Password Reset
========================================== */

import { auth } from "./firebase.js";

import {
    signInWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";


/* ==========================================
   GRADEFLOW BACKEND
========================================== */

const BACKEND_URL =
    "https://grades-app-6qgy.onrender.com";


/* ==========================================
   DOM
========================================== */

const loginForm =
    document.getElementById("loginForm");

const emailInput =
    document.getElementById("email");

const passwordInput =
    document.getElementById("password");

const loginButton =
    document.getElementById("loginButton");

const googleLogin =
    document.getElementById("googleLogin");

const passwordToggle =
    document.getElementById("passwordToggle");

const forgotPassword =
    document.getElementById("forgotPassword");

const backButton =
    document.getElementById("backButton");

const emailError =
    document.getElementById("emailError");

const passwordError =
    document.getElementById("passwordError");

const loginMessage =
    document.getElementById("loginMessage");


/* ==========================================
   START
========================================== */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        initializePasswordToggle();

        initializeLogin();

        initializeGoogleLogin();

        initializePasswordReset();

        initializeBackButton();

    }
);


/* ==========================================
   PASSWORD TOGGLE
========================================== */

function initializePasswordToggle() {

    if (
        !passwordToggle ||
        !passwordInput
    ) {
        return;
    }


    passwordToggle.addEventListener(
        "click",
        () => {

            const isPassword =
                passwordInput.type ===
                "password";


            passwordInput.type =
                isPassword
                    ? "text"
                    : "password";


            passwordToggle.textContent =
                isPassword
                    ? "Hide"
                    : "Show";


            passwordToggle.setAttribute(
                "aria-label",
                isPassword
                    ? "Hide password"
                    : "Show password"
            );

        }
    );

}


/* ==========================================
   EMAIL LOGIN
========================================== */

function initializeLogin() {

    if (!loginForm) {
        return;
    }


    loginForm.addEventListener(
        "submit",
        async (event) => {

            event.preventDefault();

            clearErrors();

            clearMessage();


            const email =
                emailInput?.value
                    .trim()
                    .toLowerCase() || "";


            const password =
                passwordInput?.value || "";


            let valid = true;


            if (!email) {

                showFieldError(
                    emailInput,
                    emailError,
                    "Enter your email address."
                );

                valid = false;

            } else if (!isValidEmail(email)) {

                showFieldError(
                    emailInput,
                    emailError,
                    "Enter a valid email address."
                );

                valid = false;

            }


            if (!password) {

                showFieldError(
                    passwordInput,
                    passwordError,
                    "Enter your password."
                );

                valid = false;

            }


            if (!valid) {
                return;
            }


            setLoginLoading(true);


            try {

                await signInWithEmailAndPassword(
                    auth,
                    email,
                    password
                );


                showMessage(
                    "Login successful. Opening GradeFlow...",
                    "success"
                );


                setTimeout(
                    () => {
                        navigateTo(
                            "dashboard.html"
                        );
                    },
                    400
                );


            } catch (error) {

                console.error(
                    "Email login error:",
                    error
                );


                showMessage(
                    getLoginErrorMessage(error),
                    "error"
                );


                setLoginLoading(false);

            }

        }
    );

}


/* ==========================================
   GOOGLE LOGIN
========================================== */

function initializeGoogleLogin() {

    if (!googleLogin) {
        return;
    }


    googleLogin.addEventListener(
        "click",
        async () => {

            if (
                googleLogin.disabled
            ) {
                return;
            }


            setGoogleLoading(true);

            clearMessage();


            try {

                const provider =
                    new GoogleAuthProvider();


                provider.setCustomParameters({
                    prompt:
                        "select_account"
                });


                await signInWithPopup(
                    auth,
                    provider
                );


                showMessage(
                    "Login successful. Opening GradeFlow...",
                    "success"
                );


                setTimeout(
                    () => {
                        navigateTo(
                            "dashboard.html"
                        );
                    },
                    400
                );


            } catch (error) {

                console.error(
                    "Google login error:",
                    error
                );


                showMessage(
                    getGoogleLoginErrorMessage(
                        error
                    ),
                    "error"
                );


                setGoogleLoading(false);

            }

        }
    );

}


/* ==========================================
   PASSWORD RESET
========================================== */

function initializePasswordReset() {

    if (!forgotPassword) {
        return;
    }


    forgotPassword.addEventListener(
        "click",
        async (event) => {

            event.preventDefault();

            clearErrors();

            clearMessage();


            const email =
                emailInput?.value
                    .trim()
                    .toLowerCase() || "";


            if (!email) {

                showFieldError(
                    emailInput,
                    emailError,
                    "Enter your email first."
                );

                emailInput?.focus();

                return;
            }


            if (!isValidEmail(email)) {

                showFieldError(
                    emailInput,
                    emailError,
                    "Enter a valid email address."
                );

                emailInput?.focus();

                return;
            }


            setForgotPasswordLoading(
                true
            );


            showMessage(
                "Preparing your password reset...",
                "info"
            );


            try {

                const response =
                    await fetch(
                        `${BACKEND_URL}/api/auth/forgot-password`,
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({
                                email
                            })
                        }
                    );


                let data = null;


                try {

                    data =
                        await response.json();

                } catch {

                    data = null;

                }


                if (!response.ok) {

                    throw new Error(
                        data?.message ||
                        "Password reset request failed."
                    );

                }


                showMessage(
                    data?.message ||
                    "If the account exists, a password reset email has been sent.",
                    "success"
                );


            } catch (error) {

                console.error(
                    "Password reset error:",
                    error
                );


                showMessage(
                    getPasswordResetErrorMessage(
                        error
                    ),
                    "error"
                );

            } finally {

                setForgotPasswordLoading(
                    false
                );

            }

        }
    );

}


/* ==========================================
   BACK BUTTON
========================================== */

function initializeBackButton() {

    if (!backButton) {
        return;
    }


    backButton.addEventListener(
        "click",
        (event) => {

            event.preventDefault();

            navigateTo(
                "screen.html"
            );

        }
    );

}


/* ==========================================
   FORGOT PASSWORD LOADING
========================================== */

function setForgotPasswordLoading(
    loading
) {

    if (!forgotPassword) {
        return;
    }


    if (loading) {

        forgotPassword.dataset
            .originalText =
            forgotPassword.textContent;

        forgotPassword.textContent =
            "Sending...";

        forgotPassword.disabled =
            true;

    } else {

        forgotPassword.textContent =
            forgotPassword.dataset
                .originalText ||
            "Forgot password?";

        forgotPassword.disabled =
            false;

    }

}


/* ==========================================
   LOGIN LOADING
========================================== */

function setLoginLoading(
    loading
) {

    if (!loginButton) {
        return;
    }


    loginButton.disabled =
        loading;


    if (loading) {

        loginButton.innerHTML = `
            <span>Logging in...</span>
            <span>…</span>
        `;

    } else {

        loginButton.innerHTML = `
            <span>Log in</span>
            <span aria-hidden="true">→</span>
        `;

    }

}


/* ==========================================
   GOOGLE LOADING
========================================== */

function setGoogleLoading(
    loading
) {

    if (!googleLogin) {
        return;
    }


    googleLogin.disabled =
        loading;


    if (loading) {

        googleLogin.innerHTML = `
            <span class="google-icon">G</span>

            <span class="google-content">
                <strong>Opening Google...</strong>
                <small>Choose your account</small>
            </span>

            <span class="google-arrow">
                →
            </span>
        `;

    } else {

        googleLogin.innerHTML = `
            <span class="google-icon">G</span>

            <span class="google-content">
                <strong>Continue with Google</strong>
                <small>Use your Google account</small>
            </span>

            <span class="google-arrow">
                →
            </span>
        `;

    }

}


/* ==========================================
   VALIDATION
========================================== */

function isValidEmail(email) {

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        .test(email);

}


/* ==========================================
   FIELD ERROR
========================================== */

function showFieldError(
    input,
    errorElement,
    message
) {

    if (input) {
        input.classList.add(
            "input-error"
        );
    }


    if (errorElement) {
        errorElement.textContent =
            message;
    }

}


/* ==========================================
   CLEAR ERRORS
========================================== */

function clearErrors() {

    if (emailInput) {

        emailInput.classList.remove(
            "input-error"
        );

    }


    if (passwordInput) {

        passwordInput.classList.remove(
            "input-error"
        );

    }


    if (emailError) {
        emailError.textContent = "";
    }


    if (passwordError) {
        passwordError.textContent = "";
    }

}


/* ==========================================
   MESSAGE
========================================== */

function showMessage(
    message,
    type = "info"
) {

    if (!loginMessage) {
        return;
    }


    loginMessage.textContent =
        message;


    loginMessage.className =
        "login-message";


    loginMessage.classList.add(
        type
    );

}


/* ==========================================
   CLEAR MESSAGE
========================================== */

function clearMessage() {

    if (!loginMessage) {
        return;
    }


    loginMessage.textContent = "";

    loginMessage.className =
        "login-message";

}


/* ==========================================
   LOGIN ERRORS
========================================== */

function getLoginErrorMessage(
    error
) {

    switch (error?.code) {

        case "auth/invalid-credential":
            return "The email or password is incorrect.";

        case "auth/invalid-email":
            return "The email address is not valid.";

        case "auth/user-disabled":
            return "This GradeFlow account has been disabled.";

        case "auth/user-not-found":
            return "No GradeFlow account was found with this email.";

        case "auth/wrong-password":
            return "The password is incorrect.";

        case "auth/too-many-requests":
            return "Too many login attempts. Please wait and try again.";

        case "auth/network-request-failed":
            return "Network error. Check your internet connection.";

        default:
            return "Login could not be completed. Please try again.";

    }

}


/* ==========================================
   GOOGLE ERRORS
========================================== */

function getGoogleLoginErrorMessage(
    error
) {

    switch (error?.code) {

        case "auth/popup-closed-by-user":
            return "Google login was cancelled.";

        case "auth/popup-blocked":
            return "Your browser blocked the Google popup.";

        case "auth/cancelled-popup-request":
            return "The Google login request was cancelled.";

        case "auth/network-request-failed":
            return "Network error. Check your internet connection.";

        case "auth/account-exists-with-different-credential":
            return "This email already has an account using another sign-in method.";

        case "auth/unauthorized-domain":
            return "This website is not authorized for Google login in Firebase.";

        case "auth/operation-not-allowed":
            return "Google Sign-In is not enabled in Firebase Authentication.";

        default:
            return "Google login could not be completed. Please try again.";

    }

}


/* ==========================================
   PASSWORD RESET ERRORS
========================================== */

function getPasswordResetErrorMessage(
    error
) {

    const message =
        error?.message || "";


    if (
        message.includes("Failed to fetch") ||
        message.includes("NetworkError") ||
        message.includes("fetch")
    ) {

        return "Could not connect to GradeFlow's password reset service.";

    }


    return (
        message ||
        "Password reset could not be requested. Please try again."
    );

}


/* ==========================================
   NAVIGATION
========================================== */

function navigateTo(url) {

    if (!url) {
        return;
    }


    if (
        document.startViewTransition
    ) {

        document.startViewTransition(
            () => {
                window.location.href =
                    url;
            }
        );

        return;
    }


    window.location.href =
        url;

}


/* ==========================================
   KEYBOARD SHORTCUTS
========================================== */

document.addEventListener(
    "keydown",
    (event) => {

        if (
            event.target.tagName ===
                "INPUT" ||
            event.target.tagName ===
                "TEXTAREA" ||
            event.target.tagName ===
                "SELECT"
        ) {
            return;
        }


        const key =
            event.key.toLowerCase();


        if (key === "b") {
            backButton?.click();
        }


        if (key === "g") {
            googleLogin?.click();
        }

    }
);