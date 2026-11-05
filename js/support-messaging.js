
import {
  collection,
  doc,
  writeBatch,
  serverTimestamp,
  updateDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  ref as storageRef,
  uploadBytes,
  getBlob,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

// Stores both completed URLs and in-progress download promises.
// This prevents duplicate downloads when messages rerender.
const objectUrlCache = new Map();

const allowedExactTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-zip-compressed",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
  "audio/mpeg",
  "audio/wav",
  "audio/aac"
]);

export function cleanContentType(type = "") {
  const clean = String(type).split(";")[0].trim().toLowerCase();

  return clean === "application/x-zip-compressed"
    ? "application/zip"
    : clean;
}

export function validateSupportFile(file) {
  if (!file) return "Choose a file first.";
  if (file.size <= 0) return "This file is empty.";

  if (file.size > MAX_ATTACHMENT_SIZE) {
    return "Attachments must be 10 MB or smaller.";
  }

  const type = cleanContentType(file.type);

  if (!(allowedExactTypes.has(type) || type.startsWith("audio/"))) {
    return "Unsupported file type. Use an image, PDF, office document, text/CSV, ZIP or audio file.";
  }

  return "";
}

function safeFileName(name) {
  return String(name || "attachment")
    .replace(/[\\/?%*:|"<>]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120) || "attachment";
}

// Gets image dimensions before uploading.
// If the browser cannot read dimensions, upload continues without them.
async function getImageDimensions(file) {
  if (!file || !cleanContentType(file.type).startsWith("image/")) {
    return null;
  }

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);

      const dimensions = {
        width: bitmap.width,
        height: bitmap.height
      };

      bitmap.close();

      return dimensions;
    } catch (error) {
      console.warn("Could not read image dimensions:", error);
    }
  }

  // Fallback for browsers without createImageBitmap.
  let localUrl = "";

  try {
    localUrl = URL.createObjectURL(file);

    const dimensions = await new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => {
        resolve({
          width: image.naturalWidth,
          height: image.naturalHeight
        });
      };

      image.onerror = reject;
      image.src = localUrl;
    });

    return dimensions;

  } catch (error) {
    console.warn("Image dimension fallback failed:", error);
    return null;

  } finally {
    if (localUrl) {
      URL.revokeObjectURL(localUrl);
    }
  }
}

export async function sendSupportMessage({
  db,
  storage,
  ticketId,
  user,
  role,
  message,
  file
}) {
  const cleanMessage = String(message || "").trim();

  if (!cleanMessage && !file) {
    throw new Error("Write a message or attach a file.");
  }

  if (cleanMessage.length > 3000) {
    throw new Error("Messages cannot exceed 3,000 characters.");
  }

  let uploadedPath = "";

  const messageRef = doc(
    collection(db, "supportTickets", ticketId, "messages")
  );

  let attachment = null;

  try {
    if (file) {
      const validationError = validateSupportFile(file);

      if (validationError) {
        throw new Error(validationError);
      }

      const contentType =
        cleanContentType(file.type) || "application/octet-stream";

      const filename = safeFileName(
        file.name ||
        `voice-message.${contentType.split("/")[1] || "audio"}`
      );

      uploadedPath =
        `supportTickets/${ticketId}/${user.uid}/${messageRef.id}/${filename}`;

      const objectRef = storageRef(storage, uploadedPath);

      const uploadBlob = file.type === contentType
        ? file
        : new Blob([file], { type: contentType });

      // Read image dimensions before uploading.
      const dimensions = await getImageDimensions(file);

      await uploadBytes(objectRef, uploadBlob, { contentType });

      let kind = "file";

      if (contentType.startsWith("image/")) kind = "image";
      if (contentType.startsWith("audio/")) kind = "audio";

      attachment = {
        path: uploadedPath,
        name: filename,
        contentType,
        size: file.size,
        kind
      };

      // New image attachments store their actual dimensions.
      if (dimensions) {
        attachment.width = dimensions.width;
        attachment.height = dimensions.height;
      }
    }

    const batch = writeBatch(db);

    const messageData = {
      senderId: user.uid,
      senderRole: role,
      message: cleanMessage,
      createdAt: serverTimestamp()
    };

    if (attachment) {
      messageData.attachment = attachment;
    }

    batch.set(messageRef, messageData);

    batch.update(
      doc(db, "supportTickets", ticketId),
      { updatedAt: serverTimestamp() }
    );

    await batch.commit();

    return messageRef.id;

  } catch (error) {
    if (uploadedPath) {
      try {
        await deleteObject(storageRef(storage, uploadedPath));
      } catch (cleanupError) {
        console.warn(
          "Could not clean up an unused support attachment:",
          cleanupError
        );
      }
    }

    throw error;
  }
}

