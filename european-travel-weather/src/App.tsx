import React from 'react';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import WeatherForecast from './components/WeatherForecast';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  },
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <WeatherForecast />
    </ThemeProvider>
  );
}

export default App;
