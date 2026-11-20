/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React from 'react';
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { ExclamationCircleIcon } from '@patternfly/react-icons';

import cockpit from 'cockpit';
import { useEvent, useObject, usePageLocation } from 'hooks';
import { EmptyStatePanel } from 'cockpit-components-empty-state.jsx';
import { PlotState } from 'plot';

import { createModel } from './model';
import { InterfacePage } from './interface-page';
import { NetworkPage } from './network-page';
import { UsageMonitor } from './usage-monitor.js';

const _ = cockpit.gettext;

export const Application = () => {
    const model = useObject(createModel, model => model.close(), []);
    useEvent(model, "changed");

    const usage_monitor = useObject(() => new UsageMonitor(), null, []);
    // Separate plot state per page, as on the NetworkManager page, so the
    // overview's stacked series and one interface's series don't mix
    const plot_state_main = useObject(() => new PlotState(), null, []);
    const plot_state_iface = useObject(() => new PlotState(), null, []);

    const { path } = usePageLocation();

    const state = model.state;

    if (state.status === "loading")
        return <EmptyStatePanel loading />;

    if (state.status === "error") {
        return (
            <div id="networking-networkd-error">
                <EmptyStatePanel
                    icon={ExclamationCircleIcon}
                    title={state.notRunning
                        ? _("systemd-networkd is not running")
                        : _("Cannot read network state from systemd-networkd")}
                    paragraph={state.notRunning ? null : state.message}
                    secondary={
                        <Button
                            component="a"
                            variant="secondary"
                            onClick={() => cockpit.jump("/system/services#/systemd-networkd.service", cockpit.transport.host)}
                        >
                            {_("Troubleshoot…")}
                        </Button>
                    }
                />
            </div>
        );
    }

    if (path.length === 0)
        return <NetworkPage links={state.links} usage_monitor={usage_monitor} plot_state={plot_state_main} />;

    const link = path.length === 1 ? state.links.find(l => l.Name === path[0]) : undefined;
    if (!link) {
        return (
            <EmptyStatePanel
                icon={ExclamationCircleIcon}
                title={cockpit.format(_("Network interface '$0' not found"), path.join("/"))}
                action={_("Return to overview page")}
                actionVariant="link"
                onAction={() => cockpit.location.go("/")}
            />
        );
    }

    return (
        <InterfacePage
            key={link.Name}
            link={link}
            links={state.links}
            usage_monitor={usage_monitor}
            plot_state={plot_state_iface}
        />
    );
};
