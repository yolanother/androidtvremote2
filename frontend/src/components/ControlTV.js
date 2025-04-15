import React, { useState } from 'react';
import { Button, TextField, Typography, Box } from '@mui/material';

const ControlTV = () => {
  const [ip, setIp] = useState('');
  const [command, setCommand] = useState('');
  const [message, setMessage] = useState('');

  const sendCommand = () => {
    fetch(`/api/tvs/${ip}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to send command');
        }
        return response.json();
      })
      .then(() => setMessage('Command sent successfully.'))
      .catch((error) => setMessage(error.message));
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="h5" gutterBottom>
        Control a TV
      </Typography>
      <TextField
        label="IP Address"
        value={ip}
        onChange={(e) => setIp(e.target.value)}
        required
        fullWidth
        margin="normal"
      />
      <TextField
        label="Command"
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        required
        fullWidth
        margin="normal"
        sx={{ mt: 2 }}
      />
      <Button onClick={sendCommand} variant="contained" color="primary" sx={{ mt: 2 }}>
        Send Command
      </Button>
      {message && (
        <Typography variant="body1" color="textSecondary" sx={{ mt: 2 }}>
          {message}
        </Typography>
      )}
    </Box>
  );
};

export default ControlTV;