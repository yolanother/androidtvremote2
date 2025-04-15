import React, { useState, useEffect } from 'react';
import PowerHomeButtons from './PowerHomeButtons';
import NavigationButtons from './NavigationButtons';
import DPad from './DPad';
import NumberPad from './NumberPad';
import MediaControls from './MediaControls';
import TVControls from './TVControls';
import ColorButtons from './ColorButtons';
import GamepadTab from './GamepadTab';
import FunctionsTab from './FunctionsTab';
import './RemoteTab.css';

const RemoteTab = ({ activeButton, onButtonPress }) => {
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  
  // Update window width when it changes
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };
    
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);
  
  // Determine which panels to show based on window width
  const showNumberPad = windowWidth >= 816;
  const showGamepad = windowWidth >= 1232;
  const showFunctions = windowWidth >= 1648;
  
  return (
    <div className="remote-tab">
      {/* Home and Power Buttons */}
      <PowerHomeButtons activeButton={activeButton} onButtonPress={onButtonPress} />

      {/* Menu, Back, Info Buttons */}
      <NavigationButtons activeButton={activeButton} onButtonPress={onButtonPress} />

      {/* Main Controls Section - Responsive Layout */}
      <div className="main-controls">
        {/* D-Pad Control */}
        <div className="control-panel">
          <DPad activeButton={activeButton} onButtonPress={onButtonPress} />
        </div>

        {/* Number Pad */}
        {showNumberPad && (
          <div className="control-panel">
            <NumberPad activeButton={activeButton} onButtonPress={onButtonPress} />
          </div>
        )}
        
        {/* Gamepad Controls */}
        {showGamepad && (
          <div className="control-panel">
            <GamepadTab activeButton={activeButton} onButtonPress={onButtonPress} />
          </div>
        )}
        
        {/* Function Controls */}
        {showFunctions && (
          <div className="control-panel">
            <FunctionsTab activeButton={activeButton} onButtonPress={onButtonPress} />
          </div>
        )}
      </div>

      {/* Media Controls */}
      <MediaControls activeButton={activeButton} onButtonPress={onButtonPress} />

      {/* TV Controls */}
      <TVControls activeButton={activeButton} onButtonPress={onButtonPress} />

      {/* Color Buttons */}
      <ColorButtons activeButton={activeButton} onButtonPress={onButtonPress} />
      
      {/* Show Number Pad in mobile view if not shown in main controls */}
      {!showNumberPad && (
        <div className="mobile-number-pad">
          <NumberPad activeButton={activeButton} onButtonPress={onButtonPress} />
        </div>
      )}
    </div>
  );
};

export default RemoteTab;