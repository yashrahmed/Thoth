---
name: watch-video
description: Watch a supplied video using available browser or media tools, save the transcript, timestamped screenshots, and capture log under work-artifacts/, and log the viewing as an episodic memory via the memory skill. Use for collecting video material before a separate analysis task.
---

# Watch Video

Input: a video URL or file. Collect what is said and shown; don't ask questions or analyze. All paths are relative to the folder you launched from (the instance root); create folders as needed and never save captures outside it.

## 1. Open

- Use the host's browser/media tools per its selection rules and the user's preference; read their docs, don't assume tool names or OS. On failure, use an allowed fallback and log why. Respect access blocks; if nothing can inspect the video, record the source and limitation without claiming a viewing.
- Confirm title, source, and runtime; get past ads; verify the right video plays. Test pause and seek before relying on them.

## 2. Topic and folder

- Via the `memory` skill, check topics and search for the URL or title (it's a repeat viewing only if the exact URL is in a hit's `sources`). Reuse one lowercase `<category>/<slug>` topic per video.
- Save to `work-artifacts/<topic>/<YYYY-MM-DD>/capture/` (`capture-2/`, … for same-day repeats; never overwrite): `capture-log.md`, plus `transcript.<original-ext>` and `screenshots/HH-MM-SS.jpg` only if obtained. In `capture-log.md`, link siblings relative to it.

## 3. Transcript

- Prefer a caption export, else the platform's timestamped transcript; note its language.
- Confirm it matches this video end to end with continuous timestamps (file size isn't proof). Spot-check against audio when possible and log whether checks were structural or audio. Flag uncertain text; don't fix it.
- None available → log that and continue. Never invent speech.

## 4. Frames

- Turn captions on and keep them visible (prefer the user's language; log if auto-generated or translated).
- Capture in order at 0s, every 15s, near the end, and at notable changes; keep repeated slides.
- Per frame: seek, let it render, verify the actual time, capture. Save it as JPG (quality ~80, at most 1280 px wide), named `HH-MM-SS.jpg` from the verified time (suffix on collisions); log precise offsets, deviations, and any thumbnail/storyboard substitutes.
- Log frames in order with relative links and literal descriptions. Record gaps; don't infer between frames. If a control fails, try another; if still blocked, save what you have and state the missing coverage.

## 5. Log and verify

Every attempt, even partial or blocked, gets one `action` episode via the `memory` skill (no summary or analysis):

- `topics`: `["<category>/<slug>"]` (plus any related topics)
- `title`: `Watched video: <Title>`, or `Attempted video (blocked): <Title>`
- `sources`: the video URL (or the local file's name) plus only artifacts actually created, as instance-relative paths
- `body`: runtime, extent viewed (sampled by seeking / continuous / partial), transcript status, screenshot count, gaps

Verify every local path in `capture-log.md` and `sources` exists under `work-artifacts/`. Return links to the episode and capture folder, plus transcript status, screenshot count, and gaps.

A later report built from the capture goes to `work-artifacts/<topic>/<Readable report name>.html` (or `.md`), with a new `action` episode citing both report and capture. Frames the report shows are copied to `work-artifacts/<topic>/assets/` and linked there, never into `screenshots/`.
