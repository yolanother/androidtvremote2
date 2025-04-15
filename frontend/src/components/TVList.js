import React from 'react';
import { Typography, Button, Grid, Box } from '@mui/material';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { Link } from 'react-router-dom';
import Panel from './Panel';
import useTVs from '../hooks/useTVs';

const TVList = () => {
  const { tvs, controlTV } = useTVs();

  const handlePower = (ip) => {
    controlTV(ip, 'POWER')
      .catch((error) => console.error('Error sending power command:', error));
  };

  const handleMute = (ip) => {
    controlTV(ip, 'MUTE')
      .catch((error) => console.error('Error sending mute command:', error));
  };

  return (
    <Box className="content">
      {tvs.length === 0 ? (
        <Panel>
          <Typography variant="h4" gutterBottom>
            Welcome to Android TV Remote
          </Typography>
          <Typography variant="body1" gutterBottom>
            You haven't paired any TVs yet.
          </Typography>
          <Button
            variant="contained"
            color="primary"
            component={Link}
            to="/settings"
          >
            Pair a New TV
          </Button>
        </Panel>
      ) : (
        <Grid container spacing={3}>
          {tvs.map((tv, index) => (
            <Grid item xs={12} sm={6} md={4} key={index}>
              <Link to={`/tv/${encodeURIComponent(tv.ip)}`} style={{ textDecoration: 'none' }}>
                <Panel sx={{ cursor: 'pointer' }}>
                  <Typography className="card-title" gutterBottom>
                    {tv.name}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    IP: {tv.ip}
                  </Typography>
                  <Box className="card-actions">
                    <Button
                      variant="contained"
                      color="primary"
                      startIcon={<PowerSettingsNewIcon />}
                      onClick={e => { e.preventDefault(); handlePower(tv.ip); }}
                    >
                      Power
                    </Button>
                    <Button
                      variant="contained"
                      color="secondary"
                      startIcon={<VolumeOffIcon />}
                      onClick={e => { e.preventDefault(); handleMute(tv.ip); }}
                    >
                      Mute
                    </Button>
                  </Box>
                </Panel>
              </Link>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
};

export default TVList;