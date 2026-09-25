"""Run the private Section 11 sync.py and publish its JSON files without Actions."""

from datetime import datetime, timedelta, timezone
from hashlib import sha256
from hmac import compare_digest, new as hmac_new
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import quote
import json
import os
import re
import subprocess
import sys
import time

import requests


FILES = (
    "latest.json",
    "history.json",
    "intervals.json",
    "routes.json",
    "ftp_history.json",
    "saved_workouts.json",
)
API = "https://api.github.com/repos"


class SyncFailure(Exception):
    pass


def github(repo, token, method, path, *, payload=None, raw=False, missing=False):
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.raw+json" if raw else "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "training-agent-section11-sync",
    }
    try:
        response = requests.request(
            method, f"{API}/{repo}/{path}", headers=headers, json=payload,
            timeout=(5, 30), allow_redirects=False,
        )
    except requests.RequestException as exc:
        raise SyncFailure("GitHub could not be reached.") from exc
    if response.status_code == 404 and missing:
        return None
    if not response.ok:
        if response.status_code == 403 and method != "GET":
            raise SyncFailure("GitHub denied the commit. Grant the app token Contents: Read and write.")
        raise SyncFailure(f"GitHub {method} failed (HTTP {response.status_code}).")
    return response.content if raw else response.json()


def repository_file(repo, branch, token, name, *, required=False):
    encoded = "/".join(quote(part, safe="") for part in name.split("/"))
    content = github(repo, token, "GET", f"contents/{encoded}?ref={quote(branch, safe='')}",
                     raw=True, missing=not required)
    if content is None and required:
        raise SyncFailure(f"The training repository is missing {name}.")
    return content


def branch_head(repo, branch, token):
    ref = github(repo, token, "GET", f"git/ref/heads/{quote(branch, safe='/')}")
    return ref["object"]["sha"]


def history_is_overdue(content):
    if not content:
        return False  # sync.py builds missing history itself.
    try:
        generated = datetime.fromisoformat(json.loads(content)["generated_at"].replace("Z", "+00:00"))
        if generated.tzinfo is None:
            generated = generated.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - generated >= timedelta(days=28)
    except (AttributeError, KeyError, TypeError, ValueError):
        return True


def commit_files(repo, branch, token, original_head, files):
    if not files:
        return original_head
    if branch_head(repo, branch, token) != original_head:
        raise SyncFailure("The training repository changed during export. Refresh again.")
    previous = github(repo, token, "GET", f"git/commits/{original_head}")
    entries = [
        {"path": name, "mode": "100644", "type": "blob", "content": content.decode("utf-8")}
        for name, content in files.items()
    ]
    tree = github(repo, token, "POST", "git/trees", payload={
        "base_tree": previous["tree"]["sha"], "tree": entries,
    })
    commit = github(repo, token, "POST", "git/commits", payload={
        "message": f"Sync Section 11 training data - {datetime.now(timezone.utc):%Y-%m-%d %H:%M:%S UTC}",
        "tree": tree["sha"], "parents": [original_head],
    })
    try:
        github(repo, token, "PATCH", f"git/refs/heads/{quote(branch, safe='/')}",
               payload={"sha": commit["sha"], "force": False})
    except SyncFailure as exc:
        try:
            if branch_head(repo, branch, token) == commit["sha"]:
                return commit["sha"]
        except SyncFailure:
            pass
        raise SyncFailure("GitHub could not confirm this commit. Check the repository before retrying.") from exc
    return commit["sha"]


