import React from 'react';
import { Gamepad2, Keyboard } from 'lucide-react';
import './BottomNavigation.css';

const BottomNavigation = ({ activeTab, setActiveTab, onButtonPress }) => {
  return (
    <div className="bottom-navigation">
      <button
        className={`bottom-nav-button ${activeTab === "remote" ? "remote" : ""}`}
        onClick={() => {
          setActiveTab("remote");
          onButtonPress("tab-remote");
        }}
        aria-label="Remote Tab"
      >
        <div className="bottom-nav-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="5" y="2" width="14" height="20" rx="4" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="17" r="2" fill="currentColor" />
          </svg>
        </div>
        <span className="bottom-nav-text">Remote</span>
      </button>

      <button
        className={`bottom-nav-button ${activeTab === "gamepad" ? "remote" : "gamepad"}`}
        onClick={() => {
          setActiveTab("gamepad");
          onButtonPress("tab-gamepad");
        }}
        aria-label="Gamepad Tab"
      >
        <Gamepad2 className="bottom-nav-icon" />
        <span className="bottom-nav-text">Gamepad</span>
      </button>

      <button
        className={`bottom-nav-button ${activeTab === "functions" ? "remote" : "functions"}`}
        onClick={() => {
          setActiveTab("functions");
          onButtonPress("tab-functions");
        }}
        aria-label="Functions Tab"
      >
        <Keyboard className="bottom-nav-icon" />
        <span className="bottom-nav-text">Functions</span>
      </button>
    </div>
  );
};

export default BottomNavigation;