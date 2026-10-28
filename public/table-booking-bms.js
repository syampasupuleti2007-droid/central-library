/* table-booking-bms.js — BookMyShow-style table booking logic */
"use strict";

const $ = (sel) => document.querySelector(sel);
const TABLES_PER_FLOOR = 30; // 6 rows x 5 columns

// ── State ─────────────────────────────────────────────────────
const state = {
  user: null,
  date: "",
  floor: 1,
  slots: [],
  selectedSlot: null,   // { startTime, endTime, availableTables }
  takenTables: new Set(),
  selectedTable: null,
  currentStep: 1
};

// ── Helpers ───────────────────────────────────────────────────
function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
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
    throw new Error("The library server is unavailable. Start it with `npm run dev`.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || "The request could not be completed.");
    err.status = response.status;
    throw err;
  }
  return data;
}

function toast(msg, duration = 3500) {
  const el = $("#bms-toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), duration);
}

function showError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearError(id) { $(id)?.classList.add("hidden"); }

function formatDateLabel(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr}T12:00:00`);
  return isNaN(d) ? dateStr : d.toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" });
}

function formatInputDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// ── Step navigation ───────────────────────────────────────────
function goToStep(n) {
  for (let i = 1; i <= 4; i++) {
    const panel = $(`#bms-step-panel-${i}`);
    if (panel) panel.classList.toggle("hidden", i !== n);
  }
  $("#bms-success-panel").classList.add("hidden");

  document.querySelectorAll(".bms-step").forEach(el => {
    const s = Number(el.dataset.step);
    el.classList.toggle("active", s === n);
    el.classList.toggle("done", s < n);
  });
  state.currentStep = n;
}

// ── Summary sidebar ───────────────────────────────────────────
function updateSummary() {
  $("#bms-sum-date-val").textContent = state.date ? formatDateLabel(state.date) : "—";
  $("#bms-sum-floor-val").textContent = state.floor ? `Floor ${state.floor}` : "—";
  $("#bms-sum-slot-val").textContent = state.selectedSlot
    ? `${state.selectedSlot.startTime} – ${state.selectedSlot.endTime}`
    : "—";
  $("#bms-sum-table-val").textContent = state.selectedTable ? `Table ${state.selectedTable}` : "—";
}

// ── STEP 1 — Date & Floor ─────────────────────────────────────
function initDatePicker() {
  const input = $("#bms-date");
  const today = new Date();
  const max = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  max.setDate(max.getDate() + 30);
  input.min = formatInputDate(today);
  input.max = formatInputDate(max);
  input.value = formatInputDate(today);
  state.date = input.value;
  input.addEventListener("change", () => {
    state.date = input.value;
    updateSummary();
  });
}

function initFloorCards() {
  const cards = document.querySelectorAll(".bms-floor-card");
  cards.forEach(card => {
    card.addEventListener("click", () => {
      cards.forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      state.floor = Number(card.dataset.floor);
      updateSummary();
    });
  });
}

// ── STEP 2 — Time Slots ───────────────────────────────────────
async function loadSlots() {
  const grid = $("#bms-slot-grid");
  const loading = $("#bms-slot-loading");
  clearError("#bms-slot-error");
  grid.innerHTML = "";
  loading.classList.remove("hidden");

  try {
    const query = new URLSearchParams({ date: state.date, floor: state.floor });
    const { slots } = await api(`/api/table-bookings/availability?${query}`);
    state.slots = slots;
    loading.classList.add("hidden");

    if (!slots.length) {
      grid.innerHTML = '<p class="bms-empty">No time slots available on this day. Try another date.</p>';
      return;
    }

    grid.innerHTML = slots.map(slot => {
      const full = slot.availableTables <= 0;
      const booked = slot.alreadyBooked;
      let cls = "bms-slot-btn";
      let availLabel = `${slot.availableTables} table${slot.availableTables === 1 ? "" : "s"} left`;
      if (booked) { cls += " already-booked"; availLabel = "Already booked"; }
      else if (full) { cls += " full"; availLabel = "Fully booked"; }
      return `<button class="${cls}" data-start="${escapeHtml(slot.startTime)}" data-end="${escapeHtml(slot.endTime)}" data-avail="${slot.availableTables}" ${(full || booked) ? "disabled" : ""} type="button">
        <span class="bms-slot-time">${escapeHtml(slot.startTime)} – ${escapeHtml(slot.endTime)}</span>
        <span class="bms-slot-avail">${availLabel}</span>
      </button>`;
    }).join("");

    // Click handler
    grid.addEventListener("click", (e) => {
      const btn = e.target.closest(".bms-slot-btn:not([disabled])");
      if (!btn) return;
      grid.querySelectorAll(".bms-slot-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      state.selectedSlot = {
        startTime: btn.dataset.start,
        endTime: btn.dataset.end,
        availableTables: Number(btn.dataset.avail)
      };
      updateSummary();
      // Auto-advance after brief delay
      setTimeout(() => goToSeatGrid(), 400);
    }, { once: false });

  } catch (err) {
    loading.classList.add("hidden");
    showError("#bms-slot-error", err.message);
  }
}

