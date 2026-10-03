/* ==========================================
   GradeFlow 2.0
   File: js/screen.js

   Entry Screen Controller

   This page ONLY handles navigation.

   Authentication itself will happen in:
   - login.html
   - signup.html
   - choice.html
   ========================================== */


/* ==========================================
   DOM
   ========================================== */

const loginOption =
  document.getElementById("loginOption");

const signupOption =
  document.getElementById("signupOption");


/* ==========================================
   INITIALIZE
   ========================================== */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    initializeEntryOptions();

    initializeKeyboardSupport();

  }
);


/* ==========================================
   ENTRY OPTIONS
   ========================================== */

function initializeEntryOptions() {

  /*
   * Login:
   *
   * screen.html
   *      ↓
   * login.html
   *
   * Authentication is handled later
   * by login.js.
   */

  if (loginOption) {

    loginOption.addEventListener(
      "click",
      () => {

        navigateWithTransition(
          "login.html"
        );

      }
    );

  }


  /*
   * Sign Up:
   *
   * screen.html
   *      ↓
   * choice.html
   *
   * choice.html will then let the user
   * choose:
   *
   * Email → signup.html
   * Google → Firebase Google Sign-Up
   */

  if (signupOption) {

    signupOption.addEventListener(
      "click",
      () => {

        navigateWithTransition(
          "choice.html"
        );

      }
    );

  }

}


/* ==========================================
   NAVIGATION TRANSITION
   ========================================== */

function navigateWithTransition(
  destination
) {

  /*
   * Keep navigation simple and reliable.
   *
   * If the browser supports View Transition API,
   * use it.
   *
   * Otherwise use normal navigation.
   */

  if (
    document.startViewTransition
  ) {

    document.startViewTransition(
      () => {

        window.location.href =
          destination;

      }
    );

    return;
  }


  window.location.href =
    destination;

}


/* ==========================================
   KEYBOARD SUPPORT
   ========================================== */

function initializeKeyboardSupport() {

  document.addEventListener(
    "keydown",
    (event) => {

      /*
       * Press L to go to Login.
       */

      if (
        event.key.toLowerCase() === "l" &&
        !isTypingTarget(event.target)
      ) {

        navigateWithTransition(
          "login.html"
        );

      }


      /*
       * Press S to go to Sign Up.
       */

      if (
        event.key.toLowerCase() === "s" &&
        !isTypingTarget(event.target)
      ) {

        navigateWithTransition(
          "choice.html"
        );

      }

    }
  );

}


/* ==========================================
   INPUT CHECK
   ========================================== */

function isTypingTarget(
  element
) {

  if (!element) {
    return false;
  }

  const tag =
    element.tagName.toLowerCase();

  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select"
  );

}