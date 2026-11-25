"""Self-contained HTML weekly check-in renderer for `health-track`.

- Zero external requests, scripts, or fonts.
- Uses host theme CSS variables (with light/dark standalone fallbacks).
- No outer page background/border/padding (compatible with inline host renderers).
- Missing days are rendered explicitly as unknown (`—` / hatched empty slots),
  never as zero.
- Every nutrition figure is labeled as an estimate.
"""

from __future__ import annotations

import html
from datetime import date
from typing import Any


def esc(val: Any) -> str:
    return html.escape(str(val), quote=True)


def fmt_num(val: float | int | None, unit: str = "", *, signed: bool = False) -> str:
    if val is None:
        return "Unknown"
    num = float(val)
    body = f"{int(num)}" if num.is_integer() else f"{num:.1f}"
    if signed:
        if num > 0:
            body = f"+{body}"
    return f"{body}{unit}"


def short_day(iso_date: str) -> tuple[str, str]:
    d = date.fromisoformat(iso_date)
    return d.strftime("%a"), d.strftime("%b %d").replace(" 0", " ")


def render_weight_svg(days: list[dict[str, Any]], baseline_kg: float | None) -> str:
    w, h = 680, 144
    pad_l, pad_r, pad_t, pad_b = 48, 66, 20, 26
    plot_w = w - pad_l - pad_r
    plot_h = h - pad_t - pad_b

    vals = [d["weight_kg"] for d in days if d["weight_kg"] is not None]
    all_y = list(vals)
    if baseline_kg is not None:
        all_y.append(float(baseline_kg))
    if not all_y:
        return '<p class="empty">No weight readings logged in this window (all days unknown).</p>'

    ymin = min(all_y) - 1.0
    ymax = max(all_y) + 1.0
    if ymax - ymin < 2.0:
        mid = (ymax + ymin) / 2.0
        ymin, ymax = mid - 1.0, mid + 1.0

    def x_at(idx: int) -> float:
        if len(days) <= 1:
            return pad_l + plot_w / 2
        return pad_l + (plot_w * idx / (len(days) - 1))

    def y_at(v: float) -> float:
        return pad_t + plot_h * (1.0 - (v - ymin) / (ymax - ymin))

    parts = [f'<svg class="chart" viewBox="0 0 {w} {h}" role="img" aria-label="Weight trend">']
    for gv in (ymin, (ymin + ymax) / 2.0, ymax):
        gy = y_at(gv)
        parts.append(f'<line x1="{pad_l}" y1="{gy:.1f}" x2="{w - pad_r}" y2="{gy:.1f}" class="grid"/>')
        parts.append(f'<text x="{pad_l - 8}" y="{gy + 4:.1f}" text-anchor="end" class="axis">{gv:.1f}</text>')

    if baseline_kg is not None:
        by = y_at(float(baseline_kg))
        parts.append(f'<line x1="{pad_l}" y1="{by:.1f}" x2="{w - pad_r}" y2="{by:.1f}" class="ref-line"/>')
        parts.append(
            f'<text x="{w - pad_r + 6}" y="{by + 3.5:.1f}" text-anchor="start" class="ref-label">'
            f'Base {fmt_num(baseline_kg)}</text>'
        )

    seg: list[str] = []
    for i, d in enumerate(days):
        if d["weight_kg"] is not None:
            seg.append(f"{x_at(i):.1f},{y_at(float(d['weight_kg'])):.1f}")
        else:
            if len(seg) >= 2:
                parts.append(f'<polyline points="{" ".join(seg)}" class="series-line"/>')
            seg = []
    if len(seg) >= 2:
        parts.append(f'<polyline points="{" ".join(seg)}" class="series-line"/>')

    for i, d in enumerate(days):
        cx = x_at(i)
        dow, md = short_day(d["date"])
        parts.append(f'<text x="{cx:.1f}" y="{h - 7}" text-anchor="middle" class="axis">{esc(dow)} {esc(md)}</text>')
        if d["weight_kg"] is not None:
            cy = y_at(float(d["weight_kg"]))
            parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="4.5" class="series-dot"/>')
            parts.append(
                f'<text x="{cx:.1f}" y="{cy - 9:.1f}" text-anchor="middle" class="pt-label">'
                f'{fmt_num(d["weight_kg"])}</text>'
            )
        else:
            parts.append(
                f'<text x="{cx:.1f}" y="{pad_t + plot_h - 6:.1f}" text-anchor="middle" class="unk-mark">—</text>'
            )

    parts.append("</svg>")
    return "".join(parts)


