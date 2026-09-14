import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import type { ReactNode } from "react";

/**
 * `destructive` — something failed, or is blocking the action (red).
 * `warning` — the action will proceed but the result is worth reading first (amber).
 * `success` — something completed (green).
 * `info` — neutral context, no outcome attached.
 */
export type BannerTone = "destructive" | "warning" | "success" | "info";

interface BannerProps {
  tone: BannerTone;
  children: ReactNode;
  /** Hide the leading icon — for banners that render their own per-row icons. */
  hideIcon?: boolean;
  /** `sm` matches inline notices inside panels; `md` is the page-level default. */
  size?: "sm" | "md";
  className?: string;
}

/**
 * The app's one status banner.
 *
 * This markup was copy-pasted across five pages, and the copies had already
 * drifted — three different green shades for "good", amber with a dark-mode
 * variant in some places and not others. More importantly the colours were
 * hand-picked per site (raw palette classes like emerald-600 / amber-800), so nothing
 * guaranteed any of them cleared contrast; the destructive copy measured
 * 4.36:1 and was the app's only Lighthouse accessibility failure.
 *
 * Every tone here resolves to a theme token whose lightness was chosen against
 * the /5 tint this component renders — see the note in `styles/global.css`.
 * That's the reason to route new banners through here rather than rebuild the
 * class string: the contrast guarantee lives with the colour, not the call site.
 *
 * The `/5` tint is deliberate and load-bearing: these banners carry *text*, and
 * at `/10` the same tokens drop to ~4.3:1 and fail AA. Icons are exempt (WCAG
 * allows 3:1 for graphics), which is why `ConfirmDialog` can still use `/10`
 * behind its icon.
 */
const TONES: Record<BannerTone, { wrapper: string; Icon: typeof AlertCircle }> =
  {
    destructive: {
      wrapper: "text-destructive border-destructive/20 bg-destructive/5",
      Icon: AlertCircle,
    },
    warning: {
      wrapper: "text-warning border-warning/30 bg-warning/5",
      Icon: AlertCircle,
    },
    success: {
      wrapper: "text-success border-success/30 bg-success/5",
      Icon: CheckCircle2,
    },
    info: {
      wrapper: "text-muted-foreground border-border bg-muted/40",
      Icon: Info,
    },
  };

const SIZES = {
  sm: "gap-2 rounded-md px-3 py-2 text-xs",
  md: "gap-3 rounded-lg px-4 py-3 text-sm",
} as const;

const ICON_SIZES = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
} as const;

export function Banner({
  tone,
  children,
  hideIcon = false,
  size = "md",
  className = "",
}: BannerProps) {
  const { wrapper, Icon } = TONES[tone];

  return (
    <div
      className={`${wrapper} ${SIZES[size]} flex items-start border ${className}`.trim()}
    >
      {!hideIcon && (
        <Icon className={`${ICON_SIZES[size]} mt-0.5 shrink-0`} aria-hidden />
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
