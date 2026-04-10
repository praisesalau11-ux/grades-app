import { db } from "./firebase.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const id = urlParams.get("id");

async function loadSharedResult() {
  if (!id) {
    document.getElementById("result").innerHTML = "No result found";
    return;
  }

  const docRef = doc(db, "history", id);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    document.getElementById("result").innerHTML = "Result not found";
    return;
  }

  const data = docSnap.data();

  let subjectsHtml = data.subjects.map(s => `
    <p>${s.name}: ${s.score} (${s.grade})</p>
  `).join("");

  document.getElementById("result").innerHTML = `
    <h3>GPA: ${data.gpa}</h3>
    <h3>Percentage: ${data.percentage}</h3>
    <h4>Subjects</h4>
    ${subjectsHtml}
  `;
}

loadSharedResult();