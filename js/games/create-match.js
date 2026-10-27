import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  doc,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { auth, db } from "../firebase.js";

"use strict";

(() => {
  const form = document.getElementById("createMatchForm");

  if (!form) {
    console.error("GradeFlow Games: Create Match form was not found.");
    return;
  }

  const $ = (id) => document.getElementById(id);

  const DRAFT_KEY = "gradeFlowGamesCreateMatchDraftV1";

  const fields = {
    paidViewing: $("paidViewing"),
    paidViewingFields: $("paidViewingFields"),
    viewingFee: $("viewingFee"),
    viewingCurrency: $("viewingCurrency"),
    viewingFeePreview: $("viewingFeePreview"),

    visibility: $("visibility"),
    watchingAccess: $("watchingAccess"),
    authorizedViewersField: $("authorizedViewersField"),
    authorizedViewers: $("authorizedViewers"),

    competitorMode: $("competitorMode"),
    inviteCompetitorsField: $("inviteCompetitorsField"),
    invitedCompetitors: $("invitedCompetitors"),

    enableSponsorships: $("enableSponsorships"),
    sponsorshipFields: $("sponsorshipFields"),
    sponsorshipCurrency: $("sponsorshipCurrency"),
    sponsorshipAmount: $("sponsorshipAmount"),

    enableHalftimeAd: $("enableHalftimeAd"),
    halftimeFields: $("halftimeFields"),
    halftimeAfterQuestion: $("halftimeAfterQuestion"),

    questionCount: $("questionCount"),
    startDateTime: $("startDateTime"),
    applicationDeadline: $("applicationDeadline"),

    draftStatus: $("draftStatus"),
    localDraftPanel: $("localDraftPanel"),
    reviewDialog: $("reviewDialog"),
    reviewContent: $("reviewContent"),
    generatedQuestionsDetails: $("generatedQuestionsDetails"),
    generatedQuestionsList: $("generatedQuestionsList"),
    generateQuestionsButton: $("generateQuestionsButton"),
    confirmReviewButton: $("confirmReviewButton"),
    toastContainer: $("toastContainer")
  };

  function showToast(message, type = "info") {
    if (!fields.toastContainer) {
      console.log(message);
      return;
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type === "error" ? "error" : type === "success" ? "success" : ""}`;
    toast.setAttribute("role", "status");
    toast.textContent = message;

    fields.toastContainer.appendChild(toast);

    window.setTimeout(() => {
      toast.remove();
    }, 4200);
  }

  function setDraftStatus(message) {
    if (fields.draftStatus) {
      fields.draftStatus.textContent = message;
    }
  }

  function setHidden(element, shouldHide) {
    if (!element) return;
    element.classList.toggle("hidden", shouldHide);
  }

  function getCurrencyUtility() {
    return window.GradeFlowCurrencies || null;
  }

  function getCurrencyCode(select) {
    return select && select.value ? select.value : "NGN";
  }

  function formatCurrency(amount, code) {
    const currencyUtility = getCurrencyUtility();

    if (currencyUtility) {
      return currencyUtility.format(amount, code);
    }

    const fallbackSymbols = {
      NGN: "₦",
      USD: "$",
      EUR: "€",
      GBP: "£",
      JPY: "¥"
    };

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount)) {
      return "—";
    }

    const decimals = code === "JPY" ? 0 : 2;
    const symbol = fallbackSymbols[code] || `${code} `;

    return `${symbol}${numericAmount.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    })}`;
  }

  function populateCurrencySelectors() {
    const currencyUtility = getCurrencyUtility();

    if (!currencyUtility) {
      showToast(
        "Currency utility not loaded. The default NGN option remains available.",
        "error"
      );
      return;
    }

    if (fields.viewingCurrency) {
      currencyUtility.populateSelect(fields.viewingCurrency, "NGN");
    }

    if (fields.sponsorshipCurrency) {
      currencyUtility.populateSelect(fields.sponsorshipCurrency, "NGN");
    }
  }

  function updateViewingFeePreview() {
    if (!fields.viewingFeePreview) return;

    const fee = Number(fields.viewingFee?.value || 0);
    const currency = getCurrencyCode(fields.viewingCurrency);

    fields.viewingFeePreview.textContent =
      fee > 0 && Number.isFinite(fee)
        ? formatCurrency(fee, currency)
        : formatCurrency(0, currency);
  }

  function updateConditionalFields() {
    setHidden(
      fields.paidViewingFields,
      !fields.paidViewing?.checked
    );

    const needsAuthorizedViewers =
      fields.visibility?.value === "private" ||
      fields.watchingAccess?.value === "authorized";

    setHidden(
      fields.authorizedViewersField,
      !needsAuthorizedViewers
    );

    setHidden(
      fields.inviteCompetitorsField,
      fields.competitorMode?.value !== "invite"
    );

    setHidden(
      fields.sponsorshipFields,
      !fields.enableSponsorships?.checked
    );

    setHidden(
      fields.halftimeFields,
      !fields.enableHalftimeAd?.checked
    );

    updateViewingFeePreview();
  }

  function clearFieldErrors() {
    form.querySelectorAll("[aria-invalid='true']").forEach((element) => {
      element.removeAttribute("aria-invalid");
    });

    const subjectsError = $("subjectsError");
    const confirmationError = $("confirmationError");

    if (subjectsError) subjectsError.textContent = "";
    if (confirmationError) confirmationError.textContent = "";
  }

  function markInvalid(element, message) {
    if (element) {
      element.setAttribute("aria-invalid", "true");
    }

    showToast(message, "error");
  }

  function parseLineList(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function getSelectedSubjects() {
    return Array.from(
      form.querySelectorAll('input[name="subjects"]:checked')
    ).map((input) => input.value);
  }

  function getCheckedValue(name) {
    return Boolean(form.querySelector(`[name="${name}"]`)?.checked);
  }

  function getFormValue(name) {
    const element = form.elements.namedItem(name);

    if (!element) return "";

    if (element instanceof RadioNodeList) {
      return element.value;
    }

    return element.value ?? "";
  }

  function validateForm() {
    clearFieldErrors();

    const title = $("matchTitle");
    const category = $("matchCategory");
    const questionCount = fields.questionCount;
    const competitorSlots = $("competitorSlots");
    const startDateTime = fields.startDateTime;
    const subjectsError = $("subjectsError");
    const confirmationError = $("confirmationError");

    if (!title.value.trim()) {
      markInvalid(title, "Enter a title for your match.");
      title.focus();
      return false;
    }

    if (!category.value) {
      markInvalid(category, "Choose a match category.");
      category.focus();
      return false;
    }

    const subjects = getSelectedSubjects();

    if (subjects.length === 0) {
      if (subjectsError) {
        subjectsError.textContent = "Select at least one subject.";
      }

      showToast("Select at least one subject.", "error");
      $("subjectGrid")?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });

      return false;
    }

    const questionTotal = Number(questionCount.value);

    if (
      !Number.isInteger(questionTotal) ||
      questionTotal < 30 ||
      questionTotal > 100
    ) {
      markInvalid(
        questionCount,
        "Choose between 30 and 100 questions."
      );
      questionCount.focus();
      return false;
    }

    const slots = Number(competitorSlots.value);

    if (
      !Number.isInteger(slots) ||
      slots < 2 ||
      slots > 10000
    ) {
      markInvalid(
        competitorSlots,
        "Competitor slots must be a whole number between 2 and 10,000."
      );
      competitorSlots.focus();
      return false;
    }

    if (!startDateTime.value) {
      markInvalid(startDateTime, "Choose a scheduled start date and time.");
      startDateTime.focus();
      return false;
    }

    const scheduledStart = new Date(startDateTime.value);

    if (Number.isNaN(scheduledStart.getTime())) {
      markInvalid(startDateTime, "Enter a valid start date and time.");
      startDateTime.focus();
      return false;
    }

    if (scheduledStart.getTime() <= Date.now()) {
      markInvalid(startDateTime, "The scheduled start must be in the future.");
      startDateTime.focus();
      return false;
    }

    if (fields.applicationDeadline?.value) {
      const deadline = new Date(fields.applicationDeadline.value);

      if (Number.isNaN(deadline.getTime())) {
        markInvalid(
          fields.applicationDeadline,
          "Enter a valid application deadline."
        );
        fields.applicationDeadline.focus();
        return false;
      }

      if (deadline.getTime() >= scheduledStart.getTime()) {
        markInvalid(
          fields.applicationDeadline,
          "The application deadline must be before the match starts."
        );
        fields.applicationDeadline.focus();
        return false;
      }
    }

    if (fields.paidViewing?.checked) {
      const fee = Number(fields.viewingFee?.value);

      if (!Number.isFinite(fee) || fee <= 0) {
        markInvalid(
          fields.viewingFee,
          "Enter a viewing fee greater than zero, or disable paid viewing."
        );
        fields.viewingFee.focus();
        return false;
      }

      if (fee > 100000000) {
        markInvalid(fields.viewingFee, "The viewing fee is too high.");
        fields.viewingFee.focus();
        return false;
      }

      if (!getCurrencyCode(fields.viewingCurrency)) {
        markInvalid(fields.viewingCurrency, "Choose a viewing fee currency.");
        fields.viewingCurrency.focus();
        return false;
      }
    }

    if (fields.enableSponsorships?.checked) {
      const amount = fields.sponsorshipAmount?.value;

      if (amount !== "" && amount !== undefined) {
        const numericAmount = Number(amount);

        if (!Number.isFinite(numericAmount) || numericAmount < 0) {
          markInvalid(
            fields.sponsorshipAmount,
            "Enter a valid sponsorship amount or leave it blank."
          );
          fields.sponsorshipAmount.focus();
          return false;
        }
      }
    }

    if (fields.enableHalftimeAd?.checked) {
      const afterQuestion = Number(fields.halftimeAfterQuestion.value);

      if (
        !Number.isInteger(afterQuestion) ||
        afterQuestion < 1 ||
        afterQuestion >= questionTotal
      ) {
        markInvalid(
          fields.halftimeAfterQuestion,
          "The halftime break must occur before the final question."
        );
        fields.halftimeAfterQuestion.focus();
        return false;
      }
    }

    if (
      fields.visibility?.value === "private" &&
      !parseLineList(fields.authorizedViewers?.value).length
    ) {
      markInvalid(
        fields.authorizedViewers,
        "For a private match, add at least one authorized viewer or change the visibility."
      );
      fields.authorizedViewers.focus();
      return false;
    }

    if (
      fields.watchingAccess?.value === "authorized" &&
      !parseLineList(fields.authorizedViewers?.value).length
    ) {
      markInvalid(
        fields.authorizedViewers,
        "Add at least one authorized viewer."
      );
      fields.authorizedViewers.focus();
      return false;
    }

    if (
      fields.competitorMode?.value === "invite" &&
      !parseLineList(fields.invitedCompetitors?.value).length
    ) {
      markInvalid(
        fields.invitedCompetitors,
        "Add at least one invited competitor or choose another entry mode."
      );
      fields.invitedCompetitors.focus();
      return false;
    }

    if (!$("confirmRules").checked) {
      if (confirmationError) {
        confirmationError.textContent =
          "Confirm that you have reviewed the settings.";
      }

      showToast("Confirm the final settings before reviewing.", "error");
      $("confirmRules").focus();
      return false;
    }

    return true;
  }

  function collectFormData() {
    return {
      schemaVersion: 1,
      matchTitle: $("matchTitle").value.trim(),
      matchDescription: $("matchDescription").value.trim(),
      matchCategory: $("matchCategory").value,
      difficulty: $("difficulty").value,
      matchLanguage: $("matchLanguage").value,
      matchFormat: $("matchFormat").value,

      subjects: getSelectedSubjects(),
      subjectMode: getSelectedSubjects().length > 1 ? "mixed" : "single",
      questionCount: Number(fields.questionCount.value),
      questionType: $("questionType").value,
      secondsPerQuestion: Number($("secondsPerQuestion").value),
      pointsPerQuestion: Number($("pointsPerQuestion").value),

      questionGeneration: {
        provider: "gemini",
        requested: true,
        minimumQuestions: 30
      },

      visibility: fields.visibility.value,
      competitorMode: fields.competitorMode.value,
      competitorSlots: Number($("competitorSlots").value),
      watchingAccess: fields.watchingAccess.value,
      authorizedViewers: parseLineList(fields.authorizedViewers.value),
      invitedCompetitors: parseLineList(fields.invitedCompetitors.value),

      startDateTime: fields.startDateTime.value,
      applicationDeadline: fields.applicationDeadline.value || null,
      estimatedDurationMinutes: Number($("estimatedDuration").value),
      timezone: $("matchTimezone").value,

      paidViewing: Boolean(fields.paidViewing.checked),
      viewingFee: fields.paidViewing.checked
        ? Number(fields.viewingFee.value)
        : 0,
      viewingCurrency: getCurrencyCode(fields.viewingCurrency),

      enableComments: getCheckedValue("enableComments"),
      enableReactions: getCheckedValue("enableReactions"),
      enablePredictions: getCheckedValue("enablePredictions"),

      enableSponsorships: Boolean(fields.enableSponsorships.checked),
      sponsorshipType: $("sponsorshipType").value,
      sponsorshipCurrency: getCurrencyCode(fields.sponsorshipCurrency),
      sponsorshipAmount:
        fields.enableSponsorships.checked &&
        fields.sponsorshipAmount.value !== ""
          ? Number(fields.sponsorshipAmount.value)
          : null,
      sponsorshipNotes: $("sponsorshipNotes").value.trim(),

      enableHalftimeAd: Boolean(fields.enableHalftimeAd.checked),
      halftimeAfterQuestion: fields.enableHalftimeAd.checked
        ? Number(fields.halftimeAfterQuestion.value)
        : null,
      halftimeDurationSeconds: fields.enableHalftimeAd.checked
        ? Number($("halftimeDuration").value)
        : null,

      initialStatus: $("initialStatus").value,
      hostDisplayName: $("hostDisplayName").value.trim(),

      createdLocallyAt: new Date().toISOString()
    };
  }

  function createReviewRow(label, value) {
    const row = document.createElement("div");
    row.className = "review-row";

    const labelElement = document.createElement("span");
    labelElement.textContent = label;

    const valueElement = document.createElement("span");
    valueElement.textContent =
      value === null || value === undefined || value === ""
        ? "Not set"
        : String(value);

    row.append(labelElement, valueElement);
    return row;
  }

  function addReviewGroup(container, title, rows) {
    const group = document.createElement("section");
    group.className = "review-group";

    const heading = document.createElement("h3");
    heading.textContent = title;
    group.appendChild(heading);

    rows.forEach(([label, value]) => {
      group.appendChild(createReviewRow(label, value));
    });

    container.appendChild(group);
  }

  function yesNo(value) {
    return value ? "Enabled" : "Disabled";
  }

  function formatDateTime(value) {
    if (!value) return "Not set";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString();
  }

  function renderReview(data) {
    const container = fields.reviewContent;

    if (!container) return;

    container.replaceChildren();

    const feeDisplay = data.paidViewing
      ? formatCurrency(data.viewingFee, data.viewingCurrency)
      : "Free viewing";

    const sponsorAmountDisplay =
      data.sponsorshipAmount === null
        ? "Negotiable / not specified"
        : formatCurrency(
            data.sponsorshipAmount,
            data.sponsorshipCurrency
          );

    addReviewGroup(container, "Match details", [
      ["Title", data.matchTitle],
      ["Description", data.matchDescription || "No description"],
      ["Category", data.matchCategory],
      ["Difficulty", data.difficulty],
      ["Language", data.matchLanguage],
      ["Format", data.matchFormat]
    ]);

    addReviewGroup(container, "Questions", [
      ["Subjects", data.subjects.join(", ")],
      ["Subject mode", data.subjectMode === "mixed" ? "Mixed subjects" : "Single subject"],
      ["Question count", data.questionCount],
      ["Question type", data.questionType],
      ["Seconds per question", `${data.secondsPerQuestion} seconds`],
      ["Points per correct answer", data.pointsPerQuestion],
      ["Question generator", generatedQuestions.length ? `${generatedQuestions.length} generated; review required` : "Generate questions before saving"]
    ]);

    addReviewGroup(container, "Access and competitors", [
      ["Visibility", data.visibility],
      ["Competitor entry", data.competitorMode],
      ["Competitor slots", data.competitorSlots],
      ["Who can watch", data.watchingAccess],
      ["Authorized viewers", data.authorizedViewers.length],
      ["Invited competitors", data.invitedCompetitors.length]
    ]);

    addReviewGroup(container, "Schedule", [
      ["Start", formatDateTime(data.startDateTime)],
      ["Application deadline", formatDateTime(data.applicationDeadline)],
      ["Duration", `${data.estimatedDurationMinutes} minutes`],
      ["Time zone", data.timezone]
    ]);

    addReviewGroup(container, "Viewing", [
      ["Paid viewing", yesNo(data.paidViewing)],
      ["Viewing price", feeDisplay],
      ["Currency code", data.viewingCurrency]
    ]);

    addReviewGroup(container, "Community", [
      ["Comments", yesNo(data.enableComments)],
      ["Reactions", yesNo(data.enableReactions)],
      ["Non-cash predictions", yesNo(data.enablePredictions)]
    ]);

    addReviewGroup(container, "Sponsorships and advertising", [
      ["Accept sponsorships", yesNo(data.enableSponsorships)],
      ["Sponsorship model", data.sponsorshipType],
      ["Preferred currency", data.sponsorshipCurrency],
      ["Preferred fixed amount", data.enableSponsorships ? sponsorAmountDisplay : "Not enabled"],
      ["Sponsorship notes", data.sponsorshipNotes || "None"],
      ["Halftime advertising", yesNo(data.enableHalftimeAd)],
      [
        "Halftime break",
        data.enableHalftimeAd
          ? `After question ${data.halftimeAfterQuestion}, ${data.halftimeDurationSeconds} seconds`
          : "Not enabled"
      ]
    ]);

    addReviewGroup(container, "Final settings", [
      ["Initial status", data.initialStatus],
      ["Host display name", data.hostDisplayName || "Not set"]
    ]);
  }

  let savingMatch = false;
  let generatingQuestions = false;
  let generatedQuestions = [];

  function waitForSignedInUser() {
    if (auth.currentUser) return Promise.resolve(auth.currentUser);

    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};

      unsubscribe = onAuthStateChanged(
        auth,
        (user) => {
          unsubscribe();
          if (user) {
            resolve(user);
          } else {
            reject(new Error("You must sign in to save a match."));
          }
        },
        (error) => {
          unsubscribe();
          reject(error);
        }
      );
    });
  }

  function normalizeDifficulty(value) {
    const normalized = String(value || "").trim().toLowerCase();

    if (["easy", "beginner"].includes(normalized)) return "beginner";
    if (["medium", "intermediate", "normal"].includes(normalized)) return "intermediate";
    if (["hard", "advanced", "expert"].includes(normalized)) return "advanced";
    if (normalized === "mixed") return "mixed";

    return "intermediate";
  }

  function normalizeQuestionType(value) {
    const normalized = String(value || "").trim().toLowerCase();

    if (normalized.includes("true") && normalized.includes("false")) return "true-false";
    if (normalized.includes("short")) return "short-answer";
    if (normalized.includes("mixed")) return "mixed";

    return "multiple-choice";
  }

  async function generateMatchQuestions(formData) {
    const user = await waitForSignedInUser();
    const token = await user.getIdToken();

    const response = await fetch(
      "https://grades-app-6qgy.onrender.com/api/ai/generate-questions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title: formData.matchTitle,
          description: formData.matchDescription || "",
          language: formData.matchLanguage || "English",
          subjects: formData.subjects,
          difficulty: normalizeDifficulty(formData.difficulty),
          questionType: normalizeQuestionType(formData.questionType),
          questionCount: formData.questionCount
        })
      }
    );

    let result;

    try {
      result = await response.json();
    } catch {
      throw new Error("The AI server returned an unreadable response.");
    }

    if (!response.ok || result?.success !== true) {
      throw new Error(
        result?.error ||
        result?.message ||
        `Question generation failed (HTTP ${response.status}).`
      );
    }

    if (!Array.isArray(result.questions)) {
      throw new Error("The AI server did not return a questions list.");
    }

    if (result.questions.length !== formData.questionCount) {
      throw new Error(
        `The AI returned ${result.questions.length} questions, but ${formData.questionCount} were requested. Try generating again.`
      );
    }

    return result.questions.map((question, index) => ({
      ...question,
      question: String(question.question || "").trim(),
      type: String(question.type || normalizeQuestionType(formData.questionType)),
      options: Array.isArray(question.options) ? question.options : [],
      correctAnswer: String(question.correctAnswer ?? "").trim(),
      explanation: String(question.explanation || "").trim(),
      subject: String(
        question.subject ||
        formData.subjects[index % formData.subjects.length]
      ),
      order: index + 1
    }));
  }

  function renderGeneratedQuestions(questions) {
    if (!fields.generatedQuestionsList) return;

    fields.generatedQuestionsList.replaceChildren();

    questions.forEach((question, index) => {
      const card = document.createElement("article");
      card.className = "generated-question-card";

      const heading = document.createElement("h4");
      heading.textContent = `Question ${index + 1}`;

      const subject = document.createElement("p");
      subject.className = "generated-question-subject";
      subject.textContent = `Subject: ${question.subject || "General"}`;

      const prompt = document.createElement("p");
      prompt.className = "generated-question-text";
      prompt.textContent = question.question;

      card.append(heading, subject, prompt);

      if (question.options.length) {
        const optionsList = document.createElement("ol");
        optionsList.className = "generated-question-options";
        optionsList.type = "A";

        question.options.forEach((option) => {
          const item = document.createElement("li");
          item.textContent = String(option);
          optionsList.appendChild(item);
        });

        card.appendChild(optionsList);
      }

      const answer = document.createElement("p");
      answer.className = "generated-question-answer";
      answer.textContent = `Correct answer: ${question.correctAnswer || "Not provided"}`;
      card.appendChild(answer);

      if (question.explanation) {
        const explanation = document.createElement("p");
        explanation.className = "generated-question-explanation";
        explanation.textContent = `Explanation: ${question.explanation}`;
        card.appendChild(explanation);
      }

      fields.generatedQuestionsList.appendChild(card);
    });

    if (fields.generatedQuestionsDetails) {
      fields.generatedQuestionsDetails.open = true;
    }
  }

  async function saveMatchToFirestore(formData, questions = []) {
    const user = await waitForSignedInUser();

    if (!Array.isArray(questions) || questions.length !== formData.questionCount) {
      throw new Error("Generate and review the requested questions before saving.");
    }

    // Save as a draft only. Publishing, scheduling enforcement and payments remain disabled.
    const matchRef = doc(collection(db, "matches"));

    const matchDocument = {
      ...formData,
      hostUid: user.uid,
      hostEmail: user.email || null,
      hostDisplayName:
        formData.hostDisplayName ||
        user.displayName ||
        (user.email ? user.email.split("@")[0] : "GradeFlow host"),
      status: "draft",
      requestedInitialStatus: formData.initialStatus,

      questionGeneration: {
        provider: "gemini",
        requested: true,
        generated: true,
        generatedCount: questions.length,
        reviewedByHost: false,
        minimumQuestions: 30
      },

      readiness: {
        questionsGenerated: true,
        schedulingEnabled: false,
        paymentsEnabled: false
      },

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    const batch = writeBatch(db);

    batch.set(matchRef, matchDocument);

    questions.forEach((question, index) => {
      const questionRef = doc(
        collection(db, "matches", matchRef.id, "questions")
      );

      batch.set(questionRef, {
        ...question,
        order: index + 1,
        createdAt: serverTimestamp()
      });
    });

    await batch.commit();

    return matchRef.id;
  }

  function openReview() {
    if (!validateForm()) return;

    const data = collectFormData();

    generatedQuestions = [];

    if (fields.generatedQuestionsList) {
      fields.generatedQuestionsList.replaceChildren();
    }

    if (fields.generatedQuestionsDetails) {
      fields.generatedQuestionsDetails.open = false;
    }

    if (fields.confirmReviewButton) {
      fields.confirmReviewButton.disabled =
        Boolean(fields.generateQuestionsButton);

      fields.confirmReviewButton.textContent =
        fields.generateQuestionsButton
          ? "Generate questions first"
          : "Confirm and save match";
    }

    if (fields.generateQuestionsButton) {
      fields.generateQuestionsButton.disabled = false;
      fields.generateQuestionsButton.textContent = "Generate questions";
    }

    renderReview(data);

    if (fields.reviewDialog?.showModal) {
      fields.reviewDialog.showModal();
    } else {
      fields.reviewDialog?.setAttribute("open", "");
    }
  }

  function closeReview() {
    if (fields.reviewDialog?.close) {
      fields.reviewDialog.close();
    } else {
      fields.reviewDialog?.removeAttribute("open");
    }
  }

  function serializeForm() {
    const data = {};

    Array.from(form.elements).forEach((element) => {
      if (!element.name || element.disabled) return;

      if (element.type === "checkbox") {
        if (!data[element.name]) data[element.name] = [];
        if (element.checked) data[element.name].push(element.value || true);
        return;
      }

      if (element.type === "radio") {
        if (element.checked) data[element.name] = element.value;
        return;
      }

      data[element.name] = element.value;
    });

    return data;
  }

  function restoreForm(savedData) {
    if (!savedData || typeof savedData !== "object") return;

    Array.from(form.elements).forEach((element) => {
      if (!element.name || !(element.name in savedData)) return;

      const savedValue = savedData[element.name];

      if (element.type === "checkbox") {
        if (Array.isArray(savedValue)) {
          element.checked = savedValue.includes(element.value || true);
        } else {
          element.checked = Boolean(savedValue);
        }
        return;
      }

      if (element.type === "radio") {
        element.checked = element.value === savedValue;
        return;
      }

      if (element.type === "submit" || element.type === "button") return;

      element.value = savedValue;
    });

    updateConditionalFields();
    updateViewingFeePreview();
  }

  function saveLocalDraft() {
    try {
      const draft = {
        savedAt: new Date().toISOString(),
        form: serializeForm()
      };

      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));

      setDraftStatus("Local draft saved");
      setHidden(fields.localDraftPanel, false);

      showToast("Draft saved in this browser.", "success");
    } catch (error) {
      console.error("Could not save local draft:", error);

      showToast(
        "Could not save the local draft. Check your browser storage settings.",
        "error"
      );
    }
  }

  function loadLocalDraft() {
    try {
      const rawDraft = localStorage.getItem(DRAFT_KEY);

      if (!rawDraft) return;

      const draft = JSON.parse(rawDraft);

      if (!draft || !draft.form) return;

      restoreForm(draft.form);
      setDraftStatus("Local draft restored");
      setHidden(fields.localDraftPanel, false);

      showToast("Your previous local draft was restored.", "info");
    } catch (error) {
      console.error("Could not restore local draft:", error);
      setDraftStatus("Ready to create");
    }
  }

  function clearLocalDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
      setHidden(fields.localDraftPanel, true);
      setDraftStatus("Local draft cleared");

      showToast("Local draft cleared from this browser.", "success");
    } catch (error) {
      console.error("Could not clear local draft:", error);
      showToast("Could not clear the local draft.", "error");
    }
  }

  function setMinimumStartDate() {
    if (!fields.startDateTime) return;

    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());

    const localDateTime = now.toISOString().slice(0, 16);

    fields.startDateTime.min = localDateTime;

    if (fields.applicationDeadline) {
      fields.applicationDeadline.max = fields.startDateTime.value || "";
    }
  }

  function updateDeadlineLimits() {
    if (!fields.applicationDeadline || !fields.startDateTime) return;

    fields.applicationDeadline.max = fields.startDateTime.value || "";
  }

  function handleFormChanges(event) {
    if (
      event.target.matches(
        "#paidViewing, #visibility, #watchingAccess, #competitorMode, #enableSponsorships, #enableHalftimeAd"
      )
    ) {
      updateConditionalFields();
    }

    if (
      event.target.matches("#viewingFee, #viewingCurrency")
    ) {
      updateViewingFeePreview();
    }

    if (event.target === fields.startDateTime) {
      updateDeadlineLimits();
    }

    if (event.target.matches("[aria-invalid='true']")) {
      event.target.removeAttribute("aria-invalid");
    }

    if (fields.generateQuestionsButton && fields.reviewDialog?.open) {
      generatedQuestions = [];

      if (fields.generatedQuestionsList) {
        fields.generatedQuestionsList.replaceChildren();
      }

      if (fields.confirmReviewButton) {
        fields.confirmReviewButton.disabled = true;
        fields.confirmReviewButton.textContent = "Generate questions first";
      }
    }

    setDraftStatus("Unsaved changes");
  }

  function bindEvents() {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      openReview();
    });

    form.addEventListener("input", handleFormChanges);
    form.addEventListener("change", handleFormChanges);

    $("saveDraftButton")?.addEventListener("click", saveLocalDraft);
    $("clearDraftButton")?.addEventListener("click", clearLocalDraft);

    $("closeReviewButton")?.addEventListener("click", closeReview);
    $("editMatchButton")?.addEventListener("click", closeReview);

    fields.generateQuestionsButton?.addEventListener("click", async () => {
      if (generatingQuestions) return;

      if (!validateForm()) {
        closeReview();
        return;
      }

      generatingQuestions = true;
      generatedQuestions = [];

      const button = fields.generateQuestionsButton;
      const confirmButton = fields.confirmReviewButton;
      const oldLabel = button.textContent;

      button.disabled = true;
      button.textContent = "Generating questions…";

      if (confirmButton) {
        confirmButton.disabled = true;
        confirmButton.textContent = "Generate questions first";
      }

      setDraftStatus("Generating AI questions…");

      try {
        const formData = collectFormData();
        const questions = await generateMatchQuestions(formData);

        generatedQuestions = questions;

        renderGeneratedQuestions(questions);

        if (confirmButton) {
          confirmButton.disabled = false;
          confirmButton.textContent = "Confirm and save match";
        }

        showToast(
          `${questions.length} questions generated. Review them before saving.`,
          "success"
        );

        setDraftStatus("Questions generated — review before saving");
        renderReview(formData);
      } catch (error) {
        console.error("GradeFlow question generation failed:", error);

        showToast(
          error?.message || "Could not generate questions. Try again.",
          "error"
        );

        setDraftStatus("Question generation failed");
        generatedQuestions = [];
      } finally {
        generatingQuestions = false;
        button.disabled = false;
        button.textContent = oldLabel || "Generate questions";
      }
    });

    $("confirmReviewButton")?.addEventListener("click", async () => {
      const button = $("confirmReviewButton");

      if (savingMatch) return;

      if (fields.generateQuestionsButton && generatedQuestions.length === 0) {
        showToast("Generate the questions before saving this match.", "error");
        return;
      }

      // Validate again in case form values changed while the dialog was open.
      if (!validateForm()) {
        closeReview();
        return;
      }

      savingMatch = true;

      const originalLabel = button?.textContent;

      if (button) {
        button.disabled = true;
        button.textContent = "Saving match…";
      }

      setDraftStatus("Saving to GradeFlow…");

      try {
        const matchData = collectFormData();
        const matchId = await saveMatchToFirestore(
          matchData,
          generatedQuestions
        );

        if (!matchId) {
          throw new Error(
            "The match was saved without returning a match ID."
          );
        }

        console.info("GradeFlow Games match saved:", matchId);
        closeReview();
        setDraftStatus("Match saved. Opening lobby...");

        showToast(
          "Match saved successfully. Opening your match lobby...",
          "success"
        );

        // This assumes match-lobby.html is in the same directory
        // as the create-match HTML page.
        const lobbyUrl = new URL(
          "./match-lobby.html",
          window.location.href
        );

        lobbyUrl.searchParams.set("matchId", matchId);
        window.location.assign(lobbyUrl.href);
        return;
      } catch (error) {
        console.error("Could not save GradeFlow Games match:", error);

        const message =
          error?.code === "permission-denied"
            ? "Firebase denied this save. Check your Firestore Security Rules."
            : error?.message === "You must sign in to save a match."
              ? "Sign in to your GradeFlow account before saving a match."
              : "Could not save the match. Check your connection and Firestore setup.";

        setDraftStatus("Save failed");
        showToast(message, "error");
      } finally {
        savingMatch = false;

        if (button) {
          button.disabled = false;
          button.textContent = originalLabel || "Confirm and save match";
        }
      }
    });

    fields.reviewDialog?.addEventListener("click", (event) => {
      if (event.target === fields.reviewDialog) {
        closeReview();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape" &&
        fields.reviewDialog?.hasAttribute("open")
      ) {
        closeReview();
      }
    });
  }

  function init() {
    populateCurrencySelectors();
    setMinimumStartDate();
    bindEvents();
    loadLocalDraft();
    updateConditionalFields();
    updateDeadlineLimits();
    updateViewingFeePreview();

    console.info("GradeFlow Games Create Match form initialized.");
  }

  init();

  // Expose only the functions useful to other GradeFlow Games modules.
  window.GradeFlowCreateMatch = Object.freeze({
    collectFormData,
    validateForm,
    saveLocalDraft,
    saveMatchToFirestore,
    showToast,
    formatCurrency
  });
})();