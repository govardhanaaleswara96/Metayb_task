import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, Typography } from '@mui/material';
import { api, actorHeaders, apiError } from '../api/client';
import type { Action, Actor, Order, Profile } from '../types/api';
import { OrderItems, OrderTotals, orderLabel, StatusChip, statusLabel } from './OrderPresentation';
import { OrderActions } from './OrderActions';
export function OrderDetail({ id, actor, users, revision, profile, busy, actionError, notice, onClose, onAction }: { id: string; actor: Actor; users: Actor[]; revision: number; profile: Profile | null; busy: boolean; actionError: string; notice: string; onClose: () => void; onAction: (id: string, action: Action) => void }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api.get<Order>(`/orders/${id}`, { ...actorHeaders(actor.id), signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setOrder(data);
    }).catch(error => { if (!controller.signal.aborted) setError(apiError(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, actor.id, revision, retry]);
  return <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="md"><DialogTitle>Order Details</DialogTitle><DialogContent dividers>
    {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}
    {notice && <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert>}
    {loading ? <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress aria-label="Loading order details" /></Box> : error ? <Alert severity="error" action={<Button color="inherit" onClick={() => setRetry(value => value + 1)}>Retry</Button>}>{error}</Alert> : order && <Stack spacing={2}>
      <Typography variant="h6">Order Summary</Typography><Typography fontWeight={600}>{orderLabel(order.id)}</Typography><Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>Reference: {order.id}</Typography><Box><StatusChip status={order.status} /></Box>
      <Typography variant="body2">{users.find(user => user.distributor?.id === order.distributorId)?.name ?? 'Distributor'} · {new Date(order.createdAt).toLocaleString()}</Typography>
      <Divider /><Typography variant="h6">Items</Typography><OrderItems order={order} /><Divider /><Typography variant="h6">Financial Summary</Typography><OrderTotals order={order} />
      {profile && <Alert severity="info">Current loyalty: {profile.points} points · {profile.tier}. The discount above is fixed for this order.</Alert>}
      <OrderActions order={order} actor={actor} busy={busy} onAction={onAction} />
      <Divider /><Typography variant="h6">Status History</Typography>
      {!order.events?.length && <Typography color="text.secondary">No status transitions recorded.</Typography>}
      {order.events?.map(event => <Box key={event.id} sx={{ pl: 2, py: 1, borderLeft: '3px solid', borderColor: 'divider' }}><Typography>{statusLabel(event.fromStatus)} → {statusLabel(event.toStatus)}</Typography><Typography variant="body2" color="text.secondary">{new Date(event.createdAt).toLocaleString()} · {event.actorType === 'SYSTEM' ? 'System' : users.find(user => user.id === event.actorUserId)?.name ?? 'User'}</Typography></Box>)}
    </Stack>}
  </DialogContent><DialogActions><Button onClick={onClose} disabled={busy}>Close</Button></DialogActions></Dialog>;
}
