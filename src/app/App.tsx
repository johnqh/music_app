import { useMemo, useState } from 'react';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import CssBaseline from '@mui/material/CssBaseline';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { ThemeProvider } from '@mui/material/styles';
import { type ColorSchemeMode, createAppTheme, resolveColorScheme } from '@/app/theme';

export function App() {
  // Manual override placeholder: defaults to following the system
  // preference until a settings UI wires this to user input.
  const [colorSchemeMode] = useState<ColorSchemeMode>('system');
  const theme = useMemo(
    () => createAppTheme(resolveColorScheme(colorSchemeMode)),
    [colorSchemeMode],
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <AppBar position="static" color="primary" enableColorOnDark>
          <Toolbar>
            <Typography variant="h6" component="h1" noWrap>
              ScoreSmith
            </Typography>
          </Toolbar>
        </AppBar>
        <Box component="main" sx={{ flex: 1, overflow: 'auto' }} />
      </Box>
    </ThemeProvider>
  );
}