// Authenticated download using Firebase Storage SDK.
// Do not replace this with getDownloadURL().
async function getAttachmentUrl(storage, path) {
  if (objectUrlCache.has(path)) {
    return objectUrlCache.get(path);
  }

  const downloadPromise = (async () => {
    const blob = await getBlob(storageRef(storage, path));
    return URL.createObjectURL(blob);
  })();

  objectUrlCache.set(path, downloadPromise);

  try {
    return await downloadPromise;
  } catch (error) {
    // Remove failed requests so they can be retried.
    if (objectUrlCache.get(path) === downloadPromise) {
      objectUrlCache.delete(path);
    }

    throw error;
  }
}

// Releases a cached object URL when an attachment is deleted.
async function clearAttachmentUrl(path) {
  const pendingUrl = objectUrlCache.get(path);

  objectUrlCache.delete(path);

  if (!pendingUrl) return;

  try {
    const url = await pendingUrl;
    URL.revokeObjectURL(url);
  } catch (error) {
    // Failed downloads have no object URL to release.
  }
}

function actionButton(label, handler) {
  const button = document.createElement("button");

  button.type = "button";
  button.className = "message-action";
  button.textContent = label;

  button.addEventListener("click", handler);

  return button;
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function addAttachmentPreview({
  bubble,
  attachment,
  storage,
  onError
}) {
  if (!attachment?.path) return;

  const holder = document.createElement("div");

  holder.className = "message-attachment-holder";
  holder.textContent = "Loading attachment…";

  bubble.appendChild(holder);

  const type = cleanContentType(attachment.contentType);

  // IMAGE ATTACHMENTS
  if (type.startsWith("image/")) {
    const width = Number(attachment.width);
    const height = Number(attachment.height);

    const hasDimensions =
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0;

    const frame = document.createElement("div");

    frame.className = "message-image-frame";

    // Reserve the correct space before the image downloads.
    // Older attachments without dimensions use a 4:3 fallback.
    frame.style.aspectRatio = hasDimensions
      ? `${width} / ${height}`
      : "4 / 3";

    holder.replaceChildren(frame);

    const loadImage = async () => {
      if (frame.dataset.loading === "true") return;

      frame.dataset.loading = "true";

      try {
        const url = await getAttachmentUrl(storage, attachment.path);

        const image = document.createElement("img");

        image.src = url;
        image.alt = attachment.name || "Attached image";
        image.className = "message-attachment image";
        image.loading = "eager";
        image.decoding = "async";

        if (hasDimensions) {
          image.width = width;
          image.height = height;
        }

        image.onerror = () => {
          frame.textContent = "Image could not be displayed.";
        };

        frame.replaceChildren(image);

      } catch (error) {
        console.error("Image loading failed:", error);

        frame.textContent = "Could not load image.";

        onError?.(
          "An attachment could not be loaded. Check Storage rules and bucket CORS settings.",
          "error"
        );
      }
    };

    // Load images as they approach the visible area.
    // This avoids downloading every image immediately.
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];

          if (entry.isIntersecting) {
            observer.disconnect();
            loadImage();
          }
        },
        {
          root: null,
          rootMargin: "300px 0px",
          threshold: 0.01
        }
      );

      observer.observe(frame);

    } else {
      loadImage();
    }

    return;
  }

  // AUDIO, DOCUMENTS AND OTHER FILES
  try {
    const url = await getAttachmentUrl(storage, attachment.path);

    holder.replaceChildren();

    if (type.startsWith("audio/")) {
      const audio = document.createElement("audio");

      audio.controls = true;
      audio.preload = "metadata";
      audio.src = url;
      audio.className = "message-attachment";

      holder.appendChild(audio);

      const filename = document.createElement("div");

      filename.className = "attachment-filename";
      filename.textContent = attachment.name || "Voice attachment";

      holder.appendChild(filename);

    } else {
      const link = document.createElement("a");

      link.href = url;
      link.download = attachment.name || "attachment";
      link.target = "_blank";
      link.rel = "noopener";
      link.className = "attachment-file";

      link.textContent =
        `Download ${attachment.name || "attachment"} (${formatBytes(attachment.size)})`;

      holder.appendChild(link);
    }

  } catch (error) {
    console.error("Attachment loading failed:", error);

    holder.textContent =
      `Could not load attachment: ${attachment.name || "file"}`;

    onError?.(
      "An attachment could not be loaded. Check Storage rules and bucket CORS settings.",
      "error"
    );
  }
}

