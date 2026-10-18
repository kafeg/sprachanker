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

const RELEASE = "https://github.com/kafeg/sprachanker/releases/tag/v1.3.40";
const newer = (status: Record<string, unknown>): [unknown[], unknown] => [
  ["update"],
  { version: "1.2.3", installs: false, newer: { version: "1.3.40", url: RELEASE }, ...status },
];
const health: [unknown[], unknown] = [["health"], { version: "1.2.3" }];

test("no newer version: nothing about updates", async () => {
  await renderApp(<AboutSection />, { data: [health] });
  expect(screen.queryByText(/is out/)).toBeNull();
});

test("the installer's program says its command again, with what is new", async () => {
  await renderApp(<AboutSection />, {
    data: [health, newer({ by: "program", system: "linux" })],
  });
  expect(screen.getByText("SprachAnker 1.3.40 is out.")).toBeTruthy();
  expect(screen.getByText(/releases\/latest\/download\/install\.sh \| bash/)).toBeTruthy();
  expect(screen.getByRole("link", { name: /What is new/ }).getAttribute("href")).toBe(RELEASE);
});

test("the program on Windows: a new archive, no command", async () => {
  await renderApp(<AboutSection />, {
    data: [health, newer({ by: "program", system: "windows" })],
  });
  expect(screen.getByText(/new archive for Windows/)).toBeTruthy();
  expect(screen.queryByText(/install\.sh/)).toBeNull();
});

test("the desktop app is updated from its window; elsewhere it says so", async () => {
  const first = await renderApp(<AboutSection />, {
    data: [health, newer({ by: "desktop", system: "macos" })],
  });
  expect(screen.getByText(/on the computer it runs on/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Update and restart" })).toBeNull();
  first.unmount();
  const shell = globalThis as { __TAURI_INTERNALS__?: unknown };
  shell.__TAURI_INTERNALS__ = { invoke: async () => undefined };
  try {
    await renderApp(<AboutSection />, {
      data: [health, newer({ by: "desktop", system: "windows" })],
    });
    expect(screen.getByRole("button", { name: "Update and restart" })).toBeTruthy();
  } finally {
    delete shell.__TAURI_INTERNALS__;
  }
});

test("the phone app downloads and installs the release itself when it has its file", async () => {
  await renderApp(<AboutSection />, {
    data: [health, newer({ by: "phone", system: "android", installs: true })],
  });
  expect(screen.getByRole("button", { name: "Download and install" })).toBeTruthy();
  expect(screen.getByText(/Android asks to let SprachAnker install apps/)).toBeTruthy();
});
