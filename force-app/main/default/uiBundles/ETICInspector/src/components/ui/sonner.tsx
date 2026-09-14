import { Toaster as Sonner } from "sonner";

/**
 * Renders the toast container. Use with `toast()` from this module for messages
 * with title, description, actions, and variants (success, error, warning).
 *
 * @example
 * toast("Event has been created", {
 *   description: "Sunday, December 03, 2023 at 9:00 AM",
 *   action: { label: "Undo", onClick: () => {} },
 * });
 * toast.success("Saved!");
 * toast.error("Something went wrong");
 * toast.warning("Please review");
 */
export function Toaster() {
  return (
    // `offset` clears the sticky nav (`h-14`, 56px) plus a gutter. At sonner's
    // default it sat on top of the nav, covering the API-limit meter — which is
    // the one thing a user is likely to check right after a write.
    <Sonner position="top-right" richColors offset="72px" />
  );
}

export { toast } from "sonner";
