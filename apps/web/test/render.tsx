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

/** A query client whose cache holds `data` by query key, and `failed` queries' errors; nothing goes
 *  stale, nothing is fetched (a failed query is not tried again). The profile's settings (read all
 *  over the app) start empty — the defaults — unless a test gives them; Qwen3-TTS, the default
 *  engine, is not on this computer (the device's voices read) unless a test gives it. */
export function queryClient(
  data: Array<[unknown[], unknown]> = [],
  failed: Array<[unknown[], Error]> = [],
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Number.POSITIVE_INFINITY, retry: false, retryOnMount: false },
    },
  });
  client.setQueryData(["settings"], {});
  client.setQueryData(["qwen-tts"], {
    engine: false,
    models: [],
    languages: [],
    speakers: [],
    defaultSpeaker: "ryan",
  });
  for (const [key, value] of data) client.setQueryData(key, value);
  for (const [queryKey, error] of failed)
    client.getQueryCache().build(client, { queryKey }).setState({ status: "error", error });
  return client;
}

/** Renders `ui` with the query cache filled (and `failed` queries failed); inside a router at `path`
 *  when links need one. */
export async function renderApp(
  ui: React.ReactNode,
  {
    data = [],
    failed = [],
    path,
  }: { data?: Array<[unknown[], unknown]>; failed?: Array<[unknown[], Error]>; path?: string } = {},
) {
  const client = queryClient(data, failed);
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
