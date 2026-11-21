---
name: watch-video
description: Watch a supplied video using available browser or media tools, save the transcript, timestamped screenshots, and capture log under the local folder's work-artifacts/, and log the viewing as an episodic memory via thoth-mem. Use for collecting video material before a separate analysis task.
---

# Watch Video

The only input is a video URL or file. Collect what is said and shown; don't ask for questions or produce analysis.

## 1. Open

- Use the host's supported browser or media tools, following its selection rules and the user's preference; read their docs and don't assume tool names or OS. On failure, use an allowed fallback and log why. Respect access blocks. If nothing can inspect the video, record the source and limitation without claiming a viewing.
- Confirm title, source, and runtime; get past ads; verify the right video plays. Test pause and seek before relying on them.

## 2. Where things go (local folder as base)

**Always use the local workspace folder (the active instance root) as the base folder for all created artifacts and memory calls** — never save final captures to `/tmp`, Desktop, or outside the local folder.

1. First check existing topics via [memory](../memory/SKILL.md) (`thoth-mem topics` or `thoth-mem search "<video url or title>"`, using the local folder as `--root`; confirm the exact URL in the hit's `sources` before treating it as a repeat viewing). Reuse one lowercase `<category>/<slug>` topic per video (e.g. `media/<slug>`, `software-engineering/<slug>`, or a research category).
2. Save captures inside the local folder at `work-artifacts/<topic>/<YYYY-MM-DD>/capture/` (never overwrite an existing capture folder; use `capture-2/`, etc. for repeat viewings on the same day):

```text
<local-folder>/work-artifacts/<topic>/<YYYY-MM-DD>/capture/
  capture-log.md
  transcript.<original-extension>   # only if obtained
  screenshots/HH-MM-SS.<ext>        # only if obtained
```

In `capture-log.md`, link sibling files relative to `capture-log.md` (`transcript.<ext>`, `screenshots/HH-MM-SS.<ext>`) so links stay valid if moved.

## 3. Transcript

- Prefer a caption export, else the platform's timestamped transcript. Note its language.
- Confirm it matches this video and runs start to end with continuous timestamps; file size isn't proof. Spot-check against audio when possible and log whether checks were structural or audio. Flag uncertain text instead of fixing it.
- If none is available, log that and continue. Never invent speech.

## 4. Frames

- On YouTube, enable English captions (auto-generated or translated if needed; log it) and keep them visible.
- Capture in order at 0s, every 15s, and near the end, plus extra frames for notable changes. Keep repeated slides.
- Per frame: seek, let it render, verify the actual time, capture. Log deviations from the target. Label any thumbnail or storyboard substitutes.
- Name each screenshot `HH-MM-SS.<ext>` from the verified playback position, adding a suffix on collisions, and keep precise offsets in the log. Create only artifacts actually obtained.
- Log each frame chronologically with its link and a literal description. Record failures and gaps; don't infer between frames. If a control fails, try another; if still blocked, save what you have and state the missing coverage.

## 5. Log viewing & verify

Follow [memory](../memory/SKILL.md) to record one minimal `action` episode via `thoth-mem --root <local-folder> create --json <<'EOF'` (every viewing gets one, including partial or blocked attempts — no summary or analysis, just title, runtime, extent viewed, and links).

- **Title:** `"Watched video: <Title>"` (or `"Attempted video (blocked): <Title>"` when nothing could be inspected).
- **`sources`:** Include the video URL plus **only the artifacts actually created**, expressed as paths relative to the local folder (e.g. `work-artifacts/<topic>/<YYYY-MM-DD>/capture/capture-log.md`; omit transcript or screenshots if not obtained).

```sh
thoth-mem create --json <<'EOF'
{
  "kind": "action",
  "topic": "<category>/<slug>",
  "title": "Watched video: <Title>",
  "tags": ["video", "capture"],
  "sources": [
    "<video-url>",
    "work-artifacts/<topic>/<YYYY-MM-DD>/capture/capture-log.md"
  ],
  "body": "Watched *<Title>* (runtime MM:SS; sampled by seeking / watched continuously / partial).\n\nTranscript: <status>. Screenshots: <count>. Gaps: <none or details>."
}
EOF
```

When a separate report or analysis is built from the video later, save it under `<local-folder>/work-artifacts/<topic>/<Readable report name>.html` (or `.md`) and log a new `action` episode citing both the report and the capture.

Before finishing, verify that every local file path listed in `capture-log.md` and `sources` exists under `<local-folder>/work-artifacts/` (URLs stay as URLs; blocked attempts with no captures only cite the video URL), and return clickable links to the episode, capture folder, transcript status, screenshot count, and any gaps. No summary or analysis.
