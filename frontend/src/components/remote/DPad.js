import React from 'react';
import { 
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, 
  Volume2, Volume, ChevronUp, ChevronDown, Tv2 
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
          <div className="absolute top-[30%] left-[30%] transform -translate-x-1/2 -translate-y-1/2">
            <Volume2 className="w-7 h-7 text-white" />
          </div>
        </div>

        {/* Channel Up Button - Top Right */}
        <div 
          className={`clip-top-right ${activeButton === "ch-up" ? "active" : ""}`}
          onClick={() => onButtonPress("ch-up", "CHANNEL_UP")}
          aria-label="Channel Up"
        >
          <div className="absolute top-[30%] right-[30%] transform translate-x-1/2 -translate-y-1/2">
            <div className="flex flex-col items-center">
              <ChevronUp className="w-7 h-7 text-white" />
              <Tv2 className="w-4 h-4 text-white -mt-1" />
            </div>
          </div>
        </div>

        {/* Volume Down Button - Bottom Left */}
        <div 
          className={`clip-bottom-left ${activeButton === "vol-down" ? "active" : ""}`}
          onClick={() => onButtonPress("vol-down", "VOLUME_DOWN")}
          aria-label="Volume Down"
        >
          <div className="absolute bottom-[30%] left-[30%] transform -translate-x-1/2 translate-y-1/2">
            <Volume className="w-7 h-7 text-white" />
          </div>
        </div>

        {/* Channel Down Button - Bottom Right */}
        <div 
          className={`clip-bottom-right ${activeButton === "ch-down" ? "active" : ""}`}
          onClick={() => onButtonPress("ch-down", "CHANNEL_DOWN")}
          aria-label="Channel Down"
        >
          <div className="absolute bottom-[30%] right-[30%] transform translate-x-1/2 translate-y-1/2">
            <div className="flex flex-col items-center">
              <Tv2 className="w-4 h-4 text-white mb-1" />
              <ChevronDown className="w-7 h-7 text-white -mt-1" />
            </div>
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
              <ArrowUp className="w-6 h-6 text-white" />
            </button>

            {/* Right Arrow */}
            <button
              className={`dpad-arrow dpad-right ${activeButton === "dpad-right" ? "active" : ""}`}
              onClick={() => onButtonPress("dpad-right", "DPAD_RIGHT")}
              aria-label="D-Pad Right"
            >
              <ArrowRight className="w-6 h-6 text-white" />
            </button>

            {/* Down Arrow */}
            <button
              className={`dpad-arrow dpad-down ${activeButton === "dpad-down" ? "active" : ""}`}
              onClick={() => onButtonPress("dpad-down", "DPAD_DOWN")}
              aria-label="D-Pad Down"
            >
              <ArrowDown className="w-6 h-6 text-white" />
            </button>

            {/* Left Arrow */}
            <button
              className={`dpad-arrow dpad-left ${activeButton === "dpad-left" ? "active" : ""}`}
              onClick={() => onButtonPress("dpad-left", "DPAD_LEFT")}
              aria-label="D-Pad Left"
            >
              <ArrowLeft className="w-6 h-6 text-white" />
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