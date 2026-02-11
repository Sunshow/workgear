package event

import (
	"sync"
	"time"

	"go.uber.org/zap"
)

// Event represents an internal event
type Event struct {
	Type      string         `json:"type"`
	FlowRunID string        `json:"flow_run_id"`
	NodeRunID string        `json:"node_run_id,omitempty"`
	NodeID    string        `json:"node_id,omitempty"`
	Data      map[string]any `json:"data,omitempty"`
	Timestamp int64          `json:"timestamp"`
}

// Subscriber is a function that receives events
type Subscriber func(event *Event)

// Bus is an in-memory event bus for publishing events to subscribers
type Bus struct {
	mu          sync.RWMutex
	subscribers map[string][]Subscriber // channel → subscribers
	logger      *zap.SugaredLogger
}

// NewBus creates a new event bus
func NewBus(logger *zap.SugaredLogger) *Bus {
	return &Bus{
		subscribers: make(map[string][]Subscriber),
		logger:      logger,
	}
}

// Subscribe registers a subscriber for a channel
// channel can be "*" for all events, or "flow-run:{id}" for specific flow
func (b *Bus) Subscribe(channel string, sub Subscriber) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.subscribers[channel] = append(b.subscribers[channel], sub)
}

// Unsubscribe removes all subscribers for a channel
func (b *Bus) Unsubscribe(channel string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.subscribers, channel)
}

// Publish sends an event to all matching subscribers
func (b *Bus) Publish(evt *Event) {
	if evt.Timestamp == 0 {
		evt.Timestamp = time.Now().UnixMilli()
	}

	b.mu.RLock()
	defer b.mu.RUnlock()

	b.logger.Debugw("Publishing event",
		"type", evt.Type,
		"flow_run_id", evt.FlowRunID,
		"node_run_id", evt.NodeRunID,
	)

	// Notify wildcard subscribers
	for _, sub := range b.subscribers["*"] {
		sub(evt)
	}

	// Notify flow-specific subscribers
	if evt.FlowRunID != "" {
		channel := "flow-run:" + evt.FlowRunID
		for _, sub := range b.subscribers[channel] {
			sub(evt)
		}
	}
}
