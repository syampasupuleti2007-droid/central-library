require("dotenv").config();

const path = require("path");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const starterCatalog = require("./scripts/starter-catalog");
const { categories: bookCategories, inferCategory } = require("./scripts/book-categories");

const app = express();
const port = Number(process.env.PORT) || 3000;
const tokenCookie = "library_session";
const DELIVERY_FEE_RUPEES = 45;

if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
  console.error("MONGODB_URI and JWT_SECRET must be configured in .env.");
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error("JWT_SECRET must be at least 32 characters long.");
  process.exit(1);
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["member", "admin"], default: "member" },
    libraryId: { type: String, unique: true, sparse: true, trim: true, uppercase: true },
    lastLoginAt: Date
  },
  { timestamps: true }
);

const bookSchema = new mongoose.Schema(
  {
    workKey: { type: String, unique: true, sparse: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    author: { type: String, default: "Unknown author", trim: true },
    language: { type: String, default: "English", trim: true, maxlength: 100 },
    category: { type: String, enum: bookCategories, default: "Other" },
    categoryManuallySet: { type: Boolean, default: false, select: false },
    year: Number,
    subjects: [String],
    isbn: String,
    coverId: Number,
    coverUrl: { type: String, trim: true, maxlength: 2048 },
    editionCount: Number,
    totalCopies: { type: Number, min: 0, max: 1000000, default: 1 },
    copiesInUse: { type: Number, min: 0, default: 0 },
    source: { type: String, default: "staff" }
  },
  { timestamps: true }
);

bookSchema.index({ title: "text", author: "text" });

const loanSchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    book: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true },
    status: { type: String, enum: ["requested", "approved", "return_requested", "returned", "declined"], default: "requested" },
    fulfillmentMethod: { type: String, enum: ["pickup", "delivery"], default: "pickup" },
    deliveryFeeRupees: { type: Number, min: 0, default: 0 },
    paymentStatus: { type: String, enum: ["not_required", "demo_only"], default: "not_required" },
    deliveryAddress: {
      recipient: { type: String, trim: true, maxlength: 100 },
      phone: { type: String, trim: true, maxlength: 30 },
      line1: { type: String, trim: true, maxlength: 200 },
      line2: { type: String, trim: true, maxlength: 200 },
      city: { type: String, trim: true, maxlength: 100 },
      region: { type: String, trim: true, maxlength: 100 },
      postalCode: { type: String, trim: true, maxlength: 20 },
      country: { type: String, trim: true, maxlength: 100 },
      instructions: { type: String, trim: true, maxlength: 300 }
    },
    trackingStatus: {
      type: String,
      enum: ["confirmed", "preparing", "out_for_delivery", "delivered"],
      default: "confirmed"
    },
    dueAt: Date,
    returnRequestedAt: Date,
    deliveredAt: Date
  },
  { timestamps: true }
);

const issueSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, required: true, enum: ["Facilities", "Books & collection", "Website", "Accessibility", "Other"] },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    contactPhone: { type: String, trim: true, maxlength: 16 },
    smsConsent: { type: Boolean, default: false },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["submitted", "reviewing", "resolved"], default: "submitted" }
  },
  { timestamps: true }
);

issueSchema.index({ createdAt: -1 });

const bookSuggestionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    author: { type: String, trim: true, maxlength: 200, default: "" },
    details: { type: String, trim: true, maxlength: 1000, default: "" },
    suggestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["submitted", "reviewing", "approved", "declined", "added"], default: "submitted" }
  },
  { timestamps: true }
);

bookSuggestionSchema.index({ createdAt: -1 });

const tableBookingSchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    startTime: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    endTime: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    floor: { type: Number, required: true, min: 1, max: 5 },
    tableNumber: { type: Number, required: true, min: 1, max: 30 },
    status: { type: String, enum: ["confirmed", "cancelled"], default: "confirmed" }
  },
  { timestamps: true }
);

tableBookingSchema.index(
  { date: 1, startTime: 1, floor: 1, tableNumber: 1 },
  { unique: true, partialFilterExpression: { status: "confirmed" } }
);
tableBookingSchema.index(
  { member: 1, date: 1, startTime: 1 },
  { unique: true, partialFilterExpression: { status: "confirmed" } }
);
tableBookingSchema.index({ date: 1, startTime: 1, floor: 1, status: 1 });

const memberNotificationSchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    category: { type: String, enum: ["loan", "return", "delivery", "table", "suggestion", "complaint", "admin_message"], required: true },
    readAt: { type: Date, default: null }
  },
  { timestamps: true }
);

memberNotificationSchema.index({ member: 1, createdAt: -1 });
memberNotificationSchema.index({ member: 1, readAt: 1 });

const librarySettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "main", unique: true },
    name: { type: String, default: "Central Public Library", trim: true, maxlength: 120 },
    addressLine1: { type: String, default: "100 Library Lane", trim: true, maxlength: 200 },
    addressLine2: { type: String, default: "", trim: true, maxlength: 200 },
    city: { type: String, default: "Your City", trim: true, maxlength: 100 },
    region: { type: String, default: "ST", trim: true, maxlength: 100 },
    postalCode: { type: String, default: "00000", trim: true, maxlength: 20 },
    country: { type: String, default: "", trim: true, maxlength: 100 },
    email: { type: String, default: "hello@centrallibrary.org", trim: true, maxlength: 150 },
    weekdayHours: { type: String, default: "9:00 am–8:00 pm", trim: true, maxlength: 100 },
    saturdayHours: { type: String, default: "10:00 am–5:00 pm", trim: true, maxlength: 100 },
    sundayHours: { type: String, default: "12:00 pm–4:00 pm", trim: true, maxlength: 100 },
    deliveryEnabled: { type: Boolean, default: true }
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
const Book = mongoose.model("Book", bookSchema);
const Loan = mongoose.model("Loan", loanSchema);
const Issue = mongoose.model("Issue", issueSchema);
const BookSuggestion = mongoose.model("BookSuggestion", bookSuggestionSchema);
const TableBooking = mongoose.model("TableBooking", tableBookingSchema);
const MemberNotification = mongoose.model("MemberNotification", memberNotificationSchema);
const LibrarySettings = mongoose.model("LibrarySettings", librarySettingsSchema);
const activeLoanStatuses = ["requested", "approved", "return_requested"];
const TABLES_PER_FLOOR = 30;
const TABLE_FLOORS = 5;
const TABLE_BOOKING_DAYS_AHEAD = 30;

