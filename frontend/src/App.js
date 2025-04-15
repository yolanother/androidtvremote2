import React from 'react';
import TVRemote from './components/TVRemote';
import './App.css';

function App() {
  return (
    <div className="App">
      <TVRemote ip="192.168.1.100" />
    </div>
  );
}

export default App;
