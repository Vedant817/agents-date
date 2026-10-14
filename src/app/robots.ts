import type { MetadataRoute } from "next";

/**
 * Run pages render pasted profile text verbatim. They open by unguessable
 * link, but defense in depth says crawlers should never index them: run
 * pages and the API stay out, everything else is crawlable.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/run/", "/api/"],
      },
    ],
  };
}
