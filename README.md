# Email Preflight (hosted)

Same setup as InvestorScript: static page + one Vercel function that holds the API key.

    public/index.html      the app (unchanged look; now calls /api/review)
    api/review.js          proxy to the Claude API (streams the report back)
    api/_instructions.js   the reviewer instructions (moved server-side, hidden from the public page)
    vercel.json            5-min function timeout + which sites may embed it

## Deploy
1. New GitHub repo (e.g. `EmailPreflight` under fivefoottwomarketing), push this folder.
2. Import into Vercel. Framework preset: Other. Output directory: `public`.
3. Environment variables:
   - `ANTHROPIC_API_KEY` (required)
   - `ACCESS_CODE` (optional; if set, users are asked for it once per browser)
   - `ANTHROPIC_MODEL` (optional; defaults to claude-sonnet-5-5)
4. In `vercel.json`, embedding is already allowed for fivefoottwomarketing.com; add any other domain there if needed.

## Squarespace
Add a Code block:

    <iframe src="https://YOUR-PROJECT.vercel.app" style="width:100%;height:1400px;border:0" title="Email Preflight"></iframe>
