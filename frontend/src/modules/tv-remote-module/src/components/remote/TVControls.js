import React from 'react';
import { ListVideo, Subtitles, HardDrive, Music } from 'lucide-react';
import './TVControls.css';

const TVControls = ({ activeButton, onButtonPress }) => {
  return (
    <div className="tv-controls">
      <button
        className={`media-button ${activeButton === "guide" ? "active" : ""}`}
        onClick={() => onButtonPress("guide", "GUIDE")}
        aria-label="Guide"
      >
        <ListVideo className="media-button-icon" />
      </button>
      <button
        className={`media-button ${activeButton === "captions" ? "active" : ""}`}
        onClick={() => onButtonPress("captions", "CAPTIONS")}
        aria-label="Captions"
      >
        <Subtitles className="media-button-icon" />
      </button>
      <button
        className={`media-button ${activeButton === "dvr" ? "active" : ""}`}
        onClick={() => onButtonPress("dvr", "DVR")}
        aria-label="DVR"
      >
        <HardDrive className="media-button-icon" />
      </button>
      <button
        className={`media-button ${activeButton === "audio-track" ? "active" : ""}`}
        onClick={() => onButtonPress("audio-track", "AUDIO_TRACK")}
        aria-label="Audio Track"
      >
        <Music className="media-button-icon" />
      </button>
    </div>
  );
};

export default TVControls;