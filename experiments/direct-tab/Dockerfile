FROM alpine:3.23@sha256:85fe1e81d6758c208f3e1eed4338a1997e19d4be002d4dd32d3100c9a8c010a0
RUN apk add --no-cache openssh-server tcpdump && \
    mkdir -p /run/sshd && \
    printf 'Port 22\nUseDNS no\nPasswordAuthentication no\nPermitRootLogin no\nLogLevel VERBOSE\n' > /etc/ssh/sshd_config
# tcpdump observes eth0; it never terminates or forwards a connection.
CMD ["/bin/sh", "-c", "ssh-keygen -A && exec /usr/sbin/sshd -D -e"]
