import React from 'react';
import './GamepadTab.css';

const GamepadTab = ({ activeButton, onButtonPress }) => {
  return (
    <div className="tab-content">
      <div className="tab-panel">
        <div className="tab-panel-title">Gamepad Controls</div>
        
        <div className="tab-panel-description">
          The gamepad functionality allows you to control games on your Android TV.
        </div>
        
        <div className="tab-panel-grid">
          <button
            className={`media-button ${activeButton === "button-mode" ? "active" : ""}`}
            onClick={() => onButtonPress("button-mode", "BUTTON_MODE")}
            aria-label="Mode"
          >
            <span className="nav-button-text">MODE</span>
          </button>
          <button
            className={`media-button ${activeButton === "explorer" ? "active" : ""}`}
            onClick={() => onButtonPress("explorer", "EXPLORER")}
            aria-label="Explorer"
          >
            <span className="nav-button-text">EXPLORER</span>
          </button>
        </div>
        
        <div className="tab-panel-note">
          More gamepad controls will be available in future updates.
        </div>
      </div>
    </div>
  );
};

export default GamepadTab;