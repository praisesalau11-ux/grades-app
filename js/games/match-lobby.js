import { auth, db } from "../firebase.js";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
    collection,
    doc,
    query,
    where,
    getDoc,
    getDocs,
    onSnapshot,
    setDoc,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const el = {
    availableMatchesView: $("availableMatchesView"),
    availableMatchesList: $("availableMatchesList"),
    matchesListStatus: $("matchesListStatus"),
    refreshMatchesButton: $("refreshMatchesButton"),

    loadingState: $("loadingState"),
    errorState: $("errorState"),
    errorTitle: $("errorTitle"),
    errorMessage: $("errorMessage"),
    retryButton: $("retryButton"),
    lobbyContent: $("lobbyContent"),

    statusBanner: $("statusBanner"),
    statusMessage: $("statusMessage"),

    matchTitle: $("matchTitle"),
    matchDescription: $("matchDescription"),
    matchStatusBadge: $("matchStatusBadge"),
    matchDifficultyBadge: $("matchDifficultyBadge"),
    matchTypeBadge: $("matchTypeBadge"),

    hostAvatar: $("hostAvatar"),
    hostName: $("hostName"),
    subjectList: $("subjectList"),

    questionCount: $("questionCount"),
    difficultyValue: $("difficultyValue"),
    questionTypeValue: $("questionTypeValue"),

    predictionsRow: $("predictionsRow"),
    predictionsValue: $("predictionsValue"),

    playerCount: $("playerCount"),
    participantsList: $("participantsList"),

    youStatus: $("youStatus"),
    joinButton: $("joinButton"),
    joinButtonText: $("joinButtonText"),
    joinHint: $("joinHint"),

    applicationsPanel: $("applicationsPanel"),
    applicationsList: $("applicationsList"),
    applicationCount: $("applicationCount"),

    matchIdValue: $("matchIdValue"),
    copyMatchIdButton: $("copyMatchIdButton"),
    copyButtonText: $("copyButtonText"),

    toast: $("toast"),
    currentYear: $("currentYear")
};

const params = new URLSearchParams(location.search);
const matchId = (
    params.get("matchId") ||
    params.get("id") ||
    ""
).trim();

let user = null;
let match = null;
let participants = [];
let ownApplication = null;

let loading = false;
let joining = false;
let toastTimer = null;
let loadingMatches = false;

let stopParticipants = null;
let stopOwnApplication = null;
let stopApplications = null;

/* =========================================================
   BASIC HELPERS
========================================================= */

function text(value, fallback = "") {
    return typeof value === "string" && value.trim()
        ? value.trim()
        : fallback;
}

function arrayOfStrings(value) {
    return Array.isArray(value)
        ? value
            .filter(value => typeof value === "string")
            .map(value => value.trim())
            .filter(Boolean)
        : [];
}

function hostUid(data = match) {
    return (
        data?.hostUid ||
        data?.createdBy ||
        data?.hostId ||
        ""
    );
}

function isHost() {
    return Boolean(
        user &&
        match &&
        hostUid(match) === user.uid
    );
}

function isApplicationMode(data = match) {
    return text(data?.competitorMode).toLowerCase() === "application";
}

/*
 * A match is publicly available only when its status is
 * exactly "published" and visibility is exactly "public".
 */
function isPublicPublished(data) {
    return Boolean(
        data &&
        text(data.status).toLowerCase() === "published" &&
        text(data.visibility).toLowerCase() === "public" &&
        data.isPublic !== false &&
        data.public !== false
    );
}

function showToast(message) {
    if (!el.toast) return;

    el.toast.textContent = message;
    el.toast.hidden = false;

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        el.toast.hidden = true;
    }, 3500);
}

function showStatus(message, type = "info") {
    if (!el.statusBanner || !el.statusMessage) return;

    el.statusBanner.hidden = false;
    el.statusBanner.dataset.type = type;
    el.statusMessage.textContent = message;
}

