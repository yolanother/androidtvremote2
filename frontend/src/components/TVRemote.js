import React, { useState } from 'react';
import { Box, Button, Grid, Typography, Paper, Container } from '@mui/material';
import { useParams } from 'react-router-dom';
import Panel from './Panel';

const TVRemote = () => {
  const { ip } = useParams();
  const [message, setMessage] = useState('');
  const sendCommand = (command) => {
    fetch(`/api/tvs/${ip}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    })
      .then((response) => response.json())
      .then((data) => setMessage(data.message || data.error || ''))
      .catch((error) => setMessage(error.message));
  };

  // D-Pad layout (bigger buttons, correct order)
  const renderDPad = () => (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', mb: 2 }}>
      <Box sx={{ width: 240 }}>
        <Grid container spacing={2}>
          <Grid item xs={4}></Grid>
          <Grid item xs={4}><Button fullWidth variant="contained" size="large" sx={{ borderRadius: '50%', height: 64, fontSize: 32 }} onClick={() => sendCommand('DPAD_UP')}>▲</Button></Grid>
          <Grid item xs={4}></Grid>

          <Grid item xs={4}><Button fullWidth variant="contained" size="large" sx={{ borderRadius: '50%', height: 64, fontSize: 32 }} onClick={() => sendCommand('DPAD_LEFT')}>◀</Button></Grid>
          <Grid item xs={4}><Button fullWidth variant="contained" size="large" sx={{ borderRadius: '50%', height: 64, fontSize: 28 }} onClick={() => sendCommand('DPAD_CENTER')}>OK</Button></Grid>
          <Grid item xs={4}><Button fullWidth variant="contained" size="large" sx={{ borderRadius: '50%', height: 64, fontSize: 32 }} onClick={() => sendCommand('DPAD_RIGHT')}>▶</Button></Grid>

          <Grid item xs={4}></Grid>
          <Grid item xs={4}><Button fullWidth variant="contained" size="large" sx={{ borderRadius: '50%', height: 64, fontSize: 32 }} onClick={() => sendCommand('DPAD_DOWN')}>▼</Button></Grid>
          <Grid item xs={4}></Grid>
        </Grid>
      </Box>
    </Box>
  );

  // Number pad (bigger buttons)
  const renderNumPad = () => (
    <Box sx={{ mb: 2 }}>
      <Grid container spacing={2} justifyContent="center">
        {[1,2,3,4,5,6,7,8,9].map(n => (
          <Grid item xs={4} key={n}><Button fullWidth variant="outlined" size="large" sx={{ height: 64, fontSize: 28 }} onClick={() => sendCommand(String(n))}>{n}</Button></Grid>
        ))}
        <Grid item xs={4}><Button fullWidth variant="outlined" size="large" sx={{ height: 64, fontSize: 24 }} onClick={() => sendCommand('DEL')}>Del</Button></Grid>
        <Grid item xs={4}><Button fullWidth variant="outlined" size="large" sx={{ height: 64, fontSize: 28 }} onClick={() => sendCommand('0')}>0</Button></Grid>
        <Grid item xs={4}><Button fullWidth variant="outlined" size="large" sx={{ height: 64, fontSize: 24 }} onClick={() => sendCommand('ENTER')}>Enter</Button></Grid>
      </Grid>
    </Box>
  );

  return (
    <>
      <Panel>
        <Container maxWidth="xs" sx={{ pt: 2 }}>
          <Typography variant="h5" align="center" gutterBottom>Remote Control</Typography>
          <Typography variant="subtitle2" align="center" gutterBottom>TV IP: {ip}</Typography>
          {/* Power at top */}
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
            <Button variant="contained" color="error" size="large" sx={{ minWidth: 100, height: 64, fontSize: 28, boxShadow: '0 4px 12px #c62828', background: 'linear-gradient(180deg, #ff5252 0%, #b71c1c 100%)' }} onClick={() => sendCommand('POWER')}>Power</Button>
          </Box>
          {/* Volume/Channel and D-Pad Row */}
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', mb: 2 }}>
            {/* Volume */}
            <Box sx={{ mr: 2 }}>
              <Grid container direction="column" spacing={2}>
                <Grid item><Button variant="contained" sx={{ borderRadius: '50%', height: 64, fontSize: 22, background: 'linear-gradient(180deg, #90caf9 0%, #1565c0 100%)', color: '#fff', boxShadow: '0 2px 8px #1976d2' }} onClick={() => sendCommand('VOLUME_UP')}>Vol +</Button></Grid>
                <Grid item><Button variant="contained" sx={{ borderRadius: '50%', height: 64, fontSize: 22, background: 'linear-gradient(180deg, #bdbdbd 0%, #616161 100%)', color: '#fff', boxShadow: '0 2px 8px #757575' }} onClick={() => sendCommand('MUTE')}>Mute</Button></Grid>
                <Grid item><Button variant="contained" sx={{ borderRadius: '50%', height: 64, fontSize: 22, background: 'linear-gradient(180deg, #90caf9 0%, #1565c0 100%)', color: '#fff', boxShadow: '0 2px 8px #1976d2' }} onClick={() => sendCommand('VOLUME_DOWN')}>Vol -</Button></Grid>
              </Grid>
            </Box>
            {/* D-Pad and nav */}
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                <Button variant="outlined" sx={{ minWidth: 90, height: 48, mr: 2, borderRadius: '20px', fontSize: 20, background: 'linear-gradient(180deg, #fffde7 0%, #ffe082 100%)', color: '#795548', fontWeight: 'bold' }} onClick={() => sendCommand('HOME')}>Home</Button>
                <Button variant="outlined" sx={{ minWidth: 90, height: 48, borderRadius: '20px', fontSize: 20, background: 'linear-gradient(180deg, #fce4ec 0%, #f06292 100%)', color: '#ad1457', fontWeight: 'bold' }} onClick={() => sendCommand('BACK')}>Back</Button>
              </Box>
              {renderDPad()}
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                <Button variant="outlined" sx={{ minWidth: 90, height: 48, mr: 2, borderRadius: '20px', fontSize: 20, background: 'linear-gradient(180deg, #e3f2fd 0%, #90caf9 100%)', color: '#1976d2', fontWeight: 'bold' }} onClick={() => sendCommand('MENU')}>Menu</Button>
                <Button variant="outlined" sx={{ minWidth: 90, height: 48, borderRadius: '20px', fontSize: 20, background: 'linear-gradient(180deg, #f3e5f5 0%, #ce93d8 100%)', color: '#6a1b9a', fontWeight: 'bold' }} onClick={() => sendCommand('INFO')}>Info</Button>
              </Box>
            </Box>
            {/* Channel */}
            <Box sx={{ ml: 2 }}>
              <Grid container direction="column" spacing={2}>
                <Grid item><Button variant="contained" sx={{ borderRadius: '50%', height: 64, fontSize: 22, background: 'linear-gradient(180deg, #a5d6a7 0%, #388e3c 100%)', color: '#fff', boxShadow: '0 2px 8px #388e3c' }} onClick={() => sendCommand('CHANNEL_UP')}>Ch +</Button></Grid>
                <Grid item><Box sx={{ height: 64 }} /></Grid>
                <Grid item><Button variant="contained" sx={{ borderRadius: '50%', height: 64, fontSize: 22, background: 'linear-gradient(180deg, #a5d6a7 0%, #388e3c 100%)', color: '#fff', boxShadow: '0 2px 8px #388e3c' }} onClick={() => sendCommand('CHANNEL_DOWN')}>Ch -</Button></Grid>
              </Grid>
            </Box>
          </Box>
          {/* Color keys */}
          <Grid container spacing={2} sx={{ mb: 2, mt: 1 }}>
            <Grid item xs={3}><Button fullWidth variant="contained" sx={{ height: 56, fontSize: 18, background: 'linear-gradient(180deg, #ff8a80 0%, #d32f2f 100%)', color: '#fff', boxShadow: '0 2px 8px #d32f2f' }} onClick={() => sendCommand('PROG_RED')}>Red</Button></Grid>
            <Grid item xs={3}><Button fullWidth variant="contained" sx={{ height: 56, fontSize: 18, background: 'linear-gradient(180deg, #b9f6ca 0%, #388e3c 100%)', color: '#fff', boxShadow: '0 2px 8px #388e3c' }} onClick={() => sendCommand('PROG_GREEN')}>Green</Button></Grid>
            <Grid item xs={3}><Button fullWidth variant="contained" sx={{ height: 56, fontSize: 18, background: 'linear-gradient(180deg, #fff59d 0%, #fbc02d 100%)', color: '#fff', boxShadow: '0 2px 8px #fbc02d' }} onClick={() => sendCommand('PROG_YELLOW')}>Yellow</Button></Grid>
            <Grid item xs={3}><Button fullWidth variant="contained" sx={{ height: 56, fontSize: 18, background: 'linear-gradient(180deg, #82b1ff 0%, #1976d2 100%)', color: '#fff', boxShadow: '0 2px 8px #1976d2' }} onClick={() => sendCommand('PROG_BLUE')}>Blue</Button></Grid>
          </Grid>
          {/* Media controls */}
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={4}><Button fullWidth variant="contained" sx={{ height: 56, fontSize: 18, borderRadius: '20px', background: 'linear-gradient(180deg, #e0e0e0 0%, #757575 100%)', color: '#fff' }} onClick={() => sendCommand('MEDIA_PREVIOUS')}>Prev</Button></Grid>
            <Grid item xs={4}><Button fullWidth variant="contained" sx={{ height: 56, fontSize: 18, borderRadius: '20px', background: 'linear-gradient(180deg, #b2dfdb 0%, #0097a7 100%)', color: '#fff' }} onClick={() => sendCommand('MEDIA_PLAY_PAUSE')}>Play/Pause</Button></Grid>
            <Grid item xs={4}><Button fullWidth variant="contained" sx={{ height: 56, fontSize: 18, borderRadius: '20px', background: 'linear-gradient(180deg, #e0e0e0 0%, #757575 100%)', color: '#fff' }} onClick={() => sendCommand('MEDIA_NEXT')}>Next</Button></Grid>
            <Grid item xs={4}><Button fullWidth variant="contained" sx={{ height: 56, fontSize: 18, borderRadius: '20px', background: 'linear-gradient(180deg, #ffe0b2 0%, #f57c00 100%)', color: '#fff' }} onClick={() => sendCommand('MEDIA_REWIND')}>Rew</Button></Grid>
            <Grid item xs={4}><Button fullWidth variant="contained" sx={{ height: 56, fontSize: 18, borderRadius: '20px', background: 'linear-gradient(180deg, #f8bbd0 0%, #c2185b 100%)', color: '#fff' }} onClick={() => sendCommand('MEDIA_STOP')}>Stop</Button></Grid>
            <Grid item xs={4}><Button fullWidth variant="contained" sx={{ height: 56, fontSize: 18, borderRadius: '20px', background: 'linear-gradient(180deg, #ffe0b2 0%, #f57c00 100%)', color: '#fff' }} onClick={() => sendCommand('MEDIA_FAST_FORWARD')}>FF</Button></Grid>
            <Grid item xs={4}><Button fullWidth variant="contained" sx={{ height: 56, fontSize: 18, borderRadius: '20px', background: 'linear-gradient(180deg, #d1c4e9 0%, #512da8 100%)', color: '#fff' }} onClick={() => sendCommand('MEDIA_RECORD')}>Rec</Button></Grid>
          </Grid>
          {message && (
            <Typography align="center" color="textSecondary" sx={{ mt: 2 }}>{message}</Typography>
          )}
        </Container>
      </Panel>
      <Panel>
        <Container maxWidth="xs" sx={{ pt: 2 }}>
          <Typography variant="h6" align="center" gutterBottom>Number Pad & Utilities</Typography>
          {renderNumPad()}
          {/* Bottom row: Guide, TV, Captions, Settings, DVR */}
          <Grid container spacing={2} sx={{ mb: 1 }}>
            <Grid item xs={4}><Button fullWidth variant="outlined" sx={{ height: 56, fontSize: 18, borderRadius: '20px', background: 'linear-gradient(180deg, #fffde7 0%, #ffe082 100%)', color: '#795548', fontWeight: 'bold' }} onClick={() => sendCommand('GUIDE')}>Guide</Button></Grid>
            <Grid item xs={4}><Button fullWidth variant="outlined" sx={{ height: 56, fontSize: 18, borderRadius: '20px', background: 'linear-gradient(180deg, #e3f2fd 0%, #90caf9 100%)', color: '#1976d2', fontWeight: 'bold' }} onClick={() => sendCommand('TV')}>TV</Button></Grid>
            <Grid item xs={4}><Button fullWidth variant="outlined" sx={{ height: 56, fontSize: 18, borderRadius: '20px', background: 'linear-gradient(180deg, #f3e5f5 0%, #ce93d8 100%)', color: '#6a1b9a', fontWeight: 'bold' }} onClick={() => sendCommand('CAPTIONS')}>CC</Button></Grid>
            <Grid item xs={4}><Button fullWidth variant="outlined" sx={{ height: 56, fontSize: 18, borderRadius: '20px', background: 'linear-gradient(180deg, #f3e5f5 0%, #ce93d8 100%)', color: '#6a1b9a', fontWeight: 'bold' }} onClick={() => sendCommand('SETTINGS')}>Settings</Button></Grid>
            <Grid item xs={4}><Button fullWidth variant="outlined" sx={{ height: 56, fontSize: 18, borderRadius: '20px', background: 'linear-gradient(180deg, #f3e5f5 0%, #ce93d8 100%)', color: '#6a1b9a', fontWeight: 'bold' }} onClick={() => sendCommand('DVR')}>DVR</Button></Grid>
          </Grid>
        </Container>
      </Panel>
    </>
  );
};

export default TVRemote;
