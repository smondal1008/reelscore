# Open-data imports

These scripts add titles to Firestore from sources whose licences allow commercial use (ads included):

| Source | Licence | What we take | Credit shown |
|---|---|---|---|
| Wikidata | CC0 (public domain) | Indian films: title, release date, languages, genres, runtime, director, cast, music director, IMDb ID | "Film facts from Wikidata" on the title page, plus the About page and footer |
| TVmaze | CC BY-SA 4.0 | Indian TV shows: title, dates, channel, genres, summary, poster image, cast | "Show details and image from TVmaze (CC BY-SA 4.0)" with a link on every imported show, plus the About page and footer |

Not used: Wikipedia posters (fair-use only), IMDb data (non-commercial only), TMDB (needs a paid commercial licence once the site earns money).

## How to run

1. Sign in to the site as an admin and open any page (the scripts use `window.claude.use('db')`).
2. Open the browser console and paste `wikidata-films.js` or `tvmaze-shows.js`.
3. Run `await ReelImport.preview()` to see what would be added, then `await ReelImport.write()`.

Both scripts:
- skip anything already in the catalogue (same normalised title within a year, or the same slug);
- never overwrite an existing document (they only create new ones);
- mark imported docs with `source`, `importedAt`, and `wikidata` / `tvmazeId` + `srcTvmaze` so the credit line and later refreshes work.

Imported titles with no synopsis, poster, videos or verdicts are built as `noindex` and left out of the sitemap
(`scripts/build.mjs`, `thinTitle`). They join the index automatically once a synopsis or other content is added.
