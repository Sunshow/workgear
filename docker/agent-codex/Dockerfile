FROM node:22-slim

# Install git and other essentials
RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates curl jq && \
    rm -rf /var/lib/apt/lists/*

# Install Codex CLI globally
RUN npm install -g @openai/codex

# Install OpenSpec CLI globally
RUN npm install -g @fission-ai/openspec@latest

# Create workspace, output, and config directories
RUN mkdir -p /workspace /output

# Create non-root user
RUN useradd -m -s /bin/bash agent && \
    chown -R agent:agent /workspace /output

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Switch to non-root user
USER agent

# Ensure codex config directory exists
RUN mkdir -p /home/agent/.codex

# Default working directory
WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
