import {
  ChevronDown,
  ExternalLink,
  List,
  PanelsTopLeft,
  Settings,
  Tags,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { objectSetupLinks } from "../../../lib/salesforce";
import { Button } from "../../../components/ui/button";

interface SetupLinksProps {
  objectApiName: string;
}

/** Simple inline links used by the compact Home summary card. */
export function InlineSetupLinks({ objectApiName }: SetupLinksProps) {
  const links = objectSetupLinks(objectApiName);
  const items = [
    { label: "Fields", href: links.fields },
    { label: "Record Types", href: links.recordTypes },
    { label: "List View", href: links.list },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {items.map(({ label, href }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex cursor-pointer items-center gap-1 font-medium text-blue-600 hover:text-blue-700 hover:underline"
        >
          {label}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ))}
    </div>
  );
}

/**
 * Compact dropdown of Salesforce Setup shortcuts for one object.
 *
 * Every destination here is object-scoped, so `objectApiName` is optional only
 * to let pages mount the button before an object is chosen: without one the
 * button renders disabled rather than opening a menu of dead links. That keeps
 * the control in the same place on every page instead of appearing and
 * disappearing as the page fills in.
 */
export function SetupLinks({ objectApiName }: { objectApiName?: string }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const links = objectSetupLinks(objectApiName ?? "");
  const items = [
    { label: "Fields", href: links.fields, icon: PanelsTopLeft },
    { label: "Record Types", href: links.recordTypes, icon: Tags },
    { label: "List View", href: links.list, icon: List },
  ];

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={dropdownRef} className="relative ml-auto shrink-0">
      <Button
        type="button"
        variant="outline"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!objectApiName}
        title={
          objectApiName ? undefined : "Pick an object to open it in Setup."
        }
        onClick={() => setOpen((current) => !current)}
        className="gap-2 px-3 py-2 shadow-sm"
      >
        <Settings className="h-4 w-4" />
        Open in Setup
        <ChevronDown
          className={`text-muted-foreground h-4 w-4 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </Button>

      {/*
        Guarded on the object too, not just `open`: the object can be cleared
        while the menu is showing, and the links would then point at Setup pages
        for an empty API name.
      */}
      {open && objectApiName && (
        <div
          role="menu"
          className="border-border bg-popover text-popover-foreground absolute right-0 z-30 mt-2 w-52 overflow-hidden rounded-lg border p-1.5 shadow-lg"
        >
          {items.map(({ label, href, icon: Icon }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noreferrer"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="hover:bg-muted hover:text-foreground flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors"
            >
              <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
              <span className="flex-1">{label}</span>
              <ExternalLink className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
