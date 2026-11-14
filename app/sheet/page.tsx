"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";

type Draft = { subject: string; body: string };

type Row = {
  id: string;
  cells: Record<string, string>;
  draft?: Draft;
  open?: boolean;
  status?: "sending" | "sent" | "failed";
  error?: string;
};

type Mapping = { name: string; email: string; book: string };

const TEMPLATE_KEY = "emailTemplate";
const DATA_KEY = "sheetData";
const SENT_KEY = "sentEmails";

const DEFAULT_SUBJECT = "Feature draft for [Book Title]";
const DEFAULT_BODY = `Hello [First Name],

I recently came across [Book Title] and wanted to reach out.

Write your message here. You can use any column name from your sheet as a placeholder, like [Year] or [Website].

Best regards,
Your Name`;

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
function guessCol(cols: string[], patterns: RegExp[]) {
  for (const p of patterns) {
    const hit = cols.find((c) => p.test(norm(c)));
    if (hit) return hit;
  }
  return "";
}
function hasPlaceholder(d: Draft) {
  return /\[[^\]]+\]/.test(d.subject + d.body);
}

const MIN_WAIT = 5; // seconds between emails
const MAX_WAIT = 10;
const MAX_PER_RUN = 30;

export default function SheetPage() {
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [map, setMap] = useState<Mapping>({ name: "", email: "", book: "" });
  const [tSubject, setTSubject] = useState(DEFAULT_SUBJECT);
  const [tBody, setTBody] = useState(DEFAULT_BODY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [sendingAll, setSendingAll] = useState(false);
  const stopRef = useRef(false);
  const [dark, setDark] = useState(false);

  // Load the saved template and the saved table
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
        setMap(p.map ?? { name: "", email: "", book: "" });
        setRows(
          (p.rows ?? []).map((r: Row) => ({
            ...r,
            status: r.status === "sending" ? undefined : r.status,
          })),
        );
      }
    } catch {}
    setDark(document.documentElement.classList.contains("dark"));
    setLoaded(true);
  }, []);

  // Save the template when you change it
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(
        TEMPLATE_KEY,
        JSON.stringify({ subject: tSubject, body: tBody }),
      );
    } catch {}
  }, [tSubject, tBody, loaded]);

  // Save the table when you change it
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify({ columns, rows, map }));
    } catch {}
  }, [columns, rows, map, loaded]);

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
        setMap({
          name: guessCol(cols, [
            /^author( name)?$/,
            /^(full )?name$/,
            /author/,
            /name/,
          ]),
          email: guessCol(cols, [/^e ?mail( address)?$/, /e ?mail/]),
          book: guessCol(cols, [
            /(recent|latest|newest|current|new).*(book|title)/,
            /^book( title)?$/,
            /book/,
            /title/,
          ]),
        });
        setProgress("");
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
      setError("Upload a CSV first, or add a column.");
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
    setMap({ name: "", email: "", book: "" });
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

  // ---------- Filling the template ----------
  function emailOf(row: Row) {
    return (row.cells[map.email] ?? "").trim();
  }

  // The value for a [placeholder]. A column with that name wins.
  function valueFor(row: Row, key: string): string | null {
    const col = columns.find((c) => norm(c) === key);
    if (col) return (row.cells[col] ?? "").trim() || null;

    const name = (row.cells[map.name] ?? "").trim();
    const book = (row.cells[map.book] ?? "").trim();
    if (["author name", "author", "name", "full name"].includes(key))
      return name || null;
    if (["first name", "author first name"].includes(key))
      return name.split(/\s+/)[0] || null;
    if (["book title", "book", "title", "book name"].includes(key))
      return book || null;
    return null;
  }

  function fill(text: string, row: Row) {
    const out = text.replace(
      /\[([^\]]+)\]/g,
      (whole, inner: string) => valueFor(row, norm(inner)) ?? whole,
    );
    // Plain emails cannot show bold or italic, so remove the *stars*
    return out
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "$1");
  }

  function generated(row: Row): Draft {
    return { subject: fill(tSubject, row), body: fill(tBody, row) };
  }

  function contentOf(row: Row): Draft {
    return row.draft ?? generated(row);
  }

  function siteOf(row: Row) {
    for (const c of columns) {
      if (/website|contact|url|link|site/.test(norm(c))) {
        const v = (row.cells[c] ?? "").trim();
        if (/^https?:\/\//i.test(v)) return v;
      }
    }
    return "";
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
    if (hasPlaceholder(contentOf(row)))
      return { text: "Missing info", cls: "bg-amber-100 text-amber-900" };
    if (wasSent(to))
      return { text: "Emailed before", cls: "bg-amber-100 text-amber-900" };
    return { text: "Ready", cls: "bg-green-100 text-green-800" };
  }

  function isReady(row: Row) {
    const to = emailOf(row);
    return (
      row.status !== "sent" &&
      validEmail(to) &&
      !hasPlaceholder(contentOf(row)) &&
      !wasSent(to)
    );
  }

  // ---------- Sending ----------
  async function sendRow(row: Row, test = false): Promise<boolean> {
    const to = emailOf(row);
    const d = contentOf(row);

    if (hasPlaceholder(d)) {
      const msg = `Some text is still missing, like ${
        (d.subject + d.body).match(/\[[^\]]+\]/)?.[0]
      }.`;
      if (test) setError(msg);
      else patchRow(row.id, { status: "failed", error: msg });
      return false;
    }
    if (!test && !validEmail(to)) {
      patchRow(row.id, {
        status: "failed",
        error: "There is no valid email address.",
      });
      return false;
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
        if (c.level === "bad") {
          patchRow(row.id, { status: "failed", error: c.message });
          return false;
        }
      } catch {}
    }

    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject: d.subject,
          body: d.body,
          test,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (test) setError(data.error || "Could not send the test.");
        else
          patchRow(row.id, {
            status: "failed",
            error: data.error || "Could not send.",
          });
        return false;
      }

      if (test) {
        setProgress("✅ Test email sent to your own inbox. Go and check it.");
        return true;
      }
      addSent(to);
      patchRow(row.id, { status: "sent", error: "" });
      return true;
    } catch {
      if (test) setError("Could not reach the server.");
      else
        patchRow(row.id, {
          status: "failed",
          error: "Could not reach the server.",
        });
      return false;
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

  const mapFields: { key: keyof Mapping; label: string }[] = [
    { key: "name", label: "Author name column" },
    { key: "email", label: "Email column" },
    { key: "book", label: "Book column (used for [Book Title])" },
  ];

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Sheet mode</h1>
          <p className="text-sm text-gray-600">
            Upload your researched sheet, edit it, and send personal emails.
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

      {/* Upload */}
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
          <div className="grid gap-3 md:grid-cols-3">
            {mapFields.map((f) => (
              <div key={f.key}>
                <label className={LABEL}>{f.label}</label>
                <select
                  value={map[f.key]}
                  onChange={(e) => setMap({ ...map, [f.key]: e.target.value })}
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
        )}
      </section>

      {/* Template */}
      <section className={`${CARD} space-y-3`}>
        <div>
          <h2 className="text-lg font-bold">2. Your email template</h2>
          <p className="text-sm text-gray-600">
            Saved in your browser, and shared with the research page. Use
            [Author Name], [First Name], [Book Title], or any column name in
            square brackets, like [Year] or [Website].
          </p>
        </div>
        {columns.length > 0 && (
          <p className="text-xs text-gray-600">
            Your columns:{" "}
            {columns.map((c) => (
              <span
                key={c}
                className={`${BADGE} mr-1 inline-block bg-violet-100 text-violet-900`}
              >
                [{c}]
              </span>
            ))}
          </p>
        )}
        <div>
          <label htmlFor="tsub" className={LABEL}>
            Subject
          </label>
          <input
            id="tsub"
            value={tSubject}
            onChange={(e) => setTSubject(e.target.value)}
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
            onChange={(e) => setTBody(e.target.value)}
            rows={12}
            className={INPUT}
          />
        </div>
        <button
          onClick={() => {
            setTSubject(DEFAULT_SUBJECT);
            setTBody(DEFAULT_BODY);
          }}
          className="text-sm font-semibold text-gray-600 underline"
        >
          Reset to the example
        </button>
      </section>

      {/* Table */}
      <section className={`${CARD} space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">3. Edit and send</h2>
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
                              {hasPlaceholder(d) && (
                                <p className="rounded-lg bg-amber-100 p-2 text-sm text-amber-900">
                                  Some text is still missing (like{" "}
                                  {
                                    (d.subject + d.body).match(
                                      /\[[^\]]+\]/,
                                    )?.[0]
                                  }
                                  ). Fill that column in the table, or type it
                                  into the email below.
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
