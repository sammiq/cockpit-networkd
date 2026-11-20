/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Read-only model of the links managed by systemd-networkd.
 *
 * The data comes from org.freedesktop.network1.Manager.Describe(), which
 * returns everything networkd knows as one JSON document. Bond and bridge
 * membership is not part of that document, so it is taken from `ip -j link`.
 *
 * networkd emits PropertiesChanged on its Link objects when operational,
 * carrier, address or setup state changes; that triggers a refresh. A slow
 * poll covers what does not emit a signal (links appearing or disappearing,
 * a DHCP lease changing the address without changing the address state).
 */

import cockpit from 'cockpit';

const NETWORKD_BUS = "org.freedesktop.network1";
const NETWORKD_PATH = "/org/freedesktop/network1";
const NETWORKD_MANAGER = "org.freedesktop.network1.Manager";

const POLL_INTERVAL = 5000;
const SIGNAL_DEBOUNCE = 250;

export interface NetworkdAddress {
    Family: number; // 2 = AF_INET, 10 = AF_INET6
    Address: number[];
    PrefixLength: number;
    ScopeString?: string;
    ConfigSource?: string;
    ConfigState?: string;
}

export interface NetworkdRoute {
    Family: number;
    Destination: number[];
    DestinationPrefixLength: number;
    Gateway?: number[];
    PreferredSource?: number[];
    Priority?: number;
    Table?: number;
    TableString?: string;
    TypeString?: string;
    ProtocolString?: string;
    ConfigSource?: string;
}

/* Only the fields of networkd's Describe() output that the page uses.
 * Fields that networkd omits for some link types are optional. */
export interface NetworkdLink {
    Index: number;
    Name: string;
    Type: string;
    Kind?: string;
    Driver?: string;
    HardwareAddress?: number[];
    MTU?: number;
    OperationalState: string;
    CarrierState: string;
    AddressState: string;
    AdministrativeState: string;
    OnlineState?: string;
    Addresses?: NetworkdAddress[];
    Routes?: NetworkdRoute[];
    DNS?: { Family: number, Address: number[], ConfigSource?: string }[];
    NetworkFile?: string;
    NetworkFileDropins?: string[];
    NetDevFile?: string;
    NetDevFileDropins?: string[];
    LinkFile?: string;
}

export interface Link extends NetworkdLink {
    /** Bond or bridge this link is a port of, from `ip -j link` */
    Master: string | null;
}

export type ModelState =
    | { status: "loading" }
    | { status: "ready", links: Link[] }
    | { status: "error", notRunning: boolean, message: string };

interface IpLink {
    ifname: string;
    master?: string;
}

interface ModelEvents extends cockpit.EventMap {
    changed(): void;
}

class NetworkdModelBase {
    state: ModelState = { status: "loading" };

    private client: cockpit.DBusClient;
    private subscription: { remove: () => void };
    private timer: number;
    private debounce: number | null = null;
    private inflight = false;
    private again = false;
    private last = "";
    private closed = false;

    constructor() {
        this.client = cockpit.dbus(NETWORKD_BUS, { superuser: "try" });
        this.subscription = this.client.subscribe(
            {
                path_namespace: NETWORKD_PATH,
                interface: "org.freedesktop.DBus.Properties",
                member: "PropertiesChanged",
            },
            () => this.schedule()
        );
        this.timer = window.setInterval(() => this.refresh(), POLL_INTERVAL);
        this.refresh();
    }

    close() {
        this.closed = true;
        window.clearInterval(this.timer);
        if (this.debounce !== null)
            window.clearTimeout(this.debounce);
        this.subscription.remove();
        this.client.close();
    }

    private schedule() {
        if (this.debounce !== null)
            return;
        this.debounce = window.setTimeout(() => {
            this.debounce = null;
            this.refresh();
        }, SIGNAL_DEBOUNCE);
    }

    private async refresh() {
        // Never run two refreshes at once; remember to go again if asked
        if (this.inflight) {
            this.again = true;
            return;
        }
        this.inflight = true;

        try {
            const [description, masters] = await Promise.all([describe(this.client), masterMap()]);
            const links = description.map(link => ({ ...link, Master: masters.get(link.Name) ?? null }));
            this.update({ status: "ready", links });
        } catch (ex) {
            this.update({ status: "error", notRunning: isNotRunning(ex), message: errorMessage(ex) });
        } finally {
            this.inflight = false;
            if (this.again) {
                this.again = false;
                this.refresh();
            }
        }
    }

