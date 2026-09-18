// Completed activities and FIT recordings use SI units, even in a yard pool.
// Planned Intervals workouts use this athlete's separate same-number mtr
// workaround. Never apply that planned-workout convention to recorded data.
export const METERS_PER_YARD = 0.9144;
export const METERS_PER_100_YARDS = 91.44;
export const recordedSwimYards = (meters) => meters / METERS_PER_YARD;