// ── STEP 3 — Seat Grid ────────────────────────────────────────
async function goToSeatGrid() {
  if (!state.selectedSlot) { toast("Please select a time slot first."); return; }
  goToStep(3);
  await renderSeatGrid();
}

async function renderSeatGrid() {
  const grid = $("#bms-seat-grid");
  grid.innerHTML = '<div class="bms-slot-loading"><div class="bms-spinner"></div><span>Loading table map…</span></div>';

  try {
    // Fetch taken table numbers for the chosen slot on this floor
    const query = new URLSearchParams({ date: state.date, floor: state.floor });
    const { slots, tablesPerFloor } = await api(`/api/table-bookings/availability?${query}`);
    const slot = slots.find(s => s.startTime === state.selectedSlot.startTime);
    const takenCount = slot ? tablesPerFloor - slot.availableTables : 0;

    // We know how many tables are taken; generate random "taken" layout
    // (API only tells us count; actual table numbers are assigned by server)
    const takenSet = new Set();
    // Deterministically mark first N tables as taken so the UI is stable
    for (let i = 1; i <= takenCount; i++) takenSet.add(i);
    state.takenTables = takenSet;

    const total = tablesPerFloor || TABLES_PER_FLOOR;
    grid.innerHTML = Array.from({ length: total }, (_, i) => {
      const num = i + 1;
      const taken = takenSet.has(num);
      const cls = taken ? "bms-table-seat taken" : "bms-table-seat available";
      const icon = taken ? "🚫" : "🪑";
      return `<button class="${cls}" data-table="${num}" ${taken ? "disabled" : ""} type="button" aria-label="Table ${num}${taken ? " (taken)" : ""}">
        <span class="bms-table-seat-icon">${icon}</span>
        <span class="bms-table-seat-num">T${num}</span>
      </button>`;
    }).join("");

    // Click
    grid.addEventListener("click", (e) => {
      const btn = e.target.closest(".bms-table-seat:not([disabled])");
      if (!btn) return;
      grid.querySelectorAll(".bms-table-seat.available").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      state.selectedTable = Number(btn.dataset.table);
      updateSummary();
      setTimeout(() => goToConfirm(), 400);
    });

    // Restore selection
    if (state.selectedTable && !takenSet.has(state.selectedTable)) {
      const prev = grid.querySelector(`[data-table="${state.selectedTable}"]`);
      if (prev) prev.classList.add("selected");
    }
  } catch (err) {
    grid.innerHTML = `<p class="bms-error">${escapeHtml(err.message)}</p>`;
  }
}