    private update(state: ModelState) {
        if (this.closed)
            return;
        // Most polls return identical data; don't re-render the page for those
        const serialized = JSON.stringify(state);
        if (serialized === this.last)
            return;
        this.last = serialized;
        this.state = state;
        (this as unknown as cockpit.EventSource<ModelEvents>).dispatchEvent("changed");
    }
}

export type NetworkdModel = NetworkdModelBase & cockpit.EventSource<ModelEvents>;

export function createModel(): NetworkdModel {
    return cockpit.event_target<NetworkdModelBase, ModelEvents>(new NetworkdModelBase());
}

async function describe(client: cockpit.DBusClient): Promise<NetworkdLink[]> {
    const [json] = await client.call(NETWORKD_PATH, NETWORKD_MANAGER, "Describe", []);
    const parsed = JSON.parse(json as string) as { Interfaces?: NetworkdLink[] };
    return (parsed.Interfaces ?? []).sort((a, b) => a.Index - b.Index);
}

/* Map of link name -> name of the bond/bridge it is a port of.
 * Missing membership only loses the "Port of …" hint, so failures are ignored. */
async function masterMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
        const out = await cockpit.spawn(["ip", "-j", "link", "show"], { err: "message" });
        for (const link of JSON.parse(out) as IpLink[]) {
            if (link.master)
                map.set(link.ifname, link.master);
        }
    } catch (ex) {
        console.warn("Could not read link membership from `ip -j link`:", ex);
    }
    return map;
}

/* networkd isn't on the bus (stopped, masked or not installed) */
function isNotRunning(ex: unknown): boolean {
    if (!ex || typeof ex !== "object")
        return false;
    const { problem, name } = ex as { problem?: string, name?: string };
    return problem === "not-found" ||
        name === "org.freedesktop.DBus.Error.ServiceUnknown" ||
        name === "org.freedesktop.DBus.Error.NameHasNoOwner" ||
        name === "org.freedesktop.systemd1.NoSuchUnit";
}

function errorMessage(ex: unknown): string {
    if (ex && typeof ex === "object" && "message" in ex)
        return String(ex.message);
    return String(ex);
}

/* === Formatting helpers === */

export function formatAddress(addr: NetworkdAddress): string {
    return formatIP(addr.Family, addr.Address) + "/" + addr.PrefixLength;
}

export function formatIP(family: number, bytes: number[]): string {
    if (family === 2)
        return bytes.join(".");
    return formatIPv6(bytes);
}

function formatIPv6(bytes: number[]): string {
    const groups: number[] = [];
    for (let i = 0; i < 16; i += 2)
        groups.push(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));

    // RFC 5952: compress the longest run (of at least two) of zero groups
    let bestStart = -1;
    let bestLen = 0;
    for (let i = 0; i < 8;) {
        if (groups[i] !== 0) {
            i++;
            continue;
        }
        let j = i;
        while (j < 8 && groups[j] === 0)
            j++;
        if (j - i > bestLen) {
            bestStart = i;
            bestLen = j - i;
        }
        i = j;
    }

    const hex = groups.map(g => g.toString(16));
    if (bestLen < 2)
        return hex.join(":");
    return hex.slice(0, bestStart).join(":") + "::" + hex.slice(bestStart + bestLen).join(":");
}

export function formatMAC(bytes: number[] | undefined): string | null {
    if (!bytes || bytes.length === 0)
        return null;
    return bytes.map(b => b.toString(16).padStart(2, "0")).join(":");
}

/* Stable order: IPv4 before IPv6, then by address bytes */
export function sortedAddresses(link: Link): NetworkdAddress[] {
    const key = (a: NetworkdAddress) => [a.Family, ...a.Address, a.PrefixLength];
    return [...(link.Addresses ?? [])].sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
            if (ka[i] !== kb[i])
                return (ka[i] ?? 0) - (kb[i] ?? 0);
        }
        return ka.length - kb.length;
    });
}

/* Addresses worth showing in the table: everything except link-local */
export function displayAddresses(link: Link): NetworkdAddress[] {
    return sortedAddresses(link).filter(a => a.ScopeString !== "link");
}