def run_export(payload, token):
    repo = payload.get("repo")
    branch = payload.get("branch")
    athlete = payload.get("athlete_id")
    intervals_key = payload.get("intervals_key")
    if (not os.getenv("TRAINING_DATA_GITHUB_REPO") or
            repo != os.getenv("TRAINING_DATA_GITHUB_REPO") or
            branch != os.getenv("TRAINING_DATA_GITHUB_BRANCH", "main") or
            not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", str(athlete or "")) or
            not isinstance(intervals_key, str) or not intervals_key or
            payload.get("days") != 7):
        raise SyncFailure("Invalid Section 11 sync request.")

    head = branch_head(repo, branch, token)
    with TemporaryDirectory(prefix="section11-sync-") as temporary:
        directory = Path(temporary)
        script = repository_file(repo, head, token, "sync.py", required=True)
        if not script or len(script) > 2_000_000:
            raise SyncFailure("The training repository's sync.py is unavailable or too large.")
        (directory / "sync.py").write_bytes(script)
        previous = {}
        for name in FILES:
            content = repository_file(repo, head, token, name)
            if content is not None:
                if len(content) > 10_000_000:
                    raise SyncFailure(f"{name} is too large for direct sync.")
                previous[name] = content
                (directory / name).write_bytes(content)

        environment = {
            name: os.environ[name]
            for name in ("PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR",
                         "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE")
            if name in os.environ
        }
        environment["ATHLETE_ID"] = athlete
        environment["INTERVALS_KEY"] = intervals_key
        if payload.get("week_start"):
            environment["WEEK_START"] = str(payload["week_start"])
        if payload.get("zone_preference"):
            environment["ZONE_PREFERENCE"] = str(payload["zone_preference"])
        started = time.monotonic()
        if history_is_overdue(previous.get("history.json")):
            try:
                history_result = subprocess.run(
                    [sys.executable, "sync.py", "--generate-history", "--output", "history.json"],
                    cwd=directory, env=environment, capture_output=True, timeout=120,
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                raise SyncFailure("Section 11 history rebuild timed out.") from exc
            if history_result.returncode != 0:
                raise SyncFailure(f"Section 11 history rebuild failed (exit {history_result.returncode}).")
        try:
            result = subprocess.run(
                [sys.executable, "sync.py", "--days", "7", "--output", "latest.json"],
                cwd=directory, env=environment, capture_output=True,
                timeout=max(1, 220 - (time.monotonic() - started)),
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise SyncFailure("Section 11 export timed out.") from exc
        if result.returncode != 0:
            raise SyncFailure(f"Section 11 export failed (exit {result.returncode}).")
        latest = directory / "latest.json"
        if not latest.exists():
            raise SyncFailure("Section 11 did not produce latest.json.")
        try:
            json.loads(latest.read_text(encoding="utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise SyncFailure("Section 11 produced an invalid latest.json.") from exc

        changed = {}
        for name in FILES:
            file = directory / name
            if file.exists():
                content = file.read_bytes()
                if content != previous.get(name):
                    changed[name] = content
        timestamp = datetime.now(timezone.utc)
        archive_name = f"archive/{timestamp:%Y-%m}/{timestamp:%Y%m%d_%H%M%S}.json"
        changed[archive_name] = latest.read_bytes()
        readme = repository_file(repo, head, token, "README.md")
        if readme is not None:
            original = readme.decode("utf-8")
            updated = re.sub(
                r"(?m)^\*\*Last successful sync:\*\*.*$",
                f"**Last successful sync:** {timestamp:%Y-%m-%d %H:%M:%S UTC}",
                original,
            )
            if updated != original:
                changed["README.md"] = updated.encode("utf-8")
        commit = commit_files(repo, branch, token, head, changed)
        return {"status": "complete", "commit": commit, "files": list(changed)}


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        token = os.getenv("TRAINING_DATA_GITHUB_TOKEN", "")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not token or not 0 < length <= 16384:
                raise SyncFailure("Direct sync is unavailable.")
            raw = self.rfile.read(length)
            timestamp = self.headers.get("X-Section11-Timestamp", "")
            signature = self.headers.get("X-Section11-Signature", "")
            if not timestamp.isdecimal() or abs(time.time() - int(timestamp)) > 120:
                raise SyncFailure("Invalid direct sync authorization.")
            expected = hmac_new(token.encode(), timestamp.encode() + b"." + raw, sha256).hexdigest()
            if not compare_digest(signature, expected):
                raise SyncFailure("Invalid direct sync authorization.")
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise SyncFailure("Invalid Section 11 sync request.")
            result = run_export(payload, token)
            status = 200
        except (SyncFailure, ValueError, TypeError) as exc:
            status = 502 if str(exc).startswith(("GitHub", "Section 11")) else 400
            result = {"status": "failed", "error": str(exc)}
        except Exception:
            status = 500
            result = {"status": "failed", "error": "Section 11 direct sync could not finish."}
        data = json.dumps(result).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.send_error(405)
