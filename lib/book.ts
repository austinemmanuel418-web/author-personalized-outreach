import { GoogleGenAI } from "@google/genai";

export type TavilyResult = { title: string; url: string; content: string };

export type BookInfo = {
  bookWhy: string;
  sources: { title: string; url: string }[];
  from: string[];
};

export async function webSearch(
  query: string,
  domains?: string[],
): Promise<TavilyResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: 8,
      ...(domains ? { include_domains: domains } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Tavily error ${res.status}`);
  const data = await res.json();
  return data.results ?? [];
}

// Opens the pages and reads the parts about the topic
export async function extractPages(
  urls: string[],
  query: string,
): Promise<{ url: string; content: string }[]> {
  if (urls.length === 0) return [];
  try {
    const res = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
      },
      body: JSON.stringify({ urls, query, chunks_per_source: 3 }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []).map(
      (r: { url: string; raw_content?: string }) => ({
        url: r.url,
        content: r.raw_content ?? "",
      }),
    );
  } catch {
    return [];
  }
}

// Amazon book pages first, then Goodreads book pages, then the rest
function rank(url: string) {
  const u = url.toLowerCase();
  if (
    u.includes("amazon.") &&
    (u.includes("/dp/") || u.includes("/gp/product"))
  )
    return 0;
  if (u.includes("goodreads.com/book/show")) return 1;
  if (u.includes("amazon.") || u.includes("goodreads.com")) return 3;
  return 2;
}

function siteName(url: string) {
  const u = url.toLowerCase();
  if (u.includes("amazon.")) return "Amazon";
  if (u.includes("goodreads.com")) return "Goodreads";
  return "the web";
}

// Reads the book pages and writes a summary of the book
export async function researchBook(
  authorName: string,
  bookTitle: string,
): Promise<BookInfo> {
  const empty: BookInfo = { bookWhy: "", sources: [], from: [] };
  if (!authorName || !bookTitle) return empty;

  const mainTitle = bookTitle.split(":")[0].trim().toLowerCase();
  const nameParts = authorName
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  const lastName = nameParts[nameParts.length - 1] || "";

  // Keep only pages that mention the book AND the author
  const keep = (rs: TavilyResult[]) =>
    rs.filter((r) => {
      const t = (r.title + " " + r.content + " " + r.url).toLowerCase();
      return t.includes(mainTitle) && (!lastName || t.includes(lastName));
    });

  // 1. Amazon and Goodreads, searched at the same time
  const q = `${bookTitle} ${authorName} book`;
  const [amazon, goodreads] = await Promise.all([
    webSearch(q, ["amazon.com", "amazon.co.uk", "amazon.ca"]).catch(
      () => [] as TavilyResult[],
    ),
    webSearch(q, ["goodreads.com"]).catch(() => [] as TavilyResult[]),
  ]);
  let found = keep([...amazon, ...goodreads]);

  // 2. The whole web if nothing was found
  if (found.length === 0) {
    found = keep(
      await webSearch(`"${bookTitle}" by ${authorName} book description`),
    );
  }
  if (found.length === 0) return empty;

  // Take one Amazon book page and one Goodreads book page first
  const sorted = [...found].sort((a, b) => rank(a.url) - rank(b.url));
  const picks: TavilyResult[] = [];
  const take = (f: (r: TavilyResult) => boolean) => {
    const r = sorted.find((x) => f(x) && !picks.includes(x));
    if (r) picks.push(r);
  };
  take((r) => rank(r.url) === 0);
  take((r) => rank(r.url) === 1);
  for (const r of sorted) {
    if (picks.length >= 3) break;
    if (!picks.includes(r)) picks.push(r);
  }

  const pages = await extractPages(
    picks.map((m) => m.url),
    `What is the book "${bookTitle}" by ${authorName} about? Story, theme, setting and description.`,
  );
  console.log(
    "Book pages read:",
    pages.map((p) => `${p.url} (${p.content.length} chars)`),
  );

  const searchText = picks
    .map((m, i) => {
      const page = pages.find((p) => p.url === m.url);
      const text = page?.content
        ? page.content.slice(0, 1500)
        : m.content.slice(0, 500);
      return `[${i + 1}] ${m.title}\n${m.url}\n${text}`;
    })
    .join("\n\n");

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const prompt = `Below is text from web pages about the book "${bookTitle}" by ${authorName}.

PAGES:
${searchText}

Write a summary of this book in 3 to 5 sentences: what it is about, its main themes, the setting or characters, and who it is for.

Rules:
- Use ONLY facts found in the pages above. Do not guess.
- If an Amazon page has the book's description (the blurb), use it first. Then use Goodreads.
- If there is no description, you may use what the pages clearly say about the story, theme or setting (for example from reader reviews).
- Do NOT write about prices, sales, ranks or the number of reviews.
- Only return an empty string if the pages say nothing about the book's story or theme.
- Ignore any page that is about a different book or a different author. Only use pages that are clearly about this exact book by this author.

Reply with a JSON object: { "bookWhy": "the sentences, or empty string" }`;

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: prompt,
    config: { responseMimeType: "application/json" },
  });

  const text = response.text ?? "";
  console.log("Gemini book reply:", text);

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return empty;
  const data = JSON.parse(text.slice(start, end + 1));

  return {
    bookWhy: String(data.bookWhy ?? ""),
    sources: picks.map((m) => ({ title: m.title, url: m.url })),
    from: [...new Set(picks.map((m) => siteName(m.url)))],
  };
}