def render_protein_svg(days: list[dict[str, Any]], target_g: float | None) -> str:
    w, h = 680, 148
    pad_l, pad_r, pad_t, pad_b = 44, 66, 20, 26
    plot_w = w - pad_l - pad_r
    plot_h = h - pad_t - pad_b

    vals = [float(d["protein_g"]) for d in days if d["protein_g"] is not None]
    ceiling = max(vals + ([float(target_g)] if target_g is not None else []) + [100.0]) * 1.18
    n = max(len(days), 1)
    slot_w = plot_w / n
    bar_w = min(42.0, slot_w * 0.56)

    def y_at(v: float) -> float:
        return pad_t + plot_h * (1.0 - v / ceiling)

    parts = [f'<svg class="chart" viewBox="0 0 {w} {h}" role="img" aria-label="Daily protein vs target">']
    for frac in (0.0, 0.5, 1.0):
        gv = ceiling * frac
        gy = y_at(gv)
        parts.append(f'<line x1="{pad_l}" y1="{gy:.1f}" x2="{w - pad_r}" y2="{gy:.1f}" class="grid"/>')
        parts.append(f'<text x="{pad_l - 6}" y="{gy + 4:.1f}" text-anchor="end" class="axis">{int(round(gv))}g</text>')

    for i, d in enumerate(days):
        cx = pad_l + slot_w * (i + 0.5)
        bx = cx - bar_w / 2.0
        dow, md = short_day(d["date"])
        parts.append(f'<text x="{cx:.1f}" y="{h - 7}" text-anchor="middle" class="axis">{esc(dow)} {esc(md)}</text>')
        if d["protein_g"] is None:
            uh = 26.0
            uy = pad_t + plot_h - uh
            parts.append(
                f'<rect x="{bx:.1f}" y="{uy:.1f}" width="{bar_w:.1f}" height="{uh:.1f}" rx="4" class="bar-unk"/>'
            )
            parts.append(f'<text x="{cx:.1f}" y="{uy + 17:.1f}" text-anchor="middle" class="unk-label">?</text>')
        else:
            p = float(d["protein_g"])
            by = y_at(p)
            bh = max(2.0, pad_t + plot_h - by)
            cls = "bar-ok" if d.get("hit_protein_target") is True else ("bar-warn" if d.get("hit_protein_target") is False else "bar-main")
            parts.append(f'<rect x="{bx:.1f}" y="{by:.1f}" width="{bar_w:.1f}" height="{bh:.1f}" rx="4" class="{cls}"/>')
            parts.append(f'<text x="{cx:.1f}" y="{by - 5:.1f}" text-anchor="middle" class="pt-label">{fmt_num(p, "g")}</text>')

    if target_g is not None:
        ty = y_at(float(target_g))
        parts.append(f'<line x1="{pad_l}" y1="{ty:.1f}" x2="{w - pad_r}" y2="{ty:.1f}" class="ref-line"/>')
        parts.append(
            f'<text x="{w - pad_r + 6}" y="{ty + 3.5:.1f}" text-anchor="start" class="ref-label">'
            f'Goal {fmt_num(target_g, "g")}</text>'
        )

    parts.append("</svg>")
    return "".join(parts)


