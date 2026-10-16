// Settings → General → Other devices, and the side panel's "On a phone": each kind of address, what
// one lacks said in a line, copying, QR codes, a failed load. Addresses and names are made up
// (192.0.2.0/24 is for documentation).
import { afterEach, expect, mock, test } from "bun:test";
import type { ServerAddresses } from "@sprachanker/schema";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { OnPhoneButton, OtherDevicesSection } from "../../src/app/other-devices.tsx";
import { renderApp } from "../render.tsx";

const MACHINE = { url: "http://localhost:4580", secure: true };
const LAN = { url: "http://192.0.2.10:4580", secure: false };
const LOCAL_NAME = { url: "http://desk.local:4580", secure: false };
const TAILNET = "desk.example-tail.ts.net";

const show = (addresses: ServerAddresses) =>
  renderApp(<OtherDevicesSection />, { data: [[["addresses"], addresses]] });

const clipboard = navigator.clipboard;
afterEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
});

test("listening only here: this computer, how to open it to the network, Tailscale not running", async () => {
  const view = await show({ machine: MACHINE, network: [] });
  expect(view.getByRole("heading", { name: "Other devices" })).toBeTruthy();
  const address = view.getByText(MACHINE.url);
  expect(address.getAttribute("dir")).toBe("ltr");
  // localhost is a secure context: no word about the microphone.
  expect(view.queryByText(/No microphone/)).toBeNull();
  expect(view.getByText(/listens only on this computer/)).toBeTruthy();
  expect(view.getByText("sprachanker serve --host 0.0.0.0 --port 4580").getAttribute("dir")).toBe(
    "ltr",
  );
  expect(view.getByText(/Tailscale is not running on this computer/)).toBeTruthy();
  // No address for a phone: no QR code open until one is asked for.
  expect(view.queryByRole("img")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "QR code" }));
  expect(view.getByRole("img", { name: `QR code for ${MACHINE.url}` }).tagName).toBe("svg");
  fireEvent.click(view.getByRole("button", { name: "QR code" }));
  expect(view.queryByRole("img")).toBeNull();
});

test("the local network and the tailnet served: each address, the Tailscale one's QR code open", async () => {
  const https = { url: `https://${TAILNET}`, secure: true };
  const view = await show({
    machine: MACHINE,
    network: [LAN],
    localName: LOCAL_NAME,
    tailnet: { name: TAILNET, https },
  });
  for (const a of [MACHINE, LAN, LOCAL_NAME, https]) expect(view.getByText(a.url)).toBeTruthy();
  expect(view.queryByText(/listens only on this computer/)).toBeNull();
  // The local network's addresses say once that the microphone needs a secure one — the Tailscale one is.
  expect(
    view.getAllByText(/No microphone at these addresses: .*such as the Tailscale address/),
  ).toHaveLength(1);
  // The address a phone opens best has its QR code open; one at a time.
  expect(view.getAllByRole("img").map((i) => i.getAttribute("aria-label"))).toEqual([
    `QR code for ${https.url}`,
  ]);
  fireEvent.click(view.getAllByRole("button", { name: "QR code" })[1] as HTMLElement);
  expect(view.getAllByRole("img").map((i) => i.getAttribute("aria-label"))).toEqual([
    `QR code for ${LAN.url}`,
  ]);
});

test("the local network without Tailscale: the microphone needs a secure address", async () => {
  const view = await show({ machine: MACHINE, network: [LAN] });
  const note = view.getByText(/No microphone at these addresses/);
  expect(note.textContent).not.toContain("Tailscale");
  // The local network's address is a phone's: its QR code open.
  expect(view.getByRole("img", { name: `QR code for ${LAN.url}` })).toBeTruthy();
});

test("Tailscale not serving the app: its name and how to serve it on this port", async () => {
  const view = await show({ machine: MACHINE, network: [], tailnet: { name: TAILNET } });
  expect(view.getByText(TAILNET).getAttribute("dir")).toBe("ltr");
  expect(view.getByText(/does not serve SprachAnker at a secure address/)).toBeTruthy();
  expect(view.getByText("tailscale serve --bg 4580")).toBeTruthy();
  expect(view.queryByText(/^https:/)).toBeNull();
});

