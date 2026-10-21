const $ = (selector) => document.querySelector(selector);
const serviceType = document.body.dataset.memberService;

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

function setFormMessage(element, text, isError = false) {
  element.textContent = text;
  element.classList.toggle("error", isError);
}

function showSignedOut(message) {
  $("#service-message").innerHTML = `
    <span class="profile-loading-mark" aria-hidden="true">C</span>
    <h2>Sign in to continue</h2>
    <p>${escapeHtml(message)}</p>
    <a class="button" href="/?login=1">Go to log in <span aria-hidden="true">→</span></a>`;
}

function addNavigationNotificationBadge(unreadCount) {
  const notificationLink = document.querySelector('.main-nav a[href="/notifications.html"]');
  if (!notificationLink) return;
  let badge = notificationLink.querySelector(".service-nav-notification-count");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "service-nav-notification-count hidden";
    badge.setAttribute("aria-label", "Unread notifications");
    notificationLink.append(badge);
  }
  badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
  badge.classList.toggle("hidden", unreadCount === 0);
}

async function refreshNotificationBadge() {
  const { unreadCount } = await api("/api/notifications/mine");
  addNavigationNotificationBadge(unreadCount);
  return unreadCount;
}

function renderNotification(notification) {
  return `<article class="profile-notification-card${notification.readAt ? "" : " unread"}">
    <div>
      ${notification.category === "admin_message" ? '<span class="profile-notification-origin">MESSAGE FROM LIBRARY STAFF</span>' : ""}
      <h3>${escapeHtml(notification.title)}</h3>
      <p>${escapeHtml(notification.message)}</p>
      <time datetime="${escapeHtml(notification.createdAt)}">${escapeHtml(formatDate(notification.createdAt, true))}</time>
    </div>
    ${notification.readAt ? "" : `<button type="button" data-service-read-notification="${escapeHtml(notification._id)}">Mark read</button>`}
  </article>`;
}

