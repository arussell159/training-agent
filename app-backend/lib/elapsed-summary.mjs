export function elapsedSummary(activity) {
  const seconds = activity?.elapsed_time,
    distance = activity?.distance;
  const elapsed =
    typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  return {
    elapsed_time_seconds: elapsed,
    elapsed_speed:
      elapsed > 0 && typeof distance === "number" && Number.isFinite(distance) && distance > 0
        ? distance / elapsed
        : null,
  };
}
