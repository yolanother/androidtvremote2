import React, { useState } from 'react';
import './PairingView.css';

const HexButton = ({ value, onClick }) => (
  <button 
    className="hex-button" 
    onClick={() => onClick(value)}
  >
    {value}
  </button>
);

const PairingView = ({ 
  ip, 
  onPairingComplete, 
  onStartPairing, 
  onFinishPairing, 
  isPairing = false,
  error = null
}) => {
  const [pairingCode, setPairingCode] = useState('');
  const [message, setMessage] = useState('');

  const handleKeyPress = (value) => {
    if (pairingCode.length < 6) {
      setPairingCode(prev => prev + value);
    }
  };

  const handleBackspace = () => {
    setPairingCode(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    setPairingCode('');
  };

  const handleStartPairing = async () => {
    setMessage('Starting pairing process...');
    try {
      const result = await onStartPairing();
      if (result) {
        setMessage('Please enter the pairing code shown on your TV.');
      } else {
        setMessage('Failed to start pairing. Please try again.');
      }
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    }
  };

  const handleFinishPairing = async () => {
    if (pairingCode.length !== 6) {
      setMessage('Please enter a 6-digit pairing code.');
      return;
    }

    setMessage('Completing pairing...');
    try {
      const result = await onFinishPairing(pairingCode);
      if (result) {
        setMessage('Pairing successful!');
        onPairingComplete();
      } else {
        setMessage('Pairing failed. Please check the code and try again.');
      }
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    }
  };

  // Hex keyboard values
  const hexValues = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'];

  return (
    <div className="pairing-view">
      <div className="pairing-header">
        <h2>Pair with Android TV</h2>
        <p className="tv-ip">IP: {ip}</p>
      </div>

      {error && <div className="error-message">{error}</div>}
      
      <div className="pairing-content">
        <p className="pairing-instructions">
          {isPairing 
            ? 'Enter the 6-digit pairing code shown on your TV screen.'
            : 'Your TV needs to be paired before you can control it. Click "Start Pairing" to begin.'}
        </p>

        {isPairing && (
          <>
            <div className="pairing-code-display">
              {[...Array(6)].map((_, index) => (
                <div key={index} className="code-digit">
                  {pairingCode[index] || ''}
                </div>
              ))}
            </div>

            <div className="hex-keyboard">
              {hexValues.map(value => (
                <HexButton 
                  key={value} 
                  value={value} 
                  onClick={handleKeyPress} 
                />
              ))}
              <button className="hex-button function-button" onClick={handleBackspace}>
                ⌫
              </button>
              <button className="hex-button function-button" onClick={handleClear}>
                Clear
              </button>
            </div>

            <button 
              className="pairing-button finish-button" 
              onClick={handleFinishPairing}
              disabled={pairingCode.length !== 6}
            >
              Complete Pairing
            </button>
          </>
        )}

        {!isPairing && (
          <button 
            className="pairing-button start-button" 
            onClick={handleStartPairing}
          >
            Start Pairing
          </button>
        )}

        {message && <p className="pairing-message">{message}</p>}
      </div>
    </div>
  );
};

export default PairingView;