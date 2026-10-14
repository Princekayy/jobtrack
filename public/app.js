// JobTrack - main application script
// Firebase Auth (email/password + Google) and Cloud Firestore for storage.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// ===== Firebase setup =====
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

// ===== State =====
const STATUSES = ["Applied", "Interview", "Offer", "Rejected"];
let applications = [];
let unsubscribe = null;
let editingId = null;
let isSignUp = false;

// ===== DOM helpers =====
const $ = (id) => document.getElementById(id);

const els = {
  authView: $("auth-view"),
  appView: $("app-view"),
  authForm: $("auth-form"),
  authEmail: $("auth-email"),
  authPassword: $("auth-password"),
  authError: $("auth-error"),
  authSubmit: $("auth-submit"),
  authTitle: $("auth-title"),
  authSubtitle: $("auth-subtitle"),
  authToggle: $("auth-toggle"),
  authSwitchText: $("auth-switch-text"),
  googleBtn: $("google-btn"),
  userEmail: $("user-email"),
  logoutBtn: $("logout-btn"),
  themeToggle: $("theme-toggle"),
  addBtn: $("add-btn"),
  search: $("search"),
  statusFilter: $("status-filter"),
  sort: $("sort"),
  loading: $("loading"),
  empty: $("empty"),
  table: $("table"),
  tbody: $("tbody"),
  modal: $("modal"),
  modalTitle: $("modal-title"),
  form: $("app-form"),
  formError: $("form-error"),
  cancelBtn: $("cancel-btn"),
  saveBtn: $("save-btn"),
  toast: $("toast"),
  fields: {
    company: $("f-company"),
    role: $("f-role"),
    date: $("f-date"),
    status: $("f-status"),
    location: $("f-location"),
    salary: $("f-salary"),
    link: $("f-link"),
    notes: $("f-notes"),
  },
};

// Escape user text before inserting into HTML (prevents XSS)
function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(isoDate) {
  if (!isoDate) return "-";
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function todayIso() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function isSafeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

let toastTimer;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2500);
}

function friendlyAuthError(error) {
  const map = {
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/missing-password": "Please enter your password.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/email-already-in-use": "An account with this email already exists.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/user-not-found": "Incorrect email or password.",
    "auth/wrong-password": "Incorrect email or password.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
    "auth/popup-closed-by-user": "Sign-in popup was closed.",
  };
  return map[error.code] || "Something went wrong. Please try again.";
}

// ===== Theme (follows system setting, toggle for this visit) =====
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}
applyTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
els.themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

// ===== Auth =====
function setAuthMode(signUp) {
  isSignUp = signUp;
  els.authTitle.textContent = signUp ? "Create your account" : "Welcome back";
  els.authSubtitle.textContent = signUp
    ? "Start tracking your job applications."
    : "Sign in to track your job applications.";
  els.authSubmit.textContent = signUp ? "Create account" : "Sign in";
  els.authSwitchText.textContent = signUp ? "Already have an account?" : "Don't have an account?";
  els.authToggle.textContent = signUp ? "Sign in" : "Create one";
  els.authPassword.autocomplete = signUp ? "new-password" : "current-password";
  els.authError.textContent = "";
}

els.authToggle.addEventListener("click", () => setAuthMode(!isSignUp));

els.authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.authError.textContent = "";
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;

  els.authSubmit.disabled = true;
  try {
    if (isSignUp) {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    els.authForm.reset();
  } catch (error) {
    els.authError.textContent = friendlyAuthError(error);
  } finally {
    els.authSubmit.disabled = false;
  }
});

els.googleBtn.addEventListener("click", async () => {
  els.authError.textContent = "";
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (error) {
    els.authError.textContent = friendlyAuthError(error);
  }
});

els.logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    els.authView.classList.add("hidden");
    els.appView.classList.remove("hidden");
    els.userEmail.textContent = user.email || "";
    subscribeToApplications(user.uid);
  } else {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    applications = [];
    els.appView.classList.add("hidden");
    els.authView.classList.remove("hidden");
    setAuthMode(false);
  }
});

// ===== Firestore =====
// Each user's data lives at: users/{uid}/applications/{applicationId}
function applicationsRef() {
  return collection(db, "users", auth.currentUser.uid, "applications");
}

function subscribeToApplications(uid) {
  if (unsubscribe) unsubscribe();
  els.loading.classList.remove("hidden");

  unsubscribe = onSnapshot(
    collection(db, "users", uid, "applications"),
    (snapshot) => {
      applications = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      els.loading.classList.add("hidden");
      render();
    },
    (error) => {
      console.error(error);
      els.loading.textContent = "Could not load applications. Check your Firebase setup.";
    }
  );
}

