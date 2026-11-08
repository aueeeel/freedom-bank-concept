# AI Coach

/coach.html uses existing employee profiles and the latest 100 completed non-demo reviews. RLS and verified user IDs restrict employees to their own profile; managers can select a team member. Topic ranking uses saved checklist weights, excludes N/A/incomplete criteria, and applies appeal decisions. Training never changes employee quality ratings. Only criteria with actual lost points can be practiced: there is no full checklist/course menu, no other-topic selector and no generic fallback. A rating such as 4/5 alone never creates a weakness. With no completed reviews, ask for an assessment first; with all maximum/NA results, show that no weaknesses were found.

## Modes

Prepared practice is free of model calls, uses fictional situations focused entirely on the selected weak skill and explicit employee self-review. Empathy scenarios keep exercising empathy throughout, without a closing or identification lesson. AI mode is opt-in, authenticated, and available only when GET /api/coach reports the dedicated server key and private budget storage configured. Without them the prepared practice remains usable. Chat history stays in page memory until navigation. The larger conversation pane opens each new detailed AI review at its first paragraph, including the final review, instead of scrolling past it to the next customer message.

The AI model is fixed to gpt-5.4-nano-2026-03-17, reasoning none, maximum 1,600 output tokens, one provider call per reply with a 35-second timeout and no automatic provider retries. Each practice has at most 6 employee answers; the AI input keeps only recent dialogue fitting 3,500 UTF-8 bytes. The complete provider request is capped at 8,500 bytes. No tools, web search, transcription or background calls are used. The server passes only the selected weak criterion and its aggregate mistake count, never raw employee transcripts, emails or review reasons. A basic email/number/key redactor also runs on practice text; users should still avoid customer data.

## Cost guard

A separate private Vercel Blob object, coach/private-budget-v1.json, uses ETag compare-and-swap reservations shared across deployments. Before each provider call it reserves one of 100 monthly calls (UTC), with 30 daily calls globally and 10 per authenticated account per UTC day; 3-second spacing applies per account. Concurrency cannot skip this reservation. Identical successful requests return the cached result without another provider call. Failed/uncertain calls remain counted; one manual retry is possible and also consumes a reservation. Pending duplicate requests do not start another call. Storage failure blocks paid requests. A failed cache write cannot refund a provider call.

The conservative planning reserve is USD 0.005/call, USD 0.50/month for this Coach path, based on bounded inputs/output and the verified 2026-11-08 model pricing. Actual token charges are normally lower. This is an application call cap, NOT an account-wide OpenAI billing limit: other apps using the same key/project are outside it, and future tariff changes require review. Vercel/Blob hosting costs are separate.

Sources: https://developers.openai.com/api/docs/models/gpt-5.4-nano and https://developers.openai.com/api/docs/guides/spend-limits . Set an enforced provider project limit separately if needed; spend alerts alone do not block calls.

## Deployment and credentials

Set COACH_OPENAI_API_KEY as a Production Secret in the Vercel project freedom-bank-concept and redeploy. The existing BLOB_READ_WRITE_TOKEN is used only by the server. OPENAI_API_KEY is deliberately ignored by Coach, so another application's existing key cannot be used accidentally. No key is stored in the browser, source repository or model prompts. Never put a key in coach-config.js or a public variable.

POST /api/coach: {employeeId,criterionId,messages:[{role:'assistant'|'user',text}]} plus Authorization: Bearer Supabase access token. Backend verifies Auth, derives manager membership from cqa_managers, independently checks employee ownership, and queries that employee's reviews through the same RLS-scoped bearer token. Client role/history claims are not trusted. The server also verifies a current loss for the chosen skill before checking cache or reserving budget; a forged or outdated unrelated skill is rejected with 409 without a provider call. Return: {customer,feedback,complete}. Feedback now explains what worked, what needs improvement and why, provides a complete better response, and recommends the next attempt. It targets 1,000–2,500 characters rather than a terse tip; parsing permits up to 6,000 feedback / 1,200 customer characters. Cache fingerprint version 2 avoids reusing prior short/general replies while preserving the existing monthly usage counter. Strict structured output is validated before display; React escapes returned text.

The supplied key was not used for live tests. Automated tests mock the provider, verify ownership/auth, origin, caps, cache, retries, storage failure, parallel reservations, prompt bounds/redaction and invalid model output. After the user saves a key, verify one real coaching reply and report its usage without exposing credentials.

Maintenance: this pinned model remains available until 2027-04-01 per OpenAI deprecations; review its successor and pricing before then. No automatic model fallback is allowed.