function showLoading() {
    if (el.loadingState) el.loadingState.hidden = false;
    if (el.errorState) el.errorState.hidden = true;
    if (el.lobbyContent) el.lobbyContent.hidden = true;
    if (el.availableMatchesView) {
        el.availableMatchesView.hidden = true;
    }
}

function showError(title, message) {
    if (el.loadingState) el.loadingState.hidden = true;
    if (el.lobbyContent) el.lobbyContent.hidden = true;
    if (el.errorState) el.errorState.hidden = false;

    if (el.errorTitle) el.errorTitle.textContent = title;
    if (el.errorMessage) el.errorMessage.textContent = message;
}

function setJoinButton(label, disabled = false) {
    if (el.joinButtonText) {
        el.joinButtonText.textContent = label;
    }

    if (el.joinButton) {
        el.joinButton.disabled = disabled;
    }
}

function stopListeners() {
    stopParticipants?.();
    stopOwnApplication?.();
    stopApplications?.();

    stopParticipants = null;
    stopOwnApplication = null;
    stopApplications = null;
}

/* =========================================================
   SCHEDULED START TIME
========================================================= */

/*
 * Supports these possible Firestore field names:
 *
 * startDateTime
 * scheduledAt
 * scheduledStart
 * startTime
 * startDate
 * scheduledDateTime
 *
 * The value can be a Firestore Timestamp, JavaScript Date,
 * Unix timestamp, or a date string.
 */
