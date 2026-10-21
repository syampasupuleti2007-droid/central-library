const state = { user: null, page: 1, search: "", category: "All", language: "All", authMode: "login", debounce: null, selectedBook: null };
const $ = (selector) => document.querySelector(selector);
const bookGrid = $("#book-grid");
const pagination = $("#catalog-pagination");

async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
  } catch {
    throw new Error("Account service is not connected. Start the app with `npm run dev` and open http://localhost:3000 (not the HTML file).");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function notify(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 3000);
}

function issueStatusLabel(status) {
  return ({ submitted: "Submitted", reviewing: "Under review", resolved: "Resolved" })[status] || "Submitted";
}

function renderPublicIssue(issue) {
  return `<article class="public-issue-card">
    <div class="public-issue-meta"><span>${escapeHtml(issue.category)}</span><span class="issue-status issue-status-${escapeHtml(issue.status)}">${issueStatusLabel(issue.status)}</span></div>
    <h3>${escapeHtml(issue.title)}</h3>
    <p class="public-issue-date">Reported ${escapeHtml(new Date(issue.createdAt).toLocaleDateString())}</p>
    <p class="public-issue-description">${escapeHtml(issue.description)}</p>
  </article>`;
}

async function loadPublicIssues() {
  const list = $("#public-issue-list");
  if (!state.user) return;
  try {
    const { issues } = await api("/api/issues");
    list.innerHTML = issues.length
      ? issues.map(renderPublicIssue).join("")
      : '<p class="empty-state">No reports yet. Submit a report to follow its progress.</p>';
  } catch (error) {
    list.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

async function loadBooks() {
  bookGrid.innerHTML = '<div class="empty-state">Finding something wonderful...</div>';
  try {
    const params = new URLSearchParams({ page: state.page, limit: "12" });
    if (state.search) params.set("search", state.search);
    if (state.category !== "All") params.set("category", state.category);
    if (state.language !== "All") params.set("language", state.language);
    const data = await api(`/api/books?${params}`);
    $("#catalog-count").textContent = data.total ? `${data.total.toLocaleString()} books to discover` : "No books found";
    if (!data.books.length) {
      bookGrid.innerHTML = '<div class="empty-state">No books match that search. Try another title or author.</div>';
      pagination.replaceChildren();
      return;
    }
    bookGrid.innerHTML = data.books.map((book) => {
      const title = escapeHtml(book.title);
      const coverUrl = book.coverUrl || (book.coverId ? `https://covers.openlibrary.org/b/id/${Number(book.coverId)}-M.jpg` : "");
      const cover = coverUrl
        ? `<img class="book-cover" loading="lazy" src="${escapeHtml(coverUrl)}" alt="Cover of ${title}" onerror="this.remove()">`
        : `<div class="book-cover-placeholder">${title}</div>`;
      const isAdmin = state.user?.role === "admin";
      const availableCopies = Number(book.availableCopies ?? book.totalCopies ?? 1);
      return `<article class="book-card">
        <div class="book-cover-wrap">${cover}</div>
        <div class="book-info"><h3>${title}</h3>
        <p>by ${escapeHtml(book.author || "Unknown author")}</p>
        <span class="book-category">${escapeHtml(book.category || "Other")}</span>
        <span class="book-language">${escapeHtml(book.language || "English")}</span>
        ${book.year ? `<span class="book-year">${escapeHtml(book.year)}</span>` : ""}
        <span class="book-copies">Copies in collection: ${escapeHtml(book.totalCopies ?? 1)} · Available: ${escapeHtml(availableCopies)}</span>
        ${availableCopies === 0 ? '<span class="book-unavailable" role="status">This book is not available right now</span>' : ""}
        ${state.user && availableCopies > 0 ? `<button class="book-request" data-request-book="${escapeHtml(book._id)}">Request this book →</button>` : ""}
        ${isAdmin ? `<button class="book-delete" type="button" data-delete-book="${escapeHtml(book._id)}">Remove book</button>` : ""}
        </div>
      </article>`;
    }).join("");
    renderPagination(data.page, data.pages);
  } catch (error) {
    bookGrid.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}<br>Make sure the server and database are running.</div>`;
    pagination.replaceChildren();
  }
}

function renderPagination(current, pages) {
  if (pages <= 1) {
    pagination.replaceChildren();
    return;
  }
  const visible = [];
  for (let page = Math.max(1, current - 2); page <= Math.min(pages, current + 2); page += 1) visible.push(page);
  pagination.innerHTML = visible.map((page) => `<button class="page-button${page === current ? " active" : ""}" data-page="${page}" aria-label="Page ${page}">${page}</button>`).join("");
  if (current < pages) pagination.insertAdjacentHTML("beforeend", '<button class="page-button" data-page="next" aria-label="Next page">→</button>');
}

function showAuth(mode = "login") {
  setAuthMode(mode);
  $("#auth-message").textContent = "";
  $("#auth-dialog").showModal();
}

function setAuthMode(mode) {
  state.authMode = mode;
  document.querySelectorAll(".auth-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  $(".name-field").classList.toggle("hidden", mode !== "register");
  $("#password-hint").classList.toggle("hidden", mode !== "register");
  $("#auth-title").innerHTML = mode === "login" ? "Welcome <em>in.</em>" : "Your story <em>starts here.</em>";
  $(".auth-submit").innerHTML = mode === "login" ? 'Log in <span aria-hidden="true">→</span>' : 'Create your account <span aria-hidden="true">→</span>';
  $("#auth-form [name=password]").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("#auth-form [name=name]").required = mode === "register";
}

async function refreshUser() {
  try {
    const data = await api("/api/auth/me");
    state.user = data.user;
  } catch (error) {
    state.user = null;
    if (window.location.protocol !== "file:" && !error.message.includes("401")) {
      console.error("Unable to check the current library session:", error);
    }
  }
  renderUser();
}

async function loadLibrarySettings() {
  try {
    const { settings } = await api("/api/library-settings");
    $("#library-visit-name").textContent = settings.name;
    $("#library-visit-address").innerHTML = [settings.addressLine1, settings.addressLine2, [settings.city, settings.region, settings.postalCode, settings.country].filter(Boolean).join(", ")]
      .filter(Boolean)
      .map(escapeHtml)
      .join("<br>");
    $("#library-weekday-hours").textContent = settings.weekdayHours;
    $("#library-saturday-hours").textContent = settings.saturdayHours;
    $("#library-sunday-hours").textContent = settings.sundayHours;
    $("#library-contact-email").textContent = `${settings.email} ↗`;
    $("#library-contact-email").href = `mailto:${settings.email}`;
    const addressQuery = [settings.name, settings.addressLine1, settings.addressLine2, settings.city, settings.region, settings.postalCode, settings.country]
      .filter(Boolean)
      .join(", ");
    $("#library-directions").href = `https://maps.google.com/?q=${encodeURIComponent(addressQuery)}`;
  } catch (error) {
    console.error("Unable to load library location settings:", error);
  }
}

function renderUser() {
  $("#login-open").classList.toggle("hidden", Boolean(state.user));
  $("#join-open").classList.toggle("hidden", Boolean(state.user));
  $("#community-issues-nav").classList.add("hidden");
  $("#community-issues").classList.add("hidden");
  $("#profile-nav").classList.toggle("hidden", !state.user);
  $("#admin-nav").classList.toggle("hidden", state.user?.role !== "admin");
  const account = $("#account-button");
  account.classList.toggle("hidden", !state.user);
  $("#dashboard").classList.add("hidden");
  $("#member-dashboard").classList.add("hidden");
  $("#admin-dashboard").classList.add("hidden");
  if (state.user) {
    account.textContent = "My profile";
  } else {
    $("#public-issue-list").replaceChildren();
  }
  if (state.user) loadPublicIssues();
  loadBooks();
}

function renderLoan(loan, admin = false) {
  const book = loan.book || {};
  const member = loan.member || {};
  const status = escapeHtml(loan.status || "requested");
  const isDelivery = loan.fulfillmentMethod === "delivery";
  const address = loan.deliveryAddress || {};
  const tracking = isDelivery ? renderTracking(loan.trackingStatus) : "";
  return `<div class="loan-row">
    <div><h4>${escapeHtml(book.title || "Book")}</h4>
      <p>${admin ? `${escapeHtml(member.name || "Member")} · ${escapeHtml(member.email || "")} · ` : ""}${escapeHtml(book.author || "")} · ${escapeHtml(book.category || "Other")}</p>
      <p>${isDelivery ? "Home delivery" : "Library pickup"}${admin && isDelivery ? ` · ${escapeHtml(address.recipient || "")} · ${escapeHtml(address.line1 || "")}, ${escapeHtml(address.city || "")}, ${escapeHtml(address.region || "")} ${escapeHtml(address.postalCode || "")} · ${escapeHtml(address.phone || "")}` : ""}</p>
      ${loan.dueAt ? `<p>Due ${new Date(loan.dueAt).toLocaleDateString()}</p>` : ""}
    </div>
    <span class="loan-status">${status}</span>
    ${admin && loan.status === "requested" ? `<div class="loan-actions"><button data-loan-status="approved" data-loan-id="${escapeHtml(loan._id)}">Approve</button><button data-loan-status="declined" data-loan-id="${escapeHtml(loan._id)}">Decline</button></div>` : ""}
    ${admin && loan.status === "return_requested" ? `<div class="loan-actions"><button data-loan-status="returned" data-loan-id="${escapeHtml(loan._id)}">Confirm book received</button></div>` : ""}
    ${!admin && isDelivery ? tracking : ""}
    ${admin && isDelivery && !["declined", "return_requested", "returned"].includes(loan.status) ? `<label class="tracking-admin-control">Update demo tracker<select data-tracking-id="${escapeHtml(loan._id)}"><option value="confirmed"${loan.trackingStatus === "confirmed" ? " selected" : ""}>Request confirmed</option><option value="preparing"${loan.trackingStatus === "preparing" ? " selected" : ""}>Preparing book</option><option value="out_for_delivery"${loan.trackingStatus === "out_for_delivery" ? " selected" : ""}>Out for delivery</option><option value="delivered"${loan.trackingStatus === "delivered" ? " selected" : ""}>Delivered</option></select></label>` : ""}
  </div>`;
}

function renderTracking(status = "confirmed") {
  const stages = [
    ["confirmed", "Request confirmed"],
    ["preparing", "Preparing book"],
    ["out_for_delivery", "Out for delivery"],
    ["delivered", "Delivered"]
  ];
  const currentIndex = Math.max(0, stages.findIndex(([value]) => value === status));
  return `<div class="delivery-tracker" aria-label="Demo delivery tracking">
    <div class="delivery-tracker-heading"><strong>Delivery tracker</strong><span>DEMO</span></div>
    <div class="delivery-tracker-steps">${stages.map(([value, label], index) => `
      <div class="delivery-step${index <= currentIndex ? " complete" : ""}${index === currentIndex ? " current" : ""}">
        <span class="delivery-step-mark">${index < currentIndex ? "✓" : index + 1}</span><span>${label}</span>
      </div>`).join("")}</div>
    <p>Demo status only — no courier is connected.</p>
  </div>`;
}

async function loadMemberLoans() {
  try {
    const { loans } = await api("/api/loans/mine");
    $("#member-loans").innerHTML = loans.length ? loans.map((loan) => renderLoan(loan)).join("") : '<div class="empty-state">You have no book requests yet. Explore the collection to find a read.</div>';
  } catch (error) {
    $("#member-loans").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function loadAdminOverview() {
  try {
    const { stats, loans } = await api("/api/admin/overview");
    $("#admin-stats").innerHTML = [
      ["Books in collection", stats.books],
      ["Library members", stats.members],
      ["Active requests", stats.activeLoans]
    ].map(([label, value]) => `<div class="stat-card"><strong>${Number(value).toLocaleString()}</strong><span>${label}</span></div>`).join("");
    $("#admin-loans").innerHTML = loans.length ? loans.map((loan) => renderLoan(loan, true)).join("") : '<div class="empty-state">No active requests right now.</div>';
  } catch (error) {
    $("#admin-loans").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function loadAdminMembers() {
  const container = $("#admin-members-list");
  container.innerHTML = '<div class="empty-state">Loading member accounts...</div>';
  try {
    const page = state.adminMembersPage || 1;
    const data = await api(`/api/admin/members?page=${page}&limit=20`);
    container.innerHTML = data.members.length ? data.members.map((member) => `
      <article class="member-card">
        <h4>${escapeHtml(member.name)}</h4>
        <p>${escapeHtml(member.email)} · Joined ${new Date(member.createdAt).toLocaleDateString()}</p>
        ${member.loans.length
          ? member.loans.map((loan) => renderLoan(loan)).join("")
          : '<p class="member-empty">No book requests or borrowing history yet.</p>'}
      </article>`).join("") : '<div class="empty-state">No member accounts have been created yet.</div>';
    const controls = $("#admin-members-pagination");
    controls.innerHTML = "";
    if (data.page > 1) controls.insertAdjacentHTML("beforeend", '<button class="page-button" data-members-page="previous">←</button>');
    if (data.page < data.pages) controls.insertAdjacentHTML("beforeend", '<button class="page-button" data-members-page="next">→</button>');
  } catch (error) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

$("#book-search").addEventListener("input", (event) => {
  window.clearTimeout(state.debounce);
  state.debounce = window.setTimeout(() => {
    state.search = event.target.value.trim();
    state.page = 1;
    loadBooks();
  }, 250);
});

$("#book-category").addEventListener("change", (event) => {
  state.category = event.target.value;
  state.page = 1;
  loadBooks();
});

$("#book-language").addEventListener("change", (event) => {
  state.language = event.target.value;
  state.page = 1;
  loadBooks();
});

async function loadBookLanguages() {
  const select = $("#book-language");
  try {
    const { languages } = await api("/api/books/languages");
    const selectedLanguage = state.language;
    select.innerHTML = '<option value="All">All languages</option>' + languages
      .map((language) => `<option value="${escapeHtml(language)}">${escapeHtml(language)}</option>`)
      .join("");
    if (languages.includes(selectedLanguage)) select.value = selectedLanguage;
    else state.language = "All";
  } catch (error) {
    console.error("Unable to load book languages:", error);
    notify(`Book language filters could not be loaded: ${error.message}`);
  }
}

pagination.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button) return;
  const target = button.dataset.page === "next" ? state.page + 1 : Number(button.dataset.page);
  if (!Number.isInteger(target) || target < 1) return;
  state.page = target;
  loadBooks();
  $("#catalog").scrollIntoView({ behavior: "smooth" });
});

bookGrid.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-book]");
  if (deleteButton) {
    const title = deleteButton.closest(".book-card")?.querySelector("h3")?.textContent || "this book";
    if (!window.confirm(`Remove "${title}" from the library catalog?`)) return;
    try {
      await api(`/api/admin/books/${encodeURIComponent(deleteButton.dataset.deleteBook)}`, { method: "DELETE" });
      notify("Book removed from the collection.");
      loadBooks();
      if (state.user?.role === "admin") {
        loadAdminOverview();
      }
    } catch (error) {
      notify(error.message);
    }
    return;
  }

  const button = event.target.closest("[data-request-book]");
  if (!button) return;
  window.location.assign(`/fulfillment.html?bookId=${encodeURIComponent(button.dataset.requestBook)}`);
});

