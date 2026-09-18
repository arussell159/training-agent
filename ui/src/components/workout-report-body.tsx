import { parseWorkoutReport } from "../../../app-backend/lib/workout-report-presentation.mjs"

export function WorkoutReportBody({
  text,
  kind,
}: {
  text?: string
  kind: "pre" | "post"
}) {
  const report = parseWorkoutReport(text || "", kind)
  return (
    <article className="space-y-6 text-sm leading-relaxed">
      {report.verdict.length > 0 && (
        <div className="space-y-2 border-l-2 border-foreground pl-4">
          {report.verdict.map(([label, value], index) => (
            <p key={index}>
              <strong>
                {label}: {value}
              </strong>
            </p>
          ))}
        </div>
      )}
      {report.sections.map((section, index) => (
        <section key={index} className="space-y-3">
          <h3 className="text-base font-semibold">{section.title}</h3>
          {section.rows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {section.headers.map((header) => (
                      <th
                        key={header}
                        className="bg-muted px-3 py-2 text-left font-medium"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((cells, row) => (
                    <tr key={row} className="border-b last:border-0">
                      {cells.map((value, col) =>
                        col === 0 ? (
                          <th
                            key={col}
                            className="px-3 py-2 text-left align-top font-medium"
                          >
                            {value}
                          </th>
                        ) : (
                          <td
                            key={col}
                            className="px-3 py-2 align-top whitespace-pre-wrap"
                          >
                            {value}
                          </td>
                        )
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {section.tables.map((table, index) => (
            <div key={index} className="space-y-2">
              <h4 className="font-semibold">{table.title}</h4>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      {table.headers.map((header) => (
                        <th
                          key={header}
                          className="bg-muted px-3 py-2 text-left font-medium"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((cells, row) => (
                      <tr key={row} className="border-b last:border-0">
                        {cells.map((cell, col) => (
                          <td key={col} className="px-3 py-2">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {section.prose.map((line, paragraph) => (
            <p key={paragraph} className="whitespace-pre-wrap">
              {line}
            </p>
          ))}
        </section>
      ))}
    </article>
  )
}
