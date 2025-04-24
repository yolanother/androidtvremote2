import React from 'react';
import { Gamepad2, Keyboard } from 'lucide-react';
import './TabNavigation.css';

const TabNavigation = ({ activeTab, setActiveTab, onButtonPress }) => {
  return (
    <div className="tab-navigation">
      <button
        className={`tab-button remote ${activeTab === "remote" ? "active" : ""}`}
        onClick={() => {
          setActiveTab("remote");
          onButtonPress("remote-icon");
        }}
        aria-label="Remote"
      >
        <div className="tab-button-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="5" y="4" width="14" height="16" rx="4" stroke="#333" strokeWidth="2" />
            <circle cx="12" cy="16" r="2" fill="#333" />
          </svg>
        </div>
      </button>
      <button
        className={`tab-button gamepad ${activeTab === "gamepad" ? "active" : ""}`}
        onClick={() => {
          setActiveTab("gamepad");
          onButtonPress("gamepad-icon");
        }}
        aria-label="Gamepad"
      >
        <Gamepad2 className="tab-button-icon" />
      </button>
      <button
        className={`tab-button functions ${activeTab === "functions" ? "active" : ""}`}
        onClick={() => {
          setActiveTab("functions");
          onButtonPress("functions-icon");
        }}
        aria-label="Functions"
      >
        <Keyboard className="tab-button-icon" />
      </button>
    </div>
  );
};

export default TabNavigation;