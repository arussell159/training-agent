export type WeeklyReportPresentationEntry = {
  label: string;
  value: string;
};

export type WeeklyReportPresentationSection = {
  title: string;
  entries: WeeklyReportPresentationEntry[];
  prose: string[];
};

export type WeeklyReportPresentation = {
  heading: string;
  startDate: string | null;
  endDate: string | null;
  summary: string[];
  sections: WeeklyReportPresentationSection[];
};

export function parseWeeklyReportPresentation(text: string): WeeklyReportPresentation;
