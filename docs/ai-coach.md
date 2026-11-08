# AI Coach

Page: /coach.html. No AI credentials or provider is configured. The current practice uses prepared customer messages, examples and employee self-review; it never claims to automatically evaluate free text. Practice stays in React memory and does not affect employee ratings or conversations.

Personal topics come from the latest 100 completed, non-demo reviews available through the existing authenticated Supabase client and RLS. Only the selected employee is queried. Employee access is narrowed to the verified user ID; managers can select a team member. Transcripts, emails and customer data are not loaded for topic selection. Criteria use their saved checklist, normalized loss and weight; gross errors get priority. N/A and incomplete reviews are excluded; accepted appeal decisions replace original values. No missing history is represented as a weakness.

## Future model integration

Set coach-config.js endpoint to a SAME-ORIGIN authenticated backend route only after implementing it, e.g. /api/coach. Keep provider credentials server-side. Existing CQA analysis/transcription settings are independent. The UI does not call a missing endpoint.

POST body: {employeeId, criterionId, messages: [{role: 'user'|'assistant', text}]}. Authorization: Bearer Supabase access token. Frontend caps 40 messages and 4,000 characters per message and supports cancellation and retry.

Response: {customer: string, feedback: string, complete: boolean}. Customer <=4,000 characters, feedback 1..6,000 characters. Non-final customer messages must be non-empty. The adapter validates the response; React renders all text escaped. No HTML or tool commands are executed.

The backend MUST verify the token against Supabase Auth, derive the user's role from cqa_managers, allow an employee only their linked cqa_employees row, and independently authorize a manager's target. Never trust employeeId, criterionId, messages or client role claims. Load the authorized employee's reviews server-side; reject invalid criteria, enforce rate/size limits and validate model output. Treat stored transcripts and user replies as untrusted data, never instructions. Redact customer identifiers; send only minimum needed context to the chosen provider. Avoid invented bank tariffs, policies, promises and requests for credentials. Generate fictional practice situations and give explicit correction plus a better answer. Keep practice results separate from quality ratings.

There is deliberately no server endpoint or new database table in this change. A model cannot be enabled by a client key. Reopening/navigating resets practice; session persistence and training analytics can be added with appropriate owner RLS when requested.
