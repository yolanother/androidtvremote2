import React, { useState, useEffect } from 'react';
import { Drawer, List, ListItem, ListItemText, Divider, TextField, Button, Typography, Box, MenuItem, Select, InputLabel, FormControl, IconButton, CssBaseline } from '@mui/material';
import TvIcon from '@mui/icons-material/Tv';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';
import Panel from './Panel';
import { Link } from 'react-router-dom';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:7432';

const AddTV = () => {
  const [ip, setIp] = useState('');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [devices, setDevices] = useState([]);
  const [selectedTV, setSelectedTV] = useState('Settings');

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/tvs`)
      .then((response) => response.json())
      .then((data) => setDevices(data))
      .catch((error) => console.error('Error fetching devices:', error));
  }, []);

  const handleDeviceSelect = (deviceName) => {
    setSelectedTV(deviceName);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    fetch(`${BACKEND_URL}/api/tvs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ip, name, icon }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to add TV');
        }
        return response.json();
      })
      .then((data) => {
        alert(`TV added: ${data.name} (${data.ip})`);
        setIp('');
        setName('');
        setIcon('');
        setSelectedTV('Settings');
      })
      .catch((error) => alert(error.message));
  };

  return (
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />
      <Drawer
        variant="permanent"
        anchor="left"
        sx={{
          width: 240,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: 240,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            height: '100vh',
          },
        }}
      >
        <Typography variant="h6" sx={{ padding: 2 }}>
          Title
        </Typography>
        <Divider />
        <List sx={{ flexGrow: 1 }}>
          {devices.map((device, index) => (
            <ListItem button key={index} component={Link} to={`/tv/${encodeURIComponent(device.ip || device)}`}>
              <TvIcon sx={{ marginRight: 1 }} />
              <ListItemText primary={device.name || device} />
            </ListItem>
          ))}
        </List>
        <Box sx={{ mt: 'auto', mb: 2 }}>
          <Divider />
          <ListItem button component={Link} to="/settings">
            <IconButton>
              <SettingsIcon />
            </IconButton>
            <ListItemText primary="Settings" />
          </ListItem>
        </Box>
      </Drawer>
      <Box component="main" sx={{ flexGrow: 1, padding: 3 }}>
        <Panel>
          <Box sx={{ textAlign: 'center' }}>
            <Button
              variant="contained"
              color="primary"
              component={Link}
              to="/"
              sx={{ marginBottom: 2 }}
            >
              Home
            </Button>
          </Box>
          {selectedTV === 'Settings' && (
            <>
              <Typography variant="h5" gutterBottom>
                Add or Edit TV
              </Typography>
              <FormControl fullWidth margin="normal">
                <InputLabel id="device-select-label">Select Device</InputLabel>
                <Select
                  labelId="device-select-label"
                  value={selectedTV}
                  onChange={(e) => handleDeviceSelect(e.target.value)}
                >
                  <MenuItem value="Manual IP">Manual IP</MenuItem>
                  {devices.map((device) => (
                    <MenuItem key={device} value={device}>
                      {device}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {selectedTV === 'Manual IP' && (
                <TextField
                  label="IP Address"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  required
                  fullWidth
                  margin="normal"
                />
              )}
              <TextField
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                fullWidth
                margin="normal"
              />
              <TextField
                label="Icon (optional)"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                fullWidth
                margin="normal"
              />
              <Button type="submit" variant="contained" color="primary">
                Save TV
              </Button>
            </>
          )}
        </Panel>
      </Box>
    </Box>
  );
};

export default AddTV;