import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import useTVs from "../hooks/useTVs";
import RemoteHeader from "./remote/RemoteHeader";
import VoiceControls from "./remote/VoiceControls";
import RemoteTab from "./remote/RemoteTab";
import BottomNavigation from "./remote/BottomNavigation";
import "./remote/TVRemote.css";

const TVRemote = () => {
  const { ip: urlIp } = useParams();
  const [activeButton, setActiveButton] = useState(null);
  const [isPressed, setIsPressed] = useState(false);
  const { controlTV } = useTVs();
  const [ip, setIp] = useState(urlIp || "192.168.1.100");

  // Update IP if URL parameter changes
  useEffect(() => {
    if (urlIp) {
      setIp(urlIp);
    }
  }, [urlIp]);

  const handleButtonPress = (buttonId, keyCode) => {
    setActiveButton(buttonId);
    setIsPressed(true);
    
    // Send the keyCode to the Android TV
    console.log(`Sending key: ${keyCode} to TV at ${ip}`);
    controlTV(ip, keyCode)
      .then(response => console.log('Command sent successfully:', response))
      .catch(error => console.error('Error sending command:', error));
    
    // Simulate button press release after 150ms
    setTimeout(() => {
      setActiveButton(null);
      setIsPressed(false);
    }, 150);
  };

  return (
    <div className="remote-container">
      {/* Header */}
      <RemoteHeader 
        ip={ip} 
        activeButton={activeButton} 
        onButtonPress={handleButtonPress} 
      />

      {/* Voice Search / Assist */}
      <VoiceControls 
        activeButton={activeButton} 
        onButtonPress={handleButtonPress} 
      />

      {/* Main Remote Content - Responsive Layout */}
      <RemoteTab 
        activeButton={activeButton} 
        onButtonPress={handleButtonPress} 
      />
    </div>
  );
};

export default TVRemote;