function getScheduledStartDate(data) {
    const value =
        data?.startDateTime ??
        data?.scheduledAt ??
        data?.scheduledStart ??
        data?.scheduledDateTime ??
        data?.startTime ??
        data?.startDate;

    if (value === null || value === undefined || value === "") {
        return null;
    }

    let date;

    if (typeof value?.toDate === "function") {
        date = value.toDate();
    } else if (value instanceof Date) {
        date = value;
    } else if (typeof value === "number") {
        date = new Date(
            value < 100000000000
                ? value * 1000
                : value
        );
    } else {
        date = new Date(value);
    }

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

function isCancelledOrFinished(data) {
    const status = text(data?.status).toLowerCase();

    const state = text(
        data?.matchStatus || data?.state
    ).toLowerCase();

    const finishedStatuses = [
        "cancelled",
        "canceled",
        "finished",
        "completed",
        "ended"
    ];

    return (
        finishedStatuses.includes(status) ||
        finishedStatuses.includes(state)
    );
}

/*
 * This is the main visibility rule for the available-match list.
 *
 * A match appears only if:
 * 1. It is published.
 * 2. It is public.
 * 3. It has a valid scheduled start time.
 * 4. Its scheduled start time has passed.
 * 5. It is not cancelled or completed.
 */
function isMatchAvailableNow(data, now = Date.now()) {
    if (!isPublicPublished(data)) return false;
    if (isCancelledOrFinished(data)) return false;

    const start = getScheduledStartDate(data);

    // Hide matches without a valid scheduled start time.
    if (!start) return false;

    // Show only matches scheduled for the future.
    return start.getTime() > now;
}
/* =========================================================
   MATCH DETAILS
========================================================= */

function getQuestionCount(data) {
    if (
        data.questionCount !== undefined &&
        data.questionCount !== null &&
        Number.isFinite(Number(data.questionCount))
    ) {
        return Number(data.questionCount);
    }

    if (Array.isArray(data.questions)) {
        return data.questions.length;
    }

    return null;
}

function renderMatch(data) {
    if (el.matchTitle) {
        el.matchTitle.textContent = text(
            data.title || data.matchTitle || data.name,
            "GradeFlow Match"
        );
    }

    if (el.matchDescription) {
        el.matchDescription.textContent = text(
            data.description || data.matchDescription,
            "Join this match and test your knowledge."
        );
    }

    if (el.matchStatusBadge) {
        el.matchStatusBadge.textContent = text(
            data.status,
            "Published"
        );
    }

    if (el.matchDifficultyBadge) {
        el.matchDifficultyBadge.textContent = text(
            data.difficulty,
            "Medium"
        );
    }

    if (el.matchTypeBadge) {
        el.matchTypeBadge.textContent = text(
            data.matchType || data.gameType,
            "Competition"
        );
    }

    const hostName = text(
        data.hostDisplayName ||
        data.hostName ||
        data.createdByName,
        "GradeFlow host"
    );

    if (el.hostName) {
        el.hostName.textContent = hostName;
    }

    if (el.hostAvatar) {
        el.hostAvatar.textContent =
            hostName.charAt(0).toUpperCase();
    }

    if (el.subjectList) {
        const subjects = arrayOfStrings(data.subjects);

        el.subjectList.replaceChildren();

        if (subjects.length) {
            subjects.forEach(subject => {
                const tag = document.createElement("span");

                tag.className = "subject-tag";
                tag.textContent = subject;

                el.subjectList.appendChild(tag);
            });
        } else {
            el.subjectList.textContent = "General";
        }
    }

    const count = getQuestionCount(data);

    if (el.questionCount) {
        el.questionCount.textContent =
            count === null
                ? "Not specified"
                : String(count);
    }

    if (el.difficultyValue) {
        el.difficultyValue.textContent = text(
            data.difficulty,
            "Medium"
        );
    }

    if (el.questionTypeValue) {
        el.questionTypeValue.textContent = text(
            data.questionType,
            "Multiple choice"
        );
    }

    const predictions = data.predictionsEnabled === true;

    if (el.predictionsRow) {
        el.predictionsRow.hidden = !predictions;
    }

    if (predictions && el.predictionsValue) {
        el.predictionsValue.textContent = "Enabled";
    }

    if (el.matchIdValue) {
        el.matchIdValue.textContent = data.id || matchId;
    }
}

/* =========================================================
   PARTICIPANTS
========================================================= */

function renderParticipants() {
    if (!el.participantsList) return;

    el.participantsList.replaceChildren();

    if (!participants.length) {
        const empty = document.createElement("p");

        empty.className = "empty-state";
        empty.textContent = "No players have joined yet.";

        el.participantsList.appendChild(empty);
    } else {
        participants.forEach(player => {
            const item = document.createElement("div");
            item.className = "participant-item";

            const avatar = document.createElement("div");
            avatar.className = "avatar";
            avatar.textContent = text(
                player.displayName,
                "P"
            ).charAt(0).toUpperCase();

            const details = document.createElement("div");
            details.className = "participant-details";

            const name = document.createElement("strong");
            name.textContent = text(
                player.displayName,
                "Player"
            );

            const status = document.createElement("span");
            status.className = "muted-text";

            status.textContent =
                player.uid === hostUid()
                    ? "Host"
                    : "Joined";

            details.append(name, status);
            item.append(avatar, details);

            if (user && player.uid === user.uid) {
                const you = document.createElement("span");

                you.className = "badge";
                you.textContent = "You";

                item.appendChild(you);
            }

            el.participantsList.appendChild(item);
        });
    }

    if (el.playerCount) {
        el.playerCount.textContent =
            `${participants.length} ${
                participants.length === 1 ? "player" : "players"
            }`;
    }

    const alreadyJoined = Boolean(
        user &&
        participants.some(player => player.uid === user.uid)
    );

    if (alreadyJoined) {
        if (el.youStatus) {
            el.youStatus.textContent = "Joined";
        }

        setJoinButton("Already joined", true);

        if (el.joinHint) {
            el.joinHint.textContent =
                "You are already a participant in this match.";
        }
    } else {
        updateJoinControls();
    }
}

function startParticipantListener() {
    if (!matchId || !match) return;

    stopParticipants?.();

    const participantsRef = collection(
        db,
        "matches",
        matchId,
        "participants"
    );

    stopParticipants = onSnapshot(
        participantsRef,
        snapshot => {
            participants = snapshot.docs
                .map(item => ({
                    id: item.id,
                    ...item.data()
                }))
                .filter(item => item.status !== "removed");

            renderParticipants();
        },
        error => {
            console.error(
                "GradeFlow participant listener error:",
                error
            );

            showToast(
                "Could not load participants. Check Firestore read rules."
            );
        }
    );
}

/* =========================================================
   JOIN BUTTON STATE
========================================================= */

function updateJoinControls() {
    if (!el.youStatus || !el.joinHint) return;

    if (!user) {
        el.youStatus.textContent = "Sign in required";

        setJoinButton("Sign in to join", true);

        el.joinHint.textContent =
            "Sign in to your GradeFlow account before joining.";

        return;
    }

    if (isHost()) {
        el.youStatus.textContent = "Host";

        setJoinButton("You host this match", true);

        el.joinHint.textContent =
            "You manage this match and its applications.";

        return;
    }

    if (ownApplication?.status === "pending") {
        el.youStatus.textContent = "Application pending";

        setJoinButton("Application submitted", true);

        el.joinHint.textContent =
            "The host must approve your application before you can join.";

        return;
    }

    if (ownApplication?.status === "rejected") {
        el.youStatus.textContent = "Application rejected";

        setJoinButton("Application rejected", true);

        el.joinHint.textContent =
            "The host has rejected your application.";

        return;
    }

    if (ownApplication?.status === "approved") {
        el.youStatus.textContent = "Approved";

        setJoinButton("Join match", false);

        el.joinHint.textContent =
            "Your application was approved. Select Join match to enter.";

        return;
    }

    el.youStatus.textContent = "Not joined";

    if (isApplicationMode()) {
        setJoinButton("Apply to join", false);

        el.joinHint.textContent =
            "Send an application. You can join after the host approves it.";
    } else {
        setJoinButton("Join match", false);

        el.joinHint.textContent =
            "Join this public match using your GradeFlow account.";
    }
}

/* =========================================================
   APPLICATIONS
========================================================= */

function startApplicationListeners() {
    stopOwnApplication?.();
    stopApplications?.();

    if (!user || !match || !isApplicationMode()) {
        if (el.applicationsPanel) {
            el.applicationsPanel.hidden = true;
        }

        updateJoinControls();
        return;
    }

    const ownApplicationRef = doc(
        db,
        "matches",
        matchId,
        "applications",
        user.uid
    );

    stopOwnApplication = onSnapshot(
        ownApplicationRef,
        snapshot => {
            ownApplication = snapshot.exists()
                ? snapshot.data()
                : null;

            updateJoinControls();
        },
        error => {
            console.error(
                "GradeFlow own-application listener error:",
                error
            );
        }
    );

    if (isHost()) {
        if (el.applicationsPanel) {
            el.applicationsPanel.hidden = false;
        }

        const applicationsRef = collection(
            db,
            "matches",
            matchId,
            "applications"
        );

        stopApplications = onSnapshot(
            applicationsRef,
            snapshot => {
                renderApplications(
                    snapshot.docs.map(item => ({
                        id: item.id,
                        ...item.data()
                    }))
                );
            },
            error => {
                console.error(
                    "GradeFlow applications listener error:",
                    error
                );

                if (el.applicationsList) {
                    el.applicationsList.textContent =
                        "Could not load applications. Check Firestore rules.";
                }
            }
        );
    } else if (el.applicationsPanel) {
        el.applicationsPanel.hidden = true;
    }
}

function renderApplications(items) {
    if (!el.applicationsList || !el.applicationCount) return;

    el.applicationsList.replaceChildren();

    const pending = items.filter(
        item => item.status === "pending"
    );

    el.applicationCount.textContent =
        `${pending.length} pending`;

    if (!items.length) {
        const empty = document.createElement("p");

        empty.className = "empty-state";
        empty.textContent = "No applications yet.";

        el.applicationsList.appendChild(empty);
        return;
    }

    items.sort((a, b) => {
        if (
            a.status === "pending" &&
            b.status !== "pending"
        ) return -1;

        if (
            b.status === "pending" &&
            a.status !== "pending"
        ) return 1;

        return 0;
    });

    items.forEach(application => {
        const card = document.createElement("article");
        card.className = "application-card";

        const info = document.createElement("div");
        info.className = "application-info";

        const name = document.createElement("strong");
        name.textContent = text(
            application.displayName,
            "Player"
        );

        const status = document.createElement("span");
        status.className = "muted-text";
        status.textContent = text(
            application.status,
            "pending"
        );

        info.append(name, status);
        card.appendChild(info);

        if (application.status === "pending") {
            const actions = document.createElement("div");
            actions.className = "application-actions";

            const approve = document.createElement("button");

            approve.type = "button";
            approve.className = "button button-primary";
            approve.textContent = "Approve";

            approve.addEventListener("click", () => {
                reviewApplication(
                    application.uid || application.id,
                    "approved",
                    approve
                );
            });

            const reject = document.createElement("button");

            reject.type = "button";
            reject.className = "button button-secondary";
            reject.textContent = "Reject";

            reject.addEventListener("click", () => {
                reviewApplication(
                    application.uid || application.id,
                    "rejected",
                    reject
                );
            });

            actions.append(approve, reject);
            card.appendChild(actions);
        }

        el.applicationsList.appendChild(card);
    });
}

async function reviewApplication(
    applicantUid,
    decision,
    button
) {
    if (!isHost()) {
        showToast("Only the host can review applications.");
        return;
    }

    if (!["approved", "rejected"].includes(decision)) {
        return;
    }

    button.disabled = true;

    try {
        const applicationRef = doc(
            db,
            "matches",
            matchId,
            "applications",
            applicantUid
        );

        const snapshot = await getDoc(applicationRef);

        if (!snapshot.exists()) {
            throw new Error("This application no longer exists.");
        }

        if (snapshot.data().status !== "pending") {
            throw new Error(
                "This application has already been reviewed."
            );
        }

        await updateDoc(applicationRef, {
            status: decision,
            reviewedAt: serverTimestamp(),
            reviewedBy: user.uid
        });

        showToast(
            decision === "approved"
                ? "Application approved."
                : "Application rejected."
        );
    } catch (error) {
        console.error(
            "GradeFlow application review error:",
            error
        );

        showToast(
            error.message ||
            "Could not review this application."
        );

        button.disabled = false;
    }
}

/* =========================================================
   JOIN OR APPLY TO JOIN
========================================================= */

async function joinMatch() {
    if (joining) return;

    if (!user) {
        showToast(
            "Sign in to GradeFlow before joining."
        );
        return;
    }

    if (!match || isHost()) {
        showToast(
            "The host cannot join their own match as a competitor."
        );
        return;
    }

    if (
        participants.some(player => player.uid === user.uid)
    ) {
        showToast("You have already joined this match.");
        return;
    }

    joining = true;

    if (el.joinButton) {
        el.joinButton.disabled = true;
    }

    try {
        const matchRef = doc(db, "matches", matchId);
        const matchSnapshot = await getDoc(matchRef);

        if (!matchSnapshot.exists()) {
            throw new Error("This match no longer exists.");
        }

        const latestMatch = matchSnapshot.data();

        if (!isPublicPublished(latestMatch)) {
            throw new Error(
                "This match is not currently published and public."
            );
        }

        if (!isMatchAvailableNow(latestMatch)) {
            throw new Error(
                "This match has not reached its scheduled start time, or it has ended."
            );
        }

        const participantRef = doc(
            db,
            "matches",
            matchId,
            "participants",
            user.uid
        );

        const existingParticipant = await getDoc(
            participantRef
        );

        if (existingParticipant.exists()) {
            showToast("You have already joined this match.");
            return;
        }

        if (
            text(latestMatch.competitorMode).toLowerCase() ===
            "application"
        ) {
            const applicationRef = doc(
                db,
                "matches",
                matchId,
                "applications",
                user.uid
            );

            const applicationSnapshot = await getDoc(
                applicationRef
            );

            if (!applicationSnapshot.exists()) {
                await setDoc(applicationRef, {
                    uid: user.uid,
                    displayName: text(
                        user.displayName,
                        user.email
                            ? user.email.split("@")[0]
                            : "Player"
                    ),
                    status: "pending",
                    appliedAt: serverTimestamp()
                });

                ownApplication = {
                    uid: user.uid,
                    status: "pending"
                };

                updateJoinControls();

                showToast(
                    "Application submitted. Wait for the host's decision."
                );

                return;
            }

            const application = applicationSnapshot.data();

            ownApplication = application;

            if (application.status === "pending") {
                showToast(
                    "Your application is still pending."
                );
                return;
            }

            if (application.status === "rejected") {
                showToast(
                    "The host rejected your application."
                );
                return;
            }

            if (application.status !== "approved") {
                throw new Error(
                    "Your application status is not valid."
                );
            }
        }

        await setDoc(participantRef, {
            uid: user.uid,
            displayName: text(
                user.displayName,
                user.email
                    ? user.email.split("@")[0]
                    : "Player"
            ),
            status: "joined",
            joinedAt: serverTimestamp()
        });

        showToast("You joined the match.");
    } catch (error) {
        console.error(
            "GradeFlow match join error:",
            error
        );

        showToast(
            error.message ||
            "Could not join this match. Check Firestore rules."
        );
    } finally {
        joining = false;
        updateJoinControls();
    }
}

/* =========================================================
   COPY MATCH ID
========================================================= */

async function copyMatchId() {
    if (!matchId) {
        showToast("There is no match ID to copy.");
        return;
    }

    try {
        await navigator.clipboard.writeText(matchId);

        showToast("Match ID copied.");
    } catch (error) {
        console.error(
            "Could not copy match ID:",
            error
        );

        showToast(
            "Copy failed. Select and copy the match ID manually."
        );
    }
}

/* =========================================================
   AVAILABLE MATCH CARDS
========================================================= */

function renderAvailableMatches(matches) {
    if (
        !el.availableMatchesList ||
        !el.matchesListStatus
    ) {
        return;
    }

    el.availableMatchesList.replaceChildren();

    if (!matches.length) {
        el.matchesListStatus.textContent =
            "No published public matches have reached their scheduled start time yet.";

        return;
    }

    el.matchesListStatus.textContent =
        `${matches.length} available ${
            matches.length === 1 ? "match" : "matches"
        }`;

    matches.forEach(item => {
        const card = document.createElement("article");

        card.className =
            "available-match-card match-card";

        const content = document.createElement("div");
        content.className = "available-match-content";

        const title = document.createElement("h3");

        title.textContent = text(
            item.title || item.matchTitle || item.name,
            "GradeFlow Match"
        );

        const description = document.createElement("p");

        description.textContent = text(
            item.description || item.matchDescription,
            "No description provided."
        );

        const meta = document.createElement("p");
        meta.className = "muted-text";

        const start = getScheduledStartDate(item);

        meta.textContent = start
            ? `Scheduled start: ${start.toLocaleString()}`
            : "Scheduled start time unavailable";

        content.append(title, description, meta);

        const open = document.createElement("a");

        open.className = "button button-primary";
        open.textContent = "View match";

        open.href =
            `match-lobby.html?matchId=${
                encodeURIComponent(item.id)
            }`;

        card.append(content, open);

        el.availableMatchesList.appendChild(card);
    });
}

/* =========================================================
   LOAD AVAILABLE MATCHES
========================================================= */

async function loadAvailableMatches() {
    if (loadingMatches) return;

    if (
        !el.availableMatchesView ||
        !el.availableMatchesList ||
        !el.matchesListStatus
    ) {
        console.error(
            "GradeFlow: available-match elements are missing from the HTML."
        );
        return;
    }

    loadingMatches = true;

    try {
        if (el.loadingState) {
            el.loadingState.hidden = true;
        }

        if (el.errorState) {
            el.errorState.hidden = true;
        }

        if (el.lobbyContent) {
            el.lobbyContent.hidden = true;
        }

        el.availableMatchesView.hidden = false;

        el.matchesListStatus.textContent =
            "Loading published matches...";

        el.availableMatchesList.replaceChildren();

        /*
         * Firestore retrieves only explicitly published,
         * public matches. The JavaScript filter below then
         * checks their scheduled start time.
         */
        const publicMatchesQuery = query(
            collection(db, "matches"),
            where("status", "==", "published"),
            where("visibility", "==", "public")
        );

        const snapshot = await getDocs(
            publicMatchesQuery
        );

        const now = Date.now();

        const available = snapshot.docs
            .map(matchDoc => ({
                id: matchDoc.id,
                ...matchDoc.data()
            }))
            .filter(item => {
                return isMatchAvailableNow(item, now);
            })
            .sort((a, b) => {
                const dateA =
                    getScheduledStartDate(a).getTime();

                const dateB =
                    getScheduledStartDate(b).getTime();

                // Most recently started matches appear first.
                return dateB - dateA;
            });

        renderAvailableMatches(available);
    } catch (error) {
        console.error(
            "GradeFlow available matches error:",
            error
        );

        el.availableMatchesList.replaceChildren();

        el.matchesListStatus.textContent =
            error?.code === "permission-denied"
                ? "Firestore denied access. Check your match list security rules and document fields."
                : "Could not load matches. Check your connection and try again.";
    } finally {
        loadingMatches = false;
    }
}

/* =========================================================
   LOAD A SINGLE MATCH LOBBY
========================================================= */

async function loadLobby() {
    if (loading) return;

    if (!matchId) {
        await loadAvailableMatches();
        return;
    }

    loading = true;

    showLoading();
    stopListeners();

    participants = [];
    ownApplication = null;

    try {
        const snapshot = await getDoc(
            doc(db, "matches", matchId)
        );

        if (!snapshot.exists()) {
            throw new Error(
                "This match does not exist or has been deleted."
            );
        }

        match = {
            id: snapshot.id,
            ...snapshot.data()
        };

        const host = isHost();

        if (!host && !isPublicPublished(match)) {
            throw new Error(
                "This match is not published or is not public."
            );
        }

        renderMatch(match);

        if (el.loadingState) {
            el.loadingState.hidden = true;
        }

        if (el.errorState) {
            el.errorState.hidden = true;
        }

        if (el.lobbyContent) {
            el.lobbyContent.hidden = false;
        }

        if (el.availableMatchesView) {
            el.availableMatchesView.hidden = true;
        }

        startParticipantListener();
        startApplicationListeners();
        updateJoinControls();

        showStatus(
            host
                ? "You are viewing your hosted match."
                : "Match loaded.",
            "success"
        );
    } catch (error) {
        console.error(
            "GradeFlow match lobby loading error:",
            error
        );

        showError(
            "Unable to open this match",
            error.message || "Please try again."
        );
    } finally {
        loading = false;
    }
}

/* =========================================================
   INITIALIZATION
========================================================= */

function initialize() {
    if (el.currentYear) {
        el.currentYear.textContent =
            String(new Date().getFullYear());
    }

    el.joinButton?.addEventListener(
        "click",
        joinMatch
    );

    el.copyMatchIdButton?.addEventListener(
        "click",
        copyMatchId
    );

    el.retryButton?.addEventListener(
        "click",
        loadLobby
    );

    el.refreshMatchesButton?.addEventListener(
        "click",
        loadAvailableMatches
    );

    onAuthStateChanged(
        auth,
        async currentUser => {
            user = currentUser;

            if (match) {
                startApplicationListeners();
                renderParticipants();
                updateJoinControls();
            } else if (!matchId) {
                await loadAvailableMatches();
            }
        },
        error => {
            console.error(
                "GradeFlow auth state error:",
                error
            );

            showToast(
                "Could not verify your sign-in status."
            );
        }
    );

    if (matchId) {
        loadLobby();
    } else {
        if (el.loadingState) {
            el.loadingState.hidden = true;
        }

        loadAvailableMatches();
    }
}

window.addEventListener(
    "pagehide",
    stopListeners
);

initialize();