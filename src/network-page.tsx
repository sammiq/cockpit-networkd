/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Main networking page, laid out like Cockpit's NetworkManager page
 * (pkg/networkmanager/network-main.jsx): traffic graphs, interface tables
 * and network logs. Read-only.
 */

import React from 'react';

import { Card, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Page, PageSection } from '@patternfly/react-core/dist/esm/components/Page/index.js';
import { Flex } from '@patternfly/react-core/dist/esm/layouts/Flex/index.js';
import { Gallery } from '@patternfly/react-core/dist/esm/layouts/Gallery/index.js';

import cockpit from 'cockpit';
import { useEvent } from 'hooks';
import { ListingTable } from 'cockpit-components-table.jsx';
import type { ListingTableRowProps } from 'cockpit-components-table.jsx';
import { LogsPanel } from 'cockpit-components-logs-panel.jsx';

import { NetworkPlots } from './plots.jsx';
import { UsageMonitor } from './usage-monitor.js';
import { displayAddresses, formatAddress } from './model';
import type { Link } from './model';
import {
    LinkName, NETWORKD_UNIT, rowProps, rx_plot_data, setupLabel, trafficColumns, tx_plot_data
} from './link-utils';
import type { PlotState } from './link-utils';

const _ = cockpit.gettext;

/* Order links by index, but put bond and bridge ports right after their master */
function orderLinks(links: Link[]): Link[] {
    const names = new Set(links.map(l => l.Name));
    const ports = new Map<string, Link[]>();
    const top: Link[] = [];

    for (const link of links) {
        if (link.Master && names.has(link.Master)) {
            const list = ports.get(link.Master) ?? [];
            list.push(link);
            ports.set(link.Master, list);
        } else {
            top.push(link);
        }
    }

    const ordered: Link[] = [];
    const add = (link: Link) => {
        ordered.push(link);
        for (const port of ports.get(link.Name) ?? [])
            add(port);
    };
    top.forEach(add);
    return ordered;
}

export const NetworkPage = ({ links, usage_monitor, plot_state }: {
    links: Link[],
    usage_monitor: UsageMonitor,
    plot_state: PlotState,
}) => {
    useEvent(usage_monitor.grid, "notify");

    const managed: ListingTableRowProps[] = [];
    const unmanaged: ListingTableRowProps[] = [];
    const plot_ifaces: string[] = [];

    for (const link of orderLinks(links)) {
        if (link.Type === "loopback")
            continue;

        const isPort = link.Master !== null;
        // Like the NetworkManager page, graph top-level interfaces only, so
        // traffic through a bond or bridge isn't counted twice
        if (!isPort)
            plot_ifaces.push(link.Name);

        const addresses = displayAddresses(link)
                .map(formatAddress)
                .join(", ");

        const columns: ListingTableRowProps["columns"] = [
            {
                title: (
                    <Flex
                        spaceItems={{ default: 'spaceItemsSm' }}
                        flexWrap={{ default: 'nowrap' }}
                        {...isPort && { className: "networkd-port-name" }}
                    >
                        <LinkName name={link.Name} />
                        {setupLabel(link.AdministrativeState)}
                    </Flex>
                ),
                sortKey: link.Name,
            },
            {
                title: isPort && !addresses
                    ? <span className="networkd-subtle">{cockpit.format(_("Port of $0"), link.Master)}</span>
                    : addresses,
            },
            ...trafficColumns(link, usage_monitor),
        ];

        const row: ListingTableRowProps = { columns, props: rowProps(link.Name) };

        if (link.AdministrativeState === "unmanaged")
            unmanaged.push(row);
        else
            managed.push(row);
    }

    plot_state.plot_instances('rx', rx_plot_data, plot_ifaces);
    plot_state.plot_instances('tx', tx_plot_data, plot_ifaces);

    const columns = [
        { title: _("Name"), header: true, props: { width: 25 as const } },
        { title: _("IP address"), props: { width: 25 as const } },
        { title: _("Sending"), props: { width: 25 as const } },
        { title: _("Receiving"), props: { width: 25 as const } },
    ];

    return (
        <Page id="networking" className="pf-m-no-sidebar">
            <PageSection hasBodyWrapper={false} id="networking-graphs" className="networking-graphs">
                <NetworkPlots plot_state={plot_state} />
            </PageSection>
            <PageSection hasBodyWrapper={false}>
                <Gallery hasGutter>
                    <Card isPlain id="networking-interfaces">
                        <CardHeader>
                            <CardTitle component="h2">{_("Interfaces")}</CardTitle>
                        </CardHeader>
                        <ListingTable
                            aria-label={_("Managed interfaces")}
                            variant='compact'
                            columns={columns}
                            rows={managed}
                            emptyCaption={_("No interfaces are managed by systemd-networkd")}
                        />
                    </Card>
                    {unmanaged.length > 0 &&
                    <Card isPlain id="networking-unmanaged-interfaces">
                        <CardHeader>
                            <CardTitle component="h2">{_("Unmanaged interfaces")}</CardTitle>
                        </CardHeader>
                        <ListingTable
                            aria-label={_("Unmanaged interfaces")}
                            variant='compact'
                            columns={columns}
                            rows={unmanaged}
                        />
                    </Card>}
                    <LogsPanel
                        title={_("Network logs")}
                        match={["_SYSTEMD_UNIT=" + NETWORKD_UNIT]}
                        max={10}
                        search_options={{ prio: "debug", _SYSTEMD_UNIT: NETWORKD_UNIT }}
                        goto_url={"/system/logs/#/?prio=debug&_SYSTEMD_UNIT=" + NETWORKD_UNIT}
                        className="contains-list"
                    />
                </Gallery>
            </PageSection>
        </Page>
    );
};
