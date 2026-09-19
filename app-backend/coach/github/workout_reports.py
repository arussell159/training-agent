#!/usr/bin/env python3
"""Recover and publish pre/post reports after each successful Intervals sync.

Pre reports preserve a same-day snapshot taken BEFORE the activity. They are
explicitly retrospective records, never an invented contemporaneous check-in.
Activity comments are the durable idempotency record; descriptions are untouched.
"""
import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from post_workout_report import (
    BASE_URL, READ_TIMEOUT, WRITE_TIMEOUT, build_report, get_activity, get_messages,
    headers, match_plan, message_text, requests,
)

TZ = ZoneInfo(os.environ.get("TZ", "America/Chicago"))


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    except (ValueError, TypeError):
        return None


def pre_snapshot(activity, root=Path("archive")):
    start = datetime.fromisoformat(activity["date"]).replace(tzinfo=TZ)
    # Archive names are UTC; include the adjacent UTC day for evening sessions.
    paths = []
    for delta in (-1, 0, 1):
        utc_day = start.astimezone(timezone.utc).date() + timedelta(days=delta)
        paths.extend((root / utc_day.strftime("%Y-%m")).glob(utc_day.strftime("%Y%m%d") + "_*.json"))
    for path in sorted(paths, reverse=True):
        snapshot = json.loads(path.read_text(encoding="utf-8"))
        updated = timestamp((snapshot.get("metadata") or {}).get("last_updated"))
        if updated and updated < start and updated.astimezone(TZ).date() == start.date():
            return snapshot
    return None


def build_pre_report(snapshot, activity):
    day = activity["date"][:10]
    lines = [
        "Pre-workout report",
        "Source note: Recovered automatically after completion from data archived before this workout. No retrospective training decision or current-state check-in has been invented.",
    ]
    if not snapshot:
        return "\n".join(lines + ["Pre-workout data: unavailable. No same-day snapshot predating the activity was archived."])
    lines += [f"Data last_updated (UTC): {snapshot['metadata']['last_updated']}", "", "Current Status Summary:"]
    decision = snapshot.get("readiness_decision") or {}
    signals = decision.get("signals") or {}
    metrics = (snapshot.get("current_status") or {}).get("current_metrics") or {}
    fitness = (snapshot.get("current_status") or {}).get("fitness") or {}
    derived = snapshot.get("derived_metrics") or {}
    phase = snapshot.get("phase_detection") or {}
    def field(label, value, suffix=""):
        if value is not None:
            lines.append(f"{label}: {value}{suffix}")
    if phase.get("confidence") in ("medium", "high"):
        field("Phase", phase.get("phase"))
    for label, key, unit, baseline in (("HRV", "hrv", "ms", "baseline_7d"), ("RHR", "rhr", "bpm", "baseline_7d")):
        signal = signals.get(key) or {}
        context = f" (baseline: {signal[baseline]} {unit})" if signal.get(baseline) is not None else ""
        field(label, signal.get("value"), f" {unit}{context}")
    field("Sleep", metrics.get("sleep_formatted"))
    field("Sleep Quality", metrics.get("sleep_quality"), "/4")
    for label, key in (("TSB", "tsb"), ("CTL", "ctl"), ("ATL", "atl"), ("Ramp Rate", "ramp_rate")):
        field(label, fitness.get(key))
    field("ACWR", (signals.get("acwr") or {}).get("value"), "; start-of-day")
    field("Recovery Index", (signals.get("ri") or {}).get("value"))
    field("Load/Recovery", derived.get("load_recovery_ratio"))
    tid = derived.get("seiler_tid_7d") or {}
    if all(tid.get(key) is not None for key in ("z1_pct", "z2_pct", "z3_pct")):
        field("Polarization", f"Z1+Z2 {tid['z1_pct']}%, Z3 {tid['z2_pct']}%, Z4+ {tid['z3_pct']}%; {tid.get('classification', 'unavailable')}")
    if (derived.get("effective_monotony") or 0) > 2.3:
        field("Monotony", derived["effective_monotony"])
    week = snapshot.get("weekly_summary") or {}
    field("Total hours, last 7 days", week.get("total_training_formatted"))
    field("Total activities, last 7 days", week.get("total_activities"))
    field("Total TSS, last 7 days", week.get("total_tss"))
    plan = match_plan(activity, snapshot.get("planned_workouts") or [])
    lines += ["", "Planned Workouts for Today:"]
    if plan:
        lines.append(f"{plan.get('name')}: {plan.get('duration_formatted', 'duration unavailable')}")
        prescription = plan.get("workout_summary") or plan.get("description_preview") or plan.get("description")
        if prescription:
            # Preserve the human prescription, not the editor/device payload.
            lines.append(re.split(r"Intervals\.icu device definition:|```\s*Workout editor", prescription)[0].strip("`\n "))
        field("Planned TSS", plan.get("planned_tss"))
    else:
        lines.append("No uniquely matched planned prescription in the pre-workout snapshot.")
    lines += ["", "Interpretation:"]
    field("Archived readiness baseline", decision.get("recommendation"))
    if decision.get("reason"):
        lines.append(decision["reason"])
    adjustments = (decision.get("modification") or {}).get("suggested_adjustments") or {}
    if adjustments:
        lines.append("Archived adjustment directions: " + "; ".join(f"{k}: {v}" for k, v in adjustments.items() if v is not None))
    prior = [a for a in snapshot.get("recent_activities", []) if str(a.get("date", ""))[:10] == day]
    if prior:
        lines.append("Same-day continuation: a prior session was already recorded. Current Feel, soreness and symptoms were not collected by this automation; no continuation decision is inferred.")
    return "\n".join(lines)


