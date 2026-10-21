const $ = (selector) => document.querySelector(selector);
const mode = document.body.dataset.mode;
const params = new URLSearchParams(window.location.search);
const bookId = params.get("bookId");

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

function setMessage(message) {
  const target = $("#fulfillment-message");
  target.textContent = message;
  target.classList.remove("hidden");
}

function bookCard(book) {
  const title = escapeHtml(book.title);
  const coverUrl = book.coverUrl || (book.coverId ? `https://covers.openlibrary.org/b/id/${Number(book.coverId)}-M.jpg` : "");
  const availableCopies = Number(book.availableCopies ?? book.totalCopies ?? 1);
  return `<span class="fulfillment-book-cover">${coverUrl ? `<img src="${escapeHtml(coverUrl)}" alt="Cover of ${title}">` : `<span>${title}</span>`}</span>
    <span class="fulfillment-book-info"><span class="eyebrow">YOUR SELECTED BOOK</span><strong>${title}</strong><span>by ${escapeHtml(book.author || "Unknown author")}</span><span>Category: ${escapeHtml(book.category || "Other")}</span><span>${availableCopies} of ${escapeHtml(book.totalCopies ?? 1)} copies available</span>${book.year ? `<small>Published ${escapeHtml(book.year)}</small>` : ""}</span>`;
}

function showLoginPrompt() {
  const returnUrl = `${window.location.pathname}${window.location.search}`;
  const loginUrl = `/?login=1&return=${encodeURIComponent(returnUrl)}`;
  $("#fulfillment-choices")?.classList.add("hidden");
  $("#pickup-panel")?.classList.add("hidden");
  $("#delivery-form")?.classList.add("hidden");
  const message = $("#fulfillment-message");
  message.innerHTML = `<h2>Sign in to request this book</h2><p>Your library account keeps your pickup or delivery request and tracker in one place.</p><a class="button" href="${escapeHtml(loginUrl)}">Log in to continue <span aria-hidden="true">→</span></a>`;
  message.classList.remove("hidden");
}

async function initialize() {
  document.querySelectorAll(".current-year").forEach((element) => {
    element.textContent = new Date().getFullYear();
  });

  if (!bookId) {
    setMessage("A book was not selected. Return to the catalog and choose a book first.");
    return;
  }

  try {
    await api("/api/auth/me");
  } catch (error) {
    if (error.status === 401) {
      showLoginPrompt();
      return;
    }
    setMessage(error.message);
    return;
  }

  try {
    const { book } = await api(`/api/books/${encodeURIComponent(bookId)}`);
    $("#fulfillment-book").innerHTML = bookCard(book);
    if (Number(book.availableCopies ?? book.totalCopies ?? 1) === 0) {
      setMessage("This book is not available right now. All copies are currently booked.");
      return;
    }

    if (mode === "choose") {
      $("#pickup-choice").href = `/pickup.html?bookId=${encodeURIComponent(book._id)}`;
      $("#delivery-choice").href = `/delivery.html?bookId=${encodeURIComponent(book._id)}`;
      const { settings } = await api("/api/library-settings");
      if (!settings.deliveryEnabled) {
        $("#delivery-choice").classList.add("fulfillment-choice-disabled");
        $("#delivery-choice").removeAttribute("href");
        $("#delivery-choice").setAttribute("aria-disabled", "true");
        $("#delivery-choice .fulfillment-choice-label").textContent = "OPTION 02 · CURRENTLY UNAVAILABLE";
        $("#delivery-choice p").textContent = "Home delivery is temporarily unavailable. Please choose library pickup.";
        $("#delivery-choice .fulfillment-choice-action").textContent = "Delivery unavailable";
      }
      $("#fulfillment-choices").classList.remove("hidden");
      return;
    }

    const backUrl = `/fulfillment.html?bookId=${encodeURIComponent(book._id)}`;
    $("#fulfillment-back").href = backUrl;
    if (mode === "pickup") {
      const { settings } = await api("/api/library-settings");
      $("#pickup-library-name").textContent = settings.name;
      $("#pickup-library-address").innerHTML = [
        settings.addressLine1,
        settings.addressLine2,
        [settings.city, settings.region, settings.postalCode, settings.country].filter(Boolean).join(", ")
      ].filter(Boolean).map(escapeHtml).join("<br>");
      const addressQuery = [settings.name, settings.addressLine1, settings.addressLine2, settings.city, settings.region, settings.postalCode, settings.country].filter(Boolean).join(", ");
      $("#pickup-directions").href = `https://maps.google.com/?q=${encodeURIComponent(addressQuery)}`;
      $("#pickup-weekday-hours").textContent = `Monday–Friday · ${settings.weekdayHours}`;
      $("#pickup-weekend-hours").textContent = `Saturday · ${settings.saturdayHours} · Sunday · ${settings.sundayHours}`;
      $("#pickup-panel").classList.remove("hidden");
      $("#pickup-submit").addEventListener("click", submitPickup);
      return;
    }

    const savedAddress = sessionStorage.getItem(`library-delivery:${bookId}`);
    if (savedAddress) {
      try {
        const address = JSON.parse(savedAddress);
        for (const [field, value] of Object.entries(address)) {
          const input = $("#delivery-form").elements.namedItem(field);
          if (input && typeof value === "string") input.value = value;
        }
      } catch {
        sessionStorage.removeItem(`library-delivery:${bookId}`);
      }
    }
    $("#delivery-form").classList.remove("hidden");
    $("#delivery-form").addEventListener("submit", submitDelivery);
  } catch (error) {
    setMessage(error.message);
  }
}

async function submitPickup() {
  await submitRequest({
    button: $("#pickup-submit"),
    body: { bookId, fulfillmentMethod: "pickup" },
    onSuccess: () => {
      $("#pickup-panel").classList.add("hidden");
      $("#pickup-success").classList.remove("hidden");
    }
  });
}

async function submitDelivery(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = new FormData(form);
  const deliveryAddress = Object.fromEntries(
    ["recipient", "phone", "line1", "line2", "city", "region", "postalCode", "country", "instructions"]
      .map((field) => [field, String(fields.get(field) || "").trim()])
  );
  try {
    sessionStorage.setItem(`library-delivery:${bookId}`, JSON.stringify(deliveryAddress));
  } catch {
    setMessage("Your browser could not save the delivery details for checkout. Please allow session storage and try again.");
    return;
  }
  window.location.assign(`/payment.html?bookId=${encodeURIComponent(bookId)}`);
}

async function submitRequest({ button, body, onSuccess }) {
  button.disabled = true;
  $("#fulfillment-message")?.classList.add("hidden");
  try {
    const { loan } = await api("/api/loans", {
      method: "POST",
      body: JSON.stringify(body)
    });
    onSuccess(loan);
  } catch (error) {
    setMessage(error.message);
  } finally {
    button.disabled = false;
  }
}

initialize();
