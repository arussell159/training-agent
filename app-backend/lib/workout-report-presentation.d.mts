export function parseWorkoutReport(text: string, kind: "pre" | "post"): {
  verdict: string[][];
  sections: { title: string; headers: string[]; rows: string[][]; prose: string[]; tables: {title:string;headers:string[];rows:string[][]}[] }[];
};
