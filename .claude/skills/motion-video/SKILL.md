---
name: motion-video
description: House style and toolkit for Motion TikTok/IG videos rendered with three.js from recorded live transit data (MBTA, regional buses, Amtrak, ferries, planes). Use for any Motion video, whether a new one, a re-render or a variation, so every video starts from the same baseline look, data cleaning and verification rules.
---

# Motion video style (baseline)

Default for every Motion video. Set by "Just planes" (Logan, Monday Oct 26 2026), which replaced the earlier "Monday's two rushes" baseline. Small variations per video are fine. Change the baseline only when the user says so.

## The one rule
The animation is the proof. Text tells you where to look and when, nothing else. If the viewer needs a sentence to see the point, the shot is wrong; fix the camera, not the caption.

## Setup (once per session)
1. Copy `toolkit/` into a working directory (the scratchpad, e.g. `scratchpad/rec/`) and keep its layout. Scripts use paths relative to that folder: `three/`, `pl/`, `mon/`, `ne/`, `a-ne/`, `data/`, `fonts/`, and `../tiktok/` for outputs.
2. `npm install three@0.160.0 playwright-core postprocessing@6.36.4 gsap@3.12.5 d3@7.9.0` in that directory. The renderer serves `/three/...` and `/nm/<pkg>/...` from `node_modules`, `/fonts/` and any other folder listed in the job's `assets`.
3. Chromium is pre-installed. The `.cjs` scripts hardcode `/opt/pw-browsers/chromium-1194/...`; fix the path if that version differs (`ls /opt/pw-browsers`).
4. Map tiles: `node bg.cjs ne/view-X.json ne/bg-X.png ne/bg-X-proj.json`, one at a time. Dark CARTO, no labels, no boundaries, rail lines drawn in their line colours (`routeOpacity` 0.9, `lineWidth` 2.2).
   - Render base for Boston 3D videos: `view-crowd.json` (zoom 10.2). Sharp patches: `view-day-hi.json` (12.2, the core) and `view-logan-hi.json` (12.6, the airport). Pass the base as the renderer's bg/proj args and the patches as `hi` / `his` in the job.

## Pipeline
1. **Record.** `rec-block.sh` writes hour folders `day24/MMDD-HH/` (transit-clean.json, traffic/, extra/planes.jsonl, extra/crowding.jsonl, extra/bikes.jsonl …). See the recording rules below.
2. **Prep.** One small script per layer, per day:
   - Planes: `python3 pl/prep-planes-day.py MMDD pl/planes.json` (tracks + every landing/takeoff as an event; prints the counts you may quote).
   - Rail background: `python3 pl/prep-rail-day.py MMDD pl/rail.json` (subway + commuter rail, cleaned).
   - Boston rush (buses, boats, everything): `python3 mon/prep-rush.py OUT day24/MMDD-HH …` then `python3 a-ne/clean.py IN OUT`.
3. **Clean (always).** `a-ne/clean.py` drops frozen-then-leap fixes, zigzags and spikes, eases rail and boat speeds, splits tracks that are still impossible (split pieces carry `e:1`). Limits: 110 mph commuter/Amtrak, 70 mph subway and bus, 45 mph boats.
4. **Shot list first.** Write it as a table (video seconds, clock, camera, the one line) and get it approved before rendering anything. `make-planes.py` is the template: `segs` map video seconds to the clock, `keys` are camera keyframes, `lines` are the captions.
5. **Job.** `python3 make-planes.py` writes `job-planes.json`; `python3 make-planes.py 30,700,1300` writes a 1-frame-per-slice test job.
6. **Render.** Test stills first, always, and look at them on a contact sheet. Full render: `NODE_OPTIONS=--max-old-space-size=6144 node three-render.cjs job.json pl/planes.json ne/bg-crowd.png ne/bg-crowd-proj.json OUTDIR 3`, looped so it resumes finished slices. Run it as a tracked background job.
7. **Build.** `bash fix-and-build.sh job planes bg proj OUTDIR name` (repairs dropped frames, adds the 3 s end card), then re-encode under 65 MB (`-crf 22 -maxrate 7M`). Check a contact sheet of the finished file before sending.

