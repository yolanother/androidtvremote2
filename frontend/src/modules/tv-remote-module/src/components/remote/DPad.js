import React from 'react';
import {
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  Volume2, Volume, Home, ArrowLeft as Back
} from 'lucide-react';
import './DPad.css';

const DPad = ({ activeButton, onButtonPress, isLargeScreen }) => {
  return (
    <div className="dpad-container">
      <div className="dpad-background">
        {/* Volume Up Button - Top Left */}
        <div 
          className={`clip-top-left ${activeButton === "vol-up" ? "active" : ""}`}
          onClick={() => onButtonPress("vol-up", "VOLUME_UP")}
          aria-label="Volume Up"
        >
          <div>
            <Volume2 />
          </div>
        </div>

        {/* Home Button - Top Right */}
        <div
          className={`clip-top-right ${activeButton === "home" ? "active" : ""}`}
          onClick={() => onButtonPress("home", "HOME")}
          aria-label="Home"
        >
          <div>
            <Home />
          </div>
        </div>

        {/* Volume Down Button - Bottom Left */}
        <div 
          className={`clip-bottom-left ${activeButton === "vol-down" ? "active" : ""}`}
          onClick={() => onButtonPress("vol-down", "VOLUME_DOWN")}
          aria-label="Volume Down"
        >
          <div>
            <Volume />
          </div>
        </div>

        {/* Back Button - Bottom Right */}
        <div
          className={`clip-bottom-right ${activeButton === "back" ? "active" : ""}`}
          onClick={() => onButtonPress("back", "BACK")}
          aria-label="Back"
        >
          <div>
            <Back />
          </div>
        </div>

        {/* Center D-Pad */}
        <div className="dpad-center">
          {/* D-Pad Container */}
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Up Arrow */}
            <button
              className={`dpad-arrow dpad-up ${activeButton === "dpad-up" ? "active" : ""}`}
              onClick={() => onButtonPress("dpad-up", "DPAD_UP")}
              aria-label="D-Pad Up"
            >
              <ArrowUp />
            </button>

            {/* Right Arrow */}
            <button
              className={`dpad-arrow dpad-right ${activeButton === "dpad-right" ? "active" : ""}`}
              onClick={() => onButtonPress("dpad-right", "DPAD_RIGHT")}
              aria-label="D-Pad Right"
            >
              <ArrowRight />
            </button>

            {/* Down Arrow */}
            <button
              className={`dpad-arrow dpad-down ${activeButton === "dpad-down" ? "active" : ""}`}
              onClick={() => onButtonPress("dpad-down", "DPAD_DOWN")}
              aria-label="D-Pad Down"
            >
              <ArrowDown />
            </button>

            {/* Left Arrow */}
            <button
              className={`dpad-arrow dpad-left ${activeButton === "dpad-left" ? "active" : ""}`}
              onClick={() => onButtonPress("dpad-left", "DPAD_LEFT")}
              aria-label="D-Pad Left"
            >
              <ArrowLeft />
            </button>

            {/* OK Button (DPAD_CENTER) */}
            <button
              className={`dpad-ok ${activeButton === "dpad-center" ? "active" : ""}`}
              onClick={() => onButtonPress("dpad-center", "DPAD_CENTER")}
              aria-label="D-Pad Center"
            >
              <span className="dpad-ok-text">OK</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DPad;