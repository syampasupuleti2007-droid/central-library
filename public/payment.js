const $ = (selector) => document.querySelector(selector);
const bookId = new URLSearchParams(window.location.search).get("bookId");
const addressStorageKey = `library-delivery:${bookId}`;
let deliveryAddress;
let member;
let book;
let librarySettings;

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

function showMessage(message, isError = true) {
  const element = $("#payment-message");
  element.textContent = message;
  element.classList.remove("hidden");
  element.classList.toggle("error", isError);
}

function readDeliveryAddress() {
  const savedAddress = sessionStorage.getItem(addressStorageKey);
  if (!savedAddress) throw new Error("Delivery details were not found. Return to the delivery form and enter them again.");
  const address = JSON.parse(savedAddress);
  const requiredFields = ["recipient", "phone", "line1", "city", "region", "postalCode", "country"];
  for (const field of requiredFields) {
    if (typeof address[field] !== "string" || !address[field].trim()) {
      throw new Error("Some required delivery details are missing. Return to the delivery form and complete them.");
    }
  }
  return address;
}

function renderAddress(address) {
  const lines = [
    address.recipient,
    address.line1,
    address.line2,
    [address.city, address.region, address.postalCode, address.country].filter(Boolean).join(", "),
    address.phone
  ].filter(Boolean);
  $("#payment-address").innerHTML = `<h3>Delivery address</h3><p>${lines.map(escapeHtml).join("<br>")}</p><a href="/delivery.html?bookId=${encodeURIComponent(bookId)}">Edit address</a>`;
}

function renderReceipt(loan) {
  const addressLines = [
    deliveryAddress.recipient,
    deliveryAddress.line1,
    deliveryAddress.line2,
    [deliveryAddress.city, deliveryAddress.region, deliveryAddress.postalCode, deliveryAddress.country].filter(Boolean).join(", "),
    deliveryAddress.phone
  ].filter(Boolean);
  const receiptNumber = `CPL-DEMO-${String(loan._id).toUpperCase()}`;
  const receiptDate = new Date(loan.createdAt || Date.now()).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });

  $("#payment-receipt").innerHTML = `
    <header class="receipt-header">
      <div class="receipt-brand"><span class="receipt-brand-mark" aria-hidden="true">C</span><div><strong>${escapeHtml(librarySettings.name || "Central Public Library")}</strong><span>DELIVERY RECEIPT</span></div></div>
      <span class="receipt-demo-stamp">DEMO · NOT A REAL PAYMENT</span>
    </header>
    <div class="receipt-meta">
      <div><span>Receipt reference</span><strong>${escapeHtml(receiptNumber)}</strong></div>
      <div><span>Date</span><strong>${escapeHtml(receiptDate)}</strong></div>
      <div><span>Member</span><strong>${escapeHtml(member.name || "Library member")}</strong></div>
      <div><span>Library ID</span><strong>${escapeHtml(member.libraryId || "Not assigned")}</strong></div>
    </div>
    <div class="receipt-section">
      <h3>Request details</h3>
      <div class="receipt-line"><span>Book</span><strong>${escapeHtml(book.title || "Selected book")}</strong></div>
      <div class="receipt-line"><span>Author</span><strong>${escapeHtml(book.author || "Unknown author")}</strong></div>
      <div class="receipt-line"><span>Fulfillment</span><strong>Home delivery</strong></div>
    </div>
    <div class="receipt-section">
      <h3>Delivery address</h3>
      <p class="receipt-address">${addressLines.map(escapeHtml).join("<br>")}</p>
    </div>
    <div class="receipt-section receipt-charges">
      <div class="receipt-line"><span>Delivery charge</span><strong>₹${Number(loan.deliveryFeeRupees ?? 45).toLocaleString("en-IN")}</strong></div>
      <div class="receipt-line receipt-total"><span>Total (demo)</span><strong>₹${Number(loan.deliveryFeeRupees ?? 45).toLocaleString("en-IN")}</strong></div>
      <div class="receipt-line"><span>Payment status</span><strong>Simulated — no money charged</strong></div>
      <div class="receipt-line"><span>Request status</span><strong>${escapeHtml(loan.status || "requested")}</strong></div>
    </div>
    <footer class="receipt-footer">This receipt documents a demonstration checkout only. It is not proof of payment or a tax invoice. No funds were collected.</footer>`;
}

async function initialize() {
  document.querySelectorAll(".current-year").forEach((element) => {
    element.textContent = new Date().getFullYear();
  });
  $("#payment-cancel").href = `/delivery.html?bookId=${encodeURIComponent(bookId || "")}`;
  $("#payment-back").href = `/delivery.html?bookId=${encodeURIComponent(bookId || "")}`;

  if (!bookId) {
    showMessage("A book was not selected. Return to the catalog and start a delivery request.");
    return;
  }

  try {
    const session = await api("/api/auth/me");
    member = session.user;
    deliveryAddress = readDeliveryAddress();
    const [bookResult, settingsResult] = await Promise.all([
      api(`/api/books/${encodeURIComponent(bookId)}`),
      api("/api/library-settings")
    ]);
    book = bookResult.book;
    librarySettings = settingsResult.settings;
    if (!librarySettings.deliveryEnabled) {
      throw new Error("Home delivery is currently unavailable. Please choose library pickup.");
    }
    if (Number(book.availableCopies ?? book.totalCopies ?? 1) === 0) {
      throw new Error("This book is not available right now. All copies are currently booked.");
    }

    const title = escapeHtml(book.title || "Selected book");
    const coverUrl = book.coverUrl || (book.coverId ? `https://covers.openlibrary.org/b/id/${Number(book.coverId)}-M.jpg` : "");
    $("#payment-book").innerHTML = `<span class="fulfillment-book-cover">${coverUrl ? `<img src="${escapeHtml(coverUrl)}" alt="Cover of ${title}">` : `<span>${title}</span>`}</span><span class="fulfillment-book-info"><span class="eyebrow">YOUR SELECTED BOOK</span><strong>${title}</strong><span>by ${escapeHtml(book.author || "Unknown author")}</span><span>${Number(book.availableCopies ?? book.totalCopies ?? 1)} of ${escapeHtml(book.totalCopies ?? 1)} copies available</span></span>`;
    renderAddress(deliveryAddress);
    $("#payment-submit").disabled = false;
  } catch (error) {
    if (error.status === 401) {
      const returnUrl = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/?login=1&return=${encodeURIComponent(returnUrl)}`);
      return;
    }
    showMessage(error.message);
  }
}

$("#payment-submit").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  $("#payment-message").classList.add("hidden");
  try {
    const { loan } = await api("/api/loans", {
      method: "POST",
      body: JSON.stringify({
        bookId,
        fulfillmentMethod: "delivery",
        deliveryAddress
      })
    });
    renderReceipt(loan);
    try {
      sessionStorage.removeItem(addressStorageKey);
    } catch (error) {
      console.error("Unable to clear the saved delivery address after checkout:", error);
    }
    $("#payment-panel").classList.add("hidden");
    $("#payment-success").classList.remove("hidden");
  } catch (error) {
    showMessage(error.message);
    button.disabled = false;
  }
});

$("#print-receipt").addEventListener("click", () => window.print());

initialize();
