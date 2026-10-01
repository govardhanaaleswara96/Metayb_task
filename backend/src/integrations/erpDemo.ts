import express from 'express';
const app = express();
app.use(express.json());
const seen = new Set<string>();
app.post('/events', (req, res) => {
  const mode = process.env.ERP_DEMO_MODE ?? 'success';
  console.log(`[${new Date().toISOString()}] ERP ${mode}: ${req.body?.eventId ?? 'unknown event'}`);
  if (mode === 'timeout') return; // The sender aborts the connection on timeout.
  if (mode === '5xx') { res.status(503).json({ error: 'Demo service unavailable' }); return; }
  if (mode === '4xx') { res.status(400).json({ error: 'Demo rejected payload' }); return; }
  if (typeof req.body?.eventId !== 'string') { res.status(400).json({ error: 'eventId required' }); return; }
  if (!seen.has(req.body.eventId)) {
    seen.add(req.body.eventId);
    console.log('ERP received:', JSON.stringify(req.body));
  } else console.log('ERP duplicate acknowledged:', req.body.eventId);
  res.status(200).json({ received: req.body.eventId });
});
app.listen(5050, '127.0.0.1', () => console.log('Local ERP: http://127.0.0.1:5050/events (ERP_DEMO_MODE=success|5xx|4xx|timeout)'));
