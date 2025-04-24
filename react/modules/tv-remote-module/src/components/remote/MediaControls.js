import React from 'react';
import { VolumeX, SkipBack, Play, SkipForward, Square, Rewind, FastForward } from 'lucide-react';
import './MediaControls.css';

const MediaControls = ({ activeButton, onButtonPress }) => {
  return (
    <>
      {/* Primary Media Controls */}
      <div className="media-controls">
        <button
          className={`media-button ${activeButton === "mute" ? "active" : ""}`}
          onClick={() => onButtonPress("mute", "MUTE")}
          aria-label="Mute"
        >
          <VolumeX className="media-button-icon" />
        </button>
        <button
          className={`media-button ${activeButton === "prev" ? "active" : ""}`}
          onClick={() => onButtonPress("prev", "MEDIA_PREVIOUS")}
          aria-label="Previous"
        >
          <SkipBack className="media-button-icon" />
        </button>
        <button
          className={`media-button ${activeButton === "play-pause" ? "active" : ""}`}
          onClick={() => onButtonPress("play-pause", "MEDIA_PLAY_PAUSE")}
          aria-label="Play/Pause"
        >
          <Play className="media-button-icon" />
        </button>
        <button
          className={`media-button ${activeButton === "next" ? "active" : ""}`}
          onClick={() => onButtonPress("next", "MEDIA_NEXT")}
          aria-label="Next"
        >
          <SkipForward className="media-button-icon" />
        </button>
        <button
          className={`media-button ${activeButton === "stop" ? "active" : ""}`}
          onClick={() => onButtonPress("stop", "MEDIA_STOP")}
          aria-label="Stop"
        >
          <Square className="media-button-icon" />
        </button>
      </div>

      {/* Additional Media Controls */}
      <div className="additional-media-controls">
        <button
          className={`media-button ${activeButton === "rewind" ? "active" : ""}`}
          onClick={() => onButtonPress("rewind", "MEDIA_REWIND")}
          aria-label="Rewind"
        >
          <Rewind className="media-button-icon" />
        </button>
        <button
          className={`media-button ${activeButton === "record" ? "active" : ""}`}
          onClick={() => onButtonPress("record", "MEDIA_RECORD")}
          aria-label="Record"
        >
          <div className="record-button-circle"></div>
        </button>
        <button
          className={`media-button ${activeButton === "forward" ? "active" : ""}`}
          onClick={() => onButtonPress("forward", "MEDIA_FAST_FORWARD")}
          aria-label="Fast Forward"
        >
          <FastForward className="media-button-icon" />
        </button>
      </div>
    </>
  );
};

export default MediaControls;