$("#login-open").addEventListener("click", () => showAuth("login"));
$("#join-open").addEventListener("click", () => showAuth("register"));
$("#account-button").addEventListener("click", () => window.location.assign("/profile.html"));
$("#dialog-close").addEventListener("click", () => $("#auth-dialog").close());
$("#auth-dialog").addEventListener("click", (event) => {
  if (event.target === $("#auth-dialog")) $("#auth-dialog").close();
});
document.querySelectorAll(".auth-tab").forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.mode)));

$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  const endpoint = state.authMode === "login" ? "/api/auth/login" : "/api/auth/register";
  const submit = $(".auth-submit");
  submit.disabled = true;
  $("#auth-message").textContent = "";
  if (window.location.protocol === "file:") {
    $("#auth-message").textContent = "Please start the app with `npm run dev` and open http://localhost:3000 to create an account or log in.";
    submit.disabled = false;
    return;
  }
  try {
    const data = await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
    state.user = data.user;
    $("#auth-dialog").close();
    event.currentTarget.reset();
    if (state.user.role === "admin") {
      window.location.assign("/admin.html");
      return;
    }
    const returnPath = new URLSearchParams(window.location.search).get("return");
    if (returnPath && returnPath.startsWith("/") && !returnPath.startsWith("//")) {
      window.location.assign(returnPath);
      return;
    }
    renderUser();
    notify(`Welcome ${state.user.name.split(" ")[0]}!`);
  } catch (error) {
    $("#auth-message").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

$("#logout-button").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
    state.user = null;
    renderUser();
    notify("You have been signed out.");
  } catch (error) {
    notify(error.message);
  }
});

$("#issue-report-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const message = $("#issue-report-message");
  button.disabled = true;
  message.textContent = "";
  try {
    const { notification } = await api("/api/issues", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
    });
    form.reset();
    message.textContent = `Your report was submitted. ${notification.message}`;
    await loadPublicIssues();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#admin-loans").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-loan-status]");
  if (!button) return;
  try {
    await api(`/api/admin/loans/${encodeURIComponent(button.dataset.loanId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: button.dataset.loanStatus })
    });
    notify("Request updated.");
    loadAdminOverview();
  } catch (error) {
    notify(error.message);
  }
});

$("#admin-loans").addEventListener("change", async (event) => {
  const select = event.target.closest("[data-tracking-id]");
  if (!select) return;
  select.disabled = true;
  try {
    await api(`/api/admin/loans/${encodeURIComponent(select.dataset.trackingId)}/tracking`, {
      method: "PATCH",
      body: JSON.stringify({ trackingStatus: select.value })
    });
    notify("Demo delivery tracker updated.");
    loadAdminOverview();
    loadAdminMembers();
  } catch (error) {
    notify(error.message);
    loadAdminOverview();
  }
});

$("#admin-members-pagination").addEventListener("click", (event) => {
  const button = event.target.closest("[data-members-page]");
  if (!button) return;
  state.adminMembersPage = Math.max(1, (state.adminMembersPage || 1) + (button.dataset.membersPage === "next" ? 1 : -1));
  loadAdminMembers();
});

$("#add-book-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  const message = $("#admin-message");
  message.textContent = "";
  try {
    await api("/api/admin/books", { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    message.textContent = "Book added to the collection.";
    loadAdminOverview();
    loadBooks();
  } catch (error) {
    message.textContent = error.message;
  }
});

$("#menu-toggle").addEventListener("click", () => {
  const nav = $("#main-nav");
  const open = nav.classList.toggle("open");
  $("#menu-toggle").setAttribute("aria-expanded", String(open));
});
$("#main-nav").addEventListener("click", (event) => {
  if (event.target.closest("a")) {
    $("#main-nav").classList.remove("open");
    $("#menu-toggle").setAttribute("aria-expanded", "false");
  }
});

$("#year").textContent = new Date().getFullYear();
loadBooks();
loadBookLanguages();
refreshUser();
loadLibrarySettings();
if (new URLSearchParams(window.location.search).get("login") === "1") showAuth("login");