const defaultLibrarySettings = {
  name: "Central Public Library",
  addressLine1: "100 Library Lane",
  addressLine2: "",
  city: "Your City",
  region: "ST",
  postalCode: "00000",
  country: "",
  email: "hello@centrallibrary.org",
  weekdayHours: "9:00 am–8:00 pm",
  saturdayHours: "10:00 am–5:00 pm",
  sundayHours: "12:00 pm–4:00 pm",
  deliveryEnabled: true
};

async function getLibrarySettings() {
  const settings = await LibrarySettings.findOneAndUpdate(
    { key: "main" },
    { $setOnInsert: { key: "main", ...defaultLibrarySettings } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  return settings;
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function isBookableDate(value) {
  if (!isCalendarDate(value)) return false;
  const today = new Date();
  const lastBookableDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  lastBookableDate.setDate(lastBookableDate.getDate() + TABLE_BOOKING_DAYS_AHEAD);
  return value >= localDateString(today) && value <= localDateString(lastBookableDate);
}

function parseClock(hourValue, minuteValue, periodValue) {
  let hour = Number(hourValue);
  const minute = Number(minuteValue || 0);
  const period = periodValue?.toLowerCase();
  if (minute > 59 || (period && (hour < 1 || hour > 12)) || (!period && hour > 23)) return null;
  if (period) {
    hour %= 12;
    if (period === "pm") hour += 12;
  }
  return hour * 60 + minute;
}

function parseOpeningHours(value) {
  const hours = String(value ?? "");
  if (/\b(closed|not open)\b/i.test(hours)) return [];
  const match = hours.match(/^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i);
  if (!match) return null;
  const open = parseClock(match[1], match[2], match[3]);
  const close = parseClock(match[4], match[5], match[6]);
  if (open === null || close === null || close <= open) return null;
  return { open, close };
}

function openingHoursForDate(settings, date) {
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const field = weekday === 0 ? "sundayHours" : weekday === 6 ? "saturdayHours" : "weekdayHours";
  return parseOpeningHours(settings[field]);
}

function tableBookingSlots(openingHours, date) {
  if (!openingHours || Array.isArray(openingHours)) return [];
  const slots = [];
  const now = new Date();
  const currentDate = localDateString(now);
  const currentTime = now.getHours() * 60 + now.getMinutes();
  for (let start = openingHours.open; start + 60 <= openingHours.close; start += 60) {
    if (date === currentDate && start <= currentTime) continue;
    const end = start + 60;
    const format = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    slots.push({ startTime: format(start), endTime: format(end) });
  }
  return slots;
}

function withBookAvailability(books) {
  return books.map((book) => {
    const totalCopies = book.totalCopies ?? 1;
    const copiesInUse = book.copiesInUse ?? 0;
    return {
      ...book,
      totalCopies,
      copiesInUse,
      availableCopies: Math.max(0, totalCopies - copiesInUse)
    };
  });
}

async function reserveBookCopy(bookId) {
  return Book.findOneAndUpdate(
    {
      _id: bookId,
      $expr: {
        $lt: [
          { $ifNull: ["$copiesInUse", 0] },
          { $ifNull: ["$totalCopies", 1] }
        ]
      }
    },
    { $inc: { copiesInUse: 1 } },
    { new: true }
  );
}

async function releaseBookCopy(bookId) {
  await Book.updateOne(
    { _id: bookId, copiesInUse: { $gt: 0 } },
    { $inc: { copiesInUse: -1 } }
  );
}

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "20kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in a few minutes." }
});

const issueSubmissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many issue reports from this connection. Please try again later." }
});

const bookSuggestionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many book suggestions from this connection. Please try again later." }
});

async function sendIssueSms(phone, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    return { sent: false, message: "SMS notifications are not configured. Contact the library for updates." };
  }

  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ To: phone, From: fromNumber, Body: message }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      console.error(`Twilio SMS request failed with HTTP status ${response.status}.`);
      return { sent: false, message: "Your report was saved, but its SMS notification could not be sent. Please try again later." };
    }
    return { sent: true, message: "SMS update sent to your mobile." };
  } catch (error) {
    console.error("Unable to send issue report SMS:", error);
    return { sent: false, message: "Your report was saved, but its SMS notification could not be sent. Please try again later." };
  }
}

function createToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

function setSessionCookie(res, user) {
  res.cookie(tokenCookie, createToken(user), {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

async function requireAuth(req, res, next) {
  const token = req.cookies[tokenCookie];
  if (!token) return res.status(401).json({ error: "Please sign in to continue." });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ error: "Your session is no longer valid." });
    req.user = user;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
    next(error);
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Administrator access required." });
  next();
}

async function createMemberNotification(member, category, title, message) {
  return MemberNotification.create({ member, category, title, message });
}

async function generateLibraryId() {
  let candidate;
  let attempts = 0;
  do {
    const nextNumber = (await User.countDocuments()) + 1 + attempts;
    candidate = `CPL-${String(nextNumber).padStart(6, "0")}`;
    attempts += 1;
  } while (await User.exists({ libraryId: candidate }) && attempts < 20);
  return candidate;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    libraryId: user.libraryId,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt
  };
}

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/auth/register", authLimiter, async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({ error: "Please enter a name between 2 and 100 characters." });
    }
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    if (typeof password !== "string" || password.length < 10 || password.length > 128) {
      return res.status(400).json({ error: "Your password must be between 10 and 128 characters." });
    }
    const normalizedEmail = email.toLowerCase().trim();
    if (await User.exists({ email: normalizedEmail })) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12),
      role: "member",
      libraryId: await generateLibraryId(),
      lastLoginAt: new Date()
    });
    setSessionCookie(res, user);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "An account with that email already exists." });
    next(error);
  }
});

