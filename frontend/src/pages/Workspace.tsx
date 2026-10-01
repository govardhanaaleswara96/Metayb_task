import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Tab, Tabs, Typography } from '@mui/material';
import { api, actorHeaders, apiError } from '../api/client';
import { useActor } from '../context/ActorContext';
import type { Action, Actor, Order, Product, Profile } from '../types/api';
import { Catalogue } from './Catalogue';
import { Orders } from './Orders';
import { OrderDetail } from '../components/OrderDetail';
import { money, orderLabel } from '../components/OrderPresentation';
export function Workspace({ users }: { users: Actor[] }) {
  const { actor } = useActor();
  const [tab, setTab] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [acting, setActing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  useEffect(() => {
    if (!actor) return;
    const controller = new AbortController();
    const config = { ...actorHeaders(actor.id), signal: controller.signal };
    setLoading(true); setError('');
    Promise.all([api.get<Product[]>('/products', config), api.get<Order[]>('/orders', config),
      actor.role === 'DISTRIBUTOR' ? api.get<Profile>('/distributors/me', config) : Promise.resolve(null)]).then(([catalogue, orders, profile]) => {
      if (controller.signal.aborted) return;
      setProducts(catalogue.data); setOrders(orders.data); setProfile(profile?.data ?? null); setLoaded(true);
    }).catch(error => { if (!controller.signal.aborted) setError(apiError(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [actor?.id, actor?.role, revision]);
  function refresh() { setLoading(true); setRevision(value => value + 1); }
  async function action(id: string, action: Action) {
    if (!actor) return;
    setActing(true); setError(''); setNotice('');
    try {
      const { data } = await api.post<Order>(`/orders/${id}/${action}`, {}, actorHeaders(actor.id));
      setNotice(`${orderLabel(data.id)}: ${data.status === 'PendingApproval' ? 'Pending approval' : data.status}.`);
      refresh();
    } catch (error) { setError(apiError(error)); }
    finally { setActing(false); }
  }
  if (!actor) return null;
  const busy = acting || loading;
  const manager = actor.role === 'SALES_MANAGER';
  return <Stack spacing={3}>
    <Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="h4">{manager ? 'Sales workspace' : 'Distributor workspace'}</Typography><Typography color="text.secondary">{manager ? 'Review approvals, then move orders through delivery.' : 'Choose products, review your cart and track your orders.'}</Typography></Box><Button onClick={refresh} disabled={busy}>Refresh</Button></Stack>
    {error && <Alert severity="error" action={<Button color="inherit" onClick={refresh} disabled={busy}>Retry</Button>}>{error}{loaded ? ' Displayed data may be out of date.' : ''}</Alert>}
    {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
    {profile && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2 }}>
      {[['Loyalty tier', profile.tier.charAt(0) + profile.tier.slice(1).toLowerCase()], ['Points · last 90 days', profile.points.toLocaleString()], ['Available credit', money(profile.availableCreditMinor)], ['Credit limit', money(profile.creditLimitMinor)]].map(([label, value]) => <Paper variant="outlined" key={label} sx={{ p: 2.5 }}><Typography variant="body2" color="text.secondary">{label}</Typography><Typography variant="h5" sx={{ mt: 1 }}>{value}</Typography></Paper>)}
    </Box>}
    {loading && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={20} /><Typography>Refreshing data…</Typography></Stack>}
    {loaded && <>
      {!manager && <Tabs value={tab} onChange={(_event, value: number) => setTab(value)}><Tab label="Catalogue & cart" /><Tab label="My orders" /></Tabs>}
      {!manager && <Box hidden={tab !== 0}><Catalogue products={products} profile={profile} busy={busy} onPlaced={async () => { setNotice(''); refresh(); }} /></Box>}
      {(manager || tab === 1) && <Orders orders={orders} actor={actor} users={users} busy={busy} onSelect={setDetailId} onAction={(id, actionName) => void action(id, actionName)} />}
    </>}
    {detailId && <OrderDetail key={detailId} id={detailId} actor={actor} users={users} revision={revision} profile={profile} busy={busy} actionError={error} notice={notice} onClose={() => setDetailId(null)} onAction={(id, actionName) => void action(id, actionName)} />}
  </Stack>;
}
