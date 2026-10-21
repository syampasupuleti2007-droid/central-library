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
    category: { type: String, enum: bookCategories, default: "Other" },
    categoryManuallySet: { type: Boolean, default: false, select: false },
    year: Number,
    subjects: [String],
    isbn: String,
    coverId: Number,
    coverUrl: { type: String, trim: true, maxlength: 2048 },
    editionCount: Number,
    source: { type: String, default: "staff" }
  },
  { timestamps: true }
);

bookSchema.index({ title: "text", author: "text" });

const loanSchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    book: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true },
    status: { type: String, enum: ["requested", "approved", "returned", "declined"], default: "requested" },
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
    dueAt: Date
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
const LibrarySettings = mongoose.model("LibrarySettings", librarySettingsSchema);

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

app.get("/api/library-settings", async (_req, res, next) => {
  try {
    const settings = await getLibrarySettings();
    res.json({ settings });
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

app.get("/api/books/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Choose a valid book." });
    const book = await Book.findById(req.params.id).lean();
    if (!book) return res.status(404).json({ error: "That book could not be found." });
    res.json({ book });
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
    if (category && category !== "All" && !bookCategories.includes(category)) {
      return res.status(400).json({ error: "Choose a valid book category." });
    }
    const filter = {};
    if (category && category !== "All") filter.category = category;
    if (search) {
      filter.$or = [
        { title: { $regex: escapeRegex(search), $options: "i" } },
        { author: { $regex: escapeRegex(search), $options: "i" } },
        { category: { $regex: escapeRegex(search), $options: "i" } },
        { subjects: { $regex: escapeRegex(search), $options: "i" } }
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
      status: { $in: ["requested", "approved"] }
    });
    if (activeCount >= 5) return res.status(400).json({ error: "You have reached the limit of five active book requests." });
    const existing = await Loan.findOne({ member: req.user.id, book: bookId, status: { $in: ["requested", "approved"] } });
    if (existing) return res.status(409).json({ error: "You already have an active request for this book." });
    const loan = await Loan.create({
      member: req.user.id,
      book: bookId,
      fulfillmentMethod,
      deliveryAddress: validatedAddress,
      deliveryFeeRupees: fulfillmentMethod === "delivery" ? DELIVERY_FEE_RUPEES : 0,
      paymentStatus: fulfillmentMethod === "delivery" ? "demo_only" : "not_required",
      trackingStatus: fulfillmentMethod === "delivery" ? "confirmed" : undefined
    });
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

app.get("/api/admin/overview", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const [books, members, loans, recentLoans] = await Promise.all([
      Book.countDocuments(),
      User.countDocuments({ role: "member" }),
      Loan.countDocuments({ status: { $in: ["requested", "approved"] } }),
      Loan.find({ status: { $in: ["requested", "approved"] } })
        .populate("member", "name email")
        .populate("book", "title author category")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean()
    ]);
    res.json({ stats: { books, members, activeLoans: loans }, loans: recentLoans });
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

app.patch("/api/admin/issues/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!["submitted", "reviewing", "resolved"].includes(status)) {
      return res.status(400).json({ error: "Choose a valid issue status." });
    }
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Choose a valid issue." });
    const previousIssue = await Issue.findById(req.params.id).select("title status contactPhone smsConsent").lean();
    if (!previousIssue) return res.status(404).json({ error: "Issue report not found." });
    const issue = await Issue.findByIdAndUpdate(req.params.id, { $set: { status } }, { new: true, runValidators: true })
      .select("-contactPhone -smsConsent")
      .lean();
    if (!issue) return res.status(404).json({ error: "Issue report not found." });
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
    if (category && category !== "All" && !bookCategories.includes(category)) {
      return res.status(400).json({ error: "Choose a valid book category." });
    }
    const filter = {};
    if (category && category !== "All") filter.category = category;
    if (search) {
      filter.$or = [
        { title: { $regex: escapeRegex(search), $options: "i" } },
        { author: { $regex: escapeRegex(search), $options: "i" } },
        { category: { $regex: escapeRegex(search), $options: "i" } }
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
    const { title, author, year, coverUrl, category } = req.body || {};
    if (typeof title !== "string" || !title.trim() || title.trim().length > 300) {
      return res.status(400).json({ error: "A book title of up to 300 characters is required." });
    }
    if (author !== undefined && (typeof author !== "string" || author.trim().length > 200)) {
      return res.status(400).json({ error: "Author must be 200 characters or fewer." });
    }
    if (!bookCategories.includes(category)) {
      return res.status(400).json({ error: "Choose a valid book category." });
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
      category,
      categoryManuallySet: true,
      coverUrl: validatedCoverUrl
    };
    if (parsedYear !== undefined) bookChanges.year = parsedYear;
    const book = await Book.findByIdAndUpdate(
      req.params.id,
      {
        $set: bookChanges,
        ...(parsedYear === undefined ? { $unset: { year: 1 } } : {})
      },
      { new: true, runValidators: true }
    );
    if (!book) return res.status(404).json({ error: "That book could not be found." });
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
      .sort({ createdAt: -1 })
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
      .sort({ createdAt: -1 })
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
    const { title, author, year, coverUrl, category } = req.body || {};
    if (typeof title !== "string" || !title.trim() || title.trim().length > 300) {
      return res.status(400).json({ error: "A book title of up to 300 characters is required." });
    }
    if (!bookCategories.includes(category)) {
      return res.status(400).json({ error: "Choose a valid book category." });
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
      category,
      categoryManuallySet: true,
      year: Number.isInteger(Number(year)) && Number(year) > 0 ? Number(year) : undefined,
      coverUrl: validatedCoverUrl
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
    loan.status = status;
    if (status === "approved") loan.dueAt = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
    await loan.save();
    res.json({ loan });
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
    if (["declined", "returned"].includes(loan.status)) {
      return res.status(400).json({ error: "The delivery tracker cannot be changed for a declined or returned request." });
    }
    loan.trackingStatus = trackingStatus;
    if (trackingStatus === "delivered") {
      loan.status = "approved";
      loan.dueAt = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
    }
    await loan.save();
    res.json({ loan });
  } catch (error) {
    next(error);
  }
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
