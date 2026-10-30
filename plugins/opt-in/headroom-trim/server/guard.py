"""Block every network call except loopback, for the life of the process.

A PEP 578 audit hook sees each socket connect, sendto and DNS lookup made through Python and stops the call by
raising. It cannot be removed once installed.
"""

import ipaddress
import socket
import sys

_LOOPBACK_NAMES = {"localhost", "127.0.0.1", "::1"}


def _is_loopback(host):
    if host is None:
        return True
    if isinstance(host, bytes):
        host = host.decode(errors="replace")
    host = str(host)
    if host in _LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _host(target):
    # an address is (host, port, ...); the gethostbyname events wrap their arguments in a tuple again
    while isinstance(target, (tuple, list)) and target:
        target = target[0]
    return target


def _hook(event, args):
    if event in ("socket.connect", "socket.sendto", "socket.sendmsg"):
        sock, addr = args[0], args[1]
        if getattr(sock, "family", None) == getattr(socket, "AF_UNIX", object()):
            return
        if not _is_loopback(_host(addr)):
            raise PermissionError(f"guard: {event} to {addr} blocked")
    elif event in ("socket.getaddrinfo", "socket.gethostbyname", "socket.gethostbyaddr", "socket.getnameinfo"):
        if not _is_loopback(_host(args[0])):
            raise PermissionError(f"guard: DNS lookup of {args[0]} blocked")


def install():
    sys.addaudithook(_hook)
