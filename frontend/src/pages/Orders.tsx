import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Stack, Tab, Tabs, Typography } from '@mui/material';
import type { Action, Actor, Order } from '../types/api';
import { OrderActions } from '../components/OrderActions';
import { money, orderLabel, StatusChip } from '../components/OrderPresentation';
export function Orders({ orders, actor, users, busy, onSelect, onAction }: { orders: Order[]; actor: Actor; users: Actor[]; busy: boolean; onSelect: (id: string) => void; onAction: (id: string, action: Action) => void }) {
  const [view, setView] = useState(0);
  const manager = actor.role === 'SALES_MANAGER';
  const pending = orders.filter(order => order.status === 'PendingApproval');
  const groups = manager ? view === 0 ? [{ title: 'Pending Approvals', orders: pending }] : [
    { title: 'Pending Approvals', orders: pending }, { title: 'Other orders', orders: orders.filter(order => order.status !== 'PendingApproval') },
  ] : [{ title: 'My Orders', orders }];
  return <Stack spacing={2}>
    {manager && <Tabs value={view} onChange={(_event, value: number) => setView(value)} variant="scrollable"><Tab label={`Pending Approvals (${pending.length})`} /><Tab label={`All orders (${orders.length})`} /></Tabs>}
    {groups.map(group => <Stack spacing={1.5} key={group.title}>
      <Box><Typography variant="h5">{group.title}</Typography><Typography color="text.secondary" variant="body2">{group.title === 'Pending Approvals' ? 'Review orders awaiting your credit approval.' : 'Track progress and open an order for its full details.'}</Typography></Box>
      {!group.orders.length && <Alert severity="info">{group.title === 'Pending Approvals' ? 'All caught up. No orders need approval.' : 'No orders to show yet.'}</Alert>}
      {group.orders.map(order => {
        const distributor = users.find(user => user.distributor?.id === order.distributorId);
        return <Card variant="outlined" key={order.id}><CardContent><Stack spacing={2}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: '1.5fr 1fr 1fr 1fr' }, gap: 2, alignItems: 'center' }}>
            <Box><Typography fontWeight={700}>{orderLabel(order.id)}</Typography>{manager && <Typography variant="body2" color="text.secondary">{distributor?.name ?? 'Distributor'}</Typography>}</Box>
            <Box><StatusChip status={order.status} /></Box>
            <Box><Typography variant="caption" color="text.secondary">Order total</Typography><Typography variant="h6">{money(order.totalMinor)}</Typography></Box>
            <Box><Typography variant="caption" color="text.secondary">Placed</Typography><Typography variant="body2">{new Date(order.createdAt).toLocaleDateString()}</Typography></Box>
          </Box>
          {manager && order.status === 'PendingApproval' && distributor?.distributor && <Typography variant="body2" color="text.secondary">Distributor credit limit: {money(distributor.distributor.creditLimitMinor)}</Typography>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between"><Button variant="outlined" onClick={() => onSelect(order.id)} disabled={busy}>View Details</Button><OrderActions order={order} actor={actor} busy={busy} onAction={onAction} /></Stack>
        </Stack></CardContent></Card>;
      })}
    </Stack>)}
  </Stack>;
}
