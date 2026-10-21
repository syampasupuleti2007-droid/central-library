const $ = (selector) => document.querySelector(selector);
let librarySettings = {
  name: "Central Public Library",
  addressLine1: "100 Library Lane",
  city: "Your City",
  region: "ST",
  postalCode: "00000",
  weekdayHours: "9:00 am–8:00 pm"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
  } catch {
    throw new Error("The library server is unavailable. Start it with `npm run dev` and open http://localhost:3000.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "The request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function formatDate(value, includeTime = false) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleString(undefined, includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "long" });
}

function showSignedOut(message) {
  $("#profile-message").innerHTML = `
    <span class="profile-loading-mark" aria-hidden="true">C</span>
    <h2>Sign in to view your profile</h2>
    <p>${escapeHtml(message)}</p>
    <a class="button" href="/?login=1">Go to log in <span aria-hidden="true">→</span></a>`;
}

function renderAccount(user) {
  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  $("#profile-login-link").classList.add("hidden");
  $("#profile-header-user").textContent = user.name.split(" ")[0];
  $("#profile-header-user").classList.remove("hidden");
  $("#profile-first-name").textContent = `${user.name.split(" ")[0]}.`;
  $("#profile-full-name").textContent = user.name;
  $("#profile-avatar").textContent = initials;
  $("#profile-role").textContent = user.role;
  $("#profile-name-detail").textContent = user.name;
  $("#profile-library-id").textContent = user.libraryId || "Not assigned";
  $("#profile-email").textContent = user.email;
  $("#profile-account-type").textContent = user.role === "admin" ? "Administrator" : "Library member";
  $("#profile-joined").textContent = formatDate(user.createdAt);
  $("#profile-last-login").textContent = formatDate(user.lastLoginAt, true);
  $("#profile-message").classList.add("hidden");
  $("#profile-content").classList.remove("hidden");
}

function renderIssue(issue) {
  return `<article class="public-issue-card">
    <div class="public-issue-meta"><span>${escapeHtml(issue.category)}</span><span class="issue-status issue-status-${escapeHtml(issue.status)}">${({ submitted: "Submitted", reviewing: "Under review", resolved: "Resolved" })[issue.status] || "Submitted"}</span></div>
    <h3>${escapeHtml(issue.title)}</h3>
    <p class="public-issue-date">Reported ${escapeHtml(new Date(issue.createdAt).toLocaleDateString())}</p>
    <p class="public-issue-description">${escapeHtml(issue.description)}</p>
  </article>`;
}

