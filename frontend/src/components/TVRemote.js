import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import useTVs from "../hooks/useTVs";
import { RemoteControl } from "../modules/tv-remote-module/src";
import "../modules/tv-remote-module/src/styles/RemoteControl.css";

const TVRemote = () => {
  const { ip: urlIp } = useParams();
  const [ip, setIp] = useState(urlIp || "192.168.1.100");
  const { controlTV, tvs } = useTVs();
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

  return (
    <RemoteControl
      ip={ip}
      tvName={tvName}
      onCommand={handleCommand}
    />
  );
};

export default TVRemote;
