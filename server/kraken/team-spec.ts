// Parses the KRAKEN_TASKS.md a "sequenced"-mode lead writes: one task
// per teammate, each starting with a "## " heading.

export interface SpecTask {
  label: string;
  task: string;
}

export function parseSpecFile(content: string): SpecTask[] {
  const sections = content.split(/^##[ \t]+/m).slice(1);

  return sections
    .map((section) => {
      const [firstLine, ...rest] = section.split("\n");
      return { label: firstLine.trim(), task: rest.join("\n").trim() };
    })
    .filter((section) => section.label.length > 0 || section.task.length > 0);
}
