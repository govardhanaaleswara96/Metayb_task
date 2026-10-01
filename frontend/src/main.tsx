import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createTheme, CssBaseline, ThemeProvider } from '@mui/material';
import { ActorProvider } from './context/ActorContext';
import { App } from './App';
const theme = createTheme({ palette: { primary: { main: '#245c73' }, background: { default: '#f5f7fa' } }, shape: { borderRadius: 12 }, components: { MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { fontWeight: 600 } } }, MuiCard: { styleOverrides: { root: { borderColor: '#e1e6ed' } } }, MuiTableCell: { styleOverrides: { head: { backgroundColor: '#f5f7fa', fontWeight: 600 } } } }, typography: { fontFamily: 'Inter, system-ui, sans-serif', button: { textTransform: 'none' } } });
createRoot(document.getElementById('root')!).render(<StrictMode><ThemeProvider theme={theme}><CssBaseline /><ActorProvider><App /></ActorProvider></ThemeProvider></StrictMode>);
