import { lazy } from "react";
import type { RouteObject } from "react-router";
import AppLayout from "./appLayout";

/**
 * Pages are code-split, so a visitor downloads only the screen they open.
 *
 * The whole app used to ship as one chunk, which meant Home paid for Data
 * Export's two query compilers, its results grid and the export serializers
 * before rendering anything.
 *
 * `handle` deliberately stays inline and static. `navigationMenu.tsx` builds the
 * nav from `getAllRoutes()` by reading `handle.showInNavigation` and
 * `handle.label`, and it must be able to do that without pulling in any page
 * chunk — otherwise rendering the nav would defeat the splitting entirely.
 *
 * `NotFound` is *not* lazy: it is a handful of elements, and it is the one route
 * that renders when the requested path is already wrong. Making the error screen
 * depend on a further network fetch is the wrong trade.
 */
const Home = lazy(() => import("./pages/Home"));
const ShowAllData = lazy(() => import("./pages/ShowAllData"));
const Users = lazy(() => import("./pages/Users"));
const DataExport = lazy(() => import("./pages/DataExport"));
const DataImport = lazy(() => import("./pages/DataImport"));

import NotFound from "./pages/NotFound";
import { RootError, RouteError } from "./components/RouteError";

/**
 * Every page gets the same boundary, registered per child route rather than on
 * the layout route.
 *
 * That placement is the point: an `errorElement` replaces the element of the
 * route it sits on, so putting it on the layout would swap out the nav too and
 * leave a failed page with no way to reach a working one. On the children, the
 * shell survives and only the outlet shows the error.
 */
const errorElement = <RouteError />;

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppLayout />,
    // Last resort: the layout or the nav itself threw, so the child boundary
    // never mounted.
    errorElement: <RootError />,
    children: [
      {
        index: true,
        element: <Home />,
        errorElement,
        handle: { showInNavigation: true, label: "Home" },
      },
      {
        path: "show-all-data",
        element: <ShowAllData />,
        errorElement,
        handle: { showInNavigation: true, label: "All Data" },
      },
      {
        path: "users",
        element: <Users />,
        errorElement,
        handle: { showInNavigation: true, label: "Users" },
      },
      {
        path: "data-export",
        element: <DataExport />,
        errorElement,
        handle: { showInNavigation: true, label: "Data Export" },
      },
      {
        path: "data-import",
        element: <DataImport />,
        errorElement,
        handle: { showInNavigation: true, label: "Data Import" },
      },
      {
        path: "*",
        element: <NotFound />,
        errorElement,
      },
    ],
  },
];
