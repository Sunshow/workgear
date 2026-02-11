FROM node:22-slim

# Install git and other essentials
RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create workspace and output directories
RUN mkdir -p /workspace /output

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Default working directory
WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
