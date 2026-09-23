import { readCoachInstructions } from "./coach-instructions.mjs";
import { readReportTemplate } from "./report-format.mjs";

export class CoachError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export const TRAINING_FILES = [
  "latest.json",
  "history.json",
  "intervals.json",
  "routes.json",
  "ftp_history.json",
  "saved_workouts.json",
];
export const REFERENCE_FILES = [
  "REPORT_HIERARCHY.md",
  "WEEKLY_REPORT_TEMPLATE.md",
  "BLOCK_REPORT_TEMPLATE.md",
  "SEASON_REPORT_TEMPLATE.md",
];
const UPSTREAM = "CrankAddict/section-11";
// The athlete supplied the report package from this exact Section 11 revision.
// Do not silently drift to main for report generation.
const UPSTREAM_REVISION = "02f5572ae196b4aa63f813413f43398a4cf1e3e4";

// Keep the upstream wording intact. The index makes the complete document
// available without resending its changelog and every specialty on every call.
export function protocolSections(protocol) {
  const sections = [];
  let current = { title: "Introduction and version history", text: "" };
  let fence = null;
  for (const line of protocol.split(/(?<=\n)/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = null;
    }
    if (!fence && /^#{2,3} /.test(line)) {
      if (current.text) sections.push(current);
      current = { title: line.replace(/^#+\s*/, "").trim(), text: "" };
    }
    current.text += line;
  }
  if (current.text) sections.push(current);
  return sections.map((section, index) => ({ id: `section-${index}`, ...section }));
}

export function coreProtocolSections(sections) {
  const required = [
    /^Behavioral & Analytical Rules/i,
    /^AI Self-Validation Checklist/i,
    /^Input Trust Boundary/i,
    /^Data Integrity Hierarchy/i,
  ].map((pattern) => sections.find(({ title }) => pattern.test(title)));
  if (required.some((section) => !section))
    throw new CoachError(
      "The official protocol's core sections could not be identified. Integration review is required."
    );
  return required;
}

export async function boundedText(response, limit, label) {
  const reader = response.body?.getReader();
  if (!reader) throw new CoachError(`${label} returned no content.`);
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new CoachError(`${label} exceeds the supported file size.`);
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new CoachError(`${label} is not valid JSON.`);
  }
}

export function jsonPointer(value, pointer = "") {
  if (
    typeof pointer !== "string" ||
    pointer.length > 500 ||
    (pointer && !pointer.startsWith("/"))
  ) {
    throw new CoachError(
      "Use an empty JSON pointer for the whole file, or a pointer starting with /.",
      400
    );
  }
  if (!pointer) return value;
  for (const raw of pointer.slice(1).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) {
      throw new CoachError("That JSON pointer does not exist in this file.", 400);
    }
    value = value[key];
  }
  return value;
}

// Return an explicit index instead of silently truncating a large JSON value.
export function dataSelection(value, pointer = "") {
  const selected = jsonPointer(value, pointer);
  if (JSON.stringify(selected).length <= 180000) return { pointer, complete: true, data: selected };
  const keys = Object.keys(selected);
  return {
    pointer,
    complete: false,
    instruction:
      "This is an index, not the data. Read the relevant children with JSON pointers before drawing conclusions.",
    childCount: keys.length,
    children: keys.slice(0, 200).map((key) => ({
      pointer: `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`,
      type: Array.isArray(selected[key]) ? "array" : typeof selected[key],
      ...(Array.isArray(selected[key]) ? { length: selected[key].length } : {}),
    })),
  };
}

