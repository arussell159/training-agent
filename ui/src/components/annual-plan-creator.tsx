import { CircleHelp, Plus, Settings } from "lucide-react";

const months = [
  "January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December", "January", "February", "March", "April", "May",
];

const bars = [
  34, 38, 45, 28, 52, 58, 64, 48, 66, 72, 80, 42, 54, 62, 70, 76, 84, 46, 58, 68, 74, 88, 94, 90,
  70, 52, 60, 68, 74, 64, 48, 38, 29, 35, 42, 55, 62, 70, 60, 50, 43, 35, 28, 24, 30, 36, 44, 50,
];

const phaseSegments = [
  ["Not Set", 3, "bg-zinc-500"], ["Preparation", 3, "bg-zinc-500"], ["Base 1", 3, "bg-sky-700"],
  ["Base 2", 3, "bg-sky-800"], ["Base 3", 3, "bg-sky-900"], ["Transition", 1, "bg-zinc-500"],
  ["Build 1", 3, "bg-lime-600"], ["Build 2", 3, "bg-green-700"], ["Peak", 2, "bg-yellow-500"],
  ["Transition", 1, "bg-zinc-500"], ["Race", 1, "bg-red-500"], ["Transition", 1, "bg-zinc-500"],
];

const rows = [
  ["7 - 13", "0", "Peak - Week 1", "9:30:00", "7:47:04", "Biggest Brick - 3.5hr Ride - 1.5hr Run Off"],
  ["14 - 20", "0", "Peak - Week 2", "8:30:00", "1:10:56", "Second Brick - 3.5hr Ride - 1hr Run Off"],
  ["21 - 27", "0", "Transition", "8:00:00", "0:00:00", ""],
  ["28 - Oct 4", "0", "Race", "2:30:00", "0:00:00", ""],
  ["5 - 11", "0", "Transition", "3:00:00", "0:00:00", ""],
  ["12 - 18", "0", "Preparation", "5:00:00", "0:00:00", ""],
  ["19 - 25", "0", "Build 2 - Week 1", "6:00:00", "0:00:00", ""],
  ["26 - Nov 1", "0", "Build 2 - Week 2", "7:00:00", "0:00:00", ""],
  ["2 - 8", "0", "Build 2 - Week 3", "8:00:00", "0:00:00", ""],
  ["9 - 15", "0", "Build 2 - Week 4", "5:00:00", "0:00:00", ""],
  ["16 - 22", "0", "Peak - Week 1", "6:00:00", "0:00:00", ""],
  ["23 - 29", "0", "Peak - Week 2", "5:00:00", "0:00:00", ""],
];

function phaseColor(label: string) {
  if (label.startsWith("Peak")) return "bg-yellow-500";
  if (label === "Race") return "bg-red-500";
  if (label === "Transition" || label === "Preparation") return "bg-zinc-500";
  return "bg-green-700";
}

export function AnnualPlanCreator() {
  return (
    <main className="h-full min-w-0 overflow-hidden bg-white text-slate-800">
      <div className="flex h-full min-w-0 flex-col">
        <header className="border-b border-slate-200 px-5 pt-5">
          <div className="flex items-center gap-4 text-[20px]">
            <h1 className="font-normal">ATP 2027</h1>
            <CircleHelp size={18} className="text-slate-600" />
            <Settings size={18} className="text-slate-500" />
            <Plus size={20} className="text-slate-500" />
            <button className="text-base text-blue-700 underline">Learn More</button>
          </div>
          <div className="mt-2 flex gap-5 bg-slate-200 px-2 py-1 text-[11px] font-semibold">
            <span>ATP Hours: <b>257:00:00 h</b></span><span>Planned: <b>253:39:27 h</b></span><span>Completed: <b>201:10:34 h</b></span>
          </div>
        </header>

        <section className="shrink-0 overflow-x-auto px-1 pt-0">
          <div className="min-w-[1280px]">
          <div className="grid h-7" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
            {months.map((month, index) => <div key={`${month}-${index}`} className={`border-r border-slate-200 px-2 pt-2 text-[10px] ${index === 8 ? "border-t-2 border-t-blue-400" : "bg-slate-50"}`}>{month}</div>)}
          </div>
          <div className="flex h-48 items-end gap-1 border-b-4 border-slate-500 px-1 pb-1">
            {bars.map((height, index) => <div key={index} className={`min-w-0 flex-1 ${index > 20 && index < 34 ? "bg-green-600" : index === 36 ? "bg-yellow-500" : "bg-slate-300"}`} style={{ height: `${height}%` }} />)}
          </div>
          <div className="flex gap-1 px-1 pt-1">
            {phaseSegments.map(([label, width, color], index) => <div key={`${label}-${index}`} className={`${color} h-1.5 min-w-0`} style={{ flex: Number(width) }} title={String(label)} />)}
          </div>
          <div className="flex gap-8 px-20 py-2 text-[9px] text-slate-500"><span>Not Set</span><span>Preparation</span><span>Base 1</span><span>Base 2</span><span>Base 3</span><span>Transition</span><span>Build 1</span><span>Build 2</span><span>Peak</span><span>Race</span></div>
          </div>
        </section>

        <section className="mt-3 min-h-0 flex-1 overflow-auto border-t border-slate-300 text-xs">
          <div className="grid min-w-[1050px] grid-cols-[15%_11%_24%_18%_11%_10%_1fr] border-b border-slate-300 bg-slate-100 px-1 py-2 font-medium text-blue-800">
            <span>Week</span><span>Weeks to Event</span><span>Event</span><span>Priority</span><span>Hours</span><span>Completed</span><span>Details</span>
          </div>
          <div className="min-w-[1050px]">
          {rows.map((row, index) => <div key={row[0]} className={`grid grid-cols-[15%_11%_24%_18%_11%_10%_1fr] items-center border-b border-slate-200 px-1 ${index === 4 || index === 8 ? "border-t-4 border-slate-300" : ""} ${index % 2 ? "bg-blue-50" : "bg-slate-50"}`}><span className="py-2">{row[0]}</span><span>{row[1]}</span><span></span><span className={`${phaseColor(row[2])} py-2 pl-2 font-semibold text-white`}>{row[2]}</span><span>{row[3]}</span><span className="font-semibold text-slate-500">{row[4]}</span><span className="text-[10px] text-blue-800 underline">{row[5]}</span></div>)}
          </div>
        </section>
      </div>
    </main>
  );
}
