# cockpit-networkd

A [Cockpit](https://cockpit-project.org/) networking page for hosts that use
**systemd-networkd** instead of NetworkManager. It follows the layout of
Cockpit's built-in Networking page:

* Transmitting / Receiving graphs
* Interfaces: addresses, current send and receive rates, networkd setup state,
  and bond/bridge ports listed under their parent
* Unmanaged interfaces
* The latest `systemd-networkd.service` log entries

Clicking an interface opens its page at `/networkd#/<name>`, like the stock
page: Tx/Rx graphs for just that interface, then status, carrier, IPv4/IPv6
addresses, gateway, DNS, MTU, the bond or bridge it belongs to, and its
`.network`/`.netdev`/`.link` files, followed by a Ports table (for a bond or
bridge) and a Routes table.

It is **read-only** for now.

It appears in the menu as "Networking" on any host with systemd-networkd's
D-Bus policy installed. Cockpit's own page only appears on hosts with
NetworkManager, so on a networkd-only server you see just this one. On a
machine with both installed, both pages appear.

## How it works

| What | Source |
|------|--------|
| Interfaces, state, addresses | `org.freedesktop.network1.Manager.Describe()` over D-Bus. Refreshed on networkd's `PropertiesChanged` signals, plus a 5 s poll for things that don't emit a signal (links coming and going, address changes) |
| Bond/bridge membership | `ip -j link` (networkd's `Describe()` doesn't include it) |
| Graphs and rates | Cockpit's metrics channel: PCP if installed, otherwise the bridge's own `/proc/net/dev` reader. No NetworkManager involved |
| Logs | journal, `_SYSTEMD_UNIT=systemd-networkd.service` |

Code: `src/model.ts` (data), `src/network-page.tsx` (overview),
`src/interface-page.tsx` (one interface), `src/link-utils.tsx` (shared),
`src/plots.jsx` and `src/usage-monitor.js` (adapted from Cockpit's
`pkg/networkmanager`).

Needs a systemd recent enough to have networkd's `Describe()` D-Bus method;
very old releases lack it. Developed against Debian Trixie (systemd 257,
Cockpit 337).

# Development

Dependencies (Fedora: `sudo dnf install gettext nodejs npm make podman`):

    make                   # fetch pkg/lib from Cockpit, npm install, build dist/

## Dev container (recommended)

Your workstation probably runs NetworkManager, so development happens in a
rootless podman container running Debian Trixie with systemd-networkd and
Cockpit. It has no NetworkManager, and your host's networking is left alone:

    make devel-container   # build image on first run, then start it
    make watch             # rebuild dist/ on every change

Open <http://127.0.0.1:9091/networkd> and log in as `admin` / `admin`. After
each rebuild, reload the page. The container serves your checkout's `dist/`
directly.

The container ships sample configs in `devel/network/`: a static link, a VLAN,
a bridge with a port, an active-backup bond with two ports, a DHCP link that
never gets a lease, an administratively down link, an unmanaged netdev, and
`uplink0`. That last one is a veth whose peer sits in a separate network
namespace acting as an upstream router, with generated traffic in both
directions so the graphs move (`devel/fake-upstream.sh`).

Other targets: `make devel-shell` (root shell in the container), `make
devel-stop`, `make devel-image` (rebuild after changing `devel/`).
`DEVEL_PORT=…` changes the port. `devel/bin/devel-container logs` follows the
networkd journal.

To change what networkd sees, edit `devel/network/` and run `make devel-image
devel-container`, or experiment live in `make devel-shell` with
`networkctl reload`.

Notes: the container needs `--privileged`. It is rootless, so this is
limited to your own user account's privileges. systemd needs it for its
service sandboxing, and networkd needs `CAP_NET_ADMIN`/`CAP_SYS_ADMIN` in the
container's own network namespace. Browser traffic to the container doesn't
show on its `enp7s0`, because podman forwards the port at the socket level.

## Against a real server

`RSYNC_DEVEL=server make watch` copies each build to `~/.local/share/cockpit/`
on `server` over ssh. Remove it there with `rm -r
~/.local/share/cockpit/networkd`.

## Installing

### Debian / Ubuntu package

    make deb               # -> cockpit-networkd_<version>_all.deb
    scp cockpit-networkd_*_all.deb server:
    ssh server sudo apt install ./cockpit-networkd_<version>_all.deb

It installs to `/usr/share/cockpit/networkd` and depends on `cockpit-bridge`,
`systemd` and `iproute2`. Remove it with `apt remove cockpit-networkd`.

* The target always does a fresh production (minified, gzipped) build, so
  `dist/` is left in production mode afterwards. Run `make` or `make watch`
  before going back to the dev container.
* The version comes from `git describe`, which gives `1` until there's a
  tag. Tag releases (e.g. `git tag 0.1`) so upgrades get increasing versions.
* `Maintainer` is filled in from your `git config user.name`/`user.email`
  (override with `DEB_MAINTAINER=…`).
* It uses `dpkg-deb` if installed, otherwise runs it in a `debian:trixie`
  container with podman.

Adapted from [cockpit-sensors](https://github.com/ocristopfer/cockpit-sensors)'
Makefile. It's a plain `dpkg-deb` build, not a full `debian/` source package,
which is fine for installing on your own machines.

### Other ways

`make install` installs to `/usr/local/share/cockpit/networkd`
(`PREFIX=/usr` for `/usr/share`). `make rpm` and `packaging/arch` come from
the starter kit and are untested.

## Checks

    npm run eslint         # or eslint:fix
    npm run stylelint
    test/common/typecheck

`make codecheck` runs all of these. The VM-based integration tests from the
starter kit (`make check`, `test/check-application`) need `/dev/kvm` and a
Cockpit test image with systemd-networkd. They have not been adapted or run
yet.

# Based on

[cockpit-project/starter-kit](https://github.com/cockpit-project/starter-kit).
`pkg/lib` and `test/common` are fetched from Cockpit at the commit pinned in
the `Makefile`.