def render_cpap_svg(days: list[dict[str, Any]], hours_min: float | None, ahi_max: float | None) -> str:
    w, h = 680, 148
    pad_l, pad_r, pad_t, pad_b = 44, 66, 20, 26
    plot_w = w - pad_l - pad_r
    plot_h = h - pad_t - pad_b

    hrs = [float(d["cpap"]["hours"]) for d in days if d["cpap"] is not None]
    ceiling = max(hrs + ([float(hours_min)] if hours_min is not None else []) + [8.0]) * 1.18
    n = max(len(days), 1)
    slot_w = plot_w / n
    bar_w = min(42.0, slot_w * 0.56)

    def y_at(v: float) -> float:
        return pad_t + plot_h * (1.0 - v / ceiling)

    parts = [f'<svg class="chart" viewBox="0 0 {w} {h}" role="img" aria-label="CPAP hours and AHI">']
    for frac in (0.0, 0.5, 1.0):
        gv = ceiling * frac
        gy = y_at(gv)
        parts.append(f'<line x1="{pad_l}" y1="{gy:.1f}" x2="{w - pad_r}" y2="{gy:.1f}" class="grid"/>')
        parts.append(f'<text x="{pad_l - 6}" y="{gy + 4:.1f}" text-anchor="end" class="axis">{gv:.0f}h</text>')

    for i, d in enumerate(days):
        cx = pad_l + slot_w * (i + 0.5)
        bx = cx - bar_w / 2.0
        dow, md = short_day(d["date"])
        parts.append(f'<text x="{cx:.1f}" y="{h - 7}" text-anchor="middle" class="axis">{esc(dow)} {esc(md)}</text>')
        c = d["cpap"]
        if c is None:
            uh = 26.0
            uy = pad_t + plot_h - uh
            parts.append(
                f'<rect x="{bx:.1f}" y="{uy:.1f}" width="{bar_w:.1f}" height="{uh:.1f}" rx="4" class="bar-unk"/>'
            )
            parts.append(f'<text x="{cx:.1f}" y="{uy + 17:.1f}" text-anchor="middle" class="unk-label">?</text>')
        else:
            hr = float(c["hours"])
            by = y_at(hr)
            bh = max(2.0, pad_t + plot_h - by)
            ahi = c.get("ahi")
            good_hr = hours_min is None or hr >= float(hours_min)
            good_ahi = ahi is None or ahi_max is None or float(ahi) < float(ahi_max)
            cls = "bar-ok" if (good_hr and good_ahi) else "bar-warn"
            parts.append(f'<rect x="{bx:.1f}" y="{by:.1f}" width="{bar_w:.1f}" height="{bh:.1f}" rx="4" class="{cls}"/>')
            lbl = f'{fmt_num(hr, "h")}' + (f' · {fmt_num(ahi)}' if ahi is not None else "")
            parts.append(f'<text x="{cx:.1f}" y="{by - 5:.1f}" text-anchor="middle" class="pt-label">{esc(lbl)}</text>')

    if hours_min is not None:
        ty = y_at(float(hours_min))
        parts.append(f'<line x1="{pad_l}" y1="{ty:.1f}" x2="{w - pad_r}" y2="{ty:.1f}" class="ref-line"/>')
        parts.append(
            f'<text x="{w - pad_r + 6}" y="{ty + 3.5:.1f}" text-anchor="start" class="ref-label">'
            f'Goal {fmt_num(hours_min, "h")}</text>'
        )

    parts.append("</svg>")
    return "".join(parts)


