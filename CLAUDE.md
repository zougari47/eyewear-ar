# Eyewear AR

Glasses try-on in the browser. Read `README.md` for the layout, the URL
switches and the model convention (metres, Y up, front +Z, origin at the
bridge centre). Every model is placed by that convention, with no per-model
adjustment.

- `src/core/` stays framework-free: it is built alone (`pnpm build:lib`)
  for embedding in other sites. React lives only in `src/components/` and `src/App.tsx`.
- `src/core/` started as a copy of `~/projects/personal/youzar/app/src/tryon/`
  (that project also holds the frame generator, which stays closed). It has
  since gained `TryOn.update()`, `setFaceShadow()` and `glassesInfo`. When you
  fix placement or tracking in one copy, tell the user so the other can follow.
- The MediaPipe conventions the placement relies on are documented at the top
  of `src/core/tracking.ts`.
- After `pnpm dlx shadcn add`, check the new files import `cn` from `@/lib/utils`;
  the CLI once wrote `from "cn"` (an unrelated npm package).

## Checking without a webcam

Screenshot with the system Chrome through puppeteer
(`~/projects/personal/youzar/app/scripts/screenshot.mjs <url> <out.png> [w h] [--camera=feed.mjpeg]`).
For camera mode, make a fake feed from a photo with
`ffmpeg -loop 1 -i face.jpg -t 6 -vf scale=640:-2 -r 15 -f mjpeg feed.mjpeg`,
and wait for page `load`, since a live camera never reaches network idle.
Radix tabs and toggles react to real mouse clicks (`elementHandle.click()`),
not `el.click()`. Software rendering runs at 1–3 fps; that is the test machine.

## Where things stand (2026-11-15)

- Public on GitHub, MIT licence. Commit and push only when the user asks.
- pnpm, with a global `minimum-release-age` of 7 days: a version newer than
  that will not install. Pick an older one instead of adding an exclusion.
- 3D models (`public/models/`) and photos (`public/sample.jpg`) are only on
  this machine and are gitignored. Ask the user which glasses may go public
  before committing any: the wayfarer models come from shop photos.
- Known bug: temples made of more than one material (`aviator-01`) load as a
  group whose child meshes have other names, so the renderer does not treat
  them as temples (no swing, no fade). The Model check shows it.