## Look (do not drift from this)
- **Rendering:** three.js 0.160, `three/planes.html` as the base page (the older `rush.html` and `day.html` are kept for reference). UnrealBloom 0.36 / threshold 0.6, fog, sky dome.
- **One continuous camera.** Only the clock jumps, and when it jumps the line says so ("Nothing recorded between nine and three"). Never show an empty data gap.
- **Light follows the real sun.** The page computes Boston's solar position from the clock: long shadows at 6 am, short at noon, sunset glow, none after dark.
- **Buildings and shadows.** `data/boston-massing.json` (downtown, from the lab repo's boston-massing model) plus `data/airport-bld.json` (Logan terminals), extruded at 1.8× height, casting shadows on the ground and on each other. Logan runways and footprint from `data/airport.json`; runways light up in the colour of the plane using them.
- **Vehicles:** small. Planes amber when landing, teal when taking off, grey when passing over, with an altitude beam and a long contrail. Rail in its line colours, dimmed to about half when it is background. Buses get a model plus a dot and no beam.
- **Text, and the limit is strict:** the clock top-left and one short line bottom-left. Nothing else on the frame: no title card, no kicker, no hero number, no chart, no colour key, no legend, no fact card, no pins unless the camera is following that one thing.
  - Clock and date: IBM Plex Mono, lowercase (`6:01 am`, `monday, october 26`).
  - The line: IBM Plex Serif Medium, 38 px, left-aligned, thin dark edge, no glow.
  - Credit: 14 px Plex Mono, bottom-left, lowercase.
  - Fonts ship in `toolkit/fonts/`; never fall back to Inter or a system sans.
- **Voice of the lines:** written like a person, specific, no colons, no middle dots, no "X: Y" stat phrasing, no closing question. Numbers in words where they read better ("Before seven, 31 planes left and 11 came in."). Every number is verified first (below).
- **End card:** 3 s, blurred last frame, "MOTION Boston" in Plex Mono. No "link in bio", no portfolio line.
- **Format:** 1080×1920 at 24 fps, 65 s including the end card, under 65 MB.
- **Series shape:** one subject per video (just planes, just the MBTA, commuter rail, regional buses, boats), plus the occasional story video (a comparison, the week's oddities). Charts and summaries are not videos; they go in the caption or a carousel.

## Avoiding the "Claude format"
Viewers recognise the defaults. Do not use: Inter or any system sans; letter-spaced uppercase kickers; glowing white text; translucent cards with a coloured label; centred hero numbers; charts over the map; middle dots between facts; "Here's what the data caught"; a question as the last line; "Link in bio". Prefer: one unusual type pairing (mono clock, serif line), lowercase, specific sentences, and silence.

## Recording rules (non-negotiable)
- Start every recording block as a tracked background job (the Bash tool with `run_in_background`).
- Never use `setsid`, `nohup`, `&` or any other detached process. In a cloud session the container may stop while the session is idle unless a tracked job is running, and that kills detached processes mid-hour. On Fri 10/30 this lost 4:10–5:00 and 6:10–7:00 PM.
- A tracked job lives at most 2 hours, so launch each block no more than about 1 hour before its start time.
- Never change a recording setup that works during a live capture. Test any change on a throwaway block first.
- If a check-in fires late, start the hour right away with `rec-block.sh resume`, and log the gap in the plan.

## Truth rules (non-negotiable)
- Every on-screen number and every caption stat is computed from the recorded data with the same counting rule the prep script prints, and checked before use. If two methods disagree, soften the wording.
- Say what was not recorded. A clock jump over a gap gets a line.
- Check feed coverage before calling anything verified. Known traps: regional feeds were missing 2–3 PM on Thu 10/22; bus and train speed values are unreliable, don't publish speed stats; plane coverage is Boston-centric; Friday 10/30 evening has two gaps.
- Weather only from official sources (NWS CLI / IEM METARs), and only if asked.
- Causes need two outside sources or they are cut.

## Captions
Short hook line, then 3–5 bullets with the numbers the video earned (the per-hour counts, the wind, the gaps), then hashtags. Don't add stats the video doesn't show the proof for. Proofread the hashtags.
