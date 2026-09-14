import type { ComponentProps } from "react";
import { Loader2Icon } from "lucide-react";

/**
 * `sm` matches dense controls (grid row actions, inline buttons); `md` is the
 * default and matches page-level loading states and standard buttons.
 */
const SIZES = {
  sm: "size-3.5",
  md: "size-4",
} as const;

/**
 * `size` is a variant, not a free-form class, and the classes are concatenated
 * rather than run through `cn()`.
 *
 * That is deliberate and load-bearing. `cn()` pulls in `tailwind-merge` (~9 KB
 * gzip), and this component is the one `components/ui/*` module reachable from
 * the *synchronous* entry graph — `appLayout.tsx`'s Suspense fallback renders a
 * spinner, and every page pays for whatever that import drags in. When this used
 * `cn('size-4 animate-spin', className)` purely so a caller's `size-3.5` could
 * beat the default `size-4`, it put tailwind-merge in the entry chunk and cost
 * ~9 KB gzip on every single page load. Picking the size up front means the two
 * classes never conflict, so nothing needs to resolve them.
 *
 * Same reasoning and same shape as `PicklistSelect`'s `size` prop — keep it.
 */
type SpinnerProps = Omit<ComponentProps<typeof Loader2Icon>, "size"> & {
  size?: keyof typeof SIZES;
};

function Spinner({ size = "md", className = "", ...props }: SpinnerProps) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={`${SIZES[size]} animate-spin ${className}`.trim()}
      {...props}
    />
  );
}

export { Spinner };
