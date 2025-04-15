import React from 'react';
import { Mic, Search } from 'lucide-react';
import './VoiceControls.css';

const VoiceControls = ({ activeButton, onButtonPress }) => {
  return (
    <div className="voice-controls">
      <button
        className={`voice-button assistant ${activeButton === "assist" ? "active" : ""}`}
        onClick={() => onButtonPress("assist", "ASSIST")}
        aria-label="Assistant"
      >
        <Mic className="voice-button-icon assistant" />
        <span className="voice-button-text">Assistant</span>
      </button>
      <button
        className={`voice-button search ${activeButton === "search" ? "active" : ""}`}
        onClick={() => onButtonPress("search", "SEARCH")}
        aria-label="Search"
      >
        <Search className="voice-button-icon" />
        <span className="voice-button-text">Search</span>
      </button>
    </div>
  );
};

export default VoiceControls;