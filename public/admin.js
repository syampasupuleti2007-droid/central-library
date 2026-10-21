const $ = (selector) => document.querySelector(selector);
const bookCategories = [
  "Adventure", "Biography", "Children", "Classics", "Fantasy", "History",
  "Horror", "Mystery", "Nonfiction", "Philosophy", "Romance", "Science Fiction", "Other"
];
const adminState = {
  user: null,
  activeTab: "overview",
  search: { books: "", members: "", pickups: "", deliveries: "", issues: "", suggestions: "", tableBookings: "" },
  bookCategory: "All",
  bookLanguage: "All",
  memberPage: 1,
  memberSearchTimer: null
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

function setActiveAdminTab(panelName) {
  adminState.activeTab = panelName;
  document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.adminPanel !== panelName);
  });
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminTab === panelName);
  });
}

function filterMatches(term, values) {
  const query = String(term || "").trim().toLowerCase();
  if (!query) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(query));
}

function categoryOptions(selected) {
  return bookCategories.map((category) => `<option value="${escapeHtml(category)}"${category === selected ? " selected" : ""}>${escapeHtml(category)}</option>`).join("");
}

function renderAdmin(user) {
  adminState.user = user;
  $("#admin-login-card").classList.add("hidden");
  $("#admin-dashboard").classList.remove("hidden");
  $("#admin-name").textContent = user.name.split(" ")[0] + ".";
  $("#admin-email").textContent = user.email;
  setActiveAdminTab(adminState.activeTab);
  loadOverview();
  loadSettings();
  loadBooksForAdmin();
  loadAdminBookLanguages();
  loadMembers();
  loadPickups();
  loadDeliveries();
  loadTableBookings();
  loadBookSuggestions();
  loadIssues();
}

async function loadBooksForAdmin(searchText = adminState.search.books) {
  const list = $("#admin-book-manager");
  list.innerHTML = '<p class="admin-empty">Loading catalog books...</p>';
  try {
    const searchParam = searchText.trim();
    const query = new URLSearchParams({ page: "1", limit: "10" });
    if (searchParam) query.set("search", searchParam);
    if (adminState.bookCategory !== "All") query.set("category", adminState.bookCategory);
    if (adminState.bookLanguage !== "All") query.set("language", adminState.bookLanguage);
    const { books } = await api(`/api/admin/books?${query.toString()}`);
    list.innerHTML = books.length
      ? books.map((book) => `
        <article class="admin-issue-card">
          <div class="admin-issue-heading">
            <div>
              <p class="eyebrow">BOOK · ${escapeHtml(book.year || "n/a")}</p>
              <h3>${escapeHtml(book.title || "Untitled book")}</h3>
            </div>
            <div class="admin-book-actions">
              <button class="button button-small" type="button" data-admin-edit-book="${escapeHtml(book._id)}">Edit</button>
              <button class="button button-small" type="button" data-admin-delete-book="${escapeHtml(book._id)}">Remove</button>
            </div>
          </div>
          <p class="admin-issue-reporter">by ${escapeHtml(book.author || "Unknown author")} · ${escapeHtml(book.category || "Other")} · ${escapeHtml(book.language || "English")} · ${escapeHtml(book.totalCopies ?? 1)} total · ${Math.max(0, Number(book.totalCopies ?? 1) - Number(book.copiesInUse ?? 0))} available · ${escapeHtml(book.copiesInUse ?? 0)} currently booked</p>
          <form class="admin-settings-form admin-book-edit-form hidden" data-admin-book-form="${escapeHtml(book._id)}">
            <label>Title<input name="title" value="${escapeHtml(book.title || "")}" required maxlength="300"></label>
            <label>Author<input name="author" value="${escapeHtml(book.author || "")}" maxlength="200"></label>
            <label>Category<select name="category" required>${categoryOptions(book.category || "Other")}</select></label>
            <label>Language<input name="language" value="${escapeHtml(book.language || "English")}" required maxlength="100" placeholder="English"></label>
            <label>Publication year<input name="year" type="number" min="1" max="2100" value="${escapeHtml(book.year || "")}"></label>
            <label>Copies in collection<input name="totalCopies" type="number" min="0" max="1000000" step="1" value="${escapeHtml(book.totalCopies ?? 1)}" required></label>
            <label>Cover image URL<input name="coverUrl" type="url" maxlength="2048" value="${escapeHtml(book.coverUrl || "")}" placeholder="https://example.com/cover.jpg"></label>
            <div class="admin-form-actions">
              <button class="button button-small" type="submit">Save</button>
              <button class="button button-small" type="button" data-admin-cancel-edit="${escapeHtml(book._id)}">Cancel</button>
            </div>
          </form>
        </article>
      `).join("")
      : '<p class="admin-empty">No books have been added to the collection yet.</p>';
  } catch (error) {
    list.innerHTML = `<p class="admin-empty error">${escapeHtml(error.message)}</p>`;
  }
}

