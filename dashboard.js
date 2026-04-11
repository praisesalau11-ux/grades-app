import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let currentUser = null;
let subjectCount = 0;
let subjectsData = [];

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "login.html";
  } else {
    currentUser = user;
    showPage("dashboard");
  }
});

/* ================= SPA ROUTER ================= */

window.showPage = function (page) {
  const app = document.getElementById("app");

  if (page === "dashboard") {
    app.innerHTML = dashboardUI();
    attachDashboard();
  }

  if (page === "history") {
    app.innerHTML = historyUI();
    loadHistory();
  }

  if (page === "settings") {
    app.innerHTML = settingsUI();
  }
};

/* ================= DASHBOARD UI ================= */

function dashboardUI() {
  return `
    <h2>Dashboard</h2>

    <div id="subjects"></div>

    <button onclick="addSubject()">Add Subject</button>
    <button onclick="calculate()">Calculate</button>

    <h3 id="result"></h3>

    <canvas id="chart" width="300" height="200"></canvas>

    <div id="shareBox"></div>
  `;
}

/* ================= ADD SUBJECT ================= */

window.addSubject = function () {
  const div = document.getElementById("subjects");

  div.innerHTML += `
  <div class="card">
    <input placeholder="Subject Name" id="sub${subjectCount}">
    <input type="number" placeholder="Score" id="score${subjectCount}">
  </div>
`;

  subjectCount++;
};

/* ================= CALCULATE ================= */

window.calculate = async function () {
  let total = 0;
  subjectsData = [];

  for (let i = 0; i < subjectCount; i++) {
    const name = document.getElementById("sub" + i).value;
    const score = parseFloat(document.getElementById("score" + i).value);

    if (!name || isNaN(score)) {
      alert("Fill all fields");
      return;
    }

    total += score;

    subjectsData.push({
      name,
      score,
      grade: getGrade(score)
    });
  }

  let avg = total / subjectCount;
  let gpa = (avg / 20).toFixed(2);

  let weak = subjectsData.filter(s => s.score < 50);

  document.getElementById("result").innerHTML = `
    GPA: ${gpa} <br>
    Percentage: ${avg.toFixed(2)}% <br>
    Weak Subjects: ${weak.map(s => s.name).join(", ") || "None"}
  `;

  drawChart(subjectsData);

  /* ================= SAVE + SHARE ================= */

  const docRef = await addDoc(collection(db, "history"), {
    uid: currentUser.uid,
    subjects: subjectsData,
    gpa,
    percentage: avg,
    isPublic: true,
    time: serverTimestamp()
  });

  const shareLink = `${window.location.origin}/share.html?id=${docRef.id}`;

  document.getElementById("shareBox").innerHTML = `
    <button onclick="copyLink('${shareLink}')">Copy Share Link</button>

    <button onclick="togglePrivacy('${docRef.id}', true)">Make Private</button>
    <button onclick="togglePrivacy('${docRef.id}', false)">Make Public</button>
  `;
};

/* ================= COPY LINK ================= */

window.copyLink = function (link) {
  navigator.clipboard.writeText(link);
  alert("Link copied!");
};

/* ================= PRIVACY TOGGLE ================= */

window.togglePrivacy = async function (id, value) {
  await addDoc(collection(db, "history"), {
    shareId: id,
    isPublic: value
  });

  alert(value ? "Now Public" : "Now Private");
};

/* ================= GRADES ================= */

function getGrade(score) {
  if (score >= 70) return "A";
  if (score >= 60) return "B";
  if (score >= 50) return "C";
  if (score >= 45) return "D";
  if (score >= 40) return "E";
  return "F";
}

/* ================= CHART ================= */

function drawChart(data) {
  const ctx = document.getElementById("chart").getContext("2d");

  new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map(d => d.name),
      datasets: [{
        label: "Scores",
        data: data.map(d => d.score),
        backgroundColor: "#60a5fa"
      }]
    }
  });
}

/* ================= HISTORY ================= */

function historyUI() {
  return `
    <h2>History</h2>
    <div id="historyList"></div>
  `;
}

async function loadHistory() {
  const q = query(collection(db, "history"), where("uid", "==", currentUser.uid));
  const snap = await getDocs(q);

  let html = "";

  snap.forEach(doc => {
    const d = doc.data();

    html += `
      <div class="card">
        <p>GPA: ${d.gpa}</p>
        <p>Percentage: ${d.percentage}</p>
        <p>Time: ${d.time?.toDate?.() || "N/A"}</p>
      </div>
    `;
  });

  document.getElementById("historyList").innerHTML = html;
}

/* ================= SETTINGS ================= */

function settingsUI() {
  return `
    <h2>Settings</h2>

    <p>Email: ${currentUser.email}</p>

    <button onclick="logout()">Logout</button>
  `;
}

window.logout = async function () {
  await signOut(auth);
  window.location.href = "login.html";
};