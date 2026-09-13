import { NewsClient } from "@/components/news-client";
import { getActiveNewsPayload } from "@/lib/news";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const payload = await getActiveNewsPayload();
  const initial =
    payload.source !== "demo" && payload.items?.length
      ? {
          items: payload.items.map((n) => ({
            id: n.id,
            title: n.title,
            link: n.link,
            source: n.source,
            publishedAt: n.publishedAt,
            summary: n.summary,
          })),
          builtAt: payload.builtAt,
        }
      : null;

  return <NewsClient initial={initial} />;
}
