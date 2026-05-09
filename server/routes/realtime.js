/**
 * Realtime Streaming Routes
 * Provides live event streams to admin clients
 */

const express = require('express');
const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const getRealtimeEventService = require('../services/realtimeeventservice');

const router = express.Router();

/**
 * SSE (Server-Sent Events) endpoint for live streaming
 * GET /api/realtime/stream
 */
router.get('/stream', adminAccessDisabled, (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Send initial heartbeat
  res.write(':connected\n\n');

  const realtimeService = getRealtimeEventService();
  let isConnected = true;
  let heartbeatInterval = null;

  // Subscribe to events
  const unsubscribe = realtimeService.subscribe((event) => {
    if (!isConnected) return;

    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (error) {
      // Connection likely closed
      isConnected = false;
    }
  });

  // Heartbeat to keep connection alive
  heartbeatInterval = setInterval(() => {
    if (!isConnected) return;

    try {
      res.write(':heartbeat\n\n');
    } catch (error) {
      isConnected = false;
    }
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    isConnected = false;
    unsubscribe();
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    res.end();
  });

  req.on('error', () => {
    isConnected = false;
    unsubscribe();
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
  });

  // Send initial service status
  res.write(`data: ${JSON.stringify({
    id: 'init',
    type: 'system',
    scope: 'realtime',
    payload: {
      message: 'Realtime stream connected',
      timestamp: Date.now()
    },
    timestamp: Date.now()
  })}\n\n`);
});

/**
 * Polling endpoint for recent events
 * GET /api/realtime/events
 */
router.get('/events', adminAccessDisabled, (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const realtimeService = getRealtimeEventService();
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 500);
    const since = Number(req.query.since) || 0;

    let events;
    if (since > 0) {
      events = realtimeService.getEventsSince(since);
    } else {
      events = realtimeService.getRecentEvents(limit);
    }

    return res.json({
      success: true,
      events,
      count: events.length,
      timestamp: Date.now()
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
      timestamp: Date.now()
    });
  }
});

/**
 * Get realtime service statistics
 * GET /api/realtime/stats
 */
router.get('/stats', adminAccessDisabled, (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const realtimeService = getRealtimeEventService();
    const stats = realtimeService.getStats();

    return res.json({
      success: true,
      stats,
      timestamp: Date.now()
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
      timestamp: Date.now()
    });
  }
});

/**
 * Ping endpoint to verify connection
 * GET /api/realtime/ping
 */
router.get('/ping', adminAccessDisabled, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    success: true,
    message: 'Realtime service is online',
    timestamp: Date.now()
  });
});

module.exports = router;
