FROM alpine:3.23@sha256:85fe1e81d6758c208f3e1eed4338a1997e19d4be002d4dd32d3100c9a8c010a0
RUN apk add --no-cache openssh-server dropbear tcpdump && \
    mkdir -p /run/sshd /etc/dropbear && \
    printf 'Port 22\nUseDNS no\nPasswordAuthentication no\nPermitRootLogin no\nLogLevel DEBUG2\n' > /etc/ssh/sshd_config
COPY entrypoint.sh /lab-entrypoint.sh
ENTRYPOINT ["/bin/sh", "/lab-entrypoint.sh"]