app.post("/api/auth/login", authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Email and password are required." });
    }
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+passwordHash");
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "The email or password you entered is incorrect." });
    }
    user.lastLoginAt = new Date();
    await user.save();
    setSessionCookie(res, user);
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(tokenCookie, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "strict"
  });
  res.json({ success: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.get("/api/notifications/mine", requireAuth, async (req, res, next) => {
  try {
    const [notifications, unreadCount] = await Promise.all([
      MemberNotification.find({ member: req.user._id })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      MemberNotification.countDocuments({ member: req.user._id, readAt: null })
    ]);
    res.json({ notifications, unreadCount });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/members/:id/messages", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Choose a valid member." });
    const { title, message } = req.body || {};
    if (typeof title !== "string" || title.trim().length < 2 || title.trim().length > 120) {
      return res.status(400).json({ error: "Message title must be between 2 and 120 characters." });
    }
    if (typeof message !== "string" || message.trim().length < 2 || message.trim().length > 1000) {
      return res.status(400).json({ error: "Message must be between 2 and 1,000 characters." });
    }
    const member = await User.findOne({ _id: req.params.id, role: "member" }).select("_id").lean();
    if (!member) return res.status(404).json({ error: "Library member not found." });
    const notification = await createMemberNotification(
      member._id,
      "admin_message",
      title.trim(),
      message.trim()
    );
    res.status(201).json({ notification, message: "Message sent to the member's notifications." });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/notifications/:id/read", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Choose a valid notification." });
    const notification = await MemberNotification.findOneAndUpdate(
      { _id: req.params.id, member: req.user._id, readAt: null },
      { $set: { readAt: new Date() } },
      { new: true }
    );
    if (!notification) {
      const existingNotification = await MemberNotification.exists({ _id: req.params.id, member: req.user._id });
      if (!existingNotification) return res.status(404).json({ error: "That notification could not be found." });
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/notifications/read-all", requireAuth, async (req, res, next) => {
  try {
    await MemberNotification.updateMany(
      { member: req.user._id, readAt: null },
      { $set: { readAt: new Date() } }
    );
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/library-settings", async (_req, res, next) => {
  try {
    const settings = await getLibrarySettings();
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

app.get("/api/table-bookings/availability", requireAuth, async (req, res, next) => {
  try {
    const { date, floor } = req.query;
    const floorNumber = Number(floor);
    if (!isBookableDate(date)) {
      return res.status(400).json({ error: `Choose a valid date within the next ${TABLE_BOOKING_DAYS_AHEAD} days.` });
    }
    if (!Number.isInteger(floorNumber) || floorNumber < 1 || floorNumber > TABLE_FLOORS) {
      return res.status(400).json({ error: `Choose a floor from 1 to ${TABLE_FLOORS}.` });
    }
    const settings = await getLibrarySettings();
    const openingHours = openingHoursForDate(settings, date);
    if (openingHours === null) {
      return res.status(400).json({ error: "The library opening hours are not in a supported format. Please contact the library administrator." });
    }
    const [bookings, memberBookings] = await Promise.all([
      TableBooking.find({ date, floor: floorNumber, status: "confirmed" })
      .select("startTime tableNumber")
        .lean(),
      TableBooking.find({ date, member: req.user._id, status: "confirmed" })
        .select("startTime")
        .lean()
    ]);
    const occupiedBySlot = new Map();
    const memberSlots = new Set(memberBookings.map((booking) => booking.startTime));
    for (const booking of bookings) {
      if (!occupiedBySlot.has(booking.startTime)) occupiedBySlot.set(booking.startTime, new Set());
      occupiedBySlot.get(booking.startTime).add(booking.tableNumber);
    }
    const slots = tableBookingSlots(openingHours, date).map((slot) => ({
      ...slot,
      availableTables: TABLES_PER_FLOOR - (occupiedBySlot.get(slot.startTime)?.size || 0),
      alreadyBooked: memberSlots.has(slot.startTime)
    }));
    res.json({ slots, tablesPerFloor: TABLES_PER_FLOOR });
  } catch (error) {
    next(error);
  }
});

app.get("/api/table-bookings/mine", requireAuth, async (req, res, next) => {
  try {
    const bookings = await TableBooking.find({ member: req.user._id })
      .sort({ date: -1, startTime: -1, createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ bookings });
  } catch (error) {
    next(error);
  }
});

app.post("/api/table-bookings", requireAuth, async (req, res, next) => {
  try {
    const { date, startTime } = req.body || {};
    const floor = Number(req.body?.floor);
    if (!isBookableDate(date)) {
      return res.status(400).json({ error: `Choose a valid date within the next ${TABLE_BOOKING_DAYS_AHEAD} days.` });
    }
    if (!Number.isInteger(floor) || floor < 1 || floor > TABLE_FLOORS) {
      return res.status(400).json({ error: `Choose a floor from 1 to ${TABLE_FLOORS}.` });
    }
    if (typeof startTime !== "string" || !/^\d{2}:\d{2}$/.test(startTime)) {
      return res.status(400).json({ error: "Choose a valid one-hour time slot." });
    }
    const settings = await getLibrarySettings();
    const openingHours = openingHoursForDate(settings, date);
    if (openingHours === null) {
      return res.status(400).json({ error: "The library opening hours are not in a supported format. Please contact the library administrator." });
    }
    const slot = tableBookingSlots(openingHours, date).find((availableSlot) => availableSlot.startTime === startTime);
    if (!slot) return res.status(400).json({ error: "Choose a time slot during library opening hours." });
    const existingBooking = await TableBooking.exists({
      member: req.user._id,
      date,
      startTime,
      status: "confirmed"
    });
    if (existingBooking) {
      return res.status(409).json({ error: "You already have a table booking for this time slot." });
    }

    const existingTables = await TableBooking.find({ date, startTime, floor, status: "confirmed" })
      .distinct("tableNumber");
    const occupiedTables = new Set(existingTables);
    for (let tableNumber = 1; tableNumber <= TABLES_PER_FLOOR; tableNumber += 1) {
      if (occupiedTables.has(tableNumber)) continue;
      try {
        const booking = await TableBooking.create({
          member: req.user._id,
          date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          floor,
          tableNumber
        });
        await createMemberNotification(
          req.user._id,
          "table",
          "Table booking confirmed",
          `Your table is confirmed. Table address: Floor ${floor}, Table ${tableNumber}. Date: ${date}, ${slot.startTime}–${slot.endTime}.`
        );
        return res.status(201).json({
          booking,
          message: `Your table is confirmed. Table address: Floor ${floor}, Table ${tableNumber}. Time: ${slot.startTime}–${slot.endTime}.`
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        const duplicateMemberBooking = await TableBooking.exists({
          member: req.user._id,
          date,
          startTime,
          status: "confirmed"
        });
        if (duplicateMemberBooking) {
          return res.status(409).json({ error: "You already have a table booking for this time slot." });
        }
      }
    }
    return res.status(409).json({ error: "No tables are available on this floor for that time slot. Please choose another floor or time." });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/table-bookings/:id/cancel", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Choose a valid table booking." });
    const booking = await TableBooking.findOneAndUpdate(
      { _id: req.params.id, member: req.user._id, status: "confirmed" },
      { $set: { status: "cancelled" } },
      { new: true }
    );
    if (!booking) {
      const existingBooking = await TableBooking.findOne({ _id: req.params.id, member: req.user._id }).select("status").lean();
      if (!existingBooking) return res.status(404).json({ error: "That table booking could not be found." });
      return res.status(409).json({ error: "This table booking is already cancelled." });
    }
    await createMemberNotification(
      req.user._id,
      "table",
      "Table booking cancelled",
      `Your booking for Floor ${booking.floor}, Table ${booking.tableNumber} on ${booking.date}, ${booking.startTime}–${booking.endTime}, was cancelled.`
    );
    res.json({ booking, message: "Your table booking was cancelled and the table is available again." });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/table-bookings", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const bookings = await TableBooking.find()
      .populate("member", "name email libraryId")
      .sort({ date: -1, startTime: 1, floor: 1, tableNumber: 1 })
      .limit(1000)
      .lean();
    res.json({ bookings });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/table-bookings/:id/cancel", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Choose a valid table booking." });
    const previousBooking = await TableBooking.findOne({ _id: req.params.id, status: "confirmed" }).select("member date startTime endTime floor tableNumber").lean();
    if (!previousBooking) {
      const existingBooking = await TableBooking.exists({ _id: req.params.id });
      if (!existingBooking) return res.status(404).json({ error: "Table booking not found." });
      return res.status(409).json({ error: "This table booking is already cancelled." });
    }
    const booking = await TableBooking.findOneAndUpdate(
      { _id: req.params.id, status: "confirmed" },
      { $set: { status: "cancelled" } },
      { new: true }
    );
    if (!booking) {
      return res.status(409).json({ error: "This table booking changed. Refresh the page and try again." });
    }
    await createMemberNotification(
      previousBooking.member,
      "table",
      "Table booking cancelled by the library",
      `The library cancelled your booking for Floor ${previousBooking.floor}, Table ${previousBooking.tableNumber} on ${previousBooking.date}, ${previousBooking.startTime}–${previousBooking.endTime}.`
    );
    res.json({ booking });
  } catch (error) {
    next(error);
  }
});

app.get("/api/issues", requireAuth, async (req, res, next) => {
  try {
    const issues = await Issue.find({ reportedBy: req.user._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .select("title category description status createdAt updatedAt")
      .lean();
    res.json({ issues });
  } catch (error) {
    next(error);
  }
});

app.post("/api/issues", requireAuth, issueSubmissionLimiter, async (req, res, next) => {
  try {
    const { title, category, description, contactPhone, smsConsent } = req.body || {};
    if (typeof title !== "string" || title.trim().length < 4 || title.trim().length > 120) {
      return res.status(400).json({ error: "Issue title must be between 4 and 120 characters." });
    }
    const categories = ["Facilities", "Books & collection", "Website", "Accessibility", "Other"];
    if (!categories.includes(category)) {
      return res.status(400).json({ error: "Choose a valid issue category." });
    }
    if (typeof description !== "string" || description.trim().length < 10 || description.trim().length > 2000) {
      return res.status(400).json({ error: "Please describe the issue in 10 to 2,000 characters." });
    }
    if (typeof contactPhone !== "string" || !/^\+[1-9]\d{7,14}$/.test(contactPhone.trim())) {
      return res.status(400).json({ error: "Enter a mobile number in international format, such as +14155552671." });
    }
    if (smsConsent !== true && smsConsent !== "true") {
      return res.status(400).json({ error: "Please consent to SMS updates for this issue report." });
    }
    const issue = await Issue.create({
      title: title.trim(),
      category,
      description: description.trim(),
      contactPhone: contactPhone.trim(),
      smsConsent: true,
      reportedBy: req.user._id
    });
    await createMemberNotification(
      req.user._id,
      "complaint",
      "Complaint received",
      `Your complaint "${issue.title}" was received. You will see an update here when the library reviews it.`
    );
    const notification = await sendIssueSms(
      issue.contactPhone,
      "Central Public Library: We received your issue report. Sign in to your profile for details and updates."
    );
    const responseIssue = issue.toObject();
    delete responseIssue.contactPhone;
    delete responseIssue.smsConsent;
    res.status(201).json({ issue: responseIssue, notification });
  } catch (error) {
    next(error);
  }
});

app.get("/api/book-suggestions/mine", requireAuth, async (req, res, next) => {
  try {
    const suggestions = await BookSuggestion.find({ suggestedBy: req.user._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .select("title author details status createdAt updatedAt")
      .lean();
    res.json({ suggestions });
  } catch (error) {
    next(error);
  }
});

app.post("/api/book-suggestions", requireAuth, bookSuggestionLimiter, async (req, res, next) => {
  try {
    const { title, author, details } = req.body || {};
    if (typeof title !== "string" || title.trim().length < 2 || title.trim().length > 200) {
      return res.status(400).json({ error: "Book title must be between 2 and 200 characters." });
    }
    if (author !== undefined && (typeof author !== "string" || author.trim().length > 200)) {
      return res.status(400).json({ error: "Author must be 200 characters or fewer." });
    }
    if (details !== undefined && (typeof details !== "string" || details.trim().length > 1000)) {
      return res.status(400).json({ error: "Additional details must be 1,000 characters or fewer." });
    }
    const suggestion = await BookSuggestion.create({
      title: title.trim(),
      author: typeof author === "string" ? author.trim() : "",
      details: typeof details === "string" ? details.trim() : "",
      suggestedBy: req.user._id
    });
    await createMemberNotification(
      req.user._id,
      "suggestion",
      "Book suggestion received",
      `Your suggestion "${suggestion.title}" was sent to the library team for review.`
    );
    res.status(201).json({ suggestion });
  } catch (error) {
    next(error);
  }
});

app.get("/api/books/languages", async (_req, res, next) => {
  try {
    const languages = await Book.distinct("language", { language: { $type: "string", $ne: "" } });
    res.json({ languages: languages.sort((left, right) => left.localeCompare(right)) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/books/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Choose a valid book." });
    const book = await Book.findById(req.params.id).lean();
    if (!book) return res.status(404).json({ error: "That book could not be found." });
    const [availableBook] = withBookAvailability([book]);
    res.json({ book: availableBook });
  } catch (error) {
    next(error);
  }
});

app.get("/api/books", async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(24, Math.max(1, Number.parseInt(req.query.limit, 10) || 12));
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    const language = typeof req.query.language === "string" ? req.query.language.trim() : "";
    if (category && category !== "All" && !bookCategories.includes(category)) {
      return res.status(400).json({ error: "Choose a valid book category." });
    }
    if (language && language !== "All" && language.length > 100) {
      return res.status(400).json({ error: "Choose a valid book language." });
    }
    const filter = {};
    if (category && category !== "All") filter.category = category;
    if (language && language !== "All") filter.language = new RegExp(`^${escapeRegex(language)}$`, "i");
    if (search) {
      filter.$or = [
        { title: { $regex: escapeRegex(search), $options: "i" } },
        { author: { $regex: escapeRegex(search), $options: "i" } },
        { category: { $regex: escapeRegex(search), $options: "i" } },
        { language: { $regex: escapeRegex(search), $options: "i" } },
        { subjects: { $regex: escapeRegex(search), $options: "i" } }
      ];
    }
    const [books, total] = await Promise.all([
      Book.find(filter).sort({ title: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Book.countDocuments(filter)
    ]);
    res.json({ books: withBookAvailability(books), page, pages: Math.ceil(total / limit), total });
  } catch (error) {
    next(error);
  }
});

app.post("/api/loans", requireAuth, async (req, res, next) => {
  try {
    const { bookId, fulfillmentMethod, deliveryAddress } = req.body || {};
    if (!mongoose.isValidObjectId(bookId)) return res.status(400).json({ error: "Choose a valid book." });
    if (!["pickup", "delivery"].includes(fulfillmentMethod)) {
      return res.status(400).json({ error: "Choose library pickup or home delivery." });
    }
    const librarySettings = await getLibrarySettings();
    if (fulfillmentMethod === "delivery" && !librarySettings.deliveryEnabled) {
      return res.status(400).json({ error: "Home delivery is currently unavailable. Please choose library pickup." });
    }
    let validatedAddress;
    if (fulfillmentMethod === "delivery") {
      if (!deliveryAddress || typeof deliveryAddress !== "object" || Array.isArray(deliveryAddress)) {
        return res.status(400).json({ error: "Enter delivery details to continue." });
      }
      const requiredFields = ["recipient", "phone", "line1", "city", "region", "postalCode", "country"];
      for (const field of requiredFields) {
        if (typeof deliveryAddress[field] !== "string" || !deliveryAddress[field].trim()) {
          return res.status(400).json({ error: "Complete all required delivery details." });
        }
      }
      const limits = { recipient: 100, phone: 30, line1: 200, line2: 200, city: 100, region: 100, postalCode: 20, country: 100, instructions: 300 };
      for (const [field, maxLength] of Object.entries(limits)) {
        const value = deliveryAddress[field];
        if (value !== undefined && (typeof value !== "string" || value.trim().length > maxLength)) {
          return res.status(400).json({ error: `Please check the delivery ${field} (maximum ${maxLength} characters).` });
        }
      }
      if (!/^[+()\d\s.-]{7,30}$/.test(deliveryAddress.phone.trim())) {
        return res.status(400).json({ error: "Enter a valid delivery phone number." });
      }
      validatedAddress = Object.fromEntries(
        Object.entries(limits).map(([field]) => [
          field,
          typeof deliveryAddress[field] === "string" ? deliveryAddress[field].trim() : ""
        ])
      );
    }
    const book = await Book.findById(bookId);
    if (!book) return res.status(404).json({ error: "That book could not be found." });
    const activeCount = await Loan.countDocuments({
      member: req.user.id,
      status: { $in: activeLoanStatuses }
    });
    if (activeCount >= 5) return res.status(400).json({ error: "You have reached the limit of five active book requests." });
    const existing = await Loan.findOne({ member: req.user.id, book: bookId, status: { $in: activeLoanStatuses } });
    if (existing) return res.status(409).json({ error: "You already have an active request for this book." });
    const reservedBook = await reserveBookCopy(bookId);
    if (!reservedBook) {
      return res.status(409).json({ error: "This book is not available right now. All copies are currently booked." });
    }
    let loan;
    try {
      loan = await Loan.create({
        member: req.user.id,
        book: bookId,
        fulfillmentMethod,
        deliveryAddress: validatedAddress,
        deliveryFeeRupees: fulfillmentMethod === "delivery" ? DELIVERY_FEE_RUPEES : 0,
        paymentStatus: fulfillmentMethod === "delivery" ? "demo_only" : "not_required",
        trackingStatus: fulfillmentMethod === "delivery" ? "confirmed" : undefined
      });
    } catch (error) {
      try {
        await releaseBookCopy(bookId);
      } catch (releaseError) {
        console.error("Unable to release a book copy after its request could not be saved:", releaseError);
      }
      throw error;
    }
    await createMemberNotification(
      req.user._id,
      "loan",
      "Book request received",
      `Your request for "${book.title}" was received and is waiting for library approval.`
    );
    res.status(201).json({ loan });
  } catch (error) {
    next(error);
  }
});

app.get("/api/loans/mine", requireAuth, async (req, res, next) => {
  try {
    const loans = await Loan.find({ member: req.user.id }).populate("book").sort({ createdAt: -1 }).lean();
    res.json({ loans });
  } catch (error) {
    next(error);
  }
});

app.post("/api/loans/:id/return", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Choose a valid book request." });
    }
    const loan = await Loan.findOneAndUpdate(
      {
        _id: req.params.id,
        member: req.user.id,
        status: "approved",
        $or: [
          { fulfillmentMethod: "pickup" },
          {
            fulfillmentMethod: "delivery",
            $or: [{ trackingStatus: "delivered" }, { deliveredAt: { $exists: true } }]
          }
        ]
      },
      { $set: { status: "return_requested", returnRequestedAt: new Date() } },
      { new: true, runValidators: true }
    );
    if (!loan) {
      const existingLoan = await Loan.findOne({ _id: req.params.id, member: req.user.id }).select("status").lean();
      if (!existingLoan) return res.status(404).json({ error: "That book request could not be found." });
      if (existingLoan.status === "return_requested") {
        return res.status(409).json({ error: "Your return request has already been received and is waiting for the library." });
      }
      if (existingLoan.status === "approved" && existingLoan.fulfillmentMethod === "delivery") {
        return res.status(409).json({ error: "You can request a return after the delivery has been marked delivered." });
      }
      return res.status(409).json({ error: "Only a currently borrowed book can be returned." });
    }
    const book = await Book.findById(loan.book).select("title").lean();
    await createMemberNotification(
      req.user._id,
      "return",
      "Return request received",
      `Your return request for "${book?.title || "your book"}" was received. The library will notify you when staff confirm it has been returned.`
    );
    res.json({
      loan,
      message: "Your return request has been received. Please bring the book to the library for staff to confirm its return."
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/overview", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const [books, members, loans, inventory, loanStatusCounts, recentLoans] = await Promise.all([
      Book.countDocuments(),
      User.countDocuments({ role: "member" }),
      Loan.countDocuments({ status: { $in: activeLoanStatuses } }),
      Book.aggregate([
        {
          $group: {
            _id: null,
            totalCopies: { $sum: { $ifNull: ["$totalCopies", 1] } },
            copiesInUse: { $sum: { $ifNull: ["$copiesInUse", 0] } }
          }
        },
        {
          $project: {
            _id: 0,
            totalCopies: 1,
            copiesInUse: 1,
            availableCopies: {
              $max: [0, { $subtract: ["$totalCopies", "$copiesInUse"] }]
            }
          }
        }
      ]),
      Loan.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } }
      ]),
      Loan.find({ status: { $in: activeLoanStatuses } })
        .populate("member", "name email")
        .populate("book", "title author category")
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean()
    ]);
    res.json({
      stats: {
        books,
        members,
        activeLoans: loans,
        inventory: inventory[0] || { totalCopies: 0, copiesInUse: 0, availableCopies: 0 },
        loanStatusCounts: Object.fromEntries(loanStatusCounts.map(({ _id, count }) => [_id, count]))
      },
      loans: recentLoans
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/issues", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const issues = await Issue.find()
      .populate("reportedBy", "name")
      .sort({ createdAt: -1 })
      .limit(200)
      .select("-contactPhone -smsConsent")
      .lean();
    res.json({ issues });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/book-suggestions", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const suggestions = await BookSuggestion.find()
      .populate("suggestedBy", "name email")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    res.json({ suggestions });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/book-suggestions/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const allowedStatuses = ["submitted", "reviewing", "approved", "declined", "added"];
    if (!allowedStatuses.includes(req.body?.status)) {
      return res.status(400).json({ error: "Choose a valid book suggestion status." });
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Choose a valid book suggestion." });
    }
    const previousSuggestion = await BookSuggestion.findById(req.params.id).select("status").lean();
    if (!previousSuggestion) return res.status(404).json({ error: "Book suggestion not found." });
    const suggestion = await BookSuggestion.findByIdAndUpdate(
      req.params.id,
      { $set: { status: req.body.status } },
      { new: true, runValidators: true }
    ).populate("suggestedBy", "name email").lean();
    if (!suggestion) return res.status(404).json({ error: "Book suggestion not found." });
    if (previousSuggestion?.status !== suggestion.status) {
      const statusLabels = {
        submitted: "submitted",
        reviewing: "under review",
        approved: "approved",
        declined: "declined",
        added: "added to the collection"
      };
      await createMemberNotification(
        suggestion.suggestedBy._id,
        "suggestion",
        "Book suggestion updated",
        `The library updated your suggestion "${suggestion.title}" to ${statusLabels[suggestion.status]}.`
      );
    }
    res.json({ suggestion });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/issues/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!["submitted", "reviewing", "resolved"].includes(status)) {
      return res.status(400).json({ error: "Choose a valid issue status." });
    }
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Choose a valid issue." });
    const previousIssue = await Issue.findById(req.params.id).select("title status contactPhone smsConsent reportedBy").lean();
    if (!previousIssue) return res.status(404).json({ error: "Issue report not found." });
    const issue = await Issue.findByIdAndUpdate(req.params.id, { $set: { status } }, { new: true, runValidators: true })
      .select("-contactPhone -smsConsent")
      .lean();
    if (!issue) return res.status(404).json({ error: "Issue report not found." });
    if (previousIssue.status !== issue.status) {
      const statusLabels = { submitted: "submitted", reviewing: "under review", resolved: "resolved" };
      await createMemberNotification(
        previousIssue.reportedBy,
        "complaint",
        "Complaint status updated",
        `The library updated your complaint "${issue.title}" to ${statusLabels[issue.status]}.`
      );
    }
    const notification = previousIssue.status === status || !previousIssue.smsConsent || !previousIssue.contactPhone
      ? null
      : await sendIssueSms(
        previousIssue.contactPhone,
        `Central Public Library: Your issue report status is now ${issue.status}. Sign in to your profile for details.`
      );
    res.json({ issue, notification });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/books", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    const language = typeof req.query.language === "string" ? req.query.language.trim() : "";
    if (category && category !== "All" && !bookCategories.includes(category)) {
      return res.status(400).json({ error: "Choose a valid book category." });
    }
    if (language && language !== "All" && language.length > 100) {
      return res.status(400).json({ error: "Choose a valid book language." });
    }
    const filter = {};
    if (category && category !== "All") filter.category = category;
    if (language && language !== "All") filter.language = new RegExp(`^${escapeRegex(language)}$`, "i");
    if (search) {
      filter.$or = [
        { title: { $regex: escapeRegex(search), $options: "i" } },
        { author: { $regex: escapeRegex(search), $options: "i" } },
        { category: { $regex: escapeRegex(search), $options: "i" } },
        { language: { $regex: escapeRegex(search), $options: "i" } }
      ];
    }
    const [books, total] = await Promise.all([
      Book.find(filter).sort({ title: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Book.countDocuments(filter)
    ]);
    res.json({ books, page, pages: Math.ceil(total / limit), total });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/books/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Choose a valid book." });
    const { title, author, year, coverUrl, category, language, totalCopies } = req.body || {};
    if (typeof title !== "string" || !title.trim() || title.trim().length > 300) {
      return res.status(400).json({ error: "A book title of up to 300 characters is required." });
    }
    if (author !== undefined && (typeof author !== "string" || author.trim().length > 200)) {
      return res.status(400).json({ error: "Author must be 200 characters or fewer." });
    }
    if (typeof language !== "string" || !language.trim() || language.trim().length > 100) {
      return res.status(400).json({ error: "Enter a book language of up to 100 characters." });
    }
    if (!bookCategories.includes(category)) {
      return res.status(400).json({ error: "Choose a valid book category." });
    }
    if (totalCopies !== undefined && !isValidCopyCount(totalCopies)) {
      return res.status(400).json({ error: "Enter a whole number of copies between 0 and 1,000,000." });
    }
    let validatedCoverUrl = "";
    if (coverUrl) {
      if (typeof coverUrl !== "string" || coverUrl.length > 2048) {
        return res.status(400).json({ error: "The cover image URL must be under 2,048 characters." });
      }
      try {
        const parsedCoverUrl = new URL(coverUrl);
        if (parsedCoverUrl.protocol !== "https:") throw new Error("Only HTTPS image URLs are allowed.");
        validatedCoverUrl = parsedCoverUrl.toString();
      } catch {
        return res.status(400).json({ error: "Enter a valid HTTPS URL for the cover image." });
      }
    }
    const parsedYear = year === "" || year === undefined ? undefined : Number(year);
    if (parsedYear !== undefined && (!Number.isInteger(parsedYear) || parsedYear < 1 || parsedYear > 2100)) {
      return res.status(400).json({ error: "Enter a valid publication year." });
    }
    const bookChanges = {
      title: title.trim(),
      author: author?.trim() || "Unknown author",
      language: language.trim(),
      category,
      categoryManuallySet: true,
      coverUrl: validatedCoverUrl
    };
    if (parsedYear !== undefined) bookChanges.year = parsedYear;
    if (totalCopies !== undefined) bookChanges.totalCopies = Number(totalCopies);
    const bookFilter = { _id: req.params.id };
    if (totalCopies !== undefined) {
      bookFilter.$expr = {
        $lte: [{ $ifNull: ["$copiesInUse", 0] }, Number(totalCopies)]
      };
    }
    const book = await Book.findOneAndUpdate(
      bookFilter,
      {
        $set: bookChanges,
        ...(parsedYear === undefined ? { $unset: { year: 1 } } : {})
      },
      { new: true, runValidators: true }
    );
    if (!book) {
      const existingBook = await Book.exists({ _id: req.params.id });
      if (!existingBook) return res.status(404).json({ error: "That book could not be found." });
      return res.status(400).json({ error: "Copies in collection cannot be fewer than the number already booked." });
    }
    res.json({ book });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/library-settings", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const stringFields = [
      ["name", 120], ["addressLine1", 200], ["addressLine2", 200], ["city", 100],
      ["region", 100], ["postalCode", 20], ["country", 100], ["email", 150],
      ["weekdayHours", 100], ["saturdayHours", 100], ["sundayHours", 100]
    ];
    const updates = {};
    for (const [field, maxLength] of stringFields) {
      const value = req.body?.[field];
      if (typeof value !== "string" || (!["addressLine2", "country"].includes(field) && !value.trim()) || value.trim().length > maxLength) {
        return res.status(400).json({ error: `Please enter a valid ${field} (maximum ${maxLength} characters).` });
      }
      updates[field] = value.trim();
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) {
      return res.status(400).json({ error: "Enter a valid library email address." });
    }
    if (typeof req.body.deliveryEnabled !== "boolean") {
      return res.status(400).json({ error: "Choose whether home delivery is available." });
    }
    updates.deliveryEnabled = req.body.deliveryEnabled;
    const settings = await LibrarySettings.findOneAndUpdate(
      { key: "main" },
      { $set: updates, $setOnInsert: { key: "main" } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/pickups", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const pickups = await Loan.find({ fulfillmentMethod: "pickup" })
      .populate("member", "name email")
      .populate("book", "title author category")
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
    res.json({ pickups });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/deliveries", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const loans = await Loan.find({ fulfillmentMethod: "delivery" })
      .populate("member", "name email")
      .populate("book", "title author category")
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
    res.json({ deliveries: loans });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/members", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
    const filter = {
      role: "member",
      ...(search ? {
        $or: [
          { name: { $regex: escapeRegex(search), $options: "i" } },
          { email: { $regex: escapeRegex(search), $options: "i" } },
          { libraryId: { $regex: escapeRegex(search), $options: "i" } }
        ]
      } : {})
    };
    const [members, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("name email libraryId createdAt lastLoginAt")
        .lean(),
      User.countDocuments(filter)
    ]);
    const loans = members.length
      ? await Loan.find({ member: { $in: members.map((member) => member._id) } })
          .populate("book", "title author category")
          .sort({ createdAt: -1 })
          .lean()
      : [];
    const loansByMember = new Map(members.map((member) => [String(member._id), []]));
    for (const loan of loans) {
      const memberLoans = loansByMember.get(String(loan.member));
      if (memberLoans) memberLoans.push(loan);
    }
    res.json({
      members: members.map((member) => ({
        ...member,
        loans: loansByMember.get(String(member._id)) || []
      })),
      page,
      pages: Math.ceil(total / limit),
      total
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/books", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { title, author, year, coverUrl, category, language, totalCopies } = req.body || {};
    if (typeof title !== "string" || !title.trim() || title.trim().length > 300) {
      return res.status(400).json({ error: "A book title of up to 300 characters is required." });
    }
    if (!bookCategories.includes(category)) {
      return res.status(400).json({ error: "Choose a valid book category." });
    }
    if (typeof language !== "string" || !language.trim() || language.trim().length > 100) {
      return res.status(400).json({ error: "Enter a book language of up to 100 characters." });
    }
    if (totalCopies !== undefined && !isValidCopyCount(totalCopies)) {
      return res.status(400).json({ error: "Enter a whole number of copies between 0 and 1,000,000." });
    }
    let validatedCoverUrl;
    if (coverUrl) {
      if (typeof coverUrl !== "string" || coverUrl.length > 2048) {
        return res.status(400).json({ error: "The cover image URL must be under 2,048 characters." });
      }
      try {
        const parsedCoverUrl = new URL(coverUrl);
        if (parsedCoverUrl.protocol !== "https:") throw new Error("Only HTTPS image URLs are allowed.");
        validatedCoverUrl = parsedCoverUrl.toString();
      } catch {
        return res.status(400).json({ error: "Enter a valid HTTPS URL for the cover image." });
      }
    }
    const book = await Book.create({
      title: title.trim(),
      author: typeof author === "string" && author.trim() ? author.trim().slice(0, 200) : "Unknown author",
      language: language.trim(),
      category,
      categoryManuallySet: true,
      year: Number.isInteger(Number(year)) && Number(year) > 0 ? Number(year) : undefined,
      coverUrl: validatedCoverUrl,
      ...(totalCopies === undefined ? {} : { totalCopies: Number(totalCopies) })
    });
    res.status(201).json({ book });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/books/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Choose a valid book." });
    }
    const book = await Book.findByIdAndDelete(req.params.id);
    if (!book) {
      return res.status(404).json({ error: "That book could not be found." });
    }
    res.json({ success: true, deletedBook: { _id: book._id, title: book.title } });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/loans/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!["approved", "returned", "declined"].includes(status)) {
      return res.status(400).json({ error: "Choose an allowed loan status." });
    }
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ error: "Loan request not found." });
    const allowedTransitions = {
      requested: ["approved", "declined"],
      approved: ["declined"],
      return_requested: ["returned"]
    };
    if (!allowedTransitions[loan.status]?.includes(status)) {
      if (status === "returned") {
        return res.status(400).json({ error: "A member must request a return before staff can confirm the book was received." });
      }
      return res.status(409).json({ error: "This request cannot be changed from its current status." });
    }
    const wasActive = activeLoanStatuses.includes(loan.status);
    const becomesActive = activeLoanStatuses.includes(status);
    let reservedCopy = false;
    if (!wasActive && becomesActive) {
      const book = await reserveBookCopy(loan.book);
      if (!book) {
        return res.status(409).json({ error: "This book is not available right now. All copies are currently booked." });
      }
      reservedCopy = true;
    }
    const changes = { status };
    if (status === "approved") changes.dueAt = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
    const updatedLoan = await Loan.findOneAndUpdate(
      { _id: loan._id, status: loan.status },
      { $set: changes },
      { new: true, runValidators: true }
    );
    if (!updatedLoan) {
      if (reservedCopy) await releaseBookCopy(loan.book);
      return res.status(409).json({ error: "This request has changed. Refresh the page and try again." });
    }
    if (wasActive && !becomesActive) await releaseBookCopy(loan.book);
    const book = await Book.findById(loan.book).select("title").lean();
    const bookTitle = book?.title || "your book";
    if (status === "approved") {
      await createMemberNotification(
        loan.member,
        "loan",
        "Book request approved",
        `Your request for "${bookTitle}" was approved. ${loan.fulfillmentMethod === "delivery" ? "Check your delivery tracking in Book history." : "You can pick up the book at the library."}`
      );
    } else if (status === "declined") {
      await createMemberNotification(
        loan.member,
        "loan",
        "Book request declined",
        `The library declined your request for "${bookTitle}". The reserved copy is available again.`
      );
    } else if (status === "returned") {
      await createMemberNotification(
        loan.member,
        "return",
        "Book return confirmed",
        `The library confirmed receipt of "${bookTitle}". Its copy is available again.`
      );
    }
    res.json({ loan: updatedLoan });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/loans/:id/tracking", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { trackingStatus } = req.body || {};
    const allowedStatuses = ["confirmed", "preparing", "out_for_delivery", "delivered"];
    if (!allowedStatuses.includes(trackingStatus)) {
      return res.status(400).json({ error: "Choose a valid delivery tracking status." });
    }
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ error: "Loan request not found." });
    if (loan.fulfillmentMethod !== "delivery") {
      return res.status(400).json({ error: "Tracking updates are only available for delivery requests." });
    }
    if (["declined", "return_requested", "returned"].includes(loan.status)) {
      return res.status(400).json({ error: "The delivery tracker cannot be changed for a declined, return-requested, or returned request." });
    }
    const previousTrackingStatus = loan.trackingStatus;
    loan.trackingStatus = trackingStatus;
    if (trackingStatus === "delivered") {
      loan.status = "approved";
      loan.dueAt = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
      loan.deliveredAt = loan.deliveredAt || new Date();
    }
    await loan.save();
    if (previousTrackingStatus !== trackingStatus) {
      const trackingMessages = {
        confirmed: "Your delivery request has been confirmed.",
        preparing: "Your book is being prepared for delivery.",
        out_for_delivery: "Your book is out for delivery.",
        delivered: "Your book delivery is marked as delivered."
      };
      const book = await Book.findById(loan.book).select("title").lean();
      await createMemberNotification(
        loan.member,
        "delivery",
        "Delivery status updated",
        `${trackingMessages[trackingStatus]}${book?.title ? ` Book: "${book.title}".` : ""}`
      );
    }
    res.json({ loan });
  } catch (error) {
    next(error);
  }
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isValidCopyCount(value) {
  return (typeof value === "number" || (typeof value === "string" && value.trim() !== ""))
    && Number.isInteger(Number(value))
    && Number(value) >= 0
    && Number(value) <= 1000000;
}

app.use("/api", (req, res) => res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error.name === "ValidationError") return res.status(400).json({ error: "Please check the submitted information." });
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

async function start() {
  await mongoose.connect(process.env.MONGODB_URI);

  if (await Book.countDocuments() === 0) {
    const starterBooks = starterCatalog.map((book) => ({
      ...book,
      category: book.category || inferCategory(book.subjects),
      workKey: `starter:${book.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      source: "starter"
    }));
    await Book.insertMany(starterBooks, { ordered: false });
    console.log(`Added ${starterBooks.length} starter books to the searchable catalog.`);
  }

  const uncategorizedBooks = await Book.find({
    $or: [{ category: { $exists: false } }, { category: null }, { category: "" }]
  }).select("_id subjects").lean();
  if (uncategorizedBooks.length) {
    await Book.bulkWrite(uncategorizedBooks.map((book) => ({
      updateOne: {
        filter: { _id: book._id },
        update: { $set: { category: inferCategory(book.subjects) } }
      }
    })));
    console.log(`Assigned categories to ${uncategorizedBooks.length} existing books using their catalog subjects.`);
  }

  const booksWithoutLanguage = await Book.updateMany(
    { $or: [{ language: { $exists: false } }, { language: null }, { language: "" }] },
    { $set: { language: "English" } }
  );
  if (booksWithoutLanguage.modifiedCount) {
    console.log(`Set English as the language for ${booksWithoutLanguage.modifiedCount} existing books without a language.`);
  }

  const copyCountMigration = await Book.updateMany(
    { $or: [{ totalCopies: { $exists: false } }, { totalCopies: null }] },
    { $set: { totalCopies: 1 } }
  );
  if (copyCountMigration.modifiedCount) {
    console.log(`Set the default copy count for ${copyCountMigration.modifiedCount} existing books.`);
  }

  const booksWithoutUsage = await Book.find({
    $or: [{ copiesInUse: { $exists: false } }, { copiesInUse: null }]
  }).select("_id").lean();
  if (booksWithoutUsage.length) {
    const usageCounts = await Loan.aggregate([
      {
        $match: {
          book: { $in: booksWithoutUsage.map((book) => book._id) },
          status: { $in: activeLoanStatuses }
        }
      },
      { $group: { _id: "$book", count: { $sum: 1 } } }
    ]);
    const usageByBook = new Map(usageCounts.map(({ _id, count }) => [String(_id), count]));
    await Book.bulkWrite(booksWithoutUsage.map((book) => ({
      updateOne: {
        filter: { _id: book._id, $or: [{ copiesInUse: { $exists: false } }, { copiesInUse: null }] },
        update: { $set: { copiesInUse: usageByBook.get(String(book._id)) || 0 } }
      }
    })));
    console.log(`Calculated currently booked copies for ${booksWithoutUsage.length} existing books.`);
  }

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    if (process.env.ADMIN_PASSWORD.length < 12) {
      throw new Error("ADMIN_PASSWORD must be at least 12 characters long.");
    }
    const email = process.env.ADMIN_EMAIL.toLowerCase().trim();
    const existing = await User.findOne({ email });
    if (!existing) {
      await User.create({
        name: "Library Administrator",
        email,
        passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 12),
        role: "admin",
        libraryId: await generateLibraryId()
      });
      console.log(`Created initial administrator account for ${email}.`);
    }
  }

  const usersWithoutLibraryId = await User.find({ libraryId: { $exists: false } });
  for (const user of usersWithoutLibraryId) {
    user.libraryId = await generateLibraryId();
    await user.save();
  }

  app.listen(port, () => console.log(`Central Public Library is running at http://localhost:${port}`));
}

start().catch((error) => {
  console.error("Unable to start the library server:", error);
  process.exit(1);
});
