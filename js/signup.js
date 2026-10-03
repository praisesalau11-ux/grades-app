// ==========================================
// GradeFlow
// File: js/signup.js
// Worldwide Account Registration
// ==========================================

import {
  auth,
  db
} from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  updateProfile,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  countries
} from "../data/countries.js";

import {
  classes
} from "../data/class.js";


// ==========================================
// DOM
// ==========================================

document.addEventListener("DOMContentLoaded", () => {

  const form = document.getElementById("signupForm");

  if (!form) {
    console.error("GradeFlow: signup form was not found.");
    return;
  }


  // ----------------------------------------
  // Main fields
  // ----------------------------------------

  const fullName = document.getElementById("fullName");
  const email = document.getElementById("email");
  const username = document.getElementById("username");
  const dateOfBirth = document.getElementById("dateOfBirth");
  const gender = document.getElementById("gender");
  const classSelect = document.getElementById("class");
  const country = document.getElementById("country");
  const phone = document.getElementById("phone");
  const password = document.getElementById("password");
  const confirmPassword = document.getElementById("confirmPassword");
  const terms = document.getElementById("terms");


  // ----------------------------------------
  // Other UI
  // ----------------------------------------

  const countryFlag = document.getElementById("countryFlag");
  const countryDialCode = document.getElementById("countryDialCode");

  const usernameStatus =
    document.getElementById("usernameStatus");

  const strengthBar =
    document.getElementById("strengthBar");

  const strengthText =
    document.getElementById("strengthText");

  const createAccountButton =
    document.getElementById("createAccountButton");

  const formMessage =
    document.getElementById("formMessage");

  const pageLoader =
    document.getElementById("pageLoader");

  const currentYear =
    document.getElementById("currentYear");


  // ==========================================
  // INITIAL SETUP
  // ==========================================

  if (currentYear) {
    currentYear.textContent = new Date().getFullYear();
  }

  populateCountries();
  populateClasses();

  setupPasswordToggle();
  setupPasswordStrength();
  setupUsernameChecking();
  setupCountryPhone();
  setupValidationEvents();


  // ==========================================
  // COUNTRY LIST
  // ==========================================

  function populateCountries() {

    if (!country) return;

    country.innerHTML =
      `<option value="">Select your country</option>`;

    countries.forEach((item) => {

      const option = document.createElement("option");

      option.value = item.code;

      option.textContent =
        `${item.flag} ${item.name}`;

      option.dataset.dialCode =
        item.dialCode;

      option.dataset.flag =
        item.flag;

      country.appendChild(option);
    });


    // ----------------------------------------
    // Automatically select Nigeria if present
    // ----------------------------------------

    const nigeria = countries.find(
      (item) => item.code === "NG"
    );

    if (nigeria) {

      country.value = nigeria.code;

      updateCountryInformation();
    }
  }


  // ==========================================
  // CLASS LIST
  // ==========================================

  function populateClasses() {

    if (!classSelect) return;

    classSelect.innerHTML =
      `<option value="">Select your class</option>`;

    classes.forEach((item) => {

      const option = document.createElement("option");

      option.value = item.value;
      option.textContent = item.label;

      classSelect.appendChild(option);
    });
  }


  // ==========================================
  // COUNTRY / PHONE
  // ==========================================

  function setupCountryPhone() {

    if (!country) return;

    country.addEventListener(
      "change",
      updateCountryInformation
    );
  }


  function updateCountryInformation() {

    if (!country) return;

    const selectedCode = country.value;

    const selectedCountry = countries.find(
      (item) => item.code === selectedCode
    );

    if (!selectedCountry) {

      if (countryFlag) {
        countryFlag.textContent = "🌐";
      }

      if (countryDialCode) {
        countryDialCode.textContent = "+";
      }

      return;
    }


    if (countryFlag) {
      countryFlag.textContent =
        selectedCountry.flag;
    }

    if (countryDialCode) {
      countryDialCode.textContent =
        selectedCountry.dialCode;
    }
  }


  // ==========================================
  // PASSWORD SHOW / HIDE
  // ==========================================

  function setupPasswordToggle() {

    const toggleButtons =
      document.querySelectorAll(
        "[data-password-toggle]"
      );

    toggleButtons.forEach((button) => {

      button.addEventListener(
        "click",
        () => {

          const targetId =
            button.dataset.passwordToggle;

          const target =
            document.getElementById(targetId);

          if (!target) return;

          const showing =
            target.type === "text";

          target.type =
            showing ? "password" : "text";

          button.setAttribute(
            "aria-label",
            showing
              ? "Show password"
              : "Hide password"
          );

          button.textContent =
            showing ? "Show" : "Hide";
        }
      );
    });
  }


  // ==========================================
  // PASSWORD STRENGTH
  // ==========================================

  function setupPasswordStrength() {

    if (!password) return;

    password.addEventListener(
      "input",
      () => {

        const value =
          password.value;

        updatePasswordStrength(value);
      }
    );
  }


  function updatePasswordStrength(value) {

    if (!strengthBar || !strengthText) {
      return;
    }

    if (!value) {

      strengthBar.style.width = "0%";
      strengthText.textContent =
        "Password strength";

      strengthBar.dataset.strength =
        "empty";

      return;
    }


    let score = 0;


    // Length
    if (value.length >= 8) {
      score++;
    }

    if (value.length >= 12) {
      score++;
    }


    // Lowercase
    if (/[a-z]/.test(value)) {
      score++;
    }


    // Uppercase
    if (/[A-Z]/.test(value)) {
      score++;
    }


    // Number
    if (/[0-9]/.test(value)) {
      score++;
    }


    // Symbol
    if (/[^A-Za-z0-9]/.test(value)) {
      score++;
    }


    if (score <= 2) {

      strengthBar.style.width = "30%";

      strengthText.textContent =
        "Weak password";

      strengthBar.dataset.strength =
        "weak";

    } else if (score <= 4) {

      strengthBar.style.width = "65%";

      strengthText.textContent =
        "Good password";

      strengthBar.dataset.strength =
        "good";

    } else {

      strengthBar.style.width = "100%";

      strengthText.textContent =
        "Strong password";

      strengthBar.dataset.strength =
        "strong";
    }
  }


  // ==========================================
  // USERNAME
  // ==========================================

  function setupUsernameChecking() {

    if (!username) return;

    let timer = null;

    username.addEventListener(
      "input",
      () => {

        clearTimeout(timer);

        const value =
          normalizeUsername(username.value);

        if (!value) {

          setUsernameStatus(
            "",
            ""
          );

          return;
        }


        if (!isValidUsername(value)) {

          setUsernameStatus(
            "Use 3–20 letters, numbers or underscores.",
            "error"
          );

          return;
        }


        setUsernameStatus(
          "Checking username...",
          "checking"
        );


        timer = setTimeout(
          async () => {

            const available =
              await isUsernameAvailable(value);

            if (available) {

              setUsernameStatus(
                "Username is available.",
                "success"
              );

            } else {

              setUsernameStatus(
                "That username is already taken.",
                "error"
              );
            }

          },
          500
        );
      }
    );
  }


  async function isUsernameAvailable(value) {

    try {

      const usernameRef =
        doc(
          db,
          "usernames",
          normalizeUsername(value)
        );

      const snapshot =
        await getDoc(usernameRef);

      return !snapshot.exists();

    } catch (error) {

      console.error(
        "Username check failed:",
        error
      );

      return false;
    }
  }


  function normalizeUsername(value) {

    return value
      .trim()
      .toLowerCase();
  }


  function isValidUsername(value) {

    return /^[a-z0-9_]{3,20}$/.test(
      value
    );
  }


  function setUsernameStatus(
    message,
    type
  ) {

    if (!usernameStatus) return;

    usernameStatus.textContent =
      message;

    usernameStatus.dataset.status =
      type;
  }


  // ==========================================
  // VALIDATION EVENTS
  // ==========================================

  function setupValidationEvents() {

    const fields = [
      fullName,
      email,
      username,
      dateOfBirth,
      gender,
      classSelect,
      country,
      phone,
      password,
      confirmPassword
    ];

    fields.forEach((field) => {

      if (!field) return;

      field.addEventListener(
        "blur",
        () => {

          validateField(
            field.id
          );
        }
      );
    });


    if (terms) {

      terms.addEventListener(
        "change",
        () => {

          if (terms.checked) {
            clearError("terms");
          }
        }
      );
    }
  }


  // ==========================================
  // FORM SUBMISSION
  // ==========================================

  form.addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();

      clearFormMessage();


      const valid =
        validateForm();

      if (!valid) {

        showFormMessage(
          "Please correct the highlighted fields.",
          "error"
        );

        return;
      }


      const normalizedUsername =
        normalizeUsername(
          username.value
        );

      const normalizedPhone =
        buildInternationalPhone();


      setLoading(true);


      let createdUser = null;

      try {

        // ------------------------------------
        // Final duplicate checks
        // ------------------------------------

        const usernameRef =
          doc(
            db,
            "usernames",
            normalizedUsername
          );

        const phoneRef =
          doc(
            db,
            "phones",
            normalizedPhone
          );


        const existingUsername =
          await getDoc(usernameRef);

        if (existingUsername.exists()) {

          showFieldError(
            "username",
            "That username is already taken."
          );

          setLoading(false);

          return;
        }


        const existingPhone =
          await getDoc(phoneRef);

        if (existingPhone.exists()) {

          showFieldError(
            "phone",
            "That phone number is already registered."
          );

          setLoading(false);

          return;
        }


        // ------------------------------------
        // Create Firebase Authentication user
        // ------------------------------------

        const credential =
          await createUserWithEmailAndPassword(
            auth,
            email.value.trim(),
            password.value
          );

        createdUser =
          credential.user;


        // ------------------------------------
        // Set Firebase display name
        // ------------------------------------

        await updateProfile(
          createdUser,
          {
            displayName:
              fullName.value.trim()
          }
        );


        // ------------------------------------
        // Store profile + uniqueness indexes
        // in ONE Firestore transaction
        // ------------------------------------

        await runTransaction(
          db,
          async (transaction) => {

            const transactionUsername =
              await transaction.get(
                usernameRef
              );

            const transactionPhone =
              await transaction.get(
                phoneRef
              );


            if (
              transactionUsername.exists()
            ) {

              throw new Error(
                "USERNAME_ALREADY_EXISTS"
              );
            }


            if (
              transactionPhone.exists()
            ) {

              throw new Error(
                "PHONE_ALREADY_EXISTS"
              );
            }


            const userRef =
              doc(
                db,
                "users",
                createdUser.uid
              );


            // --------------------------------
            // User profile
            // --------------------------------

            transaction.set(
              userRef,
              {
                uid:
                  createdUser.uid,

                fullName:
                  fullName.value.trim(),

                email:
                  email.value.trim()
                    .toLowerCase(),

                username:
                  normalizedUsername,

                dateOfBirth:
                  dateOfBirth.value,

                gender:
                  gender.value,

                class:
                  classSelect.value,

                country:
                  country.value,

                phone:
                  normalizedPhone,

                createdAt:
                  serverTimestamp(),

                updatedAt:
                  serverTimestamp()
              }
            );


            // --------------------------------
            // Username uniqueness index
            // --------------------------------

            transaction.set(
              usernameRef,
              {
                uid:
                  createdUser.uid,

                username:
                  normalizedUsername,

                createdAt:
                  serverTimestamp()
              }
            );


            // --------------------------------
            // Phone uniqueness index
            // --------------------------------

            transaction.set(
              phoneRef,
              {
                uid:
                  createdUser.uid,

                phone:
                  normalizedPhone,

                createdAt:
                  serverTimestamp()
              }
            );
          }
        );


        // ------------------------------------
        // Success
        // ------------------------------------

        showFormMessage(
          "Your GradeFlow account has been created.",
          "success"
        );


        // Give Firebase a moment to finish
        // before moving to the dashboard.
        setTimeout(
          () => {
            window.location.href =
              "dashboard.html";
          },
          700
        );


      } catch (error) {

        console.error(
          "GradeFlow signup error:",
          error
        );


        // ------------------------------------
        // Username race condition
        // ------------------------------------

        if (
          error.message ===
          "USERNAME_ALREADY_EXISTS"
        ) {

          if (createdUser) {
            await safelyDeleteUser(
              createdUser
            );
          }

          showFieldError(
            "username",
            "That username was just taken. Please choose another."
          );

          setLoading(false);

          return;
        }


        // ------------------------------------
        // Phone race condition
        // ------------------------------------

        if (
          error.message ===
          "PHONE_ALREADY_EXISTS"
        ) {

          if (createdUser) {
            await safelyDeleteUser(
              createdUser
            );
          }

          showFieldError(
            "phone",
            "That phone number was just registered by another account."
          );

          setLoading(false);

          return;
        }


        // ------------------------------------
        // Firebase Auth errors
        // ------------------------------------

        const message =
          getFirebaseErrorMessage(
            error
          );


        showFormMessage(
          message,
          "error"
        );


        setLoading(false);
      }
    }
  );


  // ==========================================
  // FULL FORM VALIDATION
  // ==========================================

  function validateForm() {

    let valid = true;


    const fieldIds = [
      "fullName",
      "email",
      "username",
      "dateOfBirth",
      "gender",
      "class",
      "country",
      "phone",
      "password",
      "confirmPassword"
    ];


    fieldIds.forEach((id) => {

      if (!validateField(id)) {
        valid = false;
      }
    });


    // Terms
    if (
      terms &&
      !terms.checked
    ) {

      showFieldError(
        "terms",
        "You must accept the Terms and Privacy Policy."
      );

      valid = false;
    }


    return valid;
  }


  // ==========================================
  // INDIVIDUAL FIELD VALIDATION
  // ==========================================

  function validateField(fieldId) {

    switch (fieldId) {

      case "fullName":

        if (
          !fullName.value.trim()
        ) {

          showFieldError(
            "fullName",
            "Please enter your full name."
          );

          return false;
        }

        if (
          fullName.value.trim().length < 2
        ) {

          showFieldError(
            "fullName",
            "Your name is too short."
          );

          return false;
        }

        clearError("fullName");

        return true;


      case "email":

        const emailValue =
          email.value.trim();

        if (!emailValue) {

          showFieldError(
            "email",
            "Please enter your email address."
          );

          return false;
        }

        if (
          !isValidEmail(emailValue)
        ) {

          showFieldError(
            "email",
            "Please enter a valid email address."
          );

          return false;
        }

        clearError("email");

        return true;


      case "username":

        const usernameValue =
          normalizeUsername(
            username.value
          );

        if (!usernameValue) {

          showFieldError(
            "username",
            "Please choose a username."
          );

          return false;
        }

        if (
          !isValidUsername(usernameValue)
        ) {

          showFieldError(
            "username",
            "Use 3–20 letters, numbers or underscores."
          );

          return false;
        }

        clearError("username");

        return true;


      case "dateOfBirth":

        if (!dateOfBirth.value) {

          showFieldError(
            "dateOfBirth",
            "Please enter your date of birth."
          );

          return false;
        }

        const dob =
          new Date(
            dateOfBirth.value + "T00:00:00"
          );

        const today =
          new Date();

        if (
          Number.isNaN(
            dob.getTime()
          )
        ) {

          showFieldError(
            "dateOfBirth",
            "Please enter a valid date."
          );

          return false;
        }

        if (dob > today) {

          showFieldError(
            "dateOfBirth",
            "Date of birth cannot be in the future."
          );

          return false;
        }

        clearError("dateOfBirth");

        return true;


      case "gender":

        if (!gender.value) {

          showFieldError(
            "gender",
            "Please select your gender."
          );

          return false;
        }

        clearError("gender");

        return true;


      case "class":

        if (!classSelect.value) {

          showFieldError(
            "class",
            "Please select your class."
          );

          return false;
        }

        clearError("class");

        return true;


      case "country":

        if (!country.value) {

          showFieldError(
            "country",
            "Please select your country."
          );

          return false;
        }

        clearError("country");

        return true;


      case "phone":

        const internationalPhone =
          buildInternationalPhone();

        if (!phone.value.trim()) {

          showFieldError(
            "phone",
            "Please enter your phone number."
          );

          return false;
        }

        if (
          !internationalPhone ||
          !isValidPhone(
            internationalPhone
          )
        ) {

          showFieldError(
            "phone",
            "Please enter a valid phone number."
          );

          return false;
        }

        clearError("phone");

        return true;


      case "password":

        const passwordValue =
          password.value;

        if (!passwordValue) {

          showFieldError(
            "password",
            "Please create a password."
          );

          return false;
        }

        if (
          passwordValue.length < 8
        ) {

          showFieldError(
            "password",
            "Password must contain at least 8 characters."
          );

          return false;
        }

        clearError("password");

        return true;


      case "confirmPassword":

        if (!confirmPassword.value) {

          showFieldError(
            "confirmPassword",
            "Please confirm your password."
          );

          return false;
        }

        if (
          confirmPassword.value !==
          password.value
        ) {

          showFieldError(
            "confirmPassword",
            "Passwords do not match."
          );

          return false;
        }

        clearError("confirmPassword");

        return true;


      default:

        return true;
    }
  }
  
  // ==========================================
  // PHONE NORMALIZATION
  // ==========================================

  function buildInternationalPhone() {

    if (
      !country ||
      !phone
    ) {
      return "";
    }


    const selectedCountry =
      countries.find(
        (item) =>
          item.code === country.value
      );


    if (!selectedCountry) {
      return "";
    }


    let number =
      phone.value.replace(
        /\D/g,
        ""
      );


    // Remove one local leading zero.
    //
    // Example:
    // 08012345678
    // becomes
    // 8012345678
    //
    // Then +234 is added.

    if (
      number.startsWith("0")
    ) {

      number =
        number.substring(1);
    }


    const dialCode =
      selectedCountry.dialCode
        .replace(
          /\D/g,
          ""
        );


    if (
      !number ||
      !dialCode
    ) {
      return "";
    }


    return `+${dialCode}${number}`;
  }


  function isValidPhone(value) {

    // E.164-style validation.
    // Allows international numbers from
    // different countries.

    return /^\+[1-9]\d{7,14}$/.test(
      value
    );
  }


  // ==========================================
  // EMAIL VALIDATION
  // ==========================================

  function isValidEmail(value) {

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      value
    );
  }


  // ==========================================
  // ERROR HANDLING
  // ==========================================

  function showFieldError(
    fieldId,
    message
  ) {

    const errorElement =
      document.getElementById(
        `${fieldId}Error`
      );


    if (errorElement) {
      errorElement.textContent =
        message;
    }


    const field =
      document.getElementById(
        fieldId
      );


    if (field) {

      field.classList.add(
        "input-error"
      );

      field.setAttribute(
        "aria-invalid",
        "true"
      );
    }
  }


  function clearError(fieldId) {

    const errorElement =
      document.getElementById(
        `${fieldId}Error`
      );


    if (errorElement) {
      errorElement.textContent =
        "";
    }


    const field =
      document.getElementById(
        fieldId
      );


    if (field) {

      field.classList.remove(
        "input-error"
      );

      field.removeAttribute(
        "aria-invalid"
      );
    }
  }


  function clearFormMessage() {

    if (!formMessage) return;

    formMessage.textContent =
      "";

    formMessage.className =
      "form-message";
  }


  function showFormMessage(
    message,
    type
  ) {

    if (!formMessage) return;

    formMessage.textContent =
      message;

    formMessage.className =
      `form-message ${type}`;
  }


  // ==========================================
  // LOADING STATE
  // ==========================================

  function setLoading(isLoading) {

    if (createAccountButton) {

      createAccountButton.disabled =
        isLoading;

      createAccountButton.textContent =
        isLoading
          ? "Creating account..."
          : "Create account";
    }


    if (pageLoader) {

      pageLoader.hidden =
        !isLoading;
    }
  }


  // ==========================================
  // DELETE ORPHAN AUTH USER
  // ==========================================

  async function safelyDeleteUser(
    user
  ) {

    try {

      await deleteUser(user);

    } catch (error) {

      console.error(
        "Could not clean up Auth user:",
        error
      );
    }
  }


  // ==========================================
  // FIREBASE ERROR TRANSLATION
  // ==========================================

  function getFirebaseErrorMessage(
    error
  ) {

    switch (error.code) {

      case "auth/email-already-in-use":

        return "An account with this email already exists. Try logging in instead.";


      case "auth/invalid-email":

        return "The email address is not valid.";


      case "auth/weak-password":

        return "The password is too weak. Please use at least 8 characters.";


      case "auth/network-request-failed":

        return "Network error. Check your internet connection and try again.";


      case "auth/too-many-requests":

        return "Too many attempts. Please wait a moment and try again.";


      case "auth/operation-not-allowed":

        return "Email and password signup is not currently enabled in Firebase Authentication.";


      case "permission-denied":

        return "GradeFlow could not save your account information because Firestore permissions rejected the request.";


      default:

        return (
          error.message ||
          "Something went wrong while creating your account."
        );
    }
  }

});