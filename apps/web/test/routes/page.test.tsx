import { afterEach, expect, spyOn, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { opening, page, RouteError } from "../../src/routes/page.tsx";
import { queryClient } from "../render.tsx";

afterEach(() => sessionStorage.clear());

/** A route showing `Page` with our error component, as the app's router has it. */
async function renderRoute(Page: ReturnType<typeof page<object>>) {
  const root = createRootRoute();
  const only = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: opening(Page, () => <Page />),
  });
  const router = createRouter({
    routeTree: root.addChildren([only]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    defaultErrorComponent: RouteError,
  });
  const view = render(
    <QueryClientProvider client={queryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await router.load();
  return view;
}

test("a page loads when opened; a slot shows nothing while it loads", async () => {
  let done = (_: () => React.ReactNode) => {};
  const Slot = page(() => new Promise<() => React.ReactNode>((resolve) => (done = resolve)), null);
  // Rendered in an awaited act: React resumes a suspended component there.
  const view = await act(async () =>
    render(
      <p data-testid="card">
        <Slot />
      </p>,
    ),
  );
  expect(view.getByTestId("card").textContent).toBe("");
  await act(async () => done(() => "an example"));
  expect(view.getByTestId("card").textContent).toBe("an example");
});

test("a chunk gone after an update reloads the app once; failing again, Retry reloads it", async () => {
  const reload = spyOn(window.location, "reload").mockImplementation(() => {});
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const warned = spyOn(console, "warn").mockImplementation(() => {});
  const missing = () =>
    Promise.reject(new Error("Failed to fetch dynamically imported module: /assets/course-1.js"));
  const first = await renderRoute(page(missing));
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  first.unmount();

  // After the reload the chunk is still missing: our error, in words, with Retry.
  const again = await renderRoute(page(missing));
  const retry = await again.findByRole("button", { name: "Try again" });
  expect(again.getByText(/Something went wrong/)).toBeTruthy();
  expect(reload).toHaveBeenCalledTimes(1);
  fireEvent.click(retry);
  expect(reload).toHaveBeenCalledTimes(2);
  for (const spy of [reload, logged, warned]) spy.mockRestore();
});
