---
name: prune-video-captures
description: Free disk space by deleting the screenshots of finished video captures under work-artifacts/, keeping transcripts, rewriting each capture-log.md as a tombstone, and logging the cleanup as an episodic memory. Use when the owner asks to prune, clean up, or shrink video captures.
---

# Prune Video Captures

A capture is a folder under `work-artifacts/<category>/<slug>/` holding `capture-log.md`, usually `transcript.*`, and `screenshots/` (layouts vary, e.g. `<date>/capture/` or `captures/<date>/`). Find them with `find work-artifacts -name capture-log.md`. All paths are relative to the instance root.

## 1. Plan

List each target capture with its screenshot count and size, and whether a report (`*.html`/`*.md` under `work-artifacts/<category>/<slug>/`, outside the capture) exists. Show the owner the totals and get approval before deleting; a capture with no report needs explicit approval.

## 2. Keep what reports use

Search the topic folder for links into the capture's `screenshots/` (`src=`/`href=`, Markdown links). Copy each referenced frame to `work-artifacts/<category>/<slug>/assets/<capture-date>-<frame>.jpg` (convert PNG to JPG), repoint the link, and confirm no references into `screenshots/` remain.

## 3. Delete and tombstone

- Delete `screenshots/` only. Keep transcripts and `capture-log.md` unless the owner asks for a full purge.
- Rewrite `capture-log.md` in place. Insert below the title:

  ```markdown
  > **Pruned YYYY-MM-DD:** `screenshots/` deleted (N frames, X MB); transcript kept.
  > Report: [<name>](<relative link>) · Kept frames: `../assets/...` (or none)
  > To restore: re-capture from the source URL (or `git checkout <sha> -- <path>` if history still holds it).
  ```

- In the frames table, replace each screenshot link with its plain name (e.g. `00-01-30`), keeping times and descriptions.

## 4. Log and verify

- Confirm every link in the edited reports and tombstones resolves.
- Log one `action` episode via the `memory` skill: `topics`: `["<category>/<slug>"]` (or `["housekeeping/video-captures"]` for a batch), title `Pruned video captures: <title or count>`, sources = the tombstone paths, body = frames and MB freed per capture.
- Report the space freed. Deleting tracked files doesn't shrink git history; say so if the files were committed.
