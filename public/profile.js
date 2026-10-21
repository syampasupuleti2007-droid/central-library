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
  $("#profile-chat").classList.remove("hidden");
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

function renderBookSuggestion(suggestion) {
  const statusLabels = {
    submitted: "Submitted",
    reviewing: "Under review",
    approved: "Approved",
    declined: "Declined",
    added: "Added to collection"
  };
  return `<article class="profile-suggestion-card">
    <div class="public-issue-meta"><span>Suggested ${escapeHtml(formatDate(suggestion.createdAt))}</span><span class="issue-status issue-status-${escapeHtml(suggestion.status)}">${escapeHtml(statusLabels[suggestion.status] || suggestion.status)}</span></div>
    <h3>${escapeHtml(suggestion.title)}</h3>
    ${suggestion.author ? `<p class="profile-suggestion-author">by ${escapeHtml(suggestion.author)}</p>` : ""}
    ${suggestion.details ? `<p class="public-issue-description">${escapeHtml(suggestion.details)}</p>` : ""}
  </article>`;
}

async function loadBookSuggestions() {
  const list = $("#profile-book-suggestions");
  try {
    const { suggestions } = await api("/api/book-suggestions/mine");
    list.innerHTML = suggestions.length
      ? suggestions.map(renderBookSuggestion).join("")
      : '<p class="empty-state">You have not suggested a book yet.</p>';
  } catch (error) {
    list.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

async function loadMemberNotifications(renderList = true) {
  const list = $("#profile-notification-list");
  try {
    const { notifications, unreadCount } = await api("/api/notifications/mine");
    const badge = $("#profile-notification-count");
    badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    badge.classList.toggle("hidden", unreadCount === 0);
    $("#open-notifications").setAttribute(
      "aria-label",
      unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"
    );
    $("#mark-all-notifications-read").disabled = unreadCount === 0;
    if (!renderList) return;
    list.innerHTML = notifications.length
      ? notifications.map((notification) => `<article class="profile-notification-card${notification.readAt ? "" : " unread"}">
          <div>
            ${notification.category === "admin_message" ? '<span class="profile-notification-origin">MESSAGE FROM LIBRARY STAFF</span>' : ""}
            <h3>${escapeHtml(notification.title)}</h3>
            <p>${escapeHtml(notification.message)}</p>
            <time datetime="${escapeHtml(notification.createdAt)}">${escapeHtml(formatDate(notification.createdAt, true))}</time>
          </div>
          ${notification.readAt ? "" : `<button type="button" data-read-notification="${escapeHtml(notification._id)}">Mark read</button>`}
        </article>`).join("")
      : '<p class="empty-state">You have no notifications yet. Updates will appear here as your requests are processed.</p>';
  } catch (error) {
    if (renderList) list.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

async function loadTableBookings() {
  const list = $("#profile-table-booking-list");
  list.innerHTML = '<p class="empty-state">Loading your table bookings...</p>';
  try {
    const { bookings } = await api("/api/table-bookings/mine");
    list.innerHTML = bookings.length
      ? bookings.map((booking) => {
        const date = new Date(`${booking.date}T12:00:00`);
        const dateLabel = Number.isNaN(date.getTime()) ? booking.date : date.toLocaleDateString(undefined, { dateStyle: "long" });
        return `<article class="profile-table-booking-card">
          <div>
            <h4>Table address: Floor ${escapeHtml(booking.floor)}, Table ${escapeHtml(booking.tableNumber)}</h4>
            <p>${escapeHtml(dateLabel)} · ${escapeHtml(booking.startTime)}–${escapeHtml(booking.endTime)}</p>
            <span class="profile-table-status${booking.status === "cancelled" ? " profile-table-status-cancelled" : ""}">${escapeHtml(booking.status)}</span>
          </div>
          ${booking.status === "confirmed" ? `<button type="button" data-cancel-table-booking="${escapeHtml(booking._id)}">Cancel booking</button>` : ""}
        </article>`;
      }).join("")
      : '<p class="empty-state">You have no table bookings yet.</p>';
  } catch (error) {
    list.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

async function loadTableAvailability() {
  const date = $("#table-booking-date").value;
  const floor = $("#table-booking-floor").value;
  const slots = $("#table-booking-slot");
  const message = $("#table-booking-message");
  if (!date || !floor) return;
  slots.disabled = true;
  slots.innerHTML = '<option value="">Loading available slots...</option>';
  try {
    const query = new URLSearchParams({ date, floor });
    const { slots: availableSlots } = await api(`/api/table-bookings/availability?${query.toString()}`);
    if ($("#table-booking-date").value !== date || $("#table-booking-floor").value !== floor) return;
    const bookableSlots = availableSlots.filter((slot) => slot.availableTables > 0 && !slot.alreadyBooked);
    slots.innerHTML = availableSlots.length
      ? '<option value="">Choose a time slot</option>' + availableSlots
        .map((slot) => {
          const unavailable = slot.availableTables <= 0 || slot.alreadyBooked;
          const label = slot.alreadyBooked
            ? "Already booked by you"
            : slot.availableTables <= 0
              ? "Full"
              : `${slot.availableTables} available`;
          return `<option value="${unavailable ? "" : escapeHtml(slot.startTime)}"${unavailable ? " disabled" : ""}>${escapeHtml(slot.startTime)}–${escapeHtml(slot.endTime)} · ${label}</option>`;
        })
        .join("")
      : '<option value="">No one-hour slots available</option>';
    if (availableSlots.length && !bookableSlots.length) {
      slots.innerHTML = `<option value="">${availableSlots.some((slot) => slot.alreadyBooked) ? "You already have bookings for these slots" : "No tables available for this date and floor"}</option>`;
    }
    slots.disabled = !bookableSlots.length;
  } catch (error) {
    if ($("#table-booking-date").value !== date || $("#table-booking-floor").value !== floor) return;
    slots.innerHTML = '<option value="">Availability could not be loaded</option>';
    message.textContent = error.message;
    message.classList.add("error");
  }
}

function initializeTableBookingControls() {
  const dateInput = $("#table-booking-date");
  const formatDateInput = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const now = new Date();
  const today = formatDateInput(now);
  const lastDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  lastDate.setDate(lastDate.getDate() + 30);
  dateInput.min = today;
  dateInput.max = formatDateInput(lastDate);
  dateInput.value = today;
}

function renderLoan(loan) {
  const book = loan.book || {};
  const isDelivery = loan.fulfillmentMethod === "delivery";
  const deliveryReceived = isDelivery && (loan.trackingStatus === "delivered" || loan.deliveredAt);
  const address = loan.deliveryAddress || {};
  const statusLabels = {
    requested: "Awaiting approval",
    approved: "Borrowed",
    return_requested: "Return requested — awaiting library confirmation",
    returned: "Returned — received by library",
    declined: "Declined"
  };
  const pickupAddress = [
    librarySettings.addressLine1,
    librarySettings.addressLine2,
    [librarySettings.city, librarySettings.region, librarySettings.postalCode, librarySettings.country].filter(Boolean).join(", ")
  ].filter(Boolean).join(", ");
  const returnNotice = loan.status === "return_requested"
    ? `<div class="profile-return-notice" role="status"><strong>Return request received</strong><span>Requested ${escapeHtml(formatDate(loan.returnRequestedAt, true))}. Please bring the book to ${escapeHtml(librarySettings.name)} at ${escapeHtml(pickupAddress)}. Staff will confirm receipt and update availability.</span></div>`
    : loan.status === "returned"
      ? `<div class="profile-return-notice" role="status"><strong>Book successfully received</strong><span>The library recorded this return${loan.returnRequestedAt ? ` on ${escapeHtml(formatDate(loan.updatedAt, true))}` : ""}. This copy is available again.</span></div>`
      : "";
  return `<article class="profile-loan">
    <div class="profile-loan-book">
      <span class="profile-loan-icon" aria-hidden="true">▤</span>
      <div><h3>${escapeHtml(book.title || "Book details unavailable")}</h3><p>by ${escapeHtml(book.author || "Unknown author")} · ${escapeHtml(book.category || "Other")}</p></div>
    </div>
    <div class="profile-loan-meta"><span>Requested</span><strong>${escapeHtml(formatDate(loan.createdAt))}</strong></div>
    <div class="profile-loan-meta"><span>Fulfillment</span><strong>${isDelivery ? "Home delivery" : "Library pickup"}</strong></div>
    <div class="profile-loan-meta"><span>Status</span><strong class="loan-status-badge status-${escapeHtml(loan.status)}">${escapeHtml(statusLabels[loan.status] || loan.status)}</strong></div>
    <div class="profile-loan-meta"><span>Due date</span><strong>${escapeHtml(loan.dueAt ? formatDate(loan.dueAt) : "—")}</strong></div>
    ${returnNotice}
    ${loan.status === "approved" && (!isDelivery || deliveryReceived) ? `<div class="profile-loan-return"><button class="button button-small" type="button" data-return-loan="${escapeHtml(loan._id)}">Request book return</button><p data-return-message role="status"></p></div>` : ""}
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
  const borrowed = loans.filter((loan) => ["approved", "return_requested"].includes(loan.status)).length;
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

$("#profile-loans").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-return-loan]");
  if (!button) return;
  button.disabled = true;
  const card = button.closest(".profile-loan");
  const message = card.querySelector("[data-return-message]");
  message.textContent = "";
  try {
    await api(`/api/loans/${encodeURIComponent(button.dataset.returnLoan)}/return`, {
      method: "POST"
    });
  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
    return;
  }
  message.textContent = "Return request received. Please bring the book to the library; availability updates after staff confirms receipt.";
  await loadMemberNotifications();
  try {
    await renderHistory();
  } catch (error) {
    message.textContent += ` Your request is saved, but the book history could not refresh: ${error.message}`;
  }
});

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
    await Promise.all([loadUserIssues(), loadMemberNotifications()]);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#book-suggestion-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const message = $("#book-suggestion-message");
  button.disabled = true;
  message.textContent = "";
  try {
    await api("/api/book-suggestions", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
    });
    form.reset();
    message.textContent = "Your book suggestion was received and sent to the library team for review.";
    await Promise.all([loadBookSuggestions(), loadMemberNotifications()]);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function refreshTableAvailabilityForSelection() {
  const message = $("#table-booking-message");
  message.textContent = "";
  message.classList.remove("error");
  loadTableAvailability();
}

$("#table-booking-date").addEventListener("change", refreshTableAvailabilityForSelection);
$("#table-booking-floor").addEventListener("change", refreshTableAvailabilityForSelection);
$("#refresh-table-bookings").addEventListener("click", loadTableBookings);

$("#table-booking-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const message = $("#table-booking-message");
  button.disabled = true;
  message.textContent = "";
  message.classList.remove("error");
  try {
    const data = Object.fromEntries(new FormData(form).entries());
    const { message: confirmation } = await api("/api/table-bookings", {
      method: "POST",
      body: JSON.stringify(data)
    });
    message.textContent = confirmation;
    await Promise.all([loadTableBookings(), loadTableAvailability(), loadMemberNotifications()]);
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
    await loadTableAvailability();
  } finally {
    button.disabled = false;
  }
});

$("#profile-table-booking-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-cancel-table-booking]");
  if (!button) return;
  if (!window.confirm("Cancel this table booking? The table will become available again.")) return;
  button.disabled = true;
  try {
    const { message } = await api(`/api/table-bookings/${encodeURIComponent(button.dataset.cancelTableBooking)}/cancel`, {
      method: "PATCH"
    });
    $("#table-booking-message").textContent = message;
    $("#table-booking-message").classList.remove("error");
    await Promise.all([loadTableBookings(), loadTableAvailability(), loadMemberNotifications()]);
  } catch (error) {
    $("#table-booking-message").textContent = error.message;
    $("#table-booking-message").classList.add("error");
    button.disabled = false;
  }
});

$("#refresh-notifications").addEventListener("click", () => loadMemberNotifications());

$("#mark-all-notifications-read").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api("/api/notifications/read-all", { method: "PATCH" });
    await loadMemberNotifications();
  } catch (error) {
    button.disabled = false;
    $("#profile-notification-list").innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
});

$("#profile-notification-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-read-notification]");
  if (!button) return;
  button.disabled = true;
  try {
    await api(`/api/notifications/${encodeURIComponent(button.dataset.readNotification)}/read`, {
      method: "PATCH"
    });
    await loadMemberNotifications();
  } catch (error) {
    button.disabled = false;
    $("#profile-notification-list").insertAdjacentHTML(
      "afterbegin",
      `<p class="empty-state">${escapeHtml(error.message)}</p>`
    );
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

function getLibraryAssistantReply(message) {
  const text = message.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (/\b(hi|hello|hey|good morning|good afternoon)\b/.test(text)) {
    return "Hello! I can guide you through table bookings, borrowing, returns, delivery, book suggestions, and complaints.";
  }
  if (/\b(table|seat|seating|sitting|study space|reservation)\b/.test(text)) {
    return "Choose Book a table near the top of your profile, then select a date, floor, and available one-hour slot. There are 30 tables on each of 5 floors. Confirmed tables can be cancelled from Your table bookings.";
  }
  if (/\b(notification|message|status update|admin update)\b/.test(text)) {
    return "Open Notifications near the top of your profile to see updates from the library about book requests, returns, delivery, table bookings, suggestions, and complaints.";
  }
  if (/\b(suggest|suggestion|recommend|new book|add a book)\b/.test(text)) {
    return "Use the Suggest a book button near the top of your profile to send a title to the library team and check its review status.";
  }
  if (/\b(complaint|complain|report|problem|issue)\b/.test(text)) {
    return "Use Submit a complaint near the top of your profile. Your report and its status will be visible in the complaints section.";
  }
  if (/\b(return|give back|bring back)\b/.test(text)) {
    return "In Book history, choose Request book return for an eligible loan. For delivery orders, wait until tracking says delivered. Library staff confirm receipt before the copy becomes available again.";
  }
  if (/\b(delivery|delivered|tracking|track|courier|pickup)\b/.test(text)) {
    return "Your delivery or pickup details and status are shown in Book history. Delivery tracking is a demo status, not a live courier connection.";
  }
  if (/\b(available|availability|copies|in stock|out of stock)\b/.test(text)) {
    return "I can't see live stock counts. Open Explore books to check each title's current available copies and whether requests are open.";
  }
  if (/\b(borrow|request|reserve|checkout|check out)\b/.test(text)) {
    return "Browse Explore books, choose Request this book, then select pickup or delivery. A request reserves a copy while it is awaiting approval.";
  }
  if (/\b(account|history|loan|loans|my books|borrowed)\b/.test(text)) {
    return "Your book requests, loan statuses, due dates, and return actions are listed in the Book history section of this page.";
  }
  if (/\b(hours|opening|open|close|address|location|where)\b/.test(text)) {
    return "For the library's latest hours and location, use the Visit link in the site navigation. I don't have live library settings in this offline helper.";
  }
  if (/\b(help|what can you do|options)\b/.test(text)) {
    return "Ask about notifications, table bookings, checking book availability, requesting a book, returns, delivery tracking, suggestions, or complaints.";
  }
  return "I don't have a built-in answer for that yet. I can help with notifications, table bookings, book availability, requests, returns, delivery, suggestions, and complaints. For live information, check the catalog or Book history.";
}

function appendLibraryChatMessage(message, sender) {
  const bubble = document.createElement("p");
  bubble.className = `profile-chat-bubble profile-chat-${sender}`;
  bubble.textContent = message;
  $("#profile-chat-messages").append(bubble);
  bubble.scrollIntoView({ block: "nearest" });
}

$("#profile-chat-toggle").addEventListener("click", () => {
  const panel = $("#profile-chat-panel");
  const open = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !open);
  $("#profile-chat-toggle").setAttribute("aria-expanded", String(open));
  if (open) $("#profile-chat-input").focus();
});

$("#profile-chat-close").addEventListener("click", () => {
  $("#profile-chat-panel").classList.add("hidden");
  $("#profile-chat-toggle").setAttribute("aria-expanded", "false");
  $("#profile-chat-toggle").focus();
});

$("#profile-chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#profile-chat-input");
  const message = input.value.trim();
  if (!message) return;
  appendLibraryChatMessage(message, "user");
  appendLibraryChatMessage(getLibraryAssistantReply(message), "bot");
  input.value = "";
  input.focus();
});

window.addEventListener("focus", () => {
  if (!$("#profile-content").classList.contains("hidden")) {
    loadMemberNotifications($("#open-notifications").getAttribute("aria-expanded") === "true");
  }
});

$("#profile-year").textContent = new Date().getFullYear();
initializeTableBookingControls();

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
  await loadBookSuggestions();
  await Promise.all([loadTableBookings(), loadTableAvailability(), loadMemberNotifications()]);
  window.setInterval(() => {
    if (document.visibilityState === "visible") {
      loadMemberNotifications($("#open-notifications").getAttribute("aria-expanded") === "true");
    }
  }, 30000);
}

initializeProfile();