// ── STEP 4 — Confirm ──────────────────────────────────────────
function goToConfirm() {
  if (!state.selectedTable) { toast("Please pick a table first."); return; }
  goToStep(4);
  clearError("#bms-confirm-error");

  $("#bms-confirm-card").innerHTML = `
    <div class="bms-confirm-row">
      <span class="bms-confirm-label">Date</span>
      <span class="bms-confirm-val">${escapeHtml(formatDateLabel(state.date))}</span>
    </div>
    <div class="bms-confirm-row">
      <span class="bms-confirm-label">Floor</span>
      <span class="bms-confirm-val">Floor ${state.floor}</span>
    </div>
    <div class="bms-confirm-row">
      <span class="bms-confirm-label">Time</span>
      <span class="bms-confirm-val">${escapeHtml(state.selectedSlot.startTime)} – ${escapeHtml(state.selectedSlot.endTime)}</span>
    </div>
    <div class="bms-confirm-row">
      <span class="bms-confirm-label">Table</span>
      <span class="bms-confirm-val highlight">Table ${state.selectedTable}</span>
    </div>
    <div class="bms-confirm-row">
      <span class="bms-confirm-label">Fee</span>
      <span class="bms-confirm-val" style="color:#4caf7e">Free</span>
    </div>`;
}

