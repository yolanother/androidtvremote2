import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import TVRemote from './components/TVRemote';
import './App.css';

function App() {
  return (
    <div className="App">
      <Router>
        <Routes>
          <Route path="/" element={<TVRemote />} />
          <Route path="/tv/:ip" element={<TVRemote />} />
        </Routes>
      </Router>
    </div>
  );
}

export default App;
