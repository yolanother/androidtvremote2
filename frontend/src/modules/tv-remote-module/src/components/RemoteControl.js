import React, { useState } from "react";
import RemoteHeader from "./remote/RemoteHeader";
import TabNavigation from "./remote/TabNavigation";
import RemoteTab from "./remote/RemoteTab";
import BottomNavigation from "./remote/BottomNavigation";
import "../styles/RemoteControl.css";

const RemoteControl = ({
  ip,
  onCommand,
  className = "",
  showTabs = true,
  initialTab = "remote",
  tvName = "Android TV"
}) => {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [activeButton, setActiveButton] = useState(null);
  const [isPressed, setIsPressed] = useState(false);

  const handleButtonPress = (buttonId, keyCode) => {
    setActiveButton(buttonId);
    setIsPressed(true);
    
    // Send the keyCode to the Android TV
    console.log(`Sending key: ${keyCode} to TV at ${ip}`);
    
    if (typeof onCommand === 'function') {
      Promise.resolve(onCommand(ip, keyCode))
        .then(response => console.log('Command sent successfully:', response))
        .catch(error => console.error('Error sending command:', error));
    }
    
    // Simulate button press release after 150ms
    setTimeout(() => {
      setActiveButton(null);
      setIsPressed(false);
    }, 150);
  };

  return (
    <div className={`remote-container ${className}`}>
      {/* Header */}
      <RemoteHeader
        ip={ip}
        tvName={tvName}
        activeButton={activeButton}
        onButtonPress={handleButtonPress}
      />

      {/* Remote Controls Row */}
      {showTabs && (
        <TabNavigation 
          activeTab={activeTab} 
          setActiveTab={setActiveTab} 
          onButtonPress={handleButtonPress} 
        />
      )}

      {/* Main Remote Content - Responsive Layout */}
      <RemoteTab 
        activeButton={activeButton} 
        onButtonPress={handleButtonPress}
        activeTab={activeTab}
      />

      {/* Bottom Navigation */}
      <BottomNavigation 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onButtonPress={handleButtonPress} 
      />
    </div>
  );
};

export default RemoteControl;