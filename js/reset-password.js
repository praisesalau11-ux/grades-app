/* ==========================================
GRADEFLOW
File: js/reset-password.js

Firebase Password Reset Handler

Flow:

login.html
↓
Firebase sends reset email
↓
Firebase reset link
↓
reset-password.html
↓
verify oobCode
↓
User creates new password
↓
Firebase updates password
↓
login.html
========================================== */

/* ==========================================
FIREBASE
========================================== */

import { auth } from "./firebase.js";

import {
verifyPasswordResetCode,
confirmPasswordReset
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

/* ==========================================
DOM ELEMENTS
========================================== */

const resetPasswordForm =
document.getElementById(
"resetPasswordForm"
);

const newPasswordInput =
document.getElementById(
"newPassword"
);

const confirmPasswordInput =
document.getElementById(
"confirmPassword"
);

const newPasswordToggle =
document.getElementById(
"newPasswordToggle"
);

const confirmPasswordToggle =
document.getElementById(
"confirmPasswordToggle"
);

const newPasswordError =
document.getElementById(
"newPasswordError"
);

const confirmPasswordError =
document.getElementById(
"confirmPasswordError"
);

const resetButton =
document.getElementById(
"resetButton"
);

const resetMessage =
document.getElementById(
"resetMessage"
);

const strengthBar =
document.getElementById(
"strengthBar"
);

const strengthText =
document.getElementById(
"strengthText"
);

/* ==========================================
RESET CODE
========================================== */

let resetCode = null;

let verifiedEmail = null;

/* ==========================================
PAGE INITIALIZATION
========================================== */

document.addEventListener(
"DOMContentLoaded",
() => {

    initializePasswordToggles();

    initializePasswordStrength();

    initializeResetForm();

    initializeResetCode();

}

);

/* ==========================================
GET FIREBASE RESET CODE
========================================== */

function initializeResetCode() {

/*
 * Firebase normally sends:
 *
 * ?mode=resetPassword&oobCode=XXXXXXXX
 *
 * We need the oobCode.
 */

const params =
    new URLSearchParams(
        window.location.search
    );


const mode =
    params.get("mode");


resetCode =
    params.get("oobCode");


/* ----------------------------------------
   CHECK RESET MODE
---------------------------------------- */

if (
    mode !== "resetPassword"
) {

    showInvalidLink();

    return;

}


/* ----------------------------------------
   CHECK RESET CODE
---------------------------------------- */

if (!resetCode) {

    showInvalidLink();

    return;

}


/* ----------------------------------------
   VERIFY CODE WITH FIREBASE
---------------------------------------- */

verifyResetCode();

}

/* ==========================================
VERIFY RESET CODE
========================================== */

async function verifyResetCode() {

disableForm(true);

showMessage(
    "Verifying your password reset link...",
    "info"
);


try {

    verifiedEmail =
        await verifyPasswordResetCode(
            auth,
            resetCode
        );


    /*
     * The reset link is valid.
     */

    disableForm(false);

    clearMessage();

    newPasswordInput?.focus();


} catch (error) {

    console.error(
        "Password reset verification error:",
        error
    );

    console.error(
        "Firebase error code:",
        error?.code
    );

    console.error(
        "Firebase error message:",
        error?.message
    );


    disableForm(true);

    showMessage(
        getVerificationErrorMessage(
            error
        ),
        "error"
    );

}

}

/* ==========================================
PASSWORD TOGGLES
========================================== */

function initializePasswordToggles() {

if (
    newPasswordToggle &&
    newPasswordInput
) {

    newPasswordToggle.addEventListener(
        "click",
        () => {

            togglePassword(
                newPasswordInput,
                newPasswordToggle
            );

        }
    );

}


if (
    confirmPasswordToggle &&
    confirmPasswordInput
) {

    confirmPasswordToggle.addEventListener(
        "click",
        () => {

            togglePassword(
                confirmPasswordInput,
                confirmPasswordToggle
            );

        }
    );

}

}

function togglePassword(
input,
button
) {

const showing =
    input.type === "text";


input.type =
    showing
        ? "password"
        : "text";


button.textContent =
    showing
        ? "Show"
        : "Hide";


button.setAttribute(
    "aria-label",
    showing
        ? "Show password"
        : "Hide password"
);

}

/* ==========================================
PASSWORD STRENGTH
========================================== */

function initializePasswordStrength() {

if (!newPasswordInput) {
    return;
}


newPasswordInput.addEventListener(
    "input",
    () => {

        updatePasswordStrength(
            newPasswordInput.value
        );

    }
);

}

function updatePasswordStrength(
password
) {

if (!strengthBar || !strengthText) {
    return;
}


if (!password) {

    strengthBar.style.width =
        "0%";

    strengthText.textContent =
        "Enter a password";

    return;

}


let score = 0;


/* Length */

if (password.length >= 6) {
    score++;
}


if (password.length >= 10) {
    score++;
}


/* Lowercase */

if (/[a-z]/.test(password)) {
    score++;
}


/* Uppercase */

if (/[A-Z]/.test(password)) {
    score++;
}


/* Number */

if (/[0-9]/.test(password)) {
    score++;
}


/* Special character */

if (/[^A-Za-z0-9]/.test(password)) {
    score++;
}


const percentage =
    Math.min(
        score / 6 * 100,
        100
    );


strengthBar.style.width =
    `${percentage}%`;


if (score <= 2) {

    strengthText.textContent =
        "Weak password";

} else if (score <= 4) {

    strengthText.textContent =
        "Moderate password";

} else {

    strengthText.textContent =
        "Strong password";

}

}

/* ==========================================
RESET FORM
========================================== */

function initializeResetForm() {

if (!resetPasswordForm) {
    return;
}


resetPasswordForm.addEventListener(
    "submit",
    async (event) => {

        event.preventDefault();


        clearErrors();

        clearMessage();


        const newPassword =
            newPasswordInput?.value || "";


        const confirmPassword =
            confirmPasswordInput?.value || "";


        /* ----------------------------------------
           VALIDATION
        ---------------------------------------- */

        let valid = true;


        if (
            newPassword.length < 6
        ) {

            showFieldError(
                newPasswordInput,
                newPasswordError,
                "Password must be at least 6 characters."
            );

            valid = false;

        }


        if (
            !confirmPassword
        ) {

            showFieldError(
                confirmPasswordInput,
                confirmPasswordError,
                "Confirm your new password."
            );

            valid = false;

        } else if (
            newPassword !== confirmPassword
        ) {

            showFieldError(
                confirmPasswordInput,
                confirmPasswordError,
                "Passwords do not match."
            );

            valid = false;

        }


        if (!valid) {
            return;
        }


        /* ----------------------------------------
           LOADING
        ---------------------------------------- */

        setResetLoading(true);


        try {

            /*
             * Firebase securely changes
             * the password associated
             * with the reset code.
             */

            await confirmPasswordReset(
                auth,
                resetCode,
                newPassword
            );


            /* ----------------------------------------
               SUCCESS
            ---------------------------------------- */

            showMessage(
                "Your password has been reset successfully. Redirecting to login...",
                "success"
            );


            resetPasswordForm.reset();


            updatePasswordStrength("");


            setTimeout(
                () => {

                    window.location.href =
                        "login.html";

                },
                1800
            );


        } catch (error) {

            console.error(
                "Password reset error:",
                error
            );

            console.error(
                "Firebase error code:",
                error?.code
            );

            console.error(
                "Firebase error message:",
                error?.message
            );


            showMessage(
                getResetErrorMessage(
                    error
                ),
                "error"
            );


            setResetLoading(false);

        }

    }
);

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

function clearErrors() {

if (newPasswordInput) {

    newPasswordInput.classList.remove(
        "input-error"
    );

}


if (confirmPasswordInput) {

    confirmPasswordInput.classList.remove(
        "input-error"
    );

}


if (newPasswordError) {

    newPasswordError.textContent =
        "";

}


if (confirmPasswordError) {

    confirmPasswordError.textContent =
        "";

}

}

/* ==========================================
MESSAGE
========================================== */

function showMessage(
message,
type = "info"
) {

if (!resetMessage) {
    return;
}


resetMessage.textContent =
    message;


resetMessage.className =
    "reset-message";


resetMessage.classList.add(
    type
);

}

function clearMessage() {

if (!resetMessage) {
    return;
}


resetMessage.textContent =
    "";

resetMessage.className =
    "reset-message";

}

/* ==========================================
LOADING
========================================== */

function setResetLoading(
loading
) {

if (!resetButton) {
    return;
}


resetButton.disabled =
    loading;


if (loading) {

    resetButton.innerHTML = `
        <span>
            Resetting password...
        </span>

        <span>
            …
        </span>
    `;

} else {

    resetButton.innerHTML = `
        <span>
            Reset password
        </span>

        <span aria-hidden="true">
            →
        </span>
    `;

}

}

/* ==========================================
FORM DISABLED
========================================== */

function disableForm(
disabled
) {

if (newPasswordInput) {

    newPasswordInput.disabled =
        disabled;

}


if (confirmPasswordInput) {

    confirmPasswordInput.disabled =
        disabled;

}


if (newPasswordToggle) {

    newPasswordToggle.disabled =
        disabled;

}


if (confirmPasswordToggle) {

    confirmPasswordToggle.disabled =
        disabled;

}


if (resetButton) {

    resetButton.disabled =
        disabled;

}

}

/* ==========================================
INVALID LINK
========================================== */

function showInvalidLink() {

disableForm(true);


showMessage(
    "This password reset link is missing or invalid. Please request a new password reset email.",
    "error"
);

}

/* ==========================================
VERIFICATION ERRORS
========================================== */

function getVerificationErrorMessage(
error
) {

switch (error?.code) {

    case "auth/expired-action-code":

        return (
            "This password reset link has expired. Please request a new one."
        );


    case "auth/invalid-action-code":

        return (
            "This password reset link is invalid or has already been used."
        );


    case "auth/user-disabled":

        return (
            "This GradeFlow account has been disabled."
        );


    case "auth/user-not-found":

        return (
            "The GradeFlow account associated with this link could not be found."
        );


    case "auth/network-request-failed":

        return (
            "Network error. Check your internet connection and try again."
        );


    default:

        return (
            "This password reset link could not be verified. Please request a new one."
        );

}

}

/* ==========================================
RESET ERRORS
========================================== */

function getResetErrorMessage(
error
) {

switch (error?.code) {

    case "auth/expired-action-code":

        return (
            "This password reset link has expired. Please request a new one."
        );


    case "auth/invalid-action-code":

        return (
            "This password reset link is invalid or has already been used."
        );


    case "auth/weak-password":

        return (
            "This password is too weak. Use at least 6 characters."
        );


    case "auth/user-disabled":

        return (
            "This GradeFlow account has been disabled."
        );


    case "auth/user-not-found":

        return (
            "The GradeFlow account could not be found."
        );


    case "auth/network-request-failed":

        return (
            "Network error. Check your internet connection and try again."
        );


    case "auth/too-many-requests":

        return (
            "Too many requests. Please wait and try again."
        );


    default:

        return (
            "Password reset failed: " +
            (
                error?.code ||
                "unknown error"
            )
        );

}

}