import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import useTVs from "../hooks/useTVs";
import { RemoteControl, useRemoteControl } from "../modules/tv-remote-module/src";
import "../modules/tv-remote-module/src/styles/RemoteControl.css";

const TVRemote = () => {
  const { ip: urlIp } = useParams();
  const [ip, setIp] = useState(urlIp || "192.168.1.100");
  const { controlTV, tvs, pairTV, finishPairing } = useTVs();
  const [tvName, setTvName] = useState('Android TV');

  // Update IP if URL parameter changes
  useEffect(() => {
    if (urlIp) {
      setIp(urlIp);
    }
  }, [urlIp]);

  // Get TV name from the list of TVs
  useEffect(() => {
    if (tvs && tvs.length > 0 && ip) {
      const foundTV = tvs.find(tv => tv.ip === ip);
      if (foundTV) {
        setTvName(foundTV.name || 'Android TV');
      } else {
        setTvName('Android TV');
      }
    }
  }, [tvs, ip]);

  const handleCommand = (ip, command) => {
    // Send the keyCode to the Android TV
    console.log(`Sending key: ${command} to TV at ${ip}`);
    return controlTV(ip, command)
      .then(response => {
        console.log('Command sent successfully:', response);
        return response;
      })
      .catch(error => {
        console.error('Error sending command:', error);
        throw error;
      });
  };

  // Custom fetch API implementation that uses our existing useTVs hook
  const customFetchApi = async (url, options = {}) => {
    // Extract the endpoint and parameters from the URL
    const urlParts = url.split('/');
    const endpoint = urlParts[urlParts.length - 1];
    const tvIp = urlParts[urlParts.length - 2];
    
    // Handle different API endpoints
    if (endpoint === 'control' && options.method === 'POST') {
      const { command } = JSON.parse(options.body);
      return controlTV(tvIp, command);
    } else if (endpoint === 'pair') {
      if (options.method === 'POST') {
        return pairTV(tvIp);
      } else if (options.method === 'PUT') {
        const { pairing_code } = JSON.parse(options.body);
        return finishPairing(tvIp, pairing_code);
      }
    }
    
    // Default fallback to regular fetch
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  };

  return (
    <RemoteControl
      ip={ip}
      tvName={tvName}
      onCommand={handleCommand}
      customFetchApi={customFetchApi}
    />
  );
};

export default TVRemote;