async function loadAdminBookLanguages() {
  const select = document.querySelector("[data-admin-language-filter]");
  try {
    const { languages } = await api("/api/books/languages");
    select.innerHTML = '<option value="All">All languages</option>' + languages
      .map((language) => `<option value="${escapeHtml(language)}">${escapeHtml(language)}</option>`)
      .join("");
    if (languages.includes(adminState.bookLanguage)) select.value = adminState.bookLanguage;
    else adminState.bookLanguage = "All";
  } catch (error) {
    select.innerHTML = '<option value="All">All languages</option>';
    setMessage("#book-message", `Book language filters could not be loaded: ${error.message}`, true);
  }
}

async function loadOverview() {
  try {
    const { stats } = await api("/api/admin/overview");
    $("#admin-stats").innerHTML = [
      ["Books in collection", stats.books],
      ["Library members", stats.members],
      ["Active requests", stats.activeLoans]
    ].map(([label, value]) => `<article class="admin-stat"><strong>${Number(value).toLocaleString()}</strong><span>${label}</span></article>`).join("");
    renderOverviewCharts(stats);
  } catch (error) {
    $("#admin-stats").innerHTML = `<p class="admin-empty">${escapeHtml(error.message)}</p>`;
    $("#admin-overview-charts").replaceChildren();
  }
}

function renderOverviewCharts(stats) {
  const inventory = stats.inventory || {};
  const totalCopies = Math.max(0, Number(inventory.totalCopies) || 0);
  const availableCopies = Math.max(0, Number(inventory.availableCopies) || 0);
  const copiesInUse = Math.max(0, Number(inventory.copiesInUse) || 0);
  const availableWidth = totalCopies ? Math.min(100, (availableCopies / totalCopies) * 100) : 0;
  const inUseWidth = totalCopies ? Math.min(100 - availableWidth, (copiesInUse / totalCopies) * 100) : 0;
  const statuses = stats.loanStatusCounts || {};
  const loanBars = [
    ["Awaiting approval", Number(statuses.requested) || 0, "requested"],
    ["Borrowed", Number(statuses.approved) || 0, "approved"],
    ["Return awaiting receipt", Number(statuses.return_requested) || 0, "return-requested"],
    ["Returned", Number(statuses.returned) || 0, "returned"],
    ["Declined", Number(statuses.declined) || 0, "declined"]
  ];
  const maxLoans = Math.max(1, ...loanBars.map(([, value]) => value));
  $("#admin-overview-charts").innerHTML = `
    <article class="admin-chart-card">
      <div class="admin-chart-heading"><div><p class="eyebrow">COLLECTION</p><h2>Copy availability</h2></div><strong>${totalCopies.toLocaleString()} total copies</strong></div>
      ${totalCopies
        ? `<div class="admin-inventory-bar" role="img" aria-label="${availableCopies} available copies and ${copiesInUse} copies currently booked"><span class="admin-inventory-available" style="width:${availableWidth}%"></span><span class="admin-inventory-in-use" style="width:${inUseWidth}%"></span></div>
          <div class="admin-chart-legend"><span><i class="legend-available"></i>${availableCopies.toLocaleString()} available</span><span><i class="legend-in-use"></i>${copiesInUse.toLocaleString()} booked</span></div>`
        : '<p class="admin-chart-empty">No book copies have been added yet.</p>'}
    </article>
    <article class="admin-chart-card">
      <div class="admin-chart-heading"><div><p class="eyebrow">LOAN ACTIVITY</p><h2>Request status</h2></div><strong>${loanBars.reduce((total, [, count]) => total + count, 0).toLocaleString()} total</strong></div>
      <div class="admin-loan-chart">${loanBars.map(([label, value, status]) => `
        <div class="admin-loan-chart-row">
          <span>${label}</span>
          <div class="admin-loan-chart-track" role="img" aria-label="${label}: ${value}"><i class="chart-${status}" style="width:${Math.max(value ? 2 : 0, (value / maxLoans) * 100)}%"></i></div>
          <strong>${value.toLocaleString()}</strong>
        </div>`).join("")}</div>
    </article>`;
}

