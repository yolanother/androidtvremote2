import React from 'react';
import { Trash2, CornerDownLeft } from 'lucide-react';
import './NumberPad.css';

const NumberPad = ({ activeButton, onButtonPress }) => {
  return (
    <div className="number-pad">
      <div className="number-pad-title">Number Pad</div>
      <div className="grid">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, "DEL", 0, "ENTER"].map((num) => {
          const buttonClass = `number-button ${activeButton === `num-${num}` ? "active" : ""} ${
            num === "DEL" ? "del" : num === "ENTER" ? "enter" : ""
          }`;
          
          return (
            <button
              key={num}
              className={buttonClass}
              onClick={() => {
                if (typeof num === 'number') {
                  onButtonPress(`num-${num}`, `${num}`);
                } else if (num === "DEL") {
                  onButtonPress(`num-${num}`, "DEL");
                } else if (num === "ENTER") {
                  onButtonPress(`num-${num}`, "ENTER");
                }
              }}
              aria-label={`${typeof num === "number" ? "Number " + num : num}`}
            >
              {num === "DEL" ? (
                <Trash2 className="w-5 h-5" />
              ) : num === "ENTER" ? (
                <CornerDownLeft className="w-5 h-5" />
              ) : (
                num
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default NumberPad;