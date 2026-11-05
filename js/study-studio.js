
import { auth, db, storage } from "./firebase.js";
import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const pdfInput = document.getElementById("pdfInput");
const uploadZone = document.getElementById("uploadZone");
const selectedFileBox = document.getElementById("selectedFile");
const selectedFileName = document.getElementById("selectedFileName");
const selectedFileSize = document.getElementById("selectedFileSize");
const uploadButton = document.getElementById("uploadButton");
const uploadStatus = document.getElementById("uploadStatus");
const libraryStatus = document.getElementById("libraryStatus");
const documentGrid = document.getElementById("documentGrid");
const refreshButton = document.getElementById("refreshButton");
const removeFileButton = document.getElementById("removeFile");

let currentUser = null;
let selectedFile = null;
let isUploading = false;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "Recently added";
  return timestamp.toDate().toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function setStatus(message, isError = false) {
  uploadStatus.textContent = message;
  uploadStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function clearSelectedFile() {
  selectedFile = null;
  pdfInput.value = "";
  selectedFileBox.hidden = true;
  uploadButton.disabled = true;
  setStatus("");
}

async function validatePdf(file) {
  if (!file) throw new Error("Choose a PDF file first.");

  if (file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Only PDF documents are accepted.");
  }

  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    throw new Error("The PDF must be smaller than or equal to 5 MB.");
  }

  // Check the actual PDF signature instead of trusting the filename.
  const header = await file.slice(0, 5).text();

  if (header !== "%PDF-") {
    throw new Error("This file does not appear to be a valid PDF.");
  }

  return true;
}

function selectFile(file) {
  if (!file) return;

  validatePdf(file)
    .then(() => {
      selectedFile = file;
      selectedFileName.textContent = file.name;
      selectedFileSize.textContent = formatBytes(file.size);
      selectedFileBox.hidden = false;
      uploadButton.disabled = false;
      setStatus("PDF ready for upload.");
    })
    .catch(error => {
      clearSelectedFile();
      setStatus(error.message, true);
    });
}

pdfInput.addEventListener("change", event => {
  selectFile(event.target.files?.[0]);
});

removeFileButton.addEventListener("click", clearSelectedFile);

uploadZone.addEventListener("dragover", event => {
  event.preventDefault();
  uploadZone.classList.add("dragover");
});

uploadZone.addEventListener("dragleave", () => {
  uploadZone.classList.remove("dragover");
});

uploadZone.addEventListener("drop", event => {
  event.preventDefault();
  uploadZone.classList.remove("dragover");

  const file = event.dataTransfer.files?.[0];
  if (file) selectFile(file);
});

async function uploadPdf() {
  if (!currentUser) {
    setStatus("Sign in before uploading.", true);
    return;
  }

  if (!selectedFile || isUploading) return;

  isUploading = true;
  uploadButton.disabled = true;
  setStatus("Uploading your PDF...");

  const uid = currentUser.uid;
  const documentId = crypto.randomUUID();

  const safeFileName = selectedFile.name
    .replace(/[^\w.-]/g, "_")
    .slice(0, 100);

  const storagePath =
    `users/${uid}/study-materials/${documentId}/${safeFileName}`;

  const storageReference = ref(storage, storagePath);
  let uploaded = false;

  try {
    await validatePdf(selectedFile);

    await uploadBytes(storageReference, selectedFile, {
      contentType: "application/pdf",
      customMetadata: {
        ownerUid: uid,
        documentId
      }
    });

    uploaded = true;

    const metadataReference = doc(
      db,
      "users",
      uid,
      "studyMaterials",
      documentId
    );

    await setDoc(metadataReference, {
      documentId,
      name: selectedFile.name,
      safeFileName,
      storagePath,
      size: selectedFile.size,
      contentType: "application/pdf",
      createdAt: serverTimestamp()
    });

    setStatus("PDF uploaded successfully.");
    clearSelectedFile();
    await loadMaterials();

  } catch (error) {
    console.error("Study Studio upload error:", error);

    // Avoid leaving an uploaded PDF behind if metadata saving fails.
    if (uploaded) {
      try {
        await deleteObject(storageReference);
      } catch (cleanupError) {
        console.error("Upload cleanup failed:", cleanupError);
      }
    }

    setStatus(
      error.code === "storage/unauthorized" ||
      error.code === "permission-denied"
        ? "Permission denied. Check your Firebase Storage and Firestore rules."
        : error.message || "Upload failed. Try again.",
      true
    );

  } finally {
    isUploading = false;
    uploadButton.disabled = !selectedFile;
  }
}

uploadButton.addEventListener("click", uploadPdf);

async function loadMaterials() {
  if (!currentUser) return;

  libraryStatus.textContent = "Loading your documents...";
  documentGrid.innerHTML = "";

  try {
    const materialsRef = collection(
      db,
      "users",
      currentUser.uid,
      "studyMaterials"
    );

    const materialsQuery = query(
      materialsRef,
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(materialsQuery);

    if (snapshot.empty) {
      libraryStatus.textContent = "";
      documentGrid.innerHTML = `
        <div class="empty-state">
          No study materials yet. Upload your first PDF above.
        </div>
      `;
      return;
    }

    libraryStatus.textContent =
      `${snapshot.size} saved document${snapshot.size === 1 ? "" : "s"}`;

    snapshot.forEach(documentSnapshot => {
      const material = documentSnapshot.data();

      const card = document.createElement("article");
      card.className = "document-card";

      const top = document.createElement("div");
      top.className = "document-top";

      const icon = document.createElement("div");
      icon.className = "pdf-icon";
      icon.textContent = "PDF";

      const info = document.createElement("div");
      info.className = "document-info";

      const title = document.createElement("strong");
      title.textContent = material.name || "Untitled PDF";

      const details = document.createElement("small");
      details.textContent =
        `${formatBytes(material.size || 0)} · ${formatDate(material.createdAt)}`;

      info.append(title, details);
      top.append(icon, info);

      const actions = document.createElement("div");
      actions.className = "document-actions";

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.textContent = "Open PDF";

      openButton.addEventListener("click", async () => {
        try {
          const fileReference = ref(storage, material.storagePath);
          const url = await getDownloadURL(fileReference);
          window.open(url, "_blank", "noopener,noreferrer");
        } catch (error) {
          console.error(error);
          libraryStatus.textContent =
            "Could not open this PDF. Check your Storage permissions.";
        }
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-button";
      deleteButton.textContent = "Delete";

      deleteButton.addEventListener("click", async () => {
        const confirmed = window.confirm(
          `Delete "${material.name || "this PDF"}"? This cannot be undone.`
        );

        if (!confirmed) return;

        deleteButton.disabled = true;

        try {
          const fileReference = ref(storage, material.storagePath);

          await deleteObject(fileReference);

          await deleteDoc(doc(
            db,
            "users",
            currentUser.uid,
            "studyMaterials",
            documentSnapshot.id
          ));

          await loadMaterials();

        } catch (error) {
          console.error("Delete error:", error);
          libraryStatus.textContent =
            "Could not delete this document. Check Firebase permissions.";
          deleteButton.disabled = false;
        }
      });

      actions.append(openButton, deleteButton);
      card.append(top, actions);
      documentGrid.append(card);
    });

  } catch (error) {
    console.error("Library loading error:", error);
    libraryStatus.textContent =
      "Could not load your library. Check your Firestore rules and connection.";
  }
}

refreshButton.addEventListener("click", loadMaterials);

onAuthStateChanged(auth, user => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  currentUser = user;
  loadMaterials();
});
