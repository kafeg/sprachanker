import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiError } from "./api/client.ts";
import "./i18n/index.ts";
import { router } from "./routes/router.tsx";
import { TooltipProvider } from "./ui/components/tooltip.tsx";
import { DirectionRoot } from "./ui/direction.tsx";
import "./styles.css";

// Follow the system theme until the stored preference loads.
document.documentElement.classList.toggle(
  "dark",
  matchMedia("(prefers-color-scheme: dark)").matches,
);

// A device signed out (from another device, or unused for a year): back to "Who is studying?".
const signedOut = (error: unknown) => {
  if (error instanceof ApiError && error.status === 401 && error.message === "no_session")
    queryClient.setQueryData(["session"], { profile: null });
};
const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // A refusal is an answer: only a failed request is tried again.
      retry: (count, error) =>
        !(error instanceof ApiError && error.status && error.status < 500) && count < 1,
    },
  },
  queryCache: new QueryCache({ onError: signedOut }),
  mutationCache: new MutationCache({ onError: signedOut }),
});
const root = document.getElementById("root");
if (!root) throw new Error("#root element missing in index.html");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <DirectionRoot>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </DirectionRoot>
    </QueryClientProvider>
  </StrictMode>,
);