def publish_once(activity_id, key, kind, text):
    marker = f"[[SECTION11_REPORT:{kind}:{activity_id}]]"
    messages = get_messages(activity_id, key)
    if any(marker in message_text(m) for m in messages):
        return "already_saved"
    content = text if text.startswith(marker) else f"{marker}\n{text}\n[[/SECTION11_REPORT:{kind}:{activity_id}]]"
    try:
        response = requests.post(f"{BASE_URL}/activity/{activity_id}/messages", headers=headers(key), json={"content": content}, timeout=WRITE_TIMEOUT)
        response.raise_for_status()
    except requests.RequestException:
        # A timeout may have committed. Read before any retry; never blindly repost.
        if any(marker in message_text(m) for m in get_messages(activity_id, key)):
            return "verified_after_write"
        raise
    if not any(marker in message_text(m) for m in get_messages(activity_id, key)):
        raise RuntimeError("Report comment could not be verified; inspect before retrying")
    return "saved_and_verified"


def session_only_post(text, activity):
    """Repair only the known legacy multi-session layout, preserving saved facts."""
    marker = f"[[SECTION11_REPORT:POST_WORKOUT:{activity['id']}]]"
    if not text.startswith(marker) or "\nWeekly totals (rolling 7d)\n" not in text:
        return text
    sessions, footer = text.split("\nWeekly totals (rolling 7d)\n", 1)
    headings = list(re.finditer(r"^[A-Za-z][A-Za-z ]* — [^\n]+$", sessions, re.MULTILINE))
    if len(headings) < 2:
        return text
    title = f"{activity.get('type') or 'Activity'} — {activity.get('name') or 'Unnamed'}"
    blocks = [sessions[h.start():headings[i + 1].start() if i + 1 < len(headings) else len(sessions)].strip()
              for i, h in enumerate(headings) if h.group() == title]
    if len(blocks) > 1:
        start = datetime.fromisoformat(activity['date']).strftime('%I:%M %p').lstrip('0')
        blocks = [block for block in blocks if f"Start time: {start}" in block.splitlines()]
    if len(blocks) != 1:
        return text  # Never guess which same-name session owns a block.
    return sessions[:headings[0].start()] + blocks[0] + "\n\nWeekly totals (rolling 7d)\n" + footer


def repair_post(activity, key, messages):
    activity_id = str(activity['id'])
    marker = f"[[SECTION11_REPORT:POST_WORKOUT:{activity_id}]]"
    repaired = False
    for message in messages:
        original = message_text(message)
        if marker not in original:
            continue
        desired = session_only_post(original, activity)
        if desired == original:
            continue
        # Resolve the chat through the selected activity, never a day-wide feed.
        chat_id = get_activity(activity_id, key).get('icu_chat_id')
        message_id = message.get('id')
        if not isinstance(chat_id, int) or not isinstance(message_id, int):
            raise RuntimeError('Report correction needs the activity chat and message ids')
        if message.get('activity_id') not in (None, activity_id):
            raise RuntimeError('Report message belongs to another activity')
        current = next((m for m in get_messages(activity_id, key) if m.get('id') == message_id), None)
        if message_text(current) != original:
            raise RuntimeError('Report changed before correction; no write attempted')
        try:
            response = requests.put(f"{BASE_URL}/chats/{chat_id}/messages/{message_id}",
                                    headers=headers(key), json={'content': desired}, timeout=WRITE_TIMEOUT)
            response.raise_for_status()
        except requests.RequestException:
            # An uncertain update must be verified, never duplicated with a new comment.
            current = next((m for m in get_messages(activity_id, key) if m.get('id') == message_id), None)
            if message_text(current) != desired:
                raise
        current = next((m for m in get_messages(activity_id, key) if m.get('id') == message_id), None)
        if message_text(current) != desired:
            raise RuntimeError('Session report correction could not be verified')
        repaired = True
    return 'session_corrected_and_verified' if repaired else 'already_saved'


def run(latest, intervals, key, today):
    results = []
    # Catch late uploads and a sync crossing midnight, without replaying history.
    oldest = (today - timedelta(days=2)).isoformat()
    for activity in latest.get("recent_activities") or []:
        day = str(activity.get("date") or "")[:10]
        activity_id = str(activity.get("id") or "")
        if not oldest <= day <= today.isoformat() or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", activity_id):
            continue
        for kind in ("PRE_WORKOUT", "POST_WORKOUT"):
            # Check before loading archives or building a report.
            marker = f"[[SECTION11_REPORT:{kind}:{activity_id}]]"
            messages = get_messages(activity_id, key)
            if any(marker in message_text(m) for m in messages):
                outcome = repair_post(activity, key, messages) if kind == "POST_WORKOUT" else "already_saved"
            else:
                # The legacy builder used all same-day activities. Supply only the
                # selected session, retaining the explicit weekly context separately.
                scoped = {**latest, "recent_activities": [activity]}
                text = build_pre_report(pre_snapshot(activity), activity) if kind == "PRE_WORKOUT" else build_report(scoped, intervals, activity, datetime.fromisoformat(day).date())
                outcome = publish_once(activity_id, key, kind, text)
            results.append({"activity_id": activity_id, "kind": kind, "outcome": outcome})
    return results


if __name__ == "__main__":
    key = os.environ.get("INTERVALS_KEY", "").strip()
    if not key:
        raise SystemExit("INTERVALS_KEY is required")
    latest = json.loads(Path("latest.json").read_text(encoding="utf-8"))
    intervals = json.loads(Path("intervals.json").read_text(encoding="utf-8"))
    print(json.dumps({"verified_reports": run(latest, intervals, key, datetime.now(TZ).date())}, indent=2))
