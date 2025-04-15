import React, { useState, useEffect } from 'react';
import { AppBar, Tabs, Tab, Toolbar, Box, Typography, Button, TextField, List, ListItem, ListItemText, Divider, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import Panel from './Panel';
import useTVs from '../hooks/useTVs';
import AddTV from './AddTV';
import PairTV from './PairTV';

const Settings = () => {
  const [tabIndex, setTabIndex] = useState(0);
  const [ip, setIp] = useState('');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [tvs, setTvs] = useState([]); // Ensure tvs is initialized as an empty array
  const [availableTvs, setAvailableTvs] = useState([]); // Ensure availableTvs is initialized as an empty array
  const [selectedAvailableTv, setSelectedAvailableTv] = useState('');
  const { addTV, discoverAvailableTVs } = useTVs();

  useEffect(() => {
    discoverAvailableTVs()
      .then((availableTvs) => {
        console.log('Available TVs:', availableTvs); // Debugging log
        setAvailableTvs(availableTvs);
      })
      .catch((error) => console.error('Error fetching available TVs:', error));
  }, []);

  const handleTabChange = (event, newValue) => {
    if (tvs.length === 0 && newValue === 0) {
      setTabIndex(1); // Adjust tabIndex to point to the correct tab when 'Current TVs' is not available
    } else {
      setTabIndex(newValue);
    }
  };

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar position="static" color="default" sx={{ margin: 0, padding: 0 }}>
        <Toolbar>
          <Tabs
            value={tvs.length === 0 && tabIndex === 1 ? 0 : tabIndex} // Adjust tabIndex dynamically
            onChange={handleTabChange}
            centered
            TabIndicatorProps={{ style: { backgroundColor: 'rgba(255, 255, 255, 0.2)' } }}
          >
            {(tvs?.length > 0) && (
              <Tab label="Current TVs" sx={{ backgroundColor: tabIndex === 0 ? 'rgba(255, 255, 255, 0.2)' : 'transparent' }} />
            )}
            <Tab label="Add TV" sx={{ backgroundColor: tabIndex === 1 ? 'rgba(255, 255, 255, 0.2)' : 'transparent' }} />
          </Tabs>
        </Toolbar>
      </AppBar>
      <Box sx={{ padding: 3 }}>
        <Panel>
          {tabIndex === 0 && tvs.length > 0 && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Current TVs
              </Typography>
              <List>
                {tvs.map((tv) => (
                  <ListItem key={tv.ip}>
                    <ListItemText primary={tv.name} secondary={tv.ip} />
                  </ListItem>
                ))}
                <Divider />
              </List>
            </Box>
          )}

          {(tabIndex === 1 || tvs.length === 0) && (
            <PairTV />
          )}
        </Panel>
      </Box>
    </Box>
  );
};

export default Settings;