async function loadUserIssues() {
  const list = $("#profile-issue-list");
  list.innerHTML = '<p class="empty-state">Loading your complaints...</p>';
  try {
    const { issues } = await api("/api/issues");
    list.innerHTML = issues.length
      ? issues.map(renderIssue).join("")
      : '<p class="empty-state">No complaints yet. Submit one and it will appear in the administrator portal.</p>';
  } catch (error) {
    list.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

function renderLoan(loan) {
  const book = loan.book || {};
  const isDelivery = loan.fulfillmentMethod === "delivery";
  const address = loan.deliveryAddress || {};
  const pickupAddress = [
    librarySettings.addressLine1,
    librarySettings.addressLine2,
    [librarySettings.city, librarySettings.region, librarySettings.postalCode, librarySettings.country].filter(Boolean).join(", ")
  ].filter(Boolean).join(", ");
  return `<article class="profile-loan">
    <div class="profile-loan-book">
      <span class="profile-loan-icon" aria-hidden="true">▤</span>
      <div><h3>${escapeHtml(book.title || "Book details unavailable")}</h3><p>by ${escapeHtml(book.author || "Unknown author")} · ${escapeHtml(book.category || "Other")}</p></div>
    </div>
    <div class="profile-loan-meta"><span>Requested</span><strong>${escapeHtml(formatDate(loan.createdAt))}</strong></div>
    <div class="profile-loan-meta"><span>Fulfillment</span><strong>${isDelivery ? "Home delivery" : "Library pickup"}</strong></div>
    <div class="profile-loan-meta"><span>Status</span><strong class="loan-status-badge status-${escapeHtml(loan.status)}">${escapeHtml(loan.status)}</strong></div>
    <div class="profile-loan-meta"><span>Due date</span><strong>${escapeHtml(loan.dueAt ? formatDate(loan.dueAt) : "—")}</strong></div>
    ${isDelivery ? `<div class="profile-delivery-address"><span>Delivery address</span><strong>${escapeHtml(address.recipient || "")} · ${escapeHtml(address.line1 || "")}${address.line2 ? `, ${escapeHtml(address.line2)}` : ""}, ${escapeHtml(address.city || "")}, ${escapeHtml(address.region || "")} ${escapeHtml(address.postalCode || "")}, ${escapeHtml(address.country || "")}</strong><small>${escapeHtml(address.phone || "")}</small><small>Delivery fee: ${loan.deliveryFeeRupees === undefined ? "Not recorded" : `₹${Number(loan.deliveryFeeRupees).toLocaleString("en-IN")} · demo only, not charged`}</small><small>Payment status: ${loan.paymentStatus === "demo_only" ? "Demo simulation only (no money charged)" : loan.paymentStatus === "not_required" ? "Not required" : "Not recorded"}</small></div>${renderTracking(loan.trackingStatus)}` : `<div class="profile-delivery-address"><span>Pickup location</span><strong>${escapeHtml(librarySettings.name)} · ${escapeHtml(pickupAddress)}</strong><small>Weekday hours: ${escapeHtml(librarySettings.weekdayHours)}</small></div>`}
  </article>`;
}

function renderTracking(status = "confirmed") {
  const stages = [
    ["confirmed", "Request confirmed"],
    ["preparing", "Preparing book"],
    ["out_for_delivery", "Out for delivery"],
    ["delivered", "Delivered"]
  ];
  const currentIndex = Math.max(0, stages.findIndex(([value]) => value === status));
  return `<div class="delivery-tracker profile-delivery-tracker" aria-label="Demo delivery tracking">
    <div class="delivery-tracker-heading"><strong>Delivery tracker</strong><span>DEMO</span></div>
    <div class="delivery-tracker-steps">${stages.map(([value, label], index) => `
      <div class="delivery-step${index <= currentIndex ? " complete" : ""}${index === currentIndex ? " current" : ""}">
        <span class="delivery-step-mark">${index < currentIndex ? "✓" : index + 1}</span><span>${label}</span>
      </div>`).join("")}</div>
    <p>Simulated status only — no courier service is connected.</p>
  </div>`;
}

async function renderHistory() {
  const { loans } = await api("/api/loans/mine");
  const requested = loans.filter((loan) => loan.status === "requested").length;
  const borrowed = loans.filter((loan) => loan.status === "approved").length;
  const returned = loans.filter((loan) => loan.status === "returned").length;

  $("#profile-history-stats").innerHTML = [
    ["Total requests", loans.length],
    ["Currently borrowed", borrowed],
    ["Returned", returned]
  ].map(([label, count]) => `<div class="profile-stat"><strong>${Number(count).toLocaleString()}</strong><span>${label}</span></div>`).join("");

  $("#profile-loans").innerHTML = loans.length
    ? loans.map(renderLoan).join("")
    : '<div class="profile-empty"><span aria-hidden="true">✳</span><h3>Your reading journey starts here.</h3><p>You have not requested any books yet. Explore the collection and find your next read.</p><a class="underlined-link" href="/#catalog">Browse books <span aria-hidden="true">→</span></a></div>';

  if (requested) {
    $("#profile-history-stats").insertAdjacentHTML(
      "beforeend",
      `<div class="profile-stat"><strong>${requested.toLocaleString()}</strong><span>Requests awaiting approval</span></div>`
    );
  }
}

$("#profile-issue-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const message = $("#profile-issue-message");
  button.disabled = true;
  message.textContent = "";
  try {
    const { notification } = await api("/api/issues", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
    });
    form.reset();
    message.textContent = `Your complaint was submitted. ${notification.message}`;
    await loadUserIssues();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#profile-logout").addEventListener("click", async () => {
  const button = $("#profile-logout");
  button.disabled = true;
  try {
    await api("/api/auth/logout", { method: "POST" });
    window.location.assign("/");
  } catch (error) {
    button.disabled = false;
    $("#profile-message").classList.remove("hidden");
    $("#profile-message").textContent = error.message;
  }
});

$("#profile-menu-toggle").addEventListener("click", () => {
  const nav = $("#profile-main-nav");
  const open = nav.classList.toggle("open");
  $("#profile-menu-toggle").setAttribute("aria-expanded", String(open));
});

$("#profile-year").textContent = new Date().getFullYear();

async function initializeProfile() {
  let user;
  try {
    ({ user } = await api("/api/auth/me"));
  } catch (error) {
    if (error.status === 401) {
      showSignedOut("Your profile and book history are available after you log in.");
    } else {
      showSignedOut(error.message);
    }
    return;
  }

  renderAccount(user);
  try {
    const { settings } = await api("/api/library-settings");
    librarySettings = settings;
  } catch (error) {
    console.error("Unable to load library pickup location:", error);
  }
  try {
    await renderHistory();
  } catch (error) {
    $("#profile-loans").innerHTML = `<div class="profile-empty"><h3>Book history is unavailable.</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
  try {
    await loadUserIssues();
  } catch (error) {
    $("#profile-issue-list").innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

initializeProfile();