async function saveApplication(data) {
  if (editingId) {
    await updateDoc(doc(applicationsRef(), editingId), { ...data, updatedAt: serverTimestamp() });
    showToast("Application updated");
  } else {
    await addDoc(applicationsRef(), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    showToast("Application added");
  }
}

async function updateStatus(id, status) {
  await updateDoc(doc(applicationsRef(), id), { status, updatedAt: serverTimestamp() });
  showToast(`Status changed to ${status}`);
}

async function removeApplication(id) {
  await deleteDoc(doc(applicationsRef(), id));
  showToast("Application deleted");
}

// ===== Rendering =====
function getVisibleApplications() {
  const query = els.search.value.trim().toLowerCase();
  const status = els.statusFilter.value;
  const sort = els.sort.value;

  const filtered = applications.filter((a) => {
    const matchesStatus = status === "All" || a.status === status;
    const matchesQuery =
      !query ||
      a.company?.toLowerCase().includes(query) ||
      a.role?.toLowerCase().includes(query);
    return matchesStatus && matchesQuery;
  });

  return filtered.sort((a, b) => {
    if (sort === "company") return (a.company || "").localeCompare(b.company || "");
    const diff = (a.dateApplied || "").localeCompare(b.dateApplied || "");
    return sort === "oldest" ? diff : -diff;
  });
}

function renderStats() {
  const total = applications.length;
  const interviews = applications.filter((a) => a.status === "Interview").length;
  const offers = applications.filter((a) => a.status === "Offer").length;
  const responded = applications.filter((a) => a.status !== "Applied").length;
  const rate = total ? Math.round((responded / total) * 100) : 0;

  $("stat-total").textContent = total;
  $("stat-interview").textContent = interviews;
  $("stat-offer").textContent = offers;
  $("stat-rate").textContent = `${rate}%`;
}

function rowHtml(a) {
  const options = STATUSES.map(
    (s) => `<option value="${s}" ${s === a.status ? "selected" : ""}>${s}</option>`
  ).join("");

  const companyCell =
    a.link && isSafeUrl(a.link)
      ? `<a href="${escapeHtml(a.link)}" target="_blank" rel="noopener noreferrer" class="company">${escapeHtml(a.company)}</a>`
      : `<span class="company">${escapeHtml(a.company)}</span>`;

  const location = a.location ? `<span class="sub">${escapeHtml(a.location)}</span>` : "";
  const salary = a.salary ? `<span class="sub">${escapeHtml(a.salary)}</span>` : "";

  return `
    <tr>
      <td data-label="Company">${companyCell}${location}</td>
      <td data-label="Role">${escapeHtml(a.role)}${salary}</td>
      <td data-label="Date applied">${formatDate(a.dateApplied)}</td>
      <td data-label="Status">
        <select class="badge badge--${escapeHtml(a.status)}" data-action="status" data-id="${a.id}" aria-label="Change status">
          ${options}
        </select>
      </td>
      <td class="right">
        <div class="actions">
          <button type="button" class="action-btn" data-action="edit" data-id="${a.id}">Edit</button>
          <button type="button" class="action-btn action-btn--danger" data-action="delete" data-id="${a.id}">Delete</button>
        </div>
      </td>
    </tr>`;
}

function render() {
  renderStats();
  const visible = getVisibleApplications();

  const hasAny = applications.length > 0;
  els.empty.classList.toggle("hidden", hasAny);
  els.table.classList.toggle("hidden", !hasAny);

  els.tbody.innerHTML = visible.length
    ? visible.map(rowHtml).join("")
    : `<tr><td colspan="5" class="muted" style="text-align:center">No applications match your search.</td></tr>`;
}

els.search.addEventListener("input", render);
els.statusFilter.addEventListener("change", render);
els.sort.addEventListener("change", render);

// Table actions (event delegation)
els.tbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const { action, id } = btn.dataset;

  if (action === "edit") {
    openModal(applications.find((a) => a.id === id));
  } else if (action === "delete") {
    const app = applications.find((a) => a.id === id);
    if (confirm(`Delete your application to ${app?.company}?`)) {
      try {
        await removeApplication(id);
      } catch (error) {
        console.error(error);
        showToast("Could not delete. Try again.");
      }
    }
  }
});

els.tbody.addEventListener("change", async (e) => {
  const select = e.target.closest("select[data-action='status']");
  if (!select) return;
  try {
    await updateStatus(select.dataset.id, select.value);
  } catch (error) {
    console.error(error);
    showToast("Could not update status.");
  }
});

// ===== Modal =====
function openModal(app = null) {
  editingId = app ? app.id : null;
  els.modalTitle.textContent = app ? "Edit application" : "Add application";
  els.formError.textContent = "";

  const f = els.fields;
  f.company.value = app?.company || "";
  f.role.value = app?.role || "";
  f.date.value = app?.dateApplied || todayIso();
  f.status.value = app?.status || "Applied";
  f.location.value = app?.location || "";
  f.salary.value = app?.salary || "";
  f.link.value = app?.link || "";
  f.notes.value = app?.notes || "";

  els.modal.showModal();
  f.company.focus();
}

function closeModal() {
  els.modal.close();
  editingId = null;
}

els.addBtn.addEventListener("click", () => openModal());
els.cancelBtn.addEventListener("click", closeModal);

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = els.fields;

  const data = {
    company: f.company.value.trim(),
    role: f.role.value.trim(),
    dateApplied: f.date.value,
    status: f.status.value,
    location: f.location.value.trim(),
    salary: f.salary.value.trim(),
    link: f.link.value.trim(),
    notes: f.notes.value.trim(),
  };

  if (!data.company || !data.role || !data.dateApplied) {
    els.formError.textContent = "Company, role and date are required.";
    return;
  }
  if (data.link && !isSafeUrl(data.link)) {
    els.formError.textContent = "Job link must start with http:// or https://";
    return;
  }

  els.saveBtn.disabled = true;
  try {
    await saveApplication(data);
    closeModal();
  } catch (error) {
    console.error(error);
    els.formError.textContent = "Could not save. Please try again.";
  } finally {
    els.saveBtn.disabled = false;
  }
});
