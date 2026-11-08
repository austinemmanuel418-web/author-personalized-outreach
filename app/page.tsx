"use client";

import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";

type Source = { title: string; url: string };

type Candidate = {
  authorName: string;
  bookTitle: string;
  bookWhy: string;
  reason: string;
};

type Research = {
  matchType: "exact" | "possible" | "none";
  confidence: "high" | "medium" | "low" | "none";
  authorName: string;
  bookTitle: string;
  bookWhy: string;
  notes: string;
  candidates: Candidate[];
  sources: Source[];
  authorBio?: string;
  profiles?: { amazon?: string; goodreads?: string };
};

type Book = {
  title: string;
  year: string;
  description: string;
  source: string;
  link: string;
  subtitle?: string;
  recent?: boolean;
};

type Site = { website: string; contacts: { url: string; form: boolean }[] };
type EmailCheck = {
  for: string;
  level: "ok" | "warn" | "bad";
  message: string;
  suggestion?: string;
};
type Draft = { subject: string; body: string };

type Author = {
  email: string;
  name: string;
  status: "idle" | "loading" | "done" | "error";
  result?: Research;
  message?: string;
  approval?: "approved" | "rejected";
  editing?: boolean;
  draft?: Draft;
  writing?: boolean;
  sendStatus?: "sending" | "sent" | "failed";
  sendError?: string;
  bookLoading?: boolean;
  bookMessage?: string;
  sendTo?: string;
  contactLoading?: boolean;
  contactMessage?: string;
  contactEmails?: { email: string; source: string }[];
  manualEmail?: string;
  byName?: boolean;
  open?: boolean;
  hint?: string;
  books?: Book[];
  booksLoading?: boolean;
  booksMessage?: string;
  bioLoading?: boolean;
  bioMessage?: string;
  site?: Site;
  siteLoading?: boolean;
  siteMessage?: string;
  emailCheck?: EmailCheck;
  checking?: boolean;
  bookChecked?: boolean;
  bookLink?: string;
  linkLoading?: boolean;
  linkMessage?: string;
};

const EMAIL_REGEX = /[^\s,;<>"']+@[^\s,;<>"']+\.[^\s,;<>"']+/g;
const DEFAULT_SUBJECT =
  "[Book Title] has been selected for  an Author Spotlight feature";

const DEFAULT_BODY = `Hello [Author First Name],

I recently came across [Book Title] and was drawn to [specific detail, e.g., the way it explores grief and healing / your approach to teaching leadership through real stories]. [One sentence about something specific you noticed, such as the book's central idea, the author's background, or why the topic matters.]

I'm reaching out from The Author Global Press Book Review, an independent editorial platform that features authors and their books. This Spotlight Feature  would focus on you, covering your writing journey, what inspired [Book Title], and the message you hope readers take away.

A feature like this can help you:

1. Introduce your [Book Title] to thousands of active readers across syndicated news feeds daily.
2. Build permanent Google Search ranking whenever potential readers look up your name or book title.
3. Establish strong media credibility and official press recognition for your author brand.
4. Drive direct sales traffic with strategically placed buy links pointing straight to your Amazon page.
5. Gain a lifetime shareable marketing asset to feature in your press kit, social media, and author newsletter.
6. Save valuable time, as our editorial team handles 100% of the writing and layout preparation for you.

Our team would love to write a custom, complimentary feature draft on your book so that you can review the exact layout and narrative before making any decisions. There is no drafting fee!

If this sounds interesting, just reply "YES" and I'll send the next steps.

Whatever you decide, thank you for putting something meaningful into the world. That takes real effort, and it matters far more than most people realize.

Best regards,`;

// ---------- Look and feel (purple and white) ----------
const CARD = "rounded-2xl border border-violet-100 bg-white p-6 shadow-sm";
const BTN =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg bg-violet-700 px-4 text-sm font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_OUT =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border border-violet-300 bg-white px-4 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_STOP =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700";
const BTN_SM =
  "rounded-md border border-violet-300 bg-white px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50";
const INPUT =
  "w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-violet-950 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200";
const LABEL = "mb-1 block text-sm font-semibold";
const BADGE = "rounded-full px-3 py-1 text-xs font-semibold";

// The colored label that shows the state of one author
function statusBadge(a: Author): { text: string; cls: string } {
  if (a.status === "loading")
    return { text: "Researching…", cls: "bg-violet-100 text-violet-900" };
  if (a.status === "error")
    return { text: "Research failed", cls: "bg-red-100 text-red-800" };
  if (a.status === "idle")
    return { text: "Not researched", cls: "bg-violet-100 text-violet-900" };
  if (a.byName && a.result?.authorName)
    return { text: "Found by name", cls: "bg-violet-100 text-violet-900" };
  const m = a.result?.matchType;
  if (m === "exact")
    return { text: "Exact match", cls: "bg-green-100 text-green-800" };
  if (m === "possible")
    return { text: "Possible match", cls: "bg-amber-100 text-amber-900" };
  return { text: "No author found", cls: "bg-red-100 text-red-800" };
}

// Names the app already knows how to fill (a few spellings are accepted)
function isKnownSlot(s: string) {
  return /^\[\s*((author['’]?s?\s*)?(first\s*)?name|author|book['’]?s?\s*(title|name)|title|book)\s*\]$/i.test(
    s,
  );
}

// Any other [bracket] in the template is something the AI should write
function findAiSlots(text: string): string[] {
  const all = text.match(/\[[^\]]+\]/g) || [];
  return [...new Set(all.filter((s) => !isKnownSlot(s)))];
}

