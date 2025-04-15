import React, { useState } from 'react';
import { Drawer, List, ListItem, ListItemText, Divider, IconButton, Typography, Box } from '@mui/material';
import { Link, useLocation } from 'react-router-dom';
import TvIcon from '@mui/icons-material/Tv';
import SettingsIcon from '@mui/icons-material/Settings';
import MenuIcon from '@mui/icons-material/Menu';
import { styled } from '@mui/system';

const AnimatedDrawer = styled(Drawer)(({ theme, collapsed }) => ({
  width: collapsed ? 60 : 240,
  transition: theme.transitions.create(['width'], {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.enteringScreen,
  }),
  '& .MuiDrawer-paper': {
    width: collapsed ? 60 : 240,
    transition: theme.transitions.create(['width'], {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.enteringScreen,
    }),
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    alignItems: collapsed ? 'center' : 'flex-start',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
  },
}));

const Sidebar = () => {
  const [collapsed, setCollapsed] = useState(true);
  const location = useLocation();

  const toggleSidebar = () => {
    setCollapsed(!collapsed);
  };

  return (
    <AnimatedDrawer variant="permanent" anchor="left" className="sidebar" collapsed={collapsed}>
      <IconButton onClick={toggleSidebar} sx={{ margin: 1 }}>
        <MenuIcon />
      </IconButton>
      <List sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: collapsed ? 'center' : 'flex-start' }}>
        <ListItem
          button
          component={Link}
          to="/"
          className={location.pathname === '/' ? 'active' : ''}
        >
          <TvIcon sx={{ marginRight: collapsed ? 0 : 1 }} />
          {!collapsed && <ListItemText primary="Home" />}
        </ListItem>
        <Divider sx={{ width: '80%' }} />
        <ListItem
          button
          component={Link}
          to="/settings"
          className={location.pathname === '/settings' ? 'active' : ''}
        >
          <SettingsIcon sx={{ marginRight: collapsed ? 0 : 1 }} />
          {!collapsed && <ListItemText primary="Settings" />}
        </ListItem>
      </List>
    </AnimatedDrawer>
  );
};

export default Sidebar;