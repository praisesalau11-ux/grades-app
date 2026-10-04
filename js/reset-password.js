/* ==========================================
   GRADEFLOW
   File: js/reset-password.js

   Firebase REST Password Reset
========================================== */


/* ==========================================
   FIREBASE
========================================== */

const FIREBASE_API_KEY =
    "AIzaSyDU7Pn3sURG2ggj1d7b4g4lsbbNqiHZG00";


/* ==========================================
   DOM
========================================== */

const resetForm =
    document.getElementById(
        "resetForm"
    );

const newPassword =
    document.getElementById(
        "newPassword"
    );

const confirmPassword =
    document.getElementById(
        "confirmPassword"
    );

const resetButton =
    document.getElementById(
        "resetButton"
    );

const passwordToggle =
    document.getElementById(
        "passwordToggle"
    );

const confirmToggle =
    document.getElementById(
        "confirmToggle"
    );

const passwordError =
    document.getElementById(
        "passwordError"
    );

const confirmError =
    document.getElementById(
        "confirmError"
    );

const resetMessage =
    document.getElementById(
        "resetMessage"
    );

const resetState =
    document.getElementById(
        "resetState"
    );

const successState =
    document.getElementById(
        "successState"
    );

const errorState =
    document.getElementById(
        "errorState"
    );

const errorText =
    document.getElementById(
        "errorText"
    );


/* ==========================================
   GET OOB CODE
========================================== */

const params =
    new URLSearchParams(
        window.location.search
    );

const oobCode =
    params.get("oobCode");


/* ==========================================
   START
========================================== */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        initializePasswordToggle();

        initializeConfirmToggle();

        validateResetCode();

        initializeForm();

    }
);


/* ==========================================
   CHECK RESET CODE
========================================== */

async function validateResetCode() {

    if (!oobCode) {

        showInvalidReset(
            "This password reset link is missing its reset code."
        );

        return;

    }


    try {

        const response =
            await fetch(
                `https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        oobCode
                    })
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            console.error(
                "Reset code validation failed:",
                data
            );


            showInvalidReset(
                getResetErrorMessage(
                    data?.error?.message
                )
            );


            return;

        }


        /*
         * Firebase has confirmed that the
         * reset code is valid.
         */

        resetForm.dataset.valid =
            "true";

    } catch (error) {

        console.error(
            "Reset validation error:",
            error
        );


        showInvalidReset(
            "Could not verify this reset link. Check your internet connection and try again."
        );

    }

}


/* ==========================================
   FORM
========================================== */

function initializeForm() {

    if (!resetForm) {
        return;
    }


    resetForm.addEventListener(
        "submit",
        async (event) => {

            event.preventDefault();

            clearErrors();


            const password =
                newPassword?.value || "";


            const confirmation =
                confirmPassword?.value || "";


            if (
                resetForm.dataset.valid !==
                "true"
            ) {

                showMessage(
                    "This password reset link is invalid or expired.",
                    "error"
                );

                return;

            }


            let valid = true;


            if (password.length < 6) {

                if (passwordError) {

                    passwordError.textContent =
                        "Password must be at least 6 characters.";

                }

                valid = false;

            }


            if (
                confirmation !==
                password
            ) {

                if (confirmError) {

                    confirmError.textContent =
                        "Passwords do not match.";

                }

                valid = false;

            }


            if (!valid) {
                return;
            }


            setLoading(true);


            try {

                const response =
                    await fetch(
                        `https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({
                                oobCode,
                                newPassword:
                                    password
                            })
                        }
                    );


                const data =
                    await response.json();


                if (!response.ok) {

                    throw new Error(
                        data?.error?.message ||
                        "PASSWORD_RESET_FAILED"
                    );

                }


                showSuccess();


            } catch (error) {

                console.error(
                    "Password reset error:",
                    error
                );


                showMessage(
                    getResetErrorMessage(
                        error?.message
                    ),
                    "error"
                );


                setLoading(false);

            }

        }
    );

}


/* ==========================================
   PASSWORD TOGGLE
========================================== */

function initializePasswordToggle() {

    passwordToggle?.addEventListener(
        "click",
        () => {

            const hidden =
                newPassword.type ===
                "password";


            newPassword.type =
                hidden
                    ? "text"
                    : "password";


            passwordToggle.textContent =
                hidden
                    ? "Hide"
                    : "Show";

        }
    );

}


/* ==========================================
   CONFIRM TOGGLE
========================================== */

function initializeConfirmToggle() {

    confirmToggle?.addEventListener(
        "click",
        () => {

            const hidden =
                confirmPassword.type ===
                "password";


            confirmPassword.type =
                hidden
                    ? "text"
                    : "password";


            confirmToggle.textContent =
                hidden
                    ? "Hide"
                    : "Show";

        }
    );

}


/* ==========================================
   LOADING
========================================== */

function setLoading(
    loading
) {

    if (!resetButton) {
        return;
    }


    resetButton.disabled =
        loading;


    if (loading) {

        resetButton.innerHTML = `
            <span>Updating password...</span>
            <span>…</span>
        `;

    } else {

        resetButton.innerHTML = `
            <span>Reset password</span>
            <span>→</span>
        `;

    }

}


/* ==========================================
   SUCCESS
========================================== */

function showSuccess() {

    resetState?.classList.add(
        "hidden"
    );

    errorState?.classList.add(
        "hidden"
    );

    successState?.classList.remove(
        "hidden"
    );

}


/* ==========================================
   INVALID RESET
========================================== */

function showInvalidReset(
    message
) {

    resetState?.classList.add(
        "hidden"
    );

    successState?.classList.add(
        "hidden"
    );

    errorState?.classList.remove(
        "hidden"
    );


    if (errorText) {
        errorText.textContent =
            message;
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


/* ==========================================
   CLEAR ERRORS
========================================== */

function clearErrors() {

    if (passwordError) {
        passwordError.textContent = "";
    }


    if (confirmError) {
        confirmError.textContent = "";
    }


    if (resetMessage) {

        resetMessage.textContent = "";

        resetMessage.className =
            "reset-message";

    }

}


/* ==========================================
   FIREBASE ERRORS
========================================== */

function getResetErrorMessage(
    code
) {

    switch (code) {

        case "EXPIRED_OOB_CODE":
            return "This password reset link has expired. Request a new one.";

        case "INVALID_OOB_CODE":
            return "This password reset link is invalid or has already been used.";

        case "USER_DISABLED":
            return "This GradeFlow account has been disabled.";

        case "WEAK_PASSWORD":
            return "Choose a stronger password.";

        case "OPERATION_NOT_ALLOWED":
            return "Password sign-in is not enabled for this account.";

        case "TOO_MANY_ATTEMPTS_TRY_LATER":
            return "Too many attempts. Please wait and try again.";

        default:
            return "The password reset link is invalid or expired.";

    }

}