async function confirmBooking() {
  const btn = $("#bms-confirm-btn");
  btn.disabled = true;
  btn.textContent = "Booking…";
  clearError("#bms-confirm-error");

  try {
    const { booking, message } = await api("/api/table-bookings", {
      method: "POST",
      body: JSON.stringify({
        date: state.date,
        floor: String(state.floor),
        startTime: state.selectedSlot.startTime
      })
    });

    // Show success
    showSuccess(booking, message);
    loadMyBookings();
    refreshNotificationBadge();
  } catch (err) {
    showError("#bms-confirm-error", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirm Table Booking";
  }
}

function showSuccess(booking, message) {
  for (let i = 1; i <= 4; i++) {
    const p = $(`#bms-step-panel-${i}`);
    if (p) p.classList.add("hidden");
  }
  document.querySelectorAll(".bms-step").forEach(el => el.classList.remove("active", "done"));
  document.querySelectorAll(".bms-step").forEach(el => el.classList.add("done"));

  const panel = $("#bms-success-panel");
  panel.classList.remove("hidden");
  $("#bms-success-message").textContent = message || "Your table has been confirmed!";

  const dateLabel = formatDateLabel(booking.date);
  $("#bms-ticket").innerHTML = `
    <p class="bms-ticket-title">BOOKING CONFIRMATION</p>
    <div class="bms-ticket-row"><span class="bms-ticket-key">Library</span><span class="bms-ticket-val">Central Public Library</span></div>
    <div class="bms-ticket-row"><span class="bms-ticket-key">Date</span><span class="bms-ticket-val">${escapeHtml(dateLabel)}</span></div>
    <div class="bms-ticket-row"><span class="bms-ticket-key">Time</span><span class="bms-ticket-val">${escapeHtml(booking.startTime)} – ${escapeHtml(booking.endTime)}</span></div>
    <div class="bms-ticket-row"><span class="bms-ticket-key">Floor</span><span class="bms-ticket-val">Floor ${escapeHtml(String(booking.floor))}</span></div>
    <div class="bms-ticket-row"><span class="bms-ticket-key">Table</span><span class="bms-ticket-val">Table ${escapeHtml(String(booking.tableNumber))}</span></div>
    <span class="bms-ticket-badge">CONFIRMED ✓</span>`;
}

// ── My Bookings (sidebar) ─────────────────────────────────────
async function loadMyBookings() {
  const list = $("#service-table-list");
  list.innerHTML = '<p class="bms-empty">Loading…</p>';
  try {
    const { bookings } = await api("/api/table-bookings/mine");
    if (!bookings.length) {
      list.innerHTML = '<p class="bms-empty">No bookings yet.</p>';
      return;
    }
    list.innerHTML = bookings.slice(0, 10).map(b => {
      const d = new Date(`${b.date}T12:00:00`);
      const dateLabel = isNaN(d) ? b.date : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      const confirmed = b.status === "confirmed";
      return `<div class="bms-booking-card">
        <div class="bms-booking-card-head">
          <h4>Floor ${escapeHtml(String(b.floor))}, Table ${escapeHtml(String(b.tableNumber))}</h4>
          <span class="bms-booking-badge ${confirmed ? "bms-badge-confirmed" : "bms-badge-cancelled"}">${confirmed ? "Confirmed" : "Cancelled"}</span>
        </div>
        <p>${escapeHtml(dateLabel)} · ${escapeHtml(b.startTime)}–${escapeHtml(b.endTime)}</p>
        ${confirmed ? `<button class="bms-booking-cancel-btn" data-service-cancel-table="${escapeHtml(b._id)}" type="button">Cancel</button>` : ""}
      </div>`;
    }).join("");
  } catch (err) {
    list.innerHTML = `<p class="bms-empty">${escapeHtml(err.message)}</p>`;
  }
}

async function cancelBooking(id) {
  if (!confirm("Cancel this table booking? The table will be released.")) return;
  try {
    const { message } = await api(`/api/table-bookings/${encodeURIComponent(id)}/cancel`, { method: "PATCH" });
    toast(message);
    loadMyBookings();
    refreshNotificationBadge();
  } catch (err) {
    toast("Could not cancel: " + err.message);
  }
}

async function refreshNotificationBadge() {
  try {
    const { unreadCount } = await api("/api/notifications/mine");
    const link = document.querySelector('.bms-nav a[href="/notifications.html"]');
    if (link) link.dataset.unread = unreadCount > 0 ? `(${unreadCount})` : "";
  } catch { /* silent */ }
}

// ── Reset for "Book Another" ──────────────────────────────────
function resetBooking() {
  state.selectedSlot = null;
  state.selectedTable = null;
  state.takenTables = new Set();
  updateSummary();
  goToStep(1);
}

// ── Auth & Init ───────────────────────────────────────────────
async function init() {
  document.querySelector(".service-year").textContent = new Date().getFullYear();

  // Update login link with return URL
  const loginEl = $("#service-login-link");
  loginEl.href = `/?login=1&return=${encodeURIComponent(window.location.pathname)}`;

  let user;
  try {
    ({ user } = await api("/api/auth/me"));
  } catch (err) {
    if (err.status === 401) {
      // already showing gate
    } else {
      $("#service-message").innerHTML = `<div class="bms-gate-inner"><h2>Unable to load</h2><p>${escapeHtml(err.message)}</p></div>`;
    }
    return;
  }

  state.user = user;
  loginEl.classList.add("hidden");
  const userLink = $("#service-user-link");
  userLink.textContent = user.name.split(" ")[0];
  userLink.classList.remove("hidden");
  const logoutBtn = $("#service-logout");
  logoutBtn.classList.remove("hidden");

  logoutBtn.addEventListener("click", async () => {
    logoutBtn.disabled = true;
    try {
      await api("/api/auth/logout", { method: "POST" });
      window.location.assign("/");
    } catch { logoutBtn.disabled = false; }
  });

  $("#service-message").classList.add("hidden");
  $("#service-content").classList.remove("hidden");

  initDatePicker();
  initFloorCards();
  updateSummary();
  loadMyBookings();
  goToStep(1);

  // ── Step buttons ─────────────────────────────────────────────
  $("#bms-to-step2").addEventListener("click", async () => {
    if (!state.date) { toast("Please select a date."); return; }
    goToStep(2);
    await loadSlots();
  });

  $("#bms-back-to-1").addEventListener("click", () => { state.selectedSlot = null; updateSummary(); goToStep(1); });
  $("#bms-back-to-2").addEventListener("click", () => { state.selectedTable = null; updateSummary(); goToStep(2); });
  $("#bms-back-to-3").addEventListener("click", () => { state.selectedTable = null; updateSummary(); goToStep(3); });

  $("#bms-confirm-btn").addEventListener("click", confirmBooking);
  $("#bms-book-another").addEventListener("click", resetBooking);

  // Sidebar bookings cancel delegation
  $("#service-table-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-service-cancel-table]");
    if (btn) cancelBooking(btn.dataset.serviceCancelTable);
  });

  $("#refresh-table-bookings").addEventListener("click", loadMyBookings);

  // Hamburger nav
  const menuToggle = $("#bms-menu-toggle");
  const nav = $("#bms-nav");
  menuToggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(open));
  });

  // Auto-refresh notifications
  window.setInterval(() => {
    if (document.visibilityState === "visible") refreshNotificationBadge();
  }, 30000);
}

init();
