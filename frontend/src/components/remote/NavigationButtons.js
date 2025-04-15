import React from 'react';
import { Menu, Info } from 'lucide-react';
import './NavigationButtons.css';

const NavigationButtons = ({ activeButton, onButtonPress }) => {
  return (
    <div className="navigation-buttons">
      <button
        className={`nav-button ${activeButton === "menu" ? "active" : ""}`}
        onClick={() => onButtonPress("menu", "MENU")}
        aria-label="Menu"
      >
        <Menu className="nav-button-icon" />
      </button>
      <button
        className={`nav-button ${activeButton === "back" ? "active" : ""}`}
        onClick={() => onButtonPress("back", "BACK")}
        aria-label="Back"
      >
        <span className="nav-button-text">BACK</span>
      </button>
      <button
        className={`nav-button ${activeButton === "info" ? "active" : ""}`}
        onClick={() => onButtonPress("info", "INFO")}
        aria-label="Info"
      >
        <Info className="nav-button-icon" />
      </button>
    </div>
  );
};

export default NavigationButtons;