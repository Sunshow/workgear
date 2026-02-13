FROM node:22-slim

# Install git and other essentials
RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Install OpenSpec CLI globally
RUN npm install -g @fission-ai/openspec@latest

# Create workspace and output directories
RUN mkdir -p /workspace /output

# Create non-root user (Claude Code refuses --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash agent && \
    chown -R agent:agent /workspace /output

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Switch to non-root user
USER agent

# Default working directory
WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
