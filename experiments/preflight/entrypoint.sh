#!/bin/sh
set -eu
case "${LAB_DAEMON:-openssh}" in
  openssh)
    ssh-keygen -A
    exec /usr/sbin/sshd -D -e
    ;;
  dropbear)
    exec /usr/sbin/dropbear -F -E -R -s -w -p 22
    ;;
  *)
    echo 'Unknown fixture daemon' >&2
    exit 64
    ;;
esac
