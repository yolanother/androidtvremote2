import React, { useState, useEffect } from "react";
import RemoteHeader from "./remote/RemoteHeader";
import TabNavigation from "./remote/TabNavigation";
import RemoteTab from "./remote/RemoteTab";
import BottomNavigation from "./remote/BottomNavigation";
import PairingView from "./PairingView";
import useRemoteControl from "../hooks/useRemoteControl";
import "../styles/RemoteControl.css";

const RemoteControl = ({
  ip,
  onCommand,
  className = "",
  showTabs = true,
  initialTab = "remote",
  tvName = "Android TV",
  apiBaseUrl = "/api",
  customFetchApi = null
}) => {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [activeButton, setActiveButton] = useState(null);
  const [isPressed, setIsPressed] = useState(false);

  // Use the remote control hook
  const {
    isPaired,
    isConnected,
    isPairing,
    error,
    tvInfo,
    sendCommand,
    checkConnection,
    startPairing,
    finishPairing
  } = useRemoteControl(ip, apiBaseUrl, customFetchApi);

  // Use the TV name from tvInfo if available
  const displayName = tvInfo?.name || tvName;

  const handleButtonPress = (buttonId, keyCode) => {
    setActiveButton(buttonId);
    setIsPressed(true);
    
    // Send the keyCode to the Android TV
    console.log(`Sending key: ${keyCode} to TV at ${ip}`);
    
    if (typeof onCommand === 'function') {
      // Use the provided onCommand function if available
      Promise.resolve(onCommand(ip, keyCode))
        .then(response => console.log('Command sent successfully:', response))
        .catch(error => console.error('Error sending command:', error));
    } else {
      // Otherwise use the hook's sendCommand function
      sendCommand(keyCode)
        .then(response => console.log('Command sent successfully:', response))
        .catch(error => console.error('Error sending command:', error));
    }
    
    // Simulate button press release after 150ms
    setTimeout(() => {
      setActiveButton(null);
      setIsPressed(false);
    }, 150);
  };

  // Check connection when component mounts or IP changes
  useEffect(() => {
    if (ip) {
      checkConnection();
    }
  }, [ip, checkConnection]);

  // If not paired, show the pairing view
  if (!isPaired) {
    return (
      <PairingView
        ip={ip}
        onPairingComplete={checkConnection}
        onStartPairing={startPairing}
        onFinishPairing={finishPairing}
        isPairing={isPairing}
        error={error}
      />
    );
  }

  // If not connected, show an error message
  if (!isConnected) {
    return (
      <div className={`remote-container ${className} error-container`}>
        <div className="connection-error">
          <h2>Connection Error</h2>
          <p>Unable to connect to TV at {ip}</p>
          <p className="error-details">{error}</p>
          <button 
            className="retry-button"
            onClick={checkConnection}
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  // Otherwise show the remote control
  return (
    <div className={`remote-container ${className}`}>
      {/* Header */}
      <RemoteHeader
        ip={ip}
        tvName={displayName}
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