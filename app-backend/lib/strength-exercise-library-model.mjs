import { strengthParameterFields, newStrengthBlock } from "./workout-strength-model.mjs";

export const strengthMuscleGroups = [
  "None",
  "Abs",
  "Biceps",
  "Calves",
  "Chest",
  "Forearms",
  "Glute",
  "Hamstrings",
  "Lower Back",
  "Quads",
  "Shoulders",
  "Triceps",
  "Upper Back",
];
const fields = new Map(strengthParameterFields.map((field) => [field.kind, field]));
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (message) => {
  throw Object.assign(Error(message), { status: 400, code: "STRENGTH_LIBRARY_INVALID" });
};
const text = (value, max, required = false) =>
  typeof value === "string" &&
  value.length <= max &&
  (!required || value.trim().length > 0) &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) &&
  !/Workout editor v1|training-agent-(?:manual-description|planned-values|workout-comments)-v1|Intervals\.icu device definition:/.test(
    value
  );
export function strengthLibraryId(value) {
  if (typeof value !== "string" || !/^exercise:[A-Za-z0-9_-]{16,80}$/.test(value))
    fail("Choose a saved custom exercise.");
  return value;
}
export function strengthExerciseVideo(value) {
  if (!text(value, 2048)) fail("Use a YouTube or Vimeo video URL of at most 2048 characters.");
  if (!value.trim()) return null;
  if (/\s/.test(value.trim())) fail("Use a video URL without whitespace.");
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    fail("Use a valid HTTPS YouTube or Vimeo video URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    fail("Use a valid HTTPS YouTube or Vimeo video URL.");
  const host = url.hostname.toLowerCase(),
    path = url.pathname.split("/").filter(Boolean);
  let provider,
    id,
    hash = "";
  if (
    [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "youtu.be",
      "www.youtu.be",
      "www.youtube-nocookie.com",
      "youtube-nocookie.com",
    ].includes(host)
  ) {
    provider = "youtube";
    id = host.endsWith("youtu.be")
      ? path[0]
      : path[0] === "watch"
        ? url.searchParams.get("v")
        : ["embed", "shorts", "live"].includes(path[0])
          ? path[1]
          : null;
    if (!/^[A-Za-z0-9_-]{11}$/.test(id || "")) fail("Choose a YouTube video URL.");
  } else if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(host)) {
    provider = "vimeo";
    id = path[0] === "video" ? path[1] : path[0];
    hash = path[0] === "video" ? url.searchParams.get("h") || "" : path[1] || "";
    if (!/^[1-9]\d{0,19}$/.test(id || "") || (hash && !/^[A-Za-z0-9]{1,64}$/.test(hash)))
      fail("Choose a Vimeo video URL.");
  } else fail("Videos must use YouTube or Vimeo.");
  return {
    provider,
    id,
    url: value.trim(),
    embedUrl:
      provider === "youtube"
        ? `https://www.youtube-nocookie.com/embed/${id}`
        : `https://player.vimeo.com/video/${id}${hash ? `?h=${hash}` : ""}`,
  };
}
export function newStrengthExerciseDefinition() {
  return {
    title: "",
    muscleGroup: "None",
    instructions: "",
    videoUrl: "",
    parameters: [
      { id: crypto.randomUUID(), kind: "reps", unit: "reps" },
      { id: crypto.randomUUID(), kind: "weight", unit: "lb" },
    ],
  };
}
export function validateStrengthExerciseDefinition(value) {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) => !["title", "muscleGroup", "instructions", "videoUrl", "parameters"].includes(key)
    ) ||
    !text(value.title, 128, true) ||
    !strengthMuscleGroups.includes(value.muscleGroup) ||
    !text(value.instructions, 1000) ||
    !Array.isArray(value.parameters) ||
    !value.parameters.length ||
    value.parameters.length > 12
  )
    fail(
      "Enter an exercise title (128 characters), muscle group, instructions (1000 characters), and 1–12 parameters."
    );
  strengthExerciseVideo(value.videoUrl);
  const ids = new Set();
  for (const column of value.parameters) {
    if (
      !object(column) ||
      Object.keys(column).some((key) => !["id", "kind", "unit"].includes(key)) ||
      typeof column.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(column.id) ||
      ids.has(column.id) ||
      !fields.get(column.kind)?.units.includes(column.unit)
    )
      fail("Use valid independent exercise parameter columns and units.");
    ids.add(column.id);
  }
  return {
    title: value.title.trim(),
    muscleGroup: value.muscleGroup,
    instructions: value.instructions,
    videoUrl: value.videoUrl.trim(),
    parameters: structuredClone(value.parameters),
  };
}
export function strengthLibraryExerciseBlock(value) {
  const id = strengthLibraryId(value?.id),
    definition = validateStrengthExerciseDefinition(
      Object.fromEntries(
        ["title", "muscleGroup", "instructions", "videoUrl", "parameters"].map((key) => [
          key,
          value[key],
        ])
      )
    );
  const parameters = definition.parameters.map((column) => ({
    ...column,
    id: crypto.randomUUID(),
  }));
  const exercise = {
    id: crypto.randomUUID(),
    libraryExerciseId: id,
    title: definition.title,
    instructions: definition.instructions,
    notes: "",
    parameters,
    sets: Array.from({ length: 3 }, () => ({
      id: crypto.randomUUID(),
      values: Object.fromEntries(parameters.map((column) => [column.id, null])),
    })),
  };
  return newStrengthBlock("single", exercise);
}
export function isStrengthLibraryExercise(value) {
  try {
    strengthLibraryId(value?.id);
    if (
      !/^[a-f0-9]{64}$/.test(value.revision || "") ||
      !/^[a-f0-9]{64}$/.test(value.accountScope || "") ||
      value.owner !== "me" ||
      typeof value.editable !== "boolean" ||
      !["createdAt", "updatedAt"].every(
        (key) => typeof value[key] === "string" && new Date(value[key]).toISOString() === value[key]
      )
    )
      return false;
    const definition = Object.fromEntries(
      ["title", "muscleGroup", "instructions", "videoUrl", "parameters"].map((key) => [
        key,
        value[key],
      ])
    );
    return (
      JSON.stringify(validateStrengthExerciseDefinition(definition)) === JSON.stringify(definition)
    );
  } catch {
    return false;
  }
}