// Replaces the placeholders in a text
function fillText(
  text: string,
  vals: {
    authorName: string;
    bookTitle: string;
    details: Record<string, string>;
  },
) {
  const first = vals.authorName.trim().split(" ")[0];
  let out = text;
  if (first)
    out = out.replace(/\[\s*(author\s*)?first\s*name\s*\]/gi, () => first);
  if (vals.authorName)
    out = out.replace(
      /\[\s*(author['’]?s?\s*name|author|name)\s*\]/gi,
      () => vals.authorName,
    );
  if (vals.bookTitle)
    out = out.replace(
      /\[\s*(book['’]?s?\s*(title|name)|title|book)\s*\]/gi,
      () => vals.bookTitle,
    );
  for (const [slot, detail] of Object.entries(vals.details)) {
    if (detail) out = out.split(slot).join(detail);
  }
  // Plain emails cannot show bold or italic, so remove the *stars*
  return out
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1");
}

// A small log in your browser of who you already emailed
const SENT_KEY = "sentEmails";

function getSent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SENT_KEY) || "[]");
  } catch {
    return [];
  }
}

function addSent(email: string) {
  try {
    const list = getSent();
    const e = email.toLowerCase();
    if (!list.includes(e)) {
      list.push(e);
      localStorage.setItem(SENT_KEY, JSON.stringify(list));
    }
  } catch {}
}

function wasSent(email: string) {
  return getSent().includes(email.toLowerCase());
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function Home() {
  const [authors, setAuthors] = useState<Author[]>([]);
  const [pasted, setPasted] = useState("");
  const [namesPasted, setNamesPasted] = useState("");
  const [error, setError] = useState("");
  const [subjectTemplate, setSubjectTemplate] = useState(DEFAULT_SUBJECT);
  const [bodyTemplate, setBodyTemplate] = useState(DEFAULT_BODY);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);
  const [progress, setProgress] = useState("");
  const stopRef = useRef(false);
  const [researchingAll, setResearchingAll] = useState(false);
  const [researchProgress, setResearchProgress] = useState("");
  const stopResearchRef = useRef(false);
  const [authorsLoaded, setAuthorsLoaded] = useState(false);
  const [nameQuery, setNameQuery] = useState("");

  // Load the saved template when the page opens
  useEffect(() => {
    try {
      const saved = localStorage.getItem("emailTemplate");
      if (saved) {
        const t = JSON.parse(saved);
        if (t.subject) setSubjectTemplate(t.subject);
        if (t.body) setBodyTemplate(t.body);
      }
    } catch {}
    setTemplateLoaded(true);
  }, []);

  // Save the template every time you change it
  useEffect(() => {
    if (!templateLoaded) return;
    try {
      localStorage.setItem(
        "emailTemplate",
        JSON.stringify({ subject: subjectTemplate, body: bodyTemplate }),
      );
    } catch {}
  }, [subjectTemplate, bodyTemplate, templateLoaded]);

  // Load the saved author list when the page opens
  useEffect(() => {
    try {
      const saved = localStorage.getItem("authorsList");
      if (saved) {
        const list: Author[] = JSON.parse(saved);
        setAuthors(
          list.map(
            (a): Author => ({
              ...a,
              // If the page closed in the middle of a task, reset that task
              status:
                a.status === "loading"
                  ? a.result
                    ? "done"
                    : "idle"
                  : a.status,
              writing: false,
              contactLoading: false,
              bookLoading: false,
              linkLoading: false,
              checking: false,
              siteLoading: false,
              editing: false,
              sendStatus: a.sendStatus === "sending" ? undefined : a.sendStatus,
            }),
          ),
        );
      }
    } catch {}
    setAuthorsLoaded(true);
  }, []);

  // Save the author list every time it changes
  useEffect(() => {
    if (!authorsLoaded) return;
    try {
      localStorage.setItem("authorsList", JSON.stringify(authors));
    } catch {}
  }, [authors, authorsLoaded]);

  // If you paste a full email that starts with "Subject:", split it
  function handleBodyChange(value: string) {
    const m = value.match(/^\s*subject:\s*(.*)\r?\n+/i);
    if (m) {
      setSubjectTemplate(m[1].trim());
      setBodyTemplate(value.slice(m[0].length));
    } else {
      setBodyTemplate(value);
    }
  }

  // Upload a .txt file with your template
  function handleTemplateFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => handleBodyChange(String(reader.result || ""));
    reader.readAsText(file);
    e.target.value = "";
  }

  function addAuthors(newOnes: { email: string; name: string }[]) {
    setAuthors((current) => {
      const seen = new Set(current.map((a) => a.email.toLowerCase()));
      const result = [...current];
      for (const a of newOnes) {
        const key = a.email.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ ...a, status: "idle" });
        }
      }
      return result;
    });
  }

  // Reads a CSV file (from the file box or from drag and drop)
  function parseCsv(file: File) {
    setError("");

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (result) => {
        const list = result.data
          .map((row) => ({
            email: (row.email || "").trim(),
            name: (row.name || "").trim(),
          }))
          .filter((a) => a.email.includes("@"));

        if (list.length === 0) {
          setError(
            "No emails found. Make sure your file has an 'email' column.",
          );
          return;
        }
        addAuthors(list);
      },
      error: () => setError("Could not read this file."),
    });
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    parseCsv(file);
    e.target.value = "";
  }

  function handlePaste() {
    setError("");
    const list: { email: string; name: string }[] = [];

    for (const line of pasted.split("\n")) {
      const matches = line.match(EMAIL_REGEX);
      if (!matches) continue;

      if (matches.length > 1) {
        for (const email of matches) list.push({ email, name: "" });
      } else {
        const email = matches[0];
        const name = line
          .replace(email, "")
          .replace(/[,;<>"']/g, " ")
          .trim();
        list.push({ email, name });
      }
    }

    if (list.length === 0) {
      setError("No emails found in the box.");
      return;
    }
    addAuthors(list);
    setPasted("");
  }

  // Changes one author in the list
  function updateAuthor(email: string, changes: Partial<Author>) {
    setAuthors((current) =>
      current.map((a) => (a.email === email ? { ...a, ...changes } : a)),
    );
  }

  // Changes the research result of one author (used by Edit)
  function updateResult(email: string, changes: Partial<Research>) {
    setAuthors((current) =>
      current.map((a) =>
        a.email === email && a.result
          ? { ...a, result: { ...a.result, ...changes } }
          : a,
      ),
    );
  }

  // Searches the web for details about the book of one author
  async function findBookDetails(
    email: string,
    authorName: string,
    bookTitle: string,
  ) {
    if (!authorName || !bookTitle) {
      setError("Add the author name and the book title first.");
      return;
    }
    setError("");
    updateAuthor(email, { bookLoading: true, bookMessage: "" });

    try {
      const res = await fetch("/api/research-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorName, bookTitle }),
      });
      const data = await res.json();

      if (!res.ok) {
        updateAuthor(email, {
          bookLoading: false,
          bookMessage: data.error || "Could not research the book.",
        });
        return;
      }

      setAuthors((current) =>
        current.map((a) => {
          if (a.email !== email || !a.result) return a;
          const have = new Set(a.result.sources.map((s) => s.url));
          const newSources = (data.sources || []).filter(
            (s: Source) => !have.has(s.url),
          );
          return {
            ...a,
            bookLoading: false,
            bookChecked: true,
            bookMessage: data.bookWhy
              ? `Book details found${data.from?.length ? ` (from ${data.from.join(", ")})` : ""}. Click Fill again on the email below to put them in.`
              : "No details about this book were found on the pages. Use Edit to type your own detail.",
            result: {
              ...a.result,
              bookWhy: data.bookWhy || a.result.bookWhy,
              sources: [...a.result.sources, ...newSources],
            },
          };
        }),
      );
    } catch {
      updateAuthor(email, {
        bookLoading: false,
        bookMessage: "Could not reach the server.",
      });
    }
  }

  // Makes a similar author the main pick
  function pickCandidate(email: string, c: Candidate) {
    updateResult(email, {
      authorName: c.authorName,
      bookTitle: c.bookTitle,
      bookWhy: c.bookWhy,
      authorBio: "",
    });
    updateAuthor(email, {
      sendTo: undefined,
      manualEmail: undefined,
      contactEmails: undefined,
      contactMessage: "",
      books: undefined,
      booksMessage: "",
      bioMessage: "",
      site: undefined,
      siteMessage: "",
    });
    findBooks(email, c.authorName);
    if (!c.bookWhy && c.bookTitle)
      findBookDetails(email, c.authorName, c.bookTitle);
  }

  // Finds up to 3 books of an author, newest first (recent = last 3 years)
  async function findBooks(key: string, authorName: string) {
    updateAuthor(key, { booksLoading: true, booksMessage: "" });
    try {
      const res = await fetch("/api/author-books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorName }),
      });
      const data = await res.json();
      if (!res.ok) {
        updateAuthor(key, {
          booksLoading: false,
          booksMessage: data.error || "Could not find books.",
        });
        return;
      }
      const list: Book[] = data.books || [];
      const message = !list.length
        ? "No books found. Use Edit to type the book title yourself."
        : data.anyRecent
          ? ""
          : `No book from ${data.minYear} or later was found. The newest one I could find is "${list[0].title}"${list[0].year ? ` (${list[0].year})` : ""}.`;

      setAuthors((current) =>
        current.map((x) => {
          if (x.email !== key) return x;
          const cur = x.result;
          let result = cur;
          let changed = false;
          if (cur && list.length > 0) {
            const picked = list.find((b) => b.title === cur.bookTitle);
            // Keep the pick only if it is recent, or already the newest one
            const keep =
              picked && (picked.recent || picked.title === list[0].title);
            if (!keep) {
              result = {
                ...cur,
                bookTitle: list[0].title,
                bookWhy: list[0].description || "",
              };
              changed = true;
            }
          }
          return {
            ...x,
            booksLoading: false,
            books: list,
            booksMessage: message,
            result,
            ...(changed ? { bookChecked: false } : {}),
          };
        }),
      );
    } catch {
      updateAuthor(key, {
        booksLoading: false,
        booksMessage: "Could not reach the server.",
      });
    }
  }

  // Uses one of the 3 books, then reads its Amazon and Goodreads pages
  function pickBook(key: string, b: Book, authorName: string) {
    updateResult(key, { bookTitle: b.title, bookWhy: b.description });
    updateAuthor(key, { bookMessage: "", bookChecked: false });
    findBookDetails(key, authorName, b.title);
  }

  // Finds the public background of the author
  async function findBio(key: string, authorName: string) {
    updateAuthor(key, { bioLoading: true, bioMessage: "" });
    try {
      const res = await fetch("/api/author-bio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorName }),
      });
      const data = await res.json();
      if (!res.ok) {
        updateAuthor(key, {
          bioLoading: false,
          bioMessage: data.error || "Could not research the background.",
        });
        return;
      }
      updateResult(key, { authorBio: data.bio || "" });
      updateAuthor(key, {
        bioLoading: false,
        bioMessage: data.bio
          ? ""
          : "No background found. Use Edit to type it yourself.",
      });
    } catch {
      updateAuthor(key, {
        bioLoading: false,
        bioMessage: "Could not reach the server.",
      });
    }
  }
  // Checks that an email address looks real
  function validEmail(s: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  // Where the email will be sent
  function recipientOf(a: Author) {
    return (a.sendTo ?? (a.byName ? "" : a.email)).trim();
  }

  // Sending is allowed when the address is valid, and the match is exact
  // or you chose the address yourself
  // True when the last check said this address is bad
  function isBlocked(a: Author) {
    return (
      !!a.emailCheck &&
      a.emailCheck.for === recipientOf(a) &&
      a.emailCheck.level === "bad"
    );
  }

  // Sending is allowed when the address is valid and not blocked, and the
  // match is exact or you chose the address yourself
  function canSend(a: Author) {
    if (!validEmail(recipientOf(a))) return false;
    if (isBlocked(a)) return false;
    return a.result?.matchType === "exact" || a.sendTo !== undefined;
  }
  // Looks for the author's own website and its contact form
  async function findSite(key: string, authorName: string, bookTitle: string) {
    updateAuthor(key, { siteLoading: true, siteMessage: "", site: undefined });
    try {
      const res = await fetch("/api/find-contact-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorName, bookTitle }),
      });
      const data = await res.json();

      if (!res.ok) {
        updateAuthor(key, {
          siteLoading: false,
          siteMessage: data.error || "Could not look for the website.",
        });
        return;
      }

      const site: Site = {
        website: data.website || "",
        contacts: data.contacts || [],
      };
      updateAuthor(key, {
        siteLoading: false,
        site: site.website ? site : undefined,
        siteMessage: !site.website
          ? `No website found for ${authorName}. Please research it manually.`
          : site.contacts.length === 0
            ? "Found their website, but no contact page. Open it and look for a form."
            : "",
      });
    } catch {
      updateAuthor(key, {
        siteLoading: false,
        siteMessage: "Could not reach the server.",
      });
    }
  }
  // Looks for an author's own public email
  async function findContactFor(
    key: string,
    uploaded: string,
    authorName: string,
    bookTitle: string,
  ) {
    updateAuthor(key, {
      contactLoading: true,
      contactMessage: "",
      contactEmails: undefined,
    });

    try {
      const res = await fetch("/api/find-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorName, bookTitle }),
      });
      const data = await res.json();

      if (!res.ok) {
        updateAuthor(key, {
          contactLoading: false,
          contactMessage: data.error || "Could not search for the email.",
        });
        return;
      }

      const list: { email: string; source: string }[] = data.emails || [];
      if (list.length === 0) {
        updateAuthor(key, {
          contactLoading: false,
          contactMessage: `Email not found for ${authorName}. Please research it manually.`,
        });
        // No email: look for the author's own website and contact form
        findSite(key, authorName, bookTitle);
        return;
      }

      const same = uploaded
        ? list.find((c) => c.email.toLowerCase() === uploaded.toLowerCase())
        : undefined;
      updateAuthor(key, {
        contactLoading: false,
        contactEmails: list,
        contactMessage: same
          ? "✅ The uploaded email was found on this author's own pages, so it really belongs to them."
          : "Open each source page to check it before you choose.",
        ...(same ? { sendTo: uploaded } : {}),
      });
    } catch {
      updateAuthor(key, {
        contactLoading: false,
        contactMessage: "Could not reach the server.",
      });
    }
  }

  function findContactEmail(author: Author) {
    if (!author.result?.authorName) return;
    return findContactFor(
      author.email,
      author.byName ? "" : author.email,
      author.result.authorName,
      author.result.bookTitle,
    );
  }

  // Asks our research route about one author
  async function researchAuthor(
    author: Author,
  ): Promise<"ok" | "rate" | "fail"> {
    updateAuthor(author.email, { status: "loading", message: "" });

    try {
      const res = await fetch(
        author.byName ? "/api/find-author" : "/api/research",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            author.byName
              ? { authorName: author.name, bookHint: author.hint }
              : { email: author.email, name: author.name },
          ),
        },
      );
      const data = await res.json();

      if (!res.ok) {
        updateAuthor(author.email, {
          status: "error",
          message: data.error || "Research failed.",
        });
        return res.status === 429 ? "rate" : "fail";
      }
      updateAuthor(author.email, {
        status: "done",
        result: data,
        approval: undefined,
        editing: false,
      });
      if (data.authorName) findBooks(author.email, data.authorName);

      // For a name search, also look for the author's own email
      if (author.byName && data.authorName) {
        await findContactFor(
          author.email,
          "",
          data.authorName,
          data.bookTitle || "",
        );
      }
      return "ok";
    } catch {
      updateAuthor(author.email, {
        status: "error",
        message: "Could not reach the server.",
      });
      return "fail";
    }
  }

  // Adds an author by typing the name, then researches it
  // Adds an author by name, then researches it
  async function addByName(rawName: string, after?: string, hint?: string) {
    const name = rawName.trim();
    if (name.length < 3) {
      setError("Type the author's full name first.");
      return;
    }
    const key = "name:" + name.toLowerCase();
    if (authors.some((a) => a.email === key)) {
      setError("This author is already in your list.");
      return;
    }
    setError("");
    const author: Author = {
      email: key,
      name,
      status: "idle",
      byName: true,
      hint: hint || undefined,
    };
    setAuthors((current) => {
      // Put the new card right under the one it came from
      const i = after ? current.findIndex((x) => x.email === after) : -1;
      if (i === -1) return [...current, author];
      const copy = [...current];
      copy.splice(i + 1, 0, author);
      return copy;
    });
    await researchAuthor(author);
  }

  // The "Search" button in the search box
  function searchByName() {
    const n = nameQuery;
    if (n.trim().length >= 3) setNameQuery("");
    return addByName(n);
  }

  // True when this author is already a card in the list
  function listedByName(name: string) {
    return authors.some((x) => x.email === "name:" + name.trim().toLowerCase());
  }

  // Researches a list of authors, two at a time
  async function researchList(todo: Author[], ask = false) {
    if (todo.length === 0) {
      setResearchProgress("Nothing to research.");
      return;
    }
    if (
      ask &&
      !confirm(
        `Research ${todo.length} authors? Keep this tab open until it finishes.`,
      )
    )
      return;

    const WORKERS = 2; // set to 1 if you often see "Rate limit reached"
    stopResearchRef.current = false;
    setResearchingAll(true);
    let ok = 0;
    let failed = 0;
    let finished = 0;
    let next = 0;

    const worker = async (startDelay: number) => {
      await wait(startDelay);
      while (!stopResearchRef.current) {
        const i = next++;
        if (i >= todo.length) break;
        setResearchProgress(`Researching ${finished + 1} of ${todo.length}…`);

        let result = await researchAuthor(todo[i]);

        // If we hit the rate limit, wait a little and try once more
        if (result === "rate" && !stopResearchRef.current) {
          setResearchProgress("Rate limit reached. Waiting 40 seconds…");
          await wait(40000);
          if (!stopResearchRef.current) result = await researchAuthor(todo[i]);
        }

        if (result === "ok") ok++;
        else failed++;
        finished++;
        setResearchProgress(`Done ${finished} of ${todo.length}…`);
      }
    };

    await Promise.all(
      Array.from({ length: WORKERS }, (_, k) => worker(k * 1500)),
    );

    setResearchingAll(false);
    setResearchProgress(
      stopResearchRef.current
        ? `Stopped. ${ok} researched, ${failed} failed.`
        : `Finished. ${ok} researched, ${failed} failed.`,
    );
  }

  // The "Research all" button
  function researchAll() {
    setError("");
    return researchList(
      authors.filter((a) => a.status === "idle" || a.status === "error"),
      true,
    );
  }

  // Adds many author names at once, then researches them
  async function addNames() {
    const MAX_NAMES = 30;
    const lines = namesPasted
      .split("\n")
      .map((l) => l.replace(/^[\s\d.)\-•*]+/, "").trim())
      .filter((l) => l.length >= 3 && !l.includes("@"));

    const seen = new Set<string>();
    const names: string[] = [];
    for (const l of lines) {
      const k = l.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        names.push(l);
      }
    }
    if (names.length === 0) {
      setError("No author names found in the box.");
      return;
    }

    const existing = new Set(authors.map((a) => a.email));
    const notListed = names.filter(
      (n) => !existing.has("name:" + n.toLowerCase()),
    );
    if (notListed.length === 0) {
      setError("These authors are already in your list.");
      return;
    }

    const fresh = notListed.slice(0, MAX_NAMES);
    const newOnes: Author[] = fresh.map((n) => ({
      email: "name:" + n.toLowerCase(),
      name: n,
      status: "idle",
      byName: true,
    }));

    setError(
      notListed.length > MAX_NAMES
        ? `Only the first ${MAX_NAMES} names were added. Add the rest in a second round.`
        : "",
    );
    setAuthors((current) => [...current, ...newOnes]);
    setNamesPasted("");
    await researchList(newOnes);
  }

  // Changes the email draft of one author (used when you edit it)
  function updateDraft(email: string, changes: Partial<Draft>) {
    setAuthors((current) =>
      current.map((a) =>
        a.email === email && a.draft
          ? { ...a, draft: { ...a.draft, ...changes } }
          : a,
      ),
    );
  }

  async function fillTemplate(
    author: Author,
    facts?: { bookWhy: string; authorBio: string },
  ) {
    if (!author.result) return;
    if (!subjectTemplate.trim() || !bodyTemplate.trim()) {
      setError("Your template is empty. Add a subject and a message first.");
      return;
    }
    setError("");
    updateAuthor(author.email, { writing: true });

    const { authorName, bookTitle } = author.result;
    const bookWhy = facts?.bookWhy ?? author.result.bookWhy;
    const bio = facts?.authorBio ?? author.result.authorBio ?? "";
    const details: Record<string, string> = {};

    // Ask Gemini to write every other [bracket] in your template
    const slots = findAiSlots(subjectTemplate + "\n" + bodyTemplate);
    if (slots.length > 0 && (bookWhy || bio)) {
      try {
        const res = await fetch("/api/fill-detail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            template: bodyTemplate,
            placeholders: slots,
            authorName,
            bookTitle,
            bookWhy,
            authorBio: bio,
          }),
        });
        const data = await res.json();
        if (res.ok && Array.isArray(data.details)) {
          slots.forEach((s, i) => {
            details[s] = String(data.details[i] ?? "");
          });
        }
      } catch {}
    }

    const vals = { authorName, bookTitle, details };
    updateAuthor(author.email, {
      writing: false,
      draft: {
        subject: fillText(subjectTemplate, vals),
        body: fillText(bodyTemplate, vals),
      },
    });
  }

  // Fills the template for every approved author, one after the other
  async function fillAllApproved() {
    for (const a of authors) {
      if (a.approval === "approved" && !a.draft) {
        await fillTemplate(a);
      }
    }
  }
  // Removes one author from the list
  function removeAuthor(a: Author) {
    if (
      a.sendStatus !== "sent" &&
      !confirm(`Remove ${a.byName ? a.name : a.email} from the list?`)
    )
      return;
    setAuthors((current) => current.filter((x) => x.email !== a.email));
  }

  // Removes every author that was already sent
  function clearSent() {
    setAuthors((current) => current.filter((x) => x.sendStatus !== "sent"));
  }

  // Checks if the address can receive email (reuses a check already made)
  async function runEmailCheck(a: Author): Promise<EmailCheck> {
    const address = recipientOf(a);
    if (
      a.emailCheck &&
      a.emailCheck.for === address &&
      a.emailCheck.level !== "warn"
    ) {
      return a.emailCheck;
    }
    updateAuthor(a.email, { checking: true });
    let check: EmailCheck;
    try {
      const res = await fetch("/api/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address }),
      });
      const data = await res.json();
      check = {
        for: address,
        level: data.level ?? "warn",
        message: data.message ?? "",
        suggestion: data.suggestion,
      };
    } catch {
      check = {
        for: address,
        level: "warn",
        message: "Could not check this address right now.",
      };
    }
    updateAuthor(a.email, { checking: false, emailCheck: check });
    return check;
  }
  // Gets book facts from the web (does not touch the screen)
  async function fetchBookFacts(authorName: string, bookTitle: string) {
    try {
      const res = await fetch("/api/research-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorName, bookTitle }),
      });
      const data = await res.json();
      if (!res.ok) return null;
      return {
        bookWhy: String(data.bookWhy || ""),
        sources: (data.sources || []) as Source[],
      };
    } catch {
      return null;
    }
  }

  // Gets the author's background from the web (does not touch the screen)
  async function fetchBio(authorName: string) {
    try {
      const res = await fetch("/api/author-bio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorName }),
      });
      const data = await res.json();
      if (!res.ok) return null;
      return String(data.bio || "");
    } catch {
      return null;
    }
  }

  // After you approve: read the book pages and the background at the same
  // time, then fill the template automatically
  async function prepareAuthor(a: Author) {
    const r = a.result;
    if (!r) return;
    if (!subjectTemplate.trim() || !bodyTemplate.trim()) {
      setError("Your template is empty. Add a subject and a message first.");
      return;
    }
    updateAuthor(a.email, { writing: true });

    let bookWhy = r.bookWhy;
    let bio = r.authorBio || "";
    let newSources: Source[] = [];
    let checked = !!a.bookChecked;

    const needs = findAiSlots(subjectTemplate + "\n" + bodyTemplate).length > 0;
    if (needs) {
      const [book, bioText] = await Promise.all([
        !a.bookChecked && r.bookTitle
          ? fetchBookFacts(r.authorName, r.bookTitle)
          : null,
        !bio && r.authorName ? fetchBio(r.authorName) : null,
      ]);
      if (book) {
        bookWhy = book.bookWhy || bookWhy;
        newSources = book.sources;
        checked = true;
      }
      if (bioText) bio = bioText;

      setAuthors((current) =>
        current.map((x) => {
          if (x.email !== a.email || !x.result) return x;
          const have = new Set(x.result.sources.map((s) => s.url));
          return {
            ...x,
            bookChecked: checked,
            result: {
              ...x.result,
              bookWhy,
              authorBio: bio,
              sources: [
                ...x.result.sources,
                ...newSources.filter((s) => !have.has(s.url)),
              ],
            },
          };
        }),
      );
    }

    await fillTemplate(a, { bookWhy, authorBio: bio });
  }

  const MAX_PER_RUN = 30;

  function hasPlaceholder(d: Draft) {
    return /\[[^\]]+\]/.test(d.subject + d.body);
  }

  // Sends one email. Returns true if it worked.
  async function sendOne(author: Author, test = false): Promise<boolean> {
    if (!author.draft) return false;

    if (hasPlaceholder(author.draft)) {
      setError(
        `The draft for ${author.email} still has a placeholder like [Book Title]. Fix it first.`,
      );
      return false;
    }

    setError("");
    if (!test) {
      const check = await runEmailCheck(author);
      if (check.level === "bad") {
        updateAuthor(author.email, {
          sendStatus: "failed",
          sendError: check.message,
        });
        return false;
      }
      updateAuthor(author.email, { sendStatus: "sending", sendError: "" });
    }

    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: recipientOf(author),
          subject: author.draft.subject,
          body: author.draft.body,
          test,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (test) setError(data.error || "Could not send the test.");
        else
          updateAuthor(author.email, {
            sendStatus: "failed",
            sendError: data.error || "Could not send.",
          });
        return false;
      }

      if (test) {
        setProgress("✅ Test email sent to your own inbox. Go and check it.");
        return true;
      }
      addSent(recipientOf(author));
      updateAuthor(author.email, { sendStatus: "sent" });
      return true;
    } catch {
      if (test) setError("Could not reach the server.");
      else
        updateAuthor(author.email, {
          sendStatus: "failed",
          sendError: "Could not reach the server.",
        });
      return false;
    }
  }

  // The "Send to author" button
  async function sendOneClick(author: Author) {
    if (!canSend(author)) {
      setError(
        "Choose where to send first: find this author's own email, or click 'Keep uploaded email'.",
      );
      return;
    }
    const to = recipientOf(author);
    if (
      wasSent(to) &&
      !confirm("You already emailed this address before. Send again?")
    )
      return;
    if (!confirm(`Send this email to ${to}?`)) return;
    await sendOne(author);
  }

  // Sends every approved author, slowly, one after the other
  async function sendAllApproved() {
    const todo = authors.filter(
      (a) =>
        a.approval === "approved" &&
        a.draft &&
        canSend(a) &&
        a.sendStatus !== "sent" &&
        !wasSent(recipientOf(a)),
    );
    if (todo.length === 0) {
      setProgress("Nothing to send.");
      return;
    }

    const batch = todo.slice(0, MAX_PER_RUN);
    if (
      !confirm(
        `Send ${batch.length} emails now? Keep this tab open until it finishes.`,
      )
    )
      return;

    stopRef.current = false;
    setSendingAll(true);
    setError("");
    let done = 0;

    for (let i = 0; i < batch.length; i++) {
      if (stopRef.current) break;
      setProgress(
        `Sending ${i + 1} of ${batch.length} to ${recipientOf(batch[i])}...`,
      );
      const ok = await sendOne(batch[i]);
      if (ok) done++;

      // Wait 20 to 45 seconds before the next one
      if (i < batch.length - 1) {
        const secs = 10 + Math.floor(Math.random() * 11);
        for (let s = secs; s > 0 && !stopRef.current; s--) {
          setProgress(
            `Sent ${done} of ${batch.length}. Next email in ${s}s...`,
          );
          await wait(1000);
        }
      }
    }

    setSendingAll(false);
    setProgress(
      stopRef.current
        ? `Stopped. ${done} emails were sent.`
        : `Done. ${done} emails were sent.`,
    );
  }

  // Numbers for the top of the page
  const approvedCount = authors.filter((a) => a.approval === "approved").length;
  const sentCount = authors.filter((a) => a.sendStatus === "sent").length;
  const researchedCount = authors.filter((a) => a.status === "done").length;
  const todoResearch = authors.filter(
    (a) => a.status === "idle" || a.status === "error",
  ).length;
  const needFill = authors.filter(
    (a) => a.approval === "approved" && !a.draft,
  ).length;
  const readyToSend = authors.filter(
    (a) =>
      a.approval === "approved" &&
      a.draft &&
      canSend(a) &&
      a.sendStatus !== "sent",
  ).length;

  const steps = [
    { n: 1, label: "Add authors", on: true },
    { n: 2, label: "Research", on: authors.length > 0 },
    { n: 3, label: "Approve", on: researchedCount > 0 },
    { n: 4, label: "Send", on: approvedCount > 0 },
  ];

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-700 font-extrabold text-white">
            AO
          </div>
          <div>
            <h1 className="text-2xl font-extrabold">Author Outreach</h1>
            <p className="text-sm text-gray-600">
              Research authors. Send personal emails.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`${BADGE} bg-violet-100 text-violet-900`}>
            {authors.length} authors
          </span>
          <span className={`${BADGE} bg-violet-100 text-violet-900`}>
            {approvedCount} approved
          </span>
          <span className={`${BADGE} bg-violet-100 text-violet-900`}>
            {sentCount} sent
          </span>
        </div>
      </header>

      {/* Steps */}
      <div className={`${CARD} flex flex-wrap gap-x-8 gap-y-3 py-4`}>
        {steps.map((s) => (
          <div
            key={s.n}
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${
                s.on
                  ? "bg-violet-700 text-white"
                  : "bg-violet-100 text-violet-900"
              }`}
            >
              {s.n}
            </span>
            {s.label}
          </div>
        ))}
      </div>

      {/* Add authors + template */}
      <div className="grid gap-6 md:grid-cols-2">
        <section className={`${CARD} space-y-4`}>
          <div>
            <h2 className="text-lg font-bold">Add authors</h2>
            <p className="text-sm text-gray-600">
              Upload a CSV or paste emails.
            </p>
          </div>
          <div>
            <label htmlFor="byname" className={LABEL}>
              Search by author name
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="byname"
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") searchByName();
                }}
                placeholder="Example: Kathryn Andrews"
                className={`${INPUT} min-w-[14rem] flex-1`}
              />
              <button onClick={searchByName} className={BTN}>
                Search
              </button>
            </div>

            <p className="mt-1 text-xs text-gray-600">
              Finds the author, their best-known book and a public email.
            </p>
          </div>
          <div>
            <label htmlFor="bulknames" className={LABEL}>
              Search many authors by name (one name per line, up to 30)
            </label>
            <textarea
              id="bulknames"
              value={namesPasted}
              onChange={(e) => setNamesPasted(e.target.value)}
              rows={4}
              placeholder={"Kathryn Andrews\nJohn Van Stry\nPam Russ"}
              className={INPUT}
            />
            <button onClick={addNames} className={`${BTN} mt-2`}>
              Add names and research
            </button>
            <p className="mt-1 text-xs text-gray-600">
              Each name: finds the author, their books, their Amazon page, an
              email, and a website contact form if there is no email.
            </p>
          </div>

          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) parseCsv(f);
            }}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-violet-300 bg-violet-50/60 p-6 text-center"
          >
            <span className="font-semibold">Drop a CSV file here</span>
            <span className="text-sm text-gray-600">
              Needs an <b>email</b> column. A <b>name</b> column is optional.
            </span>
            <input
              type="file"
              accept=".csv"
              onChange={handleFile}
              className="sr-only"
            />
            <span className="rounded-lg border border-violet-300 bg-white px-4 py-2 text-sm font-semibold text-violet-700">
              Choose file
            </span>
          </label>

          <div>
            <label htmlFor="paste" className={LABEL}>
              Or paste emails (one per line, name after the email is optional)
            </label>
            <textarea
              id="paste"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={4}
              placeholder={"jane@example.com Jane Doe\njohn@example.com"}
              className={INPUT}
            />
          </div>
          <button onClick={handlePaste} className={BTN}>
            Add emails
          </button>
        </section>

        <section className={`${CARD} space-y-3`}>
          <div>
            <h2 className="text-lg font-bold">Your email template</h2>
            <p className="text-sm text-gray-600">
              Saved in your browser. Edit it anytime.
            </p>
          </div>

          <div>
            <label htmlFor="subject" className={LABEL}>
              Subject
            </label>
            <input
              id="subject"
              value={subjectTemplate}
              onChange={(e) => setSubjectTemplate(e.target.value)}
              placeholder="Subject line"
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="message" className={LABEL}>
              Message
            </label>
            <textarea
              id="message"
              value={bodyTemplate}
              onChange={(e) => handleBodyChange(e.target.value)}
              rows={10}
              className={INPUT}
            />
          </div>

          <p className="text-xs text-gray-600">
            Placeholders: [Author Name], [First Name], [Book Title], and [Insert
            1 specific detail: ...] (the AI fills this one). Paste a full email
            that starts with &quot;Subject:&quot; and the subject splits off for
            you.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <label className={`${BTN_OUT} cursor-pointer`}>
              Upload .txt
              <input
                type="file"
                accept=".txt"
                onChange={handleTemplateFile}
                className="sr-only"
              />
            </label>
            <button
              onClick={() => {
                setSubjectTemplate(DEFAULT_SUBJECT);
                setBodyTemplate(DEFAULT_BODY);
              }}
              className="text-sm font-semibold text-gray-600 underline"
            >
              Reset to the example
            </button>
          </div>
          <button onClick={fillAllApproved} className={BTN}>
            Fill template for all approved ({needFill})
          </button>
        </section>
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {/* Authors */}
      <section className={`${CARD} space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Authors</h2>
          {authors.length > 0 && (
            <div className="flex flex-wrap items-center gap-4">
              {sentCount > 0 && (
                <button
                  onClick={clearSent}
                  className="text-sm font-semibold text-violet-700 underline"
                >
                  Remove sent ({sentCount})
                </button>
              )}
              <button
                onClick={() => {
                  if (confirm("Remove all authors, research and drafts?"))
                    setAuthors([]);
                }}
                className="text-sm font-semibold text-red-700 underline"
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {authors.length === 0 && (
          <p className="rounded-xl bg-violet-50 p-6 text-center text-sm text-gray-600">
            No authors yet. Upload a CSV or paste some emails above.
          </p>
        )}

        {authors.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={researchAll}
                disabled={researchingAll}
                className={BTN}
              >
                Research all ({todoResearch} to do)
              </button>
              {researchingAll && (
                <button
                  onClick={() => {
                    stopResearchRef.current = true;
                  }}
                  className={BTN_STOP}
                >
                  Stop
                </button>
              )}
              {researchProgress && (
                <span className="text-sm text-gray-600">
                  {researchProgress}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={sendAllApproved}
                disabled={sendingAll}
                className={BTN_OUT}
              >
                Send all approved ({readyToSend} ready)
              </button>
              {sendingAll && (
                <button
                  onClick={() => {
                    stopRef.current = true;
                  }}
                  className={BTN_STOP}
                >
                  Stop
                </button>
              )}
              {progress && (
                <span className="text-sm text-gray-600">{progress}</span>
              )}
            </div>
          </div>
        )}

        {authors.map((a, i) => {
          const r = a.result;
          const badge = statusBadge(a);

          return (
            <article
              key={a.email}
              className="rounded-2xl border border-violet-100 bg-white p-5"
            >
              {/* Top row */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-all font-semibold">
                    {a.byName ? a.name : a.email}
                  </p>
                  <p className="text-sm text-gray-600">
                    #{i + 1}
                    {a.name && !a.byName ? ` · ${a.name}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`${BADGE} ${badge.cls}`}>{badge.text}</span>
                  {a.approval === "approved" && (
                    <span className={`${BADGE} bg-green-100 text-green-800`}>
                      Approved
                    </span>
                  )}
                  {a.approval === "rejected" && (
                    <span className={`${BADGE} bg-red-100 text-red-800`}>
                      Rejected
                    </span>
                  )}
                  {a.sendStatus === "sent" && (
                    <span className={`${BADGE} bg-green-100 text-green-800`}>
                      Sent
                    </span>
                  )}
                  <button
                    onClick={() => researchAuthor(a)}
                    disabled={a.status === "loading"}
                    className={BTN_OUT}
                  >
                    {a.status === "loading"
                      ? "Researching…"
                      : a.status === "done"
                        ? "Redo"
                        : "Research"}
                  </button>
                  {a.sendStatus === "sent" && (
                    <button
                      onClick={() => updateAuthor(a.email, { open: !a.open })}
                      className={BTN_OUT}
                    >
                      {a.open ? "Hide details" : "Show details"}
                    </button>
                  )}
                  <button
                    onClick={() => removeAuthor(a)}
                    className={a.sendStatus === "sent" ? BTN : BTN_OUT}
                  >
                    {a.sendStatus === "sent" ? "Done, remove" : "Remove"}
                  </button>
                </div>
              </div>

              {a.status === "error" && (
                <p className="mt-3 text-sm text-red-700">{a.message}</p>
              )}

              {/* Result */}
              {a.status === "done" &&
                r &&
                (a.sendStatus !== "sent" || a.open) && (
                  <div className="mt-4 space-y-3 rounded-xl bg-violet-50 p-4 text-sm">
                    {r.matchType === "exact" && (
                      <p className="font-semibold text-green-800">
                        This email was found in the search results.
                      </p>
                    )}
                    {r.matchType === "possible" && (
                      <p className="font-semibold text-amber-900">
                        {a.byName
                          ? "Found by searching the author's name. Check the sources, because other authors may share this name."
                          : "The exact email was not found. These are possible authors with a similar name. Please check the sources before you trust this."}
                      </p>
                    )}
                    {r.matchType === "none" && (
                      <p className="font-semibold text-red-800">
                        No author found for this email.
                      </p>
                    )}

                    {r.authorName && (
                      <div className="space-y-1">
                        <p className="text-base">
                          <b>
                            {r.matchType === "possible"
                              ? "Best guess:"
                              : "Author:"}
                          </b>{" "}
                          {r.authorName}{" "}
                          <span className="text-xs text-gray-600">
                            (confidence: {r.confidence})
                          </span>
                        </p>
                        {(r.profiles?.amazon || r.profiles?.goodreads) && (
                          <p className="text-sm">
                            <b>Author pages:</b>{" "}
                            {r.profiles?.amazon && (
                              <a
                                href={r.profiles.amazon}
                                target="_blank"
                                rel="noreferrer"
                                className="text-violet-700 underline"
                              >
                                Amazon
                              </a>
                            )}
                            {r.profiles?.amazon &&
                              r.profiles?.goodreads &&
                              " · "}
                            {r.profiles?.goodreads && (
                              <a
                                href={r.profiles.goodreads}
                                target="_blank"
                                rel="noreferrer"
                                className="text-violet-700 underline"
                              >
                                Goodreads
                              </a>
                            )}
                          </p>
                        )}
                        {r.bookTitle && (
                          <p>
                            <b>Book:</b> {r.bookTitle}
                          </p>
                        )}
                        {(() => {
                          const picked = a.books?.find(
                            (b) => b.title === r.bookTitle,
                          );
                          if (!picked) return null;
                          const newest = a.books?.[0];
                          if (picked.recent)
                            return (
                              <p className="text-sm font-semibold text-green-800">
                                Published {picked.year}
                              </p>
                            );
                          if (newest && newest.title !== picked.title)
                            return (
                              <p className="text-sm font-semibold text-amber-900">
                                This book is from{" "}
                                {picked.year || "an unknown year"}, but a newer
                                one is in the list below: {newest.title}
                                {newest.year ? ` (${newest.year})` : ""}.
                              </p>
                            );
                          return (
                            <p className="text-sm font-semibold text-amber-900">
                              Published in {picked.year || "an unknown year"}.
                              No newer book was found, so this is the most
                              recent one I could find.
                            </p>
                          );
                        })()}
                        {r.bookWhy && (
                          <details>
                            <summary className="cursor-pointer font-semibold">
                              Book details
                            </summary>
                            <p className="mt-1">{r.bookWhy}</p>
                          </details>
                        )}
                        {a.bookMessage && (
                          <p className="text-violet-800">{a.bookMessage}</p>
                        )}
                        {r.bookTitle && !r.bookWhy && (
                          <p className="text-gray-600">
                            No details about this book yet.
                            <button
                              onClick={() =>
                                findBookDetails(
                                  a.email,
                                  r.authorName,
                                  r.bookTitle,
                                )
                              }
                              disabled={a.bookLoading}
                              className={`${BTN_SM} ml-2`}
                            >
                              {a.bookLoading
                                ? "Searching…"
                                : "Find book details"}
                            </button>
                          </p>
                        )}
                      </div>
                    )}
                    {r.authorName && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <b>Pick the book to write about</b>
                          <button
                            onClick={() => findBooks(a.email, r.authorName)}
                            disabled={a.booksLoading}
                            className={BTN_SM}
                          >
                            {a.booksLoading
                              ? "Searching…"
                              : a.books
                                ? "Search again"
                                : "Find books"}
                          </button>
                        </div>
                        {a.booksMessage && (
                          <p className="text-gray-600">{a.booksMessage}</p>
                        )}
                        {a.books?.map((b, n) => (
                          <div
                            key={n}
                            className="rounded-lg border border-violet-200 bg-white p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="font-semibold">
                                {b.title}
                                {b.year ? ` (${b.year})` : ""}
                              </p>
                              {r.bookTitle === b.title ? (
                                <span
                                  className={`${BADGE} bg-green-100 text-green-800`}
                                >
                                  Selected
                                </span>
                              ) : (
                                <button
                                  onClick={() =>
                                    pickBook(a.email, b, r.authorName)
                                  }
                                  className={BTN_SM}
                                >
                                  Use this book
                                </button>
                              )}
                            </div>
                            {b.subtitle && (
                              <p className="text-gray-600">{b.subtitle}</p>
                            )}
                            {b.description && (
                              <p className="mt-1 text-gray-600">
                                {b.description.slice(0, 220)}
                                {b.description.length > 220 ? "…" : ""}
                              </p>
                            )}
                            <p className="mt-1 text-xs text-gray-500">
                              Source:{" "}
                              {b.link ? (
                                <a
                                  href={b.link}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-violet-700 underline"
                                >
                                  {b.source}
                                </a>
                              ) : (
                                b.source
                              )}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {r.authorName && (
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <b>Author background</b>
                          <button
                            onClick={() => findBio(a.email, r.authorName)}
                            disabled={a.bioLoading}
                            className={BTN_SM}
                          >
                            {a.bioLoading
                              ? "Searching…"
                              : r.authorBio
                                ? "Search again"
                                : "Find background"}
                          </button>
                        </div>
                        {r.authorBio && <p>{r.authorBio}</p>}
                        {a.bioMessage && (
                          <p className="text-gray-600">{a.bioMessage}</p>
                        )}
                      </div>
                    )}

                    {r.notes && <p className="text-gray-600">{r.notes}</p>}

                    {r.candidates.length > 0 && (
                      <div>
                        <b>Other authors with a similar name:</b>
                        <ul className="mt-1 list-disc space-y-1 pl-5">
                          {r.candidates.map((c, n) => (
                            <li key={n}>
                              <b>{c.authorName}</b>
                              {c.bookTitle && <> – {c.bookTitle}</>}
                              {c.reason && (
                                <span className="text-gray-600">
                                  {" "}
                                  ({c.reason})
                                </span>
                              )}{" "}
                              <button
                                onClick={() => pickCandidate(a.email, c)}
                                className={BTN_SM}
                              >
                                Use this one
                              </button>{" "}
                              <button
                                onClick={() =>
                                  addByName(c.authorName, a.email, c.bookTitle)
                                }
                                disabled={listedByName(c.authorName)}
                                className={BTN_SM}
                              >
                                {listedByName(c.authorName)
                                  ? "In your list"
                                  : "Research this author"}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Where to send, when the match is not exact */}
                    {r.matchType !== "exact" && r.authorName && (
                      <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
                        {a.byName ? (
                          <p>
                            You searched by name, so there is no uploaded email.
                            Find <b>{r.authorName}</b>&apos;s public email
                            below, or type one you found yourself. Check the
                            sources first, because another author may share this
                            name.
                          </p>
                        ) : (
                          <p>
                            The email you uploaded (<b>{a.email}</b>) was not
                            confirmed as belonging to <b>{r.authorName}</b>. A
                            message sent there may reach someone else.
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => findContactEmail(a)}
                            disabled={a.contactLoading}
                            className={BTN}
                          >
                            {a.contactLoading
                              ? "Searching…"
                              : `Find ${r.authorName}'s own email`}
                          </button>
                          <button
                            onClick={() =>
                              findSite(a.email, r.authorName, r.bookTitle)
                            }
                            disabled={a.siteLoading}
                            className={BTN_OUT}
                          >
                            {a.siteLoading
                              ? "Searching…"
                              : "Find website contact form"}
                          </button>
                          {!a.byName && (
                            <button
                              onClick={() =>
                                updateAuthor(a.email, { sendTo: a.email })
                              }
                              className={BTN_OUT}
                            >
                              Keep uploaded email
                            </button>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            value={a.manualEmail ?? ""}
                            onChange={(e) =>
                              updateAuthor(a.email, {
                                manualEmail: e.target.value,
                              })
                            }
                            placeholder="Found the right email yourself? Type it here"
                            className={`${INPUT} min-w-[16rem] flex-1`}
                          />
                          <button
                            onClick={() => {
                              const v = (a.manualEmail ?? "").trim();
                              if (!validEmail(v)) {
                                updateAuthor(a.email, {
                                  contactMessage:
                                    "That email does not look right. Please check it and try again.",
                                });
                                return;
                              }
                              updateAuthor(a.email, {
                                sendTo: v,
                                contactMessage: `✅ Using ${v}, the email you added yourself.`,
                              });
                            }}
                            className={BTN_OUT}
                          >
                            Use this email
                          </button>
                        </div>

                        {a.contactMessage && (
                          <p className="font-semibold text-violet-900">
                            {a.contactMessage}
                          </p>
                        )}

                        {a.contactEmails && a.contactEmails.length > 0 && (
                          <ul className="list-disc space-y-1 pl-5">
                            {a.contactEmails.map((c, n) => (
                              <li key={n}>
                                <b>{c.email}</b>{" "}
                                <a
                                  href={c.source}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-violet-700 underline"
                                >
                                  (where it was found)
                                </a>{" "}
                                <button
                                  onClick={() =>
                                    updateAuthor(a.email, { sendTo: c.email })
                                  }
                                  className={BTN_SM}
                                >
                                  Send to this email
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}

                        {a.siteMessage && (
                          <p className="font-semibold text-violet-900">
                            {a.siteMessage}
                          </p>
                        )}

                        {a.site && (
                          <div className="space-y-1">
                            <p>
                              <b>Author&apos;s website:</b>{" "}
                              <a
                                href={a.site.website}
                                target="_blank"
                                rel="noreferrer"
                                className="text-violet-700 underline"
                              >
                                {a.site.website}
                              </a>
                            </p>
                            {a.site.contacts.length > 0 && (
                              <>
                                <p className="font-semibold">
                                  Contact pages on their own website:
                                </p>
                                <ul className="list-disc space-y-1 pl-5">
                                  {a.site.contacts.map((c, n) => (
                                    <li key={n}>
                                      <a
                                        href={c.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-violet-700 underline"
                                      >
                                        {c.url}
                                      </a>{" "}
                                      <span className="text-xs text-gray-600">
                                        {c.form
                                          ? "(looks like a contact form)"
                                          : "(contact page, check for a form)"}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                                <p className="text-xs text-gray-600">
                                  Click Fill template, then use Copy email text
                                  under the draft and paste it into the form.
                                </p>
                              </>
                            )}
                          </div>
                        )}

                        <p className="font-semibold">
                          {a.sendTo !== undefined
                            ? `Will send to: ${a.sendTo || "(empty)"}`
                            : "No send address chosen yet."}
                        </p>
                      </div>
                    )}

                    {/* Sources */}
                    {r.sources.length > 0 && (
                      <details>
                        <summary className="cursor-pointer font-semibold">
                          Sources ({r.sources.length})
                        </summary>
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                          {r.sources.map((s, n) => (
                            <li key={n}>
                              <a
                                href={s.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-violet-700 underline"
                              >
                                {s.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}

                    {/* Edit form */}
                    {a.editing && (
                      <div className="space-y-3 rounded-xl border border-violet-200 bg-white p-4">
                        <div>
                          <label className={LABEL}>Author name</label>
                          <input
                            value={r.authorName}
                            onChange={(e) =>
                              updateResult(a.email, {
                                authorName: e.target.value,
                              })
                            }
                            className={INPUT}
                          />
                        </div>
                        <div>
                          <label className={LABEL}>Book title</label>
                          <input
                            value={r.bookTitle}
                            onChange={(e) =>
                              updateResult(a.email, {
                                bookTitle: e.target.value,
                              })
                            }
                            className={INPUT}
                          />
                        </div>
                        <div>
                          <label className={LABEL}>Book details</label>
                          <textarea
                            value={r.bookWhy}
                            onChange={(e) =>
                              updateResult(a.email, { bookWhy: e.target.value })
                            }
                            rows={3}
                            className={INPUT}
                          />
                        </div>
                        <div>
                          <label className={LABEL}>Author background</label>
                          <textarea
                            value={r.authorBio ?? ""}
                            onChange={(e) =>
                              updateResult(a.email, {
                                authorBio: e.target.value,
                              })
                            }
                            rows={3}
                            className={INPUT}
                          />
                        </div>
                      </div>
                    )}

                    {/* Yes / No / Edit */}
                    <div className="flex flex-wrap items-center gap-2 border-t border-violet-100 pt-3">
                      <button
                        onClick={() => {
                          updateAuthor(a.email, {
                            approval: "approved",
                            editing: false,
                          });
                          if (!a.draft) prepareAuthor(a);
                        }}
                      >
                        Yes, correct
                      </button>
                      <button
                        onClick={() => {
                          updateAuthor(a.email, {
                            approval: "approved",
                            editing: false,
                          });
                          if (r.bookTitle && !r.bookWhy && !a.bookLoading)
                            findBookDetails(a.email, r.authorName, r.bookTitle);
                          if (r.authorName && !r.authorBio && !a.bioLoading)
                            findBio(a.email, r.authorName);
                        }}
                        className={BTN_OUT}
                      >
                        No
                      </button>
                      <button
                        onClick={() =>
                          updateAuthor(a.email, { editing: !a.editing })
                        }
                        className={BTN_OUT}
                      >
                        {a.editing ? "Close edit" : "Edit"}
                      </button>
                    </div>

                    {/* Email draft */}
                    {a.approval === "approved" && (
                      <div className="space-y-3 border-t border-violet-100 pt-3">
                        <button
                          onClick={() => fillTemplate(a)}
                          disabled={a.writing}
                          className={BTN}
                        >
                          {a.writing
                            ? "Filling…"
                            : a.draft
                              ? "Fill again (resets edits)"
                              : "Fill template"}
                        </button>

                        {a.draft && (
                          <div className="space-y-3 rounded-xl border border-violet-200 bg-white p-4">
                            <div>
                              <label className={LABEL}>To</label>
                              <input
                                value={a.sendTo ?? (a.byName ? "" : a.email)}
                                onChange={(e) =>
                                  updateAuthor(a.email, {
                                    sendTo: e.target.value,
                                  })
                                }
                                className={INPUT}
                              />
                              {!validEmail(recipientOf(a)) && (
                                <p className="mt-1 text-sm text-red-700">
                                  This email address does not look valid.
                                </p>
                              )}
                              {!a.byName &&
                                a.sendTo !== undefined &&
                                a.sendTo.trim().toLowerCase() !==
                                  a.email.toLowerCase() && (
                                  <p className="mt-1 text-xs text-gray-600">
                                    Changed from the uploaded email ({a.email}).
                                  </p>
                                )}
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <button
                                  onClick={() => runEmailCheck(a)}
                                  disabled={a.checking}
                                  className={BTN_SM}
                                >
                                  {a.checking
                                    ? "Checking…"
                                    : "Check email address"}
                                </button>
                                {a.emailCheck &&
                                  a.emailCheck.for === recipientOf(a) && (
                                    <span
                                      className={`text-sm font-semibold ${
                                        a.emailCheck.level === "ok"
                                          ? "text-green-700"
                                          : a.emailCheck.level === "warn"
                                            ? "text-amber-800"
                                            : "text-red-700"
                                      }`}
                                    >
                                      {a.emailCheck.level === "ok"
                                        ? "✅"
                                        : a.emailCheck.level === "warn"
                                          ? "⚠️"
                                          : "⛔"}{" "}
                                      {a.emailCheck.message}
                                    </span>
                                  )}
                                {a.emailCheck?.suggestion &&
                                  a.emailCheck.for === recipientOf(a) && (
                                    <button
                                      onClick={() =>
                                        updateAuthor(a.email, {
                                          sendTo: a.emailCheck?.suggestion,
                                        })
                                      }
                                      className={BTN_SM}
                                    >
                                      Use {a.emailCheck.suggestion}
                                    </button>
                                  )}
                              </div>
                            </div>

                            {/\[[^\]]+\]/.test(
                              a.draft.subject + a.draft.body,
                            ) && (
                              <p className="rounded-lg bg-amber-100 p-2 text-amber-900">
                                Some placeholders are still not filled (like{" "}
                                {
                                  (a.draft.subject + a.draft.body).match(
                                    /\[[^\]]+\]/,
                                  )?.[0]
                                }
                                ). Please fix them by hand below before sending.
                              </p>
                            )}

                            <div>
                              <label className={LABEL}>Subject</label>
                              <input
                                value={a.draft.subject}
                                onChange={(e) =>
                                  updateDraft(a.email, {
                                    subject: e.target.value,
                                  })
                                }
                                className={INPUT}
                              />
                            </div>
                            <div>
                              <label className={LABEL}>Email</label>
                              <textarea
                                value={a.draft.body}
                                onChange={(e) =>
                                  updateDraft(a.email, { body: e.target.value })
                                }
                                rows={14}
                                className={INPUT}
                              />
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                onClick={() => sendOne(a, true)}
                                className={BTN_OUT}
                              >
                                Send test to me
                              </button>
                              <button
                                onClick={() => sendOneClick(a)}
                                disabled={
                                  a.sendStatus === "sending" ||
                                  a.sendStatus === "sent" ||
                                  !canSend(a)
                                }
                                className={BTN}
                              >
                                {a.sendStatus === "sending"
                                  ? "Sending…"
                                  : a.sendStatus === "sent"
                                    ? "Sent"
                                    : "Send to author"}
                              </button>
                              <button
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(
                                      `${a.draft!.subject}\n\n${a.draft!.body}`,
                                    );
                                    setProgress(
                                      "✅ Email text copied. Paste it into the website form.",
                                    );
                                  } catch {
                                    setError(
                                      "Could not copy. Select the text and copy it by hand.",
                                    );
                                  }
                                }}
                                className={BTN_OUT}
                              >
                                Copy email text
                              </button>
                              {a.sendStatus !== "sent" && (
                                <button
                                  onClick={() =>
                                    updateAuthor(a.email, {
                                      sendStatus: "sent",
                                    })
                                  }
                                  className={BTN_OUT}
                                >
                                  I sent it through the website form
                                </button>
                              )}
                              {a.sendStatus === "failed" && (
                                <span className="text-red-700">
                                  {a.sendError}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
