"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";

type Draft = { subject: string; body: string };

type Row = {
  id: string;
  cells: Record<string, string>;
  draft?: Draft; // the filled or edited email
  open?: boolean;
  filling?: boolean;
  fillError?: string;
  status?: "sending" | "sent" | "failed";
  error?: string;
};

type Mapping = {
  name: string;
  email: string;
  book: string;
  desc: string;
  more: string;
};

const EMPTY_MAP: Mapping = {
  name: "",
  email: "",
  book: "",
  desc: "",
  more: "",
};

const TEMPLATE_KEY = "emailTemplate";
const DATA_KEY = "sheetData";
const SENT_KEY = "sentEmails";
const SENDER_KEY = "senderName";

const DEFAULT_SUBJECT = "Feature draft for [Book Title]";
const DEFAULT_BODY = `Hello [Author First Name],

I recently came across [Book Title], and what caught my attention was [Interesting Book Detail].

Write the rest of your message here.

Warm regards,
[Name]`;

// Words that always mean "me, the sender"
const SENDER_KEYS = ["name", "your name", "sender name", "sender", "my name"];
// Words the app fills by itself from the sheet
const KNOWN_KEYS = [
  "author name",
  "author",
  "full name",
  "first name",
  "author first name",
  "greeting first name",
  "greeting",
  "book title",
  "book",
  "title",
  "book name",
];

// ---------- Look and feel ----------
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
const CELL =
  "w-full min-w-[9rem] rounded-md border border-violet-200 bg-white px-2 py-1 text-sm text-violet-950 focus:border-violet-500 focus:outline-none";
const LABEL = "mb-1 block text-sm font-semibold";
const BADGE = "rounded-full px-3 py-1 text-xs font-semibold";

// ---------- Small helpers ----------
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
function validEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
// "Author Name", "author_name" and "[author name]" all become "author name"
function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
// Plain emails cannot show bold or italic, so remove the *stars*
function clean(t: string) {
  return t.replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/\*([^*\n]+)\*/g, "$1");
}
function brackets(t: string): string[] {
  return [...new Set(t.match(/\[[^\]]+\]/g) || [])];
}
function guessCol(cols: string[], patterns: RegExp[], exclude?: RegExp) {
  for (const p of patterns) {
    const hit = cols.find(
      (c) => p.test(norm(c)) && !(exclude && exclude.test(norm(c))),
    );
    if (hit) return hit;
  }
  return "";
}

const MIN_WAIT = 10; // seconds between emails
const MAX_WAIT = 20;
const MAX_PER_RUN = 30;

