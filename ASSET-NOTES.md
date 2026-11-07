# Demo team portraits

- Project asset: `assets/team-portraits.png`.
- Mode: built-in ImageGen, one 2×2 portrait atlas; the component displays each cell inside its circular portrait crop without altering the file.
- People and names are fictional. The employees page explicitly identifies the profiles as a demonstration. These portraits do not represent actual Freedom Bank employees.
- Original generated file: `C:/Users/arail/.codex/generated_images/01a1b564-2c9e-7ce1-a4a6-76006001b02b/exec-4d6d0977-ac0d-4b9e-86a8-be34fa98f795.png`.

## Final generation prompt

Create ONE production web asset: a four-avatar portrait atlas, 2 by 2 grid of exactly equal square panels, clean straight boundaries without gutters. Each panel is an independent close-up head-and-shoulders editorial studio portrait of a different fictional young Central Asian professional, friendly natural expression, realistic skin texture, contemporary understated business casual clothing, no logos, no lettering, no accessories covering the face. Top left: woman around 30 with straight dark shoulder-length hair, cream blazer. Top right: man around 32 with short dark hair, charcoal shirt. Bottom left: woman around 28 with dark hair tied back, pale green blouse. Bottom right: man around 35 with neat short hair and subtle stubble, light grey jacket. All four faces centered in their own panel and at the same scale, ample soft pale sage background on each panel, consistent soft studio lighting, polished warm human feel. Portraits will be cropped in circles on fictional employee badges. Four equal panels, 2x2, square full canvas. No text, watermark, badge artwork or borders. This is a fictional demo team, not actual employees of any bank.

## Component provenance

`src/TeamLanyardRail.tsx` is adapted from the complete React component pasted by the user in this chat. Its spring simulation, badge rendering, flip, stretch, drag, keyboard controls, and mobile carousel are retained. Local changes add a portrait-atlas cell index, Russian labels, readable badge scaling, and accessibility visibility for badge faces. The site itself remains a static HTML/CSS/JavaScript deployment; the React bundle is loaded only on `employees.html`.

## Shared background video, version 2

- User-supplied source: `C:/Users/arail/Downloads/neon-water-waves-v2.mp4`.
- Deployed unchanged as `assets/background-waves-v2.mp4` on the main page.
- Duration: 6 seconds. Original frame: 1448 × 1088.
- `assets/background-waves-v2-poster.jpg` is a frame captured from this video for loading and reduced-motion fallback. No generated imagery is used for the background.
- Secondary pages now use Wave Mesh; the badge rail has a transparent background.

## CQA components supplied by the user

- `wave-background.js` adapts the Wave Mesh component in attachment `d2e1cac2-5ad1-43ca-8529-793338d83c2d/Вставленный текст.txt` to vanilla JavaScript, black/green colours, reduced motion and bounded canvas rendering. Used on employees and check pages.
- `src/qa-app.tsx` and `qa.css` adapt the floating rounded composer from PromptBox attachment `90c0dc23-f38a-491f-aa25-09b2f8b59eb5/Вставленный текст.txt`. Image-generation controls were replaced with transcript/audio attachments and CQA actions.
- Examples are fictional. User documents and local test fixtures are excluded from the deployed manifest.
- PDF.js is Apache-2.0; bundled legal comments are retained. Its reader and worker load locally without an external document service.
