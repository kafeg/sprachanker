import { expect, test } from "bun:test";
import { fireEvent, screen } from "@testing-library/react";
import { AboutSection } from "../../src/app/about.tsx";
import { renderApp } from "../render.tsx";

const NOTICES = "whisper.cpp v1.9.5\n  Licence: MIT\n";

test("About opens the build's third-party components and their licences", async () => {
  await renderApp(<AboutSection />, {
    data: [
      [["health"], { version: "1.2.3" }],
      [["third-party-notices"], NOTICES],
    ],
  });
  expect(screen.getByText("1.2.3")).toBeTruthy();
  expect(screen.queryByText(/whisper\.cpp v1\.9\.5/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Third-party components and licences" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("each under its own licence");
  expect(dialog.querySelector("pre")?.textContent).toBe(NOTICES);
});

test("a server started with --experimental is said in About; one without it says nothing of it", async () => {
  const on = await renderApp(<AboutSection />, {
    data: [[["health"], { version: "1.2.3", experimental: true }]],
  });
  expect(on.getByText(/Experimental mode \(--experimental\)/)).toBeTruthy();
  on.unmount();
  const off = await renderApp(<AboutSection />, {
    data: [[["health"], { version: "1.2.3", experimental: false }]],
  });
  expect(off.getByText("1.2.3")).toBeTruthy();
  expect(off.queryByText(/--experimental/)).toBeNull();
});

test("a build without the notices says where they come with", async () => {
  await renderApp(<AboutSection />, {
    data: [
      [["health"], { version: "1.2.3" }],
      [["third-party-notices"], null],
    ],
  });
  fireEvent.click(screen.getByRole("button", { name: "Third-party components and licences" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("This build carries no list");
  expect(dialog.querySelector("pre")).toBeNull();
});
