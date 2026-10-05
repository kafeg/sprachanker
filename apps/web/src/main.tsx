import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n/index.ts";
import { router } from "./routes/router.tsx";
import { TooltipProvider } from "./ui/components/tooltip.tsx";
import "./styles.css";

// Follow the system theme until the stored preference loads.
document.documentElement.classList.toggle(
  "dark",
  matchMedia("(prefers-color-scheme: dark)").matches,
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
const root = document.getElementById("root");
if (!root) throw new Error("#root element missing in index.html");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
