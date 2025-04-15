import React from 'react';
import PowerHomeButtons from './PowerHomeButtons';
import NavigationButtons from './NavigationButtons';
import DPad from './DPad';
import NumberPad from './NumberPad';
import MediaControls from './MediaControls';
import TVControls from './TVControls';
import ColorButtons from './ColorButtons';
import './RemoteTab.css';

const RemoteTab = ({ activeButton, onButtonPress, isLargeScreen }) => {
  return (
    <div className="remote-tab">
      {/* Home and Power Buttons */}
      <PowerHomeButtons activeButton={activeButton} onButtonPress={onButtonPress} />

      {/* Menu, Back, Info Buttons */}
      <NavigationButtons activeButton={activeButton} onButtonPress={onButtonPress} />

      {/* Main Controls Section - Responsive Layout */}
      <div className={`main-controls ${isLargeScreen ? "desktop" : "mobile"}`}>
        {/* D-Pad Control */}
        <DPad activeButton={activeButton} onButtonPress={onButtonPress} isLargeScreen={isLargeScreen} />

        {/* Number Pad - Only visible on larger screens */}
        {isLargeScreen && <NumberPad activeButton={activeButton} onButtonPress={onButtonPress} />}
      </div>

      {/* Media Controls */}
      <MediaControls activeButton={activeButton} onButtonPress={onButtonPress} />

      {/* TV Controls */}
      <TVControls activeButton={activeButton} onButtonPress={onButtonPress} />

      {/* Color Buttons */}
      <ColorButtons activeButton={activeButton} onButtonPress={onButtonPress} />
    </div>
  );
};

export default RemoteTab;