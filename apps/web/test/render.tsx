// Rendering a component as the app does (the DOM is test/dom.ts, preloaded): English, the query cache filled
// with the data the screen reads (no requests), tooltips, and — for screens with links — a router in memory.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import "../src/i18n/index.ts";
import { TooltipProvider } from "../src/ui/components/tooltip.tsx";

/** A query client whose cache holds `data` by query key; nothing goes stale, nothing is fetched. The
 *  profile's settings (read all over the app) start empty — the defaults — unless a test gives them. */
export function queryClient(data: Array<[unknown[], unknown]> = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  });
  client.setQueryData(["settings"], {});
  for (const [key, value] of data) client.setQueryData(key, value);
  return client;
}

/** Renders `ui` with the query cache filled; inside a router at `path` when links need one. */
export async function renderApp(
  ui: React.ReactNode,
  { data = [], path }: { data?: Array<[unknown[], unknown]>; path?: string } = {},
) {
  const client = queryClient(data);
  if (path === undefined)
    return {
      client,
      router: undefined,
      ...render(
        <QueryClientProvider client={client}>
          <TooltipProvider>{ui}</TooltipProvider>
        </QueryClientProvider>,
      ),
    };
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "$",
    component: () => <TooltipProvider>{ui}</TooltipProvider>,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return {
    client,
    router,
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}
