---
name: motion-video
description: House style and toolkit for Motion TikTok/IG videos rendered with three.js from recorded live transit data (MBTA, regional buses, Amtrak, ferries, planes). Use for any Motion video, whether a new one, a re-render or a variation, so every video starts from the same baseline look, data cleaning and verification rules.
---

# Motion video style (baseline)

This is the default look for every Motion video, set by "Monday's two rushes" (Boston, Oct 26 2026). Small variations per video are fine. Change the baseline only when the user says so.

## Setup (once per session)
1. Copy `toolkit/` into a working directory (the scratchpad, e.g. `scratchpad/rec/`) and keep its layout. Scripts use paths relative to that folder: `three/`, `mon/`, `ne/`, `a-ne/`, and `../tiktok/` for outputs.
2. Run `npm install three@0.160.0 playwright-core postprocessing@6.36.4 gsap@3.12.5 d3@7.9.0` in that directory. The renderer serves `/three/...` and `/nm/<pkg>/...` from its `node_modules`.
3. Chromium is pre-installed. The `.cjs` scripts hardcode `/opt/pw-browsers/chromium-1194/...`; fix the path if that version differs (`ls /opt/pw-browsers`).
4. Map tiles: `node bg.cjs ne/view-X.json ne/bg-X.png ne/bg-X-proj.json`. Run tiles one at a time, since parallel runs time out.
   - World tile: `view-ne.json`.
   - City tiles: a wide low-res tile plus a sharp one, both with rail lines drawn (`routeOpacity` 0.9, `lineWidth` 2.2, `noBoundaries`). The Boston examples are `view-boswt.json` and `view-bost.json`.

## Pipeline
1. **Record.** `rec-block.sh` (in the original rec folder) writes hour folders `day24/MMDD-HH/` (transit-clean.json, traffic/, extra/planes.jsonl …).
2. **Prep.** `python3 mon/prep-rush.py OUT day24/MMDD-HH …` writes `OUT-transit.json` and `OUT-planes.json`.
   - Box is Boston.
   - MBTA is drawn in full as fleet `mbta-hook`.
   - Planes are airborne only; on-ground fixes are dropped.
3. **Clean (always).** `python3 a-ne/clean.py IN OUT`:
   - Drops frozen-then-leap fixes, zigzags and spikes.
   - Eases rail and boat speeds.
   - Splits tracks that are still impossible; split pieces carry `e:1` so they end with no ghost hold.
   - Speed limits: 110 mph for commuter/Amtrak, 70 mph for subway and bus, 45 mph for boats.
4. **Count.** `python3 mon/counts.py transit.json curve.json` gives live counts every 2 min on the page's own "present" rule, and feeds the chart and the facts.
5. **Stops.** Write `mon/stops.json`. Each entry has clock, name, groups (null = all MBTA), unit, km, at, fact, dist, and legKeys.
6. **Job.** `python3 make-rush.py transit planes curve Y-M-D "label"` writes `job-rush.json`.
   - Only the clock jumps. A gap of over 3 h with no data is cut mid-flight; never show an empty data gap.
7. **Render.**
   - Test stills first: make a job copy with 1-frame slices.
   - Full render: `NODE_OPTIONS=--max-old-space-size=6144 node three-render.cjs job.json planes.json ne/bg-ne.png ne/bg-ne-proj.json OUTDIR 3`. Loop it; it resumes completed slices.
8. **Build.** `bash fix-and-build.sh job planes bg proj OUTDIR name` (adds a 3 s end card), then re-encode under 65 MB, e.g. `-crf 21 -maxrate 8M`. Check a contact sheet of frames before sending.

## Look (do not drift from this)
- **Rendering:** three.js 0.160. Post effects come from pmndrs `postprocessing`:
  - BloomEffect: threshold 0.62, smoothing 0.18, intensity 1.15, mipmapBlur, radius 0.55.
  - SMAA anti-aliasing.
  - Vignette: offset 0.32, darkness 0.5.
  - The glow covers only bright parts; no haze.
- **Map:** dark CARTO, no boundaries, rail lines on the ground in their line colors, map brightness 1.55 by day.
- **Vehicles:** small. Models are rail 0.25, boat 0.33, bus 0.16 × MS (MS = camD × 0.012).
  - Buses get a model plus a small dot, and no beam.
  - Rail and boats get a short beam (camD × 0.07) with 7 glow dots.
  - Long-exposure trails, 16 frames, cleared on clock jumps.
  - Planes are small, airborne only.
- **Color:** each agency's or line's real color. Focus states brighten the vehicle's own color and never recolor it.
- **Text (Inter):**
  - Small place name.
  - One hero number (132 px): GSAP counts it up, then it follows the live count. Whole-system stops use the chart's value so the two always match.
  - The unit in secondary ink.
  - A color key: swatch plus name, with text in neutral ink.
  - One fact line.
  - Scrims behind the text at the top and bottom.
- **Chart:** a d3 live line and area chart of the main count under the clock. It draws up to the current time, with a dot plus the value, gaps between recorded windows, and headroom so the value never hits the title.
- **Legend:** always on at the bottom. Bus / Train / Boat / Plane shapes, plus "Color = transit agency · beam = live position".
- **Motion:** one continuous camera that lowers and orbits at each stop (tilt about 66–69); GSAP label entrances on a paused timeline seeked to frame/24, so renders are deterministic.
- **Format:** 1080×1920 at 24 fps, about 60 s unless the user asks otherwise.

## Truth rules (non-negotiable)
- Every on-screen number and every caption stat is computed from the recorded data with the same counting rule the page uses, and checked before use. If two methods disagree, soften the wording (e.g. "rush" instead of "peak").
- Check feed coverage before calling anything verified. Known traps:
  - Regional feeds were missing 2–3 PM on Thu 10/22.
  - Bus and train speed values are unreliable; don't publish speed stats.
  - Plane coverage is Boston-centric.
- Weather only from official sources (NWS CLI / IEM METARs), and only if asked. A wrong weather claim already cost the user publicly.

## Captions
Short hook line, then 3–5 bullets that match exactly what's on screen, then a question to drive comments, then hashtags. Don't add stats the video doesn't show. Proofread the hashtags.
