import React from 'react';
import { Home, Power } from 'lucide-react';
import './PowerHomeButtons.css';

const PowerHomeButtons = ({ activeButton, onButtonPress }) => {
  return (
    <div className="power-home-buttons">
      <button
        className={`circle-button ${activeButton === "home" ? "active" : ""}`}
        onClick={() => onButtonPress("home", "HOME")}
        aria-label="Home"
      >
        <Home className="circle-button-icon" />
      </button>
      <button
        className={`circle-button ${activeButton === "power" ? "active" : ""}`}
        onClick={() => onButtonPress("power", "POWER")}
        aria-label="Power"
      >
        <Power className="circle-button-icon power" />
      </button>
    </div>
  );
};

export default PowerHomeButtons;