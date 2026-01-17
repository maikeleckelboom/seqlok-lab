export type NotesMode = "legend" | "short" | "full";

export type LegendEntry = Readonly<{
  token: string;
  anchor: string;
  title: string;
}>;

export function formatNotesBulk(
  notes: readonly string[],
  mode: NotesMode,
): Readonly<{ notes: readonly string[]; legend: readonly LegendEntry[] }> {
  const linkRegex = /\[([^\]]+)]\(#?([^)]+)\)/g;

  if (mode === "legend") {
    const anchorToTitle = new Map<string, string>();
    for (const note of notes) {
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(note)) !== null) {
        const title = match[1]!;
        const anchor = match[2]!.toLowerCase();
        if (!anchorToTitle.has(anchor)) {
          anchorToTitle.set(anchor, title);
        }
      }
    }

    const sortedAnchors = Array.from(anchorToTitle.keys()).sort((a, b) =>
      a.localeCompare(b),
    );
    const anchorToToken = new Map<string, string>();
    const legend: LegendEntry[] = sortedAnchors.map((anchor, idx) => {
      const token = `D${idx + 1}`;
      anchorToToken.set(anchor, token);
      return {
        token,
        anchor: `#${anchor}`,
        title: anchorToTitle.get(anchor)!,
      };
    });

    // Replace links with tokens
    const formattedNotes = notes.map((note) => {
      return note.replace(linkRegex, (full, title, anchor) => {
        const token = anchorToToken.get(anchor.toLowerCase());
        return token ?? title; // fallback to title if no token
      });
    });

    return { notes: formattedNotes, legend };
  }

  if (mode === "short") {
    const formattedNotes = notes.map((note) =>
      note.replace(linkRegex, "$1").replace(/\s+/g, " ").trim(),
    );
    return { notes: formattedNotes, legend: [] };
  }

  // mode === "full"
  const formattedNotes = notes.map((note) => note.replace(linkRegex, "$1"));
  return { notes: formattedNotes, legend: [] };
}
