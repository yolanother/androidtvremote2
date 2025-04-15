import React, { useState, useEffect } from 'react';
import { Button, TextField, Typography, Box, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import useTVs from '../hooks/useTVs';

const PairTV = () => {
  const [ip, setIp] = useState('');
  const [name, setName] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [message, setMessage] = useState('');
  const [availableTvs, setAvailableTvs] = useState([]);
  const [selectedAvailableTv, setSelectedAvailableTv] = useState('');
  const { discoverAvailableTVs, addTV, pairTV, finishPairing } = useTVs();

  // Fetch TVs only once on mount
  useEffect(() => {
    fetchAvailableTvs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manual refresh handler
  const fetchAvailableTvs = () => {
    discoverAvailableTVs()
      .then((tvs) => setAvailableTvs(tvs))
      .catch(() => setAvailableTvs([]));
  };

  const handleAvailableTvChange = (e) => {
    const value = e.target.value;
    setSelectedAvailableTv(value);
    if (value === 'Manual') {
      setIp('');
      setName('');
    } else {
      const tv = availableTvs.find((tv) => tv.name === value);
      if (tv) {
        setIp(tv.addresses[0] || '');
        setName(tv.name.split('._')[0] || '');
      }
    }
  };

  const startPairing = async () => {
    setMessage('');
    try {
      // First try to add the TV
      try {
        await addTV({ ip, name: name || ip });
      } catch (addError) {
        // If error is not "TV already added", throw it
        if (!addError.message.includes('TV already added')) {
          throw new Error(`Failed to add TV: ${addError.message}`);
        }
        // Otherwise continue with pairing
      }
      
      // Start pairing process
      await pairTV(ip);
      setMessage('Pairing started. Enter the pairing code.');
    } catch (error) {
      setMessage(error.message);
    }
  };

  const handleFinishPairing = () => {
    finishPairing(ip, pairingCode)
      .then(() => setMessage('Pairing successful.'))
      .catch((error) => setMessage(`Failed to finish pairing: ${error.message}`));
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="h5" gutterBottom>
        Pair with a TV
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <FormControl fullWidth margin="normal">
          <InputLabel id="available-tvs-label">Available TVs</InputLabel>
          <Select
            labelId="available-tvs-label"
            value={selectedAvailableTv}
            onChange={handleAvailableTvChange}
          >
            {availableTvs && availableTvs.map((tv) => (
              <MenuItem key={tv.name} value={tv.name}>
                {tv.name.split('._')[0]}
              </MenuItem>
            ))}
            <MenuItem value="Manual">Manual Entry</MenuItem>
          </Select>
        </FormControl>
        <Button onClick={fetchAvailableTvs} variant="outlined" sx={{ height: '56px', minWidth: '40px' }} title="Refresh TVs">
          &#x21bb;
        </Button>
      </Box>
      {(selectedAvailableTv === 'Manual' || !selectedAvailableTv) && (
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
      <Button onClick={startPairing} variant="contained" color="primary" sx={{ mt: 2 }}>
        Start Pairing
      </Button>
      <TextField
        label="Pairing Code"
        value={pairingCode}
        onChange={(e) => setPairingCode(e.target.value)}
        fullWidth
        margin="normal"
        sx={{ mt: 2 }}
      />
      <Button onClick={handleFinishPairing} variant="contained" color="secondary" sx={{ mt: 2 }}>
        Finish Pairing
      </Button>
      {message && (
        <Typography variant="body1" color="textSecondary" sx={{ mt: 2 }}>
          {message}
        </Typography>
      )}
    </Box>
  );
};

export default PairTV;