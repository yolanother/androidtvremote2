import React from 'react';
import { Box } from '@mui/material';
import '../App.css';

const Panel = ({ children }) => {
  return (
    <Box className="panel">
      {children}
    </Box>
  );
};

export default Panel;