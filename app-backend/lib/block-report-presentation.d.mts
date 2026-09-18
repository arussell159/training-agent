export function parseBlockReportPresentation(text: string): {
  summary: string[];
  sections: { title: string; headers: string[]; rows: string[][]; prose: string[] }[];
};