def render_weekly_html(summary: dict[str, Any], *, title: str = "Weekly Health Check-In") -> str:
    days: list[dict[str, Any]] = summary["days"]
    wt = summary["weight"]
    ws = summary["waist"]
    nut = summary["nutrition"]
    cpap = summary["cpap"]
    meds: list[dict[str, Any]] = summary["meds"]
    wk = summary["workouts"]
    slips = summary["slips"]
    targets = summary["targets"]

    _, s_lbl = short_day(summary["since"])
    _, u_lbl = short_day(summary["until"])
    window_lbl = f"{s_lbl} – {u_lbl} ({summary['total_days']} days · {summary['entry_count']} entries)"

    # KPI values
    w_main = fmt_num(wt["latest_kg"], " kg")
    w_sub = (
        f'{fmt_num(wt["delta_vs_baseline_kg"], " kg", signed=True)} vs {fmt_num(wt["baseline_kg"], " kg")}'
        if wt["delta_vs_baseline_kg"] is not None
        else (f'Baseline {fmt_num(wt["baseline_kg"], " kg")}' if wt["baseline_kg"] is not None else "No baseline set")
    )
    if ws["latest_in"] is not None or ws["baseline_in"] is not None:
        w_sub += f' · Waist {fmt_num(ws["latest_in"], " in")}'
        if ws["delta_vs_baseline_in"] is not None:
            w_sub += f' ({fmt_num(ws["delta_vs_baseline_in"], " in", signed=True)})'

    if nut["protein_hit_rate"] is not None:
        pct = int(round(nut["protein_hit_rate"] * 100))
        p_main = f'{nut["protein_days_hit"]}/{nut["days_logged"]} ({pct}%)'
        p_sub = f'Target ≥{fmt_num(nut["protein_target_g"], "g")} est. · {nut["days_unknown"]}d unknown'
    elif nut["days_logged"]:
        p_main = f'{fmt_num(nut["avg_protein_g_logged_days"], "g")} avg'
        p_sub = f'{nut["days_logged"]}d logged · {nut["days_unknown"]}d unknown (est.)'
    else:
        p_main = "Unknown"
        p_sub = f'{nut["days_unknown"]}d unknown'

    if cpap["nights_logged"]:
        c_main = f'{fmt_num(cpap["avg_hours"], "h")} · AHI {fmt_num(cpap["avg_ahi"])}'
        c_sub = f'{cpap["nights_logged"]}/{summary["total_days"]} nights logged · {cpap["nights_unknown"]} unknown'
    else:
        c_main = "Unknown"
        c_sub = f'{cpap["nights_unknown"]} nights unknown'

    if meds:
        m0 = meds[0]
        m_logged = m0["days_taken"] + m0["days_partial"] + m0["days_missed"]
        m_main = f'{m0["days_taken"]}/{m_logged} taken' if m_logged else "Unknown"
        m_sub = f'{m0["name"].title()} · {m0["days_unknown"]}d unknown'
    else:
        m_main = "None tracked"
        m_sub = "Configure meds in health/config.json"

    top_trig = next(iter(slips["by_trigger"].items()), None)
    s_main = str(slips["count"])
    s_sub = f'Top trigger: {top_trig[0]} ({top_trig[1]})' if top_trig else "No slips logged"

    # Build daily nutrition rows
    nut_rows = []
    for d in days:
        dow, md = short_day(d["date"])
        if d["meal_count"] == 0:
            nut_rows.append(
                f'<tr><td>{esc(dow)} {esc(md)}</td><td class="unk">Unknown</td>'
                f'<td class="unk">Unknown</td><td class="unk">Unknown</td><td><span class="pill unk">Unknown</span></td></tr>'
            )
        else:
            hit = d["hit_protein_target"]
            if hit is True:
                badge = '<span class="pill ok">Hit</span>'
            elif hit is False:
                badge = '<span class="pill warn">Below</span>'
            else:
                badge = '<span class="pill muted">Logged</span>'
            nut_rows.append(
                f'<tr><td>{esc(dow)} {esc(md)}</td><td>{d["meal_count"]}</td>'
                f'<td>{esc(fmt_num(d["kcal"], " kcal"))} <span class="est">est.</span></td>'
                f'<td>{esc(fmt_num(d["protein_g"], " g"))} <span class="est">est.</span></td>'
                f'<td>{badge}</td></tr>'
            )

    # Build CPAP nightly rows
    cpap_rows = []
    for d in days:
        dow, md = short_day(d["date"])
        c = d["cpap"]
        if c is None:
            cpap_rows.append(
                f'<tr><td>{esc(dow)} {esc(md)}</td><td class="unk">Unknown</td><td class="unk">Unknown</td>'
                f'<td class="unk">—</td><td class="unk">—</td></tr>'
            )
        else:
            ahi = c.get("ahi")
            ahi_cls = "ok" if (ahi is not None and float(ahi) < float(targets.get("cpap_ahi_max", 5.0))) else ("warn" if ahi is not None else "unk")
            ahi_cell = f'<span class="pill {ahi_cls}">{esc(fmt_num(ahi))}</span>' if ahi is not None else '<span class="unk">Unknown</span>'
            mo = str(c["mask_offs"]) if c.get("mask_offs") is not None else "—"
            note_bits = []
            if c.get("refreshed"):
                note_bits.append(f'Refreshed: {c["refreshed"]}')
            if c.get("notes"):
                note_bits.append(c["notes"])
            cpap_rows.append(
                f'<tr><td>{esc(dow)} {esc(md)}</td><td>{esc(fmt_num(c["hours"], " h"))}</td>'
                f'<td>{ahi_cell}</td><td>{esc(mo)}</td><td>{esc(" · ".join(note_bits) or "—")}</td></tr>'
            )

    # Build Meds + Workouts grid
    day_headers = "".join(
        f'<th>{esc(short_day(d["date"])[0])}<br><small>{esc(short_day(d["date"])[1])}</small></th>' for d in days
    )
    grid_rows = []
    for m in meds:
        nm = m["name"]
        label = esc(nm.title() + (f' ({m["dose"]})' if m.get("dose") else ""))
        cells = []
        for d in days:
            st = d["meds"].get(nm)
            if st == "taken":
                cells.append('<td><span class="pill ok">Taken</span></td>')
            elif st == "partial":
                cells.append('<td><span class="pill warn">Partial</span></td>')
            elif st == "missed":
                cells.append('<td><span class="pill bad">Missed</span></td>')
            else:
                cells.append('<td><span class="pill unk">?</span></td>')
        grid_rows.append(f'<tr><td class="row-label">{label}</td>{"".join(cells)}</tr>')

    wk_cells = []
    for d in days:
        wlist = d["workouts"]
        if not wlist:
            wk_cells.append('<td><span class="pill unk">—</span></td>')
        else:
            pills = []
            for w in wlist:
                tag = "Trainer" if w["kind"] == "trainer" else "Solo"
                if w["status"] == "attended":
                    pills.append(f'<span class="pill ok">{tag}</span>')
                elif w["status"] == "missed_and_paid":
                    pills.append(f'<span class="pill warn">{tag} M&amp;P</span>')
                else:
                    pills.append(f'<span class="pill bad">{tag} Miss</span>')
            wk_cells.append(f'<td>{" ".join(pills)}</td>')
    grid_rows.append(f'<tr><td class="row-label">Workouts</td>{"".join(wk_cells)}</tr>')

    # Slips section
    if slips["items"]:
        trig_chips = "".join(
            f'<span class="chip">{esc(trig)}: <strong>{cnt}</strong></span>'
            for trig, cnt in slips["by_trigger"].items()
        )
        slip_rows = []
        for sl in slips["items"]:
            dow, md = short_day(sl["date"])
            extra = []
            if sl.get("kcal_est") is not None:
                extra.append(f'~{fmt_num(sl["kcal_est"], " kcal")} est.')
            if sl.get("notes"):
                extra.append(sl["notes"])
            slip_rows.append(
                f'<tr><td>{esc(dow)} {esc(md)}</td><td>{esc(sl["what"])}</td>'
                f'<td><span class="pill warn">{esc(sl["trigger"])}</span></td>'
                f'<td>{esc(" · ".join(extra) or "—")}</td></tr>'
            )
        slips_body = (
            f'<div class="chips" style="padding:10px 14px 0">{trig_chips}</div>'
            '<div class="scroll"><table><thead><tr><th>Date</th><th>What</th><th>Trigger</th><th>Notes</th></tr></thead>'
            f'<tbody>{"".join(slip_rows)}</tbody></table></div>'
        )
    else:
        slips_body = '<p class="empty">No diet slips logged in this window.</p>'

    # Weight & waist detail row
    weight_rows = []
    for d in days:
        if d["weight_kg"] is None and d["waist_in"] is None:
            continue
        dow, md = short_day(d["date"])
        wd = (
            fmt_num(float(d["weight_kg"]) - float(wt["baseline_kg"]), " kg", signed=True)
            if (d["weight_kg"] is not None and wt["baseline_kg"] is not None)
            else "—"
        )
        wsd = (
            fmt_num(float(d["waist_in"]) - float(ws["baseline_in"]), " in", signed=True)
            if (d["waist_in"] is not None and ws["baseline_in"] is not None)
            else "—"
        )
        weight_rows.append(
            f'<tr><td>{esc(dow)} {esc(md)}</td><td>{esc(fmt_num(d["weight_kg"], " kg"))}</td><td>{esc(wd)}</td>'
            f'<td>{esc(fmt_num(d["waist_in"], " in"))}</td><td>{esc(wsd)}</td></tr>'
        )
    weight_table = (
        '<div class="scroll"><table><thead><tr><th>Date</th><th>Weight</th><th>vs Baseline</th><th>Waist</th><th>vs Baseline</th></tr></thead>'
        f'<tbody>{"".join(weight_rows)}</tbody></table></div>'
        if weight_rows
        else ""
    )

    wk_summary_chip = (
        f'Workouts: {wk["attended"]} attended'
        + (f', {wk["missed_and_paid"]} missed &amp; paid' if wk["missed_and_paid"] else "")
        + (f', {wk["missed"]} missed' if wk["missed"] else "")
    )

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<style>
  :root {{
    --fg: var(--foreground, #1d1d1b);
    --mute: var(--muted-foreground, #6b6b66);
    --line: var(--border, #e5e4df);
    --card-bg: var(--card, #ffffff);
    --chip: var(--secondary, #f2f1ed);
    --ok: var(--success, #2f7d4f);
    --warn: var(--warning, #b7791f);
    --bad: var(--destructive, #b4432f);
    --accent-col: var(--chart-1, var(--primary, #3b5bdb));
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --fg: var(--foreground, #ecebe6);
      --mute: var(--muted-foreground, #9a9993);
      --line: var(--border, #2e2e2b);
      --card-bg: var(--card, #1d1d1b);
      --chip: var(--secondary, #262624);
      --ok: var(--success, #6cc28f);
      --warn: var(--warning, #e5b567);
      --bad: var(--destructive, #e88a76);
      --accent-col: var(--chart-1, var(--primary, #8ea6ff));
    }}
  }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; color: var(--fg); font: 13.5px/1.45 var(--font-sans, -apple-system, "Segoe UI", Roboto, sans-serif); }}
  header {{ margin-bottom: 12px; }}
  h1 {{ font-size: 19px; margin: 0 0 3px; }}
  .meta {{ color: var(--mute); margin: 0; font-size: 12.5px; }}
  .kpis {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 8px; margin-top: 12px; }}
  .kpi {{ background: var(--card-bg); border: 1px solid var(--line); border-radius: var(--radius, 10px); padding: 10px 12px; }}
  .kpi .lbl {{ font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--mute); }}
  .kpi .val {{ font-size: 16px; font-weight: 700; margin: 3px 0 2px; }}
  .kpi .sub {{ font-size: 11.5px; color: var(--mute); }}
  section {{ background: var(--card-bg); border: 1px solid var(--line); border-radius: var(--radius, 10px); margin-top: 12px; overflow: hidden; }}
  h2 {{ font-size: 13.5px; margin: 0; padding: 8px 12px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; }}
  h2 small {{ color: var(--mute); font-weight: 400; font-size: 11.5px; }}
  .chart-wrap {{ padding: 6px 10px 2px; }}
  svg.chart {{ width: 100%; height: 142px; display: block; }}
  .grid {{ stroke: var(--line); stroke-width: 1; }}
  .axis {{ fill: var(--mute); font-size: 10.5px; }}
  .ref-line {{ stroke: var(--mute); stroke-width: 1.25; stroke-dasharray: 4 3; }}
  .ref-label {{ fill: var(--mute); font-size: 10px; font-weight: 600; }}
  .series-line {{ fill: none; stroke: var(--accent-col); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }}
  .series-dot {{ fill: var(--accent-col); }}
  .pt-label {{ fill: var(--fg); font-size: 10.5px; font-weight: 600; }}
  .unk-mark {{ fill: var(--mute); font-size: 12px; }}
  .bar-main {{ fill: var(--accent-col); }}
  .bar-ok {{ fill: var(--ok); }}
  .bar-warn {{ fill: var(--warn); }}
  .bar-unk {{ fill: none; stroke: var(--line); stroke-width: 1.4; stroke-dasharray: 3 3; }}
  .unk-label {{ fill: var(--mute); font-size: 12px; font-weight: 600; }}
  .scroll {{ overflow-x: auto; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 12.5px; }}
  th, td {{ text-align: left; padding: 5.5px 11px; border-bottom: 1px solid var(--line); vertical-align: middle; }}
  td:first-child {{ white-space: nowrap; }}
  tr:last-child td {{ border-bottom: 0; }}
  th {{ font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--mute); }}
  th small {{ font-weight: 400; text-transform: none; }}
  td.row-label {{ font-weight: 600; white-space: nowrap; }}
  .unk {{ color: var(--mute); font-style: italic; }}
  .est {{ font-size: 11px; color: var(--mute); }}
  .pill {{ display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--line); white-space: nowrap; }}
  .pill.ok {{ color: var(--ok); border-color: var(--ok); }}
  .pill.warn {{ color: var(--warn); border-color: var(--warn); }}
  .pill.bad {{ color: var(--bad); border-color: var(--bad); }}
  .pill.unk {{ color: var(--mute); border-style: dashed; }}
  .pill.muted {{ color: var(--mute); }}
  .chips {{ display: flex; flex-wrap: wrap; gap: 6px; }}
  .chip {{ background: var(--chip); border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; font-size: 12px; }}
  .empty {{ padding: 12px 14px; margin: 0; color: var(--mute); }}
  footer {{ margin-top: 12px; color: var(--mute); font-size: 11.5px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }}
</style>
</head>
<body>

<header>
  <h1>{esc(title)}</h1>
  <p class="meta">{esc(window_lbl)}</p>
  <div class="kpis">
    <div class="kpi"><div class="lbl">Weight &amp; Waist</div><div class="val">{esc(w_main)}</div><div class="sub">{esc(w_sub)}</div></div>
    <div class="kpi"><div class="lbl">Protein Target</div><div class="val">{esc(p_main)}</div><div class="sub">{esc(p_sub)}</div></div>
    <div class="kpi"><div class="lbl">CPAP Avg</div><div class="val">{esc(c_main)}</div><div class="sub">{esc(c_sub)}</div></div>
    <div class="kpi"><div class="lbl">Medication</div><div class="val">{esc(m_main)}</div><div class="sub">{esc(m_sub)}</div></div>
    <div class="kpi"><div class="lbl">Diet Slips</div><div class="val">{esc(s_main)}</div><div class="sub">{esc(s_sub)}</div></div>
  </div>
</header>

<section>
  <h2>Weight &amp; Waist <small>Baseline: {esc(fmt_num(wt["baseline_kg"], " kg"))} / {esc(fmt_num(ws["baseline_in"], " in"))} · {wt["days_logged"]}d logged, {wt["days_unknown"]}d unknown</small></h2>
  <div class="chart-wrap">{render_weight_svg(days, wt["baseline_kg"])}</div>
  {weight_table}
</section>

<section>
  <h2>Daily Protein &amp; Calories <small>All nutrition values are estimates · Missing days shown as unknown</small></h2>
  <div class="chart-wrap">{render_protein_svg(days, nut["protein_target_g"])}</div>
  <div class="scroll"><table>
    <thead><tr><th>Date</th><th>Meals</th><th>Calories</th><th>Protein</th><th>Target</th></tr></thead>
    <tbody>{"".join(nut_rows)}</tbody>
  </table></div>
</section>

<section>
  <h2>CPAP Sleep Quality <small>Hours &amp; AHI per night · Target ≥{esc(fmt_num(targets.get("cpap_hours_min"), "h"))}, AHI &lt;{esc(fmt_num(targets.get("cpap_ahi_max")))}</small></h2>
  <div class="chart-wrap">{render_cpap_svg(days, targets.get("cpap_hours_min"), targets.get("cpap_ahi_max"))}</div>
  <div class="scroll"><table>
    <thead><tr><th>Date</th><th>Hours</th><th>AHI</th><th>Mask-offs</th><th>Notes</th></tr></thead>
    <tbody>{"".join(cpap_rows)}</tbody>
  </table></div>
</section>

<section>
  <h2>Medications &amp; Workouts <small>{wk_summary_chip}</small></h2>
  <div class="scroll"><table>
    <thead><tr><th>Item</th>{day_headers}</tr></thead>
    <tbody>{"".join(grid_rows)}</tbody>
  </table></div>
</section>

<section>
  <h2>Diet Slips &amp; Triggers <small>{slips["count"]} logged</small></h2>
  {slips_body}
</section>

<footer>
  <span>Missing days are shown as Unknown (never zero). Nutrition values are estimates for consistent tracking.</span>
  <span>For trend review with your doctor; not medical advice.</span>
</footer>

</body>
</html>
"""
