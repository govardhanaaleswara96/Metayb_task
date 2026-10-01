import { useEffect, useState } from 'react';
import { Alert, AppBar, Box, Chip, Button, CircularProgress, Container, FormControl, InputLabel, MenuItem, Select, Stack, Toolbar, Typography } from '@mui/material';
import { api, apiError } from './api/client';
import { useActor } from './context/ActorContext';
import type { Actor } from './types/api';
import { Workspace } from './pages/Workspace';
export function App() {
  const { actor, selectActor } = useActor();
  const [users, setUsers] = useState<Actor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api.get<Actor[]>('/users', { signal: controller.signal }).then(({ data }) => {
      if (controller.signal.aborted) return;
      setUsers(data);
      if (data.length) selectActor(data.find(user => user.role === 'DISTRIBUTOR') ?? data[0]);
    }).catch(error => { if (!controller.signal.aborted) setError(apiError(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry, selectActor]);
  return <>
    <AppBar position="static" elevation={0}><Toolbar sx={{ gap: 2, flexWrap: 'wrap', py: 1 }}><Typography variant="h6" sx={{ flex: 1, minWidth: 180 }}>Distributor Orders</Typography><Stack direction="row" spacing={1.5} alignItems="center">{actor && <><Typography fontWeight={600}>{actor.name}</Typography><Chip size="small" label={actor.role === 'SALES_MANAGER' ? 'Sales Manager' : 'Distributor'} sx={{ bgcolor: 'rgba(255,255,255,.16)', color: 'white' }} /></>}</Stack></Toolbar></AppBar>
    <Container maxWidth="lg" sx={{ py: 3 }}><Stack spacing={3}>
      {loading ? <CircularProgress aria-label="Loading actors" /> : error ? <Alert severity="error" action={<Button color="inherit" onClick={() => setRetry(value => value + 1)}>Retry</Button>}>{error}</Alert> : !users.length ? <Alert severity="info">No users found. Run the database seed to begin.</Alert> : <Box sx={{ maxWidth: 400 }}><FormControl fullWidth size="small"><InputLabel id="actor-label">Switch demo user</InputLabel><Select labelId="actor-label" label="Switch demo user" value={actor?.id ?? ''} onChange={event => {
        const selected = users.find(user => user.id === event.target.value);
        if (selected) selectActor(selected);
      }}>{users.map(user => <MenuItem key={user.id} value={user.id}>{user.name} · {user.role === 'SALES_MANAGER' ? 'Sales Manager' : 'Distributor'}</MenuItem>)}</Select></FormControl></Box>}
      {actor && <Workspace key={actor.id} users={users} />}
    </Stack></Container>
  </>;
}
