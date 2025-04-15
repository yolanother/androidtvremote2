import React from 'react';
import './FunctionsTab.css';

const FunctionsTab = ({ activeButton, onButtonPress }) => {
  return (
    <div className="tab-content">
      <div className="tab-panel">
        <div className="tab-panel-title">Function Keys</div>
        
        <div className="function-keys-grid">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((num) => (
            <button
              key={num}
              className={`media-button ${activeButton === `f${num}` ? "active" : ""}`}
              onClick={() => onButtonPress(`f${num}`, `F${num}`)}
              aria-label={`F${num}`}
            >
              <span className="nav-button-text">F{num}</span>
            </button>
          ))}
        </div>
        
        <div className="tab-panel-title">Additional Controls</div>
        
        <div className="tab-panel-grid">
          <button
            className={`media-button ${activeButton === "tv" ? "active" : ""}`}
            onClick={() => onButtonPress("tv", "TV")}
            aria-label="TV"
          >
            <span className="nav-button-text">TV</span>
          </button>
          <button
            className={`media-button ${activeButton === "teletext" ? "active" : ""}`}
            onClick={() => onButtonPress("teletext", "TELETEXT")}
            aria-label="Teletext"
          >
            <span className="nav-button-text">TELETEXT</span>
          </button>
          <button
            className={`media-button ${activeButton === "media" ? "active" : ""}`}
            onClick={() => onButtonPress("media", "MEDIA")}
            aria-label="Media"
          >
            <span className="nav-button-text">MEDIA</span>
          </button>
          <button
            className={`media-button ${activeButton === "settings-menu" ? "active" : ""}`}
            onClick={() => onButtonPress("settings-menu", "SETTINGS_MENU")}
            aria-label="Settings Menu"
          >
            <span className="nav-button-text">SETTINGS</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default FunctionsTab;