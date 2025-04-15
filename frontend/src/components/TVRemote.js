import React, { useState } from "react";
import { useMediaQuery } from "../hooks/use-media-query";
import useTVs from "../hooks/useTVs";
import RemoteHeader from "./remote/RemoteHeader";
import VoiceControls from "./remote/VoiceControls";
import TabNavigation from "./remote/TabNavigation";
import RemoteTab from "./remote/RemoteTab";
import GamepadTab from "./remote/GamepadTab";
import FunctionsTab from "./remote/FunctionsTab";
import BottomNavigation from "./remote/BottomNavigation";
import "./remote/TVRemote.css";

const TVRemote = ({ ip = "192.168.1.100" }) => {
  const [activeTab, setActiveTab] = useState("remote");
  const [activeButton, setActiveButton] = useState(null);
  const isLargeScreen = useMediaQuery("(min-width: 768px)");
  const [isPressed, setIsPressed] = useState(false);
  const { controlTV } = useTVs();

  const handleButtonPress = (buttonId, keyCode) => {
    setActiveButton(buttonId);
    setIsPressed(true);
    
    // Send the keyCode to the Android TV
    console.log(`Sending key: ${keyCode}`);
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

      {/* Remote Controls Row */}
      <TabNavigation 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onButtonPress={handleButtonPress} 
      />

      {/* Tab Content */}
      {activeTab === "remote" && (
        <RemoteTab 
          activeButton={activeButton} 
          onButtonPress={handleButtonPress} 
          isLargeScreen={isLargeScreen} 
        />
      )}

      {activeTab === "gamepad" && (
        <GamepadTab 
          activeButton={activeButton} 
          onButtonPress={handleButtonPress} 
        />
      )}

      {activeTab === "functions" && (
        <FunctionsTab 
          activeButton={activeButton} 
          onButtonPress={handleButtonPress} 
        />
      )}

      {/* Bottom Navigation */}
      <BottomNavigation 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onButtonPress={handleButtonPress} 
      />
    </div>
  );
};

export default TVRemote;