function renderMember(member) {
  const loans = member.loans || [];
  const loanHistory = loans.length
    ? `<div class="admin-member-loans">${loans.map((loan) => `
      <div class="admin-member-loan">
        <strong>${escapeHtml(loan.book?.title || "Book details unavailable")}</strong>
        <span>${escapeHtml(loan.book?.category || "Other")} · ${escapeHtml(loan.status)} · ${loan.fulfillmentMethod === "delivery" ? "Home delivery" : "Library pickup"} · Requested ${escapeHtml(new Date(loan.createdAt).toLocaleDateString())}</span>
        ${loan.dueAt ? `<small>Due ${escapeHtml(new Date(loan.dueAt).toLocaleDateString())}</small>` : ""}
      </div>`).join("")}</div>`
    : '<p class="admin-empty admin-member-no-loans">No book requests or borrowing history yet.</p>';
  return `<article class="admin-member-card">
    <div class="admin-member-heading">
      <div><p class="eyebrow">MEMBER · JOINED ${escapeHtml(new Date(member.createdAt).toLocaleDateString())}</p><h3>${escapeHtml(member.name || "Unnamed member")}</h3></div>
      <span class="admin-member-library-id">${escapeHtml(member.libraryId || "ID not assigned")}</span>
    </div>
    <div class="admin-member-details">
      <div><span>Email</span><strong>${escapeHtml(member.email || "Not provided")}</strong></div>
      <div><span>Last login</span><strong>${escapeHtml(member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString() : "No login recorded")}</strong></div>
    </div>
    <details class="admin-member-message">
      <summary>Send message to member</summary>
      <form class="admin-member-message-form" data-member-message-form="${escapeHtml(member._id)}">
        <label>Subject<input name="title" required minlength="2" maxlength="120" placeholder="Message subject"></label>
        <label>Message<textarea name="message" required minlength="2" maxlength="1000" rows="3" placeholder="Write a message for this member"></textarea></label>
        <p class="admin-message" data-member-message-status role="status"></p>
        <button class="button button-small" type="submit">Send to notifications →</button>
      </form>
    </details>
    <h4>Book request history (${loans.length})</h4>
    ${loanHistory}
  </article>`;
}

