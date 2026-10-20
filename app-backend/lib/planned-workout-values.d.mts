export const plannedValueFields: string[];
export function validatePlannedValues(values: unknown): Record<string, number | null>;
export function readPlannedValues(description: unknown): Record<string, number | null>;
export function stripPlannedValues(description: unknown): string;
export function withPlannedValues(description: unknown, values: Record<string, number | null>): string;