test("listening everywhere, Tailscale not serving: its name over plain HTTP, and how to serve it", async () => {
  const http = { url: `http://${TAILNET}:4580`, secure: false };
  const view = await show({ machine: MACHINE, network: [LAN], tailnet: { name: TAILNET, http } });
  expect(view.getByText(http.url)).toBeTruthy();
  expect(view.getByText("tailscale serve --bg 4580")).toBeTruthy();
});

test("the phone app (Tailscale there cannot serve): its tailnet address with no command; without Tailscale, said for this device", async () => {
  const http = { url: `http://${TAILNET}:4580`, secure: false };
  const view = await show({
    machine: MACHINE,
    network: [LAN],
    tailnet: { name: TAILNET, http },
    noServe: true,
  });
  expect(view.getByText("This device")).toBeTruthy();
  expect(view.getByText(http.url)).toBeTruthy();
  expect(view.queryByText(/tailscale serve/)).toBeNull();
  expect(view.getAllByText(/^No microphone at these addresses/)).toHaveLength(2);
  view.unmount();
  const without = await show({ machine: MACHINE, network: [LAN], noServe: true });
  expect(without.getByText(/Tailscale is not running on this device/)).toBeTruthy();
  expect(without.queryByText(/your phones open SprachAnker at a secure address/)).toBeNull();
});

test("Funnel on: a warning, and no address through the tailnet", async () => {
  const view = await show({
    machine: MACHINE,
    network: [],
    tailnet: { name: TAILNET, funnel: true },
  });
  expect(view.getByText(/Funnel is on for this computer/)).toBeTruthy();
  expect(view.getByText(TAILNET)).toBeTruthy();
  expect(view.queryByText(/^https:/)).toBeNull();
  expect(view.queryByText(/tailscale serve/)).toBeNull();
  // Only this computer's row has buttons.
  expect(view.getAllByRole("button", { name: "QR code" })).toHaveLength(1);
});

test("an address and a command copied, then said so", async () => {
  const writeText = mock((_: string) => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const view = await show({ machine: MACHINE, network: [], tailnet: { name: TAILNET } });
  fireEvent.click(view.getByRole("button", { name: "Copy the address" }));
  expect(writeText).toHaveBeenLastCalledWith(MACHINE.url);
  await waitFor(() => expect(view.getByRole("button", { name: "Copied" })).toBeTruthy());
  const commands = view.getAllByRole("button", { name: "Copy the command" });
  fireEvent.click(commands[1] as HTMLElement);
  expect(writeText).toHaveBeenLastCalledWith("tailscale serve --bg 4580");
  await waitFor(() => expect(view.getAllByRole("button", { name: "Copied" })).toHaveLength(2));
});

test("no clipboard (a page without a secure context): no copy buttons, the text selectable", async () => {
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  const view = await show({ machine: MACHINE, network: [] });
  expect(view.queryByRole("button", { name: "Copy the address" })).toBeNull();
  expect(view.getByText(MACHINE.url).className).toContain("select-all");
});

test("the addresses not loading: the error, and a way to try again", async () => {
  const view = await renderApp(<OtherDevicesSection />, {
    failed: [[["addresses"], new Error("Failed to fetch")]],
  });
  expect(view.getByText(/Failed to fetch/)).toBeTruthy();
  expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
});

test("the side panel's “On a phone” opens the same block beside", async () => {
  const view = await renderApp(<OnPhoneButton />, {
    data: [[["addresses"], { machine: MACHINE, network: [LAN] }]],
  });
  fireEvent.click(view.getByRole("button", { name: "On a phone" }));
  const sheet = within(view.getByRole("dialog", { name: "Other devices" }));
  expect(sheet.getByText(LAN.url)).toBeTruthy();
  expect(sheet.getByRole("img", { name: `QR code for ${LAN.url}` })).toBeTruthy();
});
