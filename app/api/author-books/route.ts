import { NextResponse } from "next/server";

export const maxDuration = 60;

// Only books from the last 2 years count as "recent"
const MIN_YEAR = new Date().getFullYear() - 3;

type Book = {
  title: string;
  subtitle: string;
  year: string;
  description: string;
  source: string;
  link: string;
  recent: boolean;
};

type Volume = {
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    description?: string;
    publishedDate?: string;
    infoLink?: string;
  };
};

type OlDoc = {
  title?: string;
  subtitle?: string;
  first_publish_year?: number;
  author_name?: string[];
  key?: string;
};

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function googleSearch(
  q: string,
  max: number,
  newest = false,
): Promise<Volume[]> {
  const key = process.env.GOOGLE_BOOKS_API_KEY
    ? `&key=${process.env.GOOGLE_BOOKS_API_KEY}`
    : "";
  const order = newest ? "&orderBy=newest" : "";
  try {
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
        q,
      )}&printType=books&maxResults=${max}${order}${key}`,
    );
    if (!res.ok) {
      console.log("Google Books status:", res.status);
      return [];
    }
    const data = await res.json();
    return data.items ?? [];
  } catch {
    return [];
  }
}

async function openLibrary(name: string): Promise<OlDoc[]> {
  try {
    const res = await fetch(
      `https://openlibrary.org/search.json?author=${encodeURIComponent(
        name,
      )}&sort=new&limit=20&fields=title,subtitle,first_publish_year,author_name,key`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.docs ?? [];
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  try {
    const { authorName } = await req.json();
    const name = String(authorName || "").trim();
    if (name.length < 3) {
      return NextResponse.json(
        { error: "Missing author name." },
        { status: 400 },
      );
    }

    const tokens = norm(name)
      .split(" ")
      .filter((t) => t.length > 1);
    const isHis = (authors: string[]) =>
      authors.some((a) => tokens.every((t) => norm(a).includes(t)));

    const books: Book[] = [];
    const seen = new Set<string>();
    const add = (b: Omit<Book, "recent">) => {
      const k = norm(b.title.split(":")[0]);
      if (!k || seen.has(k)) return;
      seen.add(k);
      const y = parseInt(b.year, 10) || 0;
      books.push({ ...b, recent: y >= MIN_YEAR });
    };

    // Google Books (newest first) and Open Library, both at the same time
    const [google, ol] = await Promise.all([
      googleSearch(`inauthor:"${name}"`, 20, true),
      openLibrary(name),
    ]);

    for (const it of google) {
      const v = it.volumeInfo ?? {};
      if (!v.title || !isHis(v.authors ?? [])) continue;
      add({
        title: v.title,
        subtitle: v.subtitle ?? "",
        year: String(v.publishedDate ?? "").slice(0, 4),
        description: String(v.description ?? "").slice(0, 1200),
        source: "Google Books",
        link: v.infoLink ?? "",
      });
    }

    for (const d of ol) {
      if (!d.title || !isHis(d.author_name ?? [])) continue;
      add({
        title: d.title,
        subtitle: d.subtitle ?? "",
        year: d.first_publish_year ? String(d.first_publish_year) : "",
        description: "",
        source: "Open Library",
        link: d.key ? `https://openlibrary.org${d.key}` : "",
      });
    }

    // Recent books first, then the newest year, then the ones with a description
    const score = (b: Book) =>
      (b.recent ? 1000000 : 0) +
      (parseInt(b.year, 10) || 0) * 10 +
      (b.description ? 5 : 0);
    const top = [...books].sort((a, b) => score(b) - score(a)).slice(0, 3);

    // For books with no description, ask Google Books again by title
    await Promise.all(
      top.map(async (b) => {
        if (b.description) return;
        const main = b.title.split(":")[0];
        const items = await googleSearch(
          `intitle:"${main}" inauthor:"${name}"`,
          5,
        );
        for (const it of items) {
          const v = it.volumeInfo ?? {};
          if (!isHis(v.authors ?? [])) continue;
          if (!norm(v.title ?? "").includes(norm(main))) continue;
          if (v.description) {
            b.description = String(v.description).slice(0, 1200);
            b.source = "Google Books";
            if (v.infoLink) b.link = v.infoLink;
          }
          if (!b.subtitle && v.subtitle) b.subtitle = v.subtitle;
          if (b.description) break;
        }
      }),
    );

    return NextResponse.json({
      books: top,
      anyRecent: top.some((b) => b.recent),
      minYear: MIN_YEAR,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong while looking for books." },
      { status: 500 },
    );
  }
}
