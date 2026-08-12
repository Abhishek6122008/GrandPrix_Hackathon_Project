# syntax=docker/dockerfile:1

# Jenkins, with every toolchain this project builds with, plus a Docker CLI.
#
# Why the tools live *in* this image rather than each stage running in its own
# maven/node/python container:
#
# Jenkins here talks to the host's Docker daemon through a mounted socket. Any container it
# starts is a sibling on the host, so a `-v $WORKSPACE:/src` inside a job asks the *host* for
# that path — and the workspace only exists inside this container, on a named volume. The
# result is a silent empty mount rather than an error. Installing the toolchains directly
# sidesteps the whole class of problem, and `docker build` still works over the socket because
# the CLI streams the build context instead of mounting it.
FROM jenkins/jenkins:lts-jdk21

USER root

ENV DEBIAN_FRONTEND=noninteractive

# --- Docker CLI + compose plugin -------------------------------------------
# From Docker's own repo. Debian's docker.io would drag in a daemon we do not want.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
 && chmod a+r /etc/apt/keyrings/docker.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
 && rm -rf /var/lib/apt/lists/*

# --- Maven + Python ---------------------------------------------------------
# The JDK is already here (lts-jdk21) and the backend targets 21, so nothing to add for Java.
RUN apt-get update \
 && apt-get install -y --no-install-recommends maven python3 python3-venv python3-pip \
 && rm -rf /var/lib/apt/lists/*

# --- Node 22 ----------------------------------------------------------------
# NodeSource rather than Debian's, which is still on 18. Not a hard requirement today, but the
# frontend is developed on 22 and CI matching the developer's runtime is the cheap way to avoid
# a class of "works on my machine".
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt

# Left as root: the mounted Docker socket is not writable by the jenkins user, and see the
# note in docker-compose.yml for why matching the host's docker gid is worse than this.
# The setup wizard stays ON — an unauthenticated Jenkins holding this socket is root on the
# host, which is a much bigger hole than the one skipping the wizard closes.
