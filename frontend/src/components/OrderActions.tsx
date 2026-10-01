import { Button, Stack } from '@mui/material';
import type { Action, Actor, Order } from '../types/api';
const labels: Record<Action, string> = { approve: 'Approve', reject: 'Reject', cancel: 'Cancel order', dispatch: 'Dispatch', deliver: 'Deliver' };
export function OrderActions({ order, actor, busy, onAction }: { order: Order; actor: Actor; busy: boolean; onAction: (id: string, action: Action) => void }) {
  // Buttons are presentation hints; the API validates every action independently.
  let actions: Action[] = [];
  if (actor.role === 'DISTRIBUTOR' && ['Placed', 'PendingApproval', 'Confirmed'].includes(order.status)) actions = ['cancel'];
  if (actor.role === 'SALES_MANAGER') {
    if (order.status === 'PendingApproval') actions = ['approve', 'reject'];
    if (order.status === 'Confirmed') actions = ['dispatch'];
    if (order.status === 'Dispatched') actions = ['deliver'];
  }
  return <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>{actions.map(action => <Button key={action} size="small" variant={action === 'reject' || action === 'cancel' ? 'outlined' : 'contained'} color={action === 'reject' || action === 'cancel' ? 'error' : 'primary'} disabled={busy} onClick={() => onAction(order.id, action)}>{labels[action]}</Button>)}</Stack>;
}