async function loadMembers() {
  const list = $("#admin-member-list");
  const pagination = $("#admin-member-pagination");
  list.innerHTML = '<p class="admin-empty">Loading members...</p>';
  pagination.replaceChildren();
  try {
    const params = new URLSearchParams({
      page: String(adminState.memberPage),
      limit: "20"
    });
    if (adminState.search.members.trim()) params.set("search", adminState.search.members.trim());
    const data = await api(`/api/admin/members?${params.toString()}`);
    list.innerHTML = data.members.length
      ? data.members.map(renderMember).join("")
      : '<p class="admin-empty">No members match your search.</p>';
    if (data.page > 1) {
      pagination.insertAdjacentHTML("beforeend", '<button class="admin-page-button" type="button" data-member-page="previous">Previous</button>');
    }
    if (data.page < data.pages) {
      pagination.insertAdjacentHTML("beforeend", '<button class="admin-page-button" type="button" data-member-page="next">Next</button>');
    }
  } catch (error) {
    list.innerHTML = `<p class="admin-empty error">${escapeHtml(error.message)}</p>`;
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
  const canUpdate = !["declined", "return_requested", "returned"].includes(loan.status);
  return `<article class="admin-delivery-card" data-delivery-card="${escapeHtml(loan._id)}">
    <div class="admin-delivery-main"><div><p class="eyebrow">DELIVERY REQUEST · ${escapeHtml(new Date(loan.createdAt).toLocaleDateString())}</p><h3>${escapeHtml(book.title || "Book")}</h3><p>by ${escapeHtml(book.author || "Unknown author")} · ${escapeHtml(book.category || "Other")}</p></div><span class="admin-loan-status status-${escapeHtml(loan.status)}">${escapeHtml(loan.status)}</span></div>
    <div class="admin-delivery-details"><div><span>Member</span><strong>${escapeHtml(member.name || "Unknown")} · ${escapeHtml(member.email || "")}</strong></div><div><span>Recipient</span><strong>${escapeHtml(address.recipient || "")} · ${escapeHtml(address.phone || "")}</strong></div><div><span>Delivery address</span><strong>${escapeHtml(addressText)}</strong></div><div><span>Delivery fee</span><strong>${loan.deliveryFeeRupees === undefined ? "Not recorded" : `₹${Number(loan.deliveryFeeRupees).toLocaleString("en-IN")} · demo only, not charged`}</strong></div><div><span>Payment status</span><strong>${loan.paymentStatus === "demo_only" ? "Demo simulation only (no money charged)" : loan.paymentStatus === "not_required" ? "Not required" : "Not recorded"}</strong></div>${address.instructions ? `<div><span>Instructions</span><strong>${escapeHtml(address.instructions)}</strong></div>` : ""}</div>
    ${loan.status === "requested" ? `<div class="admin-delivery-actions"><button type="button" data-delivery-status="approved" data-loan-id="${escapeHtml(loan._id)}">Approve request</button><button type="button" data-delivery-status="declined" data-loan-id="${escapeHtml(loan._id)}">Decline request</button></div>` : ""}
    ${loan.status === "return_requested" ? `<div class="admin-delivery-details admin-return-request"><div><span>Return request received</span><strong>${escapeHtml(loan.returnRequestedAt ? new Date(loan.returnRequestedAt).toLocaleString() : "Date not recorded")}</strong></div><p>The member has requested to return this book. Confirm receipt to make the copy available again.</p><div class="admin-delivery-actions"><button type="button" data-delivery-status="returned" data-loan-id="${escapeHtml(loan._id)}">Confirm book received</button></div></div>` : ""}
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

function renderPickup(loan) {
  const member = loan.member || {};
  const book = loan.book || {};
  const pickupLabel = loan.status === "requested" ? "Awaiting admin review"
    : loan.status === "approved" ? "Ready for pickup"
      : loan.status === "return_requested" ? "Member requested return — awaiting receipt"
        : loan.status === "returned" ? "Returned and received"
          : "Declined";
  return `<article class="admin-delivery-card" data-pickup-card="${escapeHtml(loan._id)}">
    <div class="admin-delivery-main"><div><p class="eyebrow">PICKUP REQUEST · ${escapeHtml(new Date(loan.createdAt).toLocaleDateString())}</p><h3>${escapeHtml(book.title || "Book")}</h3><p>by ${escapeHtml(book.author || "Unknown author")} · ${escapeHtml(book.category || "Other")}</p></div><span class="admin-loan-status status-${escapeHtml(loan.status)}">${escapeHtml(loan.status)}</span></div>
    <div class="admin-delivery-details"><div><span>Member</span><strong>${escapeHtml(member.name || "Unknown")} · ${escapeHtml(member.email || "")}</strong></div><div><span>Pickup status</span><strong>${escapeHtml(pickupLabel)}</strong></div><div><span>Due date</span><strong>${escapeHtml(loan.dueAt ? new Date(loan.dueAt).toLocaleDateString() : "Not set")}</strong></div></div>
    ${loan.status === "requested" ? `<div class="admin-delivery-actions"><button type="button" data-pickup-status="approved" data-loan-id="${escapeHtml(loan._id)}">Approve request</button><button type="button" data-pickup-status="declined" data-loan-id="${escapeHtml(loan._id)}">Decline request</button></div>` : ""}
    ${loan.status === "return_requested" ? `<div class="admin-delivery-details admin-return-request"><div><span>Return request received</span><strong>${escapeHtml(loan.returnRequestedAt ? new Date(loan.returnRequestedAt).toLocaleString() : "Date not recorded")}</strong></div><p>The member has requested to return this book. Confirm receipt to make the copy available again.</p><div class="admin-delivery-actions"><button type="button" data-pickup-status="returned" data-loan-id="${escapeHtml(loan._id)}">Confirm book received</button></div></div>` : ""}
  </article>`;
}

async function loadPickups() {
  const list = $("#admin-pickup-list");
  list.innerHTML = '<p class="admin-empty">Loading pickup requests...</p>';
  try {
    const { pickups } = await api("/api/admin/pickups");
    list.innerHTML = pickups.length
      ? pickups.map(renderPickup).join("")
      : '<p class="admin-empty">No library pickup requests yet.</p>';
  } catch (error) {
    list.innerHTML = `<p class="admin-empty error">${escapeHtml(error.message)}</p>`;
  }
}

async function loadPickups() {
  const list = $("#admin-pickup-list");
  list.innerHTML = '<p class="admin-empty">Loading pickup requests...</p>';
  try {
    const { pickups } = await api("/api/admin/pickups");
    const filtered = pickups.filter((loan) => filterMatches(adminState.search.pickups, [
      loan.member?.name,
      loan.member?.email,
      loan.book?.title,
      loan.book?.author,
      loan.status
    ]));
    list.innerHTML = filtered.length
      ? filtered.map(renderPickup).join("")
      : '<p class="admin-empty">No pickup requests match your search.</p>';
  } catch (error) {
    list.innerHTML = `<p class="admin-empty error">${escapeHtml(error.message)}</p>`;
  }
}

async function loadDeliveries() {
  const list = $("#admin-delivery-list");
  list.innerHTML = '<p class="admin-empty">Loading delivery requests...</p>';
  try {
    const { deliveries } = await api("/api/admin/deliveries");
    const filtered = deliveries.filter((loan) => filterMatches(adminState.search.deliveries, [
      loan.member?.name,
      loan.member?.email,
      loan.book?.title,
      loan.book?.author,
      loan.deliveryAddress?.recipient,
      loan.status
    ]));
    list.innerHTML = filtered.length
      ? filtered.map(renderDelivery).join("")
      : '<p class="admin-empty">No home delivery requests match your search.</p>';
  } catch (error) {
    list.innerHTML = `<p class="admin-empty error">${escapeHtml(error.message)}</p>`;
  }
}

function renderIssue(issue) {
  return `<article class="admin-issue-card">
    <div class="admin-issue-heading"><div><p class="eyebrow">${escapeHtml(issue.category)} · ${escapeHtml(new Date(issue.createdAt).toLocaleDateString())}</p><h3>${escapeHtml(issue.title)}</h3></div><span class="issue-status issue-status-${escapeHtml(issue.status)}">${issueStatusLabel(issue.status)}</span></div>
    <p class="admin-issue-reporter">Reported by ${escapeHtml(issue.reportedBy?.name || "Unknown member")}</p>
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
    const filtered = issues.filter((issue) => filterMatches(adminState.search.issues, [
      issue.title,
      issue.category,
      issue.description,
      issue.reportedBy?.name,
      issue.status
    ]));
    list.innerHTML = filtered.length
      ? filtered.map(renderIssue).join("")
      : '<p class="admin-empty">No public issue reports match your search.</p>';
  } catch (error) {
    list.innerHTML = `<p class="admin-empty error">${escapeHtml(error.message)}</p>`;
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
  return `<article class="admin-issue-card">
    <div class="admin-issue-heading"><div><p class="eyebrow">BOOK SUGGESTION · ${escapeHtml(new Date(suggestion.createdAt).toLocaleDateString())}</p><h3>${escapeHtml(suggestion.title)}</h3></div><span class="issue-status issue-status-${escapeHtml(suggestion.status)}">${escapeHtml(statusLabels[suggestion.status] || suggestion.status)}</span></div>
    <p class="admin-issue-reporter">Suggested by ${escapeHtml(suggestion.suggestedBy?.name || "Unknown member")} · ${escapeHtml(suggestion.suggestedBy?.email || "")}${suggestion.author ? ` · Author: ${escapeHtml(suggestion.author)}` : ""}</p>
    ${suggestion.details ? `<p class="admin-issue-description">${escapeHtml(suggestion.details)}</p>` : ""}
    <label class="admin-issue-status">Review status
      <select data-book-suggestion-status="${escapeHtml(suggestion._id)}">
        ${[["submitted", "Submitted"], ["reviewing", "Under review"], ["approved", "Approved"], ["declined", "Declined"], ["added", "Added to collection"]].map(([value, label]) => `<option value="${value}"${suggestion.status === value ? " selected" : ""}>${label}</option>`).join("")}
      </select>
    </label>
  </article>`;
}

async function loadBookSuggestions() {
  const list = $("#admin-suggestion-list");
  list.innerHTML = '<p class="admin-empty">Loading book suggestions...</p>';
  try {
    const { suggestions } = await api("/api/admin/book-suggestions");
    const filtered = suggestions.filter((suggestion) => filterMatches(adminState.search.suggestions, [
      suggestion.title,
      suggestion.author,
      suggestion.details,
      suggestion.suggestedBy?.name,
      suggestion.suggestedBy?.email,
      suggestion.status
    ]));
    list.innerHTML = filtered.length
      ? filtered.map(renderBookSuggestion).join("")
      : '<p class="admin-empty">No book suggestions match your search.</p>';
  } catch (error) {
    list.innerHTML = `<p class="admin-empty error">${escapeHtml(error.message)}</p>`;
  }
}

function renderTableBooking(booking) {
  const member = booking.member || {};
  const date = new Date(`${booking.date}T12:00:00`);
  const dateLabel = Number.isNaN(date.getTime()) ? booking.date : date.toLocaleDateString(undefined, { dateStyle: "long" });
  return `<article class="admin-issue-card admin-table-booking-card">
    <div>
      <p class="eyebrow">TABLE RESERVATION · ${escapeHtml(dateLabel)}</p>
      <h3>Table address: Floor ${escapeHtml(booking.floor)}, Table ${escapeHtml(booking.tableNumber)}</h3>
      <p class="admin-issue-reporter">${escapeHtml(booking.startTime)}–${escapeHtml(booking.endTime)} · ${escapeHtml(member.name || "Unknown member")} · ${escapeHtml(member.email || "No email")}</p>
      <span class="profile-table-status${booking.status === "cancelled" ? " profile-table-status-cancelled" : ""}">${escapeHtml(booking.status)}</span>
    </div>
    ${booking.status === "confirmed" ? `<button class="button button-small" type="button" data-admin-cancel-table-booking="${escapeHtml(booking._id)}">Cancel booking</button>` : ""}
  </article>`;
}

async function loadTableBookings() {
  const list = $("#admin-table-booking-list");
  list.innerHTML = '<p class="admin-empty">Loading table bookings...</p>';
  try {
    const { bookings } = await api("/api/admin/table-bookings");
    const filtered = bookings.filter((booking) => filterMatches(adminState.search.tableBookings, [
      booking.date,
      booking.startTime,
      booking.endTime,
      booking.floor,
      booking.tableNumber,
      booking.status,
      booking.member?.name,
      booking.member?.email,
      booking.member?.libraryId
    ]));
    list.innerHTML = filtered.length
      ? filtered.map(renderTableBooking).join("")
      : '<p class="admin-empty">No table bookings match your search.</p>';
  } catch (error) {
    list.innerHTML = `<p class="admin-empty error">${escapeHtml(error.message)}</p>`;
  }
}

document.querySelectorAll("[data-admin-tab]").forEach((button) => {
  button.addEventListener("click", () => setActiveAdminTab(button.dataset.adminTab));
});

document.querySelectorAll("[data-admin-search]").forEach((input) => {
  input.addEventListener("input", (event) => {
    const key = event.target.dataset.adminSearch;
    adminState.search[key] = event.target.value;
    if (key === "members") {
      adminState.memberPage = 1;
      window.clearTimeout(adminState.memberSearchTimer);
      adminState.memberSearchTimer = window.setTimeout(loadMembers, 250);
      return;
    }
    if (key === "books") loadBooksForAdmin();
    if (key === "pickups") loadPickups();
    if (key === "deliveries") loadDeliveries();
    if (key === "issues") loadIssues();
    if (key === "suggestions") loadBookSuggestions();
    if (key === "tableBookings") loadTableBookings();
  });
});

document.querySelectorAll("[data-admin-category-filter]").forEach((select) => {
  select.addEventListener("change", (event) => {
    adminState.bookCategory = event.target.value;
    loadBooksForAdmin();
  });
});

document.querySelectorAll("[data-admin-language-filter]").forEach((select) => {
  select.addEventListener("change", (event) => {
    adminState.bookLanguage = event.target.value;
    loadBooksForAdmin();
  });
});

$("#admin-member-pagination").addEventListener("click", (event) => {
  const button = event.target.closest("[data-member-page]");
  if (!button) return;
  adminState.memberPage = Math.max(1, adminState.memberPage + (button.dataset.memberPage === "next" ? 1 : -1));
  loadMembers();
});

$("#admin-member-list").addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-member-message-form]");
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector("button[type=submit]");
  const status = form.querySelector("[data-member-message-status]");
  button.disabled = true;
  status.textContent = "";
  status.classList.remove("error");
  try {
    const data = Object.fromEntries(new FormData(form).entries());
    const { message } = await api(`/api/admin/members/${encodeURIComponent(form.dataset.memberMessageForm)}/messages`, {
      method: "POST",
      body: JSON.stringify(data)
    });
    status.textContent = message;
    form.reset();
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  } finally {
    button.disabled = false;
  }
});

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
  setMessage("#book-message", "");
  try {
    const data = Object.fromEntries(new FormData(form).entries());
    await api("/api/admin/books", { method: "POST", body: JSON.stringify(data) });
    form.reset();
    setMessage("#book-message", "Book added to the collection.");
    await Promise.all([loadBooksForAdmin(), loadOverview()]);
  } catch (error) {
    setMessage("#book-message", error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("#admin-book-manager").addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-admin-edit-book]");
  if (editButton) {
    const form = document.querySelector(`[data-admin-book-form="${CSS.escape(editButton.dataset.adminEditBook)}"]`);
    if (form) {
      form.classList.remove("hidden");
    }
    return;
  }

  const cancelButton = event.target.closest("[data-admin-cancel-edit]");
  if (cancelButton) {
    const form = document.querySelector(`[data-admin-book-form="${CSS.escape(cancelButton.dataset.adminCancelEdit)}"]`);
    if (form) form.classList.add("hidden");
    return;
  }

  const deleteButton = event.target.closest("[data-admin-delete-book]");
  if (!deleteButton) return;
  const title = deleteButton.closest(".admin-issue-card")?.querySelector("h3")?.textContent || "this book";
  if (!window.confirm(`Remove "${title}" from the catalog?`)) return;
  deleteButton.disabled = true;
  try {
    await api(`/api/admin/books/${encodeURIComponent(deleteButton.dataset.adminDeleteBook)}`, { method: "DELETE" });
    await Promise.all([loadBooksForAdmin(), loadOverview()]);
  } catch (error) {
    window.alert(error.message);
    deleteButton.disabled = false;
  }
});

