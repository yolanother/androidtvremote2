import React, { useState, useEffect } from 'react';
import { Settings } from 'lucide-react';
import useTVs from '../../hooks/useTVs';
import './RemoteHeader.css';

const RemoteHeader = ({ ip, activeButton, onButtonPress }) => {
  const [tvName, setTvName] = useState('');
  const { tvs } = useTVs();

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

  return (
    <div className="remote-header">
      <div className="remote-header-left">
        <div className="remote-header-logo">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="7" width="20" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M17 3L12 7L7 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <span className="remote-header-title">{tvName} - {ip}</span>
      </div>
      <button
        className={`remote-header-button ${activeButton === "settings" ? "active" : ""}`}
        onClick={() => onButtonPress("settings", "SETTINGS")}
        aria-label="Settings"
      >
        <Settings className="w-5 h-5" />
      </button>
    </div>
  );
};

export default RemoteHeader;