export function formatDate(timestamp) {
  if (!timestamp?.toDate) return "Just now";

  return timestamp.toDate().toLocaleString();
}

export function renderSupportMessages({
  snapshot,
  container,
  storage,
  currentUser,
  currentRole,
  otherAuthor,
  db,
  ticketId,
  onNotice
}) {
  container.replaceChildren();

  if (snapshot.empty) {
    const empty = document.createElement("p");

    empty.className = "empty-state";
    empty.textContent = "No messages yet.";

    container.appendChild(empty);
    return;
  }

  snapshot.docs.forEach((messageDoc) => {
    const message = messageDoc.data();

    const own = message.senderId === currentUser.uid;

    const bubble = document.createElement("div");

    bubble.className =
      message.senderRole === "admin"
        ? "message admin"
        : "message user";

    const author = document.createElement("span");

    author.className = "message-author";

    author.textContent = own
      ? (currentRole === "admin"
          ? "You · GradeFlow Support"
          : "You")
      : otherAuthor;

    bubble.appendChild(author);

    if (message.message) {
      const text = document.createElement("p");

      text.className = "message-text";
      text.textContent = message.message;

      bubble.appendChild(text);
    }

    if (message.edited === true) {
      const edited = document.createElement("span");

      edited.className = "edited-label";
      edited.textContent = "edited";

      author.appendChild(edited);
    }

    if (message.attachment) {
      addAttachmentPreview({
        bubble,
        attachment: message.attachment,
        storage,
        onError: onNotice
      });
    }

    const time = document.createElement("span");

    time.className = "message-time";
    time.textContent = formatDate(message.createdAt);

    bubble.appendChild(time);

    if (own) {
      const actions = document.createElement("div");

      actions.className = "message-actions";

      if (message.message) {
        actions.appendChild(
          actionButton("Copy", async () => {
            try {
              await navigator.clipboard.writeText(message.message);
              onNotice?.("Message copied.");

            } catch (error) {
              onNotice?.(
                "Copy failed. Your browser may require HTTPS or clipboard permission.",
                "error"
              );
            }
          })
        );

        if (!message.attachment) {
          actions.appendChild(
            actionButton("Edit", async () => {
              const revised = window.prompt(
                "Edit your message:",
                message.message
              );

              if (revised === null) return;

              const clean = revised.trim();

              if (!clean || clean.length > 3000) {
                onNotice?.(
                  "Edited messages must contain 1–3,000 characters.",
                  "error"
                );
                return;
              }

              try {
                await updateDoc(
                  doc(
                    db,
                    "supportTickets",
                    ticketId,
                    "messages",
                    messageDoc.id
                  ),
                  {
                    message: clean,
                    edited: true,
                    editedAt: serverTimestamp()
                  }
                );

                onNotice?.("Message updated.");

              } catch (error) {
                console.error("Message edit failed:", error);

                onNotice?.(
                  "Could not edit this message. Check your Firestore rules.",
                  "error"
                );
              }
            })
          );
        }
      }

      actions.appendChild(
        actionButton("Delete", async () => {
          if (!window.confirm("Delete this message? This cannot be undone.")) {
            return;
          }

          try {
            if (message.attachment?.path) {
              await deleteObject(
                storageRef(storage, message.attachment.path)
              );

              await clearAttachmentUrl(message.attachment.path);
            }

            await deleteDoc(
              doc(
                db,
                "supportTickets",
                ticketId,
                "messages",
                messageDoc.id
              )
            );

            onNotice?.("Message deleted.");

          } catch (error) {
            console.error("Message deletion failed:", error);

            onNotice?.(
              "Could not delete this message. Check your permissions.",
              "error"
            );
          }
        })
      );

      bubble.appendChild(actions);
    }

    container.appendChild(bubble);
  });

  container.scrollTop = container.scrollHeight;
}
