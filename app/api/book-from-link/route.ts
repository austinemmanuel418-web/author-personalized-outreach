import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { extractPages } from "../../../lib/book";

export const maxDuration = 60;

function fail(message: string) {
  return NextResponse.json({ error: message }, { status: 422 });
}

export async function POST(req: Request) {
  try {
    const { url, authorName } = await req.json();
    const link = String(url || "").trim();
    const name = String(authorName || "").trim();

    let host = "";
    try {
      host = new URL(link).hostname.toLowerCase().replace(/^www\./, "");
    } catch {}

    const allowed =
      /^(.+\.)?amazon\.[a-z.]{2,}$/.test(host) ||
      host === "amzn.to" ||
      host === "a.co" ||
      host === "goodreads.com" ||
      host.endsWith(".goodreads.com");
    if (!allowed) {
      return fail("Please paste an Amazon or Goodreads link.");
    }

    if (!process.env.GEMINI_API_KEY || !process.env.TAVILY_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY or TAVILY_API_KEY is missing." },
        { status: 500 },
      );
    }

    const pages = await extractPages(
      [link],
      "Book title, author, publication date, and the description of what the book is about",
    );
    const text = pages[0]?.content ?? "";
    if (text.length < 80) {
      return fail(
        "I could not read that page. Try the Goodreads link, or paste the description into Edit.",
      );
    }

    // The page must mention the author
    const tokens = name
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);
    if (tokens.length && !tokens.every((t) => text.toLowerCase().includes(t))) {
      return fail(`This page does not mention ${name}. Please check the link.`);
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = `Below is text from a book page (Amazon or Goodreads).

AUTHOR WE EXPECT: ${name}

PAGE TEXT:
${text.slice(0, 6000)}

Reply with a JSON object:
{
  "title": "the book's title only (no 'Kindle Edition', no store name)",
  "year": "the publication year as 4 digits, or an empty string if not shown",
  "bookWhy": "3 to 5 sentences: what the book is about, its main themes, the setting or characters, and who it is for"
}

Rules:
- Use ONLY facts found in the page text. Do not guess.
- Do NOT write about prices, sales, ranks or the number of reviews.
- If the page has no description of the book, set "bookWhy" to an empty string.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const out = response.text ?? "";
    const start = out.indexOf("{");
    const end = out.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return fail("Could not read the book details from that page.");
    }
    const data = JSON.parse(out.slice(start, end + 1));

    if (!data.bookWhy) {
      return fail(
        "No description was found on that page. Paste the description into Edit.",
      );
    }

    return NextResponse.json({
      title: String(data.title ?? ""),
      year: String(data.year ?? ""),
      bookWhy: String(data.bookWhy),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong while reading the page." },
      { status: 500 },
    );
  }
}