export function createGithubCoachSource({
  fetchImpl = fetch,
  now = Date.now,
  readInstructions = readCoachInstructions,
} = {}) {
  let referenceCache;

  async function github(repo, resource, token, signal, raw = false, limit = 2000000) {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/${resource}`, {
      headers: {
        Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "training-agent-coach",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      redirect: "error",
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      const scope =
        repo === UPSTREAM ? "Official Section 11 repository" : "Private training repository";
      const hint = [401, 403, 404].includes(response.status)
        ? " Check repository access, branch, file names and token expiry."
        : " Try again after the GitHub service recovers.";
      throw new CoachError(`${scope} could not be read (HTTP ${response.status}).${hint}`);
    }
    return boundedText(response, limit, "GitHub file");
  }

  async function revision(repo, branch, token, signal) {
    const data = parseJson(
      await github(repo, `commits/${encodeURIComponent(branch)}`, token, signal),
      "GitHub revision"
    );
    if (!/^[a-f0-9]{40}$/.test(data.sha || ""))
      throw new CoachError("GitHub returned an invalid revision.");
    return data.sha;
  }

  function contents(repo, file, sha, token, signal, limit) {
    const pathname = file.split("/").map(encodeURIComponent).join("/");
    return github(repo, `contents/${pathname}?ref=${sha}`, token, signal, true, limit);
  }

  async function references(signal) {
    if (referenceCache && now() - referenceCache.checkedAt < 600000) return referenceCache;
    const sha = UPSTREAM_REVISION;
    if (sha === referenceCache?.sha) {
      referenceCache = { ...referenceCache, checkedAt: now() };
      return referenceCache;
    }
    const protocol = await contents(UPSTREAM, "SECTION_11.md", sha, null, signal, 650000);
    if (!protocol.startsWith("# Section 11")) {
      throw new CoachError(
        "The official Section 11 documents have changed format. Integration review is required."
      );
    }
    const sections = protocolSections(protocol);
    referenceCache = {
      sha,
      checkedAt: now(),
      protocol,
      sections,
      coreSections: coreProtocolSections(sections),
    };
    return referenceCache;
  }

  return {
    // Lightweight, commit-pinned data reader for sync gates. No model call or dossier read.
    async snapshot(config, signal) {
      const { repo, branch, githubToken } = config;
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
        throw new CoachError("Configure the training repository first.", 503);
      const sha = await revision(repo, branch, githubToken, signal);
      const files = new Map();
      async function read(file) {
        if (!TRAINING_FILES.includes(file)) throw new CoachError("Unsupported training file.", 400);
        if (!files.has(file))
          files.set(
            file,
            parseJson(await contents(repo, file, sha, githubToken, signal, 12000000), file)
          );
        return files.get(file);
      }
      return { sha, latest: await read("latest.json"), read };
    },
    async open(config, signal) {
      const { repo, branch, githubToken } = config;
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
        throw new CoachError("TRAINING_DATA_GITHUB_REPO must be owner/repository.", 503);
      let sha;
      let files;
      async function refresh() {
        sha = await revision(repo, branch, githubToken, signal);
        const [latestText, dossier] = await Promise.all([
          contents(repo, "latest.json", sha, githubToken, signal, 2000000),
          contents(repo, "DOSSIER.md", sha, githubToken, signal, 100000),
        ]);
        const latest = parseJson(latestText, "latest.json");
        if (
          !latest ||
          typeof latest !== "object" ||
          Array.isArray(latest) ||
          !latest.metadata ||
          !latest.current_status
        ) {
          throw new CoachError(
            "latest.json is missing the Section 11 metadata or current_status. Check the sync workflow."
          );
        }
        if (!dossier.trim()) throw new CoachError("DOSSIER.md is empty.");
        files = new Map([["latest.json", latest]]);
        return { latest, dossier };
      }
      const [snapshot, reference, instructions] = await Promise.all([
        refresh(),
        references(signal),
        readInstructions(),
      ]);
      const docs = {
        ...reference,
        contract: instructions.text,
        instructionsRevision: instructions.revision,
      };
      return {
        ...snapshot,
        docs,
        async readData(file) {
          if (!TRAINING_FILES.includes(file))
            throw new CoachError("Unsupported training file.", 400);
          if (!files.has(file))
            files.set(
              file,
              parseJson(await contents(repo, file, sha, githubToken, signal, 12000000), file)
            );
          return files.get(file);
        },
        readProtocol(ids) {
          if (
            !Array.isArray(ids) ||
            !ids.length ||
            ids.length > 6 ||
            ids.some((id) => typeof id !== "string")
          ) {
            throw new CoachError(
              "Select between one and six protocol section IDs from the index.",
              400
            );
          }
          const selected = [...new Set(ids)].map((id) =>
            docs.sections.find((section) => section.id === id)
          );
          if (selected.some((section) => !section))
            throw new CoachError("Unknown protocol section. Use the supplied index.", 400);
          if (selected.reduce((size, section) => size + section.text.length, 0) > 100000) {
            throw new CoachError("Read fewer protocol sections at a time.", 400);
          }
          return { file: "SECTION_11.md", revision: docs.sha, sections: selected };
        },
        metadata() {
          const raw = files.get("latest.json").metadata.last_updated;
          // sync.py emits naive UTC timestamps; do not interpret them as server-local time.
          const timestamp =
            typeof raw === "string" ? raw + (/([zZ]|[+-]\d\d:\d\d)$/.test(raw) ? "" : "Z") : "";
          const ms = Date.parse(timestamp);
          const age = Number.isFinite(ms) ? now() - ms : null;
          return {
            dataRevision: sha,
            protocolRevision: docs.sha,
            instructionsRevision: docs.instructionsRevision,
            protocolVersion:
              docs.protocol.match(/\*\*Protocol Version:\*\*\s*([^\r\n]+)/)?.[1]?.trim() || null,
            lastSynced: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
            freshness:
              age === null || age < -300000 ? "unknown" : age > 3600000 ? "delayed" : "recent",
            checkedAt: new Date(now()).toISOString(),
          };
        },
        async readTraining(file, pointer, forceRefresh = false) {
          if (!TRAINING_FILES.includes(file))
            throw new CoachError("That training file is not available to this chat.", 400);
          let refreshed;
          if (forceRefresh) refreshed = await refresh();
          if (!files.has(file))
            files.set(
              file,
              parseJson(await contents(repo, file, sha, githubToken, signal, 12000000), file)
            );
          return {
            file,
            ...dataSelection(files.get(file), pointer),
            source: this.metadata(),
            ...(refreshed ? { refreshedDossier: refreshed.dossier } : {}),
          };
        },
        async readReference(file) {
          if (!REFERENCE_FILES.includes(file))
            throw new CoachError("That official report reference is not available.", 400);
          const supplied = await readReportTemplate(file);
          if (supplied) return supplied;
          return {
            file,
            revision: docs.sha,
            text: await contents(
              UPSTREAM,
              `examples/reports/${file}`,
              docs.sha,
              null,
              signal,
              80000
            ),
          };
        },
      };
    },
  };
}
