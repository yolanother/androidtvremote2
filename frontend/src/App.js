import React from 'react';
import TVList from './components/TVList';
import AddTV from './components/AddTV';
import PairTV from './components/PairTV';
import ControlTV from './components/ControlTV';
import './App.css';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { Container, Drawer, List, ListItem, ListItemText, Divider, IconButton, Typography, Box } from '@mui/material';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import TvIcon from '@mui/icons-material/Tv';
import SettingsIcon from '@mui/icons-material/Settings';
import Sidebar from './components/Sidebar';
import Settings from './components/Settings';
import TVRemote from './components/TVRemote';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#90caf9',
    },
    secondary: {
      main: '#f48fb1',
    },
  },
});

function App() {
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Router>
        <Box sx={{ display: 'flex' }}>
          <Sidebar />
          <Box component="main" sx={{ flexGrow: 1, padding: 3 }}>
            <Routes>
              <Route path="/" element={<TVList />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/tv/:ip" element={<TVRemote />} />
            </Routes>
          </Box>
        </Box>
      </Router>
    </ThemeProvider>
  );
}

export default App;
