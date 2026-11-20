/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * One interface, at #/<name>. Laid out like Cockpit's NetworkManager
 * interface page (pkg/networkmanager/network-interface.jsx): breadcrumb,
 * this interface's traffic graphs, a details card, then its ports (for a
 * bond or bridge) and its routes. Read-only.
 */

import React from 'react';

import { Breadcrumb, BreadcrumbItem } from '@patternfly/react-core/dist/esm/components/Breadcrumb/index.js';
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import {
    DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm
} from '@patternfly/react-core/dist/esm/components/DescriptionList/index.js';
import { Page, PageBreadcrumb, PageSection } from '@patternfly/react-core/dist/esm/components/Page/index.js';
import { Flex } from '@patternfly/react-core/dist/esm/layouts/Flex/index.js';
import { Gallery } from '@patternfly/react-core/dist/esm/layouts/Gallery/index.js';

import cockpit from 'cockpit';
import { useEvent } from 'hooks';
import { ListingTable } from 'cockpit-components-table.jsx';

import { NetworkPlots } from './plots.jsx';
import { UsageMonitor } from './usage-monitor.js';
import { formatAddress, formatIP, formatMAC, sortedAddresses } from './model';
import type { Link, NetworkdAddress, NetworkdRoute } from './model';
import {
    LinkName, operationalStateText, rowProps, rx_plot_data, setupLabel, trafficColumns, tx_plot_data
} from './link-utils';
import type { PlotState } from './link-utils';

const _ = cockpit.gettext;

const AddressList = ({ addresses }: { addresses: NetworkdAddress[] }) => (
    <ul className="networkd-plain-list">
        {addresses.map(a => {
            const addr = formatAddress(a);
            return (
                <li key={addr}>
                    {addr} <span className="networkd-subtle">({a.ConfigSource ?? _("unknown")}, {a.ScopeString})</span>
                </li>
            );
        })}
    </ul>
);

function formatDestination(route: NetworkdRoute): string {
    if (route.DestinationPrefixLength === 0)
        return _("default");
    return formatIP(route.Family, route.Destination) + "/" + route.DestinationPrefixLength;
}

/* Routes that matter to a person: unicast routes outside the kernel's
 * "local" table (which only holds the host's own and broadcast addresses) */
function interestingRoutes(link: Link): NetworkdRoute[] {
    return (link.Routes ?? [])
            .filter(r => r.TableString !== "local" && (r.TypeString ?? "unicast") === "unicast")
            .sort((a, b) => a.Family - b.Family || a.DestinationPrefixLength - b.DestinationPrefixLength);
}

const LinkDetails = ({ link }: { link: Link }) => {
    const addresses = sortedAddresses(link);
    const ipv4 = addresses.filter(a => a.Family === 2);
    const ipv6 = addresses.filter(a => a.Family === 10);
    const gateways = (link.Routes ?? [])
            .filter(r => r.DestinationPrefixLength === 0 && r.Gateway)
            .map(r => formatIP(r.Family, r.Gateway!));
    const dns = (link.DNS ?? []).map(d => formatIP(d.Family, d.Address));
    const files = [
        link.NetworkFile, ...(link.NetworkFileDropins ?? []),
        link.NetDevFile, ...(link.NetDevFileDropins ?? []),
        link.LinkFile,
    ].filter(f => !!f);

    const items: [string, string, React.ReactNode][] = [
        ["status", _("Status"),
            <Flex key="s" spaceItems={{ default: 'spaceItemsSm' }}>
                <span>{operationalStateText(link.OperationalState)}</span>
                {setupLabel(link.AdministrativeState)}
            </Flex>],
        ["carrier", _("Carrier"), link.CarrierState],
        ["online", _("Online"), link.OnlineState],
        ["port-of", _("Port of"), link.Master && <LinkName name={link.Master} />],
        ["ipv4", _("IPv4"), ipv4.length > 0 && <AddressList addresses={ipv4} />],
        ["ipv6", _("IPv6"), ipv6.length > 0 && <AddressList addresses={ipv6} />],
        ["gateway", _("Gateway"), gateways.join(", ")],
        ["dns", _("DNS"), dns.join(", ")],
        ["mtu", _("MTU"), link.MTU],
        ["config", _("Configuration"), files.length > 0 &&
            <ul className="networkd-plain-list">{files.map(f => <li key={f}>{f}</li>)}</ul>],
    ];

    return (
        <DescriptionList id="network-interface-settings" className="pf-m-horizontal-on-sm">
            {items.filter(([, , value]) => value !== undefined && value !== null && value !== false && value !== "")
                    .map(([id, term, value]) => (
                        <DescriptionListGroup key={id} data-field={id}>
                            <DescriptionListTerm>{term}</DescriptionListTerm>
                            <DescriptionListDescription>{value}</DescriptionListDescription>
                        </DescriptionListGroup>
                    ))}
        </DescriptionList>
    );
};

