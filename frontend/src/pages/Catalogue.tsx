import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, Stack, TextField, Typography } from '@mui/material';
import { api, actorHeaders, apiError } from '../api/client';
import { useActor } from '../context/ActorContext';
import type { Order, Product, Profile } from '../types/api';
import { money, orderLabel, OrderTotals, StatusChip } from '../components/OrderPresentation';
interface CartLine { productId: string; quantity: string }
export function Catalogue({ products, profile, onPlaced, busy }: { products: Product[]; profile: Profile | null; onPlaced: (order: Order) => Promise<void>; busy: boolean }) {
  const { actor } = useActor();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<Order | null>(null);
  const [invalid, setInvalid] = useState('');
  function add(product: Product) {
    const quantity = Number(quantities[product.id] ?? '1');
    if (!Number.isSafeInteger(quantity) || quantity <= 0) { setInvalid('Choose a positive whole-number quantity.'); return; }
    setInvalid(''); setSuccess(null);
    setCart(lines => lines.some(line => line.productId === product.id) ? lines.map(line => line.productId === product.id ? { ...line, quantity: String(quantity) } : line) : [...lines, { productId: product.id, quantity: String(quantity) }]);
  }
  async function submit() {
    if (!actor || !cart.length) return;
    if (cart.some(line => !Number.isSafeInteger(Number(line.quantity)) || Number(line.quantity) <= 0)) { setInvalid('Every order quantity must be a positive whole number.'); return; }
    setInvalid('');
    setSubmitting(true); setError(''); setSuccess(null);
    try {
      const { data } = await api.post<Order>('/orders', { items: cart.map(line => ({ productId: line.productId, quantity: Number(line.quantity) })) }, actorHeaders(actor.id));
      setSuccess(data); setCart([]);
      await onPlaced(data);
    } catch (error) { setError(apiError(error)); }
    finally { setSubmitting(false); }
  }
  // Display-only estimates. The placement request still sends IDs/quantities only.
  const validCart = cart.every(line => Number.isSafeInteger(Number(line.quantity)) && Number(line.quantity) > 0);
  const subtotal = cart.reduce((sum, line) => sum + (products.find(product => product.id === line.productId)?.unitPriceMinor ?? 0) * Number(line.quantity), 0);
  const discountPercent = profile ? { BRONZE: 0, SILVER: 3, GOLD: 6 }[profile.tier] : 0;
  const discount = Math.round(subtotal * discountPercent / 100);
  return <Stack spacing={3}>
    <Typography variant="body2" color="text.secondary">1. Choose products → 2. Review cart → 3. Place order → 4. My orders</Typography>
    {error && <Alert severity="error">{error}</Alert>}{invalid && <Alert severity="warning">{invalid}</Alert>}
    {success && <Card variant="outlined" sx={{ borderColor: success.status === 'Confirmed' ? 'success.main' : 'warning.main' }}><CardContent><Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" spacing={2}><Box><Typography variant="h6">{success.status === 'Confirmed' ? 'Your order is confirmed' : 'Your order is awaiting approval'}</Typography><Typography color="text.secondary" variant="body2">{orderLabel(success.id)} · See My orders for full details</Typography></Box><StatusChip status={success.status} /></Stack>
      <OrderTotals order={success} />
      <Alert severity={success.status === 'Confirmed' ? 'success' : 'info'}>{success.status === 'Confirmed' ? `${Math.floor(success.totalMinor / 10000)} points earned on this confirmation.` : 'No points awarded yet. Your Sales Manager will review this order.'} Current balance: {success.loyalty?.points ?? '—'} · tier: {success.loyalty?.tier ?? '—'}</Alert>
    </Stack></CardContent></Card>}
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 340px' }, gap: 3, alignItems: 'start' }}>
      <Stack spacing={2}><Box><Typography variant="h5">Product catalogue</Typography><Typography color="text.secondary" variant="body2">Choose quantities and add products to your cart.</Typography></Box>
        {!products.length && <Alert severity="info">No products in the catalogue yet.</Alert>}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
          {products.map(product => <Card key={product.id} variant="outlined" sx={{ opacity: product.availableStock === 0 ? 0.75 : 1 }}><CardContent><Stack spacing={1.5}>
            <Box><Typography variant="subtitle1" fontWeight={700}>{product.name}</Typography><Typography variant="caption" color="text.secondary">SKU {product.sku}</Typography></Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="caption" color="text.secondary">Unit price</Typography><Typography fontWeight={600}>{money(product.unitPriceMinor)}</Typography></Box><Chip size="small" label={product.availableStock > 0 ? `${product.availableStock} available` : 'Out of Stock'} color={product.availableStock > 0 ? 'default' : 'error'} /></Stack>
            <Stack direction="row" spacing={1}><TextField label="Quantity" size="small" type="number" sx={{ width: 100 }} value={quantities[product.id] ?? '1'} onChange={event => setQuantities({ ...quantities, [product.id]: event.target.value })} slotProps={{ htmlInput: { min: 1, step: 1, 'aria-label': `Quantity for ${product.name}` } }} disabled={submitting || busy || product.availableStock === 0} />
              <Button sx={{ flex: 1 }} variant="outlined" disabled={submitting || busy || product.availableStock === 0} onClick={() => add(product)}>{cart.some(line => line.productId === product.id) ? 'Update cart' : 'Add to Cart'}</Button></Stack>
          </Stack></CardContent></Card>)}
        </Box>
      </Stack>
      <Card variant="outlined" sx={{ position: { md: 'sticky' }, top: 20, borderColor: 'primary.main' }}><CardContent><Stack spacing={2}>
        <Box><Typography variant="h5">Your cart</Typography><Typography color="text.secondary" variant="body2">{cart.length} product{cart.length === 1 ? '' : 's'} · review before placing</Typography></Box>
        {!cart.length ? <Typography color="text.secondary" sx={{ py: 2 }}>Your cart is empty. Add a product to begin.</Typography> : cart.map(line => {
          const product = products.find(product => product.id === line.productId);
          return <Box key={line.productId} sx={{ pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}><Typography fontWeight={600}>{product?.name ?? 'Product'}</Typography><Typography variant="caption" color="text.secondary">{product?.sku} · {product ? money(product.unitPriceMinor) : '—'} / unit</Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}><TextField label="Quantity" type="number" size="small" sx={{ width: 105 }} value={line.quantity} disabled={submitting || busy} slotProps={{ htmlInput: { min: 1, step: 1, 'aria-label': `Cart quantity for ${product?.name ?? 'product'}` } }} onChange={event => {
              const quantity = event.target.value;
              setCart(lines => lines.map(item => item.productId === line.productId ? { ...item, quantity } : item));
            }} /><Button size="small" color="error" disabled={submitting || busy} onClick={() => setCart(lines => lines.filter(item => item.productId !== line.productId))}>Remove</Button></Stack>
          </Box>;
        })}
        <Stack spacing={1}>
          <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">Current tier</Typography><Typography>{profile?.tier ?? '—'}</Typography></Stack>
          <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">Subtotal</Typography><Typography>{validCart ? money(subtotal) : '—'}</Typography></Stack>
          <Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">Estimated discount · {discountPercent}%</Typography><Typography>{validCart ? `−${money(discount)}` : '—'}</Typography></Stack>
          <Stack direction="row" justifyContent="space-between" sx={{ pt: 1, borderTop: '1px solid', borderColor: 'divider' }}><Typography fontWeight={700}>Estimated total</Typography><Typography fontWeight={700}>{validCart ? money(subtotal - discount) : '—'}</Typography></Stack>
        </Stack>
        <Button fullWidth size="large" variant="contained" disabled={!cart.length || submitting || busy} onClick={() => void submit()}>{submitting ? 'Placing order…' : 'Place Order'}</Button>
        <Typography variant="caption" color="text.secondary">Estimates only. Final price, discount and stock are checked when your order is placed.</Typography>
      </Stack></CardContent></Card>
    </Box>
  </Stack>;
}
