const categories = [
  "Adventure",
  "Biography",
  "Children",
  "Classics",
  "Fantasy",
  "History",
  "Horror",
  "Mystery",
  "Nonfiction",
  "Philosophy",
  "Romance",
  "Science Fiction",
  "Other"
];

function inferCategory(subjects = []) {
  const subjectText = (Array.isArray(subjects) ? subjects : [])
    .filter((subject) => typeof subject === "string")
    .join(" ")
    .toLowerCase();

  if (/horror|gothic|ghost/.test(subjectText)) return "Horror";
  if (/histor(y|ical)|biograph|autobiograph|memoir/.test(subjectText)) {
    return /biograph|memoir/.test(subjectText) ? "Biography" : "History";
  }
  if (/mystery|detective|crime|thriller/.test(subjectText)) return "Mystery";
  if (/science fiction|sci-fi/.test(subjectText)) return "Science Fiction";
  if (/fantasy|fairy tale/.test(subjectText)) return "Fantasy";
  if (/romance|love stories/.test(subjectText)) return "Romance";
  if (/adventure|travel/.test(subjectText)) return "Adventure";
  if (/children|juvenile/.test(subjectText)) return "Children";
  if (/philosophy|stoicism/.test(subjectText)) return "Philosophy";
  if (/classic/.test(subjectText)) return "Classics";
  if (/nonfiction|non-fiction|reference|science/.test(subjectText)) return "Nonfiction";
  return "Other";
}

module.exports = { categories, inferCategory };
