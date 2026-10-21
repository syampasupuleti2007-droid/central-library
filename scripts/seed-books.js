require("dotenv").config();

const mongoose = require("mongoose");
const { inferCategory } = require("./book-categories");

const bookSchema = new mongoose.Schema(
  {
    workKey: { type: String, unique: true, sparse: true },
    title: String,
    author: String,
    category: String,
    categoryManuallySet: Boolean,
    year: Number,
    subjects: [String],
    isbn: String,
    coverId: Number,
    coverUrl: String,
    editionCount: Number,
    source: String
  },
  { timestamps: true }
);
const Book = mongoose.model("Book", bookSchema);

const PAGE_SIZE = 100;
const MAX_ATTEMPTS = 5;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchPage(offset) {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("q", "language:eng");
  url.searchParams.set("fields", "key,title,author_name,first_publish_year,isbn,cover_i,subject");
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "CentralPublicLibrary/1.0 (catalog seeding)" },
        signal: AbortSignal.timeout(20000)
      });
      if (response.ok) {
        const data = await response.json();
        if (data.error) throw new Error(`Open Library reported an error: ${data.error}`);
        if (!Array.isArray(data.docs)) throw new Error("Open Library returned an unexpected catalog response.");
        if (offset === 0 && data.docs.length === 0) {
          throw new Error("Open Library returned no books for the catalog query. The import was stopped without reporting success.");
        }
        return data.docs;
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw new Error(`Open Library returned ${response.status} ${response.statusText} for catalog page at offset ${offset}.`);
      }

      const retryAfter = Number(response.headers.get("retry-after"));
      const waitTime = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30000)
        : Math.min(1000 * 2 ** (attempt - 1), 16000);
      console.warn(`Open Library returned ${response.status}; retrying page ${Math.floor(offset / PAGE_SIZE) + 1} in ${waitTime / 1000}s (attempt ${attempt + 1}/${MAX_ATTEMPTS}).`);
      await delay(waitTime);
    } catch (error) {
      if (error.message.startsWith("Open Library returned")) throw error;
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`Unable to fetch Open Library page at offset ${offset} after ${MAX_ATTEMPTS} attempts: ${error.message}`);
      }
      const waitTime = Math.min(1000 * 2 ** (attempt - 1), 16000);
      console.warn(`Open Library request failed; retrying page ${Math.floor(offset / PAGE_SIZE) + 1} in ${waitTime / 1000}s (attempt ${attempt + 1}/${MAX_ATTEMPTS}).`);
      await delay(waitTime);
    }
  }

  throw new Error(`Unable to fetch Open Library page at offset ${offset}.`);
}

async function run() {
  if (!process.env.MONGODB_URI) throw new Error("Set MONGODB_URI in .env before seeding.");
  await mongoose.connect(process.env.MONGODB_URI);
  let imported = 0;

  for (let offset = 0; offset < 6000; offset += PAGE_SIZE) {
    const docs = await fetchPage(offset);
    const operations = docs
      .filter((doc) => doc.key && doc.title)
      .map((doc) => ({
        updateOne: {
          filter: { workKey: doc.key },
          update: {
            $set: {
              workKey: doc.key,
              title: doc.title.slice(0, 300),
              author: (doc.author_name && doc.author_name[0]) || "Unknown author",
              year: doc.first_publish_year,
              subjects: (doc.subject || []).slice(0, 8),
              isbn: doc.isbn && doc.isbn[0],
              coverId: doc.cover_i,
              coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : undefined,
              editionCount: doc.edition_count,
              source: "openlibrary"
            },
            $setOnInsert: {
              category: inferCategory(doc.subject),
              categoryManuallySet: false
            }
          },
          upsert: true
        }
      }));

    if (operations.length) {
      await Book.bulkWrite(operations, { ordered: false });
      await Book.bulkWrite(docs.filter((doc) => doc.key && doc.title).map((doc) => ({
        updateOne: {
          filter: { workKey: doc.key, categoryManuallySet: { $ne: true } },
          update: { $set: { category: inferCategory(doc.subject) } }
        }
      })), { ordered: false });
    }
    imported += operations.length;
    console.log(`Processed catalog page ${Math.floor(offset / PAGE_SIZE) + 1}: ${imported} of up to 6,000 records.`);
    if (docs.length < PAGE_SIZE) {
      if (imported === 0) throw new Error("No valid book records were imported.");
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(`Catalog import complete: ${imported} records processed.`);
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("Book catalog import failed:", error);
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  process.exitCode = 1;
});
