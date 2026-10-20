const $ = (selector) => document.querySelector(selector);
const adminState = { user: null, bookPage: 1, bookSearch: "", searchTimer: null };

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
    throw new Error("The server is unavailable. Start the app with `npm run dev` and open http://localhost:3000.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "The request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function setMessage(selector, text, isError = false) {
  const element = $(selector);
  element.textContent = text;
  element.classList.toggle("error", isError);
}

function issueStatusLabel(status) {
  return ({ submitted: "Submitted", reviewing: "Under review", resolved: "Resolved" })[status] || "Submitted";
}

function renderAdmin(user) {
  adminState.user = user;
  $("#admin-login-card").classList.add("hidden");
  $("#admin-dashboard").classList.remove("hidden");
  $("#admin-name").textContent = user.name.split(" ")[0] + ".";
  $("#admin-email").textContent = user.email;
  loadOverview();
  loadSettings();
  loadBooks();
  loadDeliveries();
  loadIssues();
}

async function loadOverview() {
  try {
    const { stats } = await api("/api/admin/overview");
    $("#admin-stats").innerHTML = [
      ["Books in collection", stats.books],
      ["Library members", stats.members],
      ["Active requests", stats.activeLoans]
    ].map(([label, value]) => `<article class="admin-stat"><strong>${Number(value).toLocaleString()}</strong><span>${label}</span></article>`).join("");
  } catch (error) {
    $("#admin-stats").innerHTML = `<p class="admin-empty">${escapeHtml(error.message)}</p>`;
  }
}

async function loadSettings() {
  try {
    const { settings } = await api("/api/library-settings");
    const form = $("#library-settings-form");
    for (const name of ["name", "addressLine1", "addressLine2", "city", "region", "postalCode", "country", "email", "weekdayHours", "saturdayHours", "sundayHours"]) {
      form.elements[name].value = settings[name] || "";
    }
    form.elements.deliveryEnabled.checked = Boolean(settings.deliveryEnabled);
  } catch (error) {
    setMessage("#settings-message", error.message, true);
  }
}

function renderBookEditor(book) {
  return `<form class="admin-book-row" data-book-form="${escapeHtml(book._id)}">
    <div class="admin-book-identity"><span class="admin-book-cover">${book.coverUrl || book.coverId ? `<img src="${escapeHtml(book.coverUrl || `https://covers.openlibrary.org/b/id/${Number(book.coverId)}-S.jpg`)}" alt="">` : "C"}</span><span class="admin-book-source">${escapeHtml(book.source || "staff")}</span></div>
    <label>Title<input name="title" value="${escapeHtml(book.title)}" required maxlength="300"></label>
    <label>Author<input name="author" value="${escapeHtml(book.author || "")}" maxlength="200"></label>
    <label>Year<input name="year" type="number" min="1" max="2100" value="${escapeHtml(book.year || "")}"></label>
    <label>Cover URL<input name="coverUrl" type="url" maxlength="2048" value="${escapeHtml(book.coverUrl || "")}" placeholder="Open Library cover or HTTPS URL"></label>
    <div class="admin-book-save"><button class="button button-small" type="submit">Save changes</button><p class="admin-message" role="status"></p></div>
  </form>`;
}

async function loadBooks() {
  const list = $("#admin-book-list");
  list.innerHTML = '<p class="admin-empty">Loading books...</p>';
  try {
    const params = new URLSearchParams({ page: adminState.bookPage, limit: "20" });
    if (adminState.bookSearch) params.set("search", adminState.bookSearch);
    const data = await api(`/api/admin/books?${params}`);
    list.innerHTML = data.books.length
      ? data.books.map(renderBookEditor).join("")
      : '<p class="admin-empty">No matching books. Add a book using the form above.</p>';
    renderBookPagination(data.page, data.pages);
  } catch (error) {
    list.innerHTML = `<p class="admin-empty error">${escapeHtml(error.message)}</p>`;
    $("#admin-book-pagination").replaceChildren();
  }
}

function renderBookPagination(page, pages) {
  const controls = $("#admin-book-pagination");
  controls.innerHTML = "";
  if (page > 1) controls.insertAdjacentHTML("beforeend", '<button class="admin-page-button" data-book-page="previous" type="button">← Previous</button>');
  if (page < pages) controls.insertAdjacentHTML("beforeend", '<button class="admin-page-button" data-book-page="next" type="button">Next →</button>');
}

function trackingOptions(selected) {
  return [
    ["confirmed", "Request confirmed"],
    ["preparing", "Preparing book"],
    ["out_for_delivery", "Out for delivery"],
    ["delivered", "Delivered"]
  ].map(([value, label]) => `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`).join("");
}

function renderDelivery(loan) {
  const member = loan.member || {};
  const book = loan.book || {};
  const address = loan.deliveryAddress || {};
  const addressText = [address.line1, address.line2, [address.city, address.region, address.postalCode, address.country].filter(Boolean).join(", ")].filter(Boolean).join(", ");
  const canUpdate = !["declined", "returned"].includes(loan.status);
  return `<article class="admin-delivery-card" data-delivery-card="${escapeHtml(loan._id)}">
    <div class="admin-delivery-main"><div><p class="eyebrow">DELIVERY REQUEST · ${escapeHtml(new Date(loan.createdAt).toLocaleDateString())}</p><h3>${escapeHtml(book.title || "Book")}</h3><p>by ${escapeHtml(book.author || "Unknown author")}</p></div><span class="admin-loan-status status-${escapeHtml(loan.status)}">${escapeHtml(loan.status)}</span></div>
    <div class="admin-delivery-details"><div><span>Member</span><strong>${escapeHtml(member.name || "Unknown")} · ${escapeHtml(member.email || "")}</strong></div><div><span>Recipient</span><strong>${escapeHtml(address.recipient || "")} · ${escapeHtml(address.phone || "")}</strong></div><div><span>Delivery address</span><strong>${escapeHtml(addressText)}</strong></div>${address.instructions ? `<div><span>Instructions</span><strong>${escapeHtml(address.instructions)}</strong></div>` : ""}</div>
    ${loan.status === "requested" ? `<div class="admin-delivery-actions"><button type="button" data-delivery-status="approved" data-loan-id="${escapeHtml(loan._id)}">Approve request</button><button type="button" data-delivery-status="declined" data-loan-id="${escapeHtml(loan._id)}">Decline request</button></div>` : ""}
    <div class="admin-delivery-tracking"><div class="delivery-tracker-heading"><strong>Demo delivery tracker</strong><span>NO COURIER CONNECTED</span></div><div class="delivery-tracker-steps">${[
      ["confirmed", "Request confirmed"],
      ["preparing", "Preparing book"],
      ["out_for_delivery", "Out for delivery"],
      ["delivered", "Delivered"]
    ].map(([value, label], index) => {
      const stages = ["confirmed", "preparing", "out_for_delivery", "delivered"];
      const current = Math.max(0, stages.indexOf(loan.trackingStatus || "confirmed"));
      return `<div class="delivery-step${index <= current ? " complete" : ""}${index === current ? " current" : ""}"><span class="delivery-step-mark">${index < current ? "✓" : index + 1}</span><span>${label}</span></div>`;
    }).join("")}</div>${canUpdate ? `<label class="admin-tracking-select">Update tracker<select data-tracking-id="${escapeHtml(loan._id)}">${trackingOptions(loan.trackingStatus || "confirmed")}</select></label>` : ""}</div>
  </article>`;
}

async function loadDeliveries() {
  const list = $("#admin-delivery-list");
  list.innerHTML = '<p class="admin-empty">Loading delivery requests...</p>';
  try {
    const { deliveries } = await api("/api/admin/deliveries");
    list.innerHTML = deliveries.length
      ? deliveries.map(renderDelivery).join("")
      : '<p class="admin-empty">No home delivery requests yet.</p>';
  } catch (error) {
    list.innerHTML = `<p class="admin-empty error">${escapeHtml(error.message)}</p>`;
  }
}

function renderIssue(issue) {
  return `<article class="admin-issue-card">
    <div class="admin-issue-heading"><div><p class="eyebrow">${escapeHtml(issue.category)} · ${escapeHtml(new Date(issue.createdAt).toLocaleDateString())}</p><h3>${escapeHtml(issue.title)}</h3></div><span class="issue-status issue-status-${escapeHtml(issue.status)}">${issueStatusLabel(issue.status)}</span></div>
    <p class="admin-issue-description">${escapeHtml(issue.description)}</p>
    <label class="admin-issue-status">Public status
      <select data-issue-status="${escapeHtml(issue._id)}">
        ${[["submitted", "Submitted"], ["reviewing", "Under review"], ["resolved", "Resolved"]].map(([value, label]) => `<option value="${value}"${issue.status === value ? " selected" : ""}>${label}</option>`).join("")}
      </select>
    </label>
  </article>`;
}

async function loadIssues() {
  const list = $("#admin-issue-list");
  list.innerHTML = '<p class="admin-empty">Loading issue reports...</p>';
  try {
    const { issues } = await api("/api/admin/issues");
    list.innerHTML = issues.length
      ? issues.map(renderIssue).join("")
      : '<p class="admin-empty">No public issue reports have been submitted.</p>';
  } catch (error) {
    list.innerHTML = `<p class="admin-empty error">${escapeHtml(error.message)}</p>`;
  }
}

$("#admin-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage("#admin-login-message", "");
  try {
    const credentials = Object.fromEntries(new FormData(form).entries());
    const { user } = await api("/api/auth/login", { method: "POST", body: JSON.stringify(credentials) });
    if (user.role !== "admin") {
      await api("/api/auth/logout", { method: "POST" });
      setMessage("#admin-login-message", "This account does not have administrator access.", true);
      return;
    }
    renderAdmin(user);
  } catch (error) {
    setMessage("#admin-login-message", error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("#library-settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  data.deliveryEnabled = form.elements.deliveryEnabled.checked;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage("#settings-message", "");
  try {
    const { settings } = await api("/api/admin/library-settings", { method: "PUT", body: JSON.stringify(data) });
    form.elements.deliveryEnabled.checked = settings.deliveryEnabled;
    setMessage("#settings-message", "Library location and delivery settings saved.");
  } catch (error) {
    setMessage("#settings-message", error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("#admin-add-book-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage("#add-book-message", "");
  try {
    await api("/api/admin/books", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    form.reset();
    setMessage("#add-book-message", "Book added to the public collection.");
    await Promise.all([loadBooks(), loadOverview()]);
  } catch (error) {
    setMessage("#add-book-message", error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("#admin-book-list").addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-book-form]");
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector("button[type=submit]");
  const message = form.querySelector(".admin-message");
  button.disabled = true;
  message.textContent = "";
  try {
    await api(`/api/admin/books/${encodeURIComponent(form.dataset.bookForm)}`, {
      method: "PUT",
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
    });
    message.textContent = "Saved.";
    message.classList.remove("error");
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  } finally {
    button.disabled = false;
  }
});

$("#admin-book-search").addEventListener("input", (event) => {
  window.clearTimeout(adminState.searchTimer);
  adminState.searchTimer = window.setTimeout(() => {
    adminState.bookSearch = event.target.value.trim();
    adminState.bookPage = 1;
    loadBooks();
  }, 250);
});

$("#admin-book-pagination").addEventListener("click", (event) => {
  const button = event.target.closest("[data-book-page]");
  if (!button) return;
  adminState.bookPage = Math.max(1, adminState.bookPage + (button.dataset.bookPage === "next" ? 1 : -1));
  loadBooks();
});

$("#admin-delivery-list").addEventListener("change", async (event) => {
  const select = event.target.closest("[data-tracking-id]");
  if (!select) return;
  select.disabled = true;
  try {
    await api(`/api/admin/loans/${encodeURIComponent(select.dataset.trackingId)}/tracking`, {
      method: "PATCH",
      body: JSON.stringify({ trackingStatus: select.value })
    });
    await loadDeliveries();
  } catch (error) {
    window.alert(error.message);
    await loadDeliveries();
  }
});

$("#admin-delivery-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delivery-status]");
  if (!button) return;
  button.disabled = true;
  try {
    await api(`/api/admin/loans/${encodeURIComponent(button.dataset.loanId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: button.dataset.deliveryStatus })
    });
    await Promise.all([loadDeliveries(), loadOverview()]);
  } catch (error) {
    button.disabled = false;
    window.alert(error.message);
  }
});

$("#admin-issue-list").addEventListener("change", async (event) => {
  const select = event.target.closest("[data-issue-status]");
  if (!select) return;
  select.disabled = true;
  try {
    await api(`/api/admin/issues/${encodeURIComponent(select.dataset.issueStatus)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: select.value })
    });
    await loadIssues();
  } catch (error) {
    window.alert(error.message);
    await loadIssues();
  }
});

$("#refresh-deliveries").addEventListener("click", loadDeliveries);
$("#refresh-issues").addEventListener("click", loadIssues);
$("#admin-logout").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
    window.location.reload();
  } catch (error) {
    window.alert(error.message);
  }
});

document.querySelectorAll(".current-year").forEach((element) => {
  element.textContent = new Date().getFullYear();
});

api("/api/auth/me")
  .then(({ user }) => {
    if (user.role === "admin") renderAdmin(user);
    else if (user) {
      $("#admin-login-message").textContent = "Sign in with an administrator account to continue.";
    }
  })
  .catch((error) => {
    if (error.status !== 401) setMessage("#admin-login-message", error.message, true);
  });
