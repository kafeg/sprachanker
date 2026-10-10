// Pages loaded when first opened, each a chunk of its own (the app's first load stays small), and what
// a route shows when its page fails.
import {
  type AsyncRouteComponent,
  type ErrorComponentProps,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { type ComponentType, type ReactNode, Suspense } from "react";
import { ErrorState, Loading } from "@/ui/page.tsx";

/** A page loaded when it is first opened, through TanStack's lazyRouteComponent: `preload` loads it
 *  ahead (a route's intent), and a chunk gone after the app was updated reloads the page once. While
 *  it loads: `fallback` — Loading for a page, null for a slot inside one, so nothing moves. */
export function page<P extends object>(
  load: () => Promise<ComponentType<P>>,
  fallback: ReactNode = <Loading />,
) {
  const Lazy: AsyncRouteComponent<P> = lazyRouteComponent(() =>
    load().then((component) => ({ default: component as (props: P) => ReactNode })),
  );
  const Page = (props: P) => (
    <Suspense fallback={fallback}>
      <Lazy {...props} />
    </Suspense>
  );
  return Object.assign(Page, { preload: async () => void (await Lazy.preload?.()) });
}

/** A route's component that shows a lazy page: the page's chunk preloaded with the route. */
export function opening<C extends ComponentType>(
  lazyPage: { preload(): Promise<void> },
  component: C,
) {
  return Object.assign(component, { preload: lazyPage.preload });
}

/** A page that failed (a chunk that would not load even after the reload): the error in words, and
 *  Retry loads the app again. */
export function RouteError({ error }: ErrorComponentProps) {
  return <ErrorState error={error} onRetry={() => window.location.reload()} />;
}
