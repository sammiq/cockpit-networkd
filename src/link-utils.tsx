/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Pieces shared by the overview page and the interface page.
 */

import React from 'react';

import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { Label } from '@patternfly/react-core/dist/esm/components/Label/index.js';

import cockpit from 'cockpit';
import type { ListingTableRowProps } from 'cockpit-components-table.jsx';

import { UsageMonitor } from './usage-monitor.js';
import type { Link } from './model';

const _ = cockpit.gettext;

/* The parts of pkg/lib/plot.js's PlotState used here (it is untyped JS) */
export interface PlotState {
    plot_instances(id: string, plot_data: object, instances: string[], reset?: boolean): void;
}

export const NETWORKD_UNIT = "systemd-networkd.service";

/* Operational states in which the link can carry traffic, so tables show
 * rates rather than a state. See networkctl(1) for the full list. */
const ACTIVE_STATES = new Set(["carrier", "degraded", "degraded-carrier", "routable", "enslaved"]);

export function operationalStateText(state: string): string {
    switch (state) {
    case "missing": return _("Missing");
    case "off": return _("Down");
    case "no-carrier": return _("No carrier");
    case "dormant": return _("Dormant");
    case "degraded-carrier": return _("Degraded carrier");
    case "carrier": return _("Carrier");
    case "degraded": return _("Degraded");
    case "enslaved": return _("Port");
    case "routable": return _("Routable");
    default: return state;
    }
}

/* networkd's setup state, shown as a label when it isn't the normal
 * "configured" (or "unmanaged", which has its own table) */
export function setupLabel(state: string): React.ReactNode {
    switch (state) {
    case "configured":
    case "unmanaged":
        return null;
    case "failed":
        return <Label status="danger" isCompact>{_("Failed")}</Label>;
    case "configuring":
        return <Label status="info" isCompact>{_("Configuring")}</Label>;
    case "pending":
    case "initialized":
        return <Label isCompact>{_("Pending")}</Label>;
    case "linger":
        return <Label isCompact>{_("Lingering")}</Label>;
    default:
        return <Label isCompact>{state}</Label>;
    }
}

/* Interface name that opens its page, like the NetworkManager page */
export const LinkName = ({ name }: { name: string }) => (
    <Button variant="link" isInline onClick={() => cockpit.location.go([name])}>{name}</Button>
);

/* Sending and Receiving cells, or the state across both when the link is down */
export function trafficColumns(link: Link, usage_monitor: UsageMonitor): ListingTableRowProps["columns"] {
    usage_monitor.add(link.Name);
    if (!ACTIVE_STATES.has(link.OperationalState))
        return [{ title: operationalStateText(link.OperationalState), props: { colSpan: 2 } }];

    const samples = usage_monitor.samples[link.Name];
    return [
        { title: samples ? cockpit.format_bits_per_sec(samples[1][0] * 8) : "" },
        { title: samples ? cockpit.format_bits_per_sec(samples[0][0] * 8) : "" },
    ];
}

/* data-* attributes on table rows are for tests, like on the NetworkManager page */
export function rowProps(name: string): NonNullable<ListingTableRowProps["props"]> {
    return {
        key: name,
        "data-interface": encodeURIComponent(name),
        "data-row-id": name,
    } as NonNullable<ListingTableRowProps["props"]>;
}

export const rx_plot_data = {
    direct: "network.interface.in.bytes",
    internal: "network.interface.rx",
    units: "bytes",
    derive: "rate",
    threshold: 200,
    factor: 8
};

export const tx_plot_data = {
    direct: "network.interface.out.bytes",
    internal: "network.interface.tx",
    units: "bytes",
    derive: "rate",
    threshold: 200,
    factor: 8
};
