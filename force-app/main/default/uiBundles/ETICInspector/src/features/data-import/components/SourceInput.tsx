import { FileUp, Upload, X } from "lucide-react";
import { useCallback, useRef, useState, type DragEvent } from "react";
import { Button } from "../../../components/ui/button";
import { sectionLabel } from "../../../components/sectionLabel";

interface SourceInputProps {
  value: string;
  onChange: (text: string) => void;
  /** Row count from the parsed result, for the summary line. */
  rowCount: number;
  delimiterLabel: string | null;
  /**
   * Collapses the textarea once the grid below is showing the same data.
   * Raw text is how the data gets *in*; once parsed, the grid is the better
   * view of it, and leaving eight lines of monospace above the grid just pushes
   * the useful part off screen.
   */
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/** Extensions offered in the picker. Content is sniffed, not trusted to these. */
const ACCEPT = ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain";

/**
 * Where the data comes in: paste, file picker, or drag-and-drop.
 *
 * All three produce one string and hand it to the same parser, so there is one
 * code path to get right rather than three. Files are read with `FileReader`
 * and never leave the browser — the app makes no external requests, and an
 * importer that uploaded the file somewhere would be the first thing to break
 * that.
 */
export function SourceInput({
  value,
  onChange,
  rowCount,
  delimiterLabel,
  collapsed,
  onToggleCollapsed,
}: SourceInputProps) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = useCallback(
    (file: File) => {
      setReadError(null);
      const reader = new FileReader();
      reader.onload = () => {
        setFileName(file.name);
        onChange(typeof reader.result === "string" ? reader.result : "");
      };
      reader.onerror = () => {
        setReadError(`Couldn't read ${file.name}.`);
      };
      reader.readAsText(file);
    },
    [onChange],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) readFile(file);
  };

  const clear = () => {
    setFileName(null);
    setReadError(null);
    onChange("");
    // Without this the same file can't be picked twice in a row: the input
    // holds the old value, so choosing it again fires no change event.
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor="import-source" className={sectionLabel}>
          Paste or drop
        </label>
        {/*
          Real buttons rather than the text links these were.
          `Clear` in particular was a 12px label with no padding and no
          background, sitting flush against another one — the hardest target on
          the page to hit, and the one people reach for most, since it is how you
          start over after pasting the wrong sheet. It carries the `destructive`
          tone because it is the only control here that throws work away.
        */}
        <span className="flex items-center gap-2">
          {rowCount > 0 && (
            <Button type="button" variant="outline" onClick={onToggleCollapsed}>
              {collapsed ? "Show original text" : "Hide text"}
            </Button>
          )}
          {value !== "" && (
            <Button type="button" variant="destructive" onClick={clear}>
              <X />
              Clear
            </Button>
          )}
        </span>
      </div>

      {/*
        The drop zone stays mounted even when the textarea is collapsed, so a
        file can still be dropped onto the page once a table is showing.
      */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-lg border-2 border-dashed transition-colors ${
          collapsed ? "px-3 py-2" : "p-1"
        } ${dragging ? "border-primary bg-primary/5" : "border-border"}`}
      >
        {collapsed ? (
          <p className="text-muted-foreground text-xs">
            {rowCount.toLocaleString()} {rowCount === 1 ? "row" : "rows"} loaded
            — edit them in the table below, or drop another file here to replace
            them.
          </p>
        ) : (
          <>
            {/*
              Read-only once the rows have been parsed.

              The grid below is the authoritative copy from that point on, and
              cell edits deliberately don't flow back into this text (doing so
              would re-apply the spreadsheet formula guard on every keystroke).
              Leaving the box editable therefore showed the *original* paste
              while the grid held corrected data, and typing here silently threw
              those corrections away. It is a record of what was pasted, so it
              reads like one.
            */}
            <textarea
              id="import-source"
              value={value}
              readOnly={rowCount > 0}
              onChange={(e) => {
                if (rowCount > 0) return;
                setFileName(null);
                onChange(e.target.value);
              }}
              spellCheck={false}
              rows={8}
              placeholder={
                "Paste rows copied from Excel or a CSV — the first row is the column headers.\n\nOr drop a file here.\n\nName\tIndustry\nAcme\tEnergy"
              }
              className={`w-full resize-y rounded-md px-3 py-2 font-mono text-xs outline-none ${
                rowCount > 0
                  ? "text-muted-foreground bg-muted/40 cursor-default"
                  : "bg-background text-foreground placeholder:text-muted-foreground/70"
              }`}
            />
            {rowCount > 0 && (
              <p className="text-muted-foreground px-3 pb-1 text-[11px]">
                Read-only — edit the rows in the table below, or Clear to paste
                something else.
              </p>
            )}
          </>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
        >
          <Upload />
          Choose file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) readFile(file);
          }}
        />

        {fileName && (
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
            <FileUp className="h-3.5 w-3.5" />
            {fileName}
          </span>
        )}

        {rowCount > 0 && (
          <span className="text-muted-foreground text-xs">
            {rowCount.toLocaleString()} {rowCount === 1 ? "row" : "rows"}
            {delimiterLabel && ` · ${delimiterLabel}`}
          </span>
        )}
      </div>

      {readError && (
        <p className="text-destructive mt-1.5 text-xs">{readError}</p>
      )}
    </div>
  );
}
