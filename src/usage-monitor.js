/*
 * Adapted from cockpit pkg/networkmanager/helpers.js
 * Copyright (C) Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Per-interface receive/transmit byte rates for the table columns.
 * "direct" uses PCP when installed; "internal" is the bridge's own
 * /proc/net/dev reader and works everywhere.
 */
import cockpit from "cockpit";

export class UsageMonitor {
    constructor() {
        this.channel = cockpit.metrics(
            1000,
            [
                {
                    source: "direct",
                    metrics: [
                        {
                            name: "network.interface.in.bytes",
                            units: "bytes",
                            derive: "rate"
                        },
                        {
                            name: "network.interface.out.bytes",
                            units: "bytes",
                            derive: "rate"
                        },
                    ],
                    metrics_path_names: ["rx", "tx"]
                },
                {
                    source: "internal",
                    metrics: [
                        {
                            name: "network.interface.rx",
                            units: "bytes",
                            derive: "rate"
                        },
                        {
                            name: "network.interface.tx",
                            units: "bytes",
                            derive: "rate"
                        },
                    ],
                    metrics_path_names: ["rx", "tx"]
                }
            ]
        );

        this.grid = cockpit.grid(1000, -1, -0);
        /** @type {Record<string, [number[], number[]]>} */
        this.samples = { };
        /** @type {Record<string, { rx: number | null, tx: number | null }>} */
        this.last = { };

        this.channel.follow();
        this.grid.walk();
    }

    add(iface) {
        if (!this.samples[iface]) {
            this.samples[iface] = [
                this.grid.add(this.channel, ["rx", iface]),
                this.grid.add(this.channel, ["tx", iface])
            ];
            this.last[iface] = { rx: null, tx: null };
        }
    }

    /*
     * Current rx/tx in bytes per second, holding on to the last real reading.
     *
     * The grid moves on to a new, empty slot on its own one-second timer and
     * the bridge's data fills it shortly after. Reading the raw slot in
     * between gives undefined/null, which renders as a blank or "0 bps" for a
     * moment and makes the table flicker. Only real numbers replace the
     * remembered value; null means no reading has arrived yet.
     */
    rates(iface) {
        const samples = this.samples[iface];
        const last = this.last[iface];
        if (!samples || !last)
            return null;
        const rx = samples[0][0];
        const tx = samples[1][0];
        if (typeof rx === "number")
            last.rx = rx;
        if (typeof tx === "number")
            last.tx = tx;
        return last;
    }
}
