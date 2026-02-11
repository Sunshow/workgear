package db

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

// Client wraps pgxpool for database operations
type Client struct {
	pool   *pgxpool.Pool
	logger *zap.SugaredLogger
}

// NewClient creates a new database client.
// Requires DATABASE_URL environment variable to be set.
func NewClient(ctx context.Context, logger *zap.SugaredLogger) (*Client, error) {
	connStr := os.Getenv("DATABASE_URL")
	if connStr == "" {
		return nil, fmt.Errorf("DATABASE_URL environment variable is required")
	}

	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	logger.Info("Connected to PostgreSQL")
	return &Client{pool: pool, logger: logger}, nil
}

// Close closes the database connection pool
func (c *Client) Close() {
	c.pool.Close()
}
