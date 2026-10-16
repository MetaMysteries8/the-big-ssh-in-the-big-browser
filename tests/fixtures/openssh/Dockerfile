FROM alpine:3.23@sha256:85fe1e81d6758c208f3e1eed4338a1997e19d4be002d4dd32d3100c9a8c010a0
RUN apk add --no-cache openssh-server bash && \
    adduser -D -s /bin/bash bigssh && \
    echo 'bigssh:bigssh-test-password' | chpasswd && \
    adduser -D -s /bin/bash onboarding && passwd -d onboarding && \
    mkdir -p /run/sshd && \
    printf 'PasswordAuthentication yes\nPermitEmptyPasswords yes\nPermitRootLogin no\nKbdInteractiveAuthentication no\nUsePAM no\nLogLevel VERBOSE\nSubsystem sftp internal-sftp\n' > /etc/ssh/sshd_config
EXPOSE 22
CMD ["/bin/sh", "-c", "ssh-keygen -A && exec /usr/sbin/sshd -D -e"]
