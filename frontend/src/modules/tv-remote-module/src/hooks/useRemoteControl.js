import { useState, useEffect, useCallback } from 'react';

// Default fetch API implementation
const defaultFetchApi = async (url, options = {}) => {
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error in fetchApi:', error);
    throw error;
  }
};

const useRemoteControl = (
  ip, 
  apiBaseUrl = '/api', 
  customFetchApi = defaultFetchApi
) => {
  const [isPaired, setIsPaired] = useState(true);
  const [isConnected, setIsConnected] = useState(true);
  const [isPairing, setIsPairing] = useState(false);
  const [error, setError] = useState(null);
  const [tvInfo, setTvInfo] = useState(null);

  // Function to check if the TV is paired and connected
  const checkConnection = useCallback(async () => {
    try {
      // Try to send a simple command (like POWER) to check if the TV is connected and paired
      await customFetchApi(`${apiBaseUrl}/tvs/${ip}/control`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command: 'HOME' }),
      });
      
      setIsConnected(true);
      setIsPaired(true);
      setError(null);
      return true;
    } catch (error) {
      console.error('Connection check failed:', error);
      
      // Check if the error is due to pairing issues
      if (error.message.includes('not paired') || error.message.includes('pairing')) {
        setIsPaired(false);
        setIsConnected(true); // We can connect, just not paired
      } else if (error.message.includes('connect') || error.message.includes('network')) {
        setIsConnected(false);
        setIsPaired(false); // Can't determine pairing status if not connected
      }
      
      setError(error.message);
      return false;
    }
  }, [ip, apiBaseUrl, customFetchApi]);

  // Function to send a command to the TV
  const sendCommand = useCallback(async (command) => {
    try {
      // First check if we're connected and paired
      if (!isConnected || !isPaired) {
        const connectionStatus = await checkConnection();
        if (!connectionStatus) {
          throw new Error('TV is not connected or paired');
        }
      }
      
      // Send the command
      const result = await customFetchApi(`${apiBaseUrl}/tvs/${ip}/control`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command }),
      });
      
      return result;
    } catch (error) {
      console.error('Error sending command:', error);
      
      // If we get an error, check the connection again
      await checkConnection();
      throw error;
    }
  }, [ip, apiBaseUrl, customFetchApi, isConnected, isPaired, checkConnection]);

  // Function to start the pairing process
  const startPairing = useCallback(async () => {
    try {
      setIsPairing(true);
      await customFetchApi(`${apiBaseUrl}/tvs/${ip}/pair`, {
        method: 'POST',
      });
      return true;
    } catch (error) {
      console.error('Error starting pairing:', error);
      setError(error.message);
      return false;
    }
  }, [ip, apiBaseUrl, customFetchApi]);

  // Function to complete the pairing process with a code
  const finishPairing = useCallback(async (pairingCode) => {
    try {
      const result = await customFetchApi(`${apiBaseUrl}/tvs/${ip}/pair`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pairing_code: pairingCode }),
      });
      
      setIsPaired(true);
      setIsPairing(false);
      setError(null);
      
      // Check connection after pairing
      await checkConnection();
      
      return result;
    } catch (error) {
      console.error('Error finishing pairing:', error);
      setError(error.message);
      setIsPairing(false);
      return false;
    }
  }, [ip, apiBaseUrl, customFetchApi, checkConnection]);

  // Function to get TV information
  const getTvInfo = useCallback(async () => {
    try {
      const info = await customFetchApi(`${apiBaseUrl}/tvs/${ip}`);
      setTvInfo(info);
      return info;
    } catch (error) {
      console.error('Error getting TV info:', error);
      setError(error.message);
      return null;
    }
  }, [ip, apiBaseUrl, customFetchApi]);

  // Check connection when the component mounts or IP changes
  useEffect(() => {
    if (ip) {
      checkConnection();
      getTvInfo();
    }
  }, [ip, checkConnection, getTvInfo]);

  return {
    isPaired,
    isConnected,
    isPairing,
    error,
    tvInfo,
    sendCommand,
    checkConnection,
    startPairing,
    finishPairing,
    getTvInfo
  };
};

export default useRemoteControl;