$("#admin-book-manager").addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-admin-book-form]");
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    await api(`/api/admin/books/${encodeURIComponent(form.dataset.adminBookForm)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    form.classList.add("hidden");
    await Promise.all([loadBooksForAdmin(), loadOverview()]);
  } catch (error) {
    window.alert(error.message);
  } finally {
    button.disabled = false;
  }
});

$("#admin-pickup-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-pickup-status]");
  if (!button) return;
  button.disabled = true;
  try {
    await api(`/api/admin/loans/${encodeURIComponent(button.dataset.loanId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: button.dataset.pickupStatus })
    });
    await Promise.all([loadPickups(), loadOverview(), loadBooksForAdmin()]);
    if (button.dataset.pickupStatus === "returned") {
      window.alert("Book receipt confirmed. Its copy is now available in the library catalog.");
    }
  } catch (error) {
    button.disabled = false;
    window.alert(error.message);
  }
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
    await Promise.all([loadDeliveries(), loadOverview(), loadBooksForAdmin()]);
    if (button.dataset.deliveryStatus === "returned") {
      window.alert("Book receipt confirmed. Its copy is now available in the library catalog.");
    }
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
    const { notification } = await api(`/api/admin/issues/${encodeURIComponent(select.dataset.issueStatus)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: select.value })
    });
    await loadIssues();
    if (notification && !notification.sent) {
      window.alert(`Report status updated. ${notification.message}`);
    }
  } catch (error) {
    window.alert(error.message);
    await loadIssues();
  }
});

$("#admin-suggestion-list").addEventListener("change", async (event) => {
  const select = event.target.closest("[data-book-suggestion-status]");
  if (!select) return;
  select.disabled = true;
  try {
    await api(`/api/admin/book-suggestions/${encodeURIComponent(select.dataset.bookSuggestionStatus)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: select.value })
    });
    await loadBookSuggestions();
  } catch (error) {
    window.alert(error.message);
    await loadBookSuggestions();
  }
});

$("#admin-table-booking-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-admin-cancel-table-booking]");
  if (!button) return;
  if (!window.confirm("Cancel this table booking? The table will become available again.")) return;
  button.disabled = true;
  try {
    await api(`/api/admin/table-bookings/${encodeURIComponent(button.dataset.adminCancelTableBooking)}/cancel`, {
      method: "PATCH"
    });
    await loadTableBookings();
  } catch (error) {
    window.alert(error.message);
    await loadTableBookings();
  }
});

$("#refresh-pickups").addEventListener("click", loadPickups);
$("#refresh-deliveries").addEventListener("click", loadDeliveries);
$("#refresh-table-bookings").addEventListener("click", loadTableBookings);
$("#refresh-issues").addEventListener("click", loadIssues);
$("#refresh-suggestions").addEventListener("click", loadBookSuggestions);
$("#refresh-members").addEventListener("click", loadMembers);
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
