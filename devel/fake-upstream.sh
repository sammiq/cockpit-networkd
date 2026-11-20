#!/bin/sh
# Dev container only. Creates uplink0, a veth whose peer lives in a separate
# network namespace ("upstream") acting as a router at 10.30.0.254. networkd
# manages uplink0 (see network/05-uplink0.network), and traffic flows in both
# directions so the graphs and the Sending/Receiving columns have data.
set -eu

# `ip netns exec` / `ip -n` remount /sys, which a rootless container forbids;
# nsenter only switches the network namespace.
up() { nsenter --net=/run/netns/upstream "$@"; }

ip netns del upstream 2>/dev/null || true
ip link del uplink0 2>/dev/null || true

ip netns add upstream
ip link add uplink0 type veth peer name eth0 netns upstream
up ip addr add 10.30.0.254/24 dev eth0
up ip addr add fd00:30::fe/64 dev eth0 nodad
up ip link set lo up
up ip link set eth0 up

# Wait for networkd to configure uplink0
for _ in $(seq 50); do
    ip -4 addr show dev uplink0 | grep -q 10.30.0.1 && break
    sleep 0.2
done

# Independent flows, so a slow one never stalls the others. Bursts with
# random gaps make the graphs look alive; downloads outweigh uploads.
pause() { sleep "$(( $(od -An -N1 -tu1 /dev/urandom) % ${1} ))"; }

# download: upstream -> uplink0 (Receiving)
( while :; do up ping -q -c 100 -i 0.01 -s 1400 10.30.0.1 >/dev/null 2>&1; pause 3; done ) &
# upload: uplink0 -> upstream (Sending)
( while :; do ping -q -c 40 -i 0.025 -s 300 10.30.0.254 >/dev/null 2>&1; pause 4; done ) &
# a trickle out of the dummy links; nothing answers, so bound each run with -w
( while :; do ping -q -i 0.2 -s 800 -w 2 10.99.0.2 >/dev/null 2>&1; pause 3; done ) &
( while :; do ping -q -i 0.3 -s 400 -w 2 172.16.0.20 >/dev/null 2>&1; pause 5; done ) &
wait