export default function SheetPage() {
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [map, setMap] = useState<Mapping>(EMPTY_MAP);
  const [sender, setSender] = useState("");
  const [tSubject, setTSubject] = useState(DEFAULT_SUBJECT);
  const [tBody, setTBody] = useState(DEFAULT_BODY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [sendingAll, setSendingAll] = useState(false);
  const stopRef = useRef(false);
  const [dark, setDark] = useState(false);

  // Load everything that was saved
  useEffect(() => {
    try {
      const t = localStorage.getItem(TEMPLATE_KEY);
      if (t) {
        const p = JSON.parse(t);
        if (p.subject) setTSubject(p.subject);
        if (p.body) setTBody(p.body);
      }
      const d = localStorage.getItem(DATA_KEY);
      if (d) {
        const p = JSON.parse(d);
        setColumns(p.columns ?? []);
        setMap({ ...EMPTY_MAP, ...(p.map ?? {}) });
        setRows(
          (p.rows ?? []).map((r: Row) => ({
            ...r,
            filling: false,
            status: r.status === "sending" ? undefined : r.status,
          })),
        );
      }
      const s = localStorage.getItem(SENDER_KEY);
      if (s) setSender(s);
    } catch {}
    setDark(document.documentElement.classList.contains("dark"));
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(
        TEMPLATE_KEY,
        JSON.stringify({ subject: tSubject, body: tBody }),
      );
    } catch {}
  }, [tSubject, tBody, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify({ columns, rows, map }));
    } catch {}
  }, [columns, rows, map, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(SENDER_KEY, sender);
    } catch {}
  }, [sender, loaded]);

  function toggleDark() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  }

  // The brackets Gemini should write (not names, not sheet columns)
  const slots = aiSlotsOf(tSubject + "\n" + tBody);

  function aiSlotsOf(text: string): string[] {
    return brackets(text).filter((s) => {
      const k = norm(s.slice(1, -1));
      if (SENDER_KEYS.includes(k) || KNOWN_KEYS.includes(k)) return false;
      if (columns.some((c) => norm(c) === k)) return false;
      return true;
    });
  }

  // ---------- Table ----------
  function patchRow(id: string, changes: Partial<Row>) {
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...changes } : r)));
  }

  function setCell(id: string, col: string, value: string) {
    setRows((cur) =>
      cur.map((r) =>
        r.id === id ? { ...r, cells: { ...r.cells, [col]: value } } : r,
      ),
    );
  }

  // Changing the template clears the filled emails, so they are filled again
  function changeTemplate(subject: string, body: string) {
    setTSubject(subject);
    setTBody(body);
    setRows((cur) =>
      cur.some((r) => r.draft)
        ? cur.map((r) => ({ ...r, draft: undefined, fillError: "" }))
        : cur,
    );
  }

  function loadCsv(file: File) {
    setError("");
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const cols = (res.meta.fields ?? []).filter((c) => c.length > 0);
        if (cols.length === 0 || res.data.length === 0) {
          setError("The file is empty, or it has no header row.");
          return;
        }
        if (
          rows.length > 0 &&
          !confirm("Replace the table you have now with this file?")
        )
          return;

        setColumns(cols);
        setRows(
          res.data.map((r, i) => ({
            id: `${Date.now()}-${i}`,
            cells: Object.fromEntries(
              cols.map((c) => [c, String(r[c] ?? "").trim()]),
            ),
          })),
        );

        // Guess which column is which
        setMap({
          name: guessCol(
            cols,
            [
              /^author( name)?$/,
              /^(full )?name$/,
              /author name|author/,
              /name/,
            ],
            /(url|link|source|status|type|note|date|country|region|first|greeting|book|title|email)/,
          ),
          email: guessCol(
            cols,
            [
              /^e ?mail( address)?$/,
              /(public|professional|author|contact).*e ?mail/,
              /e ?mail/,
            ],
            /(url|link|source|status|type|verif|note|draft|subject)/,
          ),
          book: guessCol(
            cols,
            [
              /^book( title)?$/,
              /(recent|latest|newest).*(book|title)/,
              /book.*title|^title/,
              /book/,
            ],
            /(url|link|source|desc|theme|synopsis|detail|angle|status|amazon|country|date)/,
          ),
          desc: guessCol(
            cols,
            [
              /book.*(desc|synopsis|theme|summary)/,
              /(desc|synopsis|summary)/,
              /theme/,
            ],
            /(url|link|source)/,
          ),
          more: guessCol(
            cols,
            [/angle/, /personali[sz]ation/],
            /(draft|message|subject|email)/,
          ),
        });
        setProgress(
          `Loaded ${res.data.length} rows. Check the columns above, then fill and send.`,
        );
      },
      error: () => setError("Could not read this file."),
    });
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) loadCsv(file);
    e.target.value = "";
  }

  function addRow() {
    if (columns.length === 0) {
      setError("Upload a CSV first.");
      return;
    }
    setRows((cur) => [
      ...cur,
      {
        id: `${Date.now()}-${cur.length}`,
        cells: Object.fromEntries(columns.map((c) => [c, ""])),
      },
    ]);
  }

  function addColumn() {
    const name = (prompt("Name of the new column:") || "").trim();
    if (!name) return;
    if (columns.some((c) => norm(c) === norm(name))) {
      setError("That column already exists.");
      return;
    }
    setColumns((cur) => [...cur, name]);
    setRows((cur) =>
      cur.map((r) => ({ ...r, cells: { ...r.cells, [name]: "" } })),
    );
  }

  function removeRow(id: string) {
    setRows((cur) => cur.filter((r) => r.id !== id));
  }

  function clearTable() {
    if (!confirm("Remove the whole table?")) return;
    setRows([]);
    setColumns([]);
    setMap(EMPTY_MAP);
  }

  function downloadCsv() {
    const csv = Papa.unparse({
      fields: columns,
      data: rows.map((r) => columns.map((c) => r.cells[c] ?? "")),
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "authors-edited.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- Reading a row ----------
  function cell(row: Row, col: string) {
    return col ? (row.cells[col] ?? "").trim() : "";
  }
  function emailOf(row: Row) {
    return cell(row, map.email);
  }
  // The facts Gemini may use for this row
  function descOf(row: Row) {
    return [cell(row, map.desc), cell(row, map.more)].filter(Boolean).join(" ");
  }

  // The value for one [placeholder]. Returns null when it cannot be filled.
  function valueFor(row: Row, key: string): string | null {
    if (SENDER_KEYS.includes(key)) return sender.trim() || null;

    const col = columns.find((c) => norm(c) === key);
    if (col) return cell(row, col) || null;

    const name = cell(row, map.name);
    const book = cell(row, map.book);
    if (["author name", "author", "full name"].includes(key))
      return name || null;
    if (
      [
        "first name",
        "author first name",
        "greeting first name",
        "greeting",
      ].includes(key)
    )
      return name.split(/\s+/)[0] || null;
    if (["book title", "book", "title", "book name"].includes(key))
      return book || null;
    return null;
  }

  function fill(text: string, row: Row) {
    return clean(
      text.replace(
        /\[([^\]]+)\]/g,
        (whole, inner: string) => valueFor(row, norm(inner)) ?? whole,
      ),
    );
  }

  function basicDraft(row: Row): Draft {
    return { subject: fill(tSubject, row), body: fill(tBody, row) };
  }

  // What will be sent (and shown in the preview)
  function contentOf(row: Row): Draft {
    return row.draft ?? basicDraft(row);
  }

  // True when Gemini still has to fill the blanks for this row
  function needsFill(row: Row) {
    return !row.draft && slots.length > 0 && !!descOf(row);
  }

  // The reason a row cannot be sent. Empty text means it is fine.
  function problemOf(row: Row): string {
    const d = contentOf(row);
    if (!d.subject.trim() || !d.body.trim()) return "Message is empty";
    const left = brackets(d.subject + "\n" + d.body);
    if (left.length === 0) return "";

    const known = left.filter((s) => !slots.includes(s));
    if (known.some((s) => SENDER_KEYS.includes(norm(s.slice(1, -1)))))
      return "Type your name above";
    if (known.length > 0) return `Missing ${known[0]}`;

    // Only blanks for Gemini are left
    if (row.draft) return `Still missing ${left[0]}`;
    if (!descOf(row)) return "No book description";
    return "";
  }

  function isReady(row: Row) {
    const to = emailOf(row);
    return (
      row.status !== "sent" &&
      !row.filling &&
      validEmail(to) &&
      !wasSent(to) &&
      !problemOf(row)
    );
  }

  function badge(row: Row): { text: string; cls: string } {
    if (row.status === "sent")
      return { text: "Sent", cls: "bg-green-100 text-green-800" };
    if (row.status === "sending")
      return { text: "Sending…", cls: "bg-violet-100 text-violet-900" };
    if (row.status === "failed")
      return { text: "Failed", cls: "bg-red-100 text-red-800" };
    if (row.filling)
      return { text: "Filling…", cls: "bg-violet-100 text-violet-900" };
    const to = emailOf(row);
    if (!to) return { text: "No email", cls: "bg-amber-100 text-amber-900" };
    if (!validEmail(to))
      return { text: "Invalid email", cls: "bg-red-100 text-red-800" };
    const problem = problemOf(row);
    if (problem) return { text: problem, cls: "bg-amber-100 text-amber-900" };
    if (wasSent(to))
      return { text: "Emailed before", cls: "bg-amber-100 text-amber-900" };
    return {
      text: needsFill(row) ? "Ready (Gemini fills)" : "Ready",
      cls: "bg-green-100 text-green-800",
    };
  }

  // The author's website or contact page, for the "Open site" button
  function siteOf(row: Row) {
    for (const c of columns) {
      const k = norm(c);
      if (
        /(website|contact|homepage|author page|author site)/.test(k) &&
        !/(source|amazon|email)/.test(k)
      ) {
        const v = cell(row, c);
        if (/^https?:\/\//i.test(v)) return v;
      }
    }
    return "";
  }

  // ---------- Gemini fills the blanks (from the sheet, no web search) ----------
  async function aiFill(row: Row): Promise<Draft | null> {
    const base = basicDraft(row);
    const todo = slots.filter((s) => (base.subject + base.body).includes(s));

    if (todo.length === 0) {
      patchRow(row.id, { draft: base, fillError: "" });
      return base;
    }
    const desc = descOf(row);
    if (!desc) {
      patchRow(row.id, { fillError: "This row has no book description." });
      return null;
    }

    patchRow(row.id, { filling: true, fillError: "" });
    const payload = JSON.stringify({
      template: base.body,
      placeholders: todo,
      authorName: cell(row, map.name),
      bookTitle: cell(row, map.book),
      bookWhy: desc,
      authorBio: "",
    });
    const call = () =>
      fetch("/api/fill-detail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });

    try {
      let res = await call();
      if (res.status === 429) {
        patchRow(row.id, { fillError: "Rate limit. Waiting 30 seconds…" });
        await wait(30000);
        res = await call();
      }
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.details)) {
        patchRow(row.id, {
          filling: false,
          fillError: data.error || "Gemini could not fill this email.",
        });
        return null;
      }

      const values: Record<string, string> = {};
      todo.forEach((s, i) => {
        values[s] = String(data.details[i] ?? "").trim();
      });
      const apply = (t: string) => {
        let out = t;
        for (const [s, v] of Object.entries(values)) {
          if (v) out = out.split(s).join(v);
        }
        return clean(out);
      };
      const d: Draft = { subject: apply(base.subject), body: apply(base.body) };
      const left = brackets(d.subject + "\n" + d.body).filter((s) =>
        slots.includes(s),
      );
      patchRow(row.id, {
        filling: false,
        draft: d,
        fillError: left.length
          ? `Gemini left ${left[0]} empty. Type it in the preview.`
          : "",
      });
      return d;
    } catch {
      patchRow(row.id, {
        filling: false,
        fillError: "Could not reach the server.",
      });
      return null;
    }
  }

  async function ensureDraft(row: Row): Promise<Draft> {
    if (needsFill(row)) {
      const d = await aiFill(row);
      if (d) return d;
    }
    return contentOf(row);
  }

  async function fillAllAi() {
    const todo = rows.filter((r) => needsFill(r));
    if (todo.length === 0) {
      setProgress("Nothing to fill.");
      return;
    }
    setError("");
    for (let i = 0; i < todo.length; i++) {
      setProgress(`Gemini is filling ${i + 1} of ${todo.length}…`);
      await aiFill(todo[i]);
      await wait(1000);
    }
    setProgress("Done. Open Preview on a row to read its email.");
  }

  async function togglePreview(row: Row) {
    const opening = !row.open;
    patchRow(row.id, { open: opening });
    if (opening && needsFill(row)) await aiFill(row);
  }

  // ---------- Sending ----------
  async function sendRow(row: Row, test = false): Promise<boolean> {
    const to = emailOf(row);

    const fail = (msg: string) => {
      if (test) setError(msg);
      else patchRow(row.id, { status: "failed", error: msg });
      return false;
    };

    if (!test && !validEmail(to))
      return fail("There is no valid email address.");

    setError("");
    if (!test) patchRow(row.id, { status: "sending", error: "" });

    const d = await ensureDraft(row);
    if (!d.subject.trim() || !d.body.trim())
      return fail("The subject or the message is empty.");

    const left = brackets(d.subject + "\n" + d.body);
    if (left.length > 0) {
      return fail(
        SENDER_KEYS.includes(norm(left[0].slice(1, -1)))
          ? `Type your name in "Your name" above (it fills ${left[0]}).`
          : `Some text is still missing, like ${left[0]}.`,
      );
    }

    if (!test) {
      // Check that the address can receive email
      try {
        const r = await fetch("/api/check-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: to }),
        });
        const c = await r.json();
        if (c.level === "bad") return fail(c.message);
      } catch {}
    }

    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject: d.subject, body: d.body, test }),
      });
      const data = await res.json();

      if (!res.ok) return fail(data.error || "Could not send.");

      if (test) {
        setProgress("✅ Test email sent to your own inbox. Go and check it.");
        return true;
      }
      addSent(to);
      patchRow(row.id, { status: "sent", error: "" });
      return true;
    } catch {
      return fail("Could not reach the server.");
    }
  }

  async function sendOneClick(row: Row) {
    const to = emailOf(row);
    if (!validEmail(to)) {
      setError("This row has no valid email address.");
      return;
    }
    if (
      wasSent(to) &&
      !confirm("You already emailed this address before. Send again?")
    )
      return;
    if (!confirm(`Send this email to ${to}?`)) return;
    await sendRow(row);
  }

  async function sendAllReady() {
    const todo = rows.filter(isReady);
    if (todo.length === 0) {
      setProgress("Nothing is ready to send.");
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
        `Sending ${i + 1} of ${batch.length} to ${emailOf(batch[i])}…`,
      );
      if (await sendRow(batch[i])) done++;

      if (i < batch.length - 1) {
        const secs =
          MIN_WAIT + Math.floor(Math.random() * (MAX_WAIT - MIN_WAIT + 1));
        for (let s = secs; s > 0 && !stopRef.current; s--) {
          setProgress(`Sent ${done} of ${batch.length}. Next email in ${s}s…`);
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

  async function copyText(row: Row) {
    const d = contentOf(row);
    try {
      await navigator.clipboard.writeText(`${d.subject}\n\n${d.body}`);
      setProgress("✅ Email text copied. Paste it into the website form.");
    } catch {
      setError("Could not copy. Select the text and copy it by hand.");
    }
  }

  function markSent(row: Row) {
    const to = emailOf(row);
    if (validEmail(to)) addSent(to);
    patchRow(row.id, { status: "sent", error: "" });
  }

  // ---------- Numbers ----------
  const withEmail = rows.filter((r) => validEmail(emailOf(r))).length;
  const readyCount = rows.filter(isReady).length;
  const sentCount = rows.filter((r) => r.status === "sent").length;
  const fillCount = rows.filter((r) => needsFill(r)).length;
  const noDescCount = rows.filter((r) => !descOf(r)).length;

  const mapFields: { key: keyof Mapping; label: string }[] = [
    { key: "name", label: "Author name" },
    { key: "email", label: "Email" },
    { key: "book", label: "Book title (fills [Book Title])" },
    { key: "desc", label: "Book description (Gemini uses it)" },
    { key: "more", label: "More facts, optional (Gemini uses it)" },
  ];

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Sheet mode</h1>
          <p className="text-sm text-gray-600">
            Upload your researched sheet. Gemini fills your template from the
            book description, then you send.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/" className={BTN_OUT}>
            Back to research app
          </Link>
          <button onClick={toggleDark} aria-pressed={dark} className={BTN_OUT}>
            {dark ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </header>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {/* 1. Upload */}
      <section className={`${CARD} space-y-4`}>
        <h2 className="text-lg font-bold">1. Upload your sheet</h2>
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) loadCsv(f);
          }}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-violet-300 bg-violet-50/60 p-6 text-center"
        >
          <span className="font-semibold">Drop your CSV file here</span>
          <span className="text-sm text-gray-600">
            The first row must be the column names.
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

        {columns.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">
              The app guessed which column is which. Check them, and change any
              that are wrong.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {mapFields.map((f) => (
                <div key={f.key}>
                  <label className={LABEL}>{f.label}</label>
                  <select
                    value={map[f.key]}
                    onChange={(e) =>
                      setMap({ ...map, [f.key]: e.target.value })
                    }
                    className={INPUT}
                  >
                    <option value="">(none)</option>
                    {columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 2. Template */}
      <section className={`${CARD} space-y-3`}>
        <div>
          <h2 className="text-lg font-bold">2. Your email template</h2>
          <p className="text-sm text-gray-600">
            Saved in your browser, and shared with the research page. [Author
            Name], [Author First Name] and [Book Title] are filled from the
            sheet, [Name] is you, and any column name in square brackets fills
            from that column. Gemini writes every other bracket from the book
            description. Changing the template clears the emails already filled.
          </p>
        </div>
        <div className="max-w-md">
          <label htmlFor="sender" className={LABEL}>
            Your name (fills [Name] at the end of the email)
          </label>
          <input
            id="sender"
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            placeholder="Your name"
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="tsub" className={LABEL}>
            Subject
          </label>
          <input
            id="tsub"
            value={tSubject}
            onChange={(e) => changeTemplate(e.target.value, tBody)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="tbody" className={LABEL}>
            Message
          </label>
          <textarea
            id="tbody"
            value={tBody}
            onChange={(e) => changeTemplate(tSubject, e.target.value)}
            rows={12}
            className={INPUT}
          />
        </div>
        {slots.length > 0 && (
          <p className="text-xs text-gray-600">
            Gemini will write: {slots.join(" · ")}
          </p>
        )}
        <button
          onClick={() => changeTemplate(DEFAULT_SUBJECT, DEFAULT_BODY)}
          className="text-sm font-semibold text-gray-600 underline"
        >
          Reset to the example
        </button>
      </section>

      {/* 3. Table */}
      <section className={`${CARD} space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">3. Fill and send</h2>
          <div className="flex flex-wrap gap-2">
            <span className={`${BADGE} bg-violet-100 text-violet-900`}>
              {rows.length} rows
            </span>
            <span className={`${BADGE} bg-violet-100 text-violet-900`}>
              {withEmail} with email
            </span>
            <span className={`${BADGE} bg-violet-100 text-violet-900`}>
              {sentCount} sent
            </span>
          </div>
        </div>

        {rows.length > 0 && noDescCount > 0 && slots.length > 0 && (
          <p className="rounded-lg bg-amber-100 p-2 text-sm text-amber-900">
            {noDescCount} rows have no book description, so Gemini cannot fill
            their blanks. Check the &quot;Book description&quot; column above.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={addRow} className={BTN_OUT}>
            Add row
          </button>
          <button onClick={addColumn} className={BTN_OUT}>
            Add column
          </button>
          <button
            onClick={downloadCsv}
            disabled={rows.length === 0}
            className={BTN_OUT}
          >
            Download CSV
          </button>
          <button
            onClick={clearTable}
            disabled={rows.length === 0}
            className="text-sm font-semibold text-red-700 underline"
          >
            Clear table
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={fillAllAi}
            disabled={sendingAll || fillCount === 0}
            className={BTN}
          >
            Fill all with Gemini ({fillCount})
          </button>
          <button
            onClick={sendAllReady}
            disabled={sendingAll || readyCount === 0}
            className={BTN_OUT}
          >
            Send all ready ({readyCount})
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

        {rows.length === 0 ? (
          <p className="rounded-xl bg-violet-50 p-6 text-center text-sm text-gray-600">
            No rows yet. Upload a CSV above.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-violet-100">
            <table className="w-full min-w-max text-left text-sm">
              <thead className="bg-violet-50 text-violet-900">
                <tr>
                  <th className="p-2">#</th>
                  <th className="p-2">Status</th>
                  {columns.map((c) => (
                    <th key={c} className="p-2 font-semibold">
                      {c}
                      {c === map.name && " (name)"}
                      {c === map.email && " (email)"}
                      {c === map.book && " (book)"}
                      {c === map.desc && " (description)"}
                    </th>
                  ))}
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const b = badge(r);
                  const d = contentOf(r);
                  const site = siteOf(r);
                  const stillLeft = brackets(d.subject + "\n" + d.body);
                  return (
                    <Fragment key={r.id}>
                      <tr className="border-t border-violet-100 align-top">
                        <td className="p-2">{i + 1}</td>
                        <td className="p-2">
                          <span className={`${BADGE} ${b.cls}`}>{b.text}</span>
                          {(r.error || r.fillError) && (
                            <p className="mt-1 max-w-[14rem] text-xs text-red-700">
                              {r.error || r.fillError}
                            </p>
                          )}
                        </td>
                        {columns.map((c) => (
                          <td key={c} className="p-1">
                            <input
                              value={r.cells[c] ?? ""}
                              onChange={(e) => setCell(r.id, c, e.target.value)}
                              className={`${CELL} ${
                                c === map.email &&
                                r.cells[c] &&
                                !validEmail(r.cells[c].trim())
                                  ? "border-red-500"
                                  : ""
                              }`}
                            />
                          </td>
                        ))}
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1">
                            <button
                              onClick={() => togglePreview(r)}
                              className={BTN_SM}
                            >
                              {r.open ? "Hide" : "Preview"}
                            </button>
                            <button
                              onClick={() => sendOneClick(r)}
                              disabled={
                                r.status === "sending" ||
                                r.status === "sent" ||
                                r.filling
                              }
                              className={BTN_SM}
                            >
                              Send
                            </button>
                            {site && (
                              <a
                                href={site}
                                target="_blank"
                                rel="noreferrer"
                                className={BTN_SM}
                              >
                                Open site
                              </a>
                            )}
                            <button
                              onClick={() => removeRow(r.id)}
                              className={BTN_SM}
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>

                      {r.open && (
                        <tr className="border-t border-violet-100 bg-violet-50">
                          <td colSpan={columns.length + 3} className="p-4">
                            <div className="max-w-3xl space-y-3">
                              <p className="text-sm">
                                <b>To:</b> {emailOf(r) || "(no email)"}
                              </p>
                              {r.filling && (
                                <p className="text-sm text-violet-800">
                                  Gemini is filling the blanks…
                                </p>
                              )}
                              {stillLeft.length > 0 &&
                                !r.filling &&
                                !needsFill(r) && (
                                  <p className="rounded-lg bg-amber-100 p-2 text-sm text-amber-900">
                                    Some text is still missing (like{" "}
                                    {stillLeft[0]}).{" "}
                                    {SENDER_KEYS.includes(
                                      norm(stillLeft[0].slice(1, -1)),
                                    )
                                      ? 'Type your name in "Your name" above.'
                                      : "Type it into the email below, or fill that column in the table."}
                                  </p>
                                )}
                              <div>
                                <label className={LABEL}>Subject</label>
                                <input
                                  value={d.subject}
                                  onChange={(e) =>
                                    patchRow(r.id, {
                                      draft: { ...d, subject: e.target.value },
                                    })
                                  }
                                  className={INPUT}
                                />
                              </div>
                              <div>
                                <label className={LABEL}>Email</label>
                                <textarea
                                  value={d.body}
                                  onChange={(e) =>
                                    patchRow(r.id, {
                                      draft: { ...d, body: e.target.value },
                                    })
                                  }
                                  rows={14}
                                  className={INPUT}
                                />
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  onClick={() => sendRow(r, true)}
                                  className={BTN_OUT}
                                >
                                  Send test to me
                                </button>
                                <button
                                  onClick={() => sendOneClick(r)}
                                  disabled={
                                    r.status === "sending" ||
                                    r.status === "sent" ||
                                    r.filling
                                  }
                                  className={BTN}
                                >
                                  {r.status === "sending"
                                    ? "Sending…"
                                    : r.status === "sent"
                                      ? "Sent"
                                      : "Send to author"}
                                </button>
                                {r.status === "sent" && (
                                  <span className="font-semibold text-green-700">
                                    ✅ Sent
                                  </span>
                                )}
                                {r.status === "failed" && r.error && (
                                  <span className="text-red-700">
                                    {r.error}
                                  </span>
                                )}
                                <button
                                  onClick={() => aiFill(r)}
                                  disabled={r.filling}
                                  className={BTN_OUT}
                                >
                                  Fill with Gemini again
                                </button>
                                <button
                                  onClick={() => copyText(r)}
                                  className={BTN_OUT}
                                >
                                  Copy email text
                                </button>
                                {r.status !== "sent" && (
                                  <button
                                    onClick={() => markSent(r)}
                                    className={BTN_OUT}
                                  >
                                    I sent it through the form
                                  </button>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