export const InterfacePage = ({ link, links, usage_monitor, plot_state }: {
    link: Link,
    links: Link[],
    usage_monitor: UsageMonitor,
    plot_state: PlotState,
}) => {
    useEvent(usage_monitor.grid, "notify");

    plot_state.plot_instances('rx', rx_plot_data, [link.Name], true);
    plot_state.plot_instances('tx', tx_plot_data, [link.Name], true);

    const ports = links.filter(l => l.Master === link.Name);
    const routes = interestingRoutes(link);
    const description = [link.Kind ?? link.Type, link.Driver && link.Driver !== link.Kind ? link.Driver : null]
            .filter(s => !!s)
            .join(" · ");

    return (
        <Page id="network-interface" className="pf-m-no-sidebar">
            <PageBreadcrumb hasBodyWrapper={false} stickyOnBreakpoint={{ default: "top" }}>
                <Breadcrumb>
                    <BreadcrumbItem to="#/">{_("Networking")}</BreadcrumbItem>
                    <BreadcrumbItem isActive>{link.Name}</BreadcrumbItem>
                </Breadcrumb>
            </PageBreadcrumb>
            <PageSection hasBodyWrapper={false} className="networking-graphs">
                <NetworkPlots plot_state={plot_state} />
            </PageSection>
            <PageSection hasBodyWrapper={false}>
                <Gallery hasGutter>
                    <Card isPlain className="network-interface-details">
                        <CardHeader>
                            <CardTitle className="network-interface-details-title">
                                <span id="network-interface-name">{link.Name}</span>
                                <span id="network-interface-hw">{description}</span>
                                <span id="network-interface-mac">{formatMAC(link.HardwareAddress)}</span>
                            </CardTitle>
                        </CardHeader>
                        <CardBody>
                            <LinkDetails link={link} />
                        </CardBody>
                        {link.AdministrativeState === "unmanaged" &&
                            <CardBody>{_("This interface is not managed by systemd-networkd.")}</CardBody>}
                    </Card>

                    {ports.length > 0 &&
                    <Card isPlain id="network-interface-members">
                        <CardHeader>
                            <CardTitle component="h2">{_("Ports")}</CardTitle>
                        </CardHeader>
                        <ListingTable
                            aria-label={_("Ports")}
                            variant="compact"
                            columns={[
                                { title: _("Name"), header: true, props: { width: 25 as const } },
                                { title: _("Status"), props: { width: 25 as const } },
                                { title: _("Sending"), props: { width: 25 as const } },
                                { title: _("Receiving"), props: { width: 25 as const } },
                            ]}
                            rows={ports.map(port => ({
                                columns: [
                                    { title: <LinkName name={port.Name} /> },
                                    { title: operationalStateText(port.OperationalState) },
                                    ...trafficColumns(port, usage_monitor),
                                ],
                                props: rowProps(port.Name),
                            }))}
                        />
                    </Card>}

                    {routes.length > 0 &&
                    <Card isPlain id="network-interface-routes">
                        <CardHeader>
                            <CardTitle component="h2">{_("Routes")}</CardTitle>
                        </CardHeader>
                        <ListingTable
                            aria-label={_("Routes")}
                            variant="compact"
                            columns={[
                                { title: _("Destination"), header: true, props: { width: 30 as const } },
                                { title: _("Gateway"), props: { width: 30 as const } },
                                { title: _("Metric"), props: { width: 10 as const } },
                                { title: _("Table"), props: { width: 15 as const } },
                                { title: _("Origin"), props: { width: 15 as const } },
                            ]}
                            rows={routes.map((r, i) => ({
                                columns: [
                                    { title: formatDestination(r) },
                                    { title: r.Gateway ? formatIP(r.Family, r.Gateway) : "" },
                                    { title: String(r.Priority ?? "") },
                                    { title: r.TableString ?? String(r.Table ?? "") },
                                    { title: r.ProtocolString ?? "" },
                                ],
                                props: { key: i },
                            }))}
                        />
                    </Card>}
                </Gallery>
            </PageSection>
        </Page>
    );
};
