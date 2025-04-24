import React from 'react';
import './ColorButtons.css';

const ColorButtons = ({ activeButton, onButtonPress }) => {
  return (
    <div className="color-buttons">
      <button
        className={`color-button red ${activeButton === "red" ? "active" : ""}`}
        onClick={() => onButtonPress("red", "PROG_RED")}
        aria-label="Red"
      >
        <span className="color-button-text">RED</span>
      </button>
      <button
        className={`color-button green ${activeButton === "green" ? "active" : ""}`}
        onClick={() => onButtonPress("green", "PROG_GREEN")}
        aria-label="Green"
      >
        <span className="color-button-text">GREEN</span>
      </button>
      <button
        className={`color-button yellow ${activeButton === "yellow" ? "active" : ""}`}
        onClick={() => onButtonPress("yellow", "PROG_YELLOW")}
        aria-label="Yellow"
      >
        <span className="color-button-text">YELLOW</span>
      </button>
      <button
        className={`color-button blue ${activeButton === "blue" ? "active" : ""}`}
        onClick={() => onButtonPress("blue", "PROG_BLUE")}
        aria-label="Blue"
      >
        <span className="color-button-text">BLUE</span>
      </button>
    </div>
  );
};

export default ColorButtons;