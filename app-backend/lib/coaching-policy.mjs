import fs from "node:fs/promises";

let sourcePromise;

function sources() {
  return (sourcePromise ||= Promise.all([
    fs.readFile(
      new URL("../vendor/section-11/PROJECT_INSTRUCTIONS_AGENTIC.md", import.meta.url),
      "utf8"
    ),
    fs.readFile(new URL("../vendor/section-11/SECTION_11.md", import.meta.url), "utf8"),
    fs.readFile(
      new URL(
        "../vendor/section-11/examples/workout-library/WORKOUT_REFERENCE.md",
        import.meta.url
      ),
      "utf8"
    ),
  ]).then(([agentic, protocol, workouts]) => ({ agentic, protocol, workouts })));
}

export async function loadCoachingInstructions(message = "") {
  const { agentic, protocol, workouts } = await sources();
  const needsWorkoutLibrary =
    /\b(create|build|add|schedule|prescribe|plan|workouts?|intervals?|sessions?|rides?|runs?|swims?)\b/i.test(
      String(message)
    );
  const officialCoach = `${agentic}\n\n${protocol}`;
  return needsWorkoutLibrary ? `${officialCoach}\n\n${workouts}` : officialCoach;
}
