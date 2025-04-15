import React, { useState, useEffect } from 'react';
import { Button, TextField, Typography, Box, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import useTVs from '../hooks/useTVs';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:7432';

const PairTV = () => {
  const [ip, setIp] = useState('');
  const [name, setName] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [message, setMessage] = useState('');
  const [availableTvs, setAvailableTvs] = useState([]);
  const [selectedAvailableTv, setSelectedAvailableTv] = useState('');
  const { discoverAvailableTVs } = useTVs();

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
    let skipAdd = false;
    try {
      const addRes = await fetch(`${BACKEND_URL}/api/tvs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, name: name || ip })
      });
      if (!addRes.ok) {
        const err = await addRes.text();
        // If TV already added, proceed to pairing anyway
        if (err.includes('TV already added')) {
          skipAdd = true;
        } else {
          throw new Error(`Failed to add TV: ${err}`);
        }
      }
      // Always attempt to start pairing, even if add failed with 'already added'
      const pairRes = await fetch(`${BACKEND_URL}/api/tvs/${ip}/pair`, {
        method: 'POST',
      });
      if (!pairRes.ok) {
        const err = await pairRes.text();
        throw new Error(`Failed to start pairing: ${err}`);
      }
      setMessage('Pairing started. Enter the pairing code.');
    } catch (error) {
      setMessage(error.message);
    }
  };

  const finishPairing = () => {
    fetch(`${BACKEND_URL}/api/tvs/${ip}/pair`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pairing_code: pairingCode }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to finish pairing');
        }
        return response.json();
      })
      .then(() => setMessage('Pairing successful.'))
      .catch((error) => setMessage(error.message));
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
      <Button onClick={finishPairing} variant="contained" color="secondary" sx={{ mt: 2 }}>
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