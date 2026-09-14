import {
  Boxes,
  Database,
  House,
  Info,
  Menu,
  Table2,
  Upload,
  Users,
  X,
} from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { getAllRoutes } from "./router-utils";
import { NavApiUsage } from "./features/inspector/components/NavApiUsage";
import { getOrgEnv, orgToneClasses } from "./lib/orgEnv";

interface NavItem {
  path: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

/** Icons keyed by route label so the data-driven items get an icon too. */
const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  Home: House,
  "All Data": Table2,
  Users: Users,
  "Data Export": Database,
  "Data Import": Upload,
};

export default function NavigationMenu() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  const routeItems: NavItem[] = getAllRoutes()
    .filter(
      (route) =>
        route.handle?.showInNavigation === true &&
        route.fullPath !== undefined &&
        route.handle?.label !== undefined,
    )
    .map((route) => {
      const label = route.handle?.label as string;
      return {
        path: route.fullPath as string,
        label,
        icon: ICONS[label] ?? Boxes,
      };
    });

  const isActive = (path: string) =>
    path === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(path);

  const org = getOrgEnv();
  const tone = orgToneClasses(org.tone);

  return (
    <header className="bg-card border-border sticky top-0 z-30 border-b shadow-sm">
      <div className="mx-auto flex h-14 max-w-[120rem] items-center gap-4 px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-2.5">
          <span className="bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-lg">
            <Info className="h-5 w-5" />
          </span>
          <span className="leading-tight">
            <span className="text-foreground block text-base font-bold">
              Inspector
            </span>
            <span className="text-muted-foreground block text-[11px]">
              Salesforce
            </span>
          </span>
        </Link>

        {/* Desktop inline nav — pill active state */}
        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {routeItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right cluster */}
        <div className="ml-auto flex items-center gap-3">
          {/* Org badge */}
          <span
            className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide sm:inline-flex ${tone.pill}`}
            title={`You are connected to a ${org.label.toLowerCase()} org`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
            {org.label}
          </span>

          {/* Compact API meter */}
          <NavApiUsage />

          {/* Mobile menu toggle */}
          <button
            type="button"
            aria-label="Toggle menu"
            onClick={() => setOpen((v) => !v)}
            className="text-muted-foreground hover:text-foreground md:hidden"
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="border-border border-t md:hidden">
          <nav className="mx-auto flex max-w-[120rem] flex-col gap-1 px-4 py-3 sm:px-6">
            {routeItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setOpen(false)}
                  className={[
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted",
                  ].join(" ")}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
            <span
              className={`mt-2 inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone.pill}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
              {org.label}
            </span>
          </nav>
        </div>
      )}
    </header>
  );
}
