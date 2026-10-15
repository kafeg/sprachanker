// Other devices: the addresses the app is reached at (`GET /api/addresses`) — this computer, the local network, Tailscale —, each to copy or to scan as a
// QR code; what one lacks said in a line (the microphone without HTTPS, a server listening only here,
// a tailnet not served, Funnel on). The same block opens beside from the side panel ("On a phone").
import type { ServerAddress, ServerAddresses } from "@sprachanker/schema";
import { Check, Copy, MicOff, QrCode as QrCodeIcon, Smartphone, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAddresses } from "@/api/settings.ts";
import { Button } from "@/ui/components/button.tsx";
import { ErrorState, Loading } from "@/ui/page.tsx";
import { Panel } from "@/ui/panel.tsx";
import { QrCode } from "@/ui/qr-code.tsx";
import { SideSheet } from "@/ui/side-sheet.tsx";

/** Settings → General's section. */
export function OtherDevicesSection() {
  const { t } = useTranslation();
  return (
    <Panel id="other-devices" title={t("addresses.title")}>
      <OtherDevices />
    </Panel>
  );
}

/** Settings → General on the phone app: why there are no addresses (its server is inside it). */
export function OtherDevicesOnPhone() {
  const { t } = useTranslation();
  return (
    <Panel id="other-devices" title={t("addresses.title")}>
      <p className="mt-2 text-sm text-muted-foreground">{t("addresses.phone")}</p>
    </Panel>
  );
}

/** The side panel's button beside the profile: the same block in a sheet. */
export function OnPhoneButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Smartphone /> {t("addresses.onPhone")}
      </Button>
      <SideSheet
        open={open}
        onOpenChange={setOpen}
        title={t("addresses.title")}
        className="overflow-y-auto sm:max-w-md"
      >
        <div className="px-4 pb-6">
          <OtherDevices />
        </div>
      </SideSheet>
    </>
  );
}

function OtherDevices() {
  const query = useAddresses();
  if (query.isPending) return <Loading />;
  if (query.isError)
    return <ErrorState className="m-0 mt-2" error={query.error} onRetry={() => query.refetch()} />;
  return <Addresses addresses={query.data} />;
}

/** The address a phone opens best: HTTPS through the tailnet, else the local network's. */
const forPhone = (a: ServerAddresses) =>
  a.tailnet?.https?.url ?? a.network[0]?.url ?? a.localName?.url;

function Addresses({ addresses }: { addresses: ServerAddresses }) {
  const { t } = useTranslation();
  // One QR code open at a time: at first the one a phone opens best, if any.
  const [chosen, setChosen] = useState<string | null>();
  const shown = chosen === undefined ? forPhone(addresses) : chosen;
  const { machine, network, localName, tailnet } = addresses;
  const port = new URL(machine.url).port || "80";
  const row = (address: ServerAddress) => (
    <AddressRow
      key={address.url}
      address={address}
      qr={shown === address.url}
      onQr={() => setChosen(shown === address.url ? null : address.url)}
    />
  );
  const lan = localName ? [...network, localName] : network;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("addresses.intro")}</p>
      <Group title={t("addresses.machine")}>{row(machine)}</Group>
      <Group title={t("addresses.network")}>
        {lan.length ? (
          <>
            {lan.map(row)}
            {lan.some((a) => !a.secure) && (
              <p className="flex gap-1.5 text-xs text-muted-foreground">
                <MicOff className="mt-px size-3.5 shrink-0" aria-hidden />
                {t(tailnet?.https ? "addresses.insecureServed" : "addresses.insecure")}
              </p>
            )}
          </>
        ) : (
          <Command
            text={t("addresses.onlyHere")}
            command={`sprachanker serve --host 0.0.0.0 --port ${port}`}
          />
        )}
      </Group>
      <Group title={t("addresses.tailnet")}>
        {!tailnet ? (
          <p className="text-sm text-muted-foreground">{t("addresses.noTailnet")}</p>
        ) : tailnet.funnel ? (
          <div className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
            <div className="min-w-0 space-y-1 text-sm">
              <Url value={tailnet.name} />
              <p>{t("addresses.funnel")}</p>
            </div>
          </div>
        ) : tailnet.https ? (
          row(tailnet.https)
        ) : (
          <>
            <Url value={tailnet.name} />
            <Command text={t("addresses.notServed")} command={`tailscale serve --bg ${port}`} />
          </>
        )}
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** An address or a name as written: left to right in any language, selected whole. */
function Url({ value }: { value: string }) {
  return (
    <span dir="ltr" className="block min-w-0 flex-1 break-all font-mono text-sm select-all">
      {value}
    </span>
  );
}

function AddressRow({ address, qr, onQr }: { address: ServerAddress; qr: boolean; onQr(): void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Url value={address.url} />
        <CopyButton text={address.url} label={t("addresses.copy")} />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("addresses.showQr")}
          title={t("addresses.showQr")}
          aria-pressed={qr}
          onClick={onQr}
        >
          <QrCodeIcon />
        </Button>
      </div>
      {qr && (
        <figure className="flex flex-col items-center gap-1">
          <QrCode
            value={address.url}
            label={t("addresses.qrOf", { url: address.url })}
            className="size-44"
          />
          <figcaption className="text-xs text-muted-foreground">{t("addresses.scan")}</figcaption>
        </figure>
      )}
    </div>
  );
}

/** What to do, and the command that does it, to copy. */
function Command({ text, command }: { text: string; command: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground">{text}</p>
      <div className="flex items-center gap-1 rounded-lg bg-muted ps-3 pe-1">
        <code dir="ltr" className="min-w-0 flex-1 break-all py-1.5 select-all">
          {command}
        </code>
        <CopyButton text={command} label={t("addresses.copyCommand")} />
      </div>
    </div>
  );
}

/** Copies `text`, "Copied" a moment after; absent where the page has no clipboard (no secure context:
 *  the text is selected whole instead). */
function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!navigator.clipboard) return null;
  const name = copied ? t("addresses.copied") : label;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={name}
      title={name}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => undefined,
        )
      }
    >
      {copied ? <Check className="text-correct" /> : <Copy />}
    </Button>
  );
}
