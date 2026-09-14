import { Suspense } from "react";
import { Outlet } from "react-router";
import NavigationMenu from "./navigationMenu";
import { Toaster } from "./components/ui/sonner";
import { Spinner } from "./components/ui/spinner";
import { useWarmObjectList } from "./hooks/useWarmObjectList";

export default function AppLayout() {
  /*
    Starts the org's object list downloading now, so Data Export and Data Import
    find it warm. The call takes 10–20 seconds on a large org, so the head start
    is worth a call a record-only session won't use. The hook imports its module
    dynamically — read the note in it before changing that.
  */
  useWarmObjectList();

  return (
    <div className="bg-background text-foreground min-h-screen">
      {/* Branded top navigation (Inspector / Salesforce) */}
      <NavigationMenu />

      {/*
        Routed page content. Pages are lazy (see routes.tsx), so a boundary is
        required — without one, React throws on the first navigation rather than
        showing anything.

        The nav sits *outside* it deliberately: it renders from static route
        metadata, so it should stay on screen and interactive while a page chunk
        loads, rather than the whole shell flashing.
      */}
      <main>
        <Suspense
          fallback={
            <div className="text-muted-foreground flex items-center justify-center gap-2 px-4 py-16 text-sm">
              {/*
                This is the one spinner on the *synchronous* entry graph — every
                page pays for whatever it imports. `Spinner` is deliberately free
                of `cn()`/tailwind-merge so it can be used here; see the note in
                components/ui/spinner.tsx before adding `cn()` back to it.
              */}
              <Spinner />
              Loading…
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>

      {/*
        Where every "that worked" / "that didn't" lands.

        Mounted once here rather than per page, because the outcome of an action
        shouldn't compete for space with the thing that produced it — a save
        confirmation docked above a 700-row field grid either pushes the grid
        down or scrolls off before it's read. Durable results that the user acts
        on (Data Import's per-row report, with its Undo and Download failed rows
        buttons) stay on the page; transient outcomes come through here.
      */}
      <Toaster />
    </div>
  );
}
