"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TrendingUpIcon, TrendingDownIcon } from "lucide-react";

const metrics = [
  {
    label: "Fitness",
    value: "71",
    change: "−2",
    note: "Expected taper reduction",
    direction: "down",
  },
  { label: "Form", value: "+4", change: "+11", note: "Freshness is building", direction: "up" },
  { label: "Recovery", value: "62", change: "−7", note: "Below your baseline", direction: "down" },
  { label: "Compliance", value: "91%", change: "+3%", note: "Last 30 days", direction: "up" },
];

export function SectionCards() {
  return (
    <div className="grid grid-cols-2 gap-3 *:data-[slot=card]:shadow-xs lg:grid-cols-4">
      {metrics.map((metric) => {
        const Trend = metric.direction === "up" ? TrendingUpIcon : TrendingDownIcon;
        return (
          <Card className="@container/card" key={metric.label}>
            <CardHeader>
              <CardDescription>{metric.label}</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums">{metric.value}</CardTitle>
              <CardAction>
                <Badge variant="outline">
                  <Trend />
                  {metric.change}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1 text-xs">
              <div className="font-medium">{metric.note}</div>
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
