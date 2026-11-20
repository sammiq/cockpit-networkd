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

        this.channel.follow();
        this.grid.walk();
    }

    add(iface) {
        if (!this.samples[iface]) {
            this.samples[iface] = [
                this.grid.add(this.channel, ["rx", iface]),
                this.grid.add(this.channel, ["tx", iface])
            ];
        }
    }
}
