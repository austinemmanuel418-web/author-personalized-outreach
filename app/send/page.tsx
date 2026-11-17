"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";

type Draft = { subject: string; body: string };

type Row = {
  id: string;
  cells: Record<string, string>;
  draft?: Draft; // an edited email
  open?: boolean;
  status?: "sending" | "sent" | "failed";
  error?: string;
};

type Mapping = {
  name: string;
  email: string;
  subject: string;
  message: string;
  site: string;
};

const EMPTY_MAP: Mapping = {
  name: "",
  email: "",
  subject: "",
  message: "",
  site: "",
};

const DATA_KEY = "sendData";
const SENT_KEY = "sentEmails";
const SENDER_KEY = "senderName";

// Brackets that always mean "me, the sender"
const SENDER_KEYS = [
  "name",
  "your name",
  "your full name",
  "sender name",
  "sender",
  "my name",
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

export default function SendPage() {
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [map, setMap] = useState<Mapping>(EMPTY_MAP);
  const [sender, setSender] = useState("");
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [sendingAll, setSendingAll] = useState(false);
  const stopRef = useRef(false);
  const [dark, setDark] = useState(false);

  // Load what was saved
  useEffect(() => {
    try {
      const d = localStorage.getItem(DATA_KEY);
      if (d) {
        const p = JSON.parse(d);
        setColumns(p.columns ?? []);
        setMap({ ...EMPTY_MAP, ...(p.map ?? {}) });
        setRows(
          (p.rows ?? []).map((r: Row) => ({
            ...r,
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
        const guess: Mapping = {
          name: guessCol(
            cols,
            [
              /^author( name)?$/,
              /^(full )?name$/,
              /author name|author/,
              /name/,
            ],
            /(url|link|source|status|type|note|date|country|region|book|title|email|subject|message|draft|first|greeting)/,
          ),
          email: guessCol(
            cols,
            [
              /^e ?mail( address)?$/,
              /(public|professional|author|contact|business).*e ?mail/,
              /e ?mail/,
            ],
            /(url|link|source|status|type|verif|note|draft|subject|message|body|personali|text|content)/,
          ),
          subject: guessCol(cols, [
            /^(suggested |email )?subject( line)?$/,
            /subject/,
          ]),
          message: guessCol(
            cols,
            [
              /(personali[sz]ed|final|complete|full).*(email|message|draft|body)/,
              /(email|message).*(draft|body|text|content)/,
              /^(message|body|draft|email body|email message)$/,
              /body|draft|message/,
            ],
            /(address|source|url|link|status|subject|note|verif)/,
          ),
          site: guessCol(
            cols,
            [
              /(official )?website( url)?/,
              /contact (form|page)/,
              /website|homepage|site/,
            ],
            /(source|amazon|email|social|instagram|tiktok|facebook|linkedin)/,
          ),
        };
        if (guess.email && guess.email === guess.message) guess.message = "";
        setMap(guess);
        setProgress(
          `Loaded ${res.data.length} rows. Check the columns above, then preview and send.`,
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
      data: rows.map((r) =>
        columns.map((c) =>
          c === map.subject && r.draft
            ? r.draft.subject
            : c === map.message && r.draft
              ? r.draft.body
              : (r.cells[c] ?? ""),
        ),
      ),
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "emails-edited.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Replaces a piece of text in every subject and message
  function replaceEverywhere() {
    if (!findText) {
      setError("Type the text to find first.");
      return;
    }
    if (!map.subject && !map.message) {
      setError("Choose the subject and message columns first.");
      return;
    }
    setError("");
    let count = 0;
    for (const r of rows) {
      for (const t of [
        cell(r, map.subject),
        cell(r, map.message),
        r.draft?.subject ?? "",
        r.draft?.body ?? "",
      ]) {
        if (t.includes(findText)) count++;
      }
    }
    const swap = (s: string) => s.split(findText).join(replaceText);
    setRows((cur) =>
      cur.map((r) => {
        const cells = { ...r.cells };
        for (const c of [map.subject, map.message]) {
          if (c) cells[c] = swap(cells[c] ?? "");
        }
        const draft = r.draft
          ? { subject: swap(r.draft.subject), body: swap(r.draft.body) }
          : undefined;
        return { ...r, cells, draft };
      }),
    );
    setProgress(`Replaced "${findText}" in ${count} places.`);
  }

  // ---------- Reading a row ----------
  function cell(row: Row, col: string) {
    return col ? (row.cells[col] ?? "").trim() : "";
  }
  function emailOf(row: Row) {
    return cell(row, map.email);
  }

  // Fills [Name] and [Your Name] with your name
  function fillSender(text: string) {
    return clean(
      text.replace(/\[([^\]]+)\]/g, (whole, inner: string) =>
        SENDER_KEYS.includes(norm(inner)) && sender.trim()
          ? sender.trim()
          : whole,
      ),
    );
  }

  // What will be sent (and shown in the preview)
  function contentOf(row: Row): Draft {
    return (
      row.draft ?? {
        subject: fillSender(cell(row, map.subject)),
        body: fillSender(cell(row, map.message)),
      }
    );
  }

  // The reason a row cannot be sent. Empty text means it is fine.
  function problemOf(row: Row): string {
    const d = contentOf(row);
    if (!d.subject.trim()) return "No subject";
    if (!d.body.trim()) return "No message";
    const left = brackets(d.subject + "\n" + d.body);
    if (left.length === 0) return "";
    if (SENDER_KEYS.includes(norm(left[0].slice(1, -1))))
      return "Type your name above";
    return `Missing ${left[0]}`;
  }

  function isReady(row: Row) {
    const to = emailOf(row);
    return (
      row.status !== "sent" &&
      row.status !== "sending" &&
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
    const to = emailOf(row);
    if (!to) return { text: "No email", cls: "bg-amber-100 text-amber-900" };
    if (!validEmail(to))
      return { text: "Invalid email", cls: "bg-red-100 text-red-800" };
    const problem = problemOf(row);
    if (problem) return { text: problem, cls: "bg-amber-100 text-amber-900" };
    if (wasSent(to))
      return { text: "Emailed before", cls: "bg-amber-100 text-amber-900" };
    return { text: "Ready", cls: "bg-green-100 text-green-800" };
  }

  function siteOf(row: Row) {
    const v = cell(row, map.site);
    if (/^https?:\/\//i.test(v)) return v;
    if (/^www\./i.test(v)) return `https://${v}`;
    return "";
  }

  // ---------- Sending ----------
  async function sendRow(row: Row, test = false): Promise<boolean> {
    const to = emailOf(row);
    const d = contentOf(row);

    const fail = (msg: string) => {
      if (test) setError(msg);
      else patchRow(row.id, { status: "failed", error: msg });
      return false;
    };

    if (!test && !validEmail(to))
      return fail("There is no valid email address.");
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

    setError("");
    if (!test) {
      patchRow(row.id, { status: "sending", error: "" });
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

  function setAllOpen(open: boolean) {
    setRows((cur) => cur.map((r) => ({ ...r, open })));
  }

  // ---------- Numbers ----------
  const withEmail = rows.filter((r) => validEmail(emailOf(r))).length;
  const readyCount = rows.filter(isReady).length;
  const sentCount = rows.filter((r) => r.status === "sent").length;
  const allOpen = rows.length > 0 && rows.every((r) => r.open);

  const mapFields: { key: keyof Mapping; label: string }[] = [
    { key: "name", label: "Author name (optional)" },
    { key: "email", label: "Email" },
    { key: "subject", label: "Subject" },
    { key: "message", label: "Message (the full email)" },
    { key: "site", label: "Website or contact page (optional)" },
  ];

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Send mode</h1>
          <p className="text-sm text-gray-600">
            Upload a sheet with the emails already written. Preview them and
            send.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/" className={BTN_OUT}>
            Research app
          </Link>
          <Link href="/sheet" className={BTN_OUT}>
            Sheet mode
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
            The first row must be the column names. You need an email, a subject
            and a message column.
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

      {/* 2. Options */}
      <section className={`${CARD} space-y-4`}>
        <h2 className="text-lg font-bold">2. Fix details (optional)</h2>
        <div className="max-w-md">
          <label htmlFor="sender" className={LABEL}>
            Your name (fills [Name] or [Your Name] if a message still has it)
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
          <p className={LABEL}>Find and replace in all subjects and messages</p>
          <div className="flex flex-wrap gap-2">
            <input
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              placeholder="Find, for example [Your Position]"
              className={`${INPUT} min-w-[12rem] flex-1`}
            />
            <input
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              placeholder="Replace with"
              className={`${INPUT} min-w-[12rem] flex-1`}
            />
            <button onClick={replaceEverywhere} className={BTN_OUT}>
              Replace in all
            </button>
          </div>
        </div>
      </section>

      {/* 3. Table */}
      <section className={`${CARD} space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">3. Preview and send</h2>
          <div className="flex flex-wrap gap-2">
            <span className={`${BADGE} bg-violet-100 text-violet-900`}>
              {rows.length} rows
            </span>
            <span className={`${BADGE} bg-violet-100 text-violet-900`}>
              {withEmail} with email
            </span>
            <span className={`${BADGE} bg-violet-100 text-violet-900`}>
              {readyCount} ready
            </span>
            <span className={`${BADGE} bg-violet-100 text-violet-900`}>
              {sentCount} sent
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={sendAllReady}
            disabled={sendingAll || readyCount === 0}
            className={BTN}
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
          <button
            onClick={() => setAllOpen(!allOpen)}
            disabled={rows.length === 0}
            className={BTN_OUT}
          >
            {allOpen ? "Hide all previews" : "Preview all"}
          </button>
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
        {progress && <p className="text-sm text-gray-600">{progress}</p>}

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
                      {c === map.email && " (email)"}
                      {c === map.subject && " (subject)"}
                      {c === map.message && " (message)"}
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
                          {r.error && (
                            <p className="mt-1 max-w-[14rem] text-xs text-red-700">
                              {r.error}
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
                              onClick={() => patchRow(r.id, { open: !r.open })}
                              className={BTN_SM}
                            >
                              {r.open ? "Hide" : "Preview"}
                            </button>
                            <button
                              onClick={() => sendOneClick(r)}
                              disabled={
                                r.status === "sending" || r.status === "sent"
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
                              {stillLeft.length > 0 && (
                                <p className="rounded-lg bg-amber-100 p-2 text-sm text-amber-900">
                                  Some text is still missing (like{" "}
                                  {stillLeft[0]}).{" "}
                                  {SENDER_KEYS.includes(
                                    norm(stillLeft[0].slice(1, -1)),
                                  )
                                    ? 'Type your name in "Your name" above.'
                                    : "Type it into the email below, or use Find and replace above."}
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
                                    r.status === "sent"
                                  }
                                  className={BTN}
                                >
                                  {r.status === "sending"
                                    ? "Sending…"
                                    : r.status === "sent"
                                      ? "Sent"
                                      : "Send to author"}
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
                                {r.draft && (
                                  <button
                                    onClick={() =>
                                      patchRow(r.id, { draft: undefined })
                                    }
                                    className="text-sm font-semibold text-gray-600 underline"
                                  >
                                    Reset email text
                                  </button>
                                )}
                              </div>
                              {r.status === "failed" && r.error && (
                                <p className="text-sm text-red-700">
                                  {r.error}
                                </p>
                              )}
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