async function loadNotifications() {
  const list = $("#service-notification-list");
  list.innerHTML = '<p class="empty-state">Loading notifications...</p>';
  try {
    const { notifications, unreadCount } = await api("/api/notifications/mine");
    addNavigationNotificationBadge(unreadCount);
    $("#mark-all-notifications-read").disabled = unreadCount === 0;
    list.innerHTML = notifications.length
      ? notifications.map(renderNotification).join("")
      : '<p class="empty-state">You have no notifications yet. Updates will appear here as your requests are processed.</p>';
  } catch (error) {
    list.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

async function markAllNotificationsRead() {
  const button = $("#mark-all-notifications-read");
  button.disabled = true;
  try {
    await api("/api/notifications/read-all", { method: "PATCH" });
    await loadNotifications();
  } catch (error) {
    button.disabled = false;
    $("#service-notification-list").innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

async function markNotificationRead(event) {
  const button = event.target.closest("[data-service-read-notification]");
  if (!button) return;
  button.disabled = true;
  try {
    await api(`/api/notifications/${encodeURIComponent(button.dataset.serviceReadNotification)}/read`, { method: "PATCH" });
    await loadNotifications();
  } catch (error) {
    button.disabled = false;
    $("#service-notification-list").insertAdjacentHTML(
      "afterbegin",
      `<p class="empty-state">${escapeHtml(error.message)}</p>`
    );
  }
}

function renderTableBooking(booking) {
  const date = new Date(`${booking.date}T12:00:00`);
  const dateLabel = Number.isNaN(date.getTime()) ? booking.date : date.toLocaleDateString(undefined, { dateStyle: "long" });
  return `<article class="profile-table-booking-card">
    <div>
      <h4>Table address: Floor ${escapeHtml(booking.floor)}, Table ${escapeHtml(booking.tableNumber)}</h4>
      <p>${escapeHtml(dateLabel)} · ${escapeHtml(booking.startTime)}–${escapeHtml(booking.endTime)}</p>
      <span class="profile-table-status${booking.status === "cancelled" ? " profile-table-status-cancelled" : ""}">${escapeHtml(booking.status)}</span>
    </div>
    ${booking.status === "confirmed" ? `<button type="button" data-service-cancel-table="${escapeHtml(booking._id)}">Cancel booking</button>` : ""}
  </article>`;
}

async function loadTableBookings() {
  const list = $("#service-table-list");
  list.innerHTML = '<p class="empty-state">Loading your table bookings...</p>';
  try {
    const { bookings } = await api("/api/table-bookings/mine");
    list.innerHTML = bookings.length
      ? bookings.map(renderTableBooking).join("")
      : '<p class="empty-state">You have no table bookings yet.</p>';
  } catch (error) {
    list.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

async function loadTableAvailability() {
  const date = $("#service-table-date").value;
  const floor = $("#service-table-floor").value;
  const select = $("#service-table-slot");
  if (!date || !floor) return;
  select.disabled = true;
  select.innerHTML = '<option value="">Loading available slots...</option>';
  try {
    const query = new URLSearchParams({ date, floor });
    const { slots } = await api(`/api/table-bookings/availability?${query.toString()}`);
    if ($("#service-table-date").value !== date || $("#service-table-floor").value !== floor) return;
    const availableSlots = slots.filter((slot) => slot.availableTables > 0 && !slot.alreadyBooked);
    if (!slots.length) {
      select.innerHTML = '<option value="">No one-hour slots available</option>';
    } else if (!availableSlots.length) {
      select.innerHTML = `<option value="">${slots.some((slot) => slot.alreadyBooked) ? "You already have bookings for these slots" : "No tables available for this date and floor"}</option>`;
    } else {
      select.innerHTML = '<option value="">Choose a time slot</option>' + slots.map((slot) => {
        const unavailable = slot.availableTables <= 0 || slot.alreadyBooked;
        const label = slot.alreadyBooked
          ? "Already booked by you"
          : slot.availableTables <= 0
            ? "Full"
            : `${slot.availableTables} available`;
        return `<option value="${unavailable ? "" : escapeHtml(slot.startTime)}"${unavailable ? " disabled" : ""}>${escapeHtml(slot.startTime)}–${escapeHtml(slot.endTime)} · ${label}</option>`;
      }).join("");
    }
    select.disabled = availableSlots.length === 0;
  } catch (error) {
    if ($("#service-table-date").value !== date || $("#service-table-floor").value !== floor) return;
    select.innerHTML = '<option value="">Availability could not be loaded</option>';
    setFormMessage($("#service-table-message"), error.message, true);
  }
}

function initializeTableDate() {
  const dateInput = $("#service-table-date");
  const formatInputDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const today = new Date();
  const maxDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  maxDate.setDate(maxDate.getDate() + 30);
  dateInput.min = formatInputDate(today);
  dateInput.max = formatInputDate(maxDate);
  dateInput.value = formatInputDate(today);
}

async function submitTableBooking(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const message = $("#service-table-message");
  button.disabled = true;
  setFormMessage(message, "");
  try {
    const { message: confirmation } = await api("/api/table-bookings", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
    });
    setFormMessage(message, confirmation);
    await Promise.all([loadTableBookings(), loadTableAvailability()]);
    refreshNotificationBadge().catch((error) => console.error("Unable to refresh notification badge:", error));
  } catch (error) {
    setFormMessage(message, error.message, true);
    await loadTableAvailability();
  } finally {
    button.disabled = false;
  }
}

async function cancelTableBooking(event) {
  const button = event.target.closest("[data-service-cancel-table]");
  if (!button) return;
  if (!window.confirm("Cancel this table booking? The table will become available again.")) return;
  button.disabled = true;
  try {
    const { message } = await api(`/api/table-bookings/${encodeURIComponent(button.dataset.serviceCancelTable)}/cancel`, { method: "PATCH" });
    setFormMessage($("#service-table-message"), message);
    await Promise.all([loadTableBookings(), loadTableAvailability()]);
    refreshNotificationBadge().catch((error) => console.error("Unable to refresh notification badge:", error));
  } catch (error) {
    setFormMessage($("#service-table-message"), error.message, true);
    button.disabled = false;
  }
}

function renderSuggestion(suggestion) {
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

async function loadSuggestions() {
  const list = $("#service-suggestion-list");
  try {
    const { suggestions } = await api("/api/book-suggestions/mine");
    list.innerHTML = suggestions.length
      ? suggestions.map(renderSuggestion).join("")
      : '<p class="empty-state">You have not suggested a book yet.</p>';
  } catch (error) {
    list.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

async function submitSuggestion(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const message = $("#service-suggestion-message");
  button.disabled = true;
  setFormMessage(message, "");
  try {
    await api("/api/book-suggestions", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
    });
    form.reset();
    setFormMessage(message, "Your book suggestion was received and sent to the library team for review.");
    await loadSuggestions();
    refreshNotificationBadge().catch((error) => console.error("Unable to refresh notification badge:", error));
  } catch (error) {
    setFormMessage(message, error.message, true);
  } finally {
    button.disabled = false;
  }
}

function renderComplaint(issue) {
  const statusLabels = { submitted: "Submitted", reviewing: "Under review", resolved: "Resolved" };
  return `<article class="public-issue-card">
    <div class="public-issue-meta"><span>${escapeHtml(issue.category)}</span><span class="issue-status issue-status-${escapeHtml(issue.status)}">${escapeHtml(statusLabels[issue.status] || issue.status)}</span></div>
    <h3>${escapeHtml(issue.title)}</h3>
    <p class="public-issue-date">Reported ${escapeHtml(formatDate(issue.createdAt))}</p>
    <p class="public-issue-description">${escapeHtml(issue.description)}</p>
  </article>`;
}

async function loadComplaints() {
  const list = $("#service-complaint-list");
  try {
    const { issues } = await api("/api/issues");
    list.innerHTML = issues.length
      ? issues.map(renderComplaint).join("")
      : '<p class="empty-state">No complaints yet. Submit one and it will appear here.</p>';
  } catch (error) {
    list.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

async function submitComplaint(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const message = $("#service-complaint-message");
  button.disabled = true;
  setFormMessage(message, "");
  try {
    const { notification } = await api("/api/issues", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
    });
    form.reset();
    setFormMessage(message, `Your complaint was submitted. ${notification?.message || ""}`.trim());
    await loadComplaints();
    refreshNotificationBadge().catch((error) => console.error("Unable to refresh notification badge:", error));
  } catch (error) {
    setFormMessage(message, error.message, true);
  } finally {
    button.disabled = false;
  }
}

function setupServicePage() {
  if (serviceType === "notifications") {
    $("#refresh-notifications").addEventListener("click", loadNotifications);
    $("#mark-all-notifications-read").addEventListener("click", markAllNotificationsRead);
    $("#service-notification-list").addEventListener("click", markNotificationRead);
    loadNotifications();
    return;
  }
  if (serviceType === "table-bookings") {
    initializeTableDate();
    $("#service-table-date").addEventListener("change", () => {
      setFormMessage($("#service-table-message"), "");
      loadTableAvailability();
    });
    $("#service-table-floor").addEventListener("change", () => {
      setFormMessage($("#service-table-message"), "");
      loadTableAvailability();
    });
    $("#service-table-form").addEventListener("submit", submitTableBooking);
    $("#refresh-table-bookings").addEventListener("click", loadTableBookings);
    $("#service-table-list").addEventListener("click", cancelTableBooking);
    Promise.all([loadTableBookings(), loadTableAvailability()]);
    return;
  }
  if (serviceType === "book-suggestion") {
    $("#service-suggestion-form").addEventListener("submit", submitSuggestion);
    loadSuggestions();
    return;
  }
  if (serviceType === "complaint") {
    $("#service-complaint-form").addEventListener("submit", submitComplaint);
    loadComplaints();
  }
}

$("#service-menu-toggle").addEventListener("click", () => {
  const nav = $("#service-main-nav");
  const open = nav.classList.toggle("open");
  $("#service-menu-toggle").setAttribute("aria-expanded", String(open));
});
document.querySelectorAll(".service-year").forEach((element) => {
  element.textContent = new Date().getFullYear();
});

async function initializeMemberService() {
  $("#service-login-link").href = `/?login=1&return=${encodeURIComponent(window.location.pathname)}`;
  let user;
  try {
    ({ user } = await api("/api/auth/me"));
  } catch (error) {
    if (error.status === 401) {
      showSignedOut("Sign in to use member services and access your account.");
    } else {
      const message = $("#service-message");
      message.innerHTML = `<h2>Unable to load this page</h2><p>${escapeHtml(error.message)}</p>`;
    }
    return;
  }
  $("#service-login-link").classList.add("hidden");
  $("#service-user-link").textContent = user.name.split(" ")[0];
  $("#service-user-link").classList.remove("hidden");
  $("#service-logout").classList.remove("hidden");
  $("#service-message").classList.add("hidden");
  $("#service-content").classList.remove("hidden");
  $("#service-logout").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api("/api/auth/logout", { method: "POST" });
      window.location.assign("/");
    } catch (error) {
      button.disabled = false;
      const message = $("#service-message");
      message.textContent = error.message;
      message.classList.remove("hidden");
    }
  });
  await refreshNotificationBadge().catch((error) => console.error("Unable to refresh notification badge:", error));
  setupServicePage();
  window.setInterval(() => {
    if (document.visibilityState === "visible") {
      refreshNotificationBadge().catch((error) => console.error("Unable to refresh notification badge:", error));
      if (serviceType === "notifications") loadNotifications();
    }
  }, 30000);
  window.addEventListener("focus", () => {
    refreshNotificationBadge().catch((error) => console.error("Unable to refresh notification badge:", error));
  });
}

initializeMemberService();
