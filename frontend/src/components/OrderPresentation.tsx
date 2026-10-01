import { Chip, Stack, Typography, TableContainer, Table, TableHead, TableRow, TableCell, TableBody } from '@mui/material';
import type { Order, Status } from '../types/api';
export const money = (minor: number) => (minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const orderLabel = (id: string) => `Order ${id.startsWith('history-') ? id.replace('history-', '') + ' · history' : id.slice(-8).toUpperCase()}`;
export const statusLabel = (status: Status) => status === 'PendingApproval' ? 'Pending Approval' : status;
export function StatusChip({ status }: { status: Status }) {
  const color = status === 'PendingApproval' ? 'warning' : status === 'Confirmed' || status === 'Delivered' ? 'success' : status === 'Rejected' || status === 'Cancelled' ? 'error' : 'info';
  return <Chip size="small" color={color} label={statusLabel(status)} sx={{ fontWeight: 600 }} />;
}
export function OrderTotals({ order }: { order: Order }) {
  // The backend's fixed discount identifies the tier used on this order.
  const tier = order.discountPercent === 6 ? 'Gold' : order.discountPercent === 3 ? 'Silver' : 'Bronze';
  return <Stack spacing={1} sx={{ p: 2, bgcolor: 'background.default', borderRadius: 2 }}>
    <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">Subtotal</Typography><Typography>{money(order.subtotalMinor)}</Typography></Stack>
    <Stack direction="row" justifyContent="space-between" spacing={2}><Typography color="text.secondary">{tier} discount · {order.discountPercent}%</Typography><Typography>−{money(order.discountMinor)}</Typography></Stack>
    <Stack direction="row" justifyContent="space-between" sx={{ pt: 1, borderTop: '1px solid', borderColor: 'divider' }}><Typography fontWeight={700}>Final total</Typography><Typography variant="h6">{money(order.totalMinor)}</Typography></Stack>
  </Stack>;
}
export function OrderItems({ order }: { order: Order }) {
  return <TableContainer><Table size="small" aria-label="Order items"><TableHead><TableRow>
    <TableCell>Product / SKU</TableCell><TableCell align="right">Qty</TableCell><TableCell align="right">Unit price</TableCell><TableCell align="right">Subtotal</TableCell>
  </TableRow></TableHead><TableBody>{order.items.map(item => <TableRow key={item.id}>
    <TableCell>{item.product?.name ?? item.productId}<Typography variant="caption" display="block">{item.product?.sku ?? item.productId}</Typography></TableCell>
    <TableCell align="right">{item.quantity}</TableCell><TableCell align="right">{money(item.unitPriceMinor)}</TableCell><TableCell align="right">{money(item.lineSubtotalMinor)}</TableCell>
  </TableRow>)}</TableBody></Table></TableContainer